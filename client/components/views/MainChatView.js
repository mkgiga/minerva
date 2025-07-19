// client/components/views/MainChatView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier, uuidv4 } from '../../client.js';
import { chatModeRegistry } from '../../ChatModeRegistry.js';
import '../ItemList.js';

class MainChatView extends BaseComponent {
    #activeChatMode = null;
    #abortController = null;

    constructor() {
        super();
        this.state = {
            chats: [],
            allCharacters: [],
            allScenarios: [],
            selectedChat: null,
            isSending: false,
            userPersona: null,
            chatRenderer: 'raw',
            chatModeSettings: {},
            isMultiSelectMode: false,
            multiSelectedChatIds: new Set(),
            expandedChatIds: new Set(),
        };

        // Bind methods for event listeners
        this.handleItemAction = this.handleItemAction.bind(this);
        this.handleChatAdd = this.handleChatAdd.bind(this);
        this.handleHeaderAction = this.handleHeaderAction.bind(this);
        this.handleParticipantAction = this.handleParticipantAction.bind(this);
        this.handleModalCharacterAction = this.handleModalCharacterAction.bind(this);
        this.closeCharacterModal = this.closeCharacterModal.bind(this);
        this.handleModalSearch = this.handleModalSearch.bind(this);
        this.handleParticipantsToggle = this.handleParticipantsToggle.bind(this);
        this.handleBackToChats = this.handleBackToChats.bind(this);
        this.handleChatNameSave = this.handleChatNameSave.bind(this);
        this.handleChatNameEdit = this.handleChatNameEdit.bind(this);
        this.toggleMultiSelectMode = this.toggleMultiSelectMode.bind(this);
        this.handleDeleteSelectedChats = this.handleDeleteSelectedChats.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleGoToParentChat = this.handleGoToParentChat.bind(this);
        this.openScenarioModal = this.openScenarioModal.bind(this);
        this.closeScenarioModal = this.closeScenarioModal.bind(this);
        this.handleModalScenarioAction = this.handleModalScenarioAction.bind(this);
        this.handleActiveScenarioAction = this.handleActiveScenarioAction.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.attachEventListeners();
        await this.fetchInitialData();
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
    }

