// client/components/NoteEditor.js
import { BaseComponent } from './BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import './common/TextBox.js';

class NoteEditor extends BaseComponent {
    #note = null;
    #allCharacters = [];
    #overrideList = null;

    constructor() {
        super();
        this.render();
    }

    set note(newNote) {
        this.#note = newNote;
        this.#updateView();
    }
    get note() { return this.#note; }

    set allCharacters(characters) {
        this.#allCharacters = characters;
        // No need to re-render the whole view, just the overrides list if it's visible.
        if (this.isConnected && this.#note) {
            this.#renderOverridesList();
        }
    }
    get allCharacters() { return this.#allCharacters; }
    
    connectedCallback() {
        this.#overrideList = this.shadowRoot.querySelector('#override-list');

        const form = this.shadowRoot.querySelector('form');
        form.addEventListener('submit', this.#onSave.bind(this));

        // This will catch input events from the name, type, description, AND override text boxes
        form.addEventListener('input', () => this.dispatch('change'));

        this.shadowRoot.querySelector('#add-override-btn').addEventListener('click', () => this.#openAddOverrideModal());
        this.#overrideList.addEventListener('click', e => this.#handleOverrideListClick(e));

        // Tag input handlers
        this.shadowRoot.querySelector('#note-tags-input').addEventListener('keydown', this.#handleTagInput.bind(this));
        this.shadowRoot.querySelector('#note-tags-container').addEventListener('click', this.#handleTagRemove.bind(this));

        this.#updateView();
    }

    #onSave(event) {
        event.preventDefault();
        const overrides = {};
        this.shadowRoot.querySelectorAll('.override-item').forEach(itemEl => {
            const charId = itemEl.dataset.characterId;
            const text = itemEl.querySelector('text-box').value;
            overrides[charId] = text;
        });

        const noteData = {
            ...this.#note,
            name: this.shadowRoot.querySelector('#note-name-input').value,
            describes: this.shadowRoot.querySelector('#note-type-input').value,
            description: this.shadowRoot.querySelector('#description-input').value,
            characterOverrides: overrides,
            tags: this.#note?.tags || [],
        };

        this.dispatch('note-save', { note: noteData });
    }

    #openAddOverrideModal() {
        if (!this.#note) return;
        const currentOverrideIds = Object.keys(this.#note.characterOverrides || {});
        const charactersToAdd = this.#allCharacters.filter(c => !currentOverrideIds.includes(c.id));
        
        const content = document.createElement('div');
        const list = document.createElement('item-list');
        
        // Add styles for the modal's item list
        const style = document.createElement('style');
        style.textContent = `
            #override-modal-list .avatar { width: 32px; height: 32px; border-radius: var(--radius-sm); }
            #override-modal-list li { display: flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm); cursor: pointer; }
            #override-modal-list li:hover { background-color: var(--bg-2); }
        `;
        content.appendChild(style);

        list.id = 'override-modal-list';
        list.innerHTML = charactersToAdd.map(char => `
            <li data-id="${char.id}">
                <img class="avatar" src="${char.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${char.name}'s avatar">
                <div class="item-name">${char.name}</div>
            </li>
        `).join('');
        
        list.addEventListener('item-action', e => {
            const charId = e.detail.id;
            if (!this.#note.characterOverrides) {
                this.#note.characterOverrides = {};
            }
            this.#note.characterOverrides[charId] = '';
            this.#renderOverridesList();
            this.dispatch('change');
            modal.hide();
        });

        content.appendChild(list);
        modal.show({
            title: 'Add Character-Specific Info', // Changed title
            content,
            buttons: [{ label: 'Cancel', className: 'button-secondary', onClick: () => modal.hide() }]
        });
    }

    #handleOverrideListClick(event) {
        const deleteBtn = event.target.closest('.delete-override-btn');
        if (deleteBtn) {
            const charId = deleteBtn.dataset.characterId;
            delete this.#note.characterOverrides[charId];
            this.#renderOverridesList();
            this.dispatch('change');
        }
    }

    #handleTagInput(event) {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const input = event.target;
            const tag = input.value.trim().toLowerCase().replace(',', '');
            if (tag && !this.#note.tags?.includes(tag)) {
                if (!this.#note.tags) this.#note.tags = [];
                this.#note.tags.push(tag);
                this.#renderTags();
                this.dispatch('change');
            }
            input.value = '';
        }
    }

    #handleTagRemove(event) {
        const removeBtn = event.target.closest('.remove-tag');
        if (removeBtn) {
            const tag = removeBtn.dataset.tag;
            this.#note.tags = this.#note.tags.filter(t => t !== tag);
            this.#renderTags();
            this.dispatch('change');
        }
    }

    #renderTags() {
        const container = this.shadowRoot.querySelector('#note-tags-container');
        const input = this.shadowRoot.querySelector('#note-tags-input');
        const tags = this.#note?.tags || [];

        // Remove existing chips
        container.querySelectorAll('.tag-chip').forEach(el => el.remove());

        // Add chip for each tag
        tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.innerHTML = `${tag}<button type="button" class="remove-tag" data-tag="${tag}">&times;</button>`;
            container.insertBefore(chip, input);
        });
    }

