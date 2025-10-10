// client/components/views/modes/DefaultChatMode.js
import { BaseChatMode } from './BaseChatMode.js';
import { chatModeRegistry } from '../../../ChatModeRegistry.js';
import { uuidv4, imagePreview } from '../../../client.js';
import '../../common/TextBox.js';
import '../../common/Spinner.js';

export class DefaultChatMode extends BaseChatMode {
    #historyContainer = null;
    #form = null;
    #textbox = null;
    #sendButton = null;
    #markdownRenderer = null;
    #codeNavControls = null;
    #codeNavUp = null;
    #codeNavDown = null;
    #quickRegenButton = null;
    #streamingContent = new Map();


    onInitialize() {
        this.render();
        this.#historyContainer = this.shadowRoot.querySelector('#chat-history');
        this.#form = this.shadowRoot.querySelector('#chat-form');
        this.#textbox = this.#form.querySelector('text-box');
        this.#sendButton = this.#form.querySelector('.send-button');

        this.#codeNavControls = this.shadowRoot.querySelector('#code-nav-controls');
        this.#codeNavUp = this.shadowRoot.querySelector('#code-nav-up');
        this.#codeNavDown = this.shadowRoot.querySelector('#code-nav-down');
        this.#quickRegenButton = this.shadowRoot.querySelector('#quick-regen-btn');

        this.#sendButton.addEventListener('click', this.#handleSend.bind(this));
        this.#textbox.addEventListener('keydown', this.#handleTextboxKeydown.bind(this));
        this.#historyContainer.addEventListener('scroll', this.updateCodeNavButtons.bind(this));
        this.#codeNavUp.addEventListener('click', () => this.navigateCodeBlocks('up'));
        this.#codeNavDown.addEventListener('click', () => this.navigateCodeBlocks('down'));
        
        if (this.#quickRegenButton) {
            this.#quickRegenButton.addEventListener('click', this.#handleQuickRegen.bind(this));
        }

        this.#historyContainer.addEventListener('click', this.#handleAvatarClick.bind(this));
    }
    
    // Lifecycle Hooks
    onChatSwitched() { this.refreshChatHistory(); }
    onChatBranched() { this.refreshChatHistory(); }
    onParticipantsChanged() { this.refreshChatHistory(); }
    onAllCharactersChanged() { this.refreshChatHistory(); }
    onUserPersonaChanged() { this.refreshChatHistory(); }

    onMessagesAdded(addedMessages) {
        const optimisticUserEl = this.shadowRoot.querySelector('.chat-message[data-message-id^="user-"]');
        const optimisticAssistantEl = this.shadowRoot.querySelector('.chat-message[data-message-id^="assistant-"]');

        if (optimisticUserEl && optimisticAssistantEl && addedMessages.length >= 2) {
            const finalUserMsg = addedMessages.at(-2);
            const finalAssistantMsg = addedMessages.at(-1);

            this.#replaceMessageElement(optimisticUserEl, finalUserMsg);
            this.#replaceMessageElement(optimisticAssistantEl, finalAssistantMsg);
        } else {
            this.refreshChatHistory(); // Fallback
        }
    }
    
    onMessageUpdated(updatedMessage) {
        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${updatedMessage.id}"]`);
        if (messageEl) {
            this.#replaceMessageElement(messageEl, updatedMessage);
        }
    }

    onMessagesDeleted(deletedMessageIds) {
        for (const id of deletedMessageIds) {
            this.shadowRoot.querySelector(`.chat-message[data-message-id="${id}"]`)?.remove();
        }
        this.updateInputState(this.isSending);
        this.updateCodeNavButtons();
    }
    
    // Overridden Base Methods

