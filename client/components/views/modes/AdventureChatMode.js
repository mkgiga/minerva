// client/components/views/modes/AdventureChatMode.js

import { BaseChatMode } from "./BaseChatMode.js";
import { chatModeRegistry } from "../../../ChatModeRegistry.js";
import { notifier, uuidv4, imagePreview, api } from "../../../client.js";
import "../../common/Spinner.js";
import "../../common/DropdownMenu.js";
import "./AdventureBlockEditor.js"; 

/**
 * A physics-based scroller that creates a smooth "camera pan" effect
 * following the text generation, eliminating line-wrap jumps.
 */
class ContinuousScroller {
    constructor(container) {
        this.container = container;
        this.activeElement = null;
        this.isTyping = false;
        this.rafId = null;
        
        // Configuration
        // The target "sweet spot" for the active line, as a percentage of container height.
        // 0.85 means we aim to keep the typing cursor 85% of the way down the screen.
        // This leaves room below for the next line to appear without immediate scrolling,
        // but reacts quickly once the text gets too low.
        this.verticalOffsetRatio = 0.85; 
        
        // Smoothing factors
        this.minSpeed = 1; // Minimum movement in pixels per frame (prevents sticking)
        this.baseFactor = 0.15; // The fraction of the gap to close per frame (higher = snappier)
        this.maxSpeed = 8; // Cap speed to avoid disorienting jumps
    }

    /**
     * Sets the element currently being typed into.
     */
    trackElement(element) {
        this.activeElement = element;
        // Ensure loop is running if we are in typing mode
        if (this.isTyping && !this.rafId) {
            this.loop();
        }
    }

    setTypingStatus(isTyping) {
        this.isTyping = isTyping;
        if (isTyping) {
            if (!this.rafId) this.loop();
        } else {
            // Optional: When stopping, we could let the loop run once more to settle,
            // but usually stopping immediately is fine.
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        }
    }

    loop() {
        if (!this.isTyping) {
            this.rafId = null;
            return;
        }

        this.update();
        this.rafId = requestAnimationFrame(() => this.loop());
    }

    update() {
        if (!this.activeElement || !this.activeElement.isConnected) return;

        // Use getBoundingClientRect to get absolute visual positions relative to viewport.
        // This avoids issues with offsetParent nesting and document flow.
        const containerRect = this.container.getBoundingClientRect();
        const elemRect = this.activeElement.getBoundingClientRect();
        
        // Calculate where the bottom of the active element is relative to the container's top edge.
        const elementVisualBottom = elemRect.bottom - containerRect.top;
        
        // Calculate our target position (pixels from top of container view)
        const targetVisualBottom = containerRect.height * this.verticalOffsetRatio;
        
        // Calculate the difference. 
        // diff > 0 means element is below target (too low), we need to scroll DOWN to push it visual UP.
        const diff = elementVisualBottom - targetVisualBottom;

        // If we are above the target line (diff < 0) or effectively on it, do nothing.
        // We only want to scroll down to reveal new content, never scroll up automatically 
        // during generation (preserves user manual scrolling if they went up to read history).
        if (diff <= 1) return;

        // Calculate smooth step
        // Proportional speed creates an "ease-out" effect as we approach target
        let step = diff * this.baseFactor;
        
        // Clamp speeds for better UX
        step = Math.max(step, this.minSpeed); // Ensure we actually finish
        step = Math.min(step, this.maxSpeed); // Prevent motion sickness from huge jumps
        
        // Don't overshoot if the diff is tiny
        if (step > diff) step = diff;

        // Apply scroll. Increasing scrollTop moves content UP, element moves UP visually.
        this.container.scrollTop += step;
    }
}

export class AdventureChatMode extends BaseChatMode {
    #historyContainer = null;
    #form = null;
    #inputContainer = null;
    #plaintextContainer = null;
    #plaintextInput = null;
    #inputModeButton = null;
    #sendButton = null;
    #quickRegenButton = null;
    #continueButton = null; 
    #goToParentButton = null;
    #personaNameEl = null;
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
    #curationEnabled = false;
    #inputMode = 'plaintext';
    
