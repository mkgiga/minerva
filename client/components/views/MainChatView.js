// client/components/views/MainChatView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier, uuidv4 } from '../../client.js';
import { chatModeRegistry } from '../../ChatModeRegistry.js';
import '../ItemList.js';

class MainChatView extends BaseComponent {
    #activeChatMode = null;

    constructor() {
        super();
        this.state = {
            chats: [],
            allCharacters: [],
            selectedChat: null,
            isSending: false,
            userPersona: null,
            chatRenderer: 'raw',
            isMultiSelectMode: false,
            multiSelectedChatIds: [],
        };

        // Bind methods for event listeners
        this.handleChatSelect = this.handleChatSelect.bind(this);
        this.handleChatAdd = this.handleChatAdd.bind(this);
        this.handleChatDelete = this.handleChatDelete.bind(this);
        this.handleHeaderAction = this.handleHeaderAction.bind(this);
        this.handleParticipantDelete = this.handleParticipantDelete.bind(this);
        this.handleModalCharacterSelect = this.handleModalCharacterSelect.bind(this);
        this.closeCharacterModal = this.closeCharacterModal.bind(this);
        this.handleModalSearch = this.handleModalSearch.bind(this);
        this.handleParticipantsToggle = this.handleParticipantsToggle.bind(this);
        this.handleBackToChats = this.handleBackToChats.bind(this);
        this.handleChatNameSave = this.handleChatNameSave.bind(this);
        this.handleChatNameEdit = this.handleChatNameEdit.bind(this);
        this.toggleMultiSelectMode = this.toggleMultiSelectMode.bind(this);
        this.handleDeleteSelectedChats = this.handleDeleteSelectedChats.bind(this);
        this.handleMultiSelectionChange = this.handleMultiSelectionChange.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleGoToParentChat = this.handleGoToParentChat.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.attachEventListeners();
        this.addCustomChatListActions();
        await this.fetchInitialData();
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
    }

