// client/components/views/AIConnectionView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../SchemaForm.js';

class AIConnectionView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            connectionConfigs: [],
            selectedConnectionConfig: null,
            activeConnectionConfigId: null,
            providerSchemas: {},
        };
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this._hasAutoSelectedFirst = false;
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');
        this.editorForm = this.shadowRoot.querySelector('#connection-editor-form');
        this.schemaForm = this.shadowRoot.querySelector('#connection-schema-form');

        this.attachEventListeners();
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
        window.addEventListener('resize', () => this.updateView());
        await this.fetchData();
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
        window.removeEventListener('resize', () => this.updateView());
    }

    attachEventListeners() {
        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', (e) => {
            if (e.target.closest('[data-action="add"]')) this.handleAdd();
        });

        this.editorForm.addEventListener('submit', e => this.handleSave(e));
        this.shadowRoot.querySelector('#connection-test-btn').addEventListener('click', () => this.handleTest());
        this.schemaForm.addEventListener('change', e => this.handleFormChange(e.detail));
        this.shadowRoot.querySelector('#back-to-list-btn').addEventListener('click', () => this.handleBackToList());
    }

    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        let changed = false;
        let selectedConfigWasDeleted = false;

        if (resourceType === 'connection_config') {
            switch (eventType) {
                case 'create':
                    this.state.connectionConfigs.push(data);
                    this.state.selectedConnectionConfig = data;
                    changed = true;
                    break;
                case 'update': {
                    const index = this.state.connectionConfigs.findIndex(c => c.id === data.id);
                    if (index !== -1) {
                        this.state.connectionConfigs[index] = data;
                        if (this.state.selectedConnectionConfig?.id === data.id) {
                            this.state.selectedConnectionConfig = data;
                        }
                        changed = true;
                    }
                    break;
                }
                case 'delete': {
                    if (this.state.selectedConnectionConfig?.id === data.id) {
                        this.state.selectedConnectionConfig = null;
                        selectedConfigWasDeleted = true;
                    }
                    this.state.connectionConfigs = this.state.connectionConfigs.filter(c => c.id !== data.id);
                    changed = true;
                    break;
                }
            }
        } else if (resourceType === 'setting') {
            if (this.state.activeConnectionConfigId !== data.activeConnectionConfigId) {
                this.state.activeConnectionConfigId = data.activeConnectionConfigId;
                changed = true;
            }
        }

        if (changed) {
            const editorHasFocus = this.schemaForm.shadowRoot.contains(document.activeElement);
            if (editorHasFocus && !selectedConfigWasDeleted) {
                this.#renderList();
            } else {
                this.updateView();
            }
        }
    }

    async fetchData() {
        try {
            const [configs, settings, schemas] = await Promise.all([
                api.get('/api/connection-configs'),
                api.get('/api/settings'),
                api.get('/api/providers/schemas'),
            ]);
            this.state.connectionConfigs = configs;
            this.state.activeConnectionConfigId = settings.activeConnectionConfigId;
            this.state.providerSchemas = schemas;

            this.updateView();
        } catch (error) {
            notifier.show({ header: 'Error', message: 'Could not load connection configurations.' });
        }
    }

    handleItemAction(event) {
        const { id, action } = event.detail;
        const config = this.state.connectionConfigs.find(c => c.id === id);
        if (!config) return;

        switch(action) {
            case 'select':
                this.state.selectedConnectionConfig = config;
                this.updateView();
                break;
            case 'delete':
                this.handleDelete(config);
                break;
            case 'activate':
                this.handleActivate(config);
                break;
        }
    }

    handleFormChange({ provider }) {
        if (provider && this.state.selectedConnectionConfig) {
            this.state.selectedConnectionConfig.provider = provider;
            this.updateEditor();
        }
    }

    async handleAdd() {
        try {
            await api.post('/api/connection-configs', { name: 'New Connection Config' });
        } catch (error) {
            notifier.show({ header: 'Error', message: 'Failed to create new connection config.', type: 'bad' });
        }
    }

    handleDelete(item) {
        modal.confirm({
            title: 'Delete Connection',
            content: `Are you sure you want to delete "${item.name}"?`,
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                await api.delete(`/api/connection-configs/${item.id}`);
                notifier.show({ message: `Deleted "${item.name}".` });
            }
        });
    }

    async handleActivate(item) {
        const newActiveId = this.state.activeConnectionConfigId === item.id ? 'null' : item.id;
        await api.post(`/api/connection-configs/${newActiveId}/activate`);
        notifier.show({ type: 'good', message: newActiveId !== 'null' ? `"${item.name}" is now active.` : 'Active connection cleared.' });
    }

    async handleSave(event) {
        event.preventDefault();
        const name = this.shadowRoot.querySelector('#connection-name-input').value;
        const schemaData = this.schemaForm.serialize();
        const configData = { ...this.state.selectedConnectionConfig, ...schemaData, name };
        
        await api.put(`/api/connection-configs/${configData.id}`, configData);
        notifier.show({ type: 'good', message: `"${configData.name}" has been updated.` });
    }
    
    async handleTest() {
        const name = this.shadowRoot.querySelector('#connection-name-input').value;
        const schemaData = this.schemaForm.serialize();
        const configData = { ...this.state.selectedConnectionConfig, ...schemaData, name };
        const testButton = this.shadowRoot.querySelector('#connection-test-btn');
        testButton.disabled = true;
        testButton.textContent = 'Testing...';
        
        try {
            const result = await api.post('/api/connection-configs/test', configData);
            if (result.ok) {
                 notifier.show({ header: 'Test Successful', message: result.message, type: 'good' });
            } else {
                 notifier.show({ 
                    header: 'Test Failed', message: 'Click for details.', type: 'bad',
                    onClick: () => modal.show({ title: 'Test Failed', content: result.message })
                });
            }
        } catch (error) {
             notifier.show({ header: 'Test Error', message: 'Click for details.', type: 'bad',
                onClick: () => modal.show({ title: 'Test Error', content: error.message })
            });
        } finally {
            testButton.disabled = false;
            testButton.textContent = 'Test Connection';
        }
    }

    handleBackToList() {
        this.state.selectedConnectionConfig = null;
        this.updateView();
    }

    #renderList() {
        const sortedConfigs = this.state.connectionConfigs.sort((a,b) => a.name.localeCompare(b.name));
        this.itemList.innerHTML = sortedConfigs.map(config => {
            const isSelected = this.state.selectedConnectionConfig?.id === config.id;
            const isActive = this.state.activeConnectionConfigId === config.id;
            const iconUrl = this.getProviderIcon(config.provider);
            return `
                <li data-id="${config.id}" class="${isSelected ? 'selected' : ''}">
                    <div class="provider-icon" style="--icon-url: url('${iconUrl}')"></div>
                    <div class="item-name">${config.name}</div>
                    <div class="actions">
                        <button class="icon-button activate-btn ${isActive ? 'active' : ''}" data-action="activate" title="${isActive ? 'Active' : 'Set active'}">
                            <span class="material-icons">${isActive ? 'radio_button_checked' : 'radio_button_off'}</span>
                        </button>
                        <button class="icon-button delete-btn" data-action="delete" title="Delete"><span class="material-icons">delete</span></button>
                    </div>
                </li>`;
        }).join('');
    }

    updateEditor() {
        const editor = this.shadowRoot.querySelector('.panel-main');
        if (this.state.selectedConnectionConfig) {
            editor.style.display = 'flex';
            this.shadowRoot.querySelector('#connection-name-input').value = this.state.selectedConnectionConfig.name || '';
            this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.state.selectedConnectionConfig.name || 'Edit Connection';

            const providerOptions = Object.keys(this.state.providerSchemas).map(id => ({ value: id, label: this.getProviderLabel(id) }));
            const baseSchema = [{ name: 'provider', label: 'Provider Type', type: 'select', options: providerOptions }];
            const providerId = this.state.selectedConnectionConfig.provider || 'v1';
            const dynamicSchema = this.state.providerSchemas[providerId] || [];
            this.schemaForm.schema = [...baseSchema, ...dynamicSchema];
            this.schemaForm.data = this.state.selectedConnectionConfig;
        } else {
            editor.style.display = 'none';
        }
    }

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelRightSidebar = this.shadowRoot.querySelector('.panel-right-sidebar');
        const panelMain = this.shadowRoot.querySelector('.panel-main');

        if (isMobile) {
            panelRightSidebar.style.display = this.state.selectedConnectionConfig ? 'none' : 'flex';
            panelMain.style.display = this.state.selectedConnectionConfig ? 'flex' : 'none';
        } else {
            panelRightSidebar.style.display = 'flex';
            panelMain.style.display = 'flex';
        }
        this.#renderList();
        this.updateEditor();
    }

    getProviderIcon(provider) {
        const icons = { v1: 'v1.svg', gemini: 'gemini.svg' };
        return `assets/images/providers/${icons[provider] || 'default_avatar.svg'}`;
    }

    getProviderLabel(providerId) {
        const labels = { v1: 'OpenAI-compatible', gemini: 'Google Gemini' };
        return labels[providerId] || providerId;
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-list-btn" class="icon-btn" title="Back"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <div class="view-container">
                        <div class="placeholder"><h2>Select a connection to configure.</h2></div>
                        <form id="connection-editor-form">
                            <header class="editor-header">
                                <input type="text" id="connection-name-input" class="editor-title-input" placeholder="Connection Name">
                            </header>
                            <schema-form id="connection-schema-form"></schema-form>
                            <div class="button-group">
                                <button type="submit" class="button-primary">Save Changes</button>
                                <button type="button" id="connection-test-btn" class="button-secondary">Test Connection</button>
                            </div>
                        </form>
                    </div>
                </div>
                <div class="panel-right-sidebar">
                    <header id="list-header">
                        <h3>Connections</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="New Connection"><span class="material-icons">add</span></button>
                        </div>
                    </header>
                    <item-list></item-list>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            /* Left Panel (List) */
            .panel-right-sidebar { flex-direction: column; }
            #list-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; }
            #list-header h3 { margin: 0; }
            .header-actions .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; transition: var(--transition-fast); display: flex; align-items: center; justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            .header-actions .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            item-list { flex-grow: 1; overflow-y: auto; }
            item-list li { display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md); cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast); gap: var(--spacing-sm); }
            item-list li:hover { background-color: var(--bg-2); }
            item-list li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            .provider-icon { width: 40px; height: 40px; flex-shrink: 0; background-color: var(--accent-primary); mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url); mask-size: 80%; mask-repeat: no-repeat; mask-position: center; }
            item-list li.selected .provider-icon { background-color: var(--bg-0); }
            .item-name { flex-grow: 1; font-weight: 500; }
            item-list li.selected .item-name { font-weight: 600; }
            .actions { display: flex; gap: var(--spacing-xs); }
            .actions .icon-button { color: var(--text-secondary); }
            li.selected .actions .icon-button { color: var(--bg-0); }
            li:not(.selected) .actions .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            .activate-btn.active { color: var(--accent-primary); }
            li.selected .activate-btn.active { color: var(--bg-0); }

            /* Main Panel (Editor) */
            .panel-main { display: none; flex-direction: column; }
            .mobile-editor-header { display: none; align-items: center; padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; gap: var(--spacing-md); }
            #editor-title-mobile { font-size: 1.1rem; flex-grow: 1; }
            .placeholder { text-align: center; color: var(--text-secondary); }
            #connection-editor-form { display: block; }
            .editor-header { margin-bottom: var(--spacing-lg); }
            .editor-title-input { font-size: 1.5rem; font-weight: 600; background: none; border: none; outline: none; width: 100%; color: var(--text-primary); border-bottom: 1px solid var(--bg-3); padding-bottom: var(--spacing-sm); }
            .button-group { display: flex; gap: var(--spacing-md); margin-top: var(--spacing-lg); }
            
            @media (min-width: 769px) {
                #connection-editor-form { display: none; }
                .panel-main[style*="display: flex"] #connection-editor-form { display: block; }
                .panel-main[style*="display: flex"] .placeholder { display: none; }
            }
            @media (max-width: 768px) {
                .mobile-editor-header { display: flex; }
                .panel-main { padding: 0; }
                .editor-header { display: none; }
                .view-container { padding: var(--spacing-md); }
            }
        `;
    }
}
customElements.define('ai-connection-view', AIConnectionView);