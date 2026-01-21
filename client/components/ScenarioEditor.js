import { BaseComponent } from './BaseComponent.js';
import { api, modal, notifier } from '../client.js';
import './common/TextBox.js';
import './ItemList.js';

class ScenarioEditor extends BaseComponent {
    #scenario = null;
    #allCharacters = [];
    #allNotes = [];

    constructor() {
        super();
        this.render();
    }

    set scenario(value) {
        this.#scenario = value;
        this.#updateView();
    }
    get scenario() { return this.#scenario; }

    set allCharacters(value) { this.#allCharacters = value; }
    set allNotes(value) { this.#allNotes = value; }

    connectedCallback() {
        const form = this.shadowRoot.querySelector('form');
        form.addEventListener('submit', this.onSave.bind(this));

        // Image uploads
        this.shadowRoot.querySelector('#scenario-avatar-upload').addEventListener('change', (e) => this.onImageUpload(e, 'avatar'));
        this.shadowRoot.querySelector('#scenario-banner-upload').addEventListener('change', (e) => this.onImageUpload(e, 'banner'));

        // List managers
        this.shadowRoot.querySelector('#add-participant-btn').addEventListener('click', () => this.openAddModal('character'));
        this.shadowRoot.querySelector('#add-note-btn').addEventListener('click', () => this.openAddModal('note'));

        this.shadowRoot.querySelector('#participant-list').addEventListener('item-action', (e) => this.handleListAction(e, 'participants'));
        this.shadowRoot.querySelector('#note-list').addEventListener('item-action', (e) => this.handleListAction(e, 'notes'));

        this.shadowRoot.querySelector('#start-chat-btn').addEventListener('click', this.onStartChat.bind(this));

        // Tag input handlers
        this.shadowRoot.querySelector('#scenario-tags-input').addEventListener('keydown', this.#handleTagInput.bind(this));
        this.shadowRoot.querySelector('#scenario-tags-container').addEventListener('click', this.#handleTagRemove.bind(this));
    }

    async onSave(event) {
        event.preventDefault();
        if (!this.#scenario) return;

        const updatedScenario = {
            ...this.#scenario,
            name: this.shadowRoot.querySelector('#scenario-name-input').value,
            description: this.shadowRoot.querySelector('#scenario-description-input').value,
            firstMessage: this.shadowRoot.querySelector('#scenario-first-message-input').value,
            tags: this.#scenario?.tags || [],
        };

        this.dispatch('scenario-save', { scenario: updatedScenario });
    }

    async onImageUpload(event, type) {
        if (!this.#scenario || !event.target.files.length) return;
        const file = event.target.files[0];
        const formData = new FormData();
        // IMPORTANT: Append type BEFORE image so multer can read it in diskStorage destination/filename functions
        formData.append('type', type);
        formData.append('image', file);

        try {
            const updatedScenario = await api.post(`/api/scenarios/${this.#scenario.id}/image`, formData);
            this.dispatch('scenario-save', { scenario: updatedScenario, isImageUpdate: true });
        } catch (error) {
            console.error(`Failed to upload ${type}:`, error);
            notifier.show({ type: 'bad', header: 'Error', message: `Failed to upload ${type}.` });
        }
    }

    onStartChat() {
        if (!this.#scenario) return;
        this.dispatch('start-chat', { scenario: this.#scenario });
    }

    handleListAction(event, listType) {
        const { id, action } = event.detail;
        if (action === 'delete') {
            this.#scenario[listType] = this.#scenario[listType].filter(itemId => itemId !== id);
            this.onSave(new Event('submit')); // Trigger auto-save
            this.#renderLists();
        }
    }

    #handleTagInput(event) {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const input = event.target;
            const tag = input.value.trim().toLowerCase().replace(',', '');
            if (tag && !this.#scenario.tags?.includes(tag)) {
                if (!this.#scenario.tags) this.#scenario.tags = [];
                this.#scenario.tags.push(tag);
                this.#renderTags();
            }
            input.value = '';
        }
    }

    #handleTagRemove(event) {
        const removeBtn = event.target.closest('.remove-tag');
        if (removeBtn) {
            const tag = removeBtn.dataset.tag;
            this.#scenario.tags = this.#scenario.tags.filter(t => t !== tag);
            this.#renderTags();
        }
    }

    #renderTags() {
        const container = this.shadowRoot.querySelector('#scenario-tags-container');
        const input = this.shadowRoot.querySelector('#scenario-tags-input');
        const tags = this.#scenario?.tags || [];

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

    openAddModal(type) {
        const content = document.createElement('div');
        const list = document.createElement('item-list');
        const items = type === 'character' ? this.#allCharacters : this.#allNotes;
        const currentIds = type === 'character' ? this.#scenario.participants : this.#scenario.notes;
        
        // Filter out items already in the scenario
        const availableItems = items.filter(item => !currentIds.includes(item.id));

        list.innerHTML = availableItems.map(item => `
            <li data-id="${item.id}" data-action="add">
                <div class="modal-list-item" style="display: flex; align-items: center; gap: 10px; padding: 5px;">
                    ${type === 'character' ? `<img src="${item.avatarUrl || 'assets/images/default_avatar.svg'}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;">` : ''}
                    <span>${item.name}</span>
                </div>
            </li>
        `).join('');

        list.addEventListener('item-action', (e) => {
            const id = e.detail.id;
            if (type === 'character') {
                this.#scenario.participants.push(id);
            } else {
                this.#scenario.notes.push(id);
            }
            this.onSave(new Event('submit')); // Auto-save
            this.#renderLists();
            modal.hide();
        });

        content.appendChild(list);
        
        modal.show({
            title: `Add ${type === 'character' ? 'Character' : 'Note'}`,
            content,
            buttons: [{ label: 'Cancel', className: 'button-secondary', onClick: () => modal.hide() }]
        });
    }

    #updateView() {
        const formWrapper = this.shadowRoot.querySelector('.form-wrapper');
        const placeholder = this.shadowRoot.querySelector('.placeholder');
        
        if (!this.#scenario) {
            formWrapper.style.display = 'none';
            placeholder.style.display = 'flex';
            return;
        }

        formWrapper.style.display = 'flex';
        placeholder.style.display = 'none';

        this.shadowRoot.querySelector('#scenario-name-input').value = this.#scenario.name || '';
        this.shadowRoot.querySelector('#scenario-description-input').value = this.#scenario.description || '';
        this.shadowRoot.querySelector('#scenario-first-message-input').value = this.#scenario.firstMessage || '';

        const avatarImg = this.shadowRoot.querySelector('#avatar-preview');
        avatarImg.src = this.#scenario.avatarUrl || 'assets/images/default_avatar.svg';

        const bannerImg = this.shadowRoot.querySelector('#banner-preview');
        if (this.#scenario.bannerUrl) {
            bannerImg.src = this.#scenario.bannerUrl;
            bannerImg.style.display = 'block';
        } else {
            bannerImg.style.display = 'none';
        }

        this.#renderLists();
        this.#renderTags();
    }

    #renderLists() {
        const partList = this.shadowRoot.querySelector('#participant-list');
        const noteList = this.shadowRoot.querySelector('#note-list');

        partList.innerHTML = this.#scenario.participants.map(id => {
            const char = this.#allCharacters.find(c => c.id === id);
            if (!char) return '';
            return `
                <li data-id="${id}">
                    <div class="list-item">
                        <img src="${char.avatarUrl || 'assets/images/default_avatar.svg'}" class="list-avatar">
                        <span class="list-name">${char.name}</span>
                        <button class="icon-button delete-btn" data-action="delete"><span class="material-icons">close</span></button>
                    </div>
                </li>
            `;
        }).join('');

        noteList.innerHTML = this.#scenario.notes.map(id => {
            const note = this.#allNotes.find(n => n.id === id);
            if (!note) return '';
            return `
                <li data-id="${id}">
                    <div class="list-item">
                        <span class="list-name">${note.name}</span>
                        <button class="icon-button delete-btn" data-action="delete"><span class="material-icons">close</span></button>
                    </div>
                </li>
            `;
        }).join('');
    }

    render() {
        super._initShadow(`
            <div class="placeholder"><h2>Select a scenario to edit.</h2></div>
            <div class="form-wrapper">
                <form>
                    <div class="editor-header">
                        <div class="banner-container">
                            <img id="banner-preview" class="banner-preview" alt="Banner">
                            <label for="scenario-banner-upload" class="banner-upload-btn button-secondary">
                                <span class="material-icons">upload</span> Upload Banner
                            </label>
                            <input type="file" id="scenario-banner-upload" hidden accept="image/*">
                        </div>
                        
                        <div class="header-main">
                            <label for="scenario-avatar-upload" class="avatar-label" title="Upload Avatar">
                                <img id="avatar-preview" class="avatar-preview" src="assets/images/default_avatar.svg">
                                <div class="avatar-overlay"><span class="material-icons">upload</span></div>
                            </label>
                            <input type="file" id="scenario-avatar-upload" hidden accept="image/*">
                            
                            <div class="title-container">
                                <input type="text" id="scenario-name-input" class="editor-title" placeholder="Scenario Name">
                                <button type="button" id="start-chat-btn" class="button-primary start-btn" title="Create a new chat from this scenario">
                                    <span class="material-icons">play_arrow</span> Start Chat
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="form-section">
                        <label>Tags</label>
                        <p class="field-description">Add tags to organize and filter scenarios. Press Enter or comma to add.</p>
                        <div class="tags-input-container" id="scenario-tags-container">
                            <input type="text" class="tag-input" id="scenario-tags-input" placeholder="Add tag...">
                        </div>
                    </div>

                    <div class="form-section">
                        <label>Description</label>
                        <text-box id="scenario-description-input" placeholder="A brief description of this scenario..."></text-box>
                    </div>

                    <div class="form-section">
                        <label>First Message</label>
                        <text-box id="scenario-first-message-input" placeholder="The opening message of the chat..."></text-box>
                    </div>

                    <div class="split-section">
                        <div class="list-container">
                            <div class="list-header">
                                <label>Participants</label>
                                <button type="button" id="add-participant-btn" class="icon-button"><span class="material-icons">add</span></button>
                            </div>
                            <item-list id="participant-list"></item-list>
                        </div>
                        <div class="list-container">
                            <div class="list-header">
                                <label>Notes</label>
                                <button type="button" id="add-note-btn" class="icon-button"><span class="material-icons">add</span></button>
                            </div>
                            <item-list id="note-list"></item-list>
                        </div>
                    </div>

                    <div class="actions">
                        <button type="submit" class="button-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            :host { display: block; height: 100%; overflow-y: auto; }
            .placeholder { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
            .form-wrapper { display: none; padding: var(--spacing-lg); flex-direction: column; }
            form { display: flex; flex-direction: column; gap: var(--spacing-lg); width: 100%; max-width: 800px; margin: 0 auto; }
            
            .editor-header { display: flex; flex-direction: column; gap: var(--spacing-md); }
            .banner-container { position: relative; width: 100%; height: 150px; background-color: var(--bg-0); border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--bg-3); }
            .banner-preview { width: 100%; height: 100%; object-fit: cover; display: none; }
            .banner-upload-btn { position: absolute; bottom: var(--spacing-sm); right: var(--spacing-sm); font-size: 0.8rem; padding: 4px 8px; display: flex; align-items: center; gap: 4px; }
            
            .header-main { display: flex; align-items: flex-end; gap: var(--spacing-lg); margin-top: -40px; padding-left: var(--spacing-md); position: relative; }
            
            .avatar-label { position: relative; cursor: pointer; flex-shrink: 0; width: 80px; height: 80px; }
            .avatar-preview { width: 100%; height: 100%; border-radius: var(--radius-md); object-fit: cover; background-color: var(--bg-1); border: 2px solid var(--bg-3); box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
            .avatar-overlay { position: absolute; inset: 0; background-color: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; border-radius: var(--radius-md); color: white; }
            .avatar-label:hover .avatar-overlay { opacity: 1; }

            .title-container { flex-grow: 1; display: flex; align-items: center; gap: var(--spacing-md); padding-bottom: var(--spacing-xs); }
            .editor-title { font-size: 1.5rem; font-weight: 600; background: transparent; border: none; outline: none; color: var(--text-primary); flex-grow: 1; border-bottom: 1px solid transparent; transition: border-color 0.2s; }
            .editor-title:focus { border-bottom-color: var(--accent-primary); }
            
            .start-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background-color: var(--accent-good); color: var(--bg-0); }
            .start-btn:hover { filter: brightness(1.1); }

            .form-section { display: flex; flex-direction: column; gap: var(--spacing-sm); }
            .form-section label { font-weight: 600; color: var(--text-secondary); font-size: 0.9rem; }
            .field-description { font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0; }

            /* Tags input */
            .tags-input-container {
                display: flex;
                flex-wrap: wrap;
                gap: var(--spacing-xs);
                padding: var(--spacing-sm);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                background: var(--bg-0);
                min-height: 40px;
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
            
            .split-section { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-lg); }
            .list-container { background-color: var(--bg-0); border-radius: var(--radius-sm); border: 1px solid var(--bg-3); padding: var(--spacing-sm); }
            .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm); border-bottom: 1px solid var(--bg-3); padding-bottom: 4px; }
            .list-header label { font-weight: 600; font-size: 0.85rem; color: var(--text-secondary); }
            
            .list-item { display: flex; align-items: center; gap: 8px; padding: 4px; border-radius: var(--radius-sm); }
            .list-item:hover { background-color: var(--bg-2); }
            .list-avatar { width: 24px; height: 24px; border-radius: 4px; object-fit: cover; }
            .list-name { flex-grow: 1; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .delete-btn { color: var(--text-secondary); padding: 2px; }
            .delete-btn:hover { color: var(--accent-danger); background: none; }

            text-box { min-height: 100px; padding: 8px; background-color: var(--bg-0); border-radius: var(--radius-sm); border: 1px solid var(--bg-3); }
            
            @media (max-width: 768px) {
                .split-section { grid-template-columns: 1fr; }
                .title-container { flex-direction: column; align-items: stretch; gap: var(--spacing-sm); }
            }
        `;
    }
}

customElements.define('scenario-editor', ScenarioEditor);