    attachEventListeners() {
        const chatList = this.shadowRoot.querySelector('#chat-list');
        chatList.addEventListener('item-select', this.handleChatSelect);
        chatList.addEventListener('item-add', this.handleChatAdd);
        chatList.addEventListener('item-delete', this.handleChatDelete);
        chatList.addEventListener('multi-selection-change', this.handleMultiSelectionChange);
        
        const participantList = this.shadowRoot.querySelector('#participant-list');
        participantList.addEventListener('header-action', this.handleHeaderAction);
        participantList.addEventListener('item-delete', this.handleParticipantDelete);
        
        const modalEl = this.shadowRoot.querySelector('#add-character-modal');
        modalEl.addEventListener('click', (e) => { if (e.target === modalEl) this.closeCharacterModal(); });
        this.shadowRoot.querySelector('.close-modal-btn').addEventListener('click', this.closeCharacterModal);
        this.shadowRoot.querySelector('#modal-character-list').addEventListener('item-select', this.handleModalCharacterSelect);
        this.shadowRoot.querySelector('#modal-search-input').addEventListener('input', this.handleModalSearch);
        
        // Mobile participants panel and back button
        this.shadowRoot.querySelector('#participants-btn').addEventListener('click', this.handleParticipantsToggle);
        this.shadowRoot.querySelector('#back-to-chats-btn').addEventListener('click', this.handleBackToChats);
        this.shadowRoot.querySelector('.view-overlay').addEventListener('click', () => this.toggleParticipantsPanel(false));
        
        // Chat name edit
        this.shadowRoot.querySelector('#chat-name-input').addEventListener('change', this.handleChatNameSave);
        this.shadowRoot.querySelector('#chat-title-mobile').addEventListener('click', this.handleChatNameEdit);

        // Multi-select controls
        this.shadowRoot.querySelector('#delete-selected-btn').addEventListener('click', this.handleDeleteSelectedChats);
        this.shadowRoot.querySelector('#cancel-multiselect-btn').addEventListener('click', this.toggleMultiSelectMode);

        this.shadowRoot.querySelector('#go-to-parent-btn').addEventListener('click', this.handleGoToParentChat);

        // Listen for events from the active chat mode
        const modeContainer = this.shadowRoot.querySelector('#chat-mode-container');
        modeContainer.addEventListener('chat-mode-send-prompt', e => this.#handleSendMessage(e.detail.promptText));
        modeContainer.addEventListener('chat-mode-regenerate-message', e => this.#handleRegenerateMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-branch-message', e => this.#handleBranchMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-edit-message', e => this.#saveEditedMessage(e.detail.messageId, e.detail.newContent));
        modeContainer.addEventListener('chat-mode-delete-message', e => this.#handleDeleteMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-copy-message', e => this.#copyMessageContent(e.detail.content));
        modeContainer.addEventListener('chat-mode-go-to-parent', this.handleGoToParentChat);
    }

    addCustomChatListActions() {
        const chatList = this.shadowRoot.querySelector('#chat-list');
        chatList.addCustomAction({
            icon: 'checklist',
            name: 'multi-select',
            title: 'Select Multiple',
            callback: this.toggleMultiSelectMode
        });
    }

    async fetchInitialData() {
        try {
            const [chats, characters, settings] = await Promise.all([
                api.get('/api/chats'),
                api.get('/api/characters'),
                api.get('/api/settings'),
            ]);
            this.state.chats = chats;
            this.state.allCharacters = characters;
            this.state.chatRenderer = settings.chat?.renderer || 'raw';

            if (settings.userPersonaCharacterId) {
                this.state.userPersona = characters.find(c => c.id === settings.userPersonaCharacterId);
            } else {
                this.state.userPersona = null;
            }

            this.updateView();
        } catch (error) {
            console.error('Failed to fetch initial chat data:', error);
            notifier.show({ header: 'Error', message: 'Could not load initial data.' });
        }
    }
    
    // --- Event Handlers ---
    
    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        const changedProperties = [];
        let needsViewUpdate = true;

        switch (resourceType) {
            case 'chat':
                if (this.handleChatListChange(eventType, data)) changedProperties.push('chats');
                break;
            case 'chat_details':
                if (eventType === 'update' && this.state.selectedChat?.id === data.id) {
                    // Update the main controller's state
                    this.state.selectedChat = data;
                    
                    // Let the active chat mode handle its own update efficiently.
                    // This is for things inside the chat mode's view, like the message list.
                    if (this.#activeChatMode && typeof this.#activeChatMode.onChatUpdate === 'function') {
                        this.#activeChatMode.onChatUpdate(data);
                    } else if (this.#activeChatMode) {
                        // Fallback for modes without onChatUpdate: just update its data property
                        this.#activeChatMode.chat = data;
                    }
                    
                    changedProperties.push('selectedChat');
                    // We let needsViewUpdate remain true, so the main view can update
                    // its own components, like the participant list.
                }
                break;
            case 'character':
                if (this.handleCharacterListChange(eventType, data)) {
                     if (this.#activeChatMode) this.#activeChatMode.allCharacters = [...this.state.allCharacters];
                     changedProperties.push('allCharacters');
                }
                break;
            case 'setting':
                if (this.handleSettingChange(data)) {
                    if (this.#activeChatMode) {
                        this.#activeChatMode.userPersona = this.state.userPersona;
                        this.#activeChatMode.rendererType = this.state.chatRenderer;
                    }
                    changedProperties.push('settings');
                }
                break;
        }

        if (needsViewUpdate) {
            this.updateView();
        }

        if (this.#activeChatMode && changedProperties.length > 0 && typeof this.#activeChatMode.onStateUpdate === 'function') {
            this.#activeChatMode.onStateUpdate({ changed: changedProperties });
        }
    }

    handleChatListChange(eventType, data) {
        let changed = false;
        switch (eventType) {
            case 'create':
                this.state.chats.unshift(data);
                changed = true;
                break;
            case 'update':
                const listIdx = this.state.chats.findIndex(c => c.id === data.id);
                if (listIdx !== -1) {
                    // Merge new data with existing summary, ensuring childChatIds is properly handled
                    this.state.chats[listIdx] = {
                        ...this.state.chats[listIdx],
                        ...data,
                        childChatIds: data.childChatIds || [] // Ensure childChatIds is an array
                    };
                    changed = true;
                }
                break;
            case 'delete':
                const originalLength = this.state.chats.length;
                this.state.chats = this.state.chats.filter(c => c.id !== data.id);
                if(this.state.chats.length < originalLength) {
                    if (this.state.selectedChat?.id === data.id) this.state.selectedChat = null;
                    changed = true;
                }
                break;
        }
        if (changed) {
             // Sorting is now handled by #buildChatTree
        }
        return changed;
    }

    handleCharacterListChange(eventType, data) {
        let changed = false;
        switch (eventType) {
            case 'create':
                this.state.allCharacters.push(data);
                changed = true;
                break;
            case 'update':
                const charIdx = this.state.allCharacters.findIndex(c => c.id === data.id);
                if (charIdx !== -1) this.state.allCharacters[charIdx] = data;
                if (this.state.userPersona?.id === data.id) this.state.userPersona = data;
                changed = true;
                break;
            case 'delete':
                const originalLength = this.state.allCharacters.length;
                this.state.allCharacters = this.state.allCharacters.filter(c => c.id !== data.id);
                changed = this.state.allCharacters.length < originalLength;
                break;
        }
        return changed;
    }

    handleSettingChange(settings) {
        let needsUpdate = false;
        if (settings.userPersonaCharacterId !== this.state.userPersona?.id) {
            this.state.userPersona = this.state.allCharacters.find(c => c.id === settings.userPersonaCharacterId) || null;
            needsUpdate = true;
        }
        if (settings.chat?.renderer !== this.state.chatRenderer) {
            this.state.chatRenderer = settings.chat.renderer;
            needsUpdate = true;
        }
        return needsUpdate;
    }

    async handleChatSelect(event) {
        if (this.state.isMultiSelectMode) return;
        try {
            this.state.selectedChat = await api.get(`/api/chats/${event.detail.item.id}`);
            this.updateView();
        } catch (error) {
            console.error('Failed to load chat:', error);
            this.state.selectedChat = null;
            this.updateView();
            notifier.show({ header: 'Error', message: 'Failed to load the selected chat.' });
        }
    }

    async handleChatAdd() {
        try {
            const newChat = await api.post('/api/chats', { name: 'New Conversation' });
            // SSE will add to list, we just need to select it.
            this.state.selectedChat = newChat;
            this.updateView();
        } catch (error) {
            console.error('Failed to create chat:', error);
            notifier.show({ header: 'Error', message: 'Could not create a new chat.' });
        }
    }

    handleChatDelete(event) {
        const { id, name } = event.detail.item;
        modal.confirm({
            title: 'Delete Chat',
            content: `Are you sure you want to delete "${name}"? This will also delete all its branches. This cannot be undone.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/chats/${id}`);
                    notifier.show({ message: `Chat "${name}" deleted.` });
                } catch (error) {
                    notifier.show({ header: 'Error', message: `Could not delete chat "${name}".` });
                }
            }
        });
    }

