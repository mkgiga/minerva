import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../SchemaForm.js';

class ConnectionConfigView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            configs: [],
            selectedConfig: null,
            activeConfigId: null,
            adapterSchemas: {},
        };
        this.handleBackToConfigs = this.handleBackToConfigs.bind(this);
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this._hasAutoSelectedFirst = false; // Track if we've auto-selected the first item
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');
        this.editorForm = this.shadowRoot.querySelector('#editor-form-container');
        this.schemaForm = this.shadowRoot.querySelector('schema-form');
        
        this.attachEventListeners();
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
        await this.fetchData();
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
        this.itemList.removeEventListener('item-action', this.handleItemAction);
    }

    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        let changed = false;
        let selectedConfigWasDeleted = false;

        if (resourceType === 'connection_config') {
            switch (eventType) {
                case 'create':
                    this.state.configs.push(data);
                    changed = true;
                    break;
                case 'update': {
                    const index = this.state.configs.findIndex(c => c.id === data.id);
                    if (index !== -1) {
                        this.state.configs[index] = data;
                        if (this.state.selectedConfig?.id === data.id) {
                            this.state.selectedConfig = data;
                        }
                        changed = true;
                    }
                    break;
                }
                case 'delete': {
                    const initialLength = this.state.configs.length;
                    if (this.state.selectedConfig?.id === data.id) {
                        this.state.selectedConfig = null;
                        selectedConfigWasDeleted = true;
                    }
                    this.state.configs = this.state.configs.filter(c => c.id !== data.id);
                    if (this.state.configs.length < initialLength) {
                        changed = true;
                    }
                    break;
                }
            }
        } else if (resourceType === 'setting') {
            if (this.state.activeConfigId !== data.activeConnectionConfigId) {
                this.state.activeConfigId = data.activeConnectionConfigId;
                changed = true;
            }
        }

        if (changed) {
            const editorForm = this.shadowRoot.querySelector('schema-form');
            const editorHasFocus = editorForm && editorForm.shadowRoot.contains(document.activeElement);

            if (editorHasFocus && !selectedConfigWasDeleted) {
                this._renderConfigList();
            } else {
                this.updateView();
            }
        }
    }

    attachEventListeners() {
        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', (e) => {
            if (e.target.closest('[data-action="add"]')) this.handleAdd();
        });
        
        this.editorForm.addEventListener('submit', e => this.handleSave(e));
        this.shadowRoot.querySelector('#test-btn').addEventListener('click', () => this.handleTest());
        this.schemaForm.addEventListener('change', e => this.handleFormChange(e.detail));
        this.shadowRoot.querySelector('#back-to-configs-btn').addEventListener('click', this.handleBackToConfigs);
    }
    
    handleItemAction(event) {
        const { id, action } = event.detail;
        const config = this.state.configs.find(c => c.id === id);
        if (!config) return;

        switch(action) {
            case 'select':
                this.handleSelect(config);
                break;
            case 'delete':
                this.handleDelete(config);
                break;
            case 'activate':
                this.handleActivate(config);
                break;
        }
    }

    async fetchData() {
        try {
            const [configs, settings, schemas] = await Promise.all([
                api.get('/api/connection-configs'),
                api.get('/api/settings'),
                api.get('/api/adapters/schemas'),
            ]);
            this.state.configs = configs;
            this.state.activeConfigId = settings.activeConnectionConfigId;
            this.state.adapterSchemas = schemas;
            
            // Auto-select the first item if no item is selected and we haven't auto-selected before
            if (!this._hasAutoSelectedFirst && !this.state.selectedConfig && configs.length > 0) {
                const sortedConfigs = configs.sort((a, b) => a.name.localeCompare(b.name));
                this.state.selectedConfig = sortedConfigs[0];
                this._hasAutoSelectedFirst = true;
            }
            
            this.updateView();
        } catch (error) {
            console.error("Failed to fetch connection configs:", error);
            notifier.show({ header: 'Error', message: 'Could not load connection configurations.' });
        }
    }
    
    handleFormChange({ adapter }) {
        if (adapter && this.state.selectedConfig) {
            // Adapter dropdown was changed. Update state and re-render the editor.
            this.state.selectedConfig.adapter = adapter;
            this.updateEditor();
        }
    }

    handleSelect(item) {
        this.state.selectedConfig = item;
        this.updateView();
    }

    handleBackToConfigs() {
        this.state.selectedConfig = null;
        this.updateView();
    }

    async handleAdd() {
        try {
            const newConfig = await api.post('/api/connection-configs', { name: 'New Config' });
            // The view will update via SSE, but we can optimistically select the new config.
            this.state.selectedConfig = newConfig;
        } catch (error) {
            console.error('Failed to add config:', error);
            notifier.show({ header: 'Error', message: 'Failed to create new configuration.', type: 'bad' });
        }
    }

    handleDelete(item) {
        modal.confirm({
            title: 'Delete Configuration',
            content: `Are you sure you want to delete "${item.name}"? This action cannot be undone.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/connection-configs/${item.id}`);
                    // The view will automatically update via the SSE broadcast.
                    notifier.show({ header: 'Configuration Deleted', message: `"${item.name}" was removed.`, type: 'info' });
                } catch (error) {
                    console.error('Failed to delete config:', error);
                    notifier.show({ header: 'Error', message: `Could not delete ${item.name}.`, type: 'bad' });
                }
            }
        });
    }

    async handleActivate(item) {
        try {
            // Use the current active ID to determine if we are deactivating
            const newActiveId = this.state.activeConfigId === item.id ? 'null' : item.id;
            await api.post(`/api/connection-configs/${newActiveId}/activate`, {});
            // The view will automatically update via the SSE broadcast.
            const message = newActiveId !== 'null' ? `"${item.name}" is now the active connection.` : 'Active connection cleared.';
            notifier.show({ header: 'Connection Status Changed', message, type: 'good' });
        } catch (error) {
            console.error('Failed to activate config:', error);
            notifier.show({ header: 'Error', message: `Failed to activate ${item.name}.`, type: 'bad' });
        }
    }

    async handleSave(event) {
        event.preventDefault();
        const name = this.shadowRoot.querySelector('#config-name-input').value;
        const schemaData = this.schemaForm.serialize();
        const configData = { ...this.state.selectedConfig, ...schemaData, name };
        
        try {
            const savedConfig = await api.put(`/api/connection-configs/${configData.id}`, configData);
            // The view will automatically update via the SSE broadcast.
            notifier.show({ header: 'Configuration Saved', message: `"${savedConfig.name}" has been updated.`, type: 'good' });
        } catch (error) {
            console.error('Failed to save config:', error);
            notifier.show({ 
                header: 'Save Error', 
                message: 'Click for details.',
                type: 'bad',
                onClick: () => modal.show({ title: 'Save Error', content: error.message })
            });
        }
    }
    
    async handleTest() {
        const name = this.shadowRoot.querySelector('#config-name-input').value;
        const schemaData = this.schemaForm.serialize();
        const configData = { ...this.state.selectedConfig, ...schemaData, name };
        const testButton = this.shadowRoot.querySelector('#test-btn');
        testButton.disabled = true;
        testButton.textContent = 'Testing...';
        try {
            const result = await api.post('/api/connection-configs/test', configData);
            if (result.ok) {
                 notifier.show({ header: 'Test Successful', message: result.message, type: 'good' });
            } else {
                 notifier.show({ 
                    header: 'Test Failed', 
                    message: 'Click for details.',
                    type: 'bad',
                    onClick: () => modal.show({ title: 'Test Result', content: `❌ Failed\n\n${result.message}` })
                });
            }
        } catch (error) {
             notifier.show({ 
                header: 'Test Error', 
                message: 'Click for details.',
                type: 'bad',
                onClick: () => modal.show({ title: 'Test Error', content: error.message })
            });
        } finally {
            testButton.disabled = false;
            testButton.textContent = 'Test Connection';
        }
    }

    _renderConfigList() {
        if (!this.itemList) return;
        
        const itemsHtml = this.state.configs
            .sort((a,b) => a.name.localeCompare(b.name))
            .map(config => {
                const isSelected = this.state.selectedConfig?.id === config.id;
                const isActive = this.state.activeConfigId === config.id;
                const activateTitle = isActive ? 'Currently active' : 'Set as active config';
                const iconUrl = this.getAdapterIcon(config.adapter);

                return `
                    <li data-id="${config.id}" class="${isSelected ? 'selected' : ''}">
                        <div class="adapter-icon" style="--icon-url: url('${iconUrl}')"></div>
                        <div class="item-name">${config.name}</div>
                        <div class="actions">
                            <button class="icon-button activate-btn ${isActive ? 'active' : ''}" data-action="activate" title="${activateTitle}">
                                <span class="material-icons">${isActive ? 'radio_button_checked' : 'radio_button_off'}</span>
                            </button>
                            <button class="icon-button delete-btn" data-action="delete" title="Delete">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    </li>
                `;
            }).join('');
        
        this.itemList.innerHTML = itemsHtml;
    }
    
    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-editor-header');

        if (isMobile) {
            if (this.state.selectedConfig) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.state.selectedConfig.name || 'Edit Config';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
            }
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        this._renderConfigList();
        this.updateEditor();
    }
    
    updateEditor() {
        const formWrapper = this.shadowRoot.querySelector('.form-wrapper');
        const placeholder = this.shadowRoot.querySelector('.placeholder');

        if (!this.state.selectedConfig) {
            formWrapper.style.display = 'none';
            placeholder.style.display = 'block';
        } else {
            formWrapper.style.display = 'block';
            placeholder.style.display = 'none';

            this.shadowRoot.querySelector('#config-name-input').value = this.state.selectedConfig.name || '';

            const adapterOptions = Object.keys(this.state.adapterSchemas).map(id => {
                let label = id;
                if (id === 'v1') label = 'OpenAI-compatible';
                if (id === 'gemini') label = 'Google Gemini';
                return { value: id, label };
            });

            const baseSchema = [
                { name: 'adapter', label: 'Adapter Type', type: 'select', options: adapterOptions }
            ];

            const selectedAdapterId = this.state.selectedConfig.adapter || 'v1';
            const dynamicSchema = this.state.adapterSchemas[selectedAdapterId] || [];

            this.schemaForm.schema = [...baseSchema, ...dynamicSchema];
            this.schemaForm.data = this.state.selectedConfig;
        }
    }
    
    getAdapterIcon(adapter) {
        switch (adapter) {
            case 'v1':
                return 'assets/images/providers/v1.svg';
            case 'gemini':
                return 'assets/images/providers/gemini.svg';
            default:
                return 'assets/images/default_avatar.svg'; // Fallback
        }
    }

        render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-configs-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                    </header>
                    <div class="view-container">
                        <div class="placeholder">
                            <h2>Select a connection to configure.</h2>
                        </div>
                        <div class="form-wrapper" style="display: none;">
                            <form id="editor-form-container">
                                <header class="editor-header">
                                    <input type="text" id="config-name-input" class="editor-title-input" placeholder="Configuration Name">
                                </header>
                                <schema-form></schema-form>
                                <div class="button-group">
                                    <button type="submit" class="button-primary">Save Changes</button>
                                    <button type="button" id="test-btn" class="button-secondary">Test Connection</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
                <div class="panel-left">
                     <header id="list-header">
                        <h3>Connections</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="Add New Connection">
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
            
            .panel-main { display: flex; flex-direction: column; padding: 0; }
            .mobile-editor-header {
                display: none; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3); flex-shrink: 0; gap: var(--spacing-md);
            }
            .mobile-editor-header h2 { margin: 0; font-size: 1.1rem; flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #back-to-configs-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: var(--spacing-xs); }
            #back-to-configs-btn:hover { color: var(--text-primary); }

            .placeholder { text-align: center; margin-top: 2rem; color: var(--text-secondary); }
            
            .editor-header { margin-bottom: var(--spacing-lg); }
            .editor-title-input {
                font-size: 1.5rem; font-weight: 600; background: none; border: none; outline: none;
                width: 100%; color: var(--text-primary); border-bottom: 1px solid var(--bg-3); padding: var(--spacing-sm) 0;
            }
            .editor-title-input:focus { border-bottom-color: var(--accent-primary); }

            .button-group { display: flex; gap: var(--spacing-md); margin-top: var(--spacing-lg) }
            .button-group button { font-weight: 500; }

            /* ItemList Styles */
            item-list li {
                display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast); gap: var(--spacing-sm);
            }
            item-list li:hover { background-color: var(--bg-2); }
            item-list li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            item-list li.selected .item-name { font-weight: 600; }
            item-list .adapter-icon {
                width: 40px;
                height: 40px;
                flex-shrink: 0;
                background-color: var(--accent-primary);
                mask-image: var(--icon-url);
                -webkit-mask-image: var(--icon-url);
                mask-size: 80%;
                mask-repeat: no-repeat;
                mask-position: center;
            }
            item-list li.selected .adapter-icon {
                background-color: var(--bg-0);
            }
            item-list .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; }
            item-list .actions { display: flex; flex-shrink: 0; gap: var(--spacing-xs); }
            item-list .icon-button {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                transition: var(--transition-fast); display: flex; align-items: center;
                justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm);
            }
            item-list li:not(.selected) .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            item-list li.selected .icon-button:hover { color: var(--bg-1); }
            item-list .delete-btn:hover { color: var(--accent-danger); }
            item-list .activate-btn.active { color: var(--accent-primary); }
            item-list li.selected .activate-btn.active { color: var(--bg-0); }
        `;
    }
}
customElements.define('connection-config-view', ConnectionConfigView);