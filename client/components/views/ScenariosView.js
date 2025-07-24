// client/components/views/ScenariosView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../ScenarioEditor.js'; // Import the new component

class ScenariosView extends BaseComponent {
    #state = {
        scenarios: [],
        allCharacters: [],
    };
    #selectedScenario = null;
    #needsSave = false;
    #pendingSelectedId = null;
    #editor = null;

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
        this.#editor = this.shadowRoot.querySelector('minerva-scenario-editor');

        // Listeners
        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', e => {
            if (e.target.closest('[data-action="add"]')) this.handleScenarioAdd();
        });
        this.shadowRoot.querySelector('#back-to-scenarios-btn').addEventListener('click', this.handleBackToScenarios);
        
        this.shadowRoot.querySelector('#save-scenario-btn').addEventListener('click', () => this.#editor.shadowRoot.querySelector('form').requestSubmit());
        this.#editor.addEventListener('scenario-save', this.onSave);
        this.#editor.addEventListener('change', () => this.#setNeedsSave(true));

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
            this.#editor.allCharacters = characters;
            
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

        if (resourceType === 'character') {
            // Just update the character list in the editor if it changes
            api.get('/api/characters').then(chars => {
                this.#state.allCharacters = chars;
                this.#editor.allCharacters = chars;
            });
            return;
        }

        if (resourceType === 'scenario') {
            let stateChanged = false;
            let selectedScenarioWasDeleted = false;
            
            switch (eventType) {
                case 'create':
                    if (!this.#state.scenarios.some(s => s.id === data.id)) {
                        this.#state.scenarios.push(data);
                    }
                    this.#selectedScenario = JSON.parse(JSON.stringify(data));
                    this.#setNeedsSave(false);
                    stateChanged = true;
                    break;
                case 'update': {
                    const index = this.#state.scenarios.findIndex(s => s.id === data.id);
                    if (index > -1) {
                        this.#state.scenarios[index] = data;
                        if (this.#selectedScenario?.id === data.id) {
                            this.#selectedScenario = JSON.parse(JSON.stringify(data));
                            this.#setNeedsSave(false);
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
                const hasFocus = this.#editor.shadowRoot.activeElement;
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
            await api.post('/api/scenarios', { name: 'New Scenario', description: '' });
            notifier.show({ message: 'New scenario created.' });
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

    async onSave(event) {
        if (!this.#selectedScenario || !this.#needsSave) return;
        const { scenario } = event.detail;
        
        try {
            await api.put(`/api/scenarios/${scenario.id}`, scenario);
            notifier.show({ type: 'good', message: 'Scenario saved.' });
            this.#setNeedsSave(false);
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

        this.#editor.scenario = this.#selectedScenario;
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

        render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-scenarios-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <div class="editor-container">
                        <header class="main-editor-header">
                             <div class="header-controls">
                                <span class="save-indicator">Unsaved changes</span>
                                <button type="button" id="save-scenario-btn" class="button-primary" disabled>Save</button>
                            </div>
                        </header>
                        <minerva-scenario-editor></minerva-scenario-editor>
                    </div>
                </div>
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
            #back-to-scenarios-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            #back-to-scenarios-btn:hover { color: var(--text-primary); }

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
            #save-scenario-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; opacity: 1; }
            
            minerva-scenario-editor {
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
customElements.define('scenarios-view', ScenariosView);