    handleHeaderAction(event) {
        if (event.detail.action === 'add-participant') {
            // On mobile, the participant list is an overlay. Close it before opening the character selection modal.
            if (window.matchMedia('(max-width: 768px)').matches) {
                this.toggleParticipantsPanel(false);
            }
            this.openCharacterModal();
        }
    }

    async handleParticipantDelete(event) {
        const charIdToRemove = event.detail.item.id;
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;

        const originalParticipants = [...selectedChat.participants];
        const newParticipants = originalParticipants.filter(p => p.id !== charIdToRemove);

        // Optimistic UI update
        selectedChat.participants = newParticipants;
        this.#updateRightPanel(); // Refresh participant list UI
        this.updateModalListView(); // Refresh disabled state in the (possibly open) modal

        try {
            await api.put(`/api/chats/${selectedChat.id}`, { participants: newParticipants.map(p => ({id: p.id})) });
        } catch (error) {
            notifier.show({ header: 'Error', message: 'Failed to remove participant.' });
            // Revert on failure
            selectedChat.participants = originalParticipants;
            this.#updateRightPanel();
            this.updateModalListView();
        }
    }

    async handleModalCharacterSelect(event) {
        const charIdToAdd = event.detail.item.id;
        const selectedChat = this.state.selectedChat;
        if (!selectedChat || selectedChat.participants.some(p => p.id === charIdToAdd)) return;

        // --- Optimistic Update ---
        const originalParticipants = [...selectedChat.participants];
        const newParticipants = [...originalParticipants, { id: charIdToAdd }];

        // Update the state immediately
        selectedChat.participants = newParticipants;
        
        // Update UI that depends on this state
        this.updateModalListView(); // This will disable the added character in the modal list
        this.#updateRightPanel();   // This will show the new character in the participants list

        try {
            // The body should only contain what we want to change.
            await api.put(`/api/chats/${selectedChat.id}`, { participants: newParticipants.map(p => ({id: p.id})) });
            // Success! The server will confirm with an SSE event which will just re-set the state to what we already have.
        } catch (error) {
            notifier.show({ header: 'Error', message: 'Failed to add participant.' });
            
            // --- Revert optimistic update on failure ---
            selectedChat.participants = originalParticipants;
            this.updateModalListView();
            this.#updateRightPanel();
        }
    }