    onPromptStart(userMessage) {
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
        const messageData = this.getMessageById(messageId);
        if (!messageData) return null;

        if (messageData.role === 'assistant') {
            const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"] .message-content`);
            if (messageEl) {
                messageEl.innerHTML = '<minerva-spinner mode="infinite"></minerva-spinner>';
            }
            return messageId;
        } else if (messageData.role === 'user') {
            const assistantSpinnerMessage = {
                id: `assistant-${uuidv4()}`,
                role: 'assistant',
                content: '<minerva-spinner mode="infinite"></minerva-spinner>',
                timestamp: new Date().toISOString()
            };
            this.appendMessage(assistantSpinnerMessage);
            return assistantSpinnerMessage.id;
        }
        return null;
    }

    // Stream Lifecycle Hooks
    
    onStreamStart(messageId) {
        this.#streamingContent.set(messageId, '');
        const messageContentEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"] .message-content`);
        if (messageContentEl) {
            // Clear the spinner before streaming starts
            messageContentEl.innerHTML = '';
        }
    }

    onToken(token, messageId) {
        if (!this.#streamingContent.has(messageId)) return;

        const newContent = this.#streamingContent.get(messageId) + token;
        this.#streamingContent.set(messageId, newContent);

        const messageContentEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"] .message-content`);
        if (!messageContentEl) return;

        if (this.rendererType === 'markdown' && window.marked) {
            messageContentEl.innerHTML = window.marked.parse(newContent, { renderer: this.#getMarkdownRenderer(), gfm: true });
        } else {
            const textNode = document.createTextNode(newContent);
            const div = document.createElement('div');
            div.appendChild(textNode);
            messageContentEl.innerHTML = div.innerHTML.replace(/\n/g, '<br>');
        }
        
        this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight;
    }

    onStreamFinish(messageId) {
        this.updateInputState(false);
        this.updateCodeNavButtons();
        this.#streamingContent.delete(messageId);
    }
    
    onStreamError(error, messageId) {
        const streamContent = this.#streamingContent.get(messageId) || '';
        const content = error.name === 'AbortError' 
            ? `${streamContent}\n\n\n*Generation stopped by user.*`
            : `**Error:** Could not get response.\n*${error.message}*`;
        
        const messageEl = this.shadowRoot.querySelector(`.chat-message[data-message-id="${messageId}"]`);
        if (messageEl) {
            const errorMsg = { id: messageId, role: 'assistant', content };
            this.#replaceMessageElement(messageEl, errorMsg);
        }
        
        this.#streamingContent.delete(messageId);
        this.updateInputState(false);
    }

    // Event Handlers & UI Logic

    #handleSend(event) {
        event.preventDefault();
        const promptText = this.getUserInput();
        if (promptText) {
            this.sendPrompt(promptText);
        }
    }

    #handleTextboxKeydown(event) {
        if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault();
            if (this.#sendButton && !this.#sendButton.disabled) {
                this.#sendButton.click();
            }
        }
    }

