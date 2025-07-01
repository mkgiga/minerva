import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../TextBox.js';

class StringsView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            strings: [],
            selectedString: null,
        };
        this._pendingSelectedId = null;
        this.handleBackToStrings = this.handleBackToStrings.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');
        this.editorForm = this.shadowRoot.querySelector('#editor-form');

        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', e => {
            if (e.target.closest('[data-action="add"]')) this.handleStringAdd();
        });
        this.editorForm.addEventListener('submit', this.handleStringSave.bind(this));
        this.shadowRoot.querySelector('#back-to-strings-btn').addEventListener('click', this.handleBackToStrings);
        
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);

        await this.fetchData();
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
        this.itemList.removeEventListener('item-action', this.handleItemAction);
    }
    
    handleItemAction(event) {
        const { id, action } = event.detail;
        const stringItem = this.state.strings.find(s => s.id === id);
        if (!stringItem) return;

        switch(action) {
            case 'select':
                this.handleStringSelect(stringItem);
                break;
            case 'delete':
                this.handleStringDelete(stringItem);
                break;
        }
    }

    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        if (resourceType !== 'reusable_string') return;
        
        // System strings are handled internally, don't show them in this view
        if (data.id === 'system-chat-history') return;

        let changed = false;
        switch (eventType) {
            case 'create':
                this.state.strings.push(data);
                changed = true;
                break;
            case 'update':
                const index = this.state.strings.findIndex(s => s.id === data.id);
                if (index !== -1) {
                    this.state.strings[index] = data;
                    if (this.state.selectedString?.id === data.id) {
                        this.state.selectedString = data;
                    }
                    changed = true;
                }
                break;
            case 'delete':
                const initialLength = this.state.strings.length;
                this.state.strings = this.state.strings.filter(s => s.id !== data.id);
                if (this.state.strings.length < initialLength) {
                    if (this.state.selectedString?.id === data.id) {
                        this.state.selectedString = null;
                    }
                    changed = true;
                }
                break;
        }

        if (changed) {
            this.updateView();
        }
    }

    async fetchData() {
        try {
            const strings = await api.get('/api/reusable-strings');
            // 'system-chat-history' is a special string, we'll filter it from the editable list.
            this.state.strings = strings.filter(s => s.id !== 'system-chat-history');

            if (this._pendingSelectedId) {
                const stringToSelect = this.state.strings.find(s => s.id === this._pendingSelectedId);
                if (stringToSelect) {
                    this.state.selectedString = stringToSelect;
                }
                this._pendingSelectedId = null;
            }

            this.updateView();
        } catch (error) {
            console.error("Failed to fetch strings:", error);
            notifier.show({ header: 'Error', message: 'Could not load strings.', type: 'bad' });
        }
    }
    
    setInitialState({ selectedStringId }) {
        if (!selectedStringId) return;

        if (this.state.strings.length > 0) {
            const stringToSelect = this.state.strings.find(s => s.id === selectedStringId);
            if (stringToSelect) {
                this.state.selectedString = stringToSelect;
                this.updateView();
            }
        } else {
            this._pendingSelectedId = selectedStringId;
        }
    }

    handleStringSelect(item) {
        this.state.selectedString = item;
        this.updateView();
    }

    handleBackToStrings() {
        this.state.selectedString = null;
        this.updateView();
    }

    async handleStringAdd() {
        try {
            const newString = await api.post('/api/reusable-strings', { name: 'New String', data: '' });
            // SSE will update the list, just select the new item optimistically.
            this.state.selectedString = newString;
        } catch (error) {
            console.error('Failed to add string:', error);
            notifier.show({ header: 'Error', message: 'Failed to create a new string.', type: 'bad' });
        }
    }

    handleStringDelete(item) {
        modal.confirm({
            title: 'Delete String',
            content: `Are you sure you want to delete "${item.name}"? This will also remove it from any Generation Configs that use it.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/reusable-strings/${item.id}`);
                    // View updates via SSE
                    notifier.show({ header: 'String Deleted', message: `"${item.name}" was removed.` });
                } catch (error) {
                    console.error('Failed to delete string:', error);
                    notifier.show({ header: 'Error', message: `Failed to delete "${item.name}".`, type: 'bad' });
                }
            }
        });
    }

    async handleStringSave(event) {
        event.preventDefault();
        const nameInput = this.shadowRoot.querySelector('#string-name-input');
        const dataInput = this.shadowRoot.querySelector('#string-data-input');

        const updatedString = {
            ...this.state.selectedString,
            name: nameInput.value,
            data: dataInput.value,
        };

        try {
            const savedString = await api.put(`/api/reusable-strings/${updatedString.id}`, updatedString);
            // View updates via SSE
            notifier.show({ header: 'String Saved', message: `"${savedString.name}" has been updated.`, type: 'good' });
        } catch (error) {
            console.error('Failed to save string:', error);
            notifier.show({ header: 'Error', message: `Could not save "${updatedString.name}".`, type: 'bad' });
        }
    }
    
    #renderStringList() {
        if (!this.itemList) return;

        const sortedStrings = [...this.state.strings].sort((a, b) => a.name.localeCompare(b.name));
        this.itemList.innerHTML = sortedStrings.map(s => {
            const isSelected = this.state.selectedString?.id === s.id;
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

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-editor-header');

        if (isMobile) {
            if (this.state.selectedString) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.state.selectedString.name || 'Edit String';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
            }
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        this.#renderStringList();
        
        const editorWrapper = this.shadowRoot.querySelector('.editor-wrapper');
        const placeholder = this.shadowRoot.querySelector('.placeholder');

        if (this.state.selectedString) {
            editorWrapper.style.display = 'block';
            placeholder.style.display = 'none';
            this.shadowRoot.querySelector('#string-name-input').value = this.state.selectedString.name || '';
            this.shadowRoot.querySelector('#string-data-input').value = this.state.selectedString.data || '';
        } else {
            editorWrapper.style.display = 'none';
            placeholder.style.display = 'flex';
        }
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <header id="list-header">
                        <h3>Strings</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="Add New String">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                    </header>
                    <item-list></item-list>
                </div>
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-strings-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <div class="editor-container">
                        <div class="placeholder">
                            <h2>Select a string to edit or create a new one.</h2>
                        </div>
                        <div class="editor-wrapper" style="display: none;">
                            <form id="editor-form">
                                <div class="form-group">
                                    <label for="string-name-input">String Name</label>
                                    <input type="text" id="string-name-input" placeholder="e.g., Main System Prompt">
                                </div>
                                <div class="form-group">
                                    <label for="string-data-input">Content</label>
                                    <p class="field-description">Macros like {{characters}} are supported.</p>
                                    <text-box id="string-data-input"></text-box>
                                </div>
                                <button type="submit" class="button-primary">Save Changes</button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            .panel-left { flex-direction: column; }
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

            .panel-main { display: flex; flex-direction: column; padding: 0; }
            .mobile-editor-header {
                display: none; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3); flex-shrink: 0; gap: var(--spacing-md);
            }
            .mobile-editor-header h2 { margin: 0; font-size: 1.1rem; flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #back-to-strings-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            #back-to-strings-btn:hover { color: var(--text-primary); }

            .editor-container { padding: var(--spacing-lg); overflow-y: auto; height: 100%; }
            .placeholder { text-align: center; height: 100%; display: flex; align-items: center; justify-content: center; }
            #editor-form { display: flex; flex-direction: column; gap: var(--spacing-lg); }
            #string-data-input { min-height: 300px; resize: vertical; padding: 0.75rem; background-color: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius-sm); color: var(--text-primary); font-size: var(--font-size-md); }
            #string-data-input:focus-within { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 2px var(--accent-primary-faded, rgba(138, 180, 248, 0.3)); transition: var(--transition-fast); }
            .field-description { font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: var(--spacing-xs); }
            
            /* ItemList Styles */
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
        `;
    }
}
customElements.define('strings-view', StringsView);