    handleModalSearch() {
        this.updateModalListView();
    }

    async #handleSendMessage(promptText) {
        if (this.state.isSending || !this.state.selectedChat || !this.#activeChatMode) {
            return;
        }

        const message = promptText.trim();
        if (!message) return;
        
        this.state.isSending = true;
        this.#activeChatMode.updateInputState(true);
        
        const userMessage = {
            id: `user-${uuidv4()}`,
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
            characterId: this.state.userPersona?.id || null
        };

        // Delegate rendering of optimistic messages to the chat mode
        const messageToUpdate = this.#activeChatMode.onPromptStart(userMessage);
        
        const fetchPromise = fetch(`/api/chats/${this.state.selectedChat.id}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        });

        await this.#handleStreamedResponse(fetchPromise, messageToUpdate, 'Prompt Error');
    }
    
    handleBackToChats() {
        if (this.state.isMultiSelectMode) {
            this.toggleMultiSelectMode(); // Exit multi-select mode
        } else {
            this.state.selectedChat = null;
        }
        this.updateView();
    }

    async handleChatNameSave(event) {
        const newName = event.target.value.trim();
        if (!newName || !this.state.selectedChat || newName === this.state.selectedChat.name) return;
        try {
            await api.put(`/api/chats/${this.state.selectedChat.id}`, { name: newName });
            notifier.show({ header: 'Chat Renamed', message: 'Chat name updated successfully.' });
        } catch (error) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not rename chat.' });
        }
    }

    handleChatNameEdit() {
        const nameInput = this.shadowRoot.querySelector('#chat-name-input');
        if (!nameInput) return; // Should not happen on desktop
        
        modal.show({
            title: "Rename Chat",
            content: `<input type="text" id="modal-chat-name" class="form-group" value="${this.state.selectedChat.name}">`,
            buttons: [
                {
                    label: "Cancel",
                    className: "button-secondary",
                    onClick: () => modal.hide(),
                },
                {
                    label: "Save",
                    className: "button-primary",
                    onClick: () => {
                        const newName = document.getElementById('modal-chat-name').value;
                        this.handleChatNameSave({ target: { value: newName }});
                        modal.hide();
                    }
                }
            ]
        });
        setTimeout(() => document.getElementById('modal-chat-name')?.focus(), 100);
    }

    async handleGoToParentChat() {
        if (!this.state.selectedChat || !this.state.selectedChat.parentId) return;
        try {
            this.state.selectedChat = await api.get(`/api/chats/${this.state.selectedChat.parentId}`);
            this.updateView();
            notifier.show({ message: 'Navigated to parent chat.' });
        } catch (error) {
            console.error('Failed to load parent chat:', error);
            notifier.show({ header: 'Error', message: 'Could not load parent chat.' });
        }
    }
    
    // --- Message Actions (delete, edit, etc.) ---
    #handleDeleteMessage(messageId) {
        modal.confirm({
            title: 'Delete Message',
            content: `Are you sure you want to delete this message?`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                const updatedChatState = JSON.parse(JSON.stringify(this.state.selectedChat));
                updatedChatState.messages = updatedChatState.messages.filter(m => m.id !== messageId);
                try {
                    await api.put(`/api/chats/${this.state.selectedChat.id}`, updatedChatState);
                    notifier.show({ message: 'Message deleted.' });
                } catch (error) {
                    notifier.show({ header: 'Error', message: 'Could not delete message.' });
                }
            }
        });
    }

    async #saveEditedMessage(messageId, newContent) {
        const updatedChatState = JSON.parse(JSON.stringify(this.state.selectedChat));
        const messageToUpdate = updatedChatState.messages.find(m => m.id === messageId);
        if (messageToUpdate) {
            messageToUpdate.content = newContent;
            try {
                await api.put(`/api/chats/${this.state.selectedChat.id}`, updatedChatState);
                notifier.show({ message: 'Message updated.', type: 'good' });
            } catch (error) {
                notifier.show({ header: 'Error', message: 'Could not save message edit.', type: 'bad' });
            }
        }
    }

    async #handleBranchMessage(messageId) {
        if (!this.state.selectedChat) return;
        try {
            const newChat = await api.post(`/api/chats/${this.state.selectedChat.id}/branch`, { messageId });
            this.state.selectedChat = newChat; // Set the new chat as selected
            this.updateView(); // Update the UI to show the new chat
            notifier.show({ type: 'good', header: 'Chat Branched', message: 'A new chat has been created from this point and is now active.' });
        } catch (error) {
            console.error('Failed to branch chat:', error);
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not create a branch.' });
        }
    }

    async #handleRegenerateMessage(messageId) {
        if (this.state.isSending || !this.state.selectedChat || !this.#activeChatMode) return;

        const messageIndex = this.state.selectedChat.messages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return;

        const messageToRegen = this.state.selectedChat.messages[messageIndex];
        const originalContent = messageToRegen.content;
        let fetchPromise;
        
        this.state.isSending = true;
        this.#activeChatMode.updateInputState(true);

        // Delegate UI updates to the chat mode and get back the message object to update
        const messageToUpdate = this.#activeChatMode.onRegenerateStart(messageToRegen);
        if (!messageToUpdate) {
            this.state.isSending = false;
            this.#activeChatMode.updateInputState(false);
            console.warn("Chat mode could not handle regeneration start.");
            return;
        }

        if (messageToRegen.role === 'assistant') {
            // Regenerate the assistant's own message
            fetchPromise = fetch(`/api/chats/${this.state.selectedChat.id}/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId: messageId }),
            });
        } else if (messageToRegen.role === 'user') {
            // Resend from the user's message
            fetchPromise = fetch(`/api/chats/${this.state.selectedChat.id}/resend`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
            });
        } else {
            this.state.isSending = false;
            this.#activeChatMode.updateInputState(false);
            return; // Cannot regenerate from system messages
        }
        
        await this.#handleStreamedResponse(fetchPromise, messageToUpdate, 'Regeneration Error', originalContent);
    }
    
    async #copyMessageContent(content) {
        try {
            await navigator.clipboard.writeText(content);
            notifier.show({ message: 'Copied to clipboard.' });
        } catch (err) {
            notifier.show({ header: 'Copy Failed', message: 'Could not copy text to clipboard.', type: 'warn' });
        }
    }

    async #handleStreamedResponse(fetchPromise, messageToUpdate, errorHeader, originalContentOnError = null) {
        try {
            const response = await fetchPromise;
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(`Server error: ${errorBody.message || response.statusText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let isFirstToken = true;
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const eventMessages = buffer.split('\n\n');
                buffer = eventMessages.pop(); 

                for (const msg of eventMessages) {
                    if (!msg.startsWith('data:')) continue;
                    try {
                        const payload = JSON.parse(msg.substring(6));
                        if (payload.token) {
                            if (isFirstToken) {
                                messageToUpdate.content = '';
                                isFirstToken = false;
                            }
                            messageToUpdate.content += payload.token;
                            this.#activeChatMode?.onToken(payload.token, messageToUpdate);
                        }
                    } catch (e) {
                         console.error("Error parsing SSE data chunk:", e, msg);
                    }
                }
            }
        } catch (error) {
            console.error(`${errorHeader} failed:`, error);
            messageToUpdate.content = `**Error:** Could not get response.\n*${error.message}*`;
            if (originalContentOnError) {
                messageToUpdate.content += `\n\n--- (Previous content) ---\n\n${originalContentOnError}`;
            }
            notifier.show({ header: errorHeader, message: error.message, type: 'bad' });
        } finally {
            this.state.isSending = false;
            // The final state will be pushed via SSE from the server.
            // onFinish just lets the mode know to re-enable input and finalize rendering.
            this.#activeChatMode?.onFinish(messageToUpdate);
        }
    }

    // --- View and Panel Management ---
    handleParticipantsToggle() { this.toggleParticipantsPanel(true); }

    toggleParticipantsPanel(show) {
        const panel = this.shadowRoot.querySelector('.panel-right');
        const overlay = this.shadowRoot.querySelector('.view-overlay');
        panel.classList.toggle('visible', show);
        overlay.classList.toggle('visible', show);
    }
    
    openCharacterModal() {
        this.updateModalListView();
        this.shadowRoot.querySelector('#add-character-modal').style.display = 'flex';
    }

    closeCharacterModal() {
        this.shadowRoot.querySelector('#add-character-modal').style.display = 'none';
    }

    updateModalListView() {
        const list = this.shadowRoot.querySelector('#modal-character-list');
        const search = this.shadowRoot.querySelector('#modal-search-input').value.toLowerCase();
        
        const filteredChars = this.state.allCharacters.filter(char => 
            char.name.toLowerCase().includes(search)
        );
        list.items = filteredChars;
        list.disabledIds = this.state.selectedChat?.participants.map(p => p.id) || [];
    }
    
    // --- Multi-Select Mode ---
    toggleMultiSelectMode() {
        this.state.isMultiSelectMode = !this.state.isMultiSelectMode;
        const chatList = this.shadowRoot.querySelector('#chat-list');
        chatList.multiSelect = this.state.isMultiSelectMode;

        if (!this.state.isMultiSelectMode) {
            this.state.multiSelectedChatIds = [];
        }

        this.updateMultiSelectControls();
        this.updateView();
    }

    handleMultiSelectionChange(event) {
        this.state.multiSelectedChatIds = event.detail.selectedIds;
        this.updateMultiSelectControls();
    }
    
    updateMultiSelectControls() {
        const controls = this.shadowRoot.querySelector('#multi-select-controls');
        const deleteBtn = this.shadowRoot.querySelector('#delete-selected-btn');
        controls.style.display = this.state.isMultiSelectMode ? 'flex' : 'none';
        deleteBtn.disabled = this.state.multiSelectedChatIds.length === 0;
        deleteBtn.textContent = `Delete Selected (${this.state.multiSelectedChatIds.length})`;
    }

    async handleDeleteSelectedChats() {
        const idsToDelete = this.state.multiSelectedChatIds;
        if (idsToDelete.length === 0) return;

        modal.confirm({
            title: `Delete ${idsToDelete.length} Chats`,
            content: `Are you sure you want to permanently delete these ${idsToDelete.length} chats? This action cannot be undone.`,
            confirmLabel: 'Delete All',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                const deletePromises = idsToDelete.map(id => api.delete(`/api/chats/${id}`));
                const results = await Promise.allSettled(deletePromises);
                
                const successCount = results.filter(r => r.status === 'fulfilled').length;
                const failCount = results.length - successCount;

                if (successCount > 0) {
                    notifier.show({ type: 'good', message: `Successfully deleted ${successCount} chats.` });
                }
                if (failCount > 0) {
                    notifier.show({ type: 'bad', message: `Failed to delete ${failCount} chats.` });
                }
                
                this.toggleMultiSelectMode(); // Exit multi-select mode
            }
        });
    }

    // --- Main Update Logic ---
    
    #buildChatTree(chats) {
        const chatMap = new Map(chats.map(chat => [chat.id, { ...chat, children: [] }]));
        const treeRoots = [];

        for (const chat of chatMap.values()) {
            if (chat.parentId && chatMap.has(chat.parentId)) {
                chatMap.get(chat.parentId).children.push(chat);
            } else {
                treeRoots.push(chat);
            }
        }

        // Helper to find the latest modification date in a subtree
        const findLatestModDate = (node) => {
            let maxDate = new Date(node.lastModifiedAt);
            for (const child of node.children) {
                const childMaxDate = findLatestModDate(child);
                if (childMaxDate > maxDate) {
                    maxDate = childMaxDate;
                }
            }
            node.effectiveLastModifiedAt = maxDate;
            return maxDate;
        };

        // Calculate effective modification date and sort children
        for (const root of treeRoots) {
            findLatestModDate(root);
            (function sortChildren(node) {
                if (node.children.length > 0) {
                    node.children.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
                    for(const child of node.children) {
                        sortChildren(child);
                    }
                }
            })(root);
        }
        
        // Sort root-level chats by their most recent activity (including branches)
        treeRoots.sort((a, b) => b.effectiveLastModifiedAt - a.effectiveLastModifiedAt);

        return treeRoots;
    }

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const backButton = this.shadowRoot.querySelector('#back-to-chats-btn');

        if (isMobile) {
            if (this.state.selectedChat) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                backButton.style.display = 'flex';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
                backButton.style.display = 'none';
            }
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            backButton.style.display = 'none';
        }

        const chatList = this.shadowRoot.querySelector('#chat-list');
        chatList.items = this.#buildChatTree(this.state.chats);
        chatList.selectedId = this.state.selectedChat?.id;
        
        this.updateMainPanel();
        this.#updateRightPanel();
    }

    updateMainPanel() {
        const mainHeader = this.shadowRoot.querySelector('.chat-main-header');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-chat-header');
        const nameInput = this.shadowRoot.querySelector('#chat-name-input');
        const mobileTitle = this.shadowRoot.querySelector('#chat-title-mobile');
        const mobileButton = this.shadowRoot.querySelector('#participants-btn');
        const placeholder = this.shadowRoot.querySelector('.placeholder');
        const modeContainer = this.shadowRoot.querySelector('#chat-mode-container');
        const goToParentBtn = this.shadowRoot.querySelector('#go-to-parent-btn');

        if (this.state.selectedChat) {
            mainHeader.style.display = window.matchMedia('(max-width: 768px)').matches ? 'none' : 'flex';
            placeholder.style.display = 'none';
            modeContainer.style.display = 'flex';

            nameInput.value = this.state.selectedChat.name;
            mobileTitle.textContent = this.state.selectedChat.name;
            mobileButton.style.display = 'flex';

            goToParentBtn.style.display = this.state.selectedChat.parentId ? 'flex' : 'none';
            
            this.updateChatMode();
            this.#activeChatMode?.updateInputState(this.state.isSending);
        } else {
            mainHeader.style.display = 'none';
            goToParentBtn.style.display = 'none';

            if (this.#activeChatMode) {
                this.#activeChatMode.onDestroy();
                this.#activeChatMode = null;
            }
            modeContainer.innerHTML = '';
            modeContainer.style.display = 'none';
            placeholder.style.display = 'flex'; 
            
            let placeholderText = 'Select or create a chat to begin.';
            let mobileHeaderText = 'Chats';
            if (this.state.isMultiSelectMode) {
                mobileHeaderText = 'Select to Delete';
                mobileButton.style.display = 'none';
            } else {
                mobileButton.style.display = 'flex';
            }
            placeholder.querySelector('h3').textContent = placeholderText;
            mobileTitle.textContent = mobileHeaderText;
        }
    }
    
    updateChatMode() {
        const modeContainer = this.shadowRoot.querySelector('#chat-mode-container');
        const renderer = this.state.chatRenderer;
        
        const modeTagName = chatModeRegistry.getTagName(renderer);

        if (!modeTagName) {
            console.error(`No chat mode component registered for renderer type "${renderer}". Cannot display chat.`);
            if (this.#activeChatMode) {
                this.#activeChatMode.onDestroy();
                this.#activeChatMode = null;
            }
            modeContainer.innerHTML = `<div class="placeholder"><h3>Error: Unknown chat renderer "${renderer}".</h3></div>`;
            return;
        }

        if (!this.#activeChatMode || this.#activeChatMode.tagName.toLowerCase() !== modeTagName) {
            if (this.#activeChatMode) {
                this.#activeChatMode.onDestroy();
            }
            modeContainer.innerHTML = '';
            this.#activeChatMode = document.createElement(modeTagName);
            modeContainer.appendChild(this.#activeChatMode);
        }
        
        this.#activeChatMode.initialize({
            chat: this.state.selectedChat,
            allCharacters: this.state.allCharacters,
            userPersona: this.state.userPersona,
            mainView: this,
            rendererType: renderer,
        });
    }

    #updateRightPanel() {
        const participantList = this.shadowRoot.querySelector('#participant-list');
        if (this.state.selectedChat) {
            participantList.style.display = 'flex';
            const participantItems = this.state.selectedChat.participants
                .map(p => this.state.allCharacters.find(char => char.id === p.id))
                .filter(Boolean);
            participantList.items = participantItems;
            participantList.readonlyIds = [];
        } else {
            participantList.style.display = 'none';
        }
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <div id="multi-select-controls">
                        <button id="delete-selected-btn" class="button-danger" disabled>Delete Selected</button>
                        <button id="cancel-multiselect-btn" class="button-secondary">Cancel</button>
                    </div>
                    <item-list id="chat-list" list-title="Chats" items-creatable items-removable has-avatar></item-list>
                </div>
                <div class="panel-main view-container">
                    <header class="mobile-chat-header">
                        <button id="back-to-chats-btn" class="icon-button" title="Back to Chats"><span class="material-icons">arrow_back</span></button>
                        <h2 id="chat-title-mobile">Select a Chat</h2>
                        <button id="participants-btn" class="icon-button" title="View Participants"><span class="material-icons">people</span></button>
                    </header>
                    <header class="chat-main-header">
                        <input type="text" id="chat-name-input" placeholder="Chat Name">
                        <button id="go-to-parent-btn" class="icon-button" title="Go to Parent Chat">
                            <span class="material-icons">arrow_upward</span>
                        </button>
                    </header>
                    <div id="chat-mode-container"></div>
                    <div class="placeholder">
                        <h3>Select or create a chat to begin.</h3>
                    </div>
                </div>
                <div class="panel-right">
                    <item-list id="participant-list" list-title="Participants" items-removable has-avatar></item-list>
                </div>
            </div>
            
            <div id="add-character-modal" class="modal-backdrop">
                <div class="modal-content">
                    <header>
                        <h2>Add Character to Chat</h2>
                        <button class="close-modal-btn" title="Close"><span class="material-icons">close</span></button>
                    </header>
                    <div class="modal-body">
                        <div class="modal-search-bar">
                            <span class="material-icons">search</span>
                            <input type="text" id="modal-search-input" placeholder="Search for characters...">
                        </div>
                        <item-list id="modal-character-list" has-avatar></item-list>
                    </div>
                </div>
            </div>

            <div class="view-overlay"></div>
            `, this.styles()
        );

        this.shadowRoot.querySelector('#participant-list').headerActions = [
            { name: 'add-participant', icon: 'person_add', title: 'Add Participant' }
        ];
    }
    
    styles() { return `
            @import url('/style.css');
            :host { --chat-form-min-height: calc(48px + 2 * var(--spacing-md)); }
            .panel-left { flex-direction: column; }
            #multi-select-controls { padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--bg-3); display: none; gap: var(--spacing-sm); background-color: var(--bg-2); flex-shrink: 0; }
            #multi-select-controls button { flex-grow: 1; padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-size-sm); }
            #chat-list { flex-grow: 1; }
            .panel-main { padding: 0; position: relative; }
            .chat-main-header { display: none; padding: var(--spacing-sm) var(--spacing-lg); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; align-items: center; gap: var(--spacing-md); } /* Added align-items and gap */
            #chat-name-input { flex-grow: 1; font-size: 1.2rem; font-weight: 600; background: none; border: none; outline: none; color: var(--text-primary); padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            #chat-name-input:focus { background-color: var(--bg-1); }
            #chat-mode-container { display: none; flex-grow: 1; flex-direction: column; overflow: hidden; }
            .placeholder { flex-grow: 1; display: flex; align-items: center; justify-content: center; color: var(--text-disabled); text-align: center; padding: 0 var(--spacing-md); }
            .mobile-chat-header, #back-to-chats-btn, .view-overlay { display: none; }
            .modal-backdrop { position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 1000; }
            .modal-content { background-color: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius-md); width: 90%; max-width: 500px; height: 80vh; display: flex; flex-direction: column; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
            .modal-content header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md) var(--spacing-lg); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; }
            .modal-content header h2 { margin: 0; font-size: 1.1rem; }
            .close-modal-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            .modal-body { display: flex; flex-direction: column; overflow-y: hidden; padding: var(--spacing-md); flex-grow: 1; gap: var(--spacing-md); }
            .modal-search-bar { display: flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); border: 1px solid var(--bg-3); background-color: var(--bg-0); border-radius: var(--radius-sm); flex-shrink: 0; }
            #modal-search-input { background: none; border: none; outline: none; width: 100%; color: var(--text-primary); font-size: var(--font-size-md); }
            #modal-character-list { flex-grow: 1; border: 1px solid var(--bg-3); border-radius: var(--radius-sm); background-color: var(--bg-0); }

            #go-to-parent-btn {
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                padding: var(--spacing-xs);
                display: none; /* Hidden by default */
                align-items: center;
                justify-content: center;
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
            }
            #go-to-parent-btn:hover {
                background-color: var(--bg-2);
                color: var(--text-primary);
            }
            #go-to-parent-btn .material-icons {
                font-size: 1.5rem;
            }


            @media (max-width: 768px) {
                .panel-main { padding: 0; height: 100%; }
                .chat-main-header { display: none !important; }
                .mobile-chat-header { display: flex; padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; align-items: center; gap: var(--spacing-xs); }
                #back-to-chats-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); display: flex; align-items: center; }
                #chat-title-mobile { font-size: 1.1rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; cursor: pointer; }
                #participants-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); }
                .panel-right { position: fixed; top: 0; right: 0; width: 85%; max-width: 320px; height: 100%; z-index: 1001; transform: translateX(100%); transition: transform 0.3s ease-in-out; box-shadow: -2px 0 8px rgba(0,0,0,0.3); border-left: 1px solid var(--bg-3); }
                .panel-right.visible { transform: translateX(0); }
                .view-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); z-index: 1000; }
                .view-overlay.visible { display: block; }
            }
        `; }
}

customElements.define('main-chat-view', MainChatView);