    // Scroller instance
    #scroller = null;

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
                defaultValue: true,
                description:
                    "Automatically scroll to the newest content as it is being generated during live responses.",
            },
        ];
    }

    static getDefaultSettings() {
        return {
            scrollSpeed: 6,
            blockGap: 0.75, 
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

        // Pre-wrap webview content in CDATA to prevent XML parsing errors with raw HTML/Doctypes
        processedContent = processedContent.replace(/(<webview(?:\s[^>]*)?>)([\s\S]*?)(<\/webview>)/gi, (match, open, inner, close) => {
            if (inner.trim().startsWith('<![CDATA[')) return match;
            // Escape any CDATA end sequences that might exist in the content
            const safeInner = inner.replace(/]]>/g, ']]]]><![CDATA[>');
            return `${open}<![CDATA[${safeInner}]]>${close}`;
        });

        const parser = new DOMParser();
        let doc = parser.parseFromString(processedContent, "application/xml");
        let parserError = doc.querySelector("parsererror");

        if (!parserError) {
            return doc;
        }
        
        console.warn("SceneML parsing failed, attempting repair. Error:", parserError.textContent);

        const customBlocks = [];
        // Updated regex to be robust against attributes and case sensitivity
        const protectedContent = processedContent.replace(/<webview(?:\s[^>]*)?>[\s\S]*?<\/webview>/gi, match => {
            customBlocks.push(match);
            return `<!--CUSTOM_BLOCK_${customBlocks.length - 1}-->`;
        });

        const tagNames = ["text", "speech", "image", "pause", "webview", "noop_continue", "unformatted"];
        
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

        if (!finalRepairedContent.startsWith("<root>") && !finalRepairedContent.startsWith("<scene>")) {
             finalRepairedContent = `<root>${finalRepairedContent}</root>`;
        }

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
        this.#strippedHistory = this.chat.messages; 
    }

    onInitialize() {
        this.render();
        this.#historyContainer = this.shadowRoot.querySelector("#chat-history");
        this.#form = this.shadowRoot.querySelector("#chat-form");
        this.#inputContainer = this.shadowRoot.querySelector("#block-input-list");
        this.#plaintextContainer = this.shadowRoot.querySelector("#plaintext-input-container");
        this.#plaintextInput = this.shadowRoot.querySelector("#plaintext-input");
        this.#sendButton = this.#form.querySelector(".send-button");
        this.#quickRegenButton = this.shadowRoot.querySelector("#quick-regen-btn");
        this.#continueButton = this.shadowRoot.querySelector("#continue-btn");
        this.#inputModeButton = this.shadowRoot.querySelector("#input-mode-btn");
        this.#goToParentButton = this.shadowRoot.querySelector("#go-to-parent-btn");
        this.#personaModal = this.shadowRoot.querySelector("#persona-modal");
        this.#personaSearchInput = this.shadowRoot.querySelector("#persona-search-input");
        this.#personaCharacterList = this.shadowRoot.querySelector("#persona-character-list");
        this.#personaAvatarImg = this.shadowRoot.querySelector("#user-persona-avatar");
        this.#personaNameEl = this.shadowRoot.querySelector("#user-persona-name");

        // Initialize Scroller
        this.#scroller = new ContinuousScroller(this.#historyContainer);

        this.#settings = this.settings;
        this.#applySettings();

        this.#initializeInputBlocks();

        this.#form.addEventListener("submit", this.#handleSend.bind(this));
        this.#sendButton.addEventListener("click", this.#handleSend.bind(this));
        
        if (this.#quickRegenButton) this.#quickRegenButton.addEventListener("click", this.#handleQuickRegen.bind(this));
        if (this.#continueButton) this.#continueButton.addEventListener("click", this.#handleContinue.bind(this));
        if (this.#inputModeButton) this.#inputModeButton.addEventListener("click", this.#toggleInputMode.bind(this));
        if (this.#goToParentButton) this.#goToParentButton.addEventListener("click", () => this.goToParentChat());
        this.#historyContainer.addEventListener("click", this.#handleHistoryClick.bind(this));

        this.shadowRoot.querySelector("#user-persona-btn").addEventListener("click", () => this.#openPersonaModal());
        this.shadowRoot.querySelector("#close-persona-modal-btn").addEventListener("click", () => this.#closePersonaModal());
        this.#personaModal.addEventListener("click", (e) => { if (e.target === this.#personaModal) this.#closePersonaModal(); });
        this.#personaSearchInput.addEventListener("input", () => this.#renderPersonaList());
        this.#personaCharacterList.addEventListener("click", (e) => this.#handlePersonaSelection(e));

        this.shadowRoot.querySelector('#curation-toggle').addEventListener('click', () => this.#toggleCuration());

        this.#updatePersonaAvatar();
        this.#rebuildStrippedHistory();
        this.#loadGlobalSettings();
        this.#updateInputModeUI();
    }

    #initializeInputBlocks() {
        this.#inputContainer.innerHTML = '';
        this.#addBlock(false);
        this.#addBlock(true);
    }

    #toggleInputMode() {
        this.#inputMode = this.#inputMode === 'blocks' ? 'plaintext' : 'blocks';
        this.#updateInputModeUI();
    }

    #updateInputModeUI() {
        const scrollContainer = this.shadowRoot.querySelector("#input-scroll-container");
        const icon = this.#inputModeButton.querySelector(".material-icons");

        if (this.#inputMode === 'plaintext') {
            scrollContainer.style.display = 'none';
            this.#plaintextContainer.style.display = 'block';
            this.#inputModeButton.title = "Switch to Block Editor";
            if (icon) icon.textContent = "view_agenda";
            setTimeout(() => {
                const textarea = this.#plaintextInput?.shadowRoot?.querySelector('textarea');
                if (textarea) textarea.focus();
            }, 0);
        } else {
            scrollContainer.style.display = 'block';
            this.#plaintextContainer.style.display = 'none';
            this.#inputModeButton.title = "Switch to Plaintext Input";
            if (icon) icon.textContent = "notes";
        }
    }

    #addBlock(isPlaceholder = false, insertBeforeEl = null) {
        const block = document.createElement("adventure-block-editor");
        const participantIds = this.chat?.participants.map(p => typeof p === 'object' ? p.id : p) || [];
        block.setContext(this.allCharacters, participantIds, this.userPersona);

        if (isPlaceholder) {
            block.classList.add("placeholder");
            block.addEventListener("block-add", () => {
                this.#addBlock(false, block);
            });
            this.#inputContainer.appendChild(block);
        } else {
            block.addEventListener("block-delete", () => block.remove());
            block.addEventListener("block-up", () => {
                const prev = block.previousElementSibling;
                if (prev) this.#inputContainer.insertBefore(block, prev);
            });
            block.addEventListener("block-down", () => {
                const next = block.nextElementSibling;
                if (next && !next.classList.contains("placeholder")) {
                    this.#inputContainer.insertBefore(next, block);
                }
            });

            if (insertBeforeEl) {
                this.#inputContainer.insertBefore(block, insertBeforeEl);
            } else {
                const placeholder = this.#inputContainer.lastElementChild;
                if (placeholder && placeholder.classList.contains("placeholder")) {
                    this.#inputContainer.insertBefore(block, placeholder);
                } else {
                    this.#inputContainer.appendChild(block);
                }
            }
        }
        return block;
    }

    async #loadGlobalSettings() {
        try {
            const settings = await api.get('/api/settings');
            this.#curationEnabled = !!settings.chat?.curateResponse;
            this.#updateCurationButton();
        } catch (error) {
            console.warn('Failed to load global curation setting:', error);
        }
    }

    async #toggleCuration() {
        const newState = !this.#curationEnabled;
        this.#curationEnabled = newState;
        this.#updateCurationButton();

        try {
            await api.post('/api/settings', { chat: { curateResponse: newState } });
            notifier.show({ type: 'info', message: `Response Curation ${newState ? 'Enabled' : 'Disabled'}`, duration: 2000 });
        } catch (error) {
            console.error('Failed to toggle curation setting:', error);
            this.#curationEnabled = !newState;
            this.#updateCurationButton();
            notifier.show({ type: 'bad', message: 'Failed to update setting.' });
        }
    }

    #updateCurationButton() {
        const btn = this.shadowRoot.querySelector('#curation-toggle');
        if (!btn) return;
        
        if (this.#curationEnabled) {
            btn.classList.add('active');
            btn.title = "Curation Enabled (Enhance AI responses)";
        } else {
            btn.classList.remove('active');
            btn.title = "Curation Disabled";
        }
    }

    onGlobalSettingsChanged(settings) {
        if (settings.chat?.curateResponse !== undefined) {
            this.#curationEnabled = settings.chat.curateResponse;
            this.#updateCurationButton();
        }
    }

    onSettingsChanged(newSettings) {
        this.#settings = { ...this.#settings, ...newSettings };
        this.#applySettings();
    }

    #applySettings() { this.style.setProperty("--adventure-block-gap", `${this.#settings.blockGap}rem`); }

    onChatSwitched() { this.refreshChatHistory(); this.#rebuildStrippedHistory(); this.#refreshInputContext(); }
    onChatBranched() { this.#rebuildStrippedHistory(); }
    onParticipantsChanged() { this.refreshChatHistory(); this.#refreshInputContext(); }
    onAllCharactersChanged() { this.refreshChatHistory(); this.#refreshInputContext(); }
    onUserPersonaChanged() { this.refreshChatHistory(); this.#updatePersonaAvatar(); this.#refreshInputContext(); }

    #refreshInputContext() {
        const editors = this.shadowRoot.querySelectorAll("adventure-block-editor");
        const participantIds = this.chat?.participants.map(p => typeof p === 'object' ? p.id : p) || [];
        editors.forEach(ed => ed.setContext(this.allCharacters, participantIds, this.userPersona));
    }

    onMessagesAdded(addedMessages) {
        this.#rebuildStrippedHistory();
        const optimisticUserEl = this.shadowRoot.querySelector('.optimistic-user-message');
        const optimisticAssistantEl = this.shadowRoot.querySelector('.optimistic-assistant-message');
    
        const finalUserMsg = addedMessages.find(m => m.role === 'user');
        const finalAssistantMsg = addedMessages.find(m => m.role === 'assistant');
    
        if (optimisticUserEl || optimisticAssistantEl) {
            if (optimisticUserEl && finalUserMsg) {
                this.#updateMessageContent(optimisticUserEl, finalUserMsg);
                optimisticUserEl.classList.remove('optimistic-user-message');
            }
    
            if (optimisticAssistantEl && finalAssistantMsg) {
                const tempAssistantId = optimisticAssistantEl.dataset.messageId;
    
                if (this.#justAnimatedMessageIds.has(tempAssistantId)) {
                    this.#justAnimatedMessageIds.delete(tempAssistantId);
                    this.#justAnimatedMessageIds.add(finalAssistantMsg.id);
                }
    
                optimisticAssistantEl.dataset.messageId = finalAssistantMsg.id;
                optimisticAssistantEl.classList.remove('optimistic-assistant-message');
            }
        } else {
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

        const newScrollHeight = container.scrollHeight;
        container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);

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
            const messageEl = this.shadowRoot.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                this.#updateMessageContent(messageEl, {
                    ...messageData,
                    content: '<minerva-spinner mode="infinite"></minerva-spinner>'
                });
                return messageId; 
            }
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
        
        const promptText = this.getUserInput();
        
        if (promptText && !this.#sendButton.disabled) {
            const userMessage = { role: "user", content: promptText, characterId: this.userPersona?.id || null, timestamp: new Date().toISOString(), id: `user-${uuidv4()}` };
            this.sendChatCompletion({ userMessage, messages: [...this.#strippedHistory] });
        }
    }

    #handleQuickRegen() {
        if (this.isSending || this.#isAnimating || !this.chat || this.chat.messages.length === 0) return;
        this.regenerateMessage(this.chat.messages.at(-1).id);
    }

    #handleContinue() {
        if (this.isSending || this.#isAnimating) return;
        this.sendPrompt("<noop_continue/>");
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
        
        const avatarImg = event.target.closest(".adventure-speaker-avatar, .adventure-image-display");
        if (avatarImg?.tagName === "IMG") { imagePreview.show({ src: avatarImg.src, alt: avatarImg.alt }); return; }

        for (const button of event.composedPath()) {
            if (button.tagName === "BUTTON" && button.dataset.action) {
                const action = button.dataset.action;
                event.preventDefault();

                if (action === "navigate-to-character") {
                    this.dispatch("navigate-to-view", { view: "characters", state: { selectedCharacterId: button.dataset.characterId } });
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
        const originalHTML = contentContainer.innerHTML;

        const editContainer = document.createElement("div");
        editContainer.className = "message-edit-container";
        editContainer.style.width = "100%";
        
        let contentToParse = originalContent.trim();
        if (!contentToParse.startsWith("<root>") && !contentToParse.startsWith("<scene>") && !contentToParse.includes("<")) {
            const block = document.createElement("adventure-block-editor");
            block.setContext(this.allCharacters, this.chat?.participants.map(p => typeof p === 'object' ? p.id : p), this.userPersona);
            block.setData('text', contentToParse);
            editContainer.appendChild(block);
        } else {
            if (!contentToParse.startsWith("<root>") && !contentToParse.startsWith("<scene>")) {
                contentToParse = `<root>${contentToParse}</root>`;
            }
            
            const doc = this.#tryRepairSceneML(contentToParse);
            const rootNodes = doc ? Array.from(doc.documentElement.children) : [];
            
            rootNodes.forEach(node => {
                const tagName = node.nodeName.toLowerCase();
                const block = document.createElement("adventure-block-editor");
                block.setContext(this.allCharacters, this.chat?.participants.map(p => typeof p === 'object' ? p.id : p), this.userPersona);
                
                block.addEventListener("block-delete", () => block.remove());
                block.addEventListener("block-up", () => {
                    const prev = block.previousElementSibling;
                    if (prev) editContainer.insertBefore(block, prev);
                });
                block.addEventListener("block-down", () => {
                    const next = block.nextElementSibling;
                    if (next) editContainer.insertBefore(next, block);
                });

                if (tagName === 'text') {
                    block.setData('text', node.textContent.trim());
                    editContainer.appendChild(block);
                } else if (tagName === 'speech') {
                    const id = node.getAttribute('id');
                    const name = node.getAttribute('name');
                    block.setData('speech', node.textContent.trim(), { id, name });
                    editContainer.appendChild(block);
                } else if (tagName === 'unformatted') {
                    block.setData('unformatted', node.textContent.trim());
                    editContainer.appendChild(block);
                }
            });
        }
        
        const placeholder = document.createElement("adventure-block-editor");
        placeholder.classList.add("placeholder");
        placeholder.setContext(this.allCharacters, this.chat?.participants.map(p => typeof p === 'object' ? p.id : p), this.userPersona);
        placeholder.addEventListener("block-add", () => {
            const newBlock = document.createElement("adventure-block-editor");
            newBlock.setContext(this.allCharacters, this.chat?.participants.map(p => typeof p === 'object' ? p.id : p), this.userPersona);
            newBlock.addEventListener("block-delete", () => newBlock.remove());
            newBlock.addEventListener("block-up", () => {
                const prev = newBlock.previousElementSibling;
                if (prev) editContainer.insertBefore(newBlock, prev);
            });
            newBlock.addEventListener("block-down", () => {
                const next = newBlock.nextElementSibling;
                if (next && !next.classList.contains("placeholder")) editContainer.insertBefore(next, newBlock);
            });
            editContainer.insertBefore(newBlock, placeholder);
        });
        editContainer.appendChild(placeholder);

        const controls = document.createElement("div");
        controls.className = "edit-controls";
        controls.innerHTML = `
            <button class="button-secondary cancel-btn">Cancel</button>
            <button class="button-primary save-btn">Save</button>
        `;

        contentContainer.innerHTML = "";
        contentContainer.appendChild(editContainer);
        contentContainer.appendChild(controls);

        controls.querySelector(".cancel-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            contentContainer.innerHTML = originalHTML;
            this.#updateMessageContent(messageEl, this.getMessageById(messageId));
        });

        controls.querySelector(".save-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            const editors = editContainer.querySelectorAll("adventure-block-editor:not(.placeholder)");
            const newContent = Array.from(editors).map(ed => ed.toXML()).join("\n\n");
            
            if (newContent.trim() !== originalContent.trim()) {
                this.saveEditedMessage(messageId, newContent);
            } else {
                this.#updateMessageContent(messageEl, this.getMessageById(messageId));
            }
        });
    }

    getUserInput() {
        if (this.#inputMode === 'plaintext') {
            const raw = this.#plaintextInput.value.trim();
            if (!raw) return "";
            return `<unformatted>\n${raw}\n</unformatted>`;
        } else {
            const editors = this.#inputContainer.querySelectorAll("adventure-block-editor:not(.placeholder)");
            const parts = Array.from(editors).map(ed => ed.toXML());
            return parts.join("\n\n").trim();
        }
    }

    clearUserInput() { 
        this.#initializeInputBlocks();
        this.#plaintextInput.value = "";
    }

    updateInputState(isSending = false) {
        this.isSending = isSending;
        if (!this.#sendButton) return;
        
        // Block mode
        this.#inputContainer.style.pointerEvents = isSending ? "none" : "auto";
        this.#inputContainer.style.opacity = isSending ? "0.6" : "1";
        
        // Plaintext mode
        this.#plaintextInput.disabled = isSending;

        // Toggle button logic
        this.#inputModeButton.disabled = isSending;

        const sendIcon = this.#sendButton.querySelector(".material-icons");
        if (isSending) {
            this.#sendButton.disabled = false;
            this.#sendButton.title = "Stop Generation";
            this.#sendButton.classList.add("stop-button");
            if (sendIcon) sendIcon.textContent = "stop";
        } else {
            this.#sendButton.disabled = this.#isAnimating; 
            this.#sendButton.title = "Send";
            this.#sendButton.classList.remove("stop-button");
            if (sendIcon) sendIcon.textContent = "send";
        }
        
        if (this.#quickRegenButton) this.#quickRegenButton.disabled = isSending || this.#isAnimating || !this.chat || this.chat.messages.length === 0;
        if (this.#continueButton) this.#continueButton.disabled = isSending || this.#isAnimating;
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
            this.#isAnimating = true;
            this.#justAnimatedMessageIds.add(messageEl.dataset.messageId);
            
            // Start scrolling support for new message animation
            if (this.#settings.autoScroll) {
                this.#scroller.setTypingStatus(true);
            }
            
            await this.#animateSceneMLResponse(messageEl, { id: messageEl.dataset.messageId, role: "assistant", content: finalContent });
            
            if (this.#settings.autoScroll) {
                this.#scroller.setTypingStatus(false);
            }
        } else {
            notifier.show({ type: 'warn', message: `Failed to render response: Could not find message element (ID: ${messageId})` });
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
        this.#isAnimating = false;
        this.updateInputState(false);
    }

    refreshChatHistory() {
        if (!this.#historyContainer || !this.chat) { this.#historyContainer.innerHTML = ""; return; }

        this.#historyContainer.innerHTML = '<div id="history-loader-container"></div>';
        this.#renderHistoryLoader();
        
        for (let i = 0; i < this.chat.messages.length; i++) this.appendMessage(this.chat.messages[i], false, i);
        
        setTimeout(() => { this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight; }, 0);
        this.updateInputState(this.isSending);
    }

    #renderHistoryLoader() {
        const container = this.shadowRoot.querySelector('#history-loader-container');
        if (!container) return;

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
        if (msg.content.includes("<minerva-spinner")) {
            messageEl.className = "chat-message assistant adventure-mode";
            messageEl.innerHTML = `<div class="message-content">${msg.content}</div>`;
            return;
        }

        let contentToParse = msg.content || "";
        if (!contentToParse.trim().startsWith("<root>") && !contentToParse.trim().startsWith("<scene>") && !contentToParse.includes("<")) {
             contentToParse = `<root><text>${contentToParse}</text></root>`;
        } else if (!contentToParse.trim().startsWith("<root>") && !contentToParse.trim().startsWith("<scene>")) {
             contentToParse = `<root>${contentToParse}</root>`;
        }

        const doc = this.#tryRepairSceneML(contentToParse);
        const rootNodes = doc ? Array.from(doc.documentElement.children) : [];
        const parserError = doc?.querySelector("parsererror");

        if (parserError || rootNodes.length === 0) {
             const authorName = msg.role === 'user' ? (this.userPersona?.name || "You") : "Assistant";
             const avatarUrl = msg.role === 'user' ? (this.userPersona?.avatarUrl || "assets/images/user_icon.svg") : "assets/images/assistant_icon.svg";
             
             messageEl.className = `chat-message ${msg.role}`;
             messageEl.innerHTML = `<img src="${avatarUrl}" alt="${authorName}" class="avatar"><div class="message-bubble"><div class="message-header"><span class="author-name">${authorName}</span></div><div class="message-content">${this.#escapeHtml(msg.content).replace(/\n/g, "<br>")}</div></div>`;
             
             const menuButton = this.#createMessageMenuButton(msg);
             messageEl.querySelector('.message-header').appendChild(menuButton);
        } else {
            messageEl.className = `chat-message ${msg.role} adventure-mode`;
            messageEl.innerHTML = "";
            
            messageEl.appendChild(this.#renderSceneMLOutput(rootNodes, msg, index));

            const menuButton = this.#createMessageMenuButton(msg);
            menuButton.classList.add('adventure-menu');
            messageEl.appendChild(menuButton);
        }
    }

    #sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async #typewriter(targetElement, nodes) {
        const speed = this.#settings.scrollSpeed;
        
        // Pass the specific node we are typing into to the scroller
        // This allows physics-based tracking of the exact visual cursor
        this.#scroller.trackElement(targetElement);

        for (const node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                const textNode = document.createTextNode("");
                targetElement.appendChild(textNode);
                
                if (speed > 0) {
                    for (const char of text) {
                        textNode.nodeValue += char;
                        await this.#sleep(speed);
                    }
                } else {
                    textNode.nodeValue = text;
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName.toLowerCase() === 'pause') {
                    const duration = parseFloat(node.getAttribute('duration') || node.getAttribute('for') || 0) * 1000;
                    if (duration > 0) await this.#sleep(duration);
                    continue;
                }
                const clone = node.cloneNode(false);
                targetElement.appendChild(clone);
                // Recursively type into children
                await this.#typewriter(clone, Array.from(node.childNodes));
                // Resumes tracking parent after child is done
                this.#scroller.trackElement(targetElement);
            }
        }
    }

    #getElementsToType(block) {
        if (!block) return [];
        if (block.classList.contains("adventure-text")) return [block.querySelector(".adventure-text-content") || block]; 
        if (block.classList.contains("adventure-speech")) return [block.querySelector(".adventure-speech-content")];
        return [];
    }
    
    async #animateSceneMLResponse(messageEl, msg) {
        this.updateInputState(this.isSending);
        messageEl.innerHTML = "";

        let contentToParse = msg.content || "";
        if (!contentToParse.trim().startsWith("<root>") && !contentToParse.trim().startsWith("<scene>")) {
            contentToParse = `<root>${contentToParse}</root>`;
        }

        const doc = this.#tryRepairSceneML(contentToParse);
        const rootNodes = doc ? Array.from(doc.documentElement.children) : [];
        
        if (rootNodes.length === 0) { 
            this.#updateMessageContent(messageEl, msg); 
            this.#isAnimating = false; 
            this.updateInputState(false); 
            return; 
        }

        messageEl.className = "chat-message assistant adventure-mode";

        const blocksAndContent = [];
        for (const node of rootNodes) {
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

        const allImageElements = blocksAndContent
            .map(item => Array.from(item.block.querySelectorAll('img.adventure-image-display')))
            .flat();

        const imageLoadPromises = allImageElements.map(img => new Promise(resolve => {
            if (img.complete) resolve();
            else { img.onload = img.onerror = () => resolve(); }
        }));
        await Promise.all(imageLoadPromises);

        for (const item of blocksAndContent) {
            const { block, contentMap, elementsToType } = item;

            if (block.classList.contains('adventure-pause')) {
                const duration = parseFloat(block.dataset.duration || 0) * 1000;
                if (duration > 0) await this.#sleep(duration);
                continue;
            }

            messageEl.appendChild(block);
            block.style.opacity = 0; 
            block.classList.add("adventure-fade-in");

            await this.#sleep(400); 

            for (const element of elementsToType) {
                await this.#typewriter(element, contentMap.get(element));
            }
        }

        const finalMessageId = messageEl.dataset.messageId;
        const finalMessageObject = this.getMessageById(finalMessageId);

        if (finalMessageObject) {
            const menuButton = this.#createMessageMenuButton(finalMessageObject);
            menuButton.classList.add('adventure-menu');
            messageEl.appendChild(menuButton);
        }

        this.#isAnimating = false;
        this.updateInputState(false);
    }
    
    #renderSceneMLOutput(nodes, msg, index = -1) {
        const fragment = document.createDocumentFragment();
        for (const node of nodes) {
            const block = this.#createSceneMLBlock(node, msg, index);
            if (block) fragment.appendChild(block);
        }
        return fragment;
    }

    #getXMLNodeContent(node) {
        let content = "";
        const serializer = new XMLSerializer();
        for (const child of node.childNodes) {
            if (child.nodeType === Node.CDATA_SECTION_NODE) {
                content += child.nodeValue;
            } else {
                content += serializer.serializeToString(child);
            }
        }
        return content;
    }

    #createSceneMLBlock(node, msg, index = -1) {
        let block;
        const tagName = node.nodeName.toLowerCase();
        switch (tagName) {
            case "text":
            case "unformatted": // Reuse text styling for unformatted
                block = document.createElement("div"); 
                block.className = "adventure-block adventure-text"; 
                const icon = node.getAttribute("icon") || (tagName === 'unformatted' ? 'notes' : null);
                if (icon) {
                    const iconEl = document.createElement("span");
                    iconEl.className = "material-icons adventure-text-icon";
                    iconEl.textContent = icon;
                    block.appendChild(iconEl);
                }
                const contentWrapper = document.createElement("div");
                contentWrapper.className = "adventure-text-content";
                this.#renderMarkdownContent(contentWrapper, this.#getXMLNodeContent(node));
                block.appendChild(contentWrapper);
                break;
                
            case "speech": 
                block = this.#createSpeechBlock(node); 
                break;
                
            case "image": 
                block = this.#createImageBlock(node, msg, index); 
                break;
                
            case "pause": 
                block = document.createElement("div"); 
                block.className = "adventure-block adventure-pause"; 
                block.dataset.duration = node.getAttribute("duration") || "0"; 
                break;
                
            case "webview": 
                block = this.#createWebviewBlock(node); 
                break;

            case "noop_continue":
                block = document.createElement("div");
                block.className = "adventure-continue-divider";
                block.innerHTML = `
                    <div class="adventure-continue-line"></div>
                    <div class="adventure-continue-text">
                        <span class="material-icons">fast_forward</span>
                        Autocontinue
                    </div>
                    <div class="adventure-continue-line"></div>
                `;
                break;
                
            default: return null;
        }
        return block;
    }

    #renderMarkdownContent(targetElement, contentString) {
        // Pre-process to expand self-closing <ref /> tags to <ref></ref>.
        // In HTML5 parsing (used by tempDiv.innerHTML), non-void self-closing tags 
        // are treated as opening tags, causing subsequent text to be included inside the ref element.
        const protectedContent = (contentString || '').replace(/<ref([^>]*?)\s*\/>/gi, '<ref$1></ref>');

        const htmlContent = window.marked.parse(protectedContent);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        while (tempDiv.firstChild) {
            targetElement.appendChild(tempDiv.firstChild);
        }
        
        const refs = targetElement.querySelectorAll('ref');
        refs.forEach(ref => {
            const wrapper = document.createElement('a');
            wrapper.href = '#';
            wrapper.className = 'adventure-char-ref';
            wrapper.dataset.action = 'navigate-to-character';
            wrapper.dataset.characterId = ref.getAttribute('id');
            const name = ref.getAttribute('name');
            wrapper.style.textTransform = 'capitalize';
            wrapper.textContent = ref.textContent || name || ref.getAttribute('id');
            ref.replaceWith(wrapper);
        });
    }

    #createWebviewBlock(node) {
        const block = document.createElement("div");
        block.className = "adventure-block adventure-webview";
        let htmlContent = this.#getXMLNodeContent(node);

        const iframe = document.createElement("iframe");
        iframe.className = "webview-frame";
        iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
        
        iframe.srcdoc = htmlContent;
        block.appendChild(iframe);
        return block;
    }

    #createSpeechBlock(node) {
        const block = document.createElement("div");
        block.className = "adventure-block adventure-speech";
        
        const charId = node.getAttribute("id");
        const charName = node.getAttribute("name");
        const expressionId = node.getAttribute("expression");
        
        const character = this.#findCharacter(charId);
        const displayName = charName || character?.name || charId || "Unknown";
        
        let avatarUrl = character?.avatarUrl || "assets/images/default_avatar.svg";
        
        if (expressionId && character?.expressions) {
            const expr = character.expressions.find(e => e.name.toLowerCase() === expressionId.toLowerCase());
            if (expr) avatarUrl = expr.url;
        }

        const avatarEl = document.createElement("img");
        avatarEl.className = "adventure-speaker-avatar";
        avatarEl.src = avatarUrl;
        avatarEl.alt = displayName;
        
        // No wrapper needed for float layout!
        // We append elements directly to the block so they flow around the float.
        
        const nameEl = document.createElement("div");
        nameEl.className = "adventure-speaker-name";
        nameEl.textContent = displayName;
        
        const textEl = document.createElement("div");
        textEl.className = "adventure-speech-content";
        this.#renderMarkdownContent(textEl, this.#getXMLNodeContent(node));
        
        // Append in order: Float (avatar), then Block (name), then Block (text)
        block.appendChild(avatarEl);
        block.appendChild(nameEl);
        block.appendChild(textEl);
        
        return block;
    }

    #createImageBlock(node, msg, index = -1) {
        const block = document.createElement("div");
        block.className = "adventure-block adventure-image";
        
        let imageUrl = node.getAttribute("src");
        
        if (imageUrl) {
            const imgContainer = document.createElement("div");
            imgContainer.className = "adventure-image-container";
            const img = document.createElement("img");
            img.className = "adventure-image-display";
            img.onload = () => {
                block.classList.add(img.naturalWidth / img.naturalHeight < 1 ? 'layout-side-by-side' : 'layout-overlay');
            };
            img.src = imageUrl;
            imgContainer.appendChild(img);
            block.appendChild(imgContainer);
        }
        
        if (node.childNodes.length > 0) {
            const contentContainer = document.createElement("div");
            contentContainer.className = "adventure-image-content";
            const textBlock = document.createElement("div");
            textBlock.className = "adventure-block adventure-text";
            
            const icon = node.getAttribute("icon");
            if (icon) {
                const iconEl = document.createElement("span");
                iconEl.className = "material-icons adventure-text-icon";
                iconEl.textContent = icon;
                textBlock.appendChild(iconEl);
            }
            
            const contentWrapper = document.createElement("div");
            contentWrapper.className = "adventure-text-content";
            this.#renderMarkdownContent(contentWrapper, this.#getXMLNodeContent(node));
            textBlock.appendChild(contentWrapper);
            
            contentContainer.appendChild(textBlock);
            block.appendChild(contentContainer);
        }
        return block;
    }

    showDropdown(triggerElement, items) {
        const existingDropdown = this.shadowRoot.querySelector('dropdown-menu');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        const dropdown = document.createElement('dropdown-menu');
        const dropdownItems = items.map(item => {
            if (item.separator) {
                return { divider: true };
            }
            return {
                icon: item.icon,
                label: item.label,
                action: item.label, 
                danger: item.danger || false
            };
        });

        dropdown.setItems(dropdownItems);
        dropdown.addEventListener('menu-action', (e) => {
            const actionLabel = e.detail.action;
            const item = items.find(i => i.label === actionLabel);
            if (item && item.callback) {
                item.callback();
            }
            dropdown.remove();
        });

        this.shadowRoot.appendChild(dropdown);
        dropdown.open(triggerElement);
    }

    #createMessageMenuButton(msg) {
        const button = document.createElement('button');
        button.className = 'message-menu-trigger';
        // ... [Existing button setup]

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
                    icon: 'edit',
                    label: 'Edit',
                    callback: () => {
                        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
                        if (messageEl) this.#handleEditMessage(messageId, messageEl);
                    }
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

            // Only show Rewind if it's NOT the very last message
            if (!isLastMessage) {
                items.push({
                    icon: 'fast_rewind',
                    label: 'Rewind Here',
                    callback: () => this.rewindToMessage(messageId),
                    danger: true
                });
            }

            items.push(
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
            <form id="chat-form">
                <div id="chat-toolbar">
                    <button id="go-to-parent-btn" class="icon-button" type="button" title="Go to Parent Chat" style="display: none;">
                        <span class="material-icons">arrow_upward</span>
                    </button>
                    <button id="quick-regen-btn" class="icon-button" type="button" title="Regenerate Last Response">
                        <span class="material-icons">replay</span>
                    </button>
                    <button id="continue-btn" class="icon-button" type="button" title="Continue Story">
                        <span class="material-icons">fast_forward</span>
                    </button>
                    <div class="toolbar-divider"></div>
                    <button id="curation-toggle" class="icon-button toggle-btn" type="button" title="Toggle Curation">
                        <span class="material-icons">auto_fix_high</span>
                    </button>
                    <div style="flex-grow: 1;"></div>
                    <button id="input-mode-btn" class="icon-button" type="button" title="Switch to Plaintext Input">
                        <span class="material-icons">notes</span>
                    </button>
                    <button id="user-persona-btn" class="persona-btn" type="button" title="Change User Persona">
                        <span id="user-persona-name">Select Persona</span>
                        <img id="user-persona-avatar" src="assets/images/default_avatar.svg" alt="User Persona">
                    </button>
                    <button type="submit" class="send-button" title="Send"><span class="material-icons">send</span></button>
                </div>
                <div id="input-scroll-container">
                    <div id="block-input-list"></div>
                </div>
                <div id="plaintext-input-container" style="display: none;">
                    <text-box id="plaintext-input" placeholder="Type a message..."></text-box>
                </div>
            </form>

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
            #chat-history {
                display: flex; 
                flex-direction: column; 
                flex-grow: 1; 
                overflow-y: auto; 
                overflow-x: hidden; 
                padding-left: var(--spacing-lg);
                padding-right: var(--spacing-lg); 
                gap: var(--spacing-md);
                /* IMPORTANT: Extra buffer to allow smooth scrolling without layout jumps */
                padding-bottom: 50vh;
            }
            #history-loader-container { min-height: 36px; }
            .loader-wrapper { display: flex; justify-content: center; padding: var(--spacing-xs) 0; }
            #load-more-btn { padding: var(--spacing-xs) var(--spacing-md); font-size: 0.6rem; }
            
            #chat-form {
                display: flex;
                flex-direction: column;
                border-top: 1px solid var(--bg-3);
                background-color: var(--bg-1);
                flex-shrink: 0;
            }

            #input-scroll-container {
                max-height: 50vh;
                overflow-y: auto;
                padding: 0;
            }
            
            #plaintext-input-container {
                padding: 0;
                background-color: var(--bg-1);
            }
            
            #plaintext-input {
                min-height: 120px;
                max-height: 50vh;
                background-color: var(--bg-0);
                border-radius: var(--radius-sm);
                padding: var(--spacing-sm);
            }

            #chat-toolbar {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                padding: var(--spacing-xs);
                border-bottom: 1px solid var(--bg-3);
                background-color: var(--bg-0);
                min-height: 36px;
                overflow-x: auto;
                white-space: nowrap;
                scrollbar-width: none; 
                -ms-overflow-style: none; 
            }
            #chat-toolbar::-webkit-scrollbar { display: none; }

            .toolbar-divider { width: 1px; height: 20px; background-color: var(--bg-3); flex-shrink: 0; }

            .icon-button {
                width: 32px; height: 32px; border: none; background: transparent; color: var(--text-secondary);
                border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; justify-content: center;
                transition: background-color var(--transition-fast), color var(--transition-fast); flex-shrink: 0;
            }
            .icon-button:hover:not(:disabled) { background-color: var(--bg-2); color: var(--text-primary); }
            .icon-button:disabled { color: var(--text-disabled); cursor: not-allowed; opacity: 0.4; }
            .icon-button .material-icons { font-size: 18px; }
            .toggle-btn.active { color: var(--accent-primary); background-color: var(--bg-2); }

            .persona-btn {
                width: auto; 
                height: 32px; 
                border: none; 
                background: transparent;
                border-radius: var(--radius-sm);
                cursor: pointer;
                display: flex; align-items: center; gap: var(--spacing-sm);
                transition: background-color var(--transition-fast);
            }
            .persona-btn:hover { background-color: var(--bg-2); }
            #user-persona-name { color: var(--text-secondary); font-size: var(--font-size-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; font-style: italic; }
            #user-persona-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background-color: var(--bg-3); flex-shrink: 0; }
            
            #block-input-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
                width: 100%;
            }

            .send-button {
                flex-shrink: 0; 
                width: 48px; height: 32px; 
                border: none;
                background-color: transparent;
                color: var(--accent-primary);
                border-radius: var(--radius-sm); 
                cursor: pointer;
                display: flex; align-items: center; justify-content: center; 
                transition: background-color var(--transition-fast);
            }
            .send-button:hover:not(:disabled) { filter: brightness(1.15); }
            .send-button:disabled { background-color: transparent; color: var(--text-disabled); cursor: not-allowed; opacity: 0.4; }
            .send-button.stop-button { background-color: transparent; color: var(--accent-danger); }
            .send-button.stop-button:hover { filter: brightness(1.15); }
            .send-button .material-icons { font-size: 20px; }
            
            /* Ghost/Placeholder block styling */
            adventure-block-editor.placeholder {
                opacity: 0.6;
                border: 2px dotted var(--bg-3);
                border-radius: var(--radius-md);
                min-height: 48px;
                cursor: pointer;
                transition: all 0.2s;
                margin-bottom: 0 !important; /* Remove bottom margin to sit flush */
            }
            adventure-block-editor.placeholder:hover {
                opacity: 0.9;
                border-color: var(--accent-primary);
                background-color: var(--bg-2);
            }
            
            /* Message Editing Styles */
            .edit-controls {
                display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;
            }
            
            .chat-message { display: flex; flex-direction: column; gap: 0; position: relative; font-size: 0.6rem; margin-bottom: var(--spacing-sm); }
            .chat-message.assistant.adventure-mode { position: relative; }
            .chat-message:not(.assistant.adventure-mode) { display: flex; width: 100%; }
            .chat-message .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-top: 3px; background-color: var(--bg-3); }
            .message-bubble { background-color: var(--accent-primary-faded); padding-bottom: var(--spacing-md); padding-left: var(--spacing-md); flex-grow: 1; position: relative; width: 100%; border-radius: var(--radius-sm); }
            .chat-message.user .message-bubble { position: relative; display: flex; flex-direction: column; color: var(--text-primary); padding-bottom: var(--spacing-sm); width: 100%; }
            .message-content { font-size: 0.6rem; line-height: 1.4; }
            .chat-message.user { margin-left: var(--spacing-md); }
            .message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-xs); margin-top: var(--spacing-xs); }
            .author-name { font-weight: 600; font-size: 0.6rem; }
            
            .adventure-pause { display: none; }

            #input-mode-btn { opacity: 0;  }
            
            /* Menu button styling */
            .message-menu-trigger {
                background: transparent; border: none; cursor: pointer; color: var(--text-secondary);
                padding: 2px; display: inline-flex; align-items: center; justify-content: center;
                width: 24px; height: 24px; border-radius: var(--radius-sm); transition: var(--transition-fast);
            }
            .message-menu-trigger:hover { background-color: var(--bg-2); color: var(--text-primary); }
            .message-menu-trigger .material-icons { font-size: 18px; }
            .message-header .message-menu-trigger { transition: opacity var(--transition-fast); }
            .message-bubble:hover .message-menu-trigger { opacity: 1; }
            .chat-message.adventure-mode .message-menu-trigger.adventure-menu {
                position: absolute; top: var(--spacing-xs); right: var(--spacing-xs); transition: opacity var(--transition-fast); z-index: 5;
            }
            .chat-message.user.adventure-mode .message-menu-trigger.adventure-menu { background-color: var(--bg-1); top: 0; right: calc(var(--spacing-lg) + var(--spacing-sm)); }
            
            .chat-message.adventure-mode:hover .message-menu-trigger.adventure-menu { opacity: 1; }

            .adventure-fade-in { animation: fadeIn 0.4s ease-out both; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            
            /* -- New Block Styles -- */
            .adventure-block { padding-top: 0; transition: opacity 0.4s ease-out; font-size: 0.6rem; margin-bottom: var(--adventure-block-gap, 0.75rem); }
            
            .adventure-text {
                position: relative;
                display: flow-root;
                color: var(--text-secondary);
                padding: 0 calc(var(--spacing-md));
                line-height: 1.5;
                z-index: 0;
                background-color: transparent;
            }

            .adventure-text-icon {
                font-size: 32px;
                color: var(--accent-primary);
                float: left;
                margin-right: 6px;
                margin-top: 4px;
            }

            :not(.assistant) .adventure-text-icon {
                margin-left: 0;
                transform: translateX(-4px);
            }
            
            .adventure-text-content {
                position: relative;
                display: block;
                text-align: justify;
                text-wrap: pretty;
                hyphens: auto;
            }
            .adventure-text-content p { margin: 0 0 1em 0; }
            .adventure-text-content p:last-child { margin: 0; }
            .chat-message:not(.assistant) .adventure-block::before {
                content: "";
                display: block;
                width: 10000px;
                padding: 0;
                margin: 0;
                background-color: var(--accent-primary-faded);
                position: absolute;
                left: calc(-1 * (100svw - 100% + var(--spacing-lg)));
                top: calc(-1 * calc(var(--spacing-md)) / 2);
                right: 0;
                bottom: 0;
                z-index: -1;
            }
            .adventure-speech { 
                position: relative;
                /* Float Layout Implementation */
                display: flow-root; /* Contains floats */
                padding-left: calc(var(--spacing-md) + 4px); /* Space for the vertical line */
                text-align: justify;
            }
            .adventure-speech::before {
                content: "";
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 1px;
                outline: 4px dotted var(--accent-primary);
                background-color: var(--accent-primary);
                border-radius: 4px;
            }
            .adventure-speaker-avatar {
                float: left;
                margin-right: 8px;
                box-shadow: 0 0px 2px 2px var(--bg-1);
                width: 96px; height: 96px;
                border-radius: var(--radius-md);
                object-fit: cover;
                background-color: var(--bg-3);
            }
            .adventure-speaker-name {
                font-weight: 600; color: var(--text-primary);
                font-size: 1.2rem; margin-bottom: 2px;
                display: block; /* Ensures name takes up a line */
            }
            .adventure-speech-content {
                color: var(--text-secondary);
                line-height: 1.4;
                font-size: 0.6rem; /* Match narration text size */
                display: block; /* Text follows flow rules around float */
            }
            .adventure-speech-content p { margin: 0; line-height: 1.4; }
            .adventure-speech-content p:last-child { margin: 0; }

            .adventure-webview {
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                overflow: hidden;
                background-color: var(--bg-0);
            }
            .webview-frame {
                width: 100%; border: none; height: 300px; display: block;
            }
            
            .adventure-char-ref { color: var(--accent-primary); text-decoration: none; font-weight: 600; cursor: pointer; }
            .adventure-char-ref:hover { text-decoration: underline; }

            .adventure-image { display: grid; border-radius: var(--radius-md); overflow: hidden; background-color: var(--bg-0); }
            .adventure-image.layout-overlay { grid-template-columns: 1fr; grid-template-rows: auto; }
            .adventure-image.layout-side-by-side { grid-template-columns: 200px 1fr; }
            .adventure-image-container { grid-area: 1 / 1; width: 100%; display: flex; justify-content: center; align-items: center; }
            .adventure-image-display { width: 100%; height: auto; object-fit: cover; cursor: pointer; }
            .adventure-image-content { grid-area: 1 / 1; z-index: 1; display: flex; flex-direction: column; justify-content: flex-end; }
            .adventure-image.layout-side-by-side .adventure-image-content { grid-area: 1 / 2; padding: var(--spacing-md); }
            .adventure-image.layout-overlay .adventure-image-content { padding: var(--spacing-md); background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.6) 50%, transparent 100%); }
            
            /* Autocontinue Divider Styles */
            .adventure-continue-divider {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                width: 100%;
                opacity: 0.8;
                user-select: none;
                transform: translateX(-12px);
            }
            .adventure-continue-line {
                flex-grow: 1;
                height: 1px;
                background-color: var(--accent-primary);
                opacity: 0.5;
            }
            .adventure-continue-text {
                color: var(--accent-primary);
                font-size: 0.75rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .adventure-continue-text .material-icons {
                font-size: 16px;
            }

            /* Modal Styles */
            .modal-backdrop { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.7); z-index: 1000; align-items: center; justify-content: center; }
            .modal-content { background-color: var(--bg-1); border-radius: var(--radius-md); max-width: 500px; width: 90%; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); }
            .modal-content header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md) var(--spacing-lg); border-bottom: 1px solid var(--bg-3); }
            .modal-content header h2 { margin: 0; font-size: 1.2rem; color: var(--text-primary); }
            .close-modal-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            .close-modal-btn:hover { color: var(--text-primary); background-color: var(--bg-2); }
            .modal-body { display: flex; flex-direction: column; overflow-y: auto; flex-grow: 1; gap: var(--spacing-md); padding: var(--spacing-md); }
            .modal-search-bar { display: flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); border: 1px solid var(--bg-3); background-color: var(--bg-0); border-radius: var(--radius-sm); flex-shrink: 0; }
            .modal-search-bar input { background: none; border: none; outline: none; width: 100%; color: var(--text-primary); font-size: 0.9rem; }
            .character-list { display: flex; flex-direction: column; gap: var(--spacing-xs); }
            .character-item { display: flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); background-color: var(--bg-0); border-radius: var(--radius-sm); cursor: pointer; transition: var(--transition-fast); border: 1px solid transparent; }
            .character-item:hover { background-color: var(--bg-2); }
            .character-item.is-persona { background-color: var(--accent-primary-faded); border-color: var(--accent-primary); }
            .character-item img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background-color: var(--bg-3); flex-shrink: 0; }
            .character-item .character-name { flex-grow: 1; color: var(--text-primary); font-size: 0.9rem; font-weight: 500; }
            .character-item .persona-icon { color: var(--accent-good); font-size: 20px; }
            
            @media (max-width: 768px) {
                #chat-history { 
                    padding: var(--spacing-md);
                    gap: var(--spacing-sm); 
                }
                .chat-message { display: flex; flex-direction: column; font-size: 0.6rem; gap: var(--spacing-sm); }
                .message-header .message-menu-trigger, .chat-message.assistant.adventure-mode .message-menu-trigger.adventure-menu { opacity: 1; }
                .adventure-speech { gap: 8px; font-size: 0.6rem; }
                .adventure-speaker-avatar { width: 64px; height: 64px; border-radius: var(--radius-sm); }
                .adventure-image, .adventure-image.layout-side-by-side, .adventure-image.layout-overlay { display: flex; flex-direction: column; background-color: var(--bg-0); }
                .adventure-image-container { order: 1; max-height: 250px; }
                .adventure-image-display { object-fit: contain; }
                .adventure-image-content { order: 2; grid-area: auto; padding: var(--spacing-sm) var(--spacing-md); background: none; color: inherit; }
                .adventure-text *,
                .adventure-speech-content,
                .adventure-speech-content * {
                    font-size: 12px;
                    line-height: 1.4;
                }
                .adventure-speaker-name {
                    font-size: 0.85rem;
                }
            }
        `;
    }
}

customElements.define('adventure-chat-mode', AdventureChatMode);
chatModeRegistry.register('adventure', 'adventure-chat-mode');