    attachEventListeners() {
        this.shadowRoot.querySelector('#chat-list').addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#chat-list-header').addEventListener('click', e => {
            const actionTarget = e.target.closest('[data-action]');
            if (!actionTarget) return;
            switch(actionTarget.dataset.action) {
                case 'add': this.handleChatAdd(); break;
                case 'multi-select': this.toggleMultiSelectMode(); break;
            }
        });
        
        // Right Panel (Participants & Scenarios)
        this.shadowRoot.querySelector('#participant-list').addEventListener('item-action', this.handleParticipantAction);
        this.shadowRoot.querySelector('#participant-list-header').addEventListener('click', this.handleHeaderAction);
        this.shadowRoot.querySelector('#active-scenario-list').addEventListener('item-action', this.handleActiveScenarioAction);
        this.shadowRoot.querySelector('#scenario-list-header').addEventListener('click', e => {
            if (e.target.closest('[data-action="add-scenario"]')) this.openScenarioModal();
        });
        
        // Add Character Modal
        const charModalEl = this.shadowRoot.querySelector('#add-character-modal');
        charModalEl.addEventListener('click', (e) => { if (e.target === charModalEl) this.closeCharacterModal(); });
        this.shadowRoot.querySelector('#close-char-modal-btn').addEventListener('click', this.closeCharacterModal);
        this.shadowRoot.querySelector('#modal-character-list').addEventListener('item-action', this.handleModalCharacterAction);
        this.shadowRoot.querySelector('#modal-search-input').addEventListener('input', this.handleModalSearch);
        
        // Add Scenario Modal
        const scenarioModalEl = this.shadowRoot.querySelector('#add-scenario-modal');
        scenarioModalEl.addEventListener('click', (e) => { if (e.target === scenarioModalEl) this.closeScenarioModal(); });
        this.shadowRoot.querySelector('#close-scenario-modal-btn').addEventListener('click', this.closeScenarioModal);
        this.shadowRoot.querySelector('#modal-scenario-list').addEventListener('item-action', this.handleModalScenarioAction);

        this.shadowRoot.querySelector('#participants-btn').addEventListener('click', this.handleParticipantsToggle);
        this.shadowRoot.querySelector('#scenarios-btn').addEventListener('click', this.openScenarioModal);
        this.shadowRoot.querySelector('#back-to-chats-btn').addEventListener('click', this.handleBackToChats);
        this.shadowRoot.querySelector('.view-overlay').addEventListener('click', () => this.toggleParticipantsPanel(false));
        
        this.shadowRoot.querySelector('#chat-name-input').addEventListener('change', this.handleChatNameSave);
        this.shadowRoot.querySelector('#chat-title-mobile').addEventListener('click', this.handleChatNameEdit);

        this.shadowRoot.querySelector('#delete-selected-btn').addEventListener('click', this.handleDeleteSelectedChats);
        this.shadowRoot.querySelector('#cancel-multiselect-btn').addEventListener('click', this.toggleMultiSelectMode);

        this.shadowRoot.querySelector('#go-to-parent-btn').addEventListener('click', this.handleGoToParentChat);

        const modeContainer = this.shadowRoot.querySelector('#chat-mode-container');
        modeContainer.addEventListener('chat-mode-send-prompt', e => this.#handleSendMessage(e.detail.promptText));
        modeContainer.addEventListener('chat-mode-regenerate-message', e => this.#handleRegenerateMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-branch-message', e => this.#handleBranchMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-edit-message', e => this.#saveEditedMessage(e.detail.messageId, e.detail.newContent));
        modeContainer.addEventListener('chat-mode-delete-message', e => this.#handleDeleteMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-copy-message', e => this.#copyMessageContent(e.detail.content));
        modeContainer.addEventListener('chat-mode-go-to-parent', this.handleGoToParentChat);
        modeContainer.addEventListener('chat-mode-abort-generation', () => this.#abortController?.abort());
    }

    async fetchInitialData() {
        try {
            const [chats, characters, settings, scenarios] = await Promise.all([
                api.get('/api/chats'),
                api.get('/api/characters'),
                api.get('/api/settings'),
                api.get('/api/scenarios'),
            ]);
            this.state.chats = chats;
            this.state.allCharacters = characters;
            this.state.allScenarios = scenarios;
            this.state.chatRenderer = settings.chat?.renderer || 'raw';
            this.state.chatModeSettings = settings.chatModes || {};

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
    
    _escapeHtml(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Event Handlers
    
    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
    
        const oldSelectedChat = this.state.selectedChat ? JSON.parse(JSON.stringify(this.state.selectedChat)) : null;
    
        let requiresChromeUpdate = false;
        let characterListChanged = false;
        let userPersonaChanged = false;
        let rendererChanged = false;
        let scenarioListChanged = false;
    
        switch (resourceType) {
            case 'chat':
                requiresChromeUpdate = this.handleChatListChange(eventType, data) || requiresChromeUpdate;
                break;
    
            case 'chat_details':
                if (eventType === 'update' && this.state.selectedChat?.id === data.id) {
                    this.state.selectedChat = data;
                    if (this.#activeChatMode) this.#activeChatMode.chat = data;
                    requiresChromeUpdate = true;
    
                    this.#diffChatAndUpdateMode(oldSelectedChat, data);
                }
                break;
    
            case 'character':
                characterListChanged = this.handleCharacterListChange(eventType, data) || characterListChanged;
                requiresChromeUpdate = true;
                break;
                
            case 'scenario':
                scenarioListChanged = this.handleScenarioListChange(eventType, data) || scenarioListChanged;
                requiresChromeUpdate = true;
                break;
    
            case 'setting':
                const oldPersonaId = this.state.userPersona?.id;
                const oldRenderer = this.state.chatRenderer;
                const settingsChanged = this.handleSettingChange(data);
                if (this.state.userPersona?.id !== oldPersonaId) userPersonaChanged = true;
                if (this.state.chatRenderer !== oldRenderer) rendererChanged = true;
                requiresChromeUpdate = settingsChanged || requiresChromeUpdate;
                break;
        }
    
        if (requiresChromeUpdate) {
            this.updateViewChrome();
        }
    
        if (this.#activeChatMode) {
            if (rendererChanged) {
                this.updateMainPanel(); // This will trigger a mode switch
            }
            if (characterListChanged) {
                this.#activeChatMode.allCharacters = [...this.state.allCharacters];
                this.#activeChatMode.onAllCharactersChanged();
            }
            if (userPersonaChanged) {
                this.#activeChatMode.userPersona = this.state.userPersona;
                this.#activeChatMode.onUserPersonaChanged();
            }
        }
    }

    #diffChatAndUpdateMode(oldChat, newChat) {
        if (!this.#activeChatMode || !oldChat || !newChat) return;
    
        // Participant changes are simple and can be handled first.
        const oldParticipants = (oldChat.participants || []).map(p => p.id).sort();
        const newParticipants = (newChat.participants || []).map(p => p.id).sort();
        if (JSON.stringify(oldParticipants) !== JSON.stringify(newParticipants)) {
            this.#activeChatMode.onParticipantsChanged();
        }
    
        // More robust message diffing to handle complex cases like regeneration
        // (which is a combination of message update and message deletion).
        const oldMessages = oldChat.messages || [];
        const newMessages = newChat.messages || [];
        const oldMsgMap = new Map(oldMessages.map(m => [m.id, m]));
        const newMsgMap = new Map(newMessages.map(m => [m.id, m]));
    
        const deletedIds = [];
        const updatedMessages = [];
        const addedMessages = [];
    
        // Check for deleted and updated messages by iterating old messages
        for (const oldMsg of oldMessages) {
            const newMsg = newMsgMap.get(oldMsg.id);
            if (!newMsg) {
                deletedIds.push(oldMsg.id);
            } else if (newMsg.content !== oldMsg.content) {
                updatedMessages.push(newMsg);
            }
        }
    
        // Check for added messages by iterating new messages
        for (const newMsg of newMessages) {
            if (!oldMsgMap.has(newMsg.id)) {
                addedMessages.push(newMsg);
            }
        }
    
        // Call hooks in a logical order: deletions, then updates, then additions.
        // This ensures the DOM is in a clean state before updates/additions happen.
        if (deletedIds.length > 0) {
            this.#activeChatMode.onMessagesDeleted(deletedIds);
        }
        if (updatedMessages.length > 0) {
            for (const msg of updatedMessages) {
                this.#activeChatMode.onMessageUpdated(msg);
            }
        }
        if (addedMessages.length > 0) {
            this.#activeChatMode.onMessagesAdded(addedMessages);
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
                    this.state.chats[listIdx] = {
                        ...this.state.chats[listIdx],
                        ...data,
                        childChatIds: data.childChatIds || []
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
    
    handleScenarioListChange(eventType, data) {
        let changed = false;
        switch (eventType) {
            case 'create': this.state.allScenarios.push(data); changed = true; break;
            case 'update': {
                const index = this.state.allScenarios.findIndex(s => s.id === data.id);
                if (index > -1) this.state.allScenarios[index] = data;
                changed = true;
                break;
            }
            case 'delete': {
                const originalLength = this.state.allScenarios.length;
                this.state.allScenarios = this.state.allScenarios.filter(s => s.id !== data.id);
                changed = this.state.allScenarios.length < originalLength;
                break;
            }
        }
        return changed;
    }

    handleSettingChange(settings) {
        let needsUpdate = false;
        const oldPersonaId = this.state.userPersona?.id;
        const oldRenderer = this.state.chatRenderer;
    
        // Update persona
        if (settings.userPersonaCharacterId !== oldPersonaId) {
            this.state.userPersona = this.state.allCharacters.find(c => c.id === settings.userPersonaCharacterId) || null;
            needsUpdate = true;
        }
    
        // Update chat renderer
        if (settings.chat?.renderer !== oldRenderer) {
            this.state.chatRenderer = settings.chat.renderer;
            needsUpdate = true;
        }
        
        // Update chat mode specific settings
        const oldModeSettings = this.state.chatModeSettings;
        this.state.chatModeSettings = settings.chatModes || {};
    
        if (this.#activeChatMode && JSON.stringify(oldModeSettings) !== JSON.stringify(this.state.chatModeSettings)) {
            const renderer = this.state.chatRenderer;
            const newSettingsForMode = this.state.chatModeSettings[renderer] || {};
            const oldSettingsForMode = oldModeSettings[renderer] || {};
            
            // Only call the hook if the settings for *this specific mode* have changed.
            if (JSON.stringify(newSettingsForMode) !== JSON.stringify(oldSettingsForMode)) {
                // Update the mode's settings and call the hook
                this.#activeChatMode.settings = { ...this.#activeChatMode.constructor.getDefaultSettings(), ...newSettingsForMode };
                this.#activeChatMode.onSettingsChanged(newSettingsForMode);
            }
        }
        
        return needsUpdate;
    }

    handleItemAction(event) {
        const { id, action, listItem } = event.detail;
    
        if (this.state.isMultiSelectMode) {
            this.handleMultiSelectionChange(id);
            return;
        }

        switch(action) {
            case 'select': {
                const chat = this.state.chats.find(c => c.id === id);
                if (chat) this.handleChatSelect(chat);
                break;
            }
            case 'delete': {
                const rootIdToDelete = listItem.dataset.rootId || id;
                const chat = this.state.chats.find(c => c.id === rootIdToDelete);
                if(chat) this.handleChatDelete(chat);
                break;
            }
            case 'toggle-expand':
                const rootIdToToggle = listItem.dataset.rootId || id;
                if (this.state.expandedChatIds.has(rootIdToToggle)) {
                    this.state.expandedChatIds.delete(rootIdToToggle);
                } else {
                    this.state.expandedChatIds.add(rootIdToToggle);
                }
                this._renderChatList();
                break;
        }
    }
    
    async handleChatSelect(chat) {
        // Prevent re-selecting the same chat and causing a full refresh
        if (this.state.selectedChat?.id === chat.id) return;
        try {
            this.state.selectedChat = await api.get(`/api/chats/${chat.id}`);
            this.updateView();
            this.#activeChatMode?.onChatSwitched();
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
            this.#activeChatMode?.onChatSwitched();
        } catch (error) {
            console.error('Failed to create chat:', error);
            notifier.show({ header: 'Error', message: 'Could not create a new chat.' });
        }
    }

    handleChatDelete(chat) {
        modal.confirm({
            title: 'Delete Chat',
            content: `Are you sure you want to delete "${chat.name}"? This will also delete all its branches. This cannot be undone.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/chats/${chat.id}`);
                    notifier.show({ message: `Chat "${chat.name}" deleted.` });
                } catch (error) {
                    notifier.show({ header: 'Error', message: `Could not delete chat "${chat.name}".` });
                }
            }
        });
    }

    handleHeaderAction(event) {
        if (event.target.closest('[data-action="add-participant"]')) {
            if (window.matchMedia('(max-width: 768px)').matches) {
                this.toggleParticipantsPanel(false);
            }
            this.openCharacterModal();
        }
    }

    handleParticipantAction(event) {
        const { id, action } = event.detail;
        if (action === 'delete') {
            this.handleParticipantDelete(id);
        }
    }

    async handleParticipantDelete(charIdToRemove) {
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;
        
        const character = this.state.allCharacters.find(c => c.id === charIdToRemove);
        if (!character) return;
        
        // Optimistic Update
        const originalParticipants = [...selectedChat.participants];
        selectedChat.participants = selectedChat.participants.filter(p => p.id !== charIdToRemove);
        this.#updateRightPanel(); // Re-render the side panel list immediately
        notifier.show({ header: 'Participant Removed', message: `${character.name} has left the chat.` });
    
        // API call in background
        try {
            await api.put(`/api/chats/${selectedChat.id}`, { participants: selectedChat.participants.map(p => ({id: p.id})) });
        } catch (error) {
            notifier.show({ header: 'Error', type: 'bad', message: 'Failed to remove participant. Reverting.' });
            // Revert on failure
            this.state.selectedChat.participants = originalParticipants;
            this.#updateRightPanel();
        }
    }
    
    handleModalCharacterAction(event) {
        const { id, action } = event.detail;
        if (action === 'select') {
            this.handleModalCharacterToggle(id);
        }
    }

    async handleModalCharacterToggle(charIdToToggle) {
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;
    
        const character = this.state.allCharacters.find(c => c.id === charIdToToggle);
        if (!character) return;
    
        const isParticipant = selectedChat.participants.some(p => p.id === charIdToToggle);
        const originalParticipants = [...selectedChat.participants];
        let notificationMessage;
    
        // OPTIMISTIC UI UPDATE
        if (isParticipant) {
            selectedChat.participants = selectedChat.participants.filter(p => p.id !== charIdToToggle);
            notificationMessage = { header: 'Participant Removed', message: `${character.name} has left the chat.` };
        } else {
            selectedChat.participants.push({ id: charIdToToggle });
            notificationMessage = { type: 'good', header: 'Participant Added', message: `${character.name} has joined the chat.` };
        }
    
        // Immediately update the UI based on the new local state
        this.updateModalListView();
        this.#updateRightPanel();
        notifier.show(notificationMessage);
    
        // API CALL IN BACKGROUND
        try {
            const finalParticipants = [...selectedChat.participants];
            await api.put(`/api/chats/${selectedChat.id}`, { participants: finalParticipants.map(p => ({id: p.id})) });
            // On success, the state is already correct. The SSE will just re-confirm it.
        } catch (error) {
            // REVERT ON FAILURE
            notifier.show({ type: 'bad', header: 'Error', message: 'Failed to update participants. Reverting change.' });
            this.state.selectedChat.participants = originalParticipants;
            this.updateModalListView();
            this.#updateRightPanel();
        }
    }
    
    handleModalScenarioAction(event) {
        const { id, action } = event.detail;
        if (action === 'select') this.handleModalScenarioToggle(id);
    }
    
    handleActiveScenarioAction(event) {
        const { id, action } = event.detail;
        if (action === 'delete') this.handleModalScenarioToggle(id);
    }

    async handleModalScenarioToggle(scenarioId) {
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;
        
        const scenario = this.state.allScenarios.find(s => s.id === scenarioId);
        if (!scenario) return;

        const originalScenarioIds = [...(selectedChat.scenarioIds || [])];
        let newScenarioIds;
        let notificationMessage;

        const isActive = originalScenarioIds.includes(scenarioId);

        if (isActive) {
            newScenarioIds = originalScenarioIds.filter(id => id !== scenarioId);
            notificationMessage = { message: `Scenario "${scenario.name}" removed from chat.` };
        } else {
            newScenarioIds = [...originalScenarioIds, scenarioId];
            notificationMessage = { type: 'good', message: `Scenario "${scenario.name}" added to chat.` };
        }
        
        // Optimistic update
        selectedChat.scenarioIds = newScenarioIds;
        this.updateScenarioModalListView();
        this.#updateRightPanel();
        notifier.show(notificationMessage);

        try {
            await api.put(`/api/chats/${selectedChat.id}`, { scenarioIds: newScenarioIds });
        } catch(e) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Failed to update scenarios. Reverting.' });
            selectedChat.scenarioIds = originalScenarioIds;
            this.updateScenarioModalListView();
            this.#updateRightPanel();
        }
    }

    handleModalSearch() {
        this.updateModalListView();
    }

    async #handleSendMessage(promptText) {
        if (this.state.isSending || !this.state.selectedChat || !this.#activeChatMode) return;
        const message = promptText.trim();
        if (!message) return;
        
        this.state.isSending = true;
        this.#activeChatMode.updateInputState(true);
        
        const userMessage = {
            id: `user-${uuidv4()}`, role: 'user', content: message,
            timestamp: new Date().toISOString(), characterId: this.state.userPersona?.id || null
        };

        const assistantMessageId = this.#activeChatMode.onPromptStart(userMessage);
        
        this.#abortController = new AbortController();
        const fetchPromise = fetch(`/api/chats/${this.state.selectedChat.id}/prompt`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }), signal: this.#abortController.signal,
        });

        await this.#handleStreamedResponse(fetchPromise, assistantMessageId, 'Prompt Error');
    }
    
    handleBackToChats() {
        if (this.state.isMultiSelectMode) {
            this.toggleMultiSelectMode();
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
        if (!nameInput) return;
        modal.show({
            title: "Rename Chat",
            content: `<input type="text" id="modal-chat-name" class="form-group" value="${this.state.selectedChat.name}">`,
            buttons: [
                { label: "Cancel", className: "button-secondary", onClick: () => modal.hide() },
                { label: "Save", className: "button-primary",
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
            this.#activeChatMode?.onChatSwitched();
            notifier.show({ message: 'Navigated to parent chat.' });
        } catch (error) {
            console.error('Failed to load parent chat:', error);
            notifier.show({ header: 'Error', message: 'Could not load parent chat.' });
        }
    }
    
    #handleDeleteMessage(messageId) {
        modal.confirm({
            title: 'Delete Message', content: `Are you sure you want to delete this message?`,
            confirmLabel: 'Delete', confirmButtonClass: 'button-danger',
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
            this.state.selectedChat = newChat;
            this.updateView();
            this.#activeChatMode?.onChatBranched();
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
        let fetchPromise;

        this.state.isSending = true;
        this.#activeChatMode.updateInputState(true);
        this.#activeChatMode.onRegenerateStart(messageId);

        this.#abortController = new AbortController();
        const { signal } = this.#abortController;
        
        if (messageToRegen.role === 'assistant') {
            fetchPromise = fetch(`/api/chats/${this.state.selectedChat.id}/regenerate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId: messageId }), signal,
            });
        } else if (messageToRegen.role === 'user') {
            fetchPromise = fetch(`/api/chats/${this.state.selectedChat.id}/resend`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}), signal
            });
        } else {
            this.state.isSending = false;
            this.#activeChatMode.updateInputState(false);
            return;
        }

        await this.#handleStreamedResponse(fetchPromise, messageId, 'Regeneration Error');
    }
    
    async #copyMessageContent(content) {
        try {
            await navigator.clipboard.writeText(content);
            notifier.show({ message: 'Copied to clipboard.' });
        } catch (err) {
            notifier.show({ header: 'Copy Failed', message: 'Could not copy text to clipboard.', type: 'warn' });
        }
    }

    async #handleStreamedResponse(fetchPromise, messageId, errorHeader) {
        this.#activeChatMode?.onStreamStart(messageId);
        try {
            const response = await fetchPromise;
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({ message: response.statusText }));
                throw new Error(`Server error: ${errorBody.message || response.statusText}`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            
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
                            this.#activeChatMode?.onToken(payload.token, messageId);
                        }
                    } catch (e) { console.error("Error parsing SSE data chunk:", e, msg); }
                }
            }
            this.#activeChatMode?.onStreamFinish(messageId);

        } catch (error) {
            if (error.name !== 'AbortError') {
                 console.error(`${errorHeader} failed:`, error);
                 notifier.show({ header: errorHeader, message: error.message, type: 'bad' });
            }
            this.#activeChatMode?.onStreamError(error, messageId);
        } finally {
            this.state.isSending = false;
            this.#abortController = null;
            this.#activeChatMode?.updateInputState(false);
        }
    }

    handleParticipantsToggle() { this.toggleParticipantsPanel(true); }
    toggleParticipantsPanel(show) {
        this.shadowRoot.querySelector('.panel-right').classList.toggle('visible', show);
        this.shadowRoot.querySelector('.view-overlay').classList.toggle('visible', show);
    }
    openCharacterModal() { this.updateModalListView(); this.shadowRoot.querySelector('#add-character-modal').style.display = 'flex'; }
    closeCharacterModal() { this.shadowRoot.querySelector('#add-character-modal').style.display = 'none'; }
    openScenarioModal() { this.updateScenarioModalListView(); this.shadowRoot.querySelector('#add-scenario-modal').style.display = 'flex'; }
    closeScenarioModal() { this.shadowRoot.querySelector('#add-scenario-modal').style.display = 'none'; }
    
    toggleMultiSelectMode() {
        this.state.isMultiSelectMode = !this.state.isMultiSelectMode;
        if (!this.state.isMultiSelectMode) this.state.multiSelectedChatIds.clear();
        this.updateViewChrome();
    }
    handleMultiSelectionChange(id) {
        if (this.state.multiSelectedChatIds.has(id)) { this.state.multiSelectedChatIds.delete(id); } else { this.state.multiSelectedChatIds.add(id); }
        this._renderChatList();
        this.updateMultiSelectControls();
    }
    updateMultiSelectControls() {
        const controls = this.shadowRoot.querySelector('#multi-select-controls');
        const deleteBtn = this.shadowRoot.querySelector('#delete-selected-btn');
        controls.style.display = this.state.isMultiSelectMode ? 'flex' : 'none';
        deleteBtn.disabled = this.state.multiSelectedChatIds.size === 0;
        deleteBtn.textContent = `Delete Selected (${this.state.multiSelectedChatIds.size})`;
    }
    async handleDeleteSelectedChats() {
        const idsToDelete = Array.from(this.state.multiSelectedChatIds);
        if (idsToDelete.length === 0) return;
        modal.confirm({
            title: `Delete ${idsToDelete.length} Chats`,
            content: `Are you sure you want to permanently delete these ${idsToDelete.length} chats? This action cannot be undone.`,
            confirmLabel: 'Delete All', confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                const results = await Promise.allSettled(idsToDelete.map(id => api.delete(`/api/chats/${id}`)));
                const successCount = results.filter(r => r.status === 'fulfilled').length;
                if (successCount > 0) notifier.show({ type: 'good', message: `Successfully deleted ${successCount} chats.` });
                if (results.length - successCount > 0) notifier.show({ type: 'bad', message: `Failed to delete ${results.length - successCount} chats.` });
                this.toggleMultiSelectMode();
            }
        });
    }

    _buildChatTree(chats) {
        const chatMap = new Map(chats.map(chat => [chat.id, { ...chat, children: [] }]));
        const treeRoots = [];
        for (const chat of chatMap.values()) {
            if (chat.parentId && chatMap.has(chat.parentId)) {
                 chatMap.get(chat.parentId).children.push(chat);
            } else {
                treeRoots.push(chat);
            }
        }

        const findLatestModDate = (node) => {
            let maxDate = new Date(node.lastModifiedAt);
            for (const child of node.children) {
                const childMaxDate = findLatestModDate(child);
                if (childMaxDate > maxDate) maxDate = childMaxDate;
            }
            node.effectiveLastModifiedAt = maxDate;
            return maxDate;
        };

        for (const root of treeRoots) {
            findLatestModDate(root);
            (function sortChildren(node) {
                if (node.children.length > 0) {
                    node.children.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
                    for(const child of node.children) sortChildren(child);
                }
            })(root);
        }
        
        treeRoots.sort((a, b) => b.effectiveLastModifiedAt - a.effectiveLastModifiedAt);
        return treeRoots;
    }

    _findLatestNodeInTree(root) {
        let latestNode = root;
        function traverse(node) {
            if (new Date(node.lastModifiedAt) > new Date(latestNode.lastModifiedAt)) {
                latestNode = node;
            }
            (node.children || []).forEach(traverse);
        }
        traverse(root);
        return latestNode;
    }

    _renderChatList() {
        const chatListEl = this.shadowRoot.querySelector('#chat-list');
        if (!chatListEl) return;
        const chatTree = this._buildChatTree(this.state.chats);
        
        const listHtml = chatTree.map(root => {
            const displayNode = this._findLatestNodeInTree(root);
            const isExpanded = this.state.expandedChatIds.has(root.id);
            const hasChildren = root.children && root.children.length > 0;
            const isSelected = this.state.selectedChat?.id === displayNode.id;
            const isMultiSelected = this.state.multiSelectedChatIds.has(root.id);
            
            const rowClasses = [ 'item-row', isSelected ? 'selected' : '', this.state.isMultiSelectMode ? 'multi-select-mode' : '' ].join(' ');
            const liClasses = [ 'chat-list-item', hasChildren ? 'has-children' : '', isExpanded ? 'is-expanded' : '' ].join(' ');
            
            const expanderHtml = hasChildren ? `<button class="expander icon-button" data-action="toggle-expand"><span class="material-icons">${isExpanded ? 'expand_more' : 'chevron_right'}</span></button>` : `<span class="expander-placeholder"></span>`;
            const checkboxHtml = this.state.isMultiSelectMode ? `<input type="checkbox" class="multiselect-checkbox" ${isMultiSelected ? 'checked' : ''}>` : '';
            const childrenHtml = hasChildren && isExpanded ? `<ul class="chat-tree-container">${this._renderTimelineNodes(root, root.id, 0)}</ul>` : '';

            return `
                <li data-id="${displayNode.id}" data-root-id="${root.id}" class="${liClasses}">
                    <div class="${rowClasses}">
                        ${expanderHtml}
                        ${checkboxHtml}
                        <img class="avatar" src="${displayNode.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${displayNode.name}'s avatar">
                        <div class="item-details">
                            <div class="item-name">${this._escapeHtml(displayNode.name)}</div>
                            <div class="item-snippet">${this._escapeHtml(displayNode.lastMessageSnippet || 'No messages yet.')}</div>
                        </div>
                        <div class="actions">
                            <button class="icon-button delete-btn" data-action="delete" title="Delete conversation tree"><span class="material-icons">delete_sweep</span></button>
                        </div>
                    </div>
                    ${childrenHtml}
                </li>`;
        }).join('');
        
        chatListEl.innerHTML = listHtml;
    }

    _renderTimelineNodes(node, rootId, level) {
        const isSelected = this.state.selectedChat?.id === node.id;
        const rowClasses = ['item-row', 'timeline-node', isSelected ? 'selected' : ''].join(' ');
        const nodeHtml = `
            <li data-id="${node.id}" data-root-id="${rootId}" class="timeline-item level-${level % 4}">
                <div class="${rowClasses}">
                    <div class="item-details">
                        <div class="item-name">${this._escapeHtml(node.name)}</div>
                        <div class="item-snippet">${this._escapeHtml(node.lastMessageSnippet || 'No messages yet.')}</div>
                    </div>
                </div>
            </li>
        `;
        const childrenHtml = node.children && node.children.length > 0 
            ? `<ul>${node.children.map(child => this._renderTimelineNodes(child, rootId, level + 1)).join('')}</ul>` 
            : '';

        return nodeHtml + childrenHtml;
    }
    
    _renderCharacterListItem(character, options = {}) {
        const { isParticipant, isRemovable } = options;
        const liClasses = isParticipant ? 'is-participant' : '';

        return `
            <li data-id="${character.id}" class="${liClasses}">
                <div class="item-row">
                    <img class="avatar" src="${character.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${character.name}'s avatar">
                    <div class="item-name">${character.name}</div>
                    <div class="actions">
                        ${isParticipant ? `<span class="material-icons participant-icon" title="Is a participant">check_circle</span>` : ''}
                        ${isRemovable ? `<button class="icon-button delete-btn" data-action="delete" title="Remove"><span class="material-icons">close</span></button>` : ''}
                    </div>
                </div>
            </li>
        `;
    }

    updateView() {
        this.updateViewChrome();
        this.updateMainPanel();
    }

    updateViewChrome() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        if (isMobile) {
            panelLeft.style.display = this.state.selectedChat ? 'none' : 'flex';
            panelMain.style.display = this.state.selectedChat ? 'flex' : 'none';
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
        }
        this.shadowRoot.querySelector('#back-to-chats-btn').style.display = isMobile && this.state.selectedChat ? 'flex' : 'none';
        
        this._renderChatList();
        this.updateMultiSelectControls();
        this.#updateRightPanel();
    }

    updateMainPanel() {
        const mainHeader = this.shadowRoot.querySelector('.chat-main-header');
        const placeholder = this.shadowRoot.querySelector('.placeholder');
        const modeContainer = this.shadowRoot.querySelector('#chat-mode-container');
        if (this.state.selectedChat) {
            mainHeader.style.display = 'flex';
            placeholder.style.display = 'none';
            modeContainer.style.display = 'flex';
            this.shadowRoot.querySelector('#chat-name-input').value = this.state.selectedChat.name;
            this.shadowRoot.querySelector('#chat-title-mobile').textContent = this.state.selectedChat.name;
            this.shadowRoot.querySelector('#go-to-parent-btn').style.display = this.state.selectedChat.parentId ? 'flex' : 'none';
            
            // This now only creates/recreates the mode if necessary
            this.#ensureChatModeIsCorrect(); 

            this.#activeChatMode?.updateInputState(this.state.isSending);
        } else {
            mainHeader.style.display = 'none';
            if (this.#activeChatMode) this.#activeChatMode.onDestroy();
            this.#activeChatMode = null;
            modeContainer.innerHTML = '';
            modeContainer.style.display = 'none';
            placeholder.style.display = 'flex';
            placeholder.querySelector('h3').textContent = 'Select or create a chat to begin.';
            this.shadowRoot.querySelector('#chat-title-mobile').textContent = this.state.isMultiSelectMode ? 'Select to Delete' : 'Chats';
        }
    }
    
    #ensureChatModeIsCorrect() {
        const modeContainer = this.shadowRoot.querySelector('#chat-mode-container');
        const renderer = this.state.chatRenderer;
        const modeTagName = chatModeRegistry.getTagName(renderer);

        if (!modeTagName) {
            modeContainer.innerHTML = `<div class="placeholder"><h3>Error: Unknown chat renderer "${renderer}".</h3></div>`;
            return;
        }

        // If the mode doesn't exist or the required tag name has changed (due to settings change)
        if (!this.#activeChatMode || this.#activeChatMode.tagName.toLowerCase() !== modeTagName) {
            if (this.#activeChatMode) this.#activeChatMode.onDestroy();
            modeContainer.innerHTML = ''; // Clear old mode
            this.#activeChatMode = document.createElement(modeTagName);
            
            this.#activeChatMode.initialize({
                chat: this.state.selectedChat, 
                allCharacters: this.state.allCharacters,
                userPersona: this.state.userPersona, 
                mainView: this, 
                rendererType: renderer,
                settings: this.state.chatModeSettings[renderer] || {},
            });
            modeContainer.appendChild(this.#activeChatMode);
        } else {
            // Mode exists, just update its core properties to ensure it's in sync
            this.#activeChatMode.chat = this.state.selectedChat;
            this.#activeChatMode.allCharacters = this.state.allCharacters;
            this.#activeChatMode.userPersona = this.state.userPersona;
            this.#activeChatMode.rendererType = renderer;
        }
    }

    #updateRightPanel() {
        if (this.state.selectedChat) {
            this.shadowRoot.querySelector('.right-panel-content').style.display = 'flex';
            const participantChars = this.state.selectedChat.participants
                .map(p => this.state.allCharacters.find(char => char.id === p.id)).filter(Boolean);
            this.shadowRoot.querySelector('#participant-list').innerHTML = participantChars.map(char => this._renderCharacterListItem(char, { isParticipant: true, isRemovable: true })).join('');
            
            this._renderActiveScenarioList();
        } else {
            this.shadowRoot.querySelector('.right-panel-content').style.display = 'none';
        }
    }
    
    _renderActiveScenarioList() {
        const listEl = this.shadowRoot.querySelector('#active-scenario-list');
        const activeScenarioIds = this.state.selectedChat?.scenarioIds || [];
        if (activeScenarioIds.length === 0) {
            listEl.innerHTML = `<li class="list-placeholder">No active scenarios.</li>`;
            return;
        }

        const activeScenarios = activeScenarioIds.map(id => this.state.allScenarios.find(s => s.id === id)).filter(Boolean);
        listEl.innerHTML = activeScenarios.map(scenario => `
            <li data-id="${scenario.id}">
                <div class="item-row">
                    <div class="item-name">${this._escapeHtml(scenario.name)}</div>
                    <div class="actions">
                        <button class="icon-button delete-btn" data-action="delete" title="Remove Scenario"><span class="material-icons">close</span></button>
                    </div>
                </div>
            </li>
        `).join('');
    }

    updateModalListView() {
        const list = this.shadowRoot.querySelector('#modal-character-list');
        const search = this.shadowRoot.querySelector('#modal-search-input').value.toLowerCase();
        const participantIds = new Set(this.state.selectedChat?.participants.map(p => p.id) || []);
        const filteredChars = this.state.allCharacters.filter(char => char.name.toLowerCase().includes(search));
        list.innerHTML = filteredChars.map(char => this._renderCharacterListItem(char, { isParticipant: participantIds.has(char.id) })).join('');
    }
    
    updateScenarioModalListView() {
        const list = this.shadowRoot.querySelector('#modal-scenario-list');
        const activeIds = new Set(this.state.selectedChat?.scenarioIds || []);
        const sortedScenarios = [...this.state.allScenarios].sort((a, b) => a.name.localeCompare(b.name));

        list.innerHTML = sortedScenarios.map(scenario => {
            const isActive = activeIds.has(scenario.id);
            return `
                <li data-id="${scenario.id}" class="${isActive ? 'is-participant' : ''}">
                    <div class="item-row">
                        <div class="item-name">${this._escapeHtml(scenario.name)}</div>
                        <div class="actions">
                            ${isActive ? `<span class="material-icons participant-icon" title="Is active">check_circle</span>` : ''}
                        </div>
                    </div>
                </li>
            `;
        }).join('');
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <div id="multi-select-controls">
                        <button id="delete-selected-btn" class="button-danger" disabled>Delete Selected</button>
                        <button id="cancel-multiselect-btn" class="button-secondary">Cancel</button>
                    </div>
                    <header id="chat-list-header">
                        <h3>Chats</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="multi-select" title="Select Multiple"><span class="material-icons">checklist</span></button>
                            <button class="icon-button" data-action="add" title="New Chat"><span class="material-icons">add</span></button>
                        </div>
                    </header>
                    <item-list id="chat-list"></item-list>
                </div>
                <div class="panel-main view-container">
                    <header class="mobile-chat-header">
                        <button id="back-to-chats-btn" class="icon-button" title="Back to Chats"><span class="material-icons">arrow_back</span></button>
                        <h2 id="chat-title-mobile">Select a Chat</h2>
                        <div>
                            <button id="scenarios-btn" class="icon-button" title="View Scenarios"><span class="material-icons">menu_book</span></button>
                            <button id="participants-btn" class="icon-button" title="View Participants"><span class="material-icons">people</span></button>
                        </div>
                    </header>
                    <header class="chat-main-header">
                        <input type="text" id="chat-name-input" placeholder="Chat Name">
                        <button id="go-to-parent-btn" class="icon-button" title="Go to Parent Chat"><span class="material-icons">arrow_upward</span></button>
                    </header>
                    <div id="chat-mode-container"></div>
                    <div class="placeholder"><h3>Select or create a chat to begin.</h3></div>
                </div>
                <div class="panel-right">
                    <div class="right-panel-content">
                        <div class="participants-section">
                            <header id="participant-list-header">
                                <h3>Participants</h3>
                                <div class="header-actions">
                                    <button class="icon-button" data-action="add-participant" title="Add Participant"><span class="material-icons">person_add</span></button>
                                </div>
                            </header>
                            <item-list id="participant-list"></item-list>
                        </div>
                        <div class="scenarios-section">
                            <header id="scenario-list-header">
                                <h3>Active Scenarios</h3>
                                <div class="header-actions">
                                    <button class="icon-button" data-action="add-scenario" title="Add Scenario"><span class="material-icons">add</span></button>
                                </div>
                            </header>
                            <item-list id="active-scenario-list"></item-list>
                        </div>
                    </div>
                </div>
            </div>
            <div id="add-character-modal" class="modal-backdrop">
                <div class="modal-content">
                    <header><h2>Add Character to Chat</h2><button id="close-char-modal-btn" class="close-modal-btn" title="Close"><span class="material-icons">close</span></button></header>
                    <div class="modal-body">
                        <div class="modal-search-bar"><span class="material-icons">search</span><input type="text" id="modal-search-input" placeholder="Search for characters..."></div>
                        <item-list id="modal-character-list"></item-list>
                    </div>
                </div>
            </div>
             <div id="add-scenario-modal" class="modal-backdrop">
                <div class="modal-content">
                    <header><h2>Add Scenario to Chat</h2><button id="close-scenario-modal-btn" class="close-modal-btn" title="Close"><span class="material-icons">close</span></button></header>
                    <div class="modal-body">
                        <item-list id="modal-scenario-list"></item-list>
                    </div>
                </div>
            </div>
            <div class="view-overlay"></div>
            `, this.styles()
        );
    }
    
    styles() { return `
            .panel-left, .panel-right { flex-direction: column; }
            .panel-right { background-color: transparent; } /* Right panel is a container */
            .right-panel-content { display: none; flex-direction: column; height: 100%; }
            .participants-section { flex: 2; display: flex; flex-direction: column; min-height: 150px; background-color: var(--bg-1); border-bottom: 1px solid var(--bg-3); }
            .scenarios-section { flex: 1; display: flex; flex-direction: column; min-height: 100px; background-color: var(--bg-1); }
            .panel-left header, #participant-list-header, #scenario-list-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0; gap: var(--spacing-sm);
            }
            .panel-left header h3, #participant-list-header h3, #scenario-list-header h3 { margin: 0; }
            .header-actions { display: flex; align-items: center; gap: var(--spacing-xs); }
            .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; transition: var(--transition-fast); display: flex; align-items: center; justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            #multi-select-controls { padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--bg-3); display: none; gap: var(--spacing-sm); background-color: var(--bg-2); flex-shrink: 0; }
            #multi-select-controls button { flex-grow: 1; padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-size-sm); }
            .panel-main { padding: 0; position: relative; }
            .chat-main-header { display: none; padding: var(--spacing-sm) var(--spacing-lg); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; align-items: center; gap: var(--spacing-md); }
            #chat-name-input { flex-grow: 1; font-size: 1.2rem; font-weight: 600; background: none; border: none; outline: none; color: var(--text-primary); padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            #chat-name-input:focus { background-color: var(--bg-1); }
            #chat-mode-container { display: none; flex-grow: 1; flex-direction: column; overflow: hidden; }
            .placeholder { flex-grow: 1; display: flex; align-items: center; justify-content: center; color: var(--text-disabled); text-align: center; }
            .modal-backdrop { position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 1000; }
            .modal-content { background-color: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius-md); width: 90%; max-width: 500px; height: 80vh; display: flex; flex-direction: column; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
            .modal-content header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md) var(--spacing-lg); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; }
            .modal-content header h2 { margin: 0; font-size: 1.1rem; }
            .close-modal-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            .close-modal-btn:hover { color: var(--text-primary); }
            .modal-body { display: flex; flex-direction: column; overflow-y: hidden; padding: var(--spacing-md); flex-grow: 1; gap: var(--spacing-md); }
            .modal-search-bar { display: flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); border: 1px solid var(--bg-3); background-color: var(--bg-0); border-radius: var(--radius-sm); flex-shrink: 0; }
            #modal-search-input { background: none; border: none; outline: none; width: 100%; color: var(--text-primary); }
            #go-to-parent-btn { display: none; }
            .mobile-chat-header, #back-to-chats-btn, .view-overlay { display: none; }
            .list-placeholder { color: var(--text-disabled); font-style: italic; padding: var(--spacing-sm) var(--spacing-md); font-size: var(--font-size-sm); }

            /* Item List Styles for this View */
            
            /* Common styles for all list item rows */
            item-list li .item-row { display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md); cursor: pointer; transition: var(--transition-fast); gap: var(--spacing-sm); }
            #participant-list li .item-row:hover, #active-scenario-list li .item-row:hover,
            #modal-character-list li:not(.is-participant) .item-row:hover,
            #modal-scenario-list li:not(.is-participant) .item-row:hover { background-color: var(--bg-2); }
            item-list .avatar { width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; background-color: var(--bg-3); }
            item-list .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; }
            item-list .actions { display: flex; flex-shrink: 0; gap: var(--spacing-xs); }
            
            /* Specifics for Participant & Modal Lists */
            #modal-character-list li.is-participant > .item-row, #modal-scenario-list li.is-participant > .item-row { background-color: var(--accent-primary-faded); border-left: 3px solid var(--accent-primary); padding-left: calc(var(--spacing-md) - 3px); }
            #modal-character-list li.is-participant > .item-row:hover, #modal-scenario-list li.is-participant > .item-row:hover { background-color: rgba(138, 180, 248, 0.4); }
            .participant-icon { color: var(--accent-good); margin: 0 var(--spacing-xs); }
            #participant-list li .item-row, #modal-character-list li .item-row, #active-scenario-list li .item-row, #modal-scenario-list li .item-row { border-bottom: 1px solid var(--bg-3); }
            #participant-list li:last-child .item-row, #modal-character-list li:last-child .item-row, #active-scenario-list li:last-child .item-row, #modal-scenario-list li:last-child .item-row { border-bottom: none; }

            /* Specifics for Chat List (Tree View) */
            #chat-list li.chat-list-item { display: block; }
            #chat-list li.chat-list-item > .item-row { border-bottom: none; }
            #chat-list .item-details { display: flex; flex-direction: column; flex-grow: 1; overflow: hidden; }
            #chat-list .item-snippet { font-size: var(--font-size-sm); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #chat-list .expander, #chat-list .expander-placeholder { width: 24px; height: 24px; flex-shrink: 0; }
            #chat-list .multiselect-checkbox { margin-right: 8px; }
            #chat-list li.chat-list-item.is-expanded > .item-row { border-bottom-color: transparent; }
            #chat-list li.chat-list-item > .item-row.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            #chat-list li.chat-list-item > .item-row.selected .item-name, #chat-list li.chat-list-item > .item-row.selected .item-snippet, #chat-list li.chat-list-item > .item-row.selected .icon-button { color: var(--bg-0); }
            
            .chat-tree-container { list-style: none; padding: 0; margin: 0; background-color: var(--bg-0); border-top: 1px solid var(--bg-3); }
            .chat-tree-container ul { list-style: none; padding-left: 20px; }
            .timeline-item > .item-row { --level-0-color: var(--accent-primary); --level-1-color: var(--accent-good); --level-2-color: var(--accent-warn); --level-3-color: var(--accent-danger); position: relative; padding-left: 24px; border-left: 2px solid var(--bg-3); }
            .timeline-item > .item-row::before { content: ''; position: absolute; left: -7px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; border-radius: 50%; background-color: var(--bg-0); border: 2px solid var(--bg-3); z-index: 1; }
            .timeline-item > .item-row::after { content: ''; position: absolute; left: 0; top: 50%; width: 24px; height: 2px; background-color: var(--bg-3); }
            .timeline-item.level-0 > .item-row::before { border-color: var(--level-0-color); }
            .timeline-item.level-1 > .item-row::before { border-color: var(--level-1-color); }
            .timeline-item.level-2 > .item-row::before { border-color: var(--level-2-color); }
            .timeline-item.level-3 > .item-row::before { border-color: var(--level-3-color); }
            .timeline-item > .item-row.selected { background-color: var(--bg-2) !important; }
            .timeline-item > .item-row.selected .item-name { color: var(--accent-primary) !important; }
            .timeline-item > .item-row .avatar { display: none; }
            .timeline-item > .item-row .item-details { margin-left: var(--spacing-sm); }
            
            @media (max-width: 768px) {
                .panel-main { padding: 0; height: 100%; }
                .chat-main-header { display: none !important; }
                .mobile-chat-header { display: flex; padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; align-items: center; gap: var(--spacing-xs); }
                .mobile-chat-header h2 { flex-grow: 1; }
                #back-to-chats-btn { display: flex; }
                #chat-title-mobile { font-size: 1.1rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
                #participants-btn, #scenarios-btn { display: flex; }
                .panel-right { position: fixed; top: 0; right: 0; width: 85%; max-width: 320px; height: 100%; z-index: 1001; transform: translateX(100%); transition: transform 0.3s ease-in-out; box-shadow: -2px 0 8px rgba(0,0,0,0.3); border-left: 1px solid var(--bg-3); }
                .panel-right.visible { transform: translateX(0); }
                .view-overlay.visible { display: block; position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); z-index: 1000; }
            }
        `; }
}
customElements.define('main-chat-view', MainChatView);