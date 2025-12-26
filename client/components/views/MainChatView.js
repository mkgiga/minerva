import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier, uuidv4 } from '../../client.js';
import { chatModeRegistry } from '../../ChatModeRegistry.js';
import '../ItemList.js';
import '../CharacterEditor.js';
import '../NoteEditor.js';

class MainChatView extends BaseComponent {
    #activeChatMode = null;
    #abortController = null;

    constructor() {
        super();
        this.state = {
            chats: [],
            allCharacters: [],
            allNotes: [],
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
        this.openNoteModal = this.openNoteModal.bind(this);
        this.closeNoteModal = this.closeNoteModal.bind(this);
        this.handleModalNoteAction = this.handleModalNoteAction.bind(this);
        this.handleActiveNoteAction = this.handleActiveNoteAction.bind(this);
        this.handleExportChat = this.handleExportChat.bind(this); // Bind new export handler
        this.handleImportChatFile = this.handleImportChatFile.bind(this); // NEW: Bind import handler
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
                case 'import': this.handleImportChatFile(); break; // NEW: Import button listener
            }
        });
        
        // Right Panel (Participants & Notes)
        this.shadowRoot.querySelector('#participant-list').addEventListener('item-action', this.handleParticipantAction);
        this.shadowRoot.querySelector('#participant-list-header').addEventListener('click', this.handleHeaderAction);
        this.shadowRoot.querySelector('#active-note-list').addEventListener('item-action', this.handleActiveNoteAction);
        this.shadowRoot.querySelector('#note-list-header').addEventListener('click', e => {
            if (e.target.closest('[data-action="add-note"]')) this.openNoteModal();
        });
        
        // Modals
        const charModalEl = this.shadowRoot.querySelector('#add-character-modal');
        charModalEl.addEventListener('click', (e) => { if (e.target === charModalEl) this.closeCharacterModal(); });
        this.shadowRoot.querySelector('#close-char-modal-btn').addEventListener('click', this.closeCharacterModal);
        this.shadowRoot.querySelector('#modal-character-list').addEventListener('item-action', this.handleModalCharacterAction);
        this.shadowRoot.querySelector('#modal-search-input').addEventListener('input', this.handleModalSearch);
        
        const noteModalEl = this.shadowRoot.querySelector('#add-note-modal');
        noteModalEl.addEventListener('click', (e) => { if (e.target === noteModalEl) this.closeNoteModal(); });
        this.shadowRoot.querySelector('#close-note-modal-btn').addEventListener('click', this.closeNoteModal);
        this.shadowRoot.querySelector('#modal-note-list').addEventListener('item-action', this.handleModalNoteAction);
        this.shadowRoot.querySelector('#create-embedded-note-btn').addEventListener('click', () => {
            this.closeNoteModal();
            this.handleCreateEmbedded('note');
        });

        this.shadowRoot.querySelector('#sidebar-btn').addEventListener('click', this.handleParticipantsToggle);
        this.shadowRoot.querySelector('#back-to-chats-btn').addEventListener('click', this.handleBackToChats);
        this.shadowRoot.querySelector('.view-overlay').addEventListener('click', () => this.toggleParticipantsPanel(false));
        
        this.shadowRoot.querySelector('#chat-name-input').addEventListener('change', this.handleChatNameSave);
        this.shadowRoot.querySelector('#chat-title-mobile').addEventListener('click', this.handleChatNameEdit);

        this.shadowRoot.querySelector('#delete-selected-btn').addEventListener('click', this.handleDeleteSelectedChats);
        this.shadowRoot.querySelector('#cancel-multiselect-btn').addEventListener('click', this.toggleMultiSelectMode);

        this.shadowRoot.querySelector('#go-to-parent-btn').addEventListener('click', this.handleGoToParentChat);
        this.shadowRoot.querySelector('#export-chat-btn').addEventListener('click', this.handleExportChat); // Export button listener

        const modeContainer = this.shadowRoot.querySelector('#chat-mode-container');
        modeContainer.addEventListener('chat-mode-send-prompt', e => this.#handleSendMessage(e.detail.promptText));
        modeContainer.addEventListener('chat-mode-send-custom-prompt', e => this.#handleSendCustomMessage(e.detail));
        modeContainer.addEventListener('chat-mode-regenerate-message', e => this.#handleRegenerateMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-regenerate-with-history', e => this.#handleRegenerateWithHistory(e.detail));
        modeContainer.addEventListener('chat-mode-branch-message', e => this.#handleBranchMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-edit-message', e => this.#saveEditedMessage(e.detail.messageId, e.detail.newContent));
        modeContainer.addEventListener('chat-mode-delete-message', e => this.#handleDeleteMessage(e.detail.messageId));
        modeContainer.addEventListener('chat-mode-copy-message', e => this.#copyMessageContent(e.detail.content));
        modeContainer.addEventListener('chat-mode-go-to-parent', this.handleGoToParentChat);
        modeContainer.addEventListener('chat-mode-abort-generation', () => this.#abortController?.abort());
        modeContainer.addEventListener('chat-mode-load-more', () => this.#handleLoadMoreMessages());
        modeContainer.addEventListener('chat-mode-set-user-persona', e => this.#handleSetUserPersona(e.detail.characterId));
    }

    async fetchInitialData() {
        try {
            const [chats, characters, settings, notes] = await Promise.all([
                api.get('/api/chats'),
                api.get('/api/characters'),
                api.get('/api/settings'),
                api.get('/api/notes'),
            ]);
            this.state.chats = chats;
            this.state.allCharacters = characters;
            this.state.allNotes = notes;
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
        
        let characterListChanged = false;
        let userPersonaChanged = false;
        let rendererChanged = false;
        
        switch (resourceType) {
            case 'chat':
                if (this.handleChatListChange(eventType, data)) {
                    this.#renderChatList();
                    this.updateMultiSelectControls();
                }
                break;
        
            case 'chat_details':
                if (eventType === 'update' && this.state.selectedChat?.id === data.id) {
                    this.state.selectedChat = data;
                    if (this.#activeChatMode) this.#activeChatMode.chat = data;
        
                    const oldParticipants = (oldSelectedChat.participants || []).map(p => typeof p === 'string' ? p : p.id).sort();
                    const newParticipants = (data.participants || []).map(p => typeof p === 'string' ? p : p.id).sort();
                    const oldNotes = (oldSelectedChat.notes || []).map(s => typeof s === 'string' ? s : s.id).sort();
                    const newNotes = (data.notes || []).map(s => typeof s === 'string' ? s : s.id).sort();
        
                    if (JSON.stringify(oldParticipants) !== JSON.stringify(newParticipants) || JSON.stringify(oldNotes) !== JSON.stringify(newNotes)) {
                        this.#updateRightPanel();
                    }
        
                    this.#diffChatAndUpdateMode(oldSelectedChat, data);
                }
                break;
        
            case 'character':
                if (this.handleCharacterListChange(eventType, data)) {
                    characterListChanged = true;
                    this.#updateRightPanel();
                }
                break;
                
            case 'note':
                if (this.handleNoteListChange(eventType, data)) {
                    this.#updateRightPanel();
                }
                break;
        
            case 'setting':
                const oldPersonaId = this.state.userPersona?.id;
                const oldRenderer = this.state.chatRenderer;
                this.handleSettingChange(data);
                if (this.state.userPersona?.id !== oldPersonaId) userPersonaChanged = true;
                if (this.state.chatRenderer !== oldRenderer) rendererChanged = true;
                break;
        }
        
        if (this.#activeChatMode) {
            if (rendererChanged) {
                this.updateMainPanel();
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
        const oldParticipants = (oldChat.participants || []).map(p => typeof p === 'string' ? p : p.id).sort();
        const newParticipants = (newChat.participants || []).map(p => typeof p === 'string' ? p : p.id).sort();
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
        // Skip inherited messages to prevent treating them as "newly added"
        for (const newMsg of newMessages) {
            if (!oldMsgMap.has(newMsg.id) && !newMsg._isInherited) {
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
    
    handleNoteListChange(eventType, data) {
        let changed = false;
        switch (eventType) {
            case 'create': this.state.allNotes.push(data); changed = true; break;
            case 'update': {
                const index = this.state.allNotes.findIndex(s => s.id === data.id);
                if (index > -1) this.state.allNotes[index] = data;
                changed = true;
                break;
            }
            case 'delete': {
                const originalLength = this.state.allNotes.length;
                this.state.allNotes = this.state.allNotes.filter(s => s.id !== data.id);
                changed = this.state.allNotes.length < originalLength;
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
        
        // Pass complete settings to current chat mode if it exists
        if (this.#activeChatMode) {
            // First, notify about global settings (like curation)
            this.#activeChatMode.onGlobalSettingsChanged(settings);

            // Then handle mode-specific settings
            const oldModeSettings = this.state.chatModeSettings;
            this.state.chatModeSettings = settings.chatModes || {};
        
            if (JSON.stringify(oldModeSettings) !== JSON.stringify(this.state.chatModeSettings)) {
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
                this.#renderChatList();
                break;
        }
    }
    
    async handleChatSelect(chat) {
        // Prevent re-selecting the same chat and causing a full refresh
        if (this.state.selectedChat?.id === chat.id) return;
        try {
            const fullChat = await api.get(`/api/chats/${chat.id}`);
            // Assign temporary IDs to any embedded resources that don't have one.
            (fullChat.participants || []).forEach(p => { if(typeof p === 'object' && !p.id) p.id = `temp-${uuidv4()}`});
            (fullChat.notes || []).forEach(s => { if(typeof s === 'object' && !s.id) s.id = `temp-${uuidv4()}`});
            this.state.selectedChat = fullChat;
            
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
        const { id, action, listItem } = event.detail;
        
        switch (action) {
            case 'delete': this.handleParticipantDelete(id); break;
            case 'edit': this.handleResourceEdit('character', id); break;
            case 'promote': this.handlePromoteToLibrary('character', id); break;
            case 'embed': this.handleEmbedResource('character', id); break;
        }
    }

    async handleParticipantDelete(charIdToRemove) {
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;
        
        const originalParticipants = [...selectedChat.participants];
        selectedChat.participants = selectedChat.participants.filter(p => (typeof p === 'string' ? p : p.id) !== charIdToRemove);
        this.#updateRightPanel(); // Re-render the side panel list immediately
    
        try {
            await api.put(`/api/chats/${selectedChat.id}`, { participants: selectedChat.participants });
            notifier.show({ header: 'Participant Removed' });
        } catch (error) {
            notifier.show({ header: 'Error', type: 'bad', message: 'Failed to remove participant. Reverting.' });
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
    
        const isParticipant = selectedChat.participants.some(p => (typeof p === 'string' ? p : p.id) === charIdToToggle);
        const originalParticipants = [...selectedChat.participants];
        let notificationMessage;
    
        // OPTIMISTIC UI UPDATE
        if (isParticipant) {
            selectedChat.participants = selectedChat.participants.filter(p => (typeof p === 'string' ? p : p.id) !== charIdToToggle);
            notificationMessage = { header: 'Participant Removed', message: `${character.name} has left the chat.` };
        } else {
            selectedChat.participants.push(charIdToToggle); // Add by ID
            notificationMessage = { type: 'good', header: 'Participant Added', message: `${character.name} has joined the chat.` };
        }
    
        // Immediately update the UI based on the new local state
        this.updateModalListView();
        this.#updateRightPanel();
        notifier.show(notificationMessage);
    
        // API CALL IN BACKGROUND
        try {
            await api.put(`/api/chats/${selectedChat.id}`, { participants: selectedChat.participants });
        } catch (error) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Failed to update participants. Reverting change.' });
            this.state.selectedChat.participants = originalParticipants;
            this.updateModalListView();
            this.#updateRightPanel();
        }
    }
    
    handleModalNoteAction(event) {
        const { id, action } = event.detail;
        if (action === 'select') this.handleModalNoteToggle(id);
    }
    
    handleActiveNoteAction(event) {
        const { id, action } = event.detail;
        switch (action) {
            case 'delete': this.handleModalNoteToggle(id, true); break; // true to force removal
            case 'edit': this.handleResourceEdit('note', id); break;
            case 'promote': this.handlePromoteToLibrary('note', id); break;
            case 'embed': this.handleEmbedResource('note', id); break;
        }
    }
    
    async handleEmbedResource(resourceType, resourceId) {
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;

        try {
            let resourceData, resourceArray;
            
            if (resourceType === 'character') {
                const character = this.state.allCharacters.find(c => c.id === resourceId);
                if (!character) {
                    notifier.show({ header: 'Error', message: 'Character not found in library.', type: 'bad' });
                    return;
                }
                resourceData = character;
                resourceArray = selectedChat.participants;
            } else if (resourceType === 'note') {
                const note = this.state.allNotes.find(n => n.id === resourceId);
                if (!note) {
                    notifier.show({ header: 'Error', message: 'Note not found in library.', type: 'bad' });
                    return;
                }
                resourceData = note;
                resourceArray = selectedChat.notes;
            } else {
                return;
            }

            // Find the index of the resource ID in the array and replace it with the full object
            const resourceIndex = resourceArray.findIndex(r => r === resourceId);
            if (resourceIndex === -1) {
                notifier.show({ header: 'Error', message: `${resourceType} not found in chat.`, type: 'bad' });
                return;
            }

            // Replace ID with full object (embedded version)
            resourceArray[resourceIndex] = { ...resourceData };

            // Save the updated chat
            await api.put(`/api/chats/${selectedChat.id}`, selectedChat);
            
            // Update the view
            this.#updateRightPanel();
            
            notifier.show({ 
                header: 'Success', 
                message: `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} embedded in chat.`,
                type: 'good' 
            });

        } catch (error) {
            console.error(`Failed to embed ${resourceType}:`, error);
            notifier.show({ 
                header: 'Error', 
                message: `Failed to embed ${resourceType}: ${error.message}`,
                type: 'bad' 
            });
        }
    }

    async handleModalNoteToggle(noteId, forceRemove = false) {
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;
        
        const note = this.state.allNotes.find(s => s.id === noteId);
        if (!note) return;

        const originalNotes = [...(selectedChat.notes || [])];
        let newNotes;
        let notificationMessage;

        const isActive = originalNotes.some(s => (typeof s === 'string' ? s : s.id) === noteId);

        if (isActive || forceRemove) {
            newNotes = originalNotes.filter(s => (typeof s === 'string' ? s : s.id) !== noteId);
            notificationMessage = { message: `Note "${note.name}" removed from chat.` };
        } else {
            newNotes = [...originalNotes, noteId]; // Add by ID
            notificationMessage = { type: 'good', message: `Note "${note.name}" added to chat.` };
        }
        
        // Optimistic update
        selectedChat.notes = newNotes;
        this.updateNoteModalListView();
        this.#updateRightPanel();
        notifier.show(notificationMessage);

        try {
            await api.put(`/api/chats/${this.state.selectedChat.id}`, { notes: newNotes });
        } catch(e) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Failed to update notes. Reverting.' });
            selectedChat.notes = originalNotes;
            this.updateNoteModalListView();
            this.#updateRightPanel();
        }
    }

    handleModalSearch() {
        this.updateModalListView();
    }
    
    /**
     * Finds a message by its ID from the currently selected chat.
     * @param {string} messageId The ID of the message to find.
     * @returns {object|undefined} The message object or undefined if not found.
     */
    getMessageById(messageId) {
        return this.state.selectedChat?.messages.find(m => m.id === messageId);
    }

    async #handleSendCustomMessage({ userMessage, messages }) {
        if (this.state.isSending || !this.state.selectedChat || !this.#activeChatMode) return;

        this.state.isSending = true;
        this.#activeChatMode.updateInputState(true);

        const assistantMessageId = this.#activeChatMode.onPromptStart(userMessage);

        this.#abortController = new AbortController();
        const fetchPromise = fetch(`/api/chats/${this.state.selectedChat.id}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userMessage.content,
                history: messages
            }),
            signal: this.#abortController.signal,
        });

        await this.#handleStreamedResponse(fetchPromise, assistantMessageId, 'Prompt Error');
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

    handleChatNameEdit() {
        const titleEl = this.shadowRoot.querySelector('#chat-title-mobile');
        if (!titleEl || !this.state.selectedChat) return;

        // Make it editable
        titleEl.contentEditable = 'true';
        titleEl.focus();

        // Select all text
        const range = document.createRange();
        range.selectNodeContents(titleEl);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // Save on blur or Enter key
        const saveAndReset = () => {
            titleEl.contentEditable = 'false';
            const newName = titleEl.textContent.trim();
            if (newName && newName !== this.state.selectedChat.name) {
                this.handleChatNameSave({ target: { value: newName }});
            } else {
                // Revert to original name if empty or unchanged
                titleEl.textContent = this.state.selectedChat.name;
            }
        };

        const onBlur = () => {
            saveAndReset();
            titleEl.removeEventListener('blur', onBlur);
            titleEl.removeEventListener('keydown', onKeydown);
        };

        const onKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                titleEl.blur();
            } else if (e.key === 'Escape') {
                titleEl.textContent = this.state.selectedChat.name;
                titleEl.blur();
            }
        };

        titleEl.addEventListener('blur', onBlur, { once: true });
        titleEl.addEventListener('keydown', onKeydown);
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
            // Check if editing an inherited message - if so, create an override
            if (messageToUpdate._isInherited) {
                // Initialize messageOverrides if it doesn't exist
                if (!updatedChatState.messageOverrides) {
                    updatedChatState.messageOverrides = {};
                }

                // Create override entry for this inherited message
                updatedChatState.messageOverrides[messageId] = { content: newContent };

                // Also update the in-memory message for immediate UI feedback
                messageToUpdate.content = newContent;
                messageToUpdate._isOverridden = true;
            } else {
                // Normal message editing (not inherited) - update content directly
                messageToUpdate.content = newContent;
            }

            // CRITICAL: Strip inherited messages before saving to prevent duplication
            // Only send messages that truly belong to this chat
            updatedChatState.messages = updatedChatState.messages.filter(msg => !msg._isInherited);

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
            // The POST returns the new chat's summary. We only need its ID.
            const newChatSummary = await api.post(`/api/chats/${this.state.selectedChat.id}/branch`, { messageId });
            
            // Now, fetch the full chat details for the new branch, which will include inherited messages.
            const fullNewChat = await api.get(`/api/chats/${newChatSummary.id}`);
            
            this.state.selectedChat = fullNewChat;
            this.updateView();
            this.#activeChatMode?.onChatSwitched();
            notifier.show({ type: 'good', header: 'Chat Branched', message: 'A new chat has been created from this point and is now active.' });
        } catch (error) {
            console.error('Failed to branch chat:', error);
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not create a branch.' });
        }
    }

    async #handleRegenerateMessage(messageId) {
        if (this.state.isSending || !this.state.selectedChat || !this.#activeChatMode) return;
        
        await this.#handleRegenerateWithHistory({ messageId, history: null });
    }
    
    async #handleRegenerateWithHistory({ messageId, history }) {
        if (this.state.isSending || !this.state.selectedChat || !this.#activeChatMode) return;

        const messageToRegen = this.getMessageById(messageId);
        if (!messageToRegen) return;

        this.state.isSending = true;
        this.#activeChatMode.updateInputState(true);

        // onRegenerateStart now returns the ID of the optimistic spinner element
        const spinnerMessageId = this.#activeChatMode.onRegenerateStart(messageId);
        if (!spinnerMessageId) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Failed to show regeneration spinner.' });
            this.state.isSending = false;
            this.#activeChatMode.updateInputState(false);
            return;
        }

        this.#abortController = new AbortController();
        const { signal } = this.#abortController;

        let endpoint, body;

        if (messageToRegen.role === 'assistant') {
            endpoint = `/api/chats/${this.state.selectedChat.id}/regenerate`;
            body = { messageId, history }; // history can be null
        } else if (messageToRegen.role === 'user') {
            endpoint = `/api/chats/${this.state.selectedChat.id}/resend`;
            body = { history }; // history can be null
        } else {
            this.state.isSending = false;
            this.#activeChatMode.updateInputState(false);
            return;
        }

        const fetchPromise = fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal
        });

        // Use the spinner message ID for streaming instead of the original message ID
        await this.#handleStreamedResponse(fetchPromise, spinnerMessageId, 'Regeneration Error');
    }

    async #copyMessageContent(content) {
        try {
            await navigator.clipboard.writeText(content);
            notifier.show({ message: 'Copied to clipboard.' });
        } catch (err) {
            notifier.show({ header: 'Copy Failed', message: 'Could not copy text to clipboard.', type: 'warn' });
        }
    }

    async #handleSetUserPersona(characterId) {
        try {
            await api.post('/api/settings/persona', { characterId });
            const character = this.state.allCharacters.find(c => c.id === characterId);
            const message = characterId
                ? `"${character?.name || 'Character'}" is now the user persona.`
                : 'User persona has been cleared.';
            notifier.show({ type: 'good', header: 'Persona Updated', message });
        } catch (error) {
            console.error('Failed to set user persona:', error);
            notifier.show({ type: 'bad', header: 'Error', message: 'Failed to update user persona.' });
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

            const processChunk = (chunk) => {
                // A chunk can be a multi-line string like "event: token\ndata: {...}"
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const dataString = line.substring(5).trim();
                        if (!dataString) continue;
                        try {
                            const payload = JSON.parse(dataString);
                            if (payload.token) {
                                this.#activeChatMode?.onToken(payload.token, messageId);
                            }
                        } catch (e) { console.error("Error parsing SSE data chunk:", e, line); }
                    }
                }
            };
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const eventMessages = buffer.split('\n\n');
                buffer = eventMessages.pop() || ''; 
                for (const msg of eventMessages) {
                    if (msg) processChunk(msg);
                }
            }
            
            if (buffer) {
                processChunk(buffer);
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

    async #handleLoadMoreMessages() {
        if (!this.state.selectedChat || !this.state.selectedChat.hasMoreMessages) {
            console.log('[MainChatView] Load more messages blocked:', {
                hasChat: !!this.state.selectedChat,
                hasMoreMessages: this.state.selectedChat?.hasMoreMessages
            });
            return;
        }

        const oldestMessageId = this.state.selectedChat.messages[0]?.id;
        if (!oldestMessageId) return;

        console.log('[MainChatView] Loading more messages before:', oldestMessageId);

        this.#activeChatMode?.onHistoryLoading(true);

        try {
            const response = await api.get(`/api/chats/${this.state.selectedChat.id}/messages?limit=50&before=${oldestMessageId}`);

            console.log('[MainChatView] Received response:', {
                messagesReceived: response.messages.length,
                hasMoreMessages: response.hasMoreMessages,
                oldTotalMessages: this.state.selectedChat.messages.length
            });

            this.state.selectedChat.messages.unshift(...response.messages);
            this.state.selectedChat.hasMoreMessages = response.hasMoreMessages;

            console.log('[MainChatView] After update:', {
                newTotalMessages: this.state.selectedChat.messages.length,
                hasMoreMessages: this.state.selectedChat.hasMoreMessages
            });

            this.#activeChatMode.chat = this.state.selectedChat; // Important: update the mode's chat object reference

            this.#activeChatMode?.onHistoryLoaded(response.messages, response.hasMoreMessages);

        } catch (error) {
            console.error('[MainChatView] Error loading messages:', error);
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not load older messages.' });
        } finally {
            this.#activeChatMode?.onHistoryLoading(false);
        }
    }

    // --- NEW: Handle Export Chat ---
    async handleExportChat() {
        if (!this.state.selectedChat) {
            notifier.show({ header: 'Export Error', message: 'No chat selected to export.', type: 'warn' });
            return;
        }

        try {
            // Initiate download by opening the API endpoint directly in a new window/tab.
            // The browser will handle the Content-Disposition header and download the file.
            window.open(`/api/chats/${this.state.selectedChat.id}/export`, '_blank');
            notifier.show({ header: 'Export Initiated', message: `Exporting "${this.state.selectedChat.name}" and its branches.`, type: 'info' });
        } catch (error) {
            console.error('Failed to initiate chat export:', error);
            notifier.show({ header: 'Export Failed', message: `Could not export chat: ${error.message}`, type: 'bad' });
        }
    }

    // --- NEW: Handle Import Chat File ---
    handleImportChatFile() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.minerva-chat';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            notifier.show({ header: 'Importing Chat', message: `Processing "${file.name}"...`, type: 'info' });

            try {
                const fileContent = await file.text();
                const packedChatData = JSON.parse(fileContent);

                if (packedChatData.minervaFormat !== 'PackedChat' || !packedChatData.chats) {
                    throw new Error('Invalid Minerva Packed Chat file format.');
                }

                await api.post('/api/chats/import', packedChatData);
                notifier.show({ type: 'good', header: 'Import Complete', message: `Successfully imported chat tree from "${file.name}".` });

            } catch (error) {
                console.error('Error importing chat file:', error);
                notifier.show({
                    type: 'bad',
                    header: 'Import Failed',
                    message: `Could not import chat from "${file.name}". ${error.message || ''}`
                });
            }
        });

        fileInput.click();
    }

    handleParticipantsToggle() { this.toggleParticipantsPanel(true); }
    toggleParticipantsPanel(show) {
        this.shadowRoot.querySelector('.panel-right').classList.toggle('visible', show);
        this.shadowRoot.querySelector('.view-overlay').classList.toggle('visible', show);
    }
    openCharacterModal() { this.updateModalListView(); this.shadowRoot.querySelector('#add-character-modal').style.display = 'flex'; }
    closeCharacterModal() { this.shadowRoot.querySelector('#add-character-modal').style.display = 'none'; }
    openNoteModal() { this.updateNoteModalListView(); this.shadowRoot.querySelector('#add-note-modal').style.display = 'flex'; }
    closeNoteModal() { this.shadowRoot.querySelector('#add-note-modal').style.display = 'none'; }
    
    toggleMultiSelectMode() {
        this.state.isMultiSelectMode = !this.state.isMultiSelectMode;
        if (!this.state.isMultiSelectMode) this.state.multiSelectedChatIds.clear();
        this.updateViewChrome();
    }
    handleMultiSelectionChange(id) {
        if (this.state.multiSelectedChatIds.has(id)) { this.state.multiSelectedChatIds.delete(id); } else { this.state.multiSelectedChatIds.add(id); }
        this.#renderChatList();
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

    async handleResourceEdit(resourceType, resourceId) {
        const resourceList = resourceType === 'character'
            ? this.#getResolvedParticipants()
            : this.#getResolvedNotes();
        const resource = resourceList.find(r => r.id === resourceId);
        if (!resource) return;
    
        const modalId = `#edit-${resourceType}-modal`;
        const editorTagName = resourceType === 'character' ? 'minerva-character-editor' : 'minerva-note-editor';
        const editorProp = resourceType; // 'character' or 'note'
        const saveEventName = resourceType === 'character' ? 'character-save' : 'note-save';
    
        const modalEl = this.shadowRoot.querySelector(modalId);
        const editorEl = modalEl.querySelector(editorTagName);
        const closeBtn = modalEl.querySelector('.close-modal-btn');
        const saveChangesBtn = modalEl.querySelector('.save-changes-btn');
        const saveToLibraryBtn = modalEl.querySelector('.save-to-library-btn');
        const backdrop = modalEl;
    
        if (editorTagName === 'minerva-note-editor') {
            editorEl.allCharacters = this.state.allCharacters;
        }
        editorEl[editorProp] = JSON.parse(JSON.stringify(resource));
        saveToLibraryBtn.disabled = !resource.isEmbedded;
    
        const onSaveChanges = () => editorEl.shadowRoot.querySelector('form').requestSubmit();
        const onSaveToLibrary = () => {
            this.handlePromoteToLibrary(resourceType, resourceId);
            saveToLibraryBtn.disabled = true; // Optimistically disable after click
        };
        const onSave = async (event) => {
            const updatedData = event.detail[editorProp];
            try {
                if (resource.isEmbedded) {
                    const resourceListKey = resourceType === 'character' ? 'participants' : 'notes';
                    const chatResourceList = this.state.selectedChat[resourceListKey];
                    const index = chatResourceList.findIndex(r => typeof r === 'object' && r.id === resourceId);
                    if (index > -1) chatResourceList[index] = updatedData;
                    await api.put(`/api/chats/${this.state.selectedChat.id}`, { [resourceListKey]: chatResourceList });
                } else {
                    const apiEndpoint = resourceType === 'character' ? 'characters' : 'notes';
                    await api.put(`/api/${apiEndpoint}/${resourceId}`, updatedData);
                }
                notifier.show({ type: 'good', message: `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} updated.` });
                hideModal();
            } catch (e) {
                notifier.show({ type: 'bad', header: 'Error', message: `Could not save ${resourceType}. ${e.message}` });
            }
        };
    
        const hideModal = () => {
            modalEl.style.display = 'none';
            editorEl.removeEventListener(saveEventName, onSave);
            closeBtn.removeEventListener('click', hideModal);
            saveChangesBtn.removeEventListener('click', onSaveChanges);
            saveToLibraryBtn.removeEventListener('click', onSaveToLibrary);
            backdrop.removeEventListener('click', onBackdropClick);
        };
        const onBackdropClick = (e) => { if (e.target === backdrop) hideModal(); };
    
        editorEl.addEventListener(saveEventName, onSave, { once: true });
        closeBtn.addEventListener('click', hideModal);
        saveChangesBtn.addEventListener('click', onSaveChanges);
        saveToLibraryBtn.addEventListener('click', onSaveToLibrary);
        backdrop.addEventListener('click', onBackdropClick);
    
        modalEl.style.display = 'flex';
    }

    async handleCreateEmbedded(resourceType) {
        if (!this.state.selectedChat) return;
        const modalId = `#edit-${resourceType}-modal`;
        const editorTagName = resourceType === 'character' ? 'minerva-character-editor' : 'minerva-note-editor';
        const editorProp = resourceType;
        const saveEventName = resourceType === 'character' ? 'character-save' : 'note-save';

        const modalEl = this.shadowRoot.querySelector(modalId);
        const editorEl = modalEl.querySelector(editorTagName);
        const closeBtn = modalEl.querySelector('.close-modal-btn');
        const saveChangesBtn = modalEl.querySelector('.save-changes-btn');
        const saveToLibraryBtn = modalEl.querySelector('.save-to-library-btn');
        const backdrop = modalEl;

        const newResource = {
            id: `temp-${uuidv4()}`,
            name: 'New Embedded ' + (resourceType.charAt(0).toUpperCase() + resourceType.slice(1)),
            description: '',
        };
        if (resourceType === 'character') {
            newResource.gallery = [];
        } else {
            newResource.describes = '';
            newResource.characterOverrides = {};
        }

        if (editorTagName === 'minerva-note-editor') {
            editorEl.allCharacters = this.state.allCharacters;
        }
        editorEl[editorProp] = newResource;
        saveToLibraryBtn.disabled = true;

        const onSaveChanges = () => editorEl.shadowRoot.querySelector('form').requestSubmit();
        const onSave = async (event) => {
            const resourceData = event.detail[editorProp];
            try {
                const resourceListKey = resourceType === 'character' ? 'participants' : 'notes';
                this.state.selectedChat[resourceListKey].push(resourceData);
                await api.put(`/api/chats/${this.state.selectedChat.id}`, { [resourceListKey]: this.state.selectedChat[resourceListKey] });
                notifier.show({ type: 'good', message: `New embedded ${resourceType} added to chat.` });
                hideModal();
            } catch (e) {
                notifier.show({ type: 'bad', header: 'Error', message: `Could not save embedded ${resourceType}. ${e.message}` });
            }
        };

        const hideModal = () => {
            modalEl.style.display = 'none';
            editorEl.removeEventListener(saveEventName, onSave);
            closeBtn.removeEventListener('click', hideModal);
            saveChangesBtn.removeEventListener('click', onSaveChanges);
            backdrop.removeEventListener('click', onBackdropClick);
        };
        const onBackdropClick = (e) => { if (e.target === backdrop) hideModal(); };

        editorEl.addEventListener(saveEventName, onSave, { once: true });
        closeBtn.addEventListener('click', hideModal);
        saveChangesBtn.addEventListener('click', onSaveChanges);
        backdrop.addEventListener('click', onBackdropClick);

        modalEl.style.display = 'flex';
    }

    async handlePromoteToLibrary(resourceType, resourceId) {
        const selectedChat = this.state.selectedChat;
        if (!selectedChat) return;

        try {
            // Find the embedded resource in the chat
            let embeddedResource;
            if (resourceType === 'character') {
                embeddedResource = selectedChat.participants.find(p => typeof p === 'object' && p.id === resourceId);
            } else if (resourceType === 'note') {
                embeddedResource = selectedChat.notes.find(n => typeof n === 'object' && n.id === resourceId);
            }

            if (!embeddedResource) {
                notifier.show({ 
                    type: 'bad', 
                    header: 'Error', 
                    message: `Embedded ${resourceType} not found in chat.` 
                });
                return;
            }

            // Check if a resource with the same name already exists in the library
            const existingResource = resourceType === 'character' 
                ? this.state.allCharacters.find(c => c.name.toLowerCase() === embeddedResource.name.toLowerCase())
                : this.state.allNotes.find(n => n.name.toLowerCase() === embeddedResource.name.toLowerCase());

            if (existingResource) {
                // Show conflict resolution modal
                this.showConflictResolutionModal(resourceType, resourceId, embeddedResource, existingResource);
            } else {
                // No conflict, proceed with promotion
                await this.promoteToLibraryDirect(resourceType, resourceId);
            }

        } catch (error) {
            console.error(`Error promoting ${resourceType}:`, error);
            notifier.show({ 
                type: 'bad', 
                header: 'Error', 
                message: `Could not save ${resourceType} to library: ${error.message}` 
            });
        }
    }

    async promoteToLibraryDirect(resourceType, resourceId) {
        await api.post(`/api/chats/${this.state.selectedChat.id}/promote-to-library`, {
            resourceType,
            resourceId
        });
        notifier.show({ 
            type: 'good', 
            header: 'Saved to Library', 
            message: `The ${resourceType} has been saved to your library.` 
        });
        this.#updateRightPanel(); // Update UI to reflect the change
    }

    showConflictResolutionModal(resourceType, resourceId, embeddedResource, existingResource) {
        const resourceName = resourceType === 'character' ? 'Character' : 'Note';
        
        modal.confirm({
            title: `${resourceName} Already Exists`,
            content: `A ${resourceType} named "${embeddedResource.name}" already exists in your library. Do you want to overwrite it with this embedded version?`,
            confirmLabel: 'Overwrite',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    // Update the existing resource with the embedded data
                    const apiEndpoint = resourceType === 'character' ? 'characters' : 'notes';
                    await api.put(`/api/${apiEndpoint}/${existingResource.id}`, embeddedResource);
                    
                    // Replace embedded resource with reference to existing library resource
                    const resourceArray = resourceType === 'character' 
                        ? this.state.selectedChat.participants 
                        : this.state.selectedChat.notes;
                    
                    const resourceIndex = resourceArray.findIndex(r => 
                        typeof r === 'object' && r.id === resourceId
                    );
                    
                    if (resourceIndex !== -1) {
                        resourceArray[resourceIndex] = existingResource.id;
                        await api.put(`/api/chats/${this.state.selectedChat.id}`, this.state.selectedChat);
                    }
                    
                    notifier.show({ 
                        type: 'good', 
                        header: 'Overwritten', 
                        message: `Library ${resourceType} updated and linked to chat.` 
                    });
                    
                    this.#updateRightPanel();
                    
                } catch (error) {
                    console.error(`Error overwriting ${resourceType}:`, error);
                    notifier.show({ 
                        type: 'bad', 
                        header: 'Error', 
                        message: `Failed to overwrite ${resourceType}: ${error.message}` 
                    });
                }
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

    #findLatestNodeInTree(root) {
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

    #renderChatList() {
        const chatListEl = this.shadowRoot.querySelector('#chat-list');
        if (!chatListEl) return;
        const chatTree = this._buildChatTree(this.state.chats);
        
        const listHtml = chatTree.map(root => {
            const displayNode = this.#findLatestNodeInTree(root);
            const isExpanded = this.state.expandedChatIds.has(root.id);
            const hasChildren = root.children && root.children.length > 0;
            const isSelected = this.state.selectedChat?.id === displayNode.id;
            const isMultiSelected = this.state.multiSelectedChatIds.has(root.id);
            
            const rowClasses = [ 'item-row', isSelected ? 'selected' : '', this.state.isMultiSelectMode ? 'multi-select-mode' : '' ].join(' ');
            const liClasses = [ 'chat-list-item', hasChildren ? 'has-children' : '', isExpanded ? 'is-expanded' : '' ].join(' ');
            
            const expanderHtml = hasChildren ? `<button class="expander icon-button" data-action="toggle-expand"><span class="material-icons">${isExpanded ? 'expand_more' : 'chevron_right'}</span></button>` : `<span class="expander-placeholder"></span>`;
            const checkboxHtml = this.state.isMultiSelectMode ? `<input type="checkbox" class="multiselect-checkbox" ${isMultiSelected ? 'checked' : ''}>` : '';
            const childrenHtml = hasChildren && isExpanded ? `<ul class="chat-tree-container">${this.#renderTimelineNodes(root, root.id, 0, true)}</ul>` : '';

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

    #renderTimelineNodes(node, rootId, level, isLastChild = false) {
        const isSelected = this.state.selectedChat?.id === node.id;
        const rowClasses = ['item-row', 'timeline-node', isSelected ? 'selected' : ''].join(' ');
        const liClasses = ['timeline-item', `level-${level % 4}`, isLastChild ? 'last-child' : ''].join(' ');
        const childrenHtml = node.children && node.children.length > 0
            ? `<ul>${node.children.map((child, index) => this.#renderTimelineNodes(child, rootId, level + 1, index === node.children.length - 1)).join('')}</ul>`
            : '';

        return `
            <li data-id="${node.id}" data-root-id="${rootId}" class="${liClasses}">
                <div class="${rowClasses}">
                    <div class="item-details">
                        <div class="item-name">${this._escapeHtml(node.name)}</div>
                        <div class="item-snippet">${this._escapeHtml(node.lastMessageSnippet || 'No messages yet.')}</div>
                    </div>
                </div>
                ${childrenHtml}
            </li>
        `;
    }
    
    #getResolvedParticipants() {
        if (!this.state.selectedChat?.participants) return [];
        return this.state.selectedChat.participants.map(p => {
            if (typeof p === 'string') {
                const char = this.state.allCharacters.find(c => c.id === p);
                return char 
                    ? { ...char, isEmbedded: false } 
                    : { id: p, name: 'Unknown Character', isEmbedded: false, isMissing: true };
            }
            return { ...p, isEmbedded: true };
        });
    }

    #getResolvedNotes() {
        if (!this.state.selectedChat?.notes) return [];
        return this.state.selectedChat.notes.map(s => {
            if (typeof s === 'string') {
                const note = this.state.allNotes.find(sc => sc.id === s);
                return note 
                    ? { ...note, isEmbedded: false } 
                    : { id: s, name: 'Unknown Note', isEmbedded: false, isMissing: true };
            }
            return { ...s, isEmbedded: true };
        });
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
        
        this.#renderChatList();
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
            this.shadowRoot.querySelector('#export-chat-btn').style.display = 'flex'; // Show export button
            
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
            this.shadowRoot.querySelector('#export-chat-btn').style.display = 'none'; // Hide export button
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
            this.#renderParticipantList();
            this.#renderActiveNoteList();
        } else {
            this.shadowRoot.querySelector('.right-panel-content').style.display = 'none';
        }
    }

    #renderParticipantList() {
        const listEl = this.shadowRoot.querySelector('#participant-list');
        const participants = this.#getResolvedParticipants();

        listEl.innerHTML = participants.map(char => {
            // Toggle button: embed/reference (disabled for missing resources)
            let toggleBtn;
            if (char.isMissing) {
                toggleBtn = `<button class="icon-button" disabled title="Character not found in library"><span class="material-icons">help_outline</span></button>`;
            } else if (char.isEmbedded) {
                toggleBtn = `<button class="icon-button" data-action="promote" title="Save to Library (Convert to Reference)"><span class="material-icons">library_add</span></button>`;
            } else {
                toggleBtn = `<button class="icon-button" data-action="embed" title="Embed in Chat (Anchor Data)"><span class="material-icons">anchor</span></button>`;
            }
            
            // Status indicator
            let statusIcon;
            if (char.isMissing) {
                statusIcon = `<div class="status-indicator missing"><span class="material-icons">error</span></div>`;
            } else if (char.isEmbedded) {
                statusIcon = `<div class="status-indicator embedded"><span class="material-icons">link_off</span></div>`;
            } else {
                statusIcon = `<div class="status-indicator library"><span class="material-icons">check</span></div>`;
            }
            
            return `
                 <li data-id="${char.id}">
                    <div class="item-row">
                        ${statusIcon}
                        <img class="avatar" src="${char.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${char.name}'s avatar">
                        <div class="item-name">${char.name}</div>
                        <div class="actions">
                            ${toggleBtn}
                            <button class="icon-button" data-action="edit" title="Edit" ${char.isMissing ? 'disabled' : ''}><span class="material-icons">edit</span></button>
                            <button class="icon-button delete-btn" data-action="delete" title="Remove"><span class="material-icons">close</span></button>
                        </div>
                    </div>
                </li>
            `;
        }).join('');
    }
    
    #renderActiveNoteList() {
        const listEl = this.shadowRoot.querySelector('#active-note-list');
        const activeNotes = this.#getResolvedNotes();
        
        if (activeNotes.length === 0) {
            listEl.innerHTML = `<li class="list-placeholder">No active notes.</li>`;
            return;
        }

        listEl.innerHTML = activeNotes.map(note => {
            // Toggle button: embed/reference (disabled for missing resources)
            let toggleBtn;
            if (note.isMissing) {
                toggleBtn = `<button class="icon-button" disabled title="Note not found in library"><span class="material-icons">help_outline</span></button>`;
            } else if (note.isEmbedded) {
                toggleBtn = `<button class="icon-button" data-action="promote" title="Save to Library (Convert to Reference)"><span class="material-icons">library_add</span></button>`;
            } else {
                toggleBtn = `<button class="icon-button" data-action="embed" title="Embed in Chat (Anchor Data)"><span class="material-icons">anchor</span></button>`;
            }
            
            // Status indicator
            let statusIcon;
            if (note.isMissing) {
                statusIcon = `<div class="status-indicator missing"><span class="material-icons">error</span></div>`;
            } else if (note.isEmbedded) {
                statusIcon = `<div class="status-indicator embedded"><span class="material-icons">link_off</span></div>`;
            } else {
                statusIcon = `<div class="status-indicator library"><span class="material-icons">check</span></div>`;
            }
            
            return `
                <li data-id="${note.id}">
                    <div class="item-row">
                        ${statusIcon}
                        <div class="item-name">${this._escapeHtml(note.name)}</div>
                        <div class="actions">
                            ${toggleBtn}
                            <button class="icon-button" data-action="edit" title="Edit" ${note.isMissing ? 'disabled' : ''}><span class="material-icons">edit</span></button>
                            <button class="icon-button delete-btn" data-action="delete" title="Remove Note"><span class="material-icons">close</span></button>
                        </div>
                    </div>
                </li>
            `}).join('');
    }

    updateModalListView() {
        const list = this.shadowRoot.querySelector('#modal-character-list');
        const search = this.shadowRoot.querySelector('#modal-search-input').value.toLowerCase();
        const participantIds = new Set(this.#getResolvedParticipants().map(p => p.id));
        const filteredChars = this.state.allCharacters.filter(char => char.name.toLowerCase().includes(search));
        
        list.innerHTML = filteredChars.map(char => {
            const isParticipant = participantIds.has(char.id);
            return `
                <li data-id="${char.id}" class="${isParticipant ? 'is-participant' : ''}">
                    <div class="item-row">
                        <img class="avatar" src="${char.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${char.name}'s avatar">
                        <div class="item-name">${char.name}</div>
                        <div class="actions">
                            ${isParticipant ? `<span class="material-icons participant-icon" title="Is a participant">check_circle</span>` : ''}
                        </div>
                    </div>
                </li>
            `;
        }).join('');
    }
    
    updateNoteModalListView() {
        const list = this.shadowRoot.querySelector('#modal-note-list');
        const activeIds = new Set(this.#getResolvedNotes().map(s => s.id));
        const sortedNotes = [...this.state.allNotes].sort((a, b) => a.name.localeCompare(b.name));

        list.innerHTML = sortedNotes.map(note => {
            const isActive = activeIds.has(note.id);
            return `
                <li data-id="${note.id}" class="${isActive ? 'is-participant' : ''}">
                    <div class="item-row">
                        <div class="item-name">${this._escapeHtml(note.name)}</div>
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
                            <button class="icon-button" data-action="import" title="Import Chat"><span class="material-icons">file_upload</span></button>
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
                        <button id="sidebar-btn" class="icon-button" title="View Sidebar"><span class="material-icons">view_sidebar</span></button>
                    </header>
                    <header class="chat-main-header">
                        <input type="text" id="chat-name-input" placeholder="Chat Name">
                        <button id="go-to-parent-btn" class="icon-button" title="Go to Parent Chat"><span class="material-icons">arrow_upward</span></button>
                        <button id="export-chat-btn" class="icon-button" title="Export Chat Tree"><span class="material-icons">download</span></button>
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
                        <div class="notes-section">
                            <header id="note-list-header">
                                <h3>Active Notes</h3>
                                <div class="header-actions">
                                    <button class="icon-button" data-action="add-note" title="Add Note"><span class="material-icons">add</span></button>
                                </div>
                            </header>
                            <item-list id="active-note-list"></item-list>
                        </div>
                    </div>
                </div>
            </div>

            <!-- MODALS -->
            <div id="add-character-modal" class="modal-backdrop">
                <div class="modal-content">
                    <header><h2>Add Character to Chat</h2><button id="close-char-modal-btn" class="close-modal-btn" title="Close"><span class="material-icons">close</span></button></header>
                    <div class="modal-body">
                        <div class="modal-search-bar"><span class="material-icons">search</span><input type="text" id="modal-search-input" placeholder="Search for characters..."></div>
                        <item-list id="modal-character-list"></item-list>
                    </div>
                </div>
            </div>
             <div id="add-note-modal" class="modal-backdrop">
                <div class="modal-content">
                    <header><h2>Add Note to Chat</h2><button id="close-note-modal-btn" class="close-modal-btn" title="Close"><span class="material-icons">close</span></button></header>
                    <div class="modal-body">
                        <item-list id="modal-note-list"></item-list>
                    </div>
                    <div class="modal-footer">
                        <button id="create-embedded-note-btn" class="button-secondary">Create new embedded note</button>
                    </div>
                </div>
            </div>
            <div id="edit-character-modal" class="modal-backdrop editor-modal">
                <div class="modal-content large">
                    <header><h2>Edit Character</h2><button class="close-modal-btn" title="Close"><span class="material-icons">close</span></button></header>
                    <div class="modal-body"><minerva-character-editor></minerva-character-editor></div>
                    <div class="modal-footer">
                        <button class="save-to-library-btn button-secondary" disabled>Save to Library</button>
                        <button class="save-changes-btn button-primary">Save Changes</button>
                    </div>
                </div>
            </div>
            <div id="edit-note-modal" class="modal-backdrop editor-modal">
                <div class="modal-content large">
                    <header><h2>Edit Note</h2><button class="close-modal-btn" title="Close"><span class="material-icons">close</span></button></header>
                    <div class="modal-body"><minerva-note-editor></minerva-note-editor></div>
                    <div class="modal-footer">
                        <button class="save-to-library-btn button-secondary" disabled>Save to Library</button>
                        <button class="save-changes-btn button-primary">Save Changes</button>
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
            .notes-section { flex: 1; display: flex; flex-direction: column; min-height: 100px; background-color: var(--bg-1); }
            .panel-left header, #participant-list-header, #note-list-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0; gap: var(--spacing-sm);
            }
            .panel-left header h3, #participant-list-header h3, #note-list-header h3 { margin: 0; }
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
            .modal-backdrop { position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); display: none; align-items: center; justify-content: center; z-index: 1100; }
            .modal-content { background-color: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius-md); width: 90%; max-width: 500px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
            .modal-content.large { max-width: 800px; }
            .modal-content header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md) var(--spacing-lg); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; }
            .modal-content header h2 { margin: 0; font-size: 1.1rem; }
            .close-modal-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            .close-modal-btn:hover { color: var(--text-primary); }
            .modal-body { display: flex; flex-direction: column; overflow-y: auto; flex-grow: 1; gap: var(--spacing-md); }
            .editor-modal .modal-body { padding: 0; }
            #add-character-modal .modal-body, #add-note-modal .modal-body { padding: var(--spacing-md); }
            .modal-footer { padding: var(--spacing-md) var(--spacing-lg); border-top: 1px solid var(--bg-3); display: flex; justify-content: flex-end; gap: var(--spacing-md); }
            #add-character-modal .modal-footer, #add-note-modal .modal-footer { justify-content: center; }
            .modal-search-bar { display: flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); border: 1px solid var(--bg-3); background-color: var(--bg-0); border-radius: var(--radius-sm); flex-shrink: 0; }
            #modal-search-input { background: none; border: none; outline: none; width: 100%; color: var(--text-primary); }
            #go-to-parent-btn { display: none; }
            #export-chat-btn { display: none; } /* Hidden by default, shown when chat is selected */
            .mobile-chat-header, #back-to-chats-btn, .view-overlay { display: none; }
            .list-placeholder { color: var(--text-disabled); font-style: italic; padding: var(--spacing-sm) var(--spacing-md); font-size: var(--font-size-sm); }

            /* Item List Styles for this View */
            
            /* Common styles for all list item rows */
            item-list li .item-row { display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md); cursor: pointer; transition: var(--transition-fast); gap: var(--spacing-sm); }
            #participant-list li .item-row:hover, #active-note-list li .item-row:hover,
            #modal-character-list li:not(.is-participant) .item-row:hover,
            #modal-note-list li:not(.is-participant) .item-row:hover { background-color: var(--bg-2); }
            item-list .avatar { width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; background-color: var(--bg-3); }
            #modal-character-list .avatar { width: 32px; height: 32px; }
            item-list .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; }
            item-list .actions { display: flex; flex-shrink: 0; gap: var(--spacing-xs); }
            
            /* Status indicators for embedded/library items */
            .status-indicator { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: var(--spacing-xs); }
            .status-indicator.library { background-color: var(--accent-good); }
            .status-indicator.library .material-icons { font-size: 14px; color: white; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }
            .status-indicator.embedded { background-color: var(--bg-3); }
            .status-indicator.embedded .material-icons { font-size: 12px; color: var(--text-disabled); text-shadow: 0 1px 2px rgba(0,0,0,0.4); }
            .status-indicator.missing { background-color: var(--accent-danger); }
            .status-indicator.missing .material-icons { font-size: 14px; color: white; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }
            
            /* Specifics for Participant & Modal Lists */
            #modal-character-list li.is-participant > .item-row, #modal-note-list li.is-participant > .item-row { background-color: var(--accent-primary-faded); border-left: 3px solid var(--accent-primary); padding-left: calc(var(--spacing-md) - 3px); }
            #modal-character-list li.is-participant > .item-row:hover, #modal-note-list li.is-participant > .item-row:hover { background-color: rgba(138, 180, 248, 0.4); }
            .participant-icon { color: var(--accent-good); margin: 0 var(--spacing-xs); }
            #participant-list li .item-row, #modal-character-list li .item-row, #active-note-list li .item-row, #modal-note-list li .item-row { border-bottom: 1px solid var(--bg-3); }
            #participant-list li:last-child .item-row, #modal-character-list li:last-child .item-row, #active-note-list li:last-child .item-row, #modal-note-list li:last-child .item-row { border-bottom: none; }

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
            .timeline-item { position: relative; padding-left: 24px; }
            .timeline-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background-color: var(--bg-3); }
            .timeline-item.last-child::before { bottom: auto; height: 40px; }
            .timeline-item > .item-row { --level-0-color: var(--accent-primary); --level-1-color: var(--accent-good); --level-2-color: var(--accent-warn); --level-3-color: var(--accent-danger); position: relative; }
            .timeline-item > .item-row::before { content: ''; position: absolute; left: -31px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; border-radius: 50%; background-color: var(--bg-0); border: 2px solid var(--bg-3); z-index: 1; }
            .timeline-item > .item-row::after { content: ''; position: absolute; left: -24px; top: 50%; width: 24px; height: 2px; background-color: var(--bg-3); }
            .timeline-item.level-0 > .item-row::before { border-color: var(--level-0-color); }
            .timeline-item.level-1 > .item-row::before { border-color: var(--level-1-color); }
            .timeline-item.level-2 > .item-row::before { border-color: var(--level-2-color); }
            .timeline-item.level-3 > .item-row::before { border-color: var(--level-3-color); }
            .timeline-item > .item-row.selected { background-color: var(--bg-2) !important; }
            .timeline-item > .item-row.selected .item-name { color: var(--accent-primary) !important; }
            .timeline-item > .item-row .avatar { display: none; }
            .timeline-item > .item-row .item-details { margin-left: var(--spacing-sm); }
            /* Allow branch names in tree view to extend and be scrollable */
            .chat-tree-container .item-row { overflow: visible; width: max-content; min-width: 100%; }
            .chat-tree-container .item-details { overflow: visible; min-width: max-content; }
            .chat-tree-container .item-name { white-space: nowrap; overflow: visible; text-overflow: clip; min-width: max-content; }
            @media (max-width: 768px) {
                .panel-main { padding: 0; height: 100%; }
                .chat-main-header { display: none !important; }
                .mobile-chat-header { display: flex; padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; align-items: center; gap: var(--spacing-xs); }
                .mobile-chat-header h2 { flex-grow: 1; }
                #back-to-chats-btn { display: flex; }
                #chat-title-mobile { font-size: 1.1rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
                #chat-title-mobile[contenteditable="true"] {
                    outline: 2px solid var(--accent-primary);
                    outline-offset: 2px;
                    border-radius: var(--radius-sm);
                    padding: 2px 4px;
                    white-space: normal;
                    overflow: visible;
                }
                #sidebar-btn { display: flex; }
                .panel-right { position: fixed; top: 0; right: 0; width: 85%; max-width: 320px; height: 100%; z-index: 1001; transform: translateX(100%); transition: transform 0.3s ease-in-out; box-shadow: -2px 0 8px rgba(0,0,0,0.3); border-left: 1px solid var(--bg-3); }
                .panel-right.visible { transform: translateX(0); }
                .view-overlay.visible { display: block; position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); z-index: 1000; }
            }
        `;
    }
}

customElements.define('main-chat-view', MainChatView);