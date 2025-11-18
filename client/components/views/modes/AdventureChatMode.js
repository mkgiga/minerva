import { BaseChatMode } from "./BaseChatMode.js";
import { chatModeRegistry } from "../../../ChatModeRegistry.js";
import { notifier, uuidv4, imagePreview } from "../../../client.js";
import "../../common/TextBox.js";
import "../../common/Spinner.js";
import "../../common/DropdownMenu.js";

export class AdventureChatMode extends BaseChatMode {
    #historyContainer = null;
    #form = null;
    #textbox = null;
    #sendButton = null;
    #quickRegenButton = null;
    #goToParentButton = null;
    #personaNameEl = null;
    #lastUnansweredPromptEl = null;
    #isAnimating = false;
    #justAnimatedMessageIds = new Set();
    #settings = {};
    #streamingContent = new Map();
    #strippedHistory = [];
    #isLoadingHistory = false;
    #personaModal = null;
    #personaSearchInput = null;
    #personaCharacterList = null;
    #personaAvatarImg = null;

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
            blockGap: 0.75, // Reduced from 1.5 for more compact layout
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

        if (!parserError) {
            return doc;
        }
        
        console.warn("SceneML parsing failed, attempting repair. Error:", parserError.textContent);

        const customBlocks = [];
        const protectedContent = processedContent.replace(/<custom>[\s\S]*?<\/custom>/g, match => {
            customBlocks.push(match);
            return `<!--CUSTOM_BLOCK_${customBlocks.length - 1}-->`;
        });

        const tagNames = ["scene", "narrate", "dialogue", "speech", "image", "prompt", "info", "choice", "ref", "pause", "custom"];
        
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
        
        let repairedProtectedContent = protectedContent.replace(/(<\/?)([\w-]+)(.*?>)/g, (match, opening, tagName, rest) => {
            if (tagNames.includes(tagName.toLowerCase())) return match;
            const bestMatch = findBestMatch(tagName);
            if (bestMatch) {
                console.log(`Repairing SceneML tag: '${tagName}' -> '${bestMatch}'`);
                return `${opening}${bestMatch}${rest}`;
            }
            return match;
        });

        let finalRepairedContent = repairedProtectedContent.replace(/<!--CUSTOM_BLOCK_(\d+)-->/g, (match, index) => {
            return customBlocks[parseInt(index, 10)];
        });

        doc = parser.parseFromString(finalRepairedContent, "application/xml");
        parserError = doc.querySelector("parsererror");
        
        if (parserError) {
            console.error("SceneML repair failed after attempting fixes. Final error:", parserError.textContent);
            return parser.parseFromString(processedContent, "application/xml");
        } else {
            console.log("SceneML repair successful.");
        }

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
        this.#goToParentButton = this.shadowRoot.querySelector("#go-to-parent-btn");
        this.#personaModal = this.shadowRoot.querySelector("#persona-modal");
        this.#personaSearchInput = this.shadowRoot.querySelector("#persona-search-input");
        this.#personaCharacterList = this.shadowRoot.querySelector("#persona-character-list");
        this.#personaAvatarImg = this.shadowRoot.querySelector("#user-persona-avatar");
        this.#personaNameEl = this.shadowRoot.querySelector("#user-persona-name");

        this.#settings = this.settings;
        this.#applySettings();

