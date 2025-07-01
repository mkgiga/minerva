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
    }

    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        let changed = false;

        if (resourceType === 'connection_config') {
            switch (eventType) {
                case 'create':
                    this.state.configs.push(data);
                    changed = true;
                    break;
                case 'update':
                    const index = this.state.configs.findIndex(c => c.id === data.id);
                    if (index !== -1) {
                        this.state.configs[index] = data;
                        if (this.state.selectedConfig?.id === data.id) {
                            this.state.selectedConfig = data;
                        }
                        changed = true;
                    }
                    break;
                case 'delete':
                    const initialLength = this.state.configs.length;
                    this.state.configs = this.state.configs.filter(c => c.id !== data.id);
                    if (this.state.configs.length < initialLength) {
                        if (this.state.selectedConfig?.id === data.id) {
                            this.state.selectedConfig = null;
                        }
                        changed = true;
                    }
                    break;
            }
        } else if (resourceType === 'setting') {
            if (this.state.activeConfigId !== data.activeConnectionConfigId) {
                this.state.activeConfigId = data.activeConnectionConfigId;
                changed = true;
            }
        }

        if (changed) {
            this.updateView();
        }
    }

    attachEventListeners() {
        this.itemList.addEventListener('item-select', e => this.handleSelect(e.detail.item));
        this.itemList.addEventListener('item-add', () => this.handleAdd());
        this.itemList.addEventListener('item-delete', e => this.handleDelete(e.detail.item));
        this.itemList.addEventListener('item-activate', e => this.handleActivate(e.detail.item));
        
        this.editorForm.addEventListener('submit', e => this.handleSave(e));
        this.shadowRoot.querySelector('#test-btn').addEventListener('click', () => this.handleTest());
        this.schemaForm.addEventListener('change', e => this.handleFormChange(e.detail));
        this.shadowRoot.querySelector('#back-to-configs-btn').addEventListener('click', this.handleBackToConfigs);
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


        this.itemList.activeId = this.state.activeConfigId;
        this.itemList.items = this.state.configs.map(c => ({...c, avatarUrl: this.getAdapterIcon(c.adapter)}));
        this.itemList.selectedId = this.state.selectedConfig?.id;
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
        // TODO: Replace with actual icons for adapters later.
        return 'assets/images/default_avatar.svg';
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <item-list
                        list-title="Connections"
                        items-creatable
                        items-removable
                        items-activatable
                        has-avatar>
                    </item-list>
                </div>
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
            </div>
        `, this.styles());
    }

    styles() {
        return `
            .panel-main {
                display: flex;
                flex-direction: column;
                padding: 0;
            }
            .mobile-editor-header {
                display: none;
                align-items: center;
                padding: var(--spacing-sm) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0;
                gap: var(--spacing-md);
            }
            .mobile-editor-header h2 {
                margin: 0;
                font-size: 1.1rem;
                flex-grow: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #back-to-configs-btn {
                background: none; border: none; color: var(--text-secondary);
                cursor: pointer; padding: var(--spacing-xs);
            }
            #back-to-configs-btn:hover { color: var(--text-primary); }

            .placeholder { text-align: center; margin-top: 2rem; color: var(--text-secondary); }
            
            .editor-header {
                margin-bottom: var(--spacing-lg);
            }
            .editor-title-input {
                font-size: 1.5rem;
                font-weight: 600;
                background: none;
                border: none;
                outline: none;
                width: 100%;
                color: var(--text-primary);
                border-bottom: 1px solid var(--bg-3);
                padding: var(--spacing-sm) 0;
            }
            .editor-title-input:focus {
                border-bottom-color: var(--accent-primary);
            }

            .button-group { display: flex; gap: var(--spacing-md); margin-top: var(--spacing-lg) }
            .button-group button { font-weight: 500; }
        `
    }
}
customElements.define('connection-config-view', ConnectionConfigView);