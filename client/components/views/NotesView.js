// client/components/views/NotesView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../NoteEditor.js'; // Import the new component

class NotesView extends BaseComponent {
    #state = {
        notes: [],
        allCharacters: [],
        sortMode: 'name-asc', // 'name-asc', 'name-desc', 'tag-group'
        selectedFilterTags: [], // Tags to filter by (OR logic)
    };

    #selectedNote = null;
    #needsSave = false;
    #pendingSelectedId = null;
    #editor = null;

    constructor() {
        super();
        this.handleBackToNotes = this.handleBackToNotes.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this.onSave = this.onSave.bind(this);
        this.handleColumnHeaderClick = this.handleColumnHeaderClick.bind(this);
        this.handleTagFilterClick = this.handleTagFilterClick.bind(this);
        this._hasAutoSelectedFirst = false; // Track if we've auto-selected the first item
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');
        this.#editor = this.shadowRoot.querySelector('minerva-note-editor');

        // Listeners
        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', e => {
            if (e.target.closest('[data-action="add"]')) this.handleNoteAdd();
        });
        this.shadowRoot.querySelector('#back-to-notes-btn').addEventListener('click', this.handleBackToNotes);
        this.shadowRoot.querySelector('.list-header-row').addEventListener('click', this.handleColumnHeaderClick);
        this.shadowRoot.querySelector('.tag-filter-container').addEventListener('click', this.handleTagFilterClick);

        this.shadowRoot.querySelector('#save-note-btn').addEventListener('click', () => this.#editor.shadowRoot.querySelector('form').requestSubmit());
        this.#editor.addEventListener('note-save', this.onSave);
        this.#editor.addEventListener('change', () => this.#setNeedsSave(true));

        window.addEventListener('minerva-resource-changed', this.handleResourceChange);

        await this.fetchData();
        this.#setNeedsSave(false);
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
        this.itemList.removeEventListener('item-action', this.handleItemAction);
    }
    
    setInitialState({ selectedNoteId }) {
        if (!selectedNoteId) return;
        this._pendingSelectedId = selectedNoteId;
    }

    async fetchData() {
        try {
            const [notes, characters] = await Promise.all([
                api.get('/api/notes'),
                api.get('/api/characters')
            ]);
            this.#state.notes = notes;
            this.#state.allCharacters = characters;
            this.#editor.allCharacters = characters;
            
            if (this._pendingSelectedId) {
                const noteToSelect = this.#state.notes.find(s => s.id === this._pendingSelectedId);
                if (noteToSelect) {
                    this.#performSelection(noteToSelect);
                }
                this._pendingSelectedId = null;
            }

            this.#updateView();
        } catch (error) {
            console.error("Failed to fetch note data:", error);
            notifier.show({ header: 'Error', message: 'Could not load note data.' });
        }
    }
    
    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;

        if (resourceType === 'character') {
            // Just update the character list in the editor if it changes
            api.get('/api/characters').then(chars => {
                this.#state.allCharacters = chars;
                this.#editor.allCharacters = chars;
            });
            return;
        }

        if (resourceType === 'note') {
            let stateChanged = false;
            let selectedNoteWasDeleted = false;
            
            switch (eventType) {
                case 'create':
                    if (!this.#state.notes.some(s => s.id === data.id)) {
                        this.#state.notes.push(data);
                    }
                    this.#selectedNote = JSON.parse(JSON.stringify(data));
                    this.#setNeedsSave(false);
                    stateChanged = true;
                    break;
                case 'update': {
                    const index = this.#state.notes.findIndex(s => s.id === data.id);
                    if (index > -1) {
                        this.#state.notes[index] = data;
                        if (this.#selectedNote?.id === data.id) {
                            this.#selectedNote = JSON.parse(JSON.stringify(data));
                            this.#setNeedsSave(false);
                        }
                        stateChanged = true;
                    }
                    break;
                }
                case 'delete': {
                    const initialLength = this.#state.notes.length;
                    if (this.#selectedNote?.id === data.id) {
                        this.#selectedNote = null;
                        selectedNoteWasDeleted = true;
                    }
                    this.#state.notes = this.#state.notes.filter(s => s.id !== data.id);
                    if (this.#state.notes.length < initialLength) {
                        stateChanged = true;
                    }
                    break;
                }
            }
            if (stateChanged) {
                const hasFocus = this.#editor.shadowRoot.activeElement;
                if (hasFocus && !selectedNoteWasDeleted) {
                    this.#renderNoteList();
                } else {
                    this.#updateView();
                }
            }
        }
    }

    handleItemAction(event) {
        const { id, action } = event.detail;
        const note = this.#state.notes.find(s => s.id === id);
        if (!note) return;

        switch(action) {
            case 'select':
                this.handleNoteSelect(note);
                break;
            case 'delete':
                this.handleNoteDelete(note);
                break;
        }
    }

    handleColumnHeaderClick(event) {
        const col = event.target.closest('.list-header-col');
        if (!col) return;

        const sortBy = col.dataset.sort;
        if (!sortBy) return;

        if (sortBy === 'name') {
            if (this.#state.sortMode === 'name-asc') {
                this.#state.sortMode = 'name-desc';
            } else {
                this.#state.sortMode = 'name-asc';
            }
        } else if (sortBy === 'tags') {
            this.#state.sortMode = 'tag-group';
        }

        this.#updateSortIndicators();
        this.#renderNoteList();
    }

    handleTagFilterClick(event) {
        const btn = event.target.closest('.tag-filter-btn');
        const dropdown = this.shadowRoot.querySelector('.tag-filter-dropdown');
        const checkbox = event.target.closest('input[type="checkbox"]');
        const clearBtn = event.target.closest('.clear-filter-btn');

        if (btn) {
            dropdown.classList.toggle('show');
            this.#renderTagFilterDropdown();
        } else if (checkbox) {
            const tag = checkbox.value;
            if (checkbox.checked) {
                if (!this.#state.selectedFilterTags.includes(tag)) {
                    this.#state.selectedFilterTags.push(tag);
                }
            } else {
                this.#state.selectedFilterTags = this.#state.selectedFilterTags.filter(t => t !== tag);
            }
            this.#updateFilterBtnState();
            this.#renderNoteList();
        } else if (clearBtn) {
            this.#state.selectedFilterTags = [];
            this.#renderTagFilterDropdown();
            this.#updateFilterBtnState();
            this.#renderNoteList();
        } else if (!event.target.closest('.tag-filter-dropdown')) {
            dropdown.classList.remove('show');
        }
    }

    #updateSortIndicators() {
        const nameCol = this.shadowRoot.querySelector('.list-header-col[data-sort="name"]');
        const tagsCol = this.shadowRoot.querySelector('.list-header-col[data-sort="tags"]');

        nameCol.classList.remove('sort-asc', 'sort-desc', 'sort-active');
        tagsCol.classList.remove('sort-active');

        if (this.#state.sortMode === 'name-asc') {
            nameCol.classList.add('sort-asc', 'sort-active');
        } else if (this.#state.sortMode === 'name-desc') {
            nameCol.classList.add('sort-desc', 'sort-active');
        } else if (this.#state.sortMode === 'tag-group') {
            tagsCol.classList.add('sort-active');
        }
    }

    #updateFilterBtnState() {
        const btn = this.shadowRoot.querySelector('.tag-filter-btn');
        const count = this.#state.selectedFilterTags.length;
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
        for (const note of this.#state.notes) {
            if (note.tags && Array.isArray(note.tags)) {
                note.tags.forEach(tag => tagsSet.add(tag));
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
                        <input type="checkbox" value="${tag}" ${this.#state.selectedFilterTags.includes(tag) ? 'checked' : ''}>
                        <span>${tag}</span>
                    </label>
                `).join('')}
            </div>
            ${this.#state.selectedFilterTags.length > 0 ? '<button class="clear-filter-btn">Clear filters</button>' : ''}
        `;
    }

    handleNoteSelect(item) {
        if (this.#selectedNote?.id === item.id) return;

        if (this.#needsSave) {
            modal.confirm({
                title: 'Unsaved Changes',
                content: 'You have unsaved changes that will be lost. Are you sure you want to continue?',
                confirmLabel: 'Discard Changes',
                confirmButtonClass: 'button-danger',
                onConfirm: () => this.#performSelection(item)
            });
        } else {
            this.#performSelection(item);
        }
    }

    #performSelection(item) {
        this.#selectedNote = JSON.parse(JSON.stringify(item));
        this.#setNeedsSave(false);
        this.#updateView();
    }

    async handleNoteAdd() {
        try {
            await api.post('/api/notes', { name: 'New Note', description: '' });
            notifier.show({ message: 'New note created.' });
        } catch (error) {
            console.error('Failed to add note:', error);
            notifier.show({ header: 'Error', message: 'Failed to create a new note.' });
        }
    }
    
    handleNoteDelete(item) {
        modal.confirm({
            title: 'Delete Note',
            content: `Are you sure you want to delete "${item.name}"? This will also remove it from any chats that use it.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/notes/${item.id}`);
                    notifier.show({ header: 'Note Deleted', message: `"${item.name}" was removed.` });
                } catch (error) {
                    notifier.show({ header: 'Error', message: `Failed to delete "${item.name}".` });
                }
            }
        });
    }

    async onSave(event) {
        if (!this.#selectedNote || !this.#needsSave) return;
        const { note } = event.detail;
        const originalId = this.#selectedNote.id;

        try {
            const updatedNote = await api.put(`/api/notes/${originalId}`, note);
            notifier.show({ type: 'good', message: 'Note saved.' });
            this.#setNeedsSave(false);

            // If ID changed, update selection
            if (updatedNote.id !== originalId) {
                this.#selectedNote = updatedNote;
                this.updateView();
            }
        } catch (error) {
            notifier.show({ type: 'bad', header: 'Error', message: error.message || 'Could not save note.' });
        }
    }
    
    handleBackToNotes() {
        if (this.#needsSave) {
            modal.confirm({
                title: 'Unsaved Changes',
                content: 'You have unsaved changes. Are you sure you want to discard them?',
                confirmLabel: 'Discard Changes',
                confirmButtonClass: 'button-danger',
                onConfirm: () => {
                    this.#selectedNote = null;
                    this.#setNeedsSave(false);
                    this.#updateView();
                }
            });
        } else {
            this.#selectedNote = null;
            this.#updateView();
        }
    }
    
    #setNeedsSave(needsSave) {
        this.#needsSave = needsSave;
        const saveIndicator = this.shadowRoot.querySelector('.save-indicator');
        const saveButton = this.shadowRoot.querySelector('#save-note-btn');
        if (saveIndicator) {
            saveIndicator.style.opacity = needsSave ? '1' : '0';
        }
        if (saveButton) {
            saveButton.disabled = !needsSave;
        }
    }

    #updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelRightSidebar = this.shadowRoot.querySelector('.panel-right-sidebar');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-editor-header');

        if (isMobile) {
            if (this.#selectedNote) {
                panelRightSidebar.style.display = 'none';
                panelMain.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.#selectedNote.name || 'Edit Note';
            } else {
                panelRightSidebar.style.display = 'flex';
                panelMain.style.display = 'none';
            }
        } else {
            panelRightSidebar.style.display = 'flex';
            panelMain.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        this.#editor.note = this.#selectedNote;
        this.#renderNoteList();
    }

    #renderNoteList() {
        if (!this.itemList) return;

        // Filter notes
        let filtered = this.#state.notes;
        if (this.#state.selectedFilterTags.length > 0) {
            filtered = filtered.filter(note => {
                if (!note.tags || note.tags.length === 0) return false;
                return this.#state.selectedFilterTags.some(tag => note.tags.includes(tag));
            });
        }

        // Sort/group notes
        let html = '';
        if (this.#state.sortMode === 'tag-group') {
            html = this.#renderGroupedByTag(filtered);
        } else {
            const sorted = [...filtered].sort((a, b) => {
                const cmp = a.name.localeCompare(b.name);
                return this.#state.sortMode === 'name-desc' ? -cmp : cmp;
            });
            html = sorted.map(note => this.#renderNoteItem(note)).join('');
        }

        this.itemList.innerHTML = html;
    }

    #renderGroupedByTag(notes) {
        const groups = new Map();
        const untagged = [];

        for (const note of notes) {
            if (note.tags && note.tags.length > 0) {
                const firstTag = note.tags[0];
                if (!groups.has(firstTag)) {
                    groups.set(firstTag, []);
                }
                groups.get(firstTag).push(note);
            } else {
                untagged.push(note);
            }
        }

        const sortedGroupNames = Array.from(groups.keys()).sort();

        let html = '';
        for (const groupName of sortedGroupNames) {
            const groupNotes = groups.get(groupName).sort((a, b) => a.name.localeCompare(b.name));
            html += `<div class="list-group-header">${groupName}</div>`;
            html += groupNotes.map(note => this.#renderNoteItem(note)).join('');
        }

        if (untagged.length > 0) {
            untagged.sort((a, b) => a.name.localeCompare(b.name));
            html += `<div class="list-group-header">Untagged</div>`;
            html += untagged.map(note => this.#renderNoteItem(note)).join('');
        }

        return html;
    }

    #renderNoteItem(note) {
        const isSelected = this.#selectedNote?.id === note.id;
        const tags = note.tags || [];
        const displayTags = tags.slice(0, 2);
        const moreTags = tags.length > 2 ? tags.length - 2 : 0;
        const tagsHtml = displayTags.length > 0
            ? `<div class="item-tags">${displayTags.map(t => `<span class="item-tag">${t}</span>`).join('')}${moreTags > 0 ? `<span class="item-tag more">+${moreTags}</span>` : ''}</div>`
            : '';

        return `
            <li data-id="${note.id}" class="${isSelected ? 'selected' : ''}">
                <div class="item-info">
                    <div class="item-name">${note.name}</div>
                    ${tagsHtml}
                </div>
                <div class="actions">
                    <button class="icon-button delete-btn" data-action="delete" title="Delete"><span class="material-icons">delete</span></button>
                </div>
            </li>
        `;
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-notes-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <div class="editor-container">
                        <header class="main-editor-header">
                             <div class="header-controls">
                                <span class="save-indicator">Unsaved changes</span>
                                <button type="button" id="save-note-btn" class="button-primary" disabled>Save</button>
                            </div>
                        </header>
                        <minerva-note-editor></minerva-note-editor>
                    </div>
                </div>
                <div class="panel-right-sidebar">
                    <header id="list-header">
                        <h3>Notes</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="Add New Note">
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
            .panel-right-sidebar { flex-direction: column; }
            .panel-right-sidebar header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0; gap: var(--spacing-sm);
            }
            .panel-right-sidebar header h3 { margin: 0; }
            .header-actions .icon-button {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                transition: var(--transition-fast); display: flex; align-items: center;
                justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm);
            }
            .header-actions .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }

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

            item-list li {
                display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast); gap: var(--spacing-sm);
            }
            item-list li:hover { background-color: var(--bg-2); }
            item-list li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            item-list li.selected .item-name { font-weight: 600; }
            item-list .item-info {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            item-list .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
            item-list .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; transition: var(--transition-fast); display: flex; align-items: center; justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            item-list li:not(.selected) .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            item-list li.selected .icon-button:hover { color: var(--bg-1); }
            item-list .delete-btn:hover { color: var(--accent-danger); }

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

            .panel-main { display: flex; flex-direction: column; padding: 0; }
            .mobile-editor-header {
                display: none; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3); flex-shrink: 0; gap: var(--spacing-md);
            }
            .mobile-editor-header h2 { margin: 0; font-size: 1.1rem; flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #back-to-notes-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            #back-to-notes-btn:hover { color: var(--text-primary); }

            .editor-container { padding: var(--spacing-lg); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
            .main-editor-header {
                display: flex;
                justify-content: flex-end;
                padding-bottom: var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
                margin-bottom: var(--spacing-lg);
            }
            .header-controls { display: flex; align-items: center; gap: var(--spacing-md); }
            .save-indicator { font-size: var(--font-size-sm); color: var(--accent-warn); opacity: 0; transition: opacity 0.3s; }
            #save-note-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; opacity: 1; }

            minerva-note-editor {
                flex-grow: 1;
                overflow-y: auto;
            }

            @media (max-width: 768px) {
                .editor-container { padding: var(--spacing-md); }
                .main-editor-header {
                     margin-bottom: var(--spacing-md);
                     padding-bottom: var(--spacing-sm);
                }
            }
        `;
    }
}
customElements.define('notes-view', NotesView);