    #handleQuickRegen() {
        if (this.isSending || !this.chat || this.chat.messages.length === 0) {
            return;
        }
        const lastMessage = this.chat.messages.at(-1);
        this.regenerateMessage(lastMessage.id);
    }

    #handleEditMessage(messageId, messageEl) {
        const contentEl = messageEl.querySelector('.message-content');
        if (!contentEl) return;

        const message = this.getMessageById(messageId);
        if (!message) return;

        const originalContent = message.content;

        const editor = document.createElement('text-box');
        editor.value = originalContent;

        const originalHeight = contentEl.offsetHeight;
        editor.style.height = `${Math.max(originalHeight, 100)}px`;
        editor.style.minHeight = '100px';

        contentEl.innerHTML = '';
        contentEl.appendChild(editor);
        editor.focus();

        let isCancelled = false;
        const onKeydown = e => {
            if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); editor.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); isCancelled = true; editor.blur(); }
        };

        const onBlur = async () => {
            editor.removeEventListener('keydown', onKeydown);
            editor.removeEventListener('blur', onBlur);

            if (isCancelled) {
                this.onMessageUpdated(message); // Re-render with original content
                return;
            }

            const newContent = editor.value;
            // Check if content actually changed
            if (newContent.trim() !== originalContent.trim()) {
                this.saveEditedMessage(messageId, newContent);
            } else {
                this.onMessageUpdated(message); // Re-render with original content
            }
        };

        editor.addEventListener('keydown', onKeydown);
        editor.addEventListener('blur', onBlur);
    }

    #handleAvatarClick(event) {
        const avatarImg = event.target.closest('.chat-message .avatar');
        if (avatarImg && avatarImg.tagName === 'IMG') {
            imagePreview.show({ src: avatarImg.src, alt: avatarImg.alt });
        }
    }

    getUserInput() {
        return this.#textbox.value;
    }

    clearUserInput() {
        this.#textbox.value = '';
    }

    updateInputState(isSending = false) {
        this.isSending = isSending; // Update internal state property
        if (!this.#textbox) return;
        this.#textbox.disabled = isSending;
        this.#sendButton.disabled = isSending;
        if (this.#quickRegenButton) {
            this.#quickRegenButton.disabled = isSending || !this.chat || this.chat.messages.length === 0;
        }
    }
    
    #attachMessageListeners(messageEl) {
        const messageId = messageEl.dataset.messageId;
        if (!messageId) return;

        // Attach listeners for main message actions (delete, edit, copy, etc.) in the header
        for (const button of messageEl.querySelectorAll('.message-header button[data-action]')) {
            const action = button.dataset.action;
            button.addEventListener('click', () => {
                switch (action) {
                    case 'delete': this.deleteMessage(messageId); break;
                    case 'branch': this.branchFromMessage(messageId); break;
                    case 'regenerate': this.regenerateMessage(messageId); break;
                    case 'edit': this.#handleEditMessage(messageId, messageEl); break;
                    case 'copy': {
                        const message = this.getMessageById(messageId);
                        if (message) this.copyMessageContent(message.content);
                        break;
                    }
                }
            });
        }

        // Attach listeners for actions inside the content (e.g., copy code)
        for (const button of messageEl.querySelectorAll('.message-content button[data-action="copy-code"]')) {
            button.addEventListener('click', () => {
                const codeText = button.closest('.code-block-wrapper')?.querySelector('pre code')?.textContent;
                if (codeText) this.copyMessageContent(codeText);
            });
        }
    }

    #renderSingleMessageHTML(msg, index = -1) {
        const isUser = msg.role === 'user';
        let author = null;
        if (isUser) {
            author = this.getCharacterById(msg.characterId);
        } else if (msg.role === 'assistant') {
            const firstBotParticipant = this.chat.participants.find(p => !p.isAuto);
            author = this.allCharacters.find(c => c.id === firstBotParticipant?.id);
        }

        const authorName = author?.name || (isUser ? 'You' : (msg.role === 'system' ? 'System' : 'Assistant'));
        const avatarUrl = author?.avatarUrl || (isUser ? 'assets/images/user_icon.svg' : (msg.role === 'system' ? 'assets/images/system_icon.svg' : 'assets/images/assistant_icon.svg'));
        const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
        
        const isLastMessage = (index === -1) // If index is not passed, check against the full list
            ? this.chat.messages.at(-1)?.id === msg.id
            : index === this.chat.messages.length - 1;

        const controls = `
            <div class="message-controls">
                <button type="button" class="icon-btn" title="Copy" data-action="copy"><span class="material-icons">content_copy</span></button>
                <button type="button" class="icon-btn" title="Branch" data-action="branch"><span class="material-icons">call_split</span></button>
                ${(msg.role === 'assistant' || (msg.role === 'user' && isLastMessage)) ? `<button type="button" class="icon-btn" title="Regenerate" data-action="regenerate"><span class="material-icons">replay</span></button>` : ''}
                <button type="button" class="icon-btn" title="Edit (Ctrl+Enter to save)" data-action="edit"><span class="material-icons">edit</span></button>
                <button type="button" class="icon-btn" title="Delete" data-action="delete"><span class="material-icons">delete</span></button>
            </div>
        `;
        
        let currentMessageContent = msg.content;
        if (typeof currentMessageContent !== 'string') {
            currentMessageContent = String(currentMessageContent);
        }

        let contentHTML = currentMessageContent;
        
        // Render spinner or formatted content
        if (currentMessageContent.includes('<minerva-spinner')) {
             contentHTML = currentMessageContent;
        } else if (this.rendererType === 'markdown' && window.marked) {
            contentHTML = window.marked.parse(currentMessageContent, { renderer: this.#getMarkdownRenderer(), gfm: true });
        } else { // Raw text renderer
            const textNode = document.createTextNode(currentMessageContent);
            const div = document.createElement('div');
            div.appendChild(textNode);
            contentHTML = div.innerHTML.replace(/\n/g, '<br>');
        }

        return `
            <div class="chat-message ${msg.role}" data-message-id="${msg.id}">
                <img src="${avatarUrl}" alt="${authorName}'s avatar" class="avatar">
                <div class="message-bubble">
                    <div class="message-header">
                        <span class="author-name">${authorName}</span>
                        <span class="timestamp">${timestamp}</span>
                        ${controls}
                    </div>
                    <div class="message-content" contenteditable="false">${contentHTML}</div>
                </div>
            </div>
        `;
    }

    refreshChatHistory() {
        if (!this.#historyContainer || !this.chat) {
            this.#historyContainer.innerHTML = '';
            return;
        }

        const scrollAtBottom = (this.#historyContainer.scrollHeight - this.#historyContainer.clientHeight) <= this.#historyContainer.scrollTop + 1;

        this.#historyContainer.innerHTML = this.chat.messages.map((msg, index) => this.#renderSingleMessageHTML(msg, index)).join('');
        
        // After bulk-rendering, attach listeners to all the new elements
        for (const messageEl of this.#historyContainer.querySelectorAll('.chat-message[data-message-id]')) {
            this.#attachMessageListeners(messageEl);
        }
        
        if (scrollAtBottom) {
            this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight;
        }
        this.updateCodeNavButtons();
        this.updateInputState(this.isSending); // Update regen button state
    }

    appendMessage(message) {
        if (!this.#historyContainer) return;
        const scrollAtBottom = (this.#historyContainer.scrollHeight - this.#historyContainer.clientHeight) <= this.#historyContainer.scrollTop + 1;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.#renderSingleMessageHTML(message);
        const messageEl = tempDiv.firstElementChild;

        if (messageEl) {
            this.#attachMessageListeners(messageEl);
            this.#historyContainer.appendChild(messageEl);
        }

        if (scrollAtBottom) {
            this.#historyContainer.scrollTop = this.#historyContainer.scrollHeight;
        }
        this.updateCodeNavButtons();
        this.updateInputState(this.isSending); // Update regen button state
    }

    #replaceMessageElement(oldEl, newMessage) {
        if (!oldEl) return;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this.#renderSingleMessageHTML(newMessage);
        const newEl = tempDiv.firstElementChild;
        if (newEl) {
            this.#attachMessageListeners(newEl);
            oldEl.replaceWith(newEl);
        }
    }

    #getMarkdownRenderer() {
        if (!this.#markdownRenderer) {
            this.#markdownRenderer = new window.marked.Renderer();
            const escape = (text) => String(text ?? '').replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, '"').replace(/'/g, "'");
            this.#markdownRenderer.code = (code, language) => {
                const codeText = (typeof code === 'object' && code !== null && typeof code.text === 'string') ? code.text : code;
                const lang = language || (typeof code === 'object' && code !== null ? code.lang : '');
                const langClass = lang ? `language-${lang}` : '';
                const escapedCode = escape(codeText);
                return `<div class="code-block-wrapper"><pre><code class="${langClass}">${escapedCode}</code></pre><button type="button" class="icon-btn copy-code-btn" title="Copy Code" data-action="copy-code"><span class="material-icons">content_copy</span></button></div>`;
            };
        }
        return this.#markdownRenderer;
    }

    // Code Block Navigation
    #getBlockRelativePos(block, container) {
        const blockRect = block.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const relativeTop = blockRect.top - containerRect.top + container.scrollTop;
        return { top: relativeTop, bottom: relativeTop + block.offsetHeight };
    }

    #getCodeBlocks() {
        return Array.from(this.shadowRoot.querySelectorAll('#chat-history .code-block-wrapper'));
    }

    navigateCodeBlocks(direction) {
        const codeBlocks = this.#getCodeBlocks();
        if (codeBlocks.length === 0) return;
        const container = this.#historyContainer;
        const currentScrollTop = container.scrollTop;
        const scrollBuffer = 20;
        let targetBlock = null;

        if (direction === 'down') {
            for (const block of codeBlocks) {
                if (this.#getBlockRelativePos(block, container).top > currentScrollTop + scrollBuffer) {
                    targetBlock = block;
                    break;
                }
            }
        } else {
            for (let i = codeBlocks.length - 1; i >= 0; i--) {
                const block = codeBlocks[i];
                if (this.#getBlockRelativePos(block, container).bottom < currentScrollTop - scrollBuffer) {
                    targetBlock = block;
                    break;
                }
            }
        }
        
        if (targetBlock) {
            container.scrollTo({
                top: this.#getBlockRelativePos(targetBlock, container).top - 20,
                behavior: 'smooth'
            });
        }
    }

    updateCodeNavButtons() {
        if (this.rendererType !== 'markdown' || !this.#codeNavControls) return;
        const codeBlocks = this.#getCodeBlocks();
        if (codeBlocks.length === 0) {
            this.#codeNavControls.style.display = 'none';
            return;
        }

        this.#codeNavControls.style.display = 'flex';
        const container = this.#historyContainer;
        const currentScrollTop = container.scrollTop;
        const clientHeight = container.clientHeight;
        const scrollBuffer = 20;

        let hasPrevious = false;
        for (let i = codeBlocks.length - 1; i >= 0; i--) {
            if (this.#getBlockRelativePos(codeBlocks[i], container).bottom < currentScrollTop - scrollBuffer) {
                hasPrevious = true;
                break;
            }
        }
        this.#codeNavUp.disabled = !hasPrevious;

        let hasNext = false;
        for (const block of codeBlocks) {
            if (this.#getBlockRelativePos(block, container).top > currentScrollTop + clientHeight + scrollBuffer) {
                hasNext = true;
                break;
            }
        }
        this.#codeNavDown.disabled = !hasNext;
    }
    
    render() {
        super._initShadow(`
            <div id="chat-history"></div>
            <div id="code-nav-controls" style="display: none;">
                <button type="button" id="code-nav-up" title="Previous Code Block"><span class="material-icons">arrow_upward</span></button>
                <button type="button" id="code-nav-down" title="Next Code Block"><span class="material-icons">arrow_downward</span></button>
            </div>
            <form id="chat-form" action="javascript:void(0);">
                <button id="quick-regen-btn" type="button" title="Regenerate Last Response">
                    <span class="material-icons">replay</span>
                </button>
                <text-box name="message" placeholder="Type your message... (Ctrl+Enter to send)"></text-box>
                <button type="submit" class="send-button" title="Send">
                    <span class="material-icons">send</span>
                </button>
            </form>
        `, this.styles());
    }

    styles() {
        return `
            :host {
                display: flex;
                flex-direction: column;
                height: 100%;
                position: relative;
            }
            #chat-history { flex-grow: 1; overflow-y: auto; padding: var(--spacing-lg); }
            #chat-form { display: flex; padding: var(--spacing-md); gap: var(--spacing-md); border-top: 1px solid var(--bg-3); background-color: var(--bg-1); }
            
            #quick-regen-btn {
                flex-shrink: 0;
                width: 48px;
                height: 48px;
                border: none;
                background-color: var(--bg-2); /* Distinct from send button */
                color: var(--text-secondary);
                border-radius: var(--radius-md);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: var(--transition-fast);
            }
            #quick-regen-btn:hover {
                background-color: var(--bg-3);
                color: var(--text-primary);
            }
            #quick-regen-btn:disabled {
                background-color: var(--bg-2);
                color: var(--text-disabled);
                cursor: not-allowed;
            }
            #quick-regen-btn .material-icons {
                font-size: 24px;
            }

            text-box {
                flex-grow: 1; min-height: 48px; max-height: 200px; padding: 0.75rem;
                border-radius: var(--radius-md); border: 1px solid var(--bg-3);
                background-color: var(--bg-0); font-family: var(--font-family);
            }
            text-box:focus-within { border-color: var(--accent-primary); box-shadow: none; }
            .send-button {
                flex-shrink: 0; width: 48px; height: 48px; border: none; background-color: var(--accent-primary);
                color: var(--bg-0); border-radius: var(--radius-md); cursor: pointer; display: flex;
                align-items: center; justify-content: center; transition: var(--transition-fast);
            }
            .send-button:hover { opacity: 0.9; }
            .send-button:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; }

            /* Message styles */
            .chat-message { margin-bottom: var(--spacing-md); display: flex; gap: var(--spacing-md); max-width: 100%; }
            .chat-message.system { margin: 0 auto; color: var(--text-secondary); max-width: 100%; }
            .chat-message.system .message-bubble { background: none; }
            .chat-message .avatar {
                width: 40px; /* Fixed width */
                height: 40px; /* Fixed height */
                border-radius: 50%;
                object-fit: cover; /* Ensures image covers the area without distortion */
                flex-shrink: 0; /* Prevents shrinking in flex layout */
                margin-top: 5px; /* Adjust vertical alignment with message bubble */
                background-color: var(--bg-3); /* Placeholder background */
                cursor: pointer; /* NEW: Indicate avatar is clickable */
            }
            .message-bubble { background-color: var(--bg-1); border-radius: var(--radius-md); padding: var(--spacing-sm) var(--spacing-md); flex-grow: 1; position: relative; }
            .chat-message.user .message-bubble { background-color: var(--accent-primary); color: var(--bg-0); }
            .chat-message.user .message-bubble .icon-btn { color: var(--bg-0); } /* Adjust icon color for user bubbles */
            .message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-xs); gap: var(--spacing-md); }
            .author-name { font-weight: 600; }
            .timestamp { font-size: var(--font-size-sm); color: var(--text-secondary); }

            /* Message controls (icons per message) */
            .message-header .message-controls { opacity: 0; transition: var(--transition-fast); display: flex; gap: var(--spacing-xs); }
            .message-bubble:hover .message-controls { opacity: 1; }
            .message-content text-box { outline: 1px solid var(--accent-primary); box-shadow: 0 0 0 3px var(--accent-primary-faded, rgba(138, 180, 248, 0.2)); background-color: var(--bg-0) !important; color: var(--text-primary) !important; padding: var(--spacing-sm); border-radius: var(--radius-sm); }
            
            /* Default styles for icon buttons, ensures they are styled within shadow DOM */
            .icon-btn {
                background: transparent;
                border: none;
                cursor: pointer;
                color: var(--text-secondary);
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
            }
            .icon-btn:hover {
                color: var(--text-primary);
            }
            .icon-btn .material-icons {
                font-family: 'Material Icons'; /* Explicitly set font-family for icon font */
                font-size: 18px;
                line-height: 1;
                vertical-align: middle;
                transition: color var(--transition-fast);
            }
            .chat-message.user .message-bubble .icon-btn .material-icons {
                color: var(--bg-0); /* Ensure user message icons are legible */
            }
            .chat-message.user .message-bubble .icon-btn:hover .material-icons {
                color: var(--bg-1); /* Hover state for user message icons */
            }

            .message-content {
                white-space: pre-wrap;
                word-wrap: break-word;
            }
            .message-content[contenteditable="true"] {
                outline: 1px solid var(--accent-primary);
                box-shadow: 0 0 0 3px var(--accent-primary-faded, rgba(138, 180, 248, 0.2));
                background-color: var(--bg-0) !important; color: var(--text-primary) !important;
                padding: var(--spacing-sm);
            }

            /* Code block specific styles for markdown renderer */
            .code-block-wrapper {
                position: relative;
                margin: var(--spacing-md) 0;
                background-color: var(--bg-0);
                border-radius: var(--radius-sm);
                overflow: hidden;
            }
            .code-block-wrapper pre {
                margin: 0;
                padding: var(--spacing-md);
                overflow-x: auto;
                font-family: monospace;
                font-size: 0.9em;
                line-height: 1.4;
                color: var(--text-primary);
            }
            .code-block-wrapper .copy-code-btn {
                position: absolute;
                top: var(--spacing-sm);
                right: var(--spacing-sm);
                background-color: var(--bg-3);
                color: var(--text-secondary);
                padding: var(--spacing-xs);
                border-radius: var(--radius-sm);
                opacity: 0;
                transition: opacity var(--transition-fast), background-color var(--transition-fast);
                width: auto; /* Override icon-btn width */
                height: auto; /* Override icon-btn height */
            }
            .code-block-wrapper:hover .copy-code-btn {
                opacity: 1;
            }
            .code-block-wrapper .copy-code-btn:hover {
                background-color: var(--accent-primary);
                color: var(--bg-0);
            }
            .code-block-wrapper .copy-code-btn .material-icons {
                font-size: 1.1rem; /* Adjust icon size within copy button */
                color: inherit; /* Inherit color from button itself */
            }


            /* Code Navigation Controls */
            #code-nav-controls {
                position: absolute;
                right: var(--spacing-lg); /* Aligned with chat history padding */
                bottom: calc(48px + 2 * var(--spacing-md) + var(--spacing-md)); /* Above chat input, outside the form */
                display: flex;
                flex-direction: column;
                gap: var(--spacing-xs);
                z-index: 1; /* Ensure it's above chat history */
            }
            #code-nav-controls button {
                background-color: var(--bg-2);
                color: var(--text-secondary);
                border: none;
                border-radius: 50%;
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                transition: var(--transition-fast);
            }
            #code-nav-controls button:hover {
                background-color: var(--bg-3);
                color: var(--text-primary);
            }
            #code-nav-controls button:disabled {
                background-color: var(--bg-2);
                color: var(--text-disabled);
                cursor: not-allowed;
                opacity: 0.5;
            }
            #code-nav-controls button .material-icons {
                font-size: 20px;
            }

            @media (max-width: 768px) {
                #chat-history { padding: var(--spacing-sm); }
                .chat-message { max-width: 95%; gap: var(--spacing-sm); } /* Adjust max-width for mobile */
                .chat-message .avatar { width: 32px; height: 32px; margin-top: 0; } /* Smaller avatars on mobile */
                .message-bubble { padding: var(--spacing-sm); } /* Smaller padding */
                
                /* Per-message controls always visible on mobile */
                .message-header .message-controls {
                    opacity: 1;
                    pointer-events: auto; /* Enable clicks */
                }

                #code-nav-controls {
                    right: var(--spacing-md);
                    bottom: calc(56px + var(--spacing-md) + var(--spacing-md)); /* Adjust for mobile bottom nav */
                }
                
                /* Quick regenerate button already inside form, no change needed here. */
                /* Mobile specific styles for the prompt bar are handled by the main app */
            }
        `;
    }
}

customElements.define('default-chat-mode', DefaultChatMode);
chatModeRegistry.register('raw', 'default-chat-mode');
chatModeRegistry.register('markdown', 'default-chat-mode');