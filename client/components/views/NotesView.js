// client/components/views/NotesView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../NoteEditor.js'; // Import the new component

class NotesView extends BaseComponent {
    #state = {
        notes: [],
        allCharacters: [],
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
        
        try {
            await api.put(`/api/notes/${note.id}`, note);
            notifier.show({ type: 'good', message: 'Note saved.' });
            this.#setNeedsSave(false);
        } catch (error) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not save note.' });
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
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-editor-header');

        if (isMobile) {
            if (this.#selectedNote) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.#selectedNote.name || 'Edit Note';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
            }
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        this.#editor.note = this.#selectedNote;
        this.#renderNoteList();
    }

    #renderNoteList() {
        if (!this.itemList) return;
        const sortedNotes = [...this.#state.notes].sort((a, b) => a.name.localeCompare(b.name));
        this.itemList.innerHTML = sortedNotes.map(s => {
            const isSelected = this.#selectedNote?.id === s.id;
            return `
                <li data-id="${s.id}" class="${isSelected ? 'selected' : ''}">
                    <div class="item-name">${s.name}</div>
                    <div class="actions">
                        <button class="icon-button delete-btn" data-action="delete" title="Delete"><span class="material-icons">delete</span></button>
                    </div>
                </li>
            `;
        }).join('');
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
                <div class="panel-left">
                    <header id="list-header">
                        <h3>Notes</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="Add New Note">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                    </header>
                    <item-list></item-list>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            .panel-left { flex-direction: column; border-right: none; border-left: 1px solid var(--bg-3); }
            .panel-left header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0; gap: var(--spacing-sm);
            }
            .panel-left header h3 { margin: 0; }
            .header-actions .icon-button {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                transition: var(--transition-fast); display: flex; align-items: center;
                justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm);
            }
            .header-actions .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            
            item-list li {
                display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast); gap: var(--spacing-sm);
            }
            item-list li:hover { background-color: var(--bg-2); }
            item-list li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            item-list li.selected .item-name { font-weight: 600; }
            item-list .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; }
            item-list .actions { display: flex; flex-shrink: 0; gap: var(--spacing-xs); }
            item-list .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; transition: var(--transition-fast); display: flex; align-items: center; justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            item-list li:not(.selected) .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            item-list li.selected .icon-button:hover { color: var(--bg-1); }
            item-list .delete-btn:hover { color: var(--accent-danger); }
            
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