        this.#form.addEventListener("submit", this.#handleSend.bind(this));
        this.#sendButton.addEventListener("click", this.#handleSend.bind(this));
        this.#textbox.addEventListener("keydown", this.#handleTextboxKeydown.bind(this));
        this.#textbox.addEventListener("input", () => { if (!this.isSending) this.#sendButton.disabled = this.#textbox.value.trim() === ""; });
        if (this.#quickRegenButton) this.#quickRegenButton.addEventListener("click", this.#handleQuickRegen.bind(this));
        if (this.#goToParentButton) this.#goToParentButton.addEventListener("click", () => this.goToParentChat());
        this.#historyContainer.addEventListener("click", this.#handleHistoryClick.bind(this));

        // Persona modal event listeners
        this.shadowRoot.querySelector("#user-persona-btn").addEventListener("click", () => this.#openPersonaModal());
        this.shadowRoot.querySelector("#close-persona-modal-btn").addEventListener("click", () => this.#closePersonaModal());
        this.#personaModal.addEventListener("click", (e) => { if (e.target === this.#personaModal) this.#closePersonaModal(); });
        this.#personaSearchInput.addEventListener("input", () => this.#renderPersonaList());
        this.#personaCharacterList.addEventListener("click", (e) => this.#handlePersonaSelection(e));

        this.#updatePersonaAvatar();
        this.#rebuildStrippedHistory();
    }

    onSettingsChanged(newSettings) {
        this.#settings = { ...this.#settings, ...newSettings };
        this.#applySettings();
    }

    #applySettings() { this.style.setProperty("--adventure-block-gap", `${this.#settings.blockGap}rem`); }
    onChatSwitched() { this.refreshChatHistory(); this.#rebuildStrippedHistory(); }
    onChatBranched() { this.#rebuildStrippedHistory(); }
    onParticipantsChanged() { this.refreshChatHistory(); }
    onAllCharactersChanged() { this.refreshChatHistory(); }
    onUserPersonaChanged() { this.refreshChatHistory(); this.#updatePersonaAvatar(); }

    onMessagesAdded(addedMessages) {
        this.#rebuildStrippedHistory();
        const optimisticUserEl = this.shadowRoot.querySelector('.optimistic-user-message');
        const optimisticAssistantEl = this.shadowRoot.querySelector('.optimistic-assistant-message');

        // Handle normal prompt (user + assistant messages)
        if (optimisticUserEl && optimisticAssistantEl && addedMessages.length >= 2) {
            const finalUserMsg = addedMessages.at(-2);
            const finalAssistantMsg = addedMessages.at(-1);
            const tempAssistantId = optimisticAssistantEl.dataset.messageId;

            // The onStreamFinish handler flags the temporary ID to prevent re-renders during animation.
            // We must transfer this flag to the new permanent ID that we receive from the server
            // to ensure the guard in onMessageUpdated works correctly later.
            if (this.#justAnimatedMessageIds.has(tempAssistantId)) {
                this.#justAnimatedMessageIds.delete(tempAssistantId);
                this.#justAnimatedMessageIds.add(finalAssistantMsg.id);
            }

            // Update the optimistic user message with its final server-confirmed content and ID.
            this.#updateMessageContent(optimisticUserEl, finalUserMsg);

            // Update the optimistic assistant message element's ID to its permanent one.
            // We do *not* update its content here, as the animation is handling that.
            optimisticAssistantEl.dataset.messageId = finalAssistantMsg.id;

            // Clean up the optimistic classes now that messages have been updated
            optimisticUserEl.classList.remove('optimistic-user-message');
            optimisticAssistantEl.classList.remove('optimistic-assistant-message');
        }
        // Handle regeneration (only assistant message)
        else if (optimisticAssistantEl && addedMessages.length === 1 && addedMessages[0].role === 'assistant') {
            const finalAssistantMsg = addedMessages[0];
            const tempAssistantId = optimisticAssistantEl.dataset.messageId;

            if (this.#justAnimatedMessageIds.has(tempAssistantId)) {
                this.#justAnimatedMessageIds.delete(tempAssistantId);
                this.#justAnimatedMessageIds.add(finalAssistantMsg.id);
            }

            optimisticAssistantEl.dataset.messageId = finalAssistantMsg.id;
            optimisticAssistantEl.classList.remove('optimistic-assistant-message');
        }
        else {
            // Fallback if we can't find the optimistic elements. This will kill any running animation,
            // but prevents the UI from getting into a stuck state.
            // Only refresh if not currently animating to avoid interrupting the typewriter effect
            if (!this.#isAnimating) {
                this.refreshChatHistory();
            }
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

    onHistoryLoading(isLoading) {
        this.#isLoadingHistory = isLoading;
        this.#renderHistoryLoader();
    }

    onHistoryLoaded(newMessages, hasMore) {
        if (newMessages.length === 0) {
            this.#isLoadingHistory = false;
            this.#renderHistoryLoader();
            return;
        }

        const fragment = document.createDocumentFragment();
        const container = this.#historyContainer;
        const oldScrollHeight = container.scrollHeight;
        const oldScrollTop = container.scrollTop;

        for (const msg of newMessages) {
            const messageEl = this.#createMessageElement(msg);
            this.#updateMessageContent(messageEl, msg, -1);
            fragment.appendChild(messageEl);
        }

        const loaderContainer = this.shadowRoot.querySelector('#history-loader-container');
        loaderContainer.after(fragment);

        // Restore scroll position to keep view stable
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);

        // Rebuild stripped history to include newly loaded messages for AI context
        this.#rebuildStrippedHistory();

        this.#isLoadingHistory = false;
        this.#renderHistoryLoader();
    }

    onPromptStart(userMessage) {
        const userEl = this.appendMessage(userMessage);
        if (userEl) userEl.classList.add('optimistic-user-message');
        const assistantSpinnerMessage = { id: `assistant-${uuidv4()}`, role: "assistant", content: '<minerva-spinner mode="infinite"></minerva-spinner>', timestamp: new Date().toISOString() };
        const assistantEl = this.appendMessage(assistantSpinnerMessage);
        if (assistantEl) assistantEl.classList.add('optimistic-assistant-message');
        this.clearUserInput();
        return assistantSpinnerMessage.id;
    }

    onRegenerateStart(messageId) {
        const messageData = this.getMessageById(messageId);
        if (!messageData) return null;

        if (messageData.role === "assistant") {
            // For assistant messages, update the existing element to show spinner
            const messageEl = this.shadowRoot.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                this.#updateMessageContent(messageEl, {
                    ...messageData,
                    content: '<minerva-spinner mode="infinite"></minerva-spinner>'
                });
                return messageId; // Return the same message ID since we're updating in place
            }
            // Fallback: if we can't find the element, refresh and try again
            console.warn(`Could not find message element for ${messageId}, refreshing chat history`);
            this.refreshChatHistory();
            const retryEl = this.shadowRoot.querySelector(`[data-message-id="${messageId}"]`);
            if (retryEl) {
                this.#updateMessageContent(retryEl, {
                    ...messageData,
                    content: '<minerva-spinner mode="infinite"></minerva-spinner>'
                });
                return messageId;
            }
            return null;
        } else if (messageData.role === "user") {
            // For user messages, create a new assistant spinner
            const assistantSpinnerMessage = {
                id: `assistant-${uuidv4()}`,
                role: "assistant",
                content: '<minerva-spinner mode="infinite"></minerva-spinner>',
                timestamp: new Date().toISOString()
            };
            const assistantEl = this.appendMessage(assistantSpinnerMessage);
            if (assistantEl) assistantEl.classList.add('optimistic-assistant-message');
            return assistantSpinnerMessage.id;
        }

        return null;
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
            console.log('[AdventureChatMode] Sending prompt with message history:', {
                strippedHistoryLength: this.#strippedHistory.length,
                totalChatMessages: this.chat?.messages?.length,
                firstMessageId: this.#strippedHistory[0]?.id,
                lastMessageId: this.#strippedHistory[this.#strippedHistory.length - 1]?.id
            });
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

    #openPersonaModal() {
        this.#renderPersonaList();
        this.#personaModal.style.display = 'flex';
    }

    #closePersonaModal() {
        this.#personaModal.style.display = 'none';
        this.#personaSearchInput.value = '';
    }

    #renderPersonaList() {
        const searchTerm = this.#personaSearchInput.value.toLowerCase();
        const filteredCharacters = this.allCharacters.filter(char =>
            char.name.toLowerCase().includes(searchTerm)
        );

        this.#personaCharacterList.innerHTML = filteredCharacters.map(char => {
            const isCurrentPersona = this.userPersona?.id === char.id;
            const avatarUrl = char.avatarUrl || 'assets/images/default_avatar.svg';

            return `
                <div class="character-item ${isCurrentPersona ? 'is-persona' : ''}" data-character-id="${char.id}">
                    <img src="${avatarUrl}" alt="${this.#escapeHtml(char.name)}">
                    <span class="character-name">${this.#escapeHtml(char.name)}</span>
                    ${isCurrentPersona ? '<span class="material-icons persona-icon">check_circle</span>' : ''}
                </div>
            `;
        }).join('');
    }

    #handlePersonaSelection(event) {
        const characterItem = event.target.closest('.character-item');
        if (!characterItem) return;

        const characterId = characterItem.dataset.characterId;

        // If clicking the current persona, clear it
        if (this.userPersona?.id === characterId) {
            this.setUserPersona(null);
        } else {
            this.setUserPersona(characterId);
        }

        this.#closePersonaModal();
    }

    #updatePersonaAvatar() {
        if (this.#personaAvatarImg) {
            const avatarUrl = this.userPersona?.avatarUrl || 'assets/images/default_avatar.svg';
            this.#personaAvatarImg.src = avatarUrl;
            this.#personaAvatarImg.alt = this.userPersona?.name || 'User Persona';
        }
        if (this.#personaNameEl) {
            this.#personaNameEl.textContent = this.userPersona?.name || 'Select Persona';
        }
    }

    #handleHistoryClick(event) {
        const loadMoreBtn = event.target.closest('#load-more-btn');
        if (loadMoreBtn) {
            this.loadMoreMessages();
            return;
        }
        
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
                }
                // Note: Message control actions are now handled by dropdown-menu events
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

        // Store menu button temporarily if it exists
        const menuButton = messageEl.querySelector('.message-menu-trigger');
        if (menuButton) menuButton.style.display = 'none';

        contentContainer.innerHTML = "";
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
            // Restore menu button
            if (menuButton) menuButton.style.display = '';
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
        if (this.#goToParentButton) this.#goToParentButton.style.display = this.chat && this.chat.parentId ? 'flex' : 'none';
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
            // Set animation flag immediately to prevent race conditions with server updates
            this.#isAnimating = true;
            this.#justAnimatedMessageIds.add(messageEl.dataset.messageId);
            await this.#animateSceneMLResponse(messageEl, { id: messageEl.dataset.messageId, role: "assistant", content: finalContent });
            // Note: optimistic-assistant-message class is removed in onMessagesAdded after IDs are updated
        } else {
            notifier.warning(`Failed to render response: Could not find message element (ID: ${messageId})`);
        }
        this.#streamingContent.delete(messageId);
    }

    onStreamError(error, messageId) {
        const content = error.name === "AbortError" ? `${this.#streamingContent.get(messageId) || ""}\n\n*Generation stopped by user.*` : `**Error:** Could not get response.\n*${error.message}*`;
        const messageEl = this.shadowRoot.querySelector('.optimistic-assistant-message') || this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
        if (messageEl) {
            this.#updateMessageContent(messageEl, { id: messageId, role: "assistant", content });
            messageEl.classList.remove('optimistic-assistant-message');
        }
        this.#streamingContent.delete(messageId);
        // Ensure animation flag is reset in case of error
        this.#isAnimating = false;
        this.updateInputState(false);
    }

    refreshChatHistory() {
        if (!this.#historyContainer || !this.chat) { this.#historyContainer.innerHTML = ""; return; }

        this.#historyContainer.innerHTML = '<div id="history-loader-container"></div>';
        this.#renderHistoryLoader();
        
        this.#lastUnansweredPromptEl = null;
        for (let i = 0; i < this.chat.messages.length; i++) this.appendMessage(this.chat.messages[i], false, i);
        
        if (this.#lastUnansweredPromptEl) {
            this.#lastUnansweredPromptEl.classList.remove("collapsed");
            const icon = this.#lastUnansweredPromptEl.querySelector(".expand-icon");
            if (icon) icon.textContent = "unfold_less";
        }
        
        setTimeout(() => { this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight; }, 0);
        this.updateInputState(this.isSending);
    }

    #renderHistoryLoader() {
        const container = this.shadowRoot.querySelector('#history-loader-container');
        if (!container) return;

        console.log('[AdventureChatMode] renderHistoryLoader:', {
            isLoadingHistory: this.#isLoadingHistory,
            hasMoreMessages: this.chat?.hasMoreMessages,
            totalMessages: this.chat?.messages?.length,
            strippedHistoryLength: this.#strippedHistory?.length
        });

        if (this.#isLoadingHistory) {
            container.innerHTML = '<div class="loader-wrapper"><minerva-spinner></minerva-spinner></div>';
        } else if (this.chat?.hasMoreMessages) {
            container.innerHTML = '<div class="loader-wrapper"><button id="load-more-btn" class="button-secondary">Load Older Messages</button></div>';
        } else {
            container.innerHTML = '';
        }
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
            messageEl.innerHTML = `${avatarHTML}<div class="message-bubble"><div class="message-header"><span class="author-name">${authorName}</span></div><div class="message-content">${content}</div></div>`;

            // Add menu button to header
            const menuButton = this.#createMessageMenuButton(msg);
            messageEl.querySelector('.message-header').appendChild(menuButton);
        } else {
            const content = msg.content || "";
            if (content.includes("<minerva-spinner")) {
                messageEl.className = "chat-message assistant adventure-mode";
                messageEl.innerHTML = `<div class="message-content">${content}</div>`;
                const menuButton = this.#createMessageMenuButton(msg);
                menuButton.classList.add('adventure-menu');
                messageEl.appendChild(menuButton);
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
                messageEl.innerHTML = `<img src="${avatarUrl}" alt="${authorName}" class="avatar"><div class="message-bubble"><div class="message-header"><span class="author-name">${authorName}</span></div><div class="message-content">${this.#escapeHtml(content).replace(/\n/g, "<br>")}</div></div>`;

                // Add menu button to header
                const menuButton = this.#createMessageMenuButton(msg);
                messageEl.querySelector('.message-header').appendChild(menuButton);

                if (parserError) {
                    const errorDetails = document.createElement("div");
                    errorDetails.className = "adventure-parse-error";
                    errorDetails.innerHTML = "<strong>Parse Error:</strong><pre>" + this.#escapeHtml(parserError.textContent) + "</pre>";
                    messageEl.querySelector(".message-bubble").appendChild(errorDetails);
                }
            } else {
                messageEl.className = "chat-message assistant adventure-mode";
                messageEl.appendChild(this.#renderSceneMLOutput(sceneNode, msg, index));

                // Add menu button
                const menuButton = this.#createMessageMenuButton(msg);
                menuButton.classList.add('adventure-menu');
                messageEl.appendChild(menuButton);
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
        // Note: #isAnimating is already set to true in onStreamFinish before calling this
        this.updateInputState(this.isSending);
        messageEl.innerHTML = "";

        const doc = this.#tryRepairSceneML(msg.content || "");
        const sceneNode = doc?.querySelector("scene");
        if (!sceneNode) { this.#updateMessageContent(messageEl, msg); this.#isAnimating = false; this.updateInputState(false); return; }

        messageEl.className = "chat-message assistant adventure-mode";

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

        // Add menu button after animation completes
        const menuButton = this.#createMessageMenuButton(msg);
        menuButton.classList.add('adventure-menu');
        messageEl.appendChild(menuButton);

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
            case "custom": block = this.#createCustomBlock(node); break;
            default: return null;
        }
        return block;
    }

    #createCustomBlock(node) {
        const block = document.createElement("div");
        block.className = "adventure-block adventure-custom";
    
        const htmlNode = node.querySelector("custom-html");
        const cssNode = node.querySelector("custom-css");
        const scriptNode = node.querySelector("custom-script");
    
        if (!htmlNode) {
            block.innerHTML = `<div class="adventure-parse-error"><strong>Render Error:</strong> &lt;custom&gt; tag must contain a &lt;custom-html&gt; child.</div>`;
            return block;
        }
    
        // --- API for Custom Scripts ---
        const minervaApi = {
            prompt: (text = '') => {
                if (!this.isSending && !this.#isAnimating) {
                    this.#handleSend({ preventDefault: () => {}, target: { value: text } });
                } else {
                    console.warn('Minerva API: Cannot send prompt while a request is in progress or an animation is playing.');
                }
            },
            canPrompt: () => !this.isSending && !this.#isAnimating,
            getCharacter: (idOrName) => {
                const char = this.#findCharacter(idOrName);
                return char ? JSON.parse(JSON.stringify(char)) : null;
            },
            getParticipants: () => {
                const participants = this.chat?.participants || [];
                const participantObjects = participants.map(p => {
                    const id = typeof p === 'string' ? p : p.id;
                    return this.#findCharacter(id);
                }).filter(Boolean);
                return JSON.parse(JSON.stringify(participantObjects));
            },
            getPlayer: () => {
                return this.userPersona ? JSON.parse(JSON.stringify(this.userPersona)) : null;
            },
            dispatchEvent: (eventName, detail) => {
                block.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true, composed: true }));
            }
        };
        block.minerva = minervaApi;
        // ----------------------------

        const shadow = block.attachShadow({ mode: 'open' });
    
        const htmlContent = htmlNode.innerHTML || '';
        const cssContent = cssNode?.textContent || '';
        const scriptContent = scriptNode?.textContent || '';
    
        shadow.innerHTML = `
            <style>
                :host {
                    /* Inherit global variables for styling consistency */
                    --bg-0: #202124; --bg-1: #282a2e; --bg-2: #323639; --bg-3: #3c4043;
                    --text-primary: #e8eaed; --text-secondary: #bdc1c6; --text-disabled: #9aa0a6;
                    --accent-primary: #8ab4f8; --accent-primary-faded: rgba(138, 180, 248, 0.3);
                    --accent-good: #69f0ae; --accent-warn: #ffd54f; --accent-danger: #f28b82;
                    --font-family: "Inter", sans-serif;
                    --font-size-sm: 0.875rem; --font-size-md: 1rem;
                    --radius-sm: 4px; --radius-md: 8px;
                    --spacing-xs: 0.25rem; --spacing-sm: 0.5rem; --spacing-md: 1rem; --spacing-lg: 1.5rem;
                    --transition-fast: all 0.15s ease-in-out;
                }
                ${cssContent}
            </style>
            ${htmlContent}
        `;
    
        if (scriptContent) {
            const script = document.createElement('script');
            // Prepend the API accessor and wrap in a try-catch for safety
            script.textContent = `
                const minerva = document.currentScript.getRootNode().host.minerva;
                try {
                    ${scriptContent}
                } catch (e) {
                    console.error('Error in <custom-script>:', e);
                    const errorDiv = document.createElement('div');
                    errorDiv.style.cssText = 'color: var(--accent-danger); border: 1px solid var(--accent-danger); background-color: rgba(242, 139, 130, 0.1); padding: var(--spacing-sm); margin-top: var(--spacing-sm); border-radius: var(--radius-sm); font-family: monospace; white-space: pre-wrap;';
                    errorDiv.textContent = 'Script Error: ' + e.message;
                    document.currentScript.getRootNode().appendChild(errorDiv);
                }
            `;
            shadow.appendChild(script);
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
        // FIX: Ensure expressionName is safely parsed and defaults to null if attribute is missing
        const expressionAttr = dialogueNode.getAttribute("expression");
        const expressionName = expressionAttr ? expressionAttr.trim().toLowerCase() : null;
        
        let avatarUrl = speaker?.avatarUrl || (dialogueNode.getAttribute("id") ? null : "assets/images/system_icon.svg");

        if (expressionName && speaker?.expressions?.length > 0) {
            // FIX: Make the find condition more robust against whitespace in saved data.
            const expression = speaker.expressions.find(e => e.name?.trim().toLowerCase() === expressionName);
            if (expression) {
                avatarUrl = expression.url;
            }
        }

        const nameEl = document.createElement("div"); nameEl.className = "adventure-speaker-name"; nameEl.textContent = speakerName;
        let avatarEl = null;
        if (avatarUrl) { 
            avatarEl = document.createElement("img"); 
            avatarEl.className = "adventure-speaker-avatar"; 
            avatarEl.src = avatarUrl; 
            avatarEl.alt = speakerName; 
        }
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

    /**
     * Shows a dropdown menu at the position of the trigger element
     * @param {HTMLElement} triggerElement - The element that triggered the dropdown
     * @param {Array} items - Array of menu items with structure:
     *   { icon: 'icon_name', label: 'Label', callback: function, danger: boolean }
     *   { separator: true } for dividers
     */
    showDropdown(triggerElement, items) {
        // Check if dropdown already exists and remove it
        const existingDropdown = this.shadowRoot.querySelector('dropdown-menu');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        // Create new dropdown
        const dropdown = document.createElement('dropdown-menu');

        // Convert items to dropdown format
        const dropdownItems = items.map(item => {
            if (item.separator) {
                return { divider: true };
            }
            return {
                icon: item.icon,
                label: item.label,
                action: item.label, // Use label as action identifier
                danger: item.danger || false
            };
        });

        dropdown.setItems(dropdownItems);

        // Handle menu actions
        dropdown.addEventListener('menu-action', (e) => {
            const actionLabel = e.detail.action;
            const item = items.find(i => i.label === actionLabel);
            if (item && item.callback) {
                item.callback();
            }
            // Remove dropdown after action
            dropdown.remove();
        });

        // Append to shadow root and open
        this.shadowRoot.appendChild(dropdown);
        dropdown.open(triggerElement);
    }

    #createMessageMenuButton(msg) {
        const button = document.createElement('button');
        button.className = 'message-menu-trigger';
        button.type = 'button';
        button.title = 'More options';
        button.innerHTML = '<span class="material-icons">more_vert</span>';

        button.addEventListener('click', (e) => {
            e.stopPropagation();

            const isLastMessage = this.chat.messages.at(-1)?.id === msg.id;
            const messageId = msg.id;

            const items = [
                {
                    icon: 'content_copy',
                    label: 'Copy',
                    callback: () => this.copyMessageContent(msg.content)
                },
                {
                    icon: 'call_split',
                    label: 'Branch',
                    callback: () => this.branchFromMessage(messageId)
                },
            ];

            if (msg.role === "assistant" || (msg.role === "user" && isLastMessage)) {
                items.push({
                    icon: 'replay',
                    label: 'Regenerate',
                    callback: () => this.regenerateMessage(messageId)
                });
            }

            items.push(
                {
                    icon: 'edit',
                    label: 'Edit',
                    callback: () => {
                        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
                        if (messageEl) this.#handleEditMessage(messageId, messageEl);
                    }
                },
                { separator: true },
                {
                    icon: 'delete',
                    label: 'Delete',
                    callback: () => this.deleteMessage(messageId),
                    danger: true
                }
            );

            this.showDropdown(button, items);
        });

        return button;
    }

    #escapeHtml(str) { const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

    render() {
        super._initShadow(`
            <div id="chat-history">
                <div id="history-loader-container"></div>
            </div>
            <div id="chat-input-container">
                <div id="chat-toolbar">
                    <button id="go-to-parent-btn" type="button" title="Go to Parent Chat" style="display: none;">
                        <span class="material-icons">arrow_upward</span>
                    </button>
                    <button id="quick-regen-btn" type="button" title="Regenerate Last Response">
                        <span class="material-icons">replay</span>
                    </button>
                    <div style="flex-grow: 1;"></div>
                    <button id="user-persona-btn" type="button" title="Change User Persona">
                        <span id="user-persona-name">Select Persona</span>
                        <img id="user-persona-avatar" src="assets/images/default_avatar.svg" alt="User Persona">
                    </button>
                </div>
                <form id="chat-form">
                    <text-box name="message" placeholder="Type your message... (Ctrl+Enter to send)"></text-box>
                    <button type="submit" class="send-button" title="Send" disabled><span class="material-icons">send</span></button>
                </form>
            </div>

            <!-- User Persona Selection Modal -->
            <div id="persona-modal" class="modal-backdrop">
                <div class="modal-content">
                    <header>
                        <h2>Select User Persona</h2>
                        <button id="close-persona-modal-btn" class="close-modal-btn" title="Close">
                            <span class="material-icons">close</span>
                        </button>
                    </header>
                    <div class="modal-body">
                        <div class="modal-search-bar">
                            <span class="material-icons">search</span>
                            <input type="text" id="persona-search-input" placeholder="Search for characters...">
                        </div>
                        <div id="persona-character-list" class="character-list"></div>
                    </div>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            :host { display: flex; flex-direction: column; height: 100%; position: relative; }
            #chat-history { display: flex; flex-direction: column; flex-grow: 1; overflow-y: auto; padding: var(--spacing-md) var(--spacing-lg); gap: var(--spacing-md); }
            #history-loader-container { min-height: 36px; }
            .loader-wrapper { display: flex; justify-content: center; padding: var(--spacing-xs) 0; }
            #load-more-btn { padding: var(--spacing-xs) var(--spacing-md); font-size: 0.7rem; }
            #chat-input-container {
                display: flex;
                flex-direction: column;
                border-top: 1px solid var(--bg-3);
                background-color: var(--bg-1);
                flex-shrink: 0;
            }

            #chat-toolbar {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                padding: var(--spacing-xs);
                border-bottom: 1px solid var(--bg-3);
                background-color: var(--bg-0);
                min-height: 36px;
            }

            #go-to-parent-btn {
                width: 32px;
                height: 32px;
                border: none;
                background: transparent;
                color: var(--text-secondary);
                border-radius: var(--radius-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color var(--transition-fast), color var(--transition-fast);
            }

            #go-to-parent-btn:hover {
                background-color: var(--bg-2);
                color: var(--text-primary);
            }

            #go-to-parent-btn .material-icons { font-size: 18px; }

            #quick-regen-btn {
                width: 32px;
                height: 32px;
                border: none;
                background: transparent;
                color: var(--text-secondary);
                border-radius: var(--radius-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color var(--transition-fast), color var(--transition-fast);
            }

            #quick-regen-btn:hover:not(:disabled) {
                background-color: var(--bg-2);
                color: var(--text-primary);
            }

            #quick-regen-btn:disabled {
                color: var(--text-disabled);
                cursor: not-allowed;
                opacity: 0.4;
            }

            #quick-regen-btn .material-icons { font-size: 18px; }

            #user-persona-btn {
                width: auto;
                height: 32px;
                border: none;
                background: transparent;
                border-radius: var(--radius-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                padding: 0 var(--spacing-xs);
                transition: background-color var(--transition-fast);
            }

            #user-persona-btn:hover {
                background-color: var(--bg-2);
            }

            #user-persona-name {
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 150px;
            }

            #user-persona-avatar {
                width: 28px;
                height: 28px;
                border-radius: 50%;
                object-fit: cover;
                background-color: var(--bg-3);
                flex-shrink: 0;
            }

            #chat-form {
                display: flex;
                align-items: flex-end;
                padding: 0;
                gap: 0;
                min-height: 48px;
            }

            text-box {
                flex-grow: 1;
                align-self: stretch;
                min-height: 48px;
                max-height: 120px;
                padding: 0.75rem 1rem;
                border-radius: 0;
                border: none;
                background-color: var(--bg-0);
                font-family: var(--font-family);
                font-size: 0.7rem;
                transition: background-color var(--transition-fast);
                resize: none;
            }

            text-box:focus-within {
                background-color: var(--bg-0);
                outline: none;
            }

            .send-button {
                flex-shrink: 0;
                align-self: stretch;
                aspect-ratio: 1;
                min-width: 48px;
                border: none;
                background-color: var(--accent-primary);
                color: var(--bg-0);
                border-radius: 0;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background-color var(--transition-fast);
                border-left: 1px solid var(--bg-3);
            }

            .send-button:hover:not(:disabled) {
                filter: brightness(1.15);
            }

            .send-button:disabled {
                background-color: var(--bg-2);
                color: var(--text-disabled);
                cursor: not-allowed;
                opacity: 0.4;
            }

            .send-button.stop-button {
                background-color: var(--accent-danger);
            }

            .send-button.stop-button:hover {
                filter: brightness(1.15);
            }

            .send-button .material-icons { font-size: 20px; }
            
            .chat-message { display: flex; flex-direction: column; gap: 0; position: relative; font-size: 0.7rem; margin-bottom: var(--spacing-sm); }
            .chat-message.assistant.adventure-mode { position: relative; gap: var(--spacing-sm); }
            .chat-message:not(.assistant.adventure-mode) { display: flex; gap: var(--spacing-sm); width: 100%; }
            .chat-message .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-top: 3px; background-color: var(--bg-3); }
            .chat-message.system { margin: color: var(--text-secondary); max-width: 100%; }
            .chat-message.system .message-bubble { background: none; }
            .message-bubble { background-color: var(--accent-primary-faded); padding-bottom: var(--spacing-md); padding-left: var(--spacing-sm); flex-grow: 1; position: relative; width: 100%; border-radius: var(--radius-sm); }
            .chat-message.user .message-bubble { color: var(--text-primary); padding-bottom: var(--spacing-sm); width: 100%; }
            .message-content { font-size: 0.7rem; line-height: 1.4; }
            .chat-message.user .message-bubble .icon-btn { color: var(--bg-1); }
            .chat-message.user { margin-left: var(--spacing-sm); margin-right: var(--spacing-sm); padding-right: 13px; }
            .message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-xs); margin-top: var(--spacing-xs); }
            .author-name { font-weight: 600; font-size: 0.7rem; }

            pause { display: none; line-height: 0; }

            /* Menu button styling */
            .message-menu-trigger {
                background: transparent;
                border: none;
                cursor: pointer;
                color: var(--text-secondary);
                padding: 2px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
            }

            .message-menu-trigger:hover {
                background-color: var(--bg-2);
                color: var(--text-primary);
            }

            .message-menu-trigger .material-icons {
                font-size: 18px;
            }

            .message-header .message-menu-trigger {
                opacity: 0;
                transition: opacity var(--transition-fast);
            }

            .message-bubble:hover .message-menu-trigger {
                opacity: 1;
            }

            .chat-message.assistant.adventure-mode .message-menu-trigger.adventure-menu {
                position: absolute;
                top: var(--spacing-xs);
                right: var(--spacing-xs);
                opacity: 0;
                transition: opacity var(--transition-fast);
            }

            .chat-message.assistant.adventure-mode:hover .message-menu-trigger.adventure-menu {
                opacity: 1;
            }

            .message-bubble text-box, .adventure-dialogue-content text-box, .chat-message.assistant.adventure-mode > text-box { outline: 1px solid var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-faded); border-radius: var(--radius-sm); padding: var(--spacing-sm); background-color: var(--bg-0); color: white; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            .adventure-fade-in { animation: fadeIn 0.4s ease-out both; }
            .adventure-custom {
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                overflow: hidden;
            }
            
            .adventure-parse-error { border: 2px solid var(--accent-danger); background: rgba(242, 139, 130, 0.1); padding: var(--spacing-md); border-radius: var(--radius-md); margin-top: var(--spacing-md); }
            .adventure-parse-error pre { background: var(--bg-0); padding: var(--spacing-sm); border-radius: var(--radius-sm); white-space: pre-wrap; word-break: break-all; }
            .adventure-block { padding-top: 0; transition: opacity 0.4s ease-out; font-size: 0.7rem; }
            .adventure-narrate {
                font-style: italic;
                color: var(--text-secondary);
                /* text-align: justify; - Removed for better readability in quote blocks */
                padding-left: var(--spacing-sm);
                padding-right: var(--spacing-sm);
                padding-top: 0;
                padding-bottom: var(--spacing-xs);

                border-left: 2px solid var(--accent-primary);
                border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
                font-size: 0.7rem;
                line-height: 1.4;
            }
            .adventure-dialogue { border-left: 2px solid var(--accent-primary); padding-left: var(--spacing-sm); display: grid; grid-template-areas: "avatar name" "avatar content"; grid-template-columns: auto 1fr; grid-template-rows: auto 1fr; gap: 0 var(--spacing-sm); }
            .adventure-speaker-avatar { border-radius: var(--radius-md); object-fit: cover; background-color: var(--bg-3); grid-area: avatar; column-span: 1; height: 80px; width: 60px; cursor: pointer; }
            .adventure-dialogue-content { grid-area: content; font-size: 0.7rem; line-height: 1.4; }
            .adventure-speaker-name { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); grid-area: name; padding-bottom: 2px; border-bottom: 1px solid var(--bg-3); margin-bottom: var(--spacing-xs); }
            .adventure-speech-container { font-size: 0.7rem; line-height: 1.4; }
            .adventure-speech { display: inline; animation: fadeIn 0.3s ease-out both; opacity: 0; font-size: 0.7rem; line-height: 1.4; }
            .adventure-speech:not(:first-child)::before { content: ' '; }
            .adventure-speech-yell { text-transform: uppercase; font-weight: bold; font-size: 0.9rem; }
            .adventure-speech-whisper { font-style: italic; color: var(--text-secondary); font-size: 0.8rem; }
            .adventure-prompt { border-radius: var(--radius-md); background-color: var(--bg-1); color: var(--text-primary); position: relative; font-size: 0.9rem; }
            .adventure-prompt-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: var(--spacing-xs) var(--spacing-sm); background-color: var(--bg-2); border-radius: var(--radius-sm); user-select: none; font-size: 0.9rem; }
            .adventure-prompt-header .expand-icon { font-size: 1.2rem; }
            .adventure-prompt.collapsed .adventure-prompt-body { display: none; }
            .adventure-prompt-body { display: flex; flex-direction: column; gap: var(--spacing-xs); padding: var(--spacing-sm); }
            .adventure-prompt-info { margin-bottom: var(--spacing-xs);}
            .adventure-choice-button { user-select: none; width: 100%; }
            .adventure-char-ref { display: inline-flex; align-items: center; gap: 3px; color: var(--accent-primary); text-decoration: none; font-weight: 600; line-height: 1; vertical-align: middle; font-size: 0.7rem; padding: 0 2px; border-radius: var(--radius-sm); transition: var(--transition-fast); }
            .adventure-char-ref.non-interactive { cursor: default; color: var(--text-primary); }
            a.adventure-char-ref:hover { text-decoration: none; background-color: rgba(138, 180, 248, 0.1); }
            a.adventure-char-ref:hover .adventure-char-link-text { text-decoration: underline; }
            .adventure-char-avatar { width: 1.3em; height: 1.3em; border-radius: 50%; object-fit: cover; border: 1px solid var(--bg-3); line-height: 1; }
            
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
                #chat-history { padding: var(--spacing-sm) var(--spacing-xs); gap: var(--spacing-sm); overflow-y: auto; overflow-x: hidden; }
                /* Ensure menu buttons are always visible on mobile */
                .message-header .message-menu-trigger,
                .chat-message.assistant.adventure-mode .message-menu-trigger.adventure-menu {
                    opacity: 1;
                }

                /* Make regular messages more compact too */
                .chat-message { font-size: 0.8rem; }
                .message-content { font-size: 0.8rem; }
                .author-name { font-size: 0.8rem; }

                /* Make layout more compact */
                .adventure-block { font-size: 0.8rem; } /* Consistent spacing between all blocks */
                .adventure-narrate { font-size: 0.8rem; }
                .adventure-dialogue { gap: 2px var(--spacing-xs); }
                .adventure-speaker-avatar { border-radius: var(--radius-sm); height: 60px; width: 45px; }
                .adventure-speaker-avatar img { width: 100%; height: auto; border-radius: var(--radius-sm); }
                .adventure-speaker-name { font-size: 0.7rem; }
                .adventure-speech { font-size: 0.8rem; font-size: 0.8rem; }
                .adventure-dialogue-content { font-size: 0.8rem; }
                .adventure-prompt-body { padding: var(--spacing-xs); gap: 3px; }
                .adventure-prompt-info { font-size: 0.8rem; }
                .adventure-choice-button { padding: 0.3rem 0.8rem; font-size: 0.7rem; }
                .adventure-char-ref { font-size: 0.8rem; line-height: 1; }
                .adventure-char-link-text { font-size: 0.8rem; line-height: 1; }

                /* --- Image Block Overrides for Mobile --- */
                /* Stack image and content vertically */
                .adventure-image,
                .adventure-image.layout-side-by-side,
                .adventure-image.layout-overlay {
                    display: flex;
                    flex-direction: column;
                    background-color: var(--bg-0); /* A subtle background for the whole block */
                }
                
                .adventure-image-container {
                    order: 1; /* Image first */
                    max-height: 250px; /* Constrain image height */
                }

                .adventure-image-display {
                    object-fit: contain; /* Show full image without cropping */
                    background-color: var(--bg-0);
                }

                /* Reset grid-area and styles for content */
                .adventure-image-content,
                .adventure-image.layout-side-by-side .adventure-image-content,
                .adventure-image.layout-overlay .adventure-image-content {
                    order: 2; /* Content second */
                    grid-area: auto;
                    padding: var(--spacing-sm) var(--spacing-md);
                    background: none; /* Remove overlay gradient */
                    color: inherit;
                    text-shadow: none;
                }

                .adventure-image-content .adventure-block,
                .adventure-image.layout-overlay .adventure-image-content .adventure-block {
                    color: inherit;
                    text-shadow: none;
                    margin-bottom: var(--spacing-xs);
                }

                /* Override for dialogue inside image on mobile */
                .adventure-image-content .adventure-dialogue {
                    backdrop-filter: none;
                    -webkit-backdrop-filter: none;
                    margin-bottom: 0;
                }
                .adventure-image-content .adventure-dialogue .adventure-speaker-name,
                .adventure-image.layout-overlay .adventure-image-content .adventure-dialogue .adventure-speaker-name {
                    color: var(--text-primary);
                    border-bottom-color: var(--bg-3);
                }
            }

            /* Persona Selection Modal */
            .modal-backdrop {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.7);
                z-index: 1000;
                align-items: center;
                justify-content: center;
            }

            .modal-content {
                background-color: var(--bg-1);
                border-radius: var(--radius-md);
                max-width: 500px;
                width: 90%;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            }

            .modal-content header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: var(--spacing-md) var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3);
            }

            .modal-content header h2 {
                margin: 0;
                font-size: 1.2rem;
                color: var(--text-primary);
            }

            .close-modal-btn {
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                padding: var(--spacing-xs);
                border-radius: var(--radius-sm);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: var(--transition-fast);
            }

            .close-modal-btn:hover {
                color: var(--text-primary);
                background-color: var(--bg-2);
            }

            .close-modal-btn .material-icons {
                font-size: 24px;
            }

            .modal-body {
                display: flex;
                flex-direction: column;
                overflow-y: auto;
                flex-grow: 1;
                gap: var(--spacing-md);
                padding: var(--spacing-md);
            }

            .modal-search-bar {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                padding: var(--spacing-sm) var(--spacing-md);
                border: 1px solid var(--bg-3);
                background-color: var(--bg-0);
                border-radius: var(--radius-sm);
                flex-shrink: 0;
            }

            .modal-search-bar .material-icons {
                color: var(--text-secondary);
                font-size: 20px;
            }

            .modal-search-bar input {
                background: none;
                border: none;
                outline: none;
                width: 100%;
                color: var(--text-primary);
                font-size: 0.9rem;
            }

            .character-list {
                display: flex;
                flex-direction: column;
                gap: var(--spacing-xs);
            }

            .character-item {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                padding: var(--spacing-sm) var(--spacing-md);
                background-color: var(--bg-0);
                border-radius: var(--radius-sm);
                cursor: pointer;
                transition: var(--transition-fast);
                border: 1px solid transparent;
            }

            .character-item:hover {
                background-color: var(--bg-2);
            }

            .character-item.is-persona {
                background-color: var(--accent-primary-faded);
                border-color: var(--accent-primary);
            }

            .character-item.is-persona:hover {
                background-color: rgba(138, 180, 248, 0.4);
            }

            .character-item img {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                object-fit: cover;
                background-color: var(--bg-3);
                flex-shrink: 0;
            }

            .character-item .character-name {
                flex-grow: 1;
                color: var(--text-primary);
                font-size: 0.9rem;
                font-weight: 500;
            }

            .character-item .persona-icon {
                color: var(--accent-good);
                font-size: 20px;
            }
        `;
    }
}

customElements.define("adventure-chat-mode", AdventureChatMode);
chatModeRegistry.register("adventure", "adventure-chat-mode");