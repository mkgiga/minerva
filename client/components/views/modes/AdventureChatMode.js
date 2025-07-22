// client/components/views/modes/AdventureChatMode.js
import { BaseChatMode } from './BaseChatMode.js';
import { chatModeRegistry } from '../../../ChatModeRegistry.js';
import { notifier, uuidv4, imagePreview } from '../../../client.js';
import '../../TextBox.js';
import '../../Spinner.js';

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

    static getSettingsSchema() {
        return [
            {
                name: 'scrollSpeed',
                label: 'Typewriter Speed (ms per character)',
                type: 'range',
                min: 0,
                max: 100,
                step: 1,
                description: 'The delay between each character appearing in the typewriter effect. Set to 0 for instant text.'
            },
            {
                name: 'blockGap',
                label: 'Gap Between Blocks (rem)',
                type: 'range',
                min: 0,
                max: 4,
                step: 0.25,
                description: 'The vertical spacing between action, dialogue, and other blocks.'
            },
            {
                name: 'autoScroll',
                label: 'Enable Auto-Scrolling',
                type: 'checkbox',
                description: 'Automatically scroll to the newest content as it is being generated during live responses.'
            }
        ];
    }

    static getDefaultSettings() {
        return {
            scrollSpeed: 30,
            blockGap: 1.5, // Corresponds to --spacing-lg
            autoScroll: true,
        };
    }

    onInitialize() {
        console.log('[AdventureChatMode] onInitialize');
        this.render();
        this.#historyContainer = this.shadowRoot.querySelector('#chat-history');
        this.#form = this.shadowRoot.querySelector('#chat-form');
        this.#textbox = this.#form.querySelector('text-box');
        this.#sendButton = this.#form.querySelector('.send-button');
        this.#quickRegenButton = this.shadowRoot.querySelector('#quick-regen-btn');

        // Apply initial settings
        this.#settings = this.settings;
        this.#applySettings();

        // Unify form submission and button clicks into a single handler
        // to prevent a race condition from double-sends.
        this.#form.addEventListener('submit', this.#handleSend.bind(this));
        this.#sendButton.addEventListener('click', this.#handleSend.bind(this));

        this.#textbox.addEventListener('keydown', this.#handleTextboxKeydown.bind(this));

        // Enable/disable send button based on input
        this.#textbox.addEventListener('input', () => {
            if (!this.isSending) {
                this.#sendButton.disabled = this.#textbox.value.trim() === '';
            }
        });
        
        if (this.#quickRegenButton) {
            this.#quickRegenButton.addEventListener('click', this.#handleQuickRegen.bind(this));
        }

        this.#historyContainer.addEventListener('click', this.#handleHistoryClick.bind(this));
    }
    
    // Lifecycle Hooks

    onSettingsChanged(newSettings) {
        console.log('[AdventureChatMode] onSettingsChanged', newSettings);
        this.#settings = { ...this.#settings, ...newSettings };
        this.#applySettings();
        // For a purely visual change like this, we can avoid a full re-render.
        // If a setting required re-rendering the HTML, we'd call `this.refreshChatHistory()` here.
    }

    #applySettings() {
        this.style.setProperty('--adventure-block-gap', `${this.#settings.blockGap}rem`);
    }

    onChatSwitched() { this.refreshChatHistory(); }
    onChatBranched() { this.refreshChatHistory(); }
    onParticipantsChanged() { this.refreshChatHistory(); }
    onAllCharactersChanged() { this.refreshChatHistory(); }
    onUserPersonaChanged() { this.refreshChatHistory(); }

    onMessagesAdded(addedMessages) {
        console.log('[AdventureChatMode] onMessagesAdded', addedMessages);
        // This event is fired after a prompt/response cycle from the backend.
        // We find the optimistically-created elements and update them with the final
        // data from the server.
        const optimisticUserEl = this.shadowRoot.querySelector('.chat-message[data-message-id^="user-"]');
        const optimisticAssistantEl = this.shadowRoot.querySelector('.chat-message[data-message-id^="assistant-"]');

        if (optimisticUserEl && optimisticAssistantEl && addedMessages.length >= 2) {
            const finalUserMsg = addedMessages.at(-2);
            const finalAssistantMsg = addedMessages.at(-1);

            // Update the user message with its final ID and content.
            this.#updateMessageContent(optimisticUserEl, finalUserMsg);
            
            // For the assistant message, we assume the streaming animation has already
            // rendered the correct content. We ONLY update its dataset to the final
            // server ID so that future interactions (edit, delete, regen) work correctly.
            // We do NOT re-render its content here, as that would overwrite the animation.
            optimisticAssistantEl.dataset.messageId = finalAssistantMsg.id;
        } else {
            // Fallback for unexpected cases (e.g., if optimistic elements not found).
            this.refreshChatHistory();
        }
    }

    onMessageUpdated(updatedMessage) {
        console.log('[AdventureChatMode] onMessageUpdated', updatedMessage);
        // If this message was just animated by a stream finishing, we must not touch
        // its content, as the animation is the source of truth. We consume the flag
        // and prevent the re-render. This allows future, legitimate updates (e.g., an edit)
        // to proceed normally.
        if (this.#justAnimatedMessageIds.has(updatedMessage.id)) {
            this.#justAnimatedMessageIds.delete(updatedMessage.id);
            return;
        }

        // This handles non-animated updates, like edits, but respects any
        // ongoing (but separate) animation.
        if (this.#isAnimating) return;
        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${updatedMessage.id}"]`);
        if (messageEl) {
            this.#updateMessageContent(messageEl, updatedMessage);
        }
    }

    onMessagesDeleted(deletedMessageIds) {
        console.log('[AdventureChatMode] onMessagesDeleted', deletedMessageIds);
        if (this.#isAnimating) return;
        for (const id of deletedMessageIds) {
            this.shadowRoot.querySelector(`.chat-message[data-message-id="${id}`)?.remove();
        }
        this.updateInputState();
    }
    
    // Overridden BaseChatMode Methods
    
    onPromptStart(userMessage) {
        console.log('[AdventureChatMode] onPromptStart', userMessage);
        this.appendMessage(userMessage);
        
        const assistantSpinnerMessage = {
            id: `assistant-${uuidv4()}`,
            role: 'assistant',
            content: '<minerva-spinner mode="infinite"></minerva-spinner>',
            timestamp: new Date().toISOString()
        };
        this.appendMessage(assistantSpinnerMessage);

        this.clearUserInput();
        return assistantSpinnerMessage.id;
    }

    onRegenerateStart(messageId) {
        console.log('[AdventureChatMode] onRegenerateStart', messageId);
        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
        const messageData = this.getMessageById(messageId);
        
        if (!messageData) return;

        if (messageData.role === 'assistant') {
            if (messageEl) {
                const spinnerMessage = { ...messageData, content: '<minerva-spinner mode="infinite"></minerva-spinner>' };
                this.#updateMessageContent(messageEl, spinnerMessage);
            }
        } else if (messageData.role === 'user') {
            // For resending a user prompt, we add a new spinner message below it.
            const assistantSpinnerMessage = {
                id: `assistant-${uuidv4()}`,
                role: 'assistant',
                content: '<minerva-spinner mode="infinite"></minerva-spinner>',
                timestamp: new Date().toISOString()
            };
            this.appendMessage(assistantSpinnerMessage);
            // This case doesn't need a specific messageId to update, a new one will be created.
        }
    }

    // User Input and UI Logic

    #handleSend(event) {
        event.preventDefault();
        if (this.isSending) {
            this.dispatch('chat-mode-abort-generation');
            return;
        }
        const promptText = this.getUserInput();
        if (promptText && !this.#sendButton.disabled) {
            this.sendPrompt(promptText);
        }
    }

    #handleTextboxKeydown(event) {
        if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault();
            if (this.#sendButton && !this.#sendButton.disabled) {
                this.#handleSend(event);
            }
        }
    }

    #handleQuickRegen() {
        if (this.isSending || this.#isAnimating || !this.chat || this.chat.messages.length === 0) {
            return;
        }
        const lastMessage = this.chat.messages.at(-1);
        this.regenerateMessage(lastMessage.id);
    }

    #handleHistoryClick(event) {
        // Handle prompt collapse/expand
        const header = event.target.closest('.adventure-prompt-header');
        if (header) {
            const promptBlock = header.closest('.adventure-prompt');
            if (promptBlock) {
                promptBlock.classList.toggle('collapsed');
                const icon = header.querySelector('.expand-icon');
                if (icon) {
                    icon.textContent = promptBlock.classList.contains('collapsed') ? 'unfold_more' : 'unfold_less';
                }
            }
            return; // Exit after handling prompt header click
        }

        // Handle avatar click for image preview
        const avatarImg = event.target.closest('.adventure-speaker-avatar');
        if (avatarImg && avatarImg.tagName === 'IMG') {
            imagePreview.show({ src: avatarImg.src, alt: avatarImg.alt });
            return; // Exit after handling avatar click
        }
        
        // Handle show image click for image preview
        const showImage = event.target.closest('.adventure-show-image');
        if (showImage && showImage.tagName === 'IMG') {
            imagePreview.show({ src: showImage.src, alt: showImage.alt });
            return; // Exit after handling show image click
        }
        
        // Handle other action buttons if needed
        for (const button of event.composedPath()) { // Use composedPath for elements inside shadow DOM
            if (button.tagName === 'BUTTON' && button.dataset.action) {
                const messageId = button.closest('.chat-message')?.dataset.messageId;
                if (!messageId) continue;

                const action = button.dataset.action;
                if (action === 'adventure-choice') {
                    event.preventDefault();
                    this.sendPrompt(`<choice>${button.dataset.choiceText}</choice>`);
                    return; // Handled choice button
                } else if (action === 'navigate-to-character') {
                    event.preventDefault();
                    this.dispatch('navigate-to-view', { view: 'characters', state: { selectedCharacterId: button.dataset.characterId } });
                    return; // Handled character navigation
                } else if (button.closest('.message-controls')) {
                    // It's one of the common message controls (delete, branch, regen, edit, copy)
                    event.preventDefault();
                    switch(action) {
                        case 'delete': this.deleteMessage(messageId); break;
                        case 'branch': this.branchFromMessage(messageId); break;
                        case 'regenerate': this.regenerateMessage(messageId); break;
                        case 'edit': this.#handleEditMessage(messageId, button.closest('.chat-message')); break;
                        case 'copy': { const msg = this.getMessageById(messageId); if (msg) this.copyMessageContent(msg.content); break; }
                    }
                    return; // Handled message control
                }
            }
        }
    }

    #handleEditMessage(messageId, messageEl) {
        // Determine the main container for the message's content.
        // For adventure messages, it's the message element itself. For others, it's .message-content.
        const isAdventure = messageEl.classList.contains('adventure-mode');
        const contentContainer = isAdventure ? messageEl : messageEl.querySelector('.message-content');

        if (!contentContainer) {
            console.warn("Could not find content container to edit for message:", messageId);
            return;
        }

        const originalContent = this.getMessageById(messageId)?.content || '';
        
        const editor = document.createElement('text-box');
        editor.value = originalContent;
        editor.style.minHeight = '150px';
        editor.style.height = `${Math.max(contentContainer.offsetHeight, 150)}px`;
        
        // For adventure messages, we need to preserve the controls which are a direct child.
        const controls = isAdventure ? messageEl.querySelector('.message-controls') : null;

        // Clear the container and add the editor, preserving controls if necessary.
        contentContainer.innerHTML = '';
        if (controls) {
            contentContainer.appendChild(controls);
        }
        contentContainer.appendChild(editor);
        editor.focus();

        let isCancelled = false;
        const onKeydown = e => {
            if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); editor.blur(); } 
            else if (e.key === 'Escape') { e.preventDefault(); isCancelled = true; editor.blur(); }
        };

        const onBlur = () => {
            editor.removeEventListener('keydown', onKeydown);
            editor.removeEventListener('blur', onBlur);
            
            // Re-rendering the message from data is the cleanest way to restore its state.
            const newContent = editor.value;
            if (isCancelled || newContent.trim() === originalContent.trim()) {
                // If cancelled or unchanged, restore the original view.
                this.#updateMessageContent(messageEl, this.getMessageById(messageId));
            } else {
                // If changed, dispatch the save event. The update will come via SSE.
                this.saveEditedMessage(messageId, newContent);
            }
        };
        
        editor.addEventListener('keydown', onKeydown);
        editor.addEventListener('blur', onBlur);
    }

    getUserInput() { return this.#textbox.value; }
    clearUserInput() { this.#textbox.value = ''; }

    updateInputState(isSending = false) {
        this.isSending = isSending;
        if (!this.#textbox || !this.#sendButton) return;

        this.#textbox.disabled = isSending || this.#isAnimating;

        const sendIcon = this.#sendButton.querySelector('.material-icons');
        if (isSending) {
            this.#sendButton.disabled = false;
            this.#sendButton.title = 'Stop Generation';
            this.#sendButton.classList.add('stop-button');
            if (sendIcon) sendIcon.textContent = 'stop';
        } else {
            this.#sendButton.disabled = this.getUserInput().trim() === '' || this.#isAnimating;
            this.#sendButton.title = 'Send';
            this.#sendButton.classList.remove('stop-button');
            if (sendIcon) sendIcon.textContent = 'send';
        }

        if (this.#quickRegenButton) {
            this.#quickRegenButton.disabled = isSending || this.#isAnimating || !this.chat || this.chat.messages.length === 0;
        }
    }
    
    // Stream Lifecycle Hooks
    
    onStreamStart(messageId) {
        console.log(`[AdventureChatMode] onStreamStart for messageId: ${messageId}`);
        this.#streamingContent.set(messageId, '');
    }

    onToken(token, messageId) {
        console.log(`[AdventureChatMode] onToken for messageId: ${messageId}`, token);
        // During streaming, we just append the new token to our buffer for that messageId.
        // We do not touch the DOM here. The rendering will happen once in onStreamFinish.
        if (this.#streamingContent.has(messageId)) {
            this.#streamingContent.set(messageId, this.#streamingContent.get(messageId) + token);
        }
        
        // We can still perform actions that don't involve rendering the content, like auto-scrolling.
        if (this.#settings.autoScroll) {
            this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight;
        }
    }

    async onStreamFinish(messageId) {
        console.log(`[AdventureChatMode] onStreamFinish for messageId: ${messageId}`);
        const finalContent = this.#streamingContent.get(messageId);
        if (finalContent === undefined) return;

        // FIX: Handle race condition where onMessagesAdded updates the element ID before this runs.
        let messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
        if (!messageEl) {
            // The optimistic element ID was likely updated. Find it by its unique prefix.
            // This is safe because there should only ever be one optimistic assistant message at a time.
            messageEl = this.shadowRoot.querySelector('.chat-message[data-message-id^="assistant-"]');
        }
        
        if (messageEl) {
            // Flag this message as having been animated. We use the element's *current* ID,
            // which might be the final ID from the server if the race condition occurred.
            this.#justAnimatedMessageIds.add(messageEl.dataset.messageId);

            // The message being streamed is always from the assistant.
            // We create a temporary message object for the animation function, ensuring role is set.
            const messageToAnimate = { id: messageEl.dataset.messageId, role: 'assistant', content: finalContent };
            await this.#animateVnResponse(messageEl, messageToAnimate);
        }
        
        this.#streamingContent.delete(messageId);
    }
    
    onStreamError(error, messageId) {
        console.log(`[AdventureChatMode] onStreamError for messageId: ${messageId}`, error);
        const content = error.name === 'AbortError' 
            ? `${this.#streamingContent.get(messageId) || ''}\n\n\n*Generation stopped by user.*`
            : `**Error:** Could not get response.\n*${error.message}*`;

        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
        if (messageEl) {
            const errorMsg = { id: messageId, role: 'assistant', content };
            this.#updateMessageContent(messageEl, errorMsg);
        }
        this.#streamingContent.delete(messageId);
    }
    
    // Rendering and View Logic

    refreshChatHistory() {
        console.log('[AdventureChatMode] refreshChatHistory');
        if (!this.#historyContainer || !this.chat) {
            this.#historyContainer.innerHTML = '';
            return;
        }

        this.#lastUnansweredPromptEl = null;
        this.#historyContainer.innerHTML = '';
        
        for (let i = 0; i < this.chat.messages.length; i++) {
            const msg = this.chat.messages[i];
            if (msg.role === 'user' && msg.content.startsWith('<choice>')) {
                const prevMsg = this.chat.messages[i - 1];
                if (prevMsg?.role === 'assistant' && prevMsg.content.includes('<prompt>')) continue;
            }
            this.appendMessage(msg, false, i);
        }
        
        if (this.#lastUnansweredPromptEl) {
            this.#lastUnansweredPromptEl.classList.remove('collapsed');
            const icon = this.#lastUnansweredPromptEl.querySelector('.expand-icon');
            if (icon) icon.textContent = 'unfold_less';
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
    }

    #findCharacter(idOrName) {
        if (!idOrName) return undefined;
        const charById = this.getCharacterById(idOrName);
        if (charById) return charById;
        const lowerCaseName = idOrName.toLowerCase();
        return this.allCharacters.find(c => c.name.toLowerCase() === lowerCaseName);
    }

    #createMessageElement(msg) {
        const messageEl = document.createElement('div');
        messageEl.dataset.messageId = msg.id;
        return messageEl;
    }
    
    #attachListenersToElement(element) {
        // All listeners are now attached via the single #handleHistoryClick delegator.
        // This method only needs to be called if you dynamically create new interactive elements
        // AFTER the initial render or after content is animated.
        // For this mode, the core elements are rendered by #updateMessageContent and then
        // the #handleHistoryClick is set up on the container.
        // This function is now implicitly handled by the one listener on `#historyContainer`.
    }

    #updateMessageContent(messageEl, msg, index = -1) {
        messageEl.dataset.messageId = msg.id;

        if (msg.role !== 'assistant') {
            const isUser = msg.role === 'user';
            const isPlayerChoice = isUser && msg.content.startsWith('<choice>') && msg.content.endsWith('</choice>');
            const roleClass = isPlayerChoice ? 'player-choice' : msg.role;
            const author = isUser ? this.getCharacterById(msg.characterId) : null;
            const authorName = author?.name || 'You';
            let content = isPlayerChoice ? this.#escapeHtml(msg.content.slice(8, -9)) : this.#escapeHtml(msg.content).replace(/\n/g, '<br>');
            const avatarHTML = isUser ? '' : `<img src="assets/images/system_icon.svg" alt="System" class="avatar">`;

            messageEl.className = `chat-message ${roleClass}`;
            messageEl.innerHTML = `
                ${avatarHTML}
                <div class="message-bubble">
                    <div class="message-header"><span class="author-name">${authorName}</span>${this.#renderMessageControlsHTML(msg)}</div>
                    <div class="message-content">${content}</div>
                </div>`;
        } else {
            const content = msg.content || '';
            if (content.includes('<minerva-spinner')) {
                messageEl.className = 'chat-message assistant adventure-mode';
                messageEl.innerHTML = `<div class="message-controls">${this.#renderMessageControlsHTML(msg)}</div><div class="message-content">${content}</div>`;
                // No need to attach specific listeners here, #handleHistoryClick handles it.
                return;
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(content, 'application/xml');
            const outputNode = doc.querySelector('output');
            const parserError = doc.querySelector('parsererror');

            if (parserError || !outputNode) {
                const author = this.allCharacters.find(c => c.id === this.chat.participants.find(p => !p.isAuto)?.id);
                const avatarUrl = author?.avatarUrl || 'assets/images/assistant_icon.svg';
                const authorName = author?.name || 'Assistant';
                messageEl.className = 'chat-message assistant';
                messageEl.innerHTML = `
                    <img src="${avatarUrl}" alt="${authorName}" class="avatar">
                    <div class="message-bubble">
                        <div class="message-header"><span class="author-name">${authorName}</span>${this.#renderMessageControlsHTML(msg)}</div>
                        <div class="message-content">${this.#escapeHtml(content).replace(/\n/g, '<br>')}</div>
                    </div>`;
                if (parserError) {
                    const errorDetails = document.createElement('div');
                    errorDetails.className = 'adventure-parse-error';
                    errorDetails.innerHTML = '<strong>Parse Error:</strong><pre>' + this.#escapeHtml(parserError.textContent) + '</pre>';
                    messageEl.querySelector('.message-bubble').appendChild(errorDetails);
                }
            } else {
                messageEl.className = 'chat-message assistant adventure-mode';
                const contentFragment = this.#renderVnOutput(outputNode, msg, index);
                messageEl.innerHTML = `<div class="message-controls">${this.#renderMessageControlsHTML(msg)}</div>`;
                messageEl.appendChild(contentFragment);
            }
        }
        // No need to attach specific listeners here, #handleHistoryClick handles it.
    }
    
    // Animation Logic

    #sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    async #typewriter(element, childNodes) {
        const speed = this.#settings.scrollSpeed;
        element.innerHTML = '';
    
        const part = element.closest('.adventure-speech-part');
        if (part) { part.style.animation = 'none'; part.style.opacity = '1'; }
    
        for (const node of childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                const textNode = document.createTextNode('');
                element.appendChild(textNode);
                if (speed > 0) {
                    for (const char of text) {
                        textNode.nodeValue += char;
                        if (this.#settings.autoScroll) {
                            const containerRect = this.#historyContainer.getBoundingClientRect();
                            const elementRect = element.getBoundingClientRect();
                            if (elementRect.bottom > containerRect.bottom) {
                                element.scrollIntoView({ behavior: "auto", block: "end", inline: "nearest" });
                            }
                        }
                        await this.#sleep(speed);
                    }
                } else {
                    textNode.nodeValue = text;
                    if (this.#settings.autoScroll) {
                        element.scrollIntoView({ behavior: "auto", block: "end", inline: "nearest" });
                    }
                }
            } else {
                element.appendChild(node.cloneNode(true));
                if (this.#settings.autoScroll) {
                    const containerRect = this.#historyContainer.getBoundingClientRect();
                    const elementRect = element.getBoundingClientRect();
                    if (elementRect.bottom > containerRect.bottom) {
                        element.scrollIntoView({ behavior: "auto", block: "end", inline: "nearest" });
                    }
                }
            }
        }
    }

    async #animateVnResponse(messageEl, msg) {
        this.#isAnimating = true;
        this.updateInputState(this.isSending);
        messageEl.innerHTML = '';
    
        const content = msg.content || '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'application/xml');
        const outputNode = doc.querySelector('output');
        const parserError = doc.querySelector('parsererror');
    
        if (parserError || !outputNode) {
            // If content is invalid, render it as plain text instead of animating
            this.#updateMessageContent(messageEl, msg);
            this.#isAnimating = false;
            this.updateInputState(false);
            return;
        }
    
        messageEl.className = 'chat-message assistant adventure-mode';
        messageEl.innerHTML = `<div class="message-controls">${this.#renderMessageControlsHTML(msg)}</div>`;
    
        const allBlocks = [];
        const contentsToType = new Map();
    
        for (const node of Array.from(outputNode.children)) {
            const block = this.#createVnBlock(node, msg, -1);
            if (block) {
                const elementsToTypeInBlock = [];
                if (block.classList.contains('adventure-action')) {
                    elementsToTypeInBlock.push(block);
                } else if (block.classList.contains('adventure-dialogue')) {
                    elementsToTypeInBlock.push(...block.querySelectorAll('.adventure-speech-part'));
                } else if (block.classList.contains('adventure-show')) {
                    elementsToTypeInBlock.push(...block.querySelectorAll('.adventure-action, .adventure-speech-part'));
                }
                
                for (const element of elementsToTypeInBlock) {
                    contentsToType.set(element, Array.from(element.childNodes));
                    element.innerHTML = '';
                }
    
                block.style.opacity = 0;
                messageEl.appendChild(block);
                allBlocks.push(block);
            }
        }
    
        for (const block of allBlocks) {
            block.classList.add('adventure-fade-in');
            await this.#sleep(400); // Wait for fade-in animation to complete
    
            const elementsToType = [];
            if (block.classList.contains('adventure-action')) {
                elementsToType.push(block);
            } else if (block.classList.contains('adventure-dialogue')) {
                elementsToType.push(...block.querySelectorAll('.adventure-speech-part'));
            } else if (block.classList.contains('adventure-show')) {
                elementsToType.push(...block.querySelectorAll('.adventure-action, .adventure-speech-part'));
            }
    
            for (const element of elementsToType) {
                if (element.classList.contains('adventure-speech-part')) {
                    element.style.animation = 'none';
                    element.style.opacity = '1';
                    const delayMs = parseFloat(element.style.animationDelay || 0) * 1000;
                    if (delayMs > 0) await this.#sleep(delayMs);
                }
    
                await this.#typewriter(element, contentsToType.get(element));
            }
        }
    
        this.#isAnimating = false;
        this.updateInputState(false);
        // No need to attach specific listeners here, #handleHistoryClick handles it.
    }

    // VN Block Rendering
    
    #renderVnOutput(outputNode, msg, index = -1) {
        const fragment = document.createDocumentFragment();
        for (const node of Array.from(outputNode.children)) {
            const block = this.#createVnBlock(node, msg, index);
            if (block) fragment.appendChild(block);
        }
        return fragment;
    }
    
    #createVnBlock(node, msg, index = -1) {
        const nodeName = node.nodeName.toLowerCase();
        let block;
    
        switch (nodeName) {
            case 'action':
                block = document.createElement('div');
                block.className = 'adventure-block adventure-action';
                block.appendChild(this.#renderInlineContent(node));
                break;
            case 'text':
                block = this.#createDialogueBlock(node);
                break;
            case 'prompt':
                block = document.createElement('div');
                block.className = 'adventure-block adventure-prompt collapsed';
                this.#populatePromptBlock(block, node, msg, index);
                break;
            case 'show':
                block = this.#createShowBlock(node, msg, index);
                break;
            default: return null;
        }
        return block;
    }

    #createShowBlock(node, msg, index = -1) {
        const block = document.createElement('div');
        block.className = 'adventure-block adventure-show';
    
        const fromId = node.getAttribute('from');
        const filename = node.getAttribute('filename');
    
        const character = fromId ? this.#findCharacter(fromId) : null;
        const imageItem = character?.gallery?.find(item => item.src === filename);
        
        if (imageItem?.url) {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'adventure-show-image-container';
            const img = document.createElement('img');
            img.src = imageItem.url;
            img.alt = imageItem.alt || `Image from ${character.name}`;
            img.className = 'adventure-show-image'; // Added class for click handling
            imgContainer.appendChild(img);
            block.appendChild(imgContainer);
        }
        
        const contentContainer = document.createElement('div');
        contentContainer.className = 'adventure-show-content';
        contentContainer.appendChild(this.#renderVnOutput(node, msg, index));
        block.appendChild(contentContainer);
    
        return block;
    }
    
    #populatePromptBlock(block, promptNode, msg, index = -1) {
        const header = document.createElement('div');
        header.className = 'adventure-prompt-header';
        const body = document.createElement('div');
        body.className = 'adventure-prompt-body';
        
        for (const child of Array.from(promptNode.children)) {
            if (child.nodeName.toLowerCase() === 'text') {
                const p = document.createElement('p');
                p.className = 'adventure-prompt-text';
                p.textContent = child.textContent;
                body.appendChild(p);
            }
        }

        const msgIndex = index > -1 ? index : this.chat.messages.findIndex(m => m.id === msg.id);
        const nextMessage = this.chat.messages[msgIndex + 1];
    
        if (nextMessage?.role === 'user' && nextMessage.content.startsWith('<choice>')) {
            block.classList.add('answered');
            const choiceContent = nextMessage.content.slice(8, -9);
            const choiceAuthor = this.getCharacterById(nextMessage.characterId);
            const authorName = choiceAuthor?.name || 'You';
            const authorAvatar = choiceAuthor?.avatarUrl || 'assets/images/user_icon.svg';

            header.innerHTML = `<div class="answered-prompt-header"><img src="${authorAvatar}" alt="${authorName}" class="avatar"><span class="answered-choice-text">${this.#escapeHtml(choiceContent)}</span></div><span class="material-icons expand-icon">unfold_more</span>`;
            
            const playerChoiceEl = document.createElement('div');
            playerChoiceEl.className = 'adventure-prompt-player-choice';
            playerChoiceEl.innerHTML = `<div class="message-header"><span class="author-name">${authorName}</span></div><div class="message-content">${this.#escapeHtml(choiceContent)}</div>`;
            body.appendChild(playerChoiceEl);
        } else {
            block.classList.add('unanswered');
            header.innerHTML = `<span>Player Choice</span><span class="material-icons expand-icon">unfold_more</span>`;
            for (const child of Array.from(promptNode.children)) {
                if (child.nodeName.toLowerCase() === 'choice') {
                    const button = document.createElement('button');
                    button.className = 'adventure-choice-button button-secondary';
                    button.dataset.action = 'adventure-choice';
                    button.dataset.choiceText = child.textContent;
                    button.textContent = child.textContent;
                    body.appendChild(button);
                }
            }
            if (this.#lastUnansweredPromptEl && this.#lastUnansweredPromptEl !== block) {
                this.#lastUnansweredPromptEl.classList.add('collapsed');
                const icon = this.#lastUnansweredPromptEl.querySelector('.expand-icon');
                if (icon) icon.textContent = 'unfold_more';
            }
            this.#lastUnansweredPromptEl = block;
        }
        
        block.appendChild(header);
        block.appendChild(body);
    }
    
    #createDialogueBlock(textNode) {
        const block = document.createElement('div');
        block.className = 'adventure-block adventure-dialogue';
    
        const speakerId = textNode.getAttribute('id');
        const speaker = this.#findCharacter(speakerId);
        const speakerName = speaker?.name || (speakerId === 'null' ? 'Narrator' : speakerId);
        const avatarUrl = speaker?.avatarUrl || 'assets/images/system_icon.svg';
    
        const nameEl = document.createElement('div');
        nameEl.className = 'adventure-speaker-name';
        nameEl.textContent = speakerName;
        const avatarEl = document.createElement('img');
        avatarEl.className = 'adventure-speaker-avatar'; // Added class for click handling
        avatarEl.src = avatarUrl;
        avatarEl.alt = speakerName;
        const contentEl = document.createElement('div');
        contentEl.className = 'adventure-dialogue-content';
        const speechEl = document.createElement('div');
        speechEl.className = 'adventure-speech';

        let cumulativeDelay = 0;
        for(const child of Array.from(textNode.childNodes)) {
            if (child.nodeType !== Node.ELEMENT_NODE) continue;

            const childName = child.nodeName.toLowerCase();
            if (childName === 'delay') { cumulativeDelay += parseFloat(child.getAttribute('time') || 0); continue; }

            let speechPart;
            switch(childName) {
                case 'talk': speechPart = document.createElement('span'); speechPart.className = 'adventure-speech-talk'; break;
                case 'yell': speechPart = document.createElement('strong'); speechPart.className = 'adventure-speech-yell'; break;
                case 'whisper': speechPart = document.createElement('em'); speechPart.className = 'adventure-speech-whisper'; break;
                case 'monologue': speechPart = document.createElement('em'); speechPart.className = 'adventure-speech-monologue'; break;
                default: continue;
            }
            
            speechPart.appendChild(this.#renderInlineContent(child));
            speechPart.style.animationDelay = `${cumulativeDelay.toFixed(2)}s`;
            speechPart.classList.add('adventure-speech-part');
            speechEl.appendChild(speechPart);
        }
        
        contentEl.appendChild(speechEl);
        block.appendChild(nameEl);
        block.appendChild(avatarEl);
        block.appendChild(contentEl);
        
        return block;
    }
    
    #renderInlineContent(element) {
        const fragment = document.createDocumentFragment();
        for (const child of Array.from(element.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                fragment.appendChild(document.createTextNode(child.textContent));
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const nodeName = child.nodeName.toLowerCase();
                if (nodeName === 'char') {
                    const charId = child.getAttribute('id');
                    const charInList = this.#findCharacter(charId);
                    const displayName = charInList?.name || child.textContent || charId;
                    const avatarUrl = charInList?.avatarUrl || 'assets/images/default_avatar.svg';
                    const wrapper = document.createElement(charInList ? 'a' : 'span');
                    wrapper.href = '#';
                    wrapper.className = `adventure-char-ref ${charInList ? '' : 'non-interactive'}`;
                    if (charInList) { wrapper.dataset.action = 'navigate-to-character'; wrapper.dataset.characterId = charId; }
                    
                    const img = document.createElement('img');
                    img.src = avatarUrl; img.alt = displayName; img.className = 'adventure-char-avatar';
                    wrapper.appendChild(img);
                    const text = document.createElement('span');
                    text.className = 'adventure-char-link-text'; text.textContent = displayName;
                    wrapper.appendChild(text);
                    fragment.appendChild(wrapper);
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
        return `
            <div class="message-controls">
                <button type="button" class="icon-btn" title="Copy" data-action="copy"><span class="material-icons">content_copy</span></button>
                <button type="button" class="icon-btn" title="Branch" data-action="branch"><span class="material-icons">call_split</span></button>
                ${(msg.role === 'assistant' || (msg.role === 'user' && isLastMessage)) ? `<button type="button" class="icon-btn" title="Regenerate" data-action="regenerate"><span class="material-icons">replay</span></button>` : ''}
                <button type="button" class="icon-btn" title="Edit (Ctrl+Enter to save)" data-action="edit"><span class="material-icons">edit</span></button>
                <button type="button" class="icon-btn" title="Delete" data-action="delete"><span class="material-icons">delete</span></button>
            </div>`;
    }

    #escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

    render() {
         super._initShadow(`
            <div id="chat-history"></div>
            <form id="chat-form">
                <button id="quick-regen-btn" type="button" title="Regenerate Last Response">
                    <span class="material-icons">replay</span>
                </button>
                <text-box name="message" placeholder="Type your message... (Ctrl+Enter to send)"></text-box>
                <button type="submit" class="send-button" title="Send" disabled>
                    <span class="material-icons">send</span>
                </button>
            </form>
        `, this.styles());
    }

    styles() {
         return `
            :host { display: flex; flex-direction: column; height: 100%; position: relative; }
            #chat-history { flex-grow: 1; overflow-y: auto; padding: var(--spacing-lg); }
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
            
            .chat-message { margin-bottom: var(--spacing-md); display: flex; flex-direction: column; gap: var(--spacing-xs); position: relative; }
            .chat-message.assistant.adventure-mode { max-width: 800px; margin-left: auto; margin-right: auto; }
            .chat-message.assistant.adventure-mode .message-controls { display: flex; justify-content: flex-end; width: 100%; padding-right: var(--spacing-md); opacity: 0; transition: var(--transition-fast); }
            .chat-message.assistant.adventure-mode:hover .message-controls { opacity: 1; }
            .chat-message:not(.assistant.adventure-mode) { display: flex; gap: var(--spacing-md); max-width: 100%; }
            .chat-message .avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-top: 5px; background-color: var(--bg-3); }
            .chat-message.system, .chat-message.player-choice { margin: 0 auto; color: var(--text-secondary); max-width: 100%; }
            .chat-message.system .message-bubble, .chat-message.player-choice .message-bubble { background: none; }
            .chat-message.player-choice .message-bubble { text-align: center; font-style: italic; }
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
            .adventure-speech-part { animation: fadeIn 0.3s ease-out both; opacity: 0; }
            .adventure-speech-part:not(:first-child)::before { content: ' '; }
            
            .adventure-parse-error { border: 2px solid var(--accent-danger); background: rgba(242, 139, 130, 0.1); padding: var(--spacing-md); border-radius: var(--radius-md); margin-top: var(--spacing-md); }
            .adventure-parse-error pre { background: var(--bg-0); padding: var(--spacing-sm); border-radius: var(--radius-sm); white-space: pre-wrap; word-break: break-all; }
            .adventure-block { margin-bottom: var(--adventure-block-gap, var(--spacing-lg)); padding-top: 0; transition: opacity 0.4s ease-out; }
            .adventure-action { font-style: italic; color: var(--text-secondary); text-align: justify; padding: var(--spacing-sm) 0; }
            .adventure-action:not(:last-child) { border-bottom: 1px dashed var(--bg-3); }
            .adventure-action:nth-child(2) { border-top: 1px dashed var(--bg-3); }
            .adventure-dialogue { display: grid; grid-template-areas: "avatar name" "avatar content"; grid-template-columns: auto 1fr; grid-template-rows: auto 1fr; gap: 0 var(--spacing-md); }
            .adventure-speaker-avatar { border-radius: var(--radius-md); object-fit: cover; background-color: var(--bg-3); grid-area: avatar; column-span: 1; height: 192px; width: 128px; cursor: pointer; } /* NEW: Added cursor: pointer */
            .adventure-dialogue-content { grid-area: content; }
            .adventure-speaker-name { font-size: 1.2rem; font-weight: 600; color: var(--text-primary); grid-area: name; padding-bottom: var(--spacing-xs); border-bottom: 1px solid var(--bg-3); margin-bottom: var(--spacing-sm); }
            .adventure-speech { line-height: 1.6; }
            .adventure-speech-part { display: inline; }
            .adventure-speech-yell { text-transform: uppercase; font-weight: bold; }
            .adventure-speech-monologue { font-style: italic; color: var(--text-secondary); }
            .adventure-prompt { border-radius: var(--radius-md); background-color: var(--bg-1); color: var(--text-primary); position: relative; }
            .adventure-prompt-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: var(--spacing-sm) var(--spacing-md); background-color: var(--bg-2); border-radius: var(--radius-sm); user-select: none; }
            .adventure-prompt-header .expand-icon { font-size: 1.5rem; }
            .adventure-prompt.collapsed .adventure-prompt-body { display: none; }
            .adventure-prompt-body { display: flex; flex-direction: column; gap: var(--spacing-sm); padding: var(--spacing-md); }
            .adventure-prompt-text { margin-bottom: var(--spacing-sm); }
            .adventure-choice-button { user-select: none; width: 100%; }
            .adventure-prompt-header .answered-prompt-header { display: flex; align-items: center; gap: var(--spacing-sm); flex-grow: 1; overflow: hidden; }
            .answered-prompt-header .avatar { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
            .answered-prompt-header .answered-choice-text { font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .adventure-prompt-player-choice { margin-top: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); background-color: var(--accent-primary-faded); color: var(--text-primary); border-radius: var(--radius-md); border-top: 1px solid var(--bg-3); }
            .adventure-prompt-player-choice .message-header { margin-bottom: 0; }
            .adventure-prompt-player-choice .author-name { font-weight: 600; }
            .adventure-char-ref { display: inline-flex; align-items: center; gap: 0px; background: var(--bg-2); padding: 2px 4px; border-radius: var(--radius-sm); color: var(--text-primary); text-decoration: none; font-weight: 500; line-height: 1; vertical-align: middle; }
            .adventure-char-ref.non-interactive { cursor: default; }
            a.adventure-char-ref:hover { text-decoration: none; color: var(--accent-primary); background-color: var(--bg-3); }
            a.adventure-char-ref:hover .adventure-char-link-text { text-decoration: underline; }
            .adventure-char-avatar { width: 1.2em; height: 1.2em; border-radius: 50%; object-fit: cover; margin-right: 4px; }
            .adventure-char-link-text { line-height: 1; }
            .adventure-show { display: flex; flex-direction: column; align-items: center; gap: var(--spacing-md); background-color: var(--bg-0); border-radius: var(--radius-md); padding: var(--spacing-md); border: 1px solid var(--bg-3); overflow: hidden; }
            .adventure-show-image-container { width: 100%; max-height: 500px; display: flex; justify-content: center; align-items: center; margin-bottom: var(--spacing-sm); }
            .adventure-show-image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius-sm); cursor: pointer; } /* NEW: Added cursor: pointer */
            .adventure-show-content { width: 100%; }
            .adventure-show-content .adventure-block { margin-bottom: 0; }
            .adventure-show-content .adventure-action { border: none; padding: 0; text-align: center; }

            @media (max-width: 768px) {
                #chat-history { padding: var(--spacing-md); }
                .chat-message .message-controls, .chat-message.assistant.adventure-mode .message-controls { opacity: 1; pointer-events: auto; }
                .adventure-block { margin-bottom: var(--adventure-block-gap, var(--spacing-sm)); padding-bottom: var(--spacing-sm); padding-top: 0; }
                .adventure-action { padding-left: var(--spacing-xs); padding-right: var(--spacing-xs); font-size: var(--font-size-md); }
                .adventure-dialogue { gap: var(--spacing-xs) var(--spacing-sm); grid-template-columns: auto 1fr; }
                .adventure-speaker-avatar { width: 64px; height: 96px; border-radius: var(--radius-sm); }
                .adventure-speaker-name { font-size: 1.1rem; padding-bottom: var(--spacing-xs); margin-bottom: var(--spacing-xs); }
                .adventure-speech { font-size: var(--font-size-md); }
                .adventure-prompt { padding: 0; }
                .adventure-prompt-body { padding: var(--spacing-sm); gap: var(--spacing-xs); }
                .adventure-prompt-text { margin-bottom: var(--spacing-xs); font-size: var(--font-size-md); }
                .adventure-choice-button { padding: 0.5rem 1rem; font-size: var(--font-size-md); }
                .adventure-show { padding: var(--spacing-sm); gap: var(--spacing-sm); }
                .adventure-show-image-container { max-height: 300px; margin-bottom: var(--spacing-xs); }
            }
        `;
    }
}

customElements.define('adventure-chat-mode', AdventureChatMode);
chatModeRegistry.register('vn', 'adventure-chat-mode');