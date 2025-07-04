import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../TextBox.js';

class ScenariosView extends BaseComponent {
    #state = {
        scenarios: [],
        allCharacters: [],
    };
    #selectedScenario = null;
    #needsSave = false;
    #pendingSelectedId = null;

    constructor() {
        super();
        this.handleBackToScenarios = this.handleBackToScenarios.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this.onSave = this.onSave.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');

        // Listeners
        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', e => {
            if (e.target.closest('[data-action="add"]')) this.handleScenarioAdd();
        });
        this.shadowRoot.querySelector('#back-to-scenarios-btn').addEventListener('click', this.handleBackToScenarios);
        
        const editorWrapper = this.shadowRoot.querySelector('.editor-wrapper');
        this.shadowRoot.querySelector('#save-scenario-btn').addEventListener('click', this.onSave);
        this.shadowRoot.querySelector('#add-override-btn').addEventListener('click', () => this.openAddOverrideModal());
        this.shadowRoot.querySelector('#override-list').addEventListener('click', e => this.handleOverrideListClick(e));
        editorWrapper.addEventListener('input', () => this.#setNeedsSave(true));

        window.addEventListener('minerva-resource-changed', this.handleResourceChange);

        await this.fetchData();
        this.#setNeedsSave(false);
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
        this.itemList.removeEventListener('item-action', this.handleItemAction);
    }
    
    setInitialState({ selectedScenarioId }) {
        if (!selectedScenarioId) return;
        this._pendingSelectedId = selectedScenarioId;
    }

    async fetchData() {
        try {
            const [scenarios, characters] = await Promise.all([
                api.get('/api/scenarios'),
                api.get('/api/characters')
            ]);
            this.#state.scenarios = scenarios;
            this.#state.allCharacters = characters;
            
            if (this._pendingSelectedId) {
                const scenarioToSelect = this.#state.scenarios.find(s => s.id === this._pendingSelectedId);
                if (scenarioToSelect) {
                    this.#performSelection(scenarioToSelect);
                }
                this._pendingSelectedId = null;
            }

            this.#updateView();
        } catch (error) {
            console.error("Failed to fetch scenario data:", error);
            notifier.show({ header: 'Error', message: 'Could not load scenario data.' });
        }
    }
    
    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        if (resourceType === 'scenario') {
            let stateChanged = false;
            let selectedScenarioWasDeleted = false;
            
            switch (eventType) {
                case 'create':
                    if (!this.#state.scenarios.some(s => s.id === data.id)) {
                        this.#state.scenarios.push(data);
                        stateChanged = true;
                    }
                    break;
                case 'update': {
                    const index = this.#state.scenarios.findIndex(s => s.id === data.id);
                    if (index > -1) {
                        this.#state.scenarios[index] = data;
                        if (this.#selectedScenario?.id === data.id) {
                            this.#selectedScenario = data;
                        }
                        stateChanged = true;
                    }
                    break;
                }
                case 'delete': {
                    const initialLength = this.#state.scenarios.length;
                    if (this.#selectedScenario?.id === data.id) {
                        this.#selectedScenario = null;
                        selectedScenarioWasDeleted = true;
                    }
                    this.#state.scenarios = this.#state.scenarios.filter(s => s.id !== data.id);
                    if (this.#state.scenarios.length < initialLength) {
                        stateChanged = true;
                    }
                    break;
                }
            }
            if (stateChanged) {
                const hasFocus = this.shadowRoot.activeElement && this.shadowRoot.activeElement.closest('.editor-wrapper');
                if (hasFocus && !selectedScenarioWasDeleted) {
                    this.#renderScenarioList();
                } else {
                    this.#updateView();
                }
            }
        }
    }

    handleItemAction(event) {
        const { id, action } = event.detail;
        const scenario = this.#state.scenarios.find(s => s.id === id);
        if (!scenario) return;

        switch(action) {
            case 'select':
                this.handleScenarioSelect(scenario);
                break;
            case 'delete':
                this.handleScenarioDelete(scenario);
                break;
        }
    }

    handleScenarioSelect(item) {
        if (this.#selectedScenario?.id === item.id) return;

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
        this.#selectedScenario = JSON.parse(JSON.stringify(item));
        this.#setNeedsSave(false);
        this.#updateView();
    }

    async handleScenarioAdd() {
        try {
            const newScenario = await api.post('/api/scenarios', { name: 'New Scenario', description: '' });
            this.#state.scenarios.push(newScenario);
            this.#performSelection(newScenario);
        } catch (error) {
            console.error('Failed to add scenario:', error);
            notifier.show({ header: 'Error', message: 'Failed to create a new scenario.' });
        }
    }
    
    handleScenarioDelete(item) {
        modal.confirm({
            title: 'Delete Scenario',
            content: `Are you sure you want to delete "${item.name}"? This will also remove it from any chats that use it.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/scenarios/${item.id}`);
                    notifier.show({ header: 'Scenario Deleted', message: `"${item.name}" was removed.` });
                } catch (error) {
                    notifier.show({ header: 'Error', message: `Failed to delete "${item.name}".` });
                }
            }
        });
    }

    async onSave() {
        if (!this.#selectedScenario || !this.#needsSave) return;
        
        const overrides = {};
        this.shadowRoot.querySelectorAll('.override-item').forEach(itemEl => {
            const charId = itemEl.dataset.characterId;
            const text = itemEl.querySelector('text-box').value;
            overrides[charId] = text;
        });

        const scenarioData = {
            ...this.#selectedScenario,
            id: this.#selectedScenario.id,
            name: this.shadowRoot.querySelector('#scenario-name-input').value,
            description: this.shadowRoot.querySelector('#description-input').value,
            characterOverrides: overrides,
        };

        try {
            const savedScenario = await api.put(`/api/scenarios/${scenarioData.id}`, scenarioData);
            this.#selectedScenario = savedScenario;
            
            const index = this.#state.scenarios.findIndex(s => s.id === savedScenario.id);
            if (index > -1) {
                this.#state.scenarios[index] = savedScenario;
            }
            this.#renderScenarioList();
            this.#setNeedsSave(false);
            notifier.show({ type: 'good', message: 'Scenario saved.' });

        } catch (error) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not save scenario.' });
        }
    }
    
    handleBackToScenarios() {
        if (this.#needsSave) {
            modal.confirm({
                title: 'Unsaved Changes',
                content: 'You have unsaved changes. Are you sure you want to discard them?',
                confirmLabel: 'Discard Changes',
                confirmButtonClass: 'button-danger',
                onConfirm: () => {
                    this.#selectedScenario = null;
                    this.#setNeedsSave(false);
                    this.#updateView();
                }
            });
        } else {
            this.#selectedScenario = null;
            this.#updateView();
        }
    }
    
    #setNeedsSave(needsSave) {
        this.#needsSave = needsSave;
        const saveIndicator = this.shadowRoot.querySelector('.save-indicator');
        const saveButton = this.shadowRoot.querySelector('#save-scenario-btn');
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
            if (this.#selectedScenario) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.#selectedScenario.name || 'Edit Scenario';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
            }
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        const editorWrapper = this.shadowRoot.querySelector('.editor-wrapper');
        const placeholder = this.shadowRoot.querySelector('.placeholder');

        if (this.#selectedScenario) {
            editorWrapper.style.display = 'flex';
            placeholder.style.display = 'none';
            this.shadowRoot.querySelector('#scenario-name-input').value = this.#selectedScenario.name || '';
            this.shadowRoot.querySelector('#description-input').value = this.#selectedScenario.description || '';
            this.#renderOverridesList();
        } else {
            editorWrapper.style.display = 'none';
            placeholder.style.display = 'flex';
        }
        this.#renderScenarioList();
    }

    #renderScenarioList() {
        if (!this.itemList) return;
        const sortedScenarios = [...this.#state.scenarios].sort((a, b) => a.name.localeCompare(b.name));
        this.itemList.innerHTML = sortedScenarios.map(s => {
            const isSelected = this.#selectedScenario?.id === s.id;
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

    openAddOverrideModal() {
        const currentOverrideIds = Object.keys(this.#selectedScenario.characterOverrides || {});
        const charactersToAdd = this.#state.allCharacters.filter(c => !currentOverrideIds.includes(c.id));
        
        const content = document.createElement('div');
        const list = document.createElement('item-list');
        list.innerHTML = charactersToAdd.map(char => `
            <li data-id="${char.id}">
                <img class="avatar" src="${char.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${char.name}'s avatar">
                <div class="item-name">${char.name}</div>
            </li>
        `).join('');
        
        list.addEventListener('item-action', e => {
            const charId = e.detail.id;
            if (!this.#selectedScenario.characterOverrides) {
                this.#selectedScenario.characterOverrides = {};
            }
            this.#selectedScenario.characterOverrides[charId] = '';
            this.#renderOverridesList();
            this.#setNeedsSave(true);
            modal.hide();
        });

        content.appendChild(list);
        modal.show({
            title: 'Add Character Override',
            content,
            buttons: [{ label: 'Cancel', className: 'button-secondary', onClick: () => modal.hide() }]
        });
    }

    handleOverrideListClick(event) {
        const deleteBtn = event.target.closest('.delete-override-btn');
        if (deleteBtn) {
            const charId = deleteBtn.dataset.characterId;
            delete this.#selectedScenario.characterOverrides[charId];
            this.#renderOverridesList();
            this.#setNeedsSave(true);
        }
    }

    #renderOverridesList() {
        const listEl = this.shadowRoot.querySelector('#override-list');
        const overrides = this.#selectedScenario?.characterOverrides || {};

        if (Object.keys(overrides).length === 0) {
            listEl.innerHTML = `<p class="field-description">No character-specific text defined.</p>`;
            return;
        }

        listEl.innerHTML = Object.entries(overrides).map(([charId, text]) => {
            const character = this.#state.allCharacters.find(c => c.id === charId);
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

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <header id="list-header">
                        <h3>Scenarios</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="Add New Scenario">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                    </header>
                    <item-list></item-list>
                </div>
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-scenarios-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <div class="editor-container">
                        <div class="placeholder">
                            <h2>Select a scenario to edit or create a new one.</h2>
                        </div>
                        <div class="editor-wrapper" style="display: none;">
                            <header class="editor-header">
                                <div class="editor-header-main">
                                    <input type="text" id="scenario-name-input" class="editor-title-input" placeholder="Scenario Name">
                                </div>
                                <div class="header-controls">
                                    <span class="save-indicator">Unsaved changes</span>
                                    <button type="button" id="save-scenario-btn" class="button-primary" disabled>Save</button>
                                </div>
                            </header>
                            <form id="editor-form">
                                <section class="form-section">
                                    <h3>General Scenario Text</h3>
                                    <p class="field-description">This text will be inserted when using the "Scenario" item in a Generation Config.</p>
                                    <text-box id="description-input"></text-box>
                                </section>
                                <section class="form-section">
                                    <h3>Character-Specific Text</h3>
                                    <p class="field-description">Provide alternate text for specific characters. This is used by the {{characters[..., scenario]}} macro.</p>
                                    <div id="override-list"></div>
                                    <button type="button" id="add-override-btn" class="button-secondary">Add Character Override</button>
                                </section>
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
            #back-to-scenarios-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            #back-to-scenarios-btn:hover { color: var(--text-primary); }

            .editor-container { padding: var(--spacing-lg); overflow-y: auto; height: 100%; }
            .editor-wrapper { display: none; flex-direction: column; }
            .placeholder { text-align: center; height: 100%; display: flex; align-items: center; justify-content: center; flex-grow: 1; color: var(--text-secondary); }
            
            .editor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-lg); }
            .editor-header-main { flex-grow: 1; }
            .header-controls { display: flex; align-items: center; gap: var(--spacing-md); }
            .save-indicator { font-size: var(--font-size-sm); color: var(--accent-warn); opacity: 0; transition: opacity 0.3s; }
            #save-scenario-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; opacity: 1; }

            .editor-title-input { font-size: 1.5rem; font-weight: 600; background: none; border: none; outline: none; width: 100%; color: var(--text-primary); border-bottom: 1px solid var(--bg-3); padding: var(--spacing-sm) 0; }
            .editor-title-input:focus { border-bottom-color: var(--accent-primary); }

            #editor-form { display: flex; flex-direction: column; gap: var(--spacing-lg); }
            .form-section { margin-bottom: var(--spacing-lg); }
            #description-input { min-height: 150px; }
            .field-description { font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: var(--spacing-xs); margin-bottom: var(--spacing-sm); }
            
            #override-list { display: flex; flex-direction: column; gap: var(--spacing-md); margin-bottom: var(--spacing-md); }
            .override-item { display: flex; gap: var(--spacing-md); align-items: flex-start; background: var(--bg-0); padding: var(--spacing-md); border-radius: var(--radius-sm); }
            .override-item .avatar { width: 50px; height: 50px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; }
            .override-item-main { flex-grow: 1; display: flex; flex-direction: column; gap: var(--spacing-sm); }
            .override-item-main .char-name { font-weight: 600; }
            .override-item-main text-box { min-height: 80px; }
            .override-item .delete-override-btn { color: var(--text-secondary); align-self: center; }
            .override-item .delete-override-btn:hover { color: var(--accent-danger); }
            
            item-list .avatar { width: 40px; height: 40px; }
            item-list li { gap: var(--spacing-md); }

            @media (max-width: 768px) {
                .editor-container { padding: var(--spacing-md); }
            }
        `;
    }
}
customElements.define('scenarios-view', ScenariosView);