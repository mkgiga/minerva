// client/components/views/modes/AdventureChatMode.js
import { BaseChatMode } from "./BaseChatMode.js";
import { chatModeRegistry } from "../../../ChatModeRegistry.js";
import { notifier, uuidv4, imagePreview } from "../../../client.js";
import "../../common/TextBox.js";
import "../../common/Spinner.js";

export class AdventureChatMode extends BaseChatMode {
    #historyContainer = null;
    #form = null;
    #textbox = null;
    #sendButton = null;
    #quickRegenButton = null;
    #lastUnansweredPromptEl = null;
    #isAnimating = false;
    #justAnimatedMessageIds = new Set();
    #settings = {};
    #streamingContent = new Map();
    #strippedHistory = [];

    static getSettingsSchema() {
        return [
            {
                name: "scrollSpeed",
                label: "Typewriter Speed (ms per character)",
                type: "range",
                min: 0,
                max: 100,
                step: 1,
                description:
                    "The delay between each character appearing in the typewriter effect. Set to 0 for instant text.",
            },
            {
                name: "blockGap",
                label: "Gap Between Blocks (rem)",
                type: "range",
                min: 0,
                max: 4,
                step: 0.25,
                description:
                    "The vertical spacing between narration, dialogue, and other blocks.",
            },
            {
                name: "autoScroll",
                label: "Enable Auto-Scrolling",
                type: "checkbox",
                description:
                    "Automatically scroll to the newest content as it is being generated during live responses.",
            },
        ];
    }

    static getDefaultSettings() {
        return {
            scrollSpeed: 6,
            blockGap: 1.5, // Corresponds to --spacing-lg
            autoScroll: true,
        };
    }
    
    #levenshteinDistance(s1, s2) {
        s1 = s1.toLowerCase();
        s2 = s2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    #tryRepairSceneML(content) {
        let processedContent = content.trim().replace(/^`{3,}(xml)?\s*\n?/, '').replace(/\n?`{3,}$/, '').trim();
        if (!processedContent) return null;

        const parser = new DOMParser();
        let doc = parser.parseFromString(processedContent, "application/xml");
        let parserError = doc.querySelector("parsererror");
        if (!parserError) return doc;
        
        console.warn("SceneML parsing failed, attempting repair. Error:", parserError.textContent);

        const tagNames = ["scene", "narrate", "dialogue", "speech", "image", "prompt", "info", "choice", "ref", "pause"];
        
