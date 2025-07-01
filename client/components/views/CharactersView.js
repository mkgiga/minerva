import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../CharacterEditor.js';

class CharactersView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            characters: [],
            selectedCharacter: null,
            userPersonaCharacterId: null,
        };

        this.handleBackToCharacters = this.handleBackToCharacters.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this._pendingSelectedId = null; // To hold an ID before data is fetched
    }

    async connectedCallback() {
        this.render(); 
        
        this.itemList = this.shadowRoot.querySelector('item-list');

        this.itemList.addEventListener('item-select', this.handleCharacterSelect.bind(this));
        this.itemList.addEventListener('item-add', this.handleCharacterAdd.bind(this));
        this.itemList.addEventListener('item-delete', this.handleCharacterDelete.bind(this));
        this.itemList.addEventListener('item-set-user', this.handleSetUserPersona.bind(this));
        this.shadowRoot.querySelector('minerva-character-editor').addEventListener('character-save', this.handleCharacterSave.bind(this));
        this.shadowRoot.querySelector('#back-to-characters-btn').addEventListener('click', this.handleBackToCharacters);
        
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);

        this.addCustomActions();
        await this.fetchData();
    }
    
    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
    }
    
    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        
        if (resourceType === 'character') {
            let changed = false;
            switch (eventType) {
                case 'create':
                    this.state.characters.push(data);
                    changed = true;
                    break;
                case 'update':
                    const index = this.state.characters.findIndex(c => c.id === data.id);
                    if (index !== -1) {
                        this.state.characters[index] = data;
                        if (this.state.selectedCharacter?.id === data.id) {
                            this.state.selectedCharacter = data;
                        }
                        changed = true;
                    }
                    break;
                case 'delete':
                    this.state.characters = this.state.characters.filter(c => c.id !== data.id);
                    if (this.state.selectedCharacter?.id === data.id) {
                        this.state.selectedCharacter = null;
                    }
                    changed = true;
                    break;
            }
            if (changed) this.updateView();

        } else if (resourceType === 'setting') {
            if (this.state.userPersonaCharacterId !== data.userPersonaCharacterId) {
                this.state.userPersonaCharacterId = data.userPersonaCharacterId;
                this.updateView();
            }
        }
    }

    handleBackToCharacters() {
        this.state.selectedCharacter = null;
        this.updateView();
    }

    addCustomActions() {
        this.itemList.addCustomAction({
            icon: 'file_upload',
            name: 'import-characters',
            title: 'Import',
            callback: this.handleCharacterImport.bind(this)
        });
    }

    async fetchData() {
        try {
            // Fetch characters first to populate the list
            this.state.characters = await api.get('/api/characters');
            
            // Then fetch settings to know the persona
            const settings = await api.get('/api/settings');
            this.state.userPersonaCharacterId = settings.userPersonaCharacterId;

            // If an ID was set before data was loaded, select the character now
            if (this._pendingSelectedId) {
                const charToSelect = this.state.characters.find(c => c.id === this._pendingSelectedId);
                if (charToSelect) {
                    this.state.selectedCharacter = charToSelect;
                }
                this._pendingSelectedId = null;
            }

            this.updateView();
        } catch (error) {
            console.error("Failed to fetch initial data:", error);
            notifier.show({ header: 'Error', message: 'Could not load character data.' });
        }
    }
    
    setInitialState({ selectedCharacterId }) {
        if (!selectedCharacterId) return;

        if (this.state.characters.length > 0) {
            // Data is already loaded, find and select the character
            const charToSelect = this.state.characters.find(c => c.id === selectedCharacterId);
            if (charToSelect) {
                this.state.selectedCharacter = charToSelect;
                this.updateView();
            }
        } else {
            // Data not fetched yet, store the ID to be selected after fetch completes
            this._pendingSelectedId = selectedCharacterId;
        }
    }

    handleCharacterSelect(event) {
        this.state.selectedCharacter = event.detail.item;
        this.updateView();
    }

    async handleCharacterAdd() {
        try {
            const newChar = await api.post('/api/characters', { name: 'New Character', description: 'A new character ready for adventure.' });
            // The view will update via SSE, but we can optimistically select the new character.
            this.state.selectedCharacter = newChar;
        } catch (error) {
            console.error('Failed to add character:', error);
            notifier.show({ header: 'Error', message: 'Failed to create a new character.' });
        }
    }
    
    async handleCharacterDelete(event) {
        const { item } = event.detail;
        
        modal.confirm({
            title: 'Delete Character',
            content: `Are you sure you want to delete ${item.name}? This action cannot be undone.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/characters/${item.id}`);
                    // The view will automatically update via the SSE broadcast.
                    notifier.show({ header: 'Character Deleted', message: `${item.name} was removed.` });
                } catch (error) {
                    console.error(`Failed to delete character ${item.id}:`, error);
                    notifier.show({ header: 'Error', message: `Failed to delete ${item.name}.` });
                }
            }
        });
    }

    async handleCharacterSave(event) {
        const { character, isAvatarUpdate } = event.detail;
        const originalId = this.state.selectedCharacter.id; // Get ID before potential change

        try {
            if (isAvatarUpdate) {
                // Avatar uploads are a separate endpoint and already handled by the editor component.
                // The server will broadcast the update. We can just show a notification.
                notifier.show({ header: 'Avatar Updated', message: `New avatar saved for ${character.name}.` });
                return; // Nothing more to do here.
            }
            
            // Pass original ID in URL, full character object (with new ID if changed) in body.
            const updatedChar = await api.put(`/api/characters/${originalId}`, character);
            notifier.show({ header: 'Character Saved', message: `${updatedChar.name} has been updated.` });

            // If the ID was changed, the server sends delete+create events.
            // Our local state for selectedCharacter might become stale.
            // To provide a smooth experience, we optimistically update the selection to the new character.
            if (updatedChar.id !== originalId) {
                this.state.selectedCharacter = updatedChar;
                // updateView will be called by the SSE handler, but we can call it here for faster UI feedback.
                this.updateView();
            }

        } catch (error) {
            console.error('Failed to save character:', error);
            // The api helper now includes the server's message.
            notifier.show({ header: 'Error', message: error.message || `Could not save character.` });
        }
    }

    async handleSetUserPersona(event) {
        const { item } = event.detail;
        const newPersonaId = this.state.userPersonaCharacterId === item.id ? null : item.id;

        try {
            await api.post('/api/settings/persona', { characterId: newPersonaId });
            // The view will update via SSE.
            const message = newPersonaId ? `"${item.name}" is now the user persona.` : 'User persona has been cleared.';
            notifier.show({ type: 'good', header: 'Persona Updated', message });
        } catch (error) {
             console.error('Failed to set user persona:', error);
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not update user persona.' });
        }
    }

    handleCharacterImport() {
        const content = document.createElement('div');
        content.innerHTML = `
            <p>Select one or more Minerva character files (.json) to import.</p>
            <p class="field-description">This currently supports the standard Minerva format (a single character object per file).</p>
        `;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        content.appendChild(fileInput);

        fileInput.addEventListener('change', async (event) => {
            const files = event.target.files;
            if (!files.length) return;

            modal.hide();
            notifier.show({ header: 'Importing...', message: `Starting import of ${files.length} file(s).` });

            const readPromises = Array.from(files).map(file => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve({ content: e.target.result, name: file.name });
                    reader.onerror = e => reject(e);
                    reader.readAsText(file);
                });
            });

            const results = await Promise.allSettled(readPromises);
            let failedImports = [];
            const importPromises = [];

            for (const result of results) {
                if (result.status === 'fulfilled') {
                    try {
                        const charData = JSON.parse(result.value.content);
                        // Basic validation: must have a name. Description is optional.
                        if (charData.name) {
                            // Don't include ID, let the backend generate it
                            const { id, ...payload } = charData;
                            importPromises.push(api.post('/api/characters', payload));
                        } else {
                            failedImports.push(result.value.name);
                        }
                    } catch (e) {
                        failedImports.push(result.value.name);
                    }
                } else {
                    failedImports.push('A file that could not be read.');
                }
            }

            const importResults = await Promise.allSettled(importPromises);
            const successfulImports = importResults.filter(r => r.status === 'fulfilled').length;
            const failedApiImports = importResults.filter(r => r.status === 'rejected').length;

            if (successfulImports > 0) {
                notifier.show({
                    type: 'good',
                    header: 'Import Complete',
                    message: `Successfully imported ${successfulImports} character(s).`
                });
                // No need to fetch, SSE will update the list.
            }

            if (failedImports.length > 0 || failedApiImports > 0) {
                notifier.show({
                    type: 'warn',
                    header: 'Import Issues',
                    message: `Failed to import ${failedImports.length + failedApiImports} character(s).`
                });
                console.warn('Failed to parse files:', failedImports);
                console.warn('Failed API calls:', importResults.filter(r => r.status === 'rejected'));
            }
        });

        modal.show({
            title: 'Import Characters',
            content: content,
            buttons: [
                {
                    label: 'Cancel',
                    className: 'button-secondary',
                    onClick: () => modal.hide()
                },
                {
                    label: 'Select Files...',
                    className: 'button-primary',
                    onClick: () => fileInput.click()
                }
            ]
        });
    }
    
    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-editor-header');

        if (isMobile) {
            if (this.state.selectedCharacter) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.state.selectedCharacter.name || 'Edit Character';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
            }
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        if (this.itemList) {
            this.itemList.items = this.state.characters;
            this.itemList.selectedId = this.state.selectedCharacter?.id;
            this.itemList.userId = this.state.userPersonaCharacterId;
        }

        const editor = this.shadowRoot.querySelector('minerva-character-editor');
        if (editor) {
            editor.character = this.state.selectedCharacter;
        }
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <item-list
                        list-title="Characters"
                        items-creatable
                        items-removable
                        items-user-selectable
                        has-avatar>
                    </item-list>
                </div>
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-characters-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <minerva-character-editor></minerva-character-editor>
                </div>
            </div>
        `,
        `
            .panel-main {
                display: flex;
                flex-direction: column;
                padding: 0;
            }
            .mobile-editor-header {
                display: none;
                align-items: center;
                padding: var(--spacing-sm) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0;
                gap: var(--spacing-md);
            }
            .mobile-editor-header h2 {
                margin: 0;
                font-size: 1.1rem;
                flex-grow: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #back-to-characters-btn {
                background: none; border: none; color: var(--text-secondary);
                cursor: pointer; padding: var(--spacing-xs);
            }
            #back-to-characters-btn:hover { color: var(--text-primary); }
            minerva-character-editor {
                flex-grow: 1;
                overflow: hidden;
            }
        `);
    }
}
customElements.define('characters-view', CharactersView);