import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../ScenarioEditor.js';

class ScenariosView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            scenarios: [],
            selectedScenario: null,
            allCharacters: [],
            allNotes: []
        };
        
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this.handleEditorSave = this.handleEditorSave.bind(this);
        this.handleStartChat = this.handleStartChat.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');
        this.editor = this.shadowRoot.querySelector('scenario-editor');

        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', (e) => {
            if (e.target.closest('[data-action="add"]')) this.handleAdd();
        });
        this.shadowRoot.querySelector('#back-btn').addEventListener('click', () => {
            this.state.selectedScenario = null;
            this.updateView();
        });

        this.editor.addEventListener('scenario-save', (e) => this.handleEditorSave(e.detail));
        this.editor.addEventListener('start-chat', (e) => this.handleStartChat(e.detail.scenario));

        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
        window.addEventListener('resize', () => this.updateView());

        await this.fetchData();
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
    }

    async fetchData() {
        try {
            const [scenarios, characters, notes] = await Promise.all([
                api.get('/api/scenarios'),
                api.get('/api/characters'),
                api.get('/api/notes')
            ]);
            this.state.scenarios = scenarios;
            this.state.allCharacters = characters;
            this.state.allNotes = notes;
            
            // Pass context to editor
            this.editor.allCharacters = characters;
            this.editor.allNotes = notes;

            this.updateView();
        } catch (error) {
            console.error('Failed to fetch data for ScenariosView:', error);
            notifier.show({ type: 'bad', message: 'Failed to load scenarios.' });
        }
    }

    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        
        if (resourceType === 'scenario') {
            if (eventType === 'create') {
                this.state.scenarios.push(data);
                this.state.selectedScenario = data;
            } else if (eventType === 'update') {
                const idx = this.state.scenarios.findIndex(s => s.id === data.id);
                if (idx !== -1) {
                    this.state.scenarios[idx] = data;
                    if (this.state.selectedScenario?.id === data.id) this.state.selectedScenario = data;
                }
            } else if (eventType === 'delete') {
                this.state.scenarios = this.state.scenarios.filter(s => s.id !== data.id);
                if (this.state.selectedScenario?.id === data.id) this.state.selectedScenario = null;
            }
            this.updateView();
        } else if (resourceType === 'character' || resourceType === 'note') {
            // Refresh auxiliary data if characters/notes change
            this.fetchData();
        }
    }

    handleItemAction(event) {
        const { id, action } = event.detail;
        const scenario = this.state.scenarios.find(s => s.id === id);
        if (!scenario) return;

        if (action === 'select') {
            this.state.selectedScenario = scenario;
            this.updateView();
        } else if (action === 'delete') {
            modal.confirm({
                title: 'Delete Scenario',
                content: `Are you sure you want to delete "${scenario.name}"?`,
                confirmButtonClass: 'button-danger',
                onConfirm: async () => {
                    await api.delete(`/api/scenarios/${scenario.id}`);
                    notifier.show({ message: 'Scenario deleted.' });
                }
            });
        }
    }

    async handleAdd() {
        try {
            const newScenario = await api.post('/api/scenarios', { name: 'New Scenario' });
            this.state.selectedScenario = newScenario; // Optimistic selection
            // List update handled by SSE
        } catch (error) {
            notifier.show({ type: 'bad', message: 'Failed to create scenario.' });
        }
    }

    async handleEditorSave({ scenario, isImageUpdate }) {
        try {
            if (isImageUpdate) {
                // Image updates are handled via separate endpoint in editor, 
                // just notify here if needed, but SSE will trigger view update.
                notifier.show({ type: 'good', message: 'Image uploaded.' });
            } else {
                await api.put(`/api/scenarios/${scenario.id}`, scenario);
                notifier.show({ type: 'good', message: 'Scenario saved.' });
            }
        } catch (error) {
            notifier.show({ type: 'bad', message: 'Failed to save scenario.' });
        }
    }

    async handleStartChat(scenario) {
        try {
            const payload = {
                name: scenario.name,
                participants: [...scenario.participants],
                notes: [...scenario.notes],
                firstMessage: scenario.firstMessage
            };
            
            const newChat = await api.post('/api/chats', payload);
            
            // Navigate to main chat view and select the new chat
            this.dispatch('navigate-to-view', { 
                view: 'chat', 
                state: { selectedChatId: newChat.id } // MainChatView needs to support this
            });
            
            notifier.show({ type: 'good', message: 'Chat started from scenario.' });
        } catch (error) {
            console.error(error);
            notifier.show({ type: 'bad', message: 'Failed to start chat.' });
        }
    }

    renderList() {
        const sorted = [...this.state.scenarios].sort((a,b) => a.name.localeCompare(b.name));
        this.itemList.innerHTML = sorted.map(s => {
            const isSelected = this.state.selectedScenario?.id === s.id;
            return `
                <li data-id="${s.id}" class="${isSelected ? 'selected' : ''}">
                    <div class="list-item-row">
                        <img src="${s.avatarUrl || 'assets/images/default_avatar.svg'}" class="list-avatar">
                        <div class="item-name">${s.name}</div>
                        <div class="actions">
                            <button class="icon-button delete-btn" data-action="delete" title="Delete"><span class="material-icons">delete</span></button>
                        </div>
                    </div>
                </li>
            `;
        }).join('');
    }

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const sidebar = this.shadowRoot.querySelector('.panel-right-sidebar');
        const main = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-header');

        if (isMobile) {
            if (this.state.selectedScenario) {
                sidebar.style.display = 'none';
                main.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#mobile-title').textContent = this.state.selectedScenario.name;
            } else {
                sidebar.style.display = 'flex';
                main.style.display = 'none';
            }
        } else {
            sidebar.style.display = 'flex';
            main.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        this.renderList();
        this.editor.scenario = this.state.selectedScenario;
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-header">
                        <button id="back-btn" class="icon-button"><span class="material-icons">arrow_back</span></button>
                        <h2 id="mobile-title">Editor</h2>
                    </header>
                    <scenario-editor></scenario-editor>
                </div>
                <div class="panel-right-sidebar">
                    <header id="list-header">
                        <h3>Scenarios</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="New Scenario"><span class="material-icons">add</span></button>
                        </div>
                    </header>
                    <item-list></item-list>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            .panel-right-sidebar { flex-direction: column; border-left: 1px solid var(--bg-3); background: var(--bg-0); }
            #list-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; }
            #list-header h3 { margin: 0; }
            .header-actions .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 4px; }
            .header-actions .icon-button:hover { background-color: var(--bg-2); color: var(--text-primary); }
            
            .list-item-row { display: flex; align-items: center; padding: 8px 16px; gap: 10px; cursor: pointer; border-bottom: 1px solid var(--bg-3); }
            .list-item-row:hover { background-color: var(--bg-2); }
            li.selected .list-item-row { background-color: var(--accent-primary); color: var(--bg-0); }
            li.selected .icon-button { color: var(--bg-0); }
            li.selected .icon-button:hover { background-color: rgba(255,255,255,0.2); }
            
            .list-avatar { width: 36px; height: 36px; border-radius: 4px; object-fit: cover; background: var(--bg-3); }
            .item-name { flex-grow: 1; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            
            .panel-main { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
            .mobile-header { display: none; align-items: center; padding: 10px; border-bottom: 1px solid var(--bg-3); gap: 10px; background: var(--bg-1); }
            #mobile-title { margin: 0; font-size: 1.1rem; flex-grow: 1; }
            
            /* ALLOW SCROLLING: Removed overflow: hidden so component styles take effect */
            scenario-editor { flex-grow: 1; min-height: 0; }

            @media (max-width: 768px) {
                .panel-right-sidebar { border: none; width: 100%; }
            }
        `;
    }
}

customElements.define('scenarios-view', ScenariosView);