        const findBestMatch = (badTag) => {
            let bestMatch = null;
            let minDistance = Infinity;
            for (const goodTag of tagNames) {
                const distance = this.#levenshteinDistance(badTag, goodTag);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = goodTag;
                }
            }
            return minDistance <= 2 ? bestMatch : null;
        };
        
        const repairedContent = processedContent.replace(/(<\/?)(\w+)(.*?>)/g, (match, opening, tagName, rest) => {
            if (tagNames.includes(tagName.toLowerCase())) return match;
            const bestMatch = findBestMatch(tagName);
            if (bestMatch) {
                console.log(`Repairing SceneML tag: '${tagName}' -> '${bestMatch}'`);
                return `${opening}${bestMatch}${rest}`;
            }
            return match;
        });

        doc = parser.parseFromString(repairedContent, "application/xml");
        parserError = doc.querySelector("parsererror");
        if (parserError) console.error("SceneML repair failed. Final error:", parserError.textContent);
        else console.log("SceneML repair successful.");
        return doc;
    }

    #rebuildStrippedHistory() {
        if (!this.chat?.messages) { this.#strippedHistory = []; return; }
        this.#strippedHistory = this.chat.messages.map(msg => (msg.role === "assistant" ? { ...msg, content: this.#stripPromptTag(msg.content) } : msg));
    }

    #stripPromptTag(content) {
        if (typeof content !== "string" || !content.includes("<prompt>")) return content;
        return content.replace(/<prompt>[\s\S]*?<\/prompt>/g, "").trim();
    }

    onInitialize() {
        this.render();
        this.#historyContainer = this.shadowRoot.querySelector("#chat-history");
        this.#form = this.shadowRoot.querySelector("#chat-form");
        this.#textbox = this.#form.querySelector("text-box");
        this.#sendButton = this.#form.querySelector(".send-button");
        this.#quickRegenButton = this.shadowRoot.querySelector("#quick-regen-btn");
        this.#settings = this.settings;
        this.#applySettings();
        this.#form.addEventListener("submit", this.#handleSend.bind(this));
        this.#sendButton.addEventListener("click", this.#handleSend.bind(this));
        this.#textbox.addEventListener("keydown", this.#handleTextboxKeydown.bind(this));
        this.#textbox.addEventListener("input", () => { if (!this.isSending) this.#sendButton.disabled = this.#textbox.value.trim() === ""; });
        if (this.#quickRegenButton) this.#quickRegenButton.addEventListener("click", this.#handleQuickRegen.bind(this));
        this.#historyContainer.addEventListener("click", this.#handleHistoryClick.bind(this));
        this.#rebuildStrippedHistory();
    }

    onSettingsChanged(newSettings) {
        this.#settings = { ...this.#settings, ...newSettings };
        this.#applySettings();
    }

    #applySettings() { this.style.setProperty("--adventure-block-gap", `${this.#settings.blockGap}rem`); }
    onChatSwitched() { this.refreshChatHistory(); this.#rebuildStrippedHistory(); }
    onChatBranched() { this.refreshChatHistory(); this.#rebuildStrippedHistory(); }
    onParticipantsChanged() { this.refreshChatHistory(); }
    onAllCharactersChanged() { this.refreshChatHistory(); }
    onUserPersonaChanged() { this.refreshChatHistory(); }

    onMessagesAdded(addedMessages) {
        this.#rebuildStrippedHistory();
        const optimisticUserEl = this.shadowRoot.querySelector('.chat-message[data-message-id^="user-"]');
        const optimisticAssistantEl = this.shadowRoot.querySelector('.optimistic-assistant-message');
        if (optimisticUserEl && optimisticAssistantEl && addedMessages.length >= 2) {
            this.#updateMessageContent(optimisticUserEl, addedMessages.at(-2));
            optimisticAssistantEl.dataset.messageId = addedMessages.at(-1).id;
        } else {
            this.refreshChatHistory();
        }
    }

    onMessageUpdated(updatedMessage) {
        this.#rebuildStrippedHistory();
        if (this.#justAnimatedMessageIds.has(updatedMessage.id)) { this.#justAnimatedMessageIds.delete(updatedMessage.id); return; }
        if (this.#isAnimating) return;
        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${updatedMessage.id}"]`);
        if (messageEl) this.#updateMessageContent(messageEl, updatedMessage);
    }

    onMessagesDeleted(deletedMessageIds) {
        this.#rebuildStrippedHistory();
        if (this.#isAnimating) return;
        for (const id of deletedMessageIds) this.shadowRoot.querySelector(`.chat-message[data-message-id="${id}"]`)?.remove();
        this.updateInputState();
    }

    onPromptStart(userMessage) {
        this.appendMessage(userMessage);
        const assistantSpinnerMessage = { id: `assistant-${uuidv4()}`, role: "assistant", content: '<minerva-spinner mode="infinite"></minerva-spinner>', timestamp: new Date().toISOString() };
        const assistantEl = this.appendMessage(assistantSpinnerMessage);
        if (assistantEl) assistantEl.classList.add('optimistic-assistant-message');
        this.clearUserInput();
        return assistantSpinnerMessage.id;
    }

    onRegenerateStart(messageId) {
        const messageData = this.getMessageById(messageId);
        if (!messageData) return;
        if (messageData.role === "assistant") {
            const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
            if (messageEl) this.#updateMessageContent(messageEl, { ...messageData, content: '<minerva-spinner mode="infinite"></minerva-spinner>' });
        } else if (messageData.role === "user") {
            const assistantSpinnerMessage = { id: `assistant-${uuidv4()}`, role: "assistant", content: '<minerva-spinner mode="infinite"></minerva-spinner>', timestamp: new Date().toISOString() };
            const assistantEl = this.appendMessage(assistantSpinnerMessage);
            if (assistantEl) assistantEl.classList.add('optimistic-assistant-message');
        }
    }

    regenerateMessage(messageId) {
        const messageIndex = this.chat.messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return;
        this.regenerateWithHistory({ messageId, history: this.#strippedHistory.slice(0, messageIndex + 1) });
    }

    #handleSend(event) {
        event.preventDefault();
        if (this.isSending) { this.abortGeneration(); return; }
        const promptText = event.target.value || this.getUserInput();
        const isProgrammaticSend = !!event.target.value;
        if (promptText && (isProgrammaticSend || !this.#sendButton.disabled)) {
            const userMessage = { role: "user", content: promptText, characterId: this.userPersona?.id || null, timestamp: new Date().toISOString(), id: `user-${uuidv4()}` };
            this.sendChatCompletion({ userMessage, messages: [...this.#strippedHistory] });
        }
    }

    #handleTextboxKeydown(event) {
        if (event.key === "Enter" && event.ctrlKey && this.#sendButton && !this.#sendButton.disabled) {
            event.preventDefault();
            this.#handleSend(event);
        }
    }

    #handleQuickRegen() {
        if (this.isSending || this.#isAnimating || !this.chat || this.chat.messages.length === 0) return;
        this.regenerateMessage(this.chat.messages.at(-1).id);
    }

    #handleHistoryClick(event) {
        const header = event.target.closest(".adventure-prompt-header");
        if (header) {
            const promptBlock = header.closest(".adventure-prompt");
            promptBlock.classList.toggle("collapsed");
            const icon = header.querySelector(".expand-icon");
            if (icon) icon.textContent = promptBlock.classList.contains("collapsed") ? "unfold_more" : "unfold_less";
            return;
        }

        const avatarImg = event.target.closest(".adventure-speaker-avatar, .adventure-image-display");
        if (avatarImg?.tagName === "IMG") { imagePreview.show({ src: avatarImg.src, alt: avatarImg.alt }); return; }

        for (const button of event.composedPath()) {
            if (button.tagName === "BUTTON" && button.dataset.action) {
                const messageId = button.closest(".chat-message")?.dataset.messageId;
                if (!messageId) continue;
                const action = button.dataset.action;
                event.preventDefault();

                if (action === "adventure-choice") {
                    this.#handleSend({ preventDefault: () => {}, target: { value: `<choice>${button.dataset.choiceText}</choice>` } });
                    const choiceContainer = button.closest(".adventure-prompt-body");
                    if (choiceContainer) choiceContainer.innerHTML = `<p><em>You chose: ${this.#escapeHtml(button.dataset.choiceText)}</em></p>`;
                    return;
                } else if (action === "navigate-to-character") {
                    this.dispatch("navigate-to-view", { view: "characters", state: { selectedCharacterId: button.dataset.characterId } });
                    return;
                } else if (button.closest(".message-controls")) {
                    switch (action) {
                        case "delete": this.deleteMessage(messageId); break;
                        case "branch": this.branchFromMessage(messageId); break;
                        case "regenerate": this.regenerateMessage(messageId); break;
                        case "edit": this.#handleEditMessage(messageId, button.closest(".chat-message")); break;
                        case "copy": { const msg = this.getMessageById(messageId); if (msg) this.copyMessageContent(msg.content); break; }
                    }
                    return;
                }
            }
        }
    }

    #handleEditMessage(messageId, messageEl) {
        const isAdventure = messageEl.classList.contains("adventure-mode");
        const contentContainer = isAdventure ? messageEl : messageEl.querySelector(".message-content");
        if (!contentContainer) return;
        const originalContent = this.getMessageById(messageId)?.content || "";

        const editor = document.createElement("text-box");
        editor.value = originalContent;
        editor.style.minHeight = "150px";
        editor.style.height = `${Math.max(contentContainer.offsetHeight, 150)}px`;

        const controls = isAdventure ? messageEl.querySelector(".message-controls") : null;
        contentContainer.innerHTML = "";
        if (controls) contentContainer.appendChild(controls);
        contentContainer.appendChild(editor);
        editor.focus();

        let isCancelled = false;
        const onKeydown = (e) => {
            if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); editor.blur(); }
            else if (e.key === "Escape") { e.preventDefault(); isCancelled = true; editor.blur(); }
        };
        const onBlur = () => {
            editor.removeEventListener("keydown", onKeydown);
            editor.removeEventListener("blur", onBlur);
            const newContent = editor.value;
            if (isCancelled || newContent.trim() === originalContent.trim()) this.#updateMessageContent(messageEl, this.getMessageById(messageId));
            else this.saveEditedMessage(messageId, newContent);
        };
        editor.addEventListener("keydown", onKeydown);
        editor.addEventListener("blur", onBlur);
    }

    getUserInput() { return this.#textbox.value; }
    clearUserInput() { this.#textbox.value = ""; }

    updateInputState(isSending = false) {
        this.isSending = isSending;
        if (!this.#textbox || !this.#sendButton) return;
        this.#textbox.disabled = isSending || this.#isAnimating;
        const sendIcon = this.#sendButton.querySelector(".material-icons");
        if (isSending) {
            this.#sendButton.disabled = false;
            this.#sendButton.title = "Stop Generation";
            this.#sendButton.classList.add("stop-button");
            if (sendIcon) sendIcon.textContent = "stop";
        } else {
            this.#sendButton.disabled = this.getUserInput().trim() === "" || this.#isAnimating;
            this.#sendButton.title = "Send";
            this.#sendButton.classList.remove("stop-button");
            if (sendIcon) sendIcon.textContent = "send";
        }
        if (this.#quickRegenButton) this.#quickRegenButton.disabled = isSending || this.#isAnimating || !this.chat || this.chat.messages.length === 0;
    }

    onStreamStart(messageId) { this.#streamingContent.set(messageId, ""); }
    onToken(token, messageId) {
        if (this.#streamingContent.has(messageId)) this.#streamingContent.set(messageId, this.#streamingContent.get(messageId) + token);
    }

    async onStreamFinish(messageId) {
        const finalContent = this.#streamingContent.get(messageId);
        if (finalContent === undefined) return;
        let messageEl = this.shadowRoot.querySelector('.optimistic-assistant-message') || this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
        if (!messageEl) {
            for (const msg of this.shadowRoot.querySelectorAll('.chat-message.assistant')) if (msg.innerHTML.includes('<minerva-spinner')) { messageEl = msg; break; }
        }
        if (messageEl) {
            this.#justAnimatedMessageIds.add(messageEl.dataset.messageId);
            await this.#animateSceneMLResponse(messageEl, { id: messageEl.dataset.messageId, role: "assistant", content: finalContent });
            messageEl.classList.remove('optimistic-assistant-message');
        } else {
            notifier.warning(`Failed to render response: Could not find message element (ID: ${messageId})`);
        }
        this.#streamingContent.delete(messageId);
    }

    onStreamError(error, messageId) {
        const content = error.name === "AbortError" ? `${this.#streamingContent.get(messageId) || ""}\n\n*Generation stopped by user.*` : `**Error:** Could not get response.\n*${error.message}*`;
        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
        if (messageEl) {
            this.#updateMessageContent(messageEl, { id: messageId, role: "assistant", content });
            messageEl.classList.remove('optimistic-assistant-message');
        }
        this.#streamingContent.delete(messageId);
    }

    refreshChatHistory() {
        if (!this.#historyContainer || !this.chat) { this.#historyContainer.innerHTML = ""; return; }
        this.#lastUnansweredPromptEl = null;
        this.#historyContainer.innerHTML = "";
        for (let i = 0; i < this.chat.messages.length; i++) this.appendMessage(this.chat.messages[i], false, i);
        if (this.#lastUnansweredPromptEl) {
            this.#lastUnansweredPromptEl.classList.remove("collapsed");
            const icon = this.#lastUnansweredPromptEl.querySelector(".expand-icon");
            if (icon) icon.textContent = "unfold_less";
        }
        setTimeout(() => { this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight; }, 0);
        this.updateInputState(this.isSending);
    }

    appendMessage(message, scrollToBottom = true, index = -1) {
        if (!this.#historyContainer) return;
        const messageEl = this.#createMessageElement(message);
        this.#updateMessageContent(messageEl, message, index);
        this.#historyContainer.appendChild(messageEl);
        if (scrollToBottom) this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight;
        this.updateInputState(this.isSending);
        return messageEl;
    }

    #findCharacter(idOrName) {
        if (!idOrName) return undefined;
        const charById = this.getCharacterById(idOrName);
        if (charById) return charById;
        return this.allCharacters.find(c => c.name.toLowerCase() === idOrName.toLowerCase());
    }

    #createMessageElement(msg) {
        const messageEl = document.createElement("div");
        messageEl.dataset.messageId = msg.id;
        return messageEl;
    }

    #updateMessageContent(messageEl, msg, index = -1) {
        messageEl.dataset.messageId = msg.id;
        if (msg.role !== "assistant") {
            const isUser = msg.role === "user";
            const isPlayerChoice = isUser && msg.content.startsWith("<choice>") && msg.content.endsWith("</choice>");
            const author = isUser ? this.getCharacterById(msg.characterId) : null;
            const authorName = author?.name || "You";
            let content = isPlayerChoice ? `<em>You chose: ${this.#escapeHtml(msg.content.slice(8, -9))}</em>` : this.#escapeHtml(msg.content).replace(/\n/g, "<br>");
            const avatarHTML = isUser ? "" : `<img src="assets/images/system_icon.svg" alt="System" class="avatar">`;
            messageEl.className = `chat-message ${isUser ? 'user' : msg.role}`;
            messageEl.innerHTML = `${avatarHTML}<div class="message-bubble"><div class="message-header"><span class="author-name">${authorName}</span>${this.#renderMessageControlsHTML(msg)}</div><div class="message-content">${content}</div></div>`;
        } else {
            const content = msg.content || "";
            if (content.includes("<minerva-spinner")) {
                messageEl.className = "chat-message assistant adventure-mode";
                messageEl.innerHTML = `<div class="message-controls">${this.#renderMessageControlsHTML(msg)}</div><div class="message-content">${content}</div>`;
                return;
            }

            const doc = this.#tryRepairSceneML(content);
            const sceneNode = doc?.querySelector("scene");
            const parserError = doc?.querySelector("parsererror");

            if (parserError || !sceneNode) {
                const author = this.allCharacters.find(c => c.id === this.chat.participants.find(p => !p.isAuto)?.id);
                const avatarUrl = author?.avatarUrl || "assets/images/assistant_icon.svg";
                const authorName = author?.name || "Assistant";
                messageEl.className = "chat-message assistant";
                messageEl.innerHTML = `<img src="${avatarUrl}" alt="${authorName}" class="avatar"><div class="message-bubble"><div class="message-header"><span class="author-name">${authorName}</span>${this.#renderMessageControlsHTML(msg)}</div><div class="message-content">${this.#escapeHtml(content).replace(/\n/g, "<br>")}</div></div>`;
                if (parserError) {
                    const errorDetails = document.createElement("div");
                    errorDetails.className = "adventure-parse-error";
                    errorDetails.innerHTML = "<strong>Parse Error:</strong><pre>" + this.#escapeHtml(parserError.textContent) + "</pre>";
                    messageEl.querySelector(".message-bubble").appendChild(errorDetails);
                }
            } else {
                messageEl.className = "chat-message assistant adventure-mode";
                messageEl.innerHTML = `<div class="message-controls">${this.#renderMessageControlsHTML(msg)}</div>`;
                messageEl.appendChild(this.#renderSceneMLOutput(sceneNode, msg, index));
            }
        }
    }

    #sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async #typewriter(element, childNodes) {
        const speed = this.#settings.scrollSpeed;
        element.innerHTML = "";
        element.style.animation = "none";
        element.style.opacity = "1";
        const scrollIntoViewIfNeeded = (el) => {
            if (!this.#settings.autoScroll) return;
            const containerRect = this.#historyContainer.getBoundingClientRect();
            if (el.getBoundingClientRect().bottom > containerRect.bottom) el.scrollIntoView({ behavior: "auto", block: "end", inline: "nearest" });
        };
        for (const node of childNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && node.nodeName.toLowerCase() === 'pause') {
                const duration = parseFloat(node.getAttribute('for') || 0) * 1000;
                if (duration > 0) await this.#sleep(duration);
            } else if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                const textNode = document.createTextNode("");
                element.appendChild(textNode);
                if (speed > 0) {
                    for (const char of text) {
                        textNode.nodeValue += char;
                        scrollIntoViewIfNeeded(element);
                        await this.#sleep(speed);
                    }
                } else {
                    textNode.nodeValue = text;
                    scrollIntoViewIfNeeded(element);
                }
            } else {
                element.appendChild(node.cloneNode(true));
                scrollIntoViewIfNeeded(element);
            }
        }
    }

    #getElementsToType(block) {
        if (!block) return [];
        const elementsToTypeInBlock = [];
        if (block.classList.contains("adventure-narrate")) elementsToTypeInBlock.push(block);
        else if (block.classList.contains("adventure-dialogue")) elementsToTypeInBlock.push(...block.querySelectorAll(".adventure-speech"));
        else if (block.classList.contains("adventure-image")) elementsToTypeInBlock.push(...block.querySelectorAll(".adventure-narrate, .adventure-speech"));
        return elementsToTypeInBlock;
    }
    
    async #animateSceneMLResponse(messageEl, msg) {
        this.#isAnimating = true;
        this.updateInputState(this.isSending);
        messageEl.innerHTML = "";

        const doc = this.#tryRepairSceneML(msg.content || "");
        const sceneNode = doc?.querySelector("scene");
        if (!sceneNode) { this.#updateMessageContent(messageEl, msg); this.#isAnimating = false; this.updateInputState(false); return; }

        messageEl.className = "chat-message assistant adventure-mode";
        messageEl.innerHTML = `<div class="message-controls">${this.#renderMessageControlsHTML(msg)}</div>`;

        // 1. Create all blocks and prepare content, but don't add to DOM yet
        const blocksAndContent = [];
        for (const node of Array.from(sceneNode.children)) {
            const block = this.#createSceneMLBlock(node, msg, -1);
            if (block) {
                const elementsToType = this.#getElementsToType(block);
                const contentMapForBlock = new Map();
                for (const el of elementsToType) {
                    contentMapForBlock.set(el, Array.from(el.childNodes));
                    el.innerHTML = "";
                }
                blocksAndContent.push({ block, contentMap: contentMapForBlock, elementsToType });
            }
        }

        // Preload images from all blocks before starting animation
        const allImageElements = blocksAndContent
            .map(item => Array.from(item.block.querySelectorAll('img.adventure-image-display')))
            .flat();

        const imageLoadPromises = allImageElements.map(img => new Promise(resolve => {
            if (img.complete) resolve();
            else { img.onload = img.onerror = () => resolve(); }
        }));
        await Promise.all(imageLoadPromises);

        // 2. Process blocks sequentially
        for (const item of blocksAndContent) {
            const { block, contentMap, elementsToType } = item;

            if (block.classList.contains('adventure-pause')) {
                const duration = parseFloat(block.dataset.duration || 0) * 1000;
                if (duration > 0) await this.#sleep(duration);
                continue;
            }

            // Append one block at a time
            messageEl.appendChild(block);
            block.style.opacity = 0; // Set opacity just before animating
            block.classList.add("adventure-fade-in");

            await this.#sleep(400); // Wait for fade-in animation

            for (const element of elementsToType) {
                await this.#typewriter(element, contentMap.get(element));
            }
        }

        this.#isAnimating = false;
        this.updateInputState(false);
    }
    
    #renderSceneMLOutput(sceneNode, msg, index = -1) {
        const fragment = document.createDocumentFragment();
        for (const node of Array.from(sceneNode.children)) {
            const block = this.#createSceneMLBlock(node, msg, index);
            if (block) fragment.appendChild(block);
        }
        return fragment;
    }

    #createSceneMLBlock(node, msg, index = -1) {
        let block;
        switch (node.nodeName.toLowerCase()) {
            case "narrate": block = document.createElement("div"); block.className = "adventure-block adventure-narrate"; block.appendChild(this.#renderInlineContent(node)); break;
            case "dialogue": block = this.#createDialogueBlock(node); break;
            case "image": block = this.#createImageBlock(node, msg, index); break;
            case "prompt": block = document.createElement("div"); block.className = "adventure-block adventure-prompt collapsed"; this.#populatePromptBlock(block, node, msg, index); break;
            case "pause": block = document.createElement("div"); block.className = "adventure-block adventure-pause"; block.dataset.duration = node.getAttribute("for") || "0"; break;
            default: return null;
        }
        return block;
    }

    #createImageBlock(node, msg, index = -1) {
        const block = document.createElement("div");
        block.className = "adventure-block adventure-image";
        const character = this.#findCharacter(node.getAttribute("from"));
        const imageItem = character?.gallery?.find(item => item.src === node.getAttribute("src"));
        if (imageItem?.url) {
            const imgContainer = document.createElement("div");
            imgContainer.className = "adventure-image-container";
            const img = document.createElement("img");
            img.className = "adventure-image-display";
            img.onload = () => {
                block.classList.add(img.naturalWidth / img.naturalHeight < 1 ? 'layout-side-by-side' : 'layout-overlay');
            };
            img.src = imageItem.url;
            img.alt = imageItem.alt || `Image from ${character.name}`;
            imgContainer.appendChild(img);
            block.appendChild(imgContainer);
        }
        const contentContainer = document.createElement("div");
        contentContainer.className = "adventure-image-content";
        contentContainer.appendChild(this.#renderSceneMLOutput(node, msg, index));
        block.appendChild(contentContainer);
        return block;
    }

    #populatePromptBlock(block, promptNode, msg, index = -1) {
        const header = document.createElement("div"); header.className = "adventure-prompt-header";
        const body = document.createElement("div"); body.className = "adventure-prompt-body";
        const msgIndex = index > -1 ? index : this.chat.messages.findIndex(m => m.id === msg.id);
        const isAnswered = this.chat.messages[msgIndex + 1]?.role === "user" && this.chat.messages[msgIndex + 1].content.startsWith("<choice>");
        for (const child of Array.from(promptNode.children)) {
            if (child.nodeName.toLowerCase() === "info") { const p = document.createElement("p"); p.className = "adventure-prompt-info"; p.textContent = child.textContent; body.appendChild(p); }
        }
        if (isAnswered) {
            block.classList.add("answered");
            header.innerHTML = `<span>Player Choice (Answered)</span><span class="material-icons expand-icon">unfold_more</span>`;
        } else {
            block.classList.add("unanswered");
            header.innerHTML = `<span>Player Choice</span><span class="material-icons expand-icon">unfold_more</span>`;
            for (const child of Array.from(promptNode.children)) {
                if (child.nodeName.toLowerCase() === "choice") {
                    const button = document.createElement("button");
                    button.className = "adventure-choice-button button-secondary";
                    button.dataset.action = "adventure-choice";
                    button.dataset.choiceText = child.textContent;
                    button.textContent = child.textContent;
                    body.appendChild(button);
                }
            }
            if (this.#lastUnansweredPromptEl && this.#lastUnansweredPromptEl !== block) { this.#lastUnansweredPromptEl.classList.add("collapsed"); const icon = this.#lastUnansweredPromptEl.querySelector(".expand-icon"); if (icon) icon.textContent = "unfold_more"; }
            this.#lastUnansweredPromptEl = block;
        }
        block.appendChild(header); block.appendChild(body);
    }

    #createDialogueBlock(dialogueNode) {
        const block = document.createElement("div");
        block.className = "adventure-block adventure-dialogue";
        const speaker = this.#findCharacter(dialogueNode.getAttribute("id")?.trim());
        const speakerName = speaker?.name || dialogueNode.getAttribute("id") || 'Narrator';
        const avatarUrl = speaker?.avatarUrl || (dialogueNode.getAttribute("id") ? null : "assets/images/system_icon.svg");
        const nameEl = document.createElement("div"); nameEl.className = "adventure-speaker-name"; nameEl.textContent = speakerName;
        let avatarEl = null;
        if (avatarUrl) { avatarEl = document.createElement("img"); avatarEl.className = "adventure-speaker-avatar"; avatarEl.src = avatarUrl; avatarEl.alt = speakerName; }
        const contentEl = document.createElement("div"); contentEl.className = "adventure-dialogue-content";
        const speechContainer = document.createElement("div"); speechContainer.className = "adventure-speech-container";
        for (const child of Array.from(dialogueNode.childNodes)) {
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            const childName = child.nodeName.toLowerCase();
            if (childName === "speech") {
                const speechPart = document.createElement("span");
                speechPart.className = "adventure-speech";
                const tone = child.getAttribute("tone");
                if (tone) speechPart.classList.add(`adventure-speech-${tone}`);
                speechPart.appendChild(this.#renderInlineContent(child));
                speechContainer.appendChild(speechPart);
            } else if (childName === "pause") { speechContainer.appendChild(child.cloneNode(true)); }
        }
        contentEl.appendChild(speechContainer); block.appendChild(nameEl); if (avatarEl) block.appendChild(avatarEl); block.appendChild(contentEl);
        return block;
    }

    #renderInlineContent(element) {
        const fragment = document.createDocumentFragment();
        for (const child of Array.from(element.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) fragment.appendChild(document.createTextNode(child.textContent));
            else if (child.nodeType === Node.ELEMENT_NODE) {
                const nodeName = child.nodeName.toLowerCase();
                if (nodeName === "ref") {
                    const charId = child.getAttribute("id");
                    const charInList = this.#findCharacter(charId);
                    const displayName = charInList?.name || child.textContent || charId;
                    const avatarUrl = charInList?.avatarUrl || "assets/images/default_avatar.svg";
                    const wrapper = document.createElement(charInList ? "a" : "span");
                    wrapper.href = "#";
                    wrapper.className = `adventure-char-ref ${charInList ? "" : "non-interactive"}`;
                    if (charInList) { wrapper.dataset.action = "navigate-to-character"; wrapper.dataset.characterId = charId; }
                    wrapper.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" class="adventure-char-avatar"><span class="adventure-char-link-text">${displayName}</span>`;
                    fragment.appendChild(wrapper);
                } else if (nodeName === "pause") {
                    fragment.appendChild(child.cloneNode(true));
                } else {
                    const genericWrapper = document.createElement(child.nodeName);
                    genericWrapper.appendChild(this.#renderInlineContent(child));
                    fragment.appendChild(genericWrapper);
                }
            }
        }
        return fragment;
    }

    #renderMessageControlsHTML(msg) {
        const isLastMessage = this.chat.messages.at(-1)?.id === msg.id;
        return `<div class="message-controls">
            <button type="button" class="icon-btn" title="Copy" data-action="copy"><span class="material-icons">content_copy</span></button>
            <button type="button" class="icon-btn" title="Branch" data-action="branch"><span class="material-icons">call_split</span></button>
            ${msg.role === "assistant" || (msg.role === "user" && isLastMessage) ? `<button type="button" class="icon-btn" title="Regenerate" data-action="regenerate"><span class="material-icons">replay</span></button>` : ""}
            <button type="button" class="icon-btn" title="Edit (Ctrl+Enter to save)" data-action="edit"><span class="material-icons">edit</span></button>
            <button type="button" class="icon-btn" title="Delete" data-action="delete"><span class="material-icons">delete</span></button>
        </div>`;
    }

    #escapeHtml(str) { const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

    render() {
        super._initShadow(`
            <div id="chat-history"></div>
            <form id="chat-form">
                <button id="quick-regen-btn" type="button" title="Regenerate Last Response"><span class="material-icons">replay</span></button>
                <text-box name="message" placeholder="Type your message... (Ctrl+Enter to send)"></text-box>
                <button type="submit" class="send-button" title="Send" disabled><span class="material-icons">send</span></button>
            </form>
        `, this.styles());
    }

    styles() {
        return `
            :host { display: flex; flex-direction: column; height: 100%; position: relative; }
            #chat-history { flex-grow: 1; overflow-y: auto; padding: var(--spacing-xl); }
            #chat-form { display: flex; padding: var(--spacing-md); gap: var(--spacing-md); border-top: 1px solid var(--bg-3); background-color: var(--bg-1); flex-shrink: 0; }
            #quick-regen-btn { flex-shrink: 0; width: 48px; height: 48px; border: none; background-color: var(--bg-2); color: var(--text-secondary); border-radius: var(--radius-md); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: var(--transition-fast); }
            #quick-regen-btn:hover { background-color: var(--bg-3); color: var(--text-primary); }
            #quick-regen-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; }
            #quick-regen-btn .material-icons { font-size: 24px; }
            text-box { flex-grow: 1; min-height: 48px; max-height: 200px; padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--bg-3); background-color: var(--bg-0); font-family: var(--font-family); }
            .send-button { flex-shrink: 0; width: 48px; height: 48px; border: none; background-color: var(--accent-primary); color: var(--bg-0); border-radius: var(--radius-md); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color var(--transition-fast); }
            .send-button:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; }
            .send-button.stop-button { background-color: var(--accent-danger); }
            .send-button.stop-button:hover { opacity: 0.9; }
            
            .chat-message { margin-bottom: var(--spacing-md); display: flex; flex-direction: column; gap: var(--spacing-xs); position: relative; max-width: 800px; margin-left: auto; margin-right: auto; }
            .chat-message.assistant.adventure-mode .message-controls { display: flex; justify-content: flex-end; width: 100%; padding-right: var(--spacing-md); opacity: 0; transition: var(--transition-fast); }
            .chat-message.assistant.adventure-mode:hover .message-controls { opacity: 1; }
            .chat-message:not(.assistant.adventure-mode) { display: flex; gap: var(--spacing-md); max-width: 100%; }
            .chat-message .avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-top: 5px; background-color: var(--bg-3); }
            .chat-message.system { margin: 0 auto; color: var(--text-secondary); max-width: 100%; }
            .chat-message.system .message-bubble { background: none; }
            .message-bubble { background-color: var(--bg-1); border-radius: var(--radius-md); padding: var(--spacing-sm) var(--spacing-md); flex-grow: 1; position: relative; }
            .chat-message.user .message-bubble { background-color: var(--accent-primary); color: var(--bg-0); }
            .chat-message.user .message-bubble .icon-btn { color: var(--bg-1); }
            .message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-xs); gap: var(--spacing-md); }
            .author-name { font-weight: 600; }
            .message-header .message-controls { opacity: 0; }
            .message-bubble:hover .message-controls { opacity: 1; }
            .message-bubble text-box, .adventure-dialogue-content text-box, .chat-message.assistant.adventure-mode > text-box { outline: 1px solid var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-faded); border-radius: var(--radius-sm); padding: var(--spacing-sm); background-color: var(--bg-0); color: white; }
            .message-controls .icon-btn .material-icons { font-size: 1.1rem; }
            .icon-btn { background: transparent; border: none; cursor: pointer; color: var(--text-secondary); padding: 0; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; }
            .icon-btn:hover { color: var(--text-primary); }
            .icon-btn .material-icons { font-family: 'Material Icons'; font-size: 18px; line-height: 1; vertical-align: middle; transition: color var(--transition-fast); }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            .adventure-fade-in { animation: fadeIn 0.4s ease-out both; }
            
            .adventure-parse-error { border: 2px solid var(--accent-danger); background: rgba(242, 139, 130, 0.1); padding: var(--spacing-md); border-radius: var(--radius-md); margin-top: var(--spacing-md); }
            .adventure-parse-error pre { background: var(--bg-0); padding: var(--spacing-sm); border-radius: var(--radius-sm); white-space: pre-wrap; word-break: break-all; }
            .adventure-block { padding-top: 0; transition: opacity 0.4s ease-out; }
            .adventure-narrate { font-style: italic; color: var(--text-secondary); text-align: justify; padding: var(--spacing-sm) 0; }
            .adventure-dialogue { display: grid; grid-template-areas: "avatar name" "avatar content"; grid-template-columns: auto 1fr; grid-template-rows: auto 1fr; gap: 0 var(--spacing-md); }
            .adventure-speaker-avatar { border-radius: var(--radius-md); object-fit: cover; background-color: var(--bg-3); grid-area: avatar; column-span: 1; height: 128px; width: 96px; cursor: pointer; }
            .adventure-dialogue-content { grid-area: content; }
            .adventure-speaker-name { font-size: 1.2rem; font-weight: 600; color: var(--text-primary); grid-area: name; padding-bottom: var(--spacing-xs); border-bottom: 1px solid var(--bg-3); margin-bottom: var(--spacing-sm); }
            .adventure-speech-container { line-height: 1.6; }
            .adventure-speech { display: inline; animation: fadeIn 0.3s ease-out both; opacity: 0; }
            .adventure-speech:not(:first-child)::before { content: ' '; }
            .adventure-speech-yell { text-transform: uppercase; font-weight: bold; }
            .adventure-speech-whisper { font-style: italic; color: var(--text-secondary); }
            .adventure-prompt { border-radius: var(--radius-md); background-color: var(--bg-1); color: var(--text-primary); position: relative; }
            .adventure-prompt-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: var(--spacing-sm) var(--spacing-md); background-color: var(--bg-2); border-radius: var(--radius-sm); user-select: none; }
            .adventure-prompt-header .expand-icon { font-size: 1.5rem; }
            .adventure-prompt.collapsed .adventure-prompt-body { display: none; }
            .adventure-prompt-body { display: flex; flex-direction: column; gap: var(--spacing-sm); padding: var(--spacing-md); }
            .adventure-prompt-info { margin-bottom: var(--spacing-sm); }
            .adventure-choice-button { user-select: none; width: 100%; }
            .adventure-char-ref { display: inline-flex; align-items: center; gap: 0px; background: var(--bg-2); padding: 2px 4px; border-radius: var(--radius-sm); color: var(--text-primary); text-decoration: none; font-weight: 500; line-height: 1; vertical-align: middle; }
            .adventure-char-ref.non-interactive { cursor: default; }
            a.adventure-char-ref:hover { text-decoration: none; color: var(--accent-primary); background-color: var(--bg-3); }
            a.adventure-char-ref:hover .adventure-char-link-text { text-decoration: underline; }
            .adventure-char-avatar { width: 1.2em; height: 1.2em; border-radius: 50%; object-fit: cover; margin-right: 4px; }
            .adventure-char-link-text { line-height: 1; }
            
            .adventure-image { display: grid; border-radius: var(--radius-md); overflow: hidden; }
            .adventure-image.layout-overlay { grid-template-columns: 1fr; grid-template-rows: auto; }
            .adventure-image.layout-side-by-side { grid-template-columns: 200px 1fr; }
            .adventure-image-container { grid-area: 1 / 1; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; background-color: var(--bg-0); }
            .adventure-image-display { width: 100%; height: 100%; object-fit: cover; cursor: pointer; flex-grow: 1; }
            .adventure-image-content { grid-area: 1 / 1; z-index: 1; display: flex; flex-direction: column; justify-content: flex-end; }
            .adventure-image.layout-side-by-side .adventure-image-content { grid-area: 1 / 2; }
            .adventure-image.layout-overlay .adventure-image-content { padding: var(--spacing-md); background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.6) 50%, transparent 100%); }
            .adventure-image.layout-side-by-side .adventure-image-content { padding: var(--spacing-md); }
            .adventure-image-content .adventure-block { color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.8); flex: 1; }
            .adventure-image-content .adventure-dialogue { backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); border-radius: var(--radius-md); align-self: flex-start; margin-bottom: var(--spacing-sm); }
            .adventure-image-content .adventure-dialogue .adventure-speaker-name { color: white; border-bottom-color: rgba(255,255,255,0.3); }

            @media (max-width: 768px) {
                #chat-history { padding: var(--spacing-md); }
                .chat-message .message-controls, .chat-message.assistant.adventure-mode .message-controls { opacity: 1; pointer-events: auto; }
                .adventure-block { margin-bottom: var(--adventure-block-gap, var(--spacing-sm)); }
                .adventure-narrate { font-size: var(--font-size-md); }
                .adventure-dialogue { gap: var(--spacing-xs) var(--spacing-sm); }
                .adventure-speaker-avatar { border-radius: var(--radius-sm); }
                .adventure-speaker-avatar img { width: 100%; height: auto; border-radius: var(--radius-sm); }
                .adventure-speaker-name { font-size: 1.1rem; }
                .adventure-speech { font-size: var(--font-size-md); }
                .adventure-prompt-body { padding: var(--spacing-sm); gap: var(--spacing-xs); }
                .adventure-prompt-info { font-size: var(--font-size-md); }
                .adventure-choice-button { padding: 0.5rem 1rem; font-size: var(--font-size-md); }
                .adventure-image.layout-side-by-side { grid-template-columns: 1fr; } /* Stack side-by-side on mobile */
                .adventure-image.layout-side-by-side .adventure-image-content { grid-area: auto; padding-left: 0; padding-right: 0; }
            }
        `;
    }
}

customElements.define("adventure-chat-mode", AdventureChatMode);
chatModeRegistry.register("adventure", "adventure-chat-mode");