    #renderOverridesList() {
        const overrides = this.#note?.characterOverrides || {};

        if (Object.keys(overrides).length === 0) {
            this.#overrideList.innerHTML = `<p class="field-description">No character-specific info defined.</p>`; // Changed text
            return;
        }

        this.#overrideList.innerHTML = Object.entries(overrides).map(([charId, text]) => {
            const character = this.#allCharacters.find(c => c.id === charId);
            if (!character) return '';
            return `
                <div class="override-item" data-character-id="${charId}">
                    <img src="${character.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${character.name}'s avatar" class="avatar">
                    <div class="override-item-main">
                        <span class="char-name">${character.name}</span>
                        <text-box>${text}</text-box>
                    </div>
                    <button type="button" class="icon-button delete-override-btn" data-character-id="${charId}" title="Remove Override">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            `;
        }).join('');
    }
    
    #updateView() {
        const formWrapper = this.shadowRoot.querySelector('.form-wrapper');
        const placeholder = this.shadowRoot.querySelector('.placeholder');

        if (!this.#note) {
            formWrapper.style.display = 'none';
            placeholder.style.display = 'flex';
        } else {
            formWrapper.style.display = 'flex';
            placeholder.style.display = 'none';
            this.shadowRoot.querySelector('#note-name-input').value = this.#note.name || '';
            this.shadowRoot.querySelector('#note-type-input').value = this.#note.describes || '';
            this.shadowRoot.querySelector('#description-input').value = this.#note.description || '';
            this.#renderOverridesList();
            this.#renderTags();
        }
    }

    render() {
        super._initShadow(`
            <div class="placeholder"><h2>Select a note to begin editing.</h2></div>
            <form id="editor-form" class="form-wrapper">
                <header class="editor-header">
                    <div class="editor-header-main">
                        <input type="text" id="note-name-input" class="editor-title-input" placeholder="Note Name">
                        <div class="form-group-inline">
                            <label for="note-type-input">Type</label>
                            <input type="text" id="note-type-input" placeholder="e.g., Output Formatting" class="type-input">
                        </div>
                        <div class="form-group-inline">
                            <label>Tags</label>
                            <div class="tags-input-container" id="note-tags-container">
                                <input type="text" class="tag-input" id="note-tags-input" placeholder="Add tag...">
                            </div>
                        </div>
                    </div>
                </header>
                <section class="form-section">
                    <h3>General Note Text</h3>
                    <p class="field-description">This text will be inserted when using the "Note" item in a Generation Config.</p>
                    <text-box id="description-input"></text-box>
                </section>
                <section class="form-section">
                    <h3>Character-Specific Info</h3>
                    <p class="field-description">Provide text to be appended to a specific character's description when this note is active in the chat.</p>
                    <div id="override-list"></div>
                    <button type="button" id="add-override-btn" class="button-secondary">Add Character-Specific Info</button>
                </section>
                <button type="submit" class="button-primary">Save Changes</button>
            </form>
        `, this.styles());
    }
    
    styles() {
        return `
            :host {
                display: block;
                height: 100%;
                overflow-y: auto;
                padding: var(--spacing-lg);
            }
            .form-wrapper { 
                display: none; 
                flex-direction: column; 
                gap: var(--spacing-lg);
            }
            .placeholder { text-align: center; height: 100%; display: flex; align-items: center; justify-content: center; flex-grow: 1; color: var(--text-secondary); }
            
            .editor-header { display: flex; justify-content: space-between; align-items: center; }
            .editor-header-main { flex-grow: 1; display: flex; flex-direction: column; gap: var(--spacing-sm); }
            
            .editor-title-input { font-size: 1.5rem; font-weight: 600; background: none; border: none; outline: none; width: 100%; color: var(--text-primary); padding: 0; }
            .form-group-inline { display: flex; align-items: center; gap: var(--spacing-sm); font-size: var(--font-size-sm); }
            .form-group-inline label { margin: 0; font-weight: 500; color: var(--text-secondary); }
            .type-input {
                flex-grow: 1;
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                color: var(--text-primary);
                padding: var(--spacing-sm);
                font-size: 0.9em;
                transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
            }
            .type-input:focus {
                outline: none;
                border-color: var(--accent-primary);
                box-shadow: 0 0 0 2px var(--accent-primary-faded);
            }

            /* Tags input */
            .tags-input-container {
                display: flex;
                flex-wrap: wrap;
                gap: var(--spacing-xs);
                padding: var(--spacing-xs) var(--spacing-sm);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                background: var(--bg-1);
                flex: 1;
                min-height: 34px;
                align-items: center;
            }
            .tags-input-container:focus-within {
                border-color: var(--accent-primary);
                box-shadow: 0 0 0 2px var(--accent-primary-faded);
            }
            .tag-chip {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                background: var(--accent-primary-faded);
                border-radius: 12px;
                font-size: var(--font-size-sm);
                color: var(--text-primary);
            }
            .tag-chip .remove-tag {
                cursor: pointer;
                background: none;
                border: none;
                color: inherit;
                opacity: 0.7;
                padding: 0;
                font-size: 1rem;
                line-height: 1;
            }
            .tag-chip .remove-tag:hover {
                opacity: 1;
            }
            .tag-input {
                border: none;
                background: transparent;
                flex: 1;
                min-width: 80px;
                outline: none;
                color: var(--text-primary);
                font-size: var(--font-size-sm);
            }

            #editor-form { display: flex; flex-direction: column; gap: var(--spacing-lg); }
            .form-section { margin-bottom: var(--spacing-lg); }
            .field-description { font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: var(--spacing-xs); margin-bottom: var(--spacing-sm); }
            
            #override-list { display: flex; flex-direction: column; gap: var(--spacing-md); margin-bottom: var(--spacing-md); }
            .override-item { display: flex; gap: var(--spacing-md); align-items: flex-start; background: var(--bg-0); padding: var(--spacing-md); border-radius: var(--radius-sm); }
            .override-item .avatar { width: 50px; height: 50px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; }
            .override-item-main { flex-grow: 1; display: flex; flex-direction: column; gap: var(--spacing-sm); }
            .override-item-main .char-name { font-weight: 600; }
            .override-item .delete-override-btn { color: var(--text-secondary); align-self: center; background: none; border: none; cursor: pointer; }
            .override-item .delete-override-btn:hover { color: var(--accent-danger); }

            #add-override-btn {
                margin-top: var(--spacing-sm);
            }

            text-box {
                resize: vertical;
                padding: 0.75rem;
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                color: var(--text-primary);
                font-size: var(--font-size-md);
            }
            text-box:focus-within {
                outline: none;
                border-color: var(--accent-primary);
                box-shadow: 0 0 0 2px var(--accent-primary-faded, rgba(138, 180, 248, 0.3));
                transition: var(--transition-fast);
            }
            #description-input {
                min-height: 150px;
            }
            .override-item-main text-box {
                min-height: 80px;
            }

            button[type="submit"] {
                align-self: flex-start;
            }
        `;
    }
}
customElements.define('minerva-note-editor', NoteEditor);