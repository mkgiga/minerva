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
            sortMode: 'name-asc', // 'name-asc', 'name-desc', 'tag-group'
            selectedFilterTags: [], // Tags to filter by (OR logic)
        };

        this.handleBackToCharacters = this.handleBackToCharacters.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this.handleListHeaderClick = this.handleListHeaderClick.bind(this);
        this.handleCharacterDuplicate = this.handleCharacterDuplicate.bind(this);
        this.handleColumnHeaderClick = this.handleColumnHeaderClick.bind(this);
        this.handleTagFilterClick = this.handleTagFilterClick.bind(this);
        this._pendingSelectedId = null; // To hold an ID before data is fetched
        this._hasAutoSelectedFirst = false; // Track if we've auto-selected the first item
    }

    async connectedCallback() {
        this.render();

        this.itemList = this.shadowRoot.querySelector('item-list');

        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', this.handleListHeaderClick);
        this.shadowRoot.querySelector('minerva-character-editor').addEventListener('character-save', this.handleCharacterSave.bind(this));
        this.shadowRoot.querySelector('#back-to-characters-btn').addEventListener('click', this.handleBackToCharacters);
        this.shadowRoot.querySelector('.list-header-row').addEventListener('click', this.handleColumnHeaderClick);
        this.shadowRoot.querySelector('.tag-filter-container').addEventListener('click', this.handleTagFilterClick);

        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
        window.addEventListener('resize', () => this.updateView());

        await this.fetchData();
    }
    
    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
        window.removeEventListener('resize', () => this.updateView());
        this.itemList.removeEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').removeEventListener('click', this.handleListHeaderClick);
    }
    
    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        
        let stateChanged = false;
        let selectedCharacterWasDeleted = false;

        if (resourceType === 'character') {
            switch (eventType) {
                case 'create':
                    this.state.characters.push(data);
                    stateChanged = true;
                    break;
                case 'update': {
                    const index = this.state.characters.findIndex(c => c.id === data.id);
                    if (index !== -1) {
                        this.state.characters[index] = data;
                        if (this.state.selectedCharacter?.id === data.id) {
                            this.state.selectedCharacter = data;
                        }
                        stateChanged = true;
                    }
                    break;
                }
                case 'delete': {
                    const initialLength = this.state.characters.length;
                    if (this.state.selectedCharacter?.id === data.id) {
                        this.state.selectedCharacter = null;
                        selectedCharacterWasDeleted = true;
                    }
                    this.state.characters = this.state.characters.filter(c => c.id !== data.id);
                    if (this.state.characters.length < initialLength) {
                        stateChanged = true;
                    }
                    break;
                }
            }
        } else if (resourceType === 'setting') {
            if (this.state.userPersonaCharacterId !== data.userPersonaCharacterId) {
                this.state.userPersonaCharacterId = data.userPersonaCharacterId;
                stateChanged = true;
            }
        }

        if (stateChanged) {
            const characterEditor = this.shadowRoot.querySelector('minerva-character-editor');
            const editorHasFocus = characterEditor && characterEditor.shadowRoot.contains(document.activeElement);

            if (editorHasFocus && !selectedCharacterWasDeleted) {
                // User is typing in the editor. To avoid interrupting them, we only update
                // the list on the left, not the main editor panel.
                this.#renderCharacterList();
            } else {
                // Otherwise, perform a full update of the view.
                this.updateView();
            }
        }
    }

    handleBackToCharacters() {
        this.state.selectedCharacter = null;
        this.updateView();
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
    
    handleListHeaderClick(event) {
        const actionTarget = event.target.closest('[data-action]');
        if (!actionTarget) return;

        const action = actionTarget.dataset.action;
        if (action === 'add') {
            this.handleCharacterAdd();
        } else if (action === 'import') {
            this.handleCharacterImport();
        }
    }

    handleColumnHeaderClick(event) {
        const col = event.target.closest('.list-header-col');
        if (!col) return;

        const sortBy = col.dataset.sort;
        if (!sortBy) return;

        // Toggle between asc/desc for the same column, or switch to new column
        if (sortBy === 'name') {
            if (this.state.sortMode === 'name-asc') {
                this.state.sortMode = 'name-desc';
            } else {
                this.state.sortMode = 'name-asc';
            }
        } else if (sortBy === 'tags') {
            this.state.sortMode = 'tag-group';
        }

        this.#updateSortIndicators();
        this.#renderCharacterList();
    }

    handleTagFilterClick(event) {
        const btn = event.target.closest('.tag-filter-btn');
        const dropdown = this.shadowRoot.querySelector('.tag-filter-dropdown');
        const checkbox = event.target.closest('input[type="checkbox"]');
        const clearBtn = event.target.closest('.clear-filter-btn');

        if (btn) {
            // Toggle dropdown
            dropdown.classList.toggle('show');
            this.#renderTagFilterDropdown();
        } else if (checkbox) {
            // Toggle tag filter
            const tag = checkbox.value;
            if (checkbox.checked) {
                if (!this.state.selectedFilterTags.includes(tag)) {
                    this.state.selectedFilterTags.push(tag);
                }
            } else {
                this.state.selectedFilterTags = this.state.selectedFilterTags.filter(t => t !== tag);
            }
            this.#updateFilterBtnState();
            this.#renderCharacterList();
        } else if (clearBtn) {
            this.state.selectedFilterTags = [];
            this.#renderTagFilterDropdown();
            this.#updateFilterBtnState();
            this.#renderCharacterList();
        } else if (!event.target.closest('.tag-filter-dropdown')) {
            // Click outside dropdown closes it
            dropdown.classList.remove('show');
        }
    }

    #updateSortIndicators() {
        const nameCol = this.shadowRoot.querySelector('.list-header-col[data-sort="name"]');
        const tagsCol = this.shadowRoot.querySelector('.list-header-col[data-sort="tags"]');

        // Clear indicators
        nameCol.classList.remove('sort-asc', 'sort-desc', 'sort-active');
        tagsCol.classList.remove('sort-active');

        if (this.state.sortMode === 'name-asc') {
            nameCol.classList.add('sort-asc', 'sort-active');
        } else if (this.state.sortMode === 'name-desc') {
            nameCol.classList.add('sort-desc', 'sort-active');
        } else if (this.state.sortMode === 'tag-group') {
            tagsCol.classList.add('sort-active');
        }
    }

    #updateFilterBtnState() {
        const btn = this.shadowRoot.querySelector('.tag-filter-btn');
        const count = this.state.selectedFilterTags.length;
        if (count > 0) {
            btn.classList.add('has-filter');
            btn.querySelector('.filter-count').textContent = count;
            btn.querySelector('.filter-count').style.display = 'inline';
        } else {
            btn.classList.remove('has-filter');
            btn.querySelector('.filter-count').style.display = 'none';
        }
    }

    #getAllUniqueTags() {
        const tagsSet = new Set();
        for (const char of this.state.characters) {
            if (char.tags && Array.isArray(char.tags)) {
                char.tags.forEach(tag => tagsSet.add(tag));
            }
        }
        return Array.from(tagsSet).sort();
    }

    #renderTagFilterDropdown() {
        const dropdown = this.shadowRoot.querySelector('.tag-filter-dropdown');
        const allTags = this.#getAllUniqueTags();

        if (allTags.length === 0) {
            dropdown.innerHTML = '<div class="no-tags">No tags defined yet</div>';
            return;
        }

        dropdown.innerHTML = `
            <div class="tag-filter-list">
                ${allTags.map(tag => `
                    <label class="tag-filter-item">
                        <input type="checkbox" value="${tag}" ${this.state.selectedFilterTags.includes(tag) ? 'checked' : ''}>
                        <span>${tag}</span>
                    </label>
                `).join('')}
            </div>
            ${this.state.selectedFilterTags.length > 0 ? '<button class="clear-filter-btn">Clear filters</button>' : ''}
        `;
    }

        handleItemAction(event) {
        const { id, action } = event.detail;
        const character = this.state.characters.find(c => c.id === id);
        if (!character) return;

        switch (action) {
            case 'select':
                this.state.selectedCharacter = character;
                this.updateView();
                break;
            case 'delete':
                this.handleCharacterDelete(character);
                break;
            case 'set-user':
                this.handleSetUserPersona(character);
                break;
            case 'duplicate':
                this.handleCharacterDuplicate(character);
                break;
        }
    }

    async handleCharacterDuplicate(item) {
        try {
            const newChar = await api.post(`/api/characters/${item.id}/duplicate`);
            notifier.show({ header: 'Character Duplicated', message: `Created copy of ${item.name}.`, type: 'good' });
            // Optimistically select the new character
            this.state.selectedCharacter = newChar;
            // Note: The list update happens automatically via SSE, but we set selectedCharacter so the editor opens it when the update arrives.
        } catch (error) {
            console.error('Failed to duplicate character:', error);
            notifier.show({ header: 'Error', message: 'Failed to duplicate character.', type: 'bad' });
        }
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
    
    async handleCharacterDelete(item) {
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

    async handleSetUserPersona(item) {
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
    
    #renderCharacterList() {
        if (!this.itemList) return;

        // Filter characters
        let filtered = this.state.characters;
        if (this.state.selectedFilterTags.length > 0) {
            filtered = filtered.filter(char => {
                if (!char.tags || char.tags.length === 0) return false;
                // OR logic: show if character has ANY of the selected tags
                return this.state.selectedFilterTags.some(tag => char.tags.includes(tag));
            });
        }

        // Sort/group characters
        let html = '';
        if (this.state.sortMode === 'tag-group') {
            html = this.#renderGroupedByTag(filtered);
        } else {
            const sorted = [...filtered].sort((a, b) => {
                const cmp = a.name.localeCompare(b.name);
                return this.state.sortMode === 'name-desc' ? -cmp : cmp;
            });
            html = sorted.map(char => this.#renderCharacterItem(char)).join('');
        }

        this.itemList.innerHTML = html;
    }

    #renderGroupedByTag(characters) {
        // Group characters by their first tag
        const groups = new Map();
        const untagged = [];

        for (const char of characters) {
            if (char.tags && char.tags.length > 0) {
                const firstTag = char.tags[0];
                if (!groups.has(firstTag)) {
                    groups.set(firstTag, []);
                }
                groups.get(firstTag).push(char);
            } else {
                untagged.push(char);
            }
        }

        // Sort groups alphabetically
        const sortedGroupNames = Array.from(groups.keys()).sort();

        let html = '';
        for (const groupName of sortedGroupNames) {
            const groupChars = groups.get(groupName).sort((a, b) => a.name.localeCompare(b.name));
            html += `<div class="list-group-header">${groupName}</div>`;
            html += groupChars.map(char => this.#renderCharacterItem(char)).join('');
        }

        // Add untagged at the end
        if (untagged.length > 0) {
            untagged.sort((a, b) => a.name.localeCompare(b.name));
            html += `<div class="list-group-header">Untagged</div>`;
            html += untagged.map(char => this.#renderCharacterItem(char)).join('');
        }

        return html;
    }

    #renderCharacterItem(char) {
        const isSelected = this.state.selectedCharacter?.id === char.id;
        const isUser = this.state.userPersonaCharacterId === char.id;

        const classes = [
            isSelected ? 'selected' : '',
            isUser ? 'user-persona' : ''
        ].join(' ').trim();

        const setUserTitle = isUser ? 'Unset as User Persona' : 'Set as User Persona';

        // Show tag chips (limit to first 2)
        const tags = char.tags || [];
        const displayTags = tags.slice(0, 2);
        const moreTags = tags.length > 2 ? tags.length - 2 : 0;
        const tagsHtml = displayTags.length > 0
            ? `<div class="item-tags">${displayTags.map(t => `<span class="item-tag">${t}</span>`).join('')}${moreTags > 0 ? `<span class="item-tag more">+${moreTags}</span>` : ''}</div>`
            : '';

        return `
            <li data-id="${char.id}" class="${classes}">
                <img class="avatar" src="${char.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${char.name}'s avatar">
                <div class="item-info">
                    <div class="item-name">${char.name}</div>
                    ${tagsHtml}
                </div>
                <div class="actions">
                    <button class="icon-button user-btn ${isUser ? 'active' : ''}" data-action="set-user" title="${setUserTitle}">
                        <span class="material-icons">account_circle</span>
                    </button>
                    <button class="icon-button" data-action="duplicate" title="Duplicate">
                        <span class="material-icons">content_copy</span>
                    </button>
                    <button class="icon-button delete-btn" data-action="delete" title="Delete">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            </li>
        `;
    }

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-right-sidebar');
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

        this.#renderCharacterList();

        const editor = this.shadowRoot.querySelector('minerva-character-editor');
        if (editor) {
            editor.character = this.state.selectedCharacter;
        }
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-characters-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <minerva-character-editor></minerva-character-editor>
                </div>
                <div class="panel-right-sidebar">
                    <header id="list-header">
                        <h3>Characters</h3>
                        <div class="header-actions">
                             <button class="icon-button" data-action="import" title="Import Characters">
                                <span class="material-icons">file_upload</span>
                            </button>
                            <button class="icon-button" data-action="add" title="Add New Character">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                    </header>
                    <div class="list-controls">
                        <div class="list-header-row">
                            <div class="list-header-col sort-asc sort-active" data-sort="name">
                                <span>Name</span>
                                <span class="material-icons sort-icon">arrow_upward</span>
                            </div>
                            <div class="list-header-col" data-sort="tags">
                                <span>Tags</span>
                            </div>
                        </div>
                        <div class="tag-filter-container">
                            <button class="tag-filter-btn" title="Filter by tags">
                                <span class="material-icons">filter_list</span>
                                <span class="filter-count" style="display:none;">0</span>
                            </button>
                            <div class="tag-filter-dropdown"></div>
                        </div>
                    </div>
                    <item-list></item-list>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            .panel-right-sidebar {
                flex-direction: column;
            }
            .panel-right-sidebar header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0; gap: var(--spacing-sm);
            }
            .panel-right-sidebar header h3 { margin: 0; }
            .header-actions { display: flex; align-items: center; gap: var(--spacing-xs); }
            .header-actions .icon-button {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                transition: var(--transition-fast); display: flex; align-items: center;
                justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm);
            }
            .header-actions .icon-button:hover {
                color: var(--text-primary); background-color: var(--bg-2);
            }

            /* List Controls - Sort and Filter */
            .list-controls {
                display: flex;
                align-items: center;
                padding: var(--spacing-xs) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
                gap: var(--spacing-sm);
                flex-shrink: 0;
            }
            .list-header-row {
                display: flex;
                flex: 1;
                gap: var(--spacing-md);
            }
            .list-header-col {
                display: flex;
                align-items: center;
                gap: 2px;
                cursor: pointer;
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                padding: var(--spacing-xs);
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
                user-select: none;
            }
            .list-header-col:hover {
                color: var(--text-primary);
                background: var(--bg-2);
            }
            .list-header-col.sort-active {
                color: var(--accent-primary);
                font-weight: 600;
            }
            .list-header-col .sort-icon {
                font-size: 14px;
                opacity: 0;
                transition: var(--transition-fast);
            }
            .list-header-col.sort-active .sort-icon {
                opacity: 1;
            }
            .list-header-col.sort-desc .sort-icon {
                transform: rotate(180deg);
            }
            .list-header-col[data-sort="name"] { flex: 1; }
            .list-header-col[data-sort="tags"] { flex-shrink: 0; }

            /* Tag Filter */
            .tag-filter-container {
                position: relative;
            }
            .tag-filter-btn {
                display: flex;
                align-items: center;
                gap: 4px;
                background: none;
                border: 1px solid var(--bg-3);
                color: var(--text-secondary);
                cursor: pointer;
                padding: var(--spacing-xs);
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
            }
            .tag-filter-btn:hover {
                color: var(--text-primary);
                background: var(--bg-2);
            }
            .tag-filter-btn.has-filter {
                color: var(--accent-primary);
                border-color: var(--accent-primary);
            }
            .tag-filter-btn .material-icons { font-size: 18px; }
            .tag-filter-btn .filter-count {
                font-size: 10px;
                font-weight: 600;
                background: var(--accent-primary);
                color: var(--bg-0);
                border-radius: 8px;
                padding: 0 5px;
                min-width: 14px;
                text-align: center;
            }
            .tag-filter-dropdown {
                display: none;
                position: absolute;
                top: 100%;
                right: 0;
                margin-top: var(--spacing-xs);
                background: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                box-shadow: var(--shadow-lg);
                min-width: 160px;
                max-height: 250px;
                overflow-y: auto;
                z-index: 100;
            }
            .tag-filter-dropdown.show { display: block; }
            .tag-filter-list {
                padding: var(--spacing-xs);
            }
            .tag-filter-item {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                padding: var(--spacing-xs) var(--spacing-sm);
                cursor: pointer;
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
            }
            .tag-filter-item:hover {
                background: var(--bg-2);
            }
            .tag-filter-item input[type="checkbox"] {
                margin: 0;
            }
            .clear-filter-btn {
                display: block;
                width: 100%;
                padding: var(--spacing-sm);
                background: none;
                border: none;
                border-top: 1px solid var(--bg-3);
                color: var(--accent-danger);
                cursor: pointer;
                font-size: var(--font-size-sm);
            }
            .clear-filter-btn:hover {
                background: var(--bg-2);
            }
            .no-tags {
                padding: var(--spacing-md);
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
                text-align: center;
            }

            .panel-main {
                display: flex;
                flex-direction: column;
                padding: 0;
            }
            .mobile-editor-header {
                display: none; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3); flex-shrink: 0; gap: var(--spacing-md);
            }
            .mobile-editor-header h2 {
                margin: 0; font-size: 1.1rem; flex-grow: 1; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis;
            }
            #back-to-characters-btn {
                background: none; border: none; color: var(--text-secondary);
                cursor: pointer; padding: var(--spacing-xs);
            }
            #back-to-characters-btn:hover { color: var(--text-primary); }
            minerva-character-editor { flex-grow: 1; overflow: hidden; }

            /* ItemList Styles */
            item-list li {
                position: relative; display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast);
                gap: var(--spacing-sm);
            }
            item-list li:hover { background-color: var(--bg-2); }
            item-list li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            item-list li.selected .item-name { font-weight: 600; }
            item-list li.user-persona::before {
                content: 'User'; position: absolute; top: 3px; left: -2px;
                background-color: var(--accent-warn); color: var(--bg-0); font-size: 0.65rem;
                font-weight: 600; padding: 2px 5px; border-radius: var(--radius-sm);
                z-index: 1; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            }
            item-list .avatar {
                width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover;
                flex-shrink: 0; background-color: var(--bg-3);
            }
            item-list .item-info {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            item-list .item-name {
                font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            item-list .item-tags {
                display: flex;
                gap: 4px;
                flex-wrap: wrap;
            }
            item-list .item-tag {
                font-size: 0.65rem;
                padding: 1px 6px;
                background: var(--bg-2);
                border-radius: 8px;
                color: var(--text-secondary);
            }
            item-list li.selected .item-tag {
                background: rgba(255,255,255,0.2);
                color: var(--bg-0);
            }
            item-list .item-tag.more {
                font-style: italic;
            }
            item-list .actions { display: flex; flex-shrink: 0; gap: var(--spacing-xs); }
            item-list .icon-button {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                transition: var(--transition-fast); display: flex; align-items: center;
                justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm);
            }
            item-list li:not(.selected) .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            item-list li.selected .icon-button:hover { color: var(--bg-1); }
            item-list .delete-btn:hover { color: var(--accent-danger); }
            item-list .user-btn.active { color: var(--accent-warn); }
            item-list li.selected .user-btn.active { color: var(--bg-0); }

            /* Group headers */
            .list-group-header {
                font-weight: 600;
                font-size: var(--font-size-sm);
                padding: var(--spacing-sm) var(--spacing-md);
                background: var(--bg-2);
                color: var(--text-secondary);
                border-bottom: 1px solid var(--bg-3);
                position: sticky;
                top: 0;
                z-index: 1;
            }
        `;
    }
}
customElements.define('characters-view', CharactersView);