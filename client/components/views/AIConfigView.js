import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../SchemaForm.js';
import '../common/TextBox.js';
import '../common/TabContainer.js';

class AIConfigView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            // Connection Config State
            connectionConfigs: [],
            selectedConnectionConfig: null,
            activeConnectionConfigId: null,
            providerSchemas: {},
            
            // Generation Config State
            generationConfigs: [],
            selectedGenerationConfig: null,
            activeGenerationConfigId: null,
            providerParamSchemas: {},
            needsSave: false,
            
            // UI State
            activeTab: 'connection', // 'connection' or 'generation'
        };
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleBackToConfigs = this.handleBackToConfigs.bind(this);
        this.handleConnectionItemAction = this.handleConnectionItemAction.bind(this);
        this.handleGenerationItemAction = this.handleGenerationItemAction.bind(this);
        this._hasAutoSelectedFirst = false;
    }

    async connectedCallback() {
        this.render();
        this.tabContainer = this.shadowRoot.querySelector('tab-container');
        this.connectionList = this.shadowRoot.querySelector('#connection-list');
        this.generationList = this.shadowRoot.querySelector('#generation-list');
        this.connectionEditor = this.shadowRoot.querySelector('#connection-editor-form');
        this.connectionSchemaForm = this.shadowRoot.querySelector('#connection-schema-form');
        this.generationSchemaForm = this.shadowRoot.querySelector('#generation-schema-form');
        
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
        let selectedConfigWasDeleted = false;

        if (resourceType === 'connection_config') {
            switch (eventType) {
                case 'create':
                    this.state.connectionConfigs.push(data);
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
                    const initialLength = this.state.connectionConfigs.length;
                    if (this.state.selectedConnectionConfig?.id === data.id) {
                        this.state.selectedConnectionConfig = null;
                        selectedConfigWasDeleted = true;
                    }
                    this.state.connectionConfigs = this.state.connectionConfigs.filter(c => c.id !== data.id);
                    if (this.state.connectionConfigs.length < initialLength) {
                        changed = true;
                    }
                    break;
                }
            }
        } else if (resourceType === 'generation_config') {
            switch (eventType) {
                case 'create':
                    this.state.generationConfigs.push(data);
                    changed = true;
                    break;
                case 'update': {
                    const index = this.state.generationConfigs.findIndex(c => c.id === data.id);
                    if (index !== -1) {
                        this.state.generationConfigs[index] = data;
                        if (this.state.selectedGenerationConfig?.id === data.id) {
                            this.state.selectedGenerationConfig = JSON.parse(JSON.stringify(data));
                            this.setNeedsSave(false);
                        }
                        changed = true;
                    }
                    break;
                }
                case 'delete': {
                    const initialLength = this.state.generationConfigs.length;
                    this.state.generationConfigs = this.state.generationConfigs.filter(c => c.id !== data.id);
                    if (this.state.generationConfigs.length < initialLength) {
                        if (this.state.selectedGenerationConfig?.id === data.id) {
                            this.state.selectedGenerationConfig = null;
                            this.setNeedsSave(false);
                        }
                        changed = true;
                    }
                    break;
                }
            }
        } else if (resourceType === 'setting') {
            if (this.state.activeConnectionConfigId !== data.activeConnectionConfigId) {
                this.state.activeConnectionConfigId = data.activeConnectionConfigId;
                changed = true;
            }
            if (this.state.activeGenerationConfigId !== data.activeGenerationConfigId) {
                this.state.activeGenerationConfigId = data.activeGenerationConfigId;
                changed = true;
            }
        }

        if (changed) {
            const editorForm = this.shadowRoot.querySelector('#connection-schema-form, #generation-schema-form');
            const editorHasFocus = editorForm && editorForm.shadowRoot && editorForm.shadowRoot.contains(document.activeElement);

            if (editorHasFocus && !selectedConfigWasDeleted) {
                this.renderConfigLists();
            } else {
                this.updateView();
            }
        }
    }

    attachEventListeners() {
        // Tab switching
        this.tabContainer.addEventListener('tab-changed', (e) => {
            this.state.activeTab = e.detail.activeTab;
            this.updateView();
        });

        // Connection Config listeners
        this.connectionList.addEventListener('item-action', this.handleConnectionItemAction);
        this.shadowRoot.querySelector('#connection-list-header').addEventListener('click', (e) => {
            if (e.target.closest('[data-action="add"]')) this.handleConnectionAdd();
        });
        
        this.connectionEditor.addEventListener('submit', e => this.handleConnectionSave(e));
        this.shadowRoot.querySelector('#connection-test-btn').addEventListener('click', () => this.handleConnectionTest());
        this.connectionSchemaForm.addEventListener('change', e => this.handleConnectionFormChange(e.detail));

        // Generation Config listeners
        this.generationList.addEventListener('item-action', this.handleGenerationItemAction);
        this.shadowRoot.querySelector('#generation-list-header').addEventListener('click', (e) => {
            if (e.target.closest('[data-action="add"]')) this.handleGenerationAdd();
        });
        
        this.shadowRoot.querySelector('#generation-save-btn').addEventListener('click', () => this.saveGenerationConfig());
        this.shadowRoot.querySelector('#generation-name-input').addEventListener('input', () => this.setNeedsSave(true));
        this.shadowRoot.querySelector('#system-prompt-input').addEventListener('change', () => this.setNeedsSave(true));
        this.generationSchemaForm.addEventListener('change', () => this.setNeedsSave(true));

        // Back button
        this.shadowRoot.querySelector('#back-to-configs-btn').addEventListener('click', this.handleBackToConfigs);
    }

    async fetchData() {
        try {
            const [connectionConfigs, generationConfigs, settings, providerSchemas, paramSchemas] = await Promise.all([
                api.get('/api/connection-configs'),
                api.get('/api/generation-configs'),
                api.get('/api/settings'),
                api.get('/api/providers/schemas'),
                api.get('/api/providers/generation-schemas'),
            ]);
            
            this.state.connectionConfigs = connectionConfigs;
            this.state.generationConfigs = generationConfigs;
            this.state.activeConnectionConfigId = settings.activeConnectionConfigId;
            this.state.activeGenerationConfigId = settings.activeGenerationConfigId;
            this.state.providerSchemas = providerSchemas;
            this.state.providerParamSchemas = paramSchemas;
            
            // Auto-select first items if available
            if (!this._hasAutoSelectedFirst) {
                if (!this.state.selectedConnectionConfig && connectionConfigs.length > 0) {
                    const sortedConfigs = connectionConfigs.sort((a, b) => a.name.localeCompare(b.name));
                    this.state.selectedConnectionConfig = sortedConfigs[0];
                }
                if (!this.state.selectedGenerationConfig && generationConfigs.length > 0) {
                    const sortedConfigs = generationConfigs.sort((a, b) => a.name.localeCompare(b.name));
                    this.state.selectedGenerationConfig = JSON.parse(JSON.stringify(sortedConfigs[0]));
                }
                this._hasAutoSelectedFirst = true;
            }
            
            this.updateView();
        } catch (error) {
            console.error("Failed to fetch AI configuration data:", error);
            notifier.show({ header: 'Error', message: 'Could not load AI configuration data.' });
        }
    }

    // Connection Config handlers
    handleConnectionItemAction(event) {
        const { id, action } = event.detail;
        const config = this.state.connectionConfigs.find(c => c.id === id);
        if (!config) return;

        switch(action) {
            case 'select':
                this.state.selectedConnectionConfig = config;
                this.state.selectedGenerationConfig = null; // Clear other selection
                this.setNeedsSave(false); // Clear any unsaved changes from generation config
                this.updateView();
                break;
            case 'delete':
                this.handleConnectionDelete(config);
                break;
            case 'activate':
                this.handleConnectionActivate(config);
                break;
        }
    }

    handleConnectionFormChange({ provider }) {
        if (provider && this.state.selectedConnectionConfig) {
            this.state.selectedConnectionConfig.provider = provider;
            this.updateConnectionEditor();
        }
    }

    async handleConnectionAdd() {
        try {
            const newConfig = await api.post('/api/connection-configs', { name: 'New Connection Config' });
            this.state.selectedConnectionConfig = newConfig;
            this.state.selectedGenerationConfig = null; // Clear other selection
            this.setNeedsSave(false); // Clear any unsaved changes
        } catch (error) {
            console.error('Failed to add connection config:', error);
            notifier.show({ header: 'Error', message: 'Failed to create new connection configuration.', type: 'bad' });
        }
    }

    handleConnectionDelete(item) {
        modal.confirm({
            title: 'Delete Connection Configuration',
            content: `Are you sure you want to delete "${item.name}"? This action cannot be undone.`,
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/connection-configs/${item.id}`);
                    notifier.show({ header: 'Configuration Deleted', message: `"${item.name}" was removed.`, type: 'info' });
                } catch (error) {
                    console.error('Failed to delete connection config:', error);
                    notifier.show({ header: 'Error', message: `Could not delete ${item.name}.`, type: 'bad' });
                }
            }
        });
    }

    async handleConnectionActivate(item) {
        try {
            const newActiveId = this.state.activeConnectionConfigId === item.id ? 'null' : item.id;
            await api.post(`/api/connection-configs/${newActiveId}/activate`, {});
            const message = newActiveId !== 'null' ? `"${item.name}" is now the active connection.` : 'Active connection cleared.';
            notifier.show({ header: 'Connection Status Changed', message, type: 'good' });
        } catch (error) {
            console.error('Failed to activate connection config:', error);
            notifier.show({ header: 'Error', message: `Failed to activate ${item.name}.`, type: 'bad' });
        }
    }

    async handleConnectionSave(event) {
        event.preventDefault();
        const name = this.shadowRoot.querySelector('#connection-name-input').value;
        const schemaData = this.connectionSchemaForm.serialize();
        const configData = { ...this.state.selectedConnectionConfig, ...schemaData, name };
        
        try {
            const savedConfig = await api.put(`/api/connection-configs/${configData.id}`, configData);
            notifier.show({ header: 'Configuration Saved', message: `"${savedConfig.name}" has been updated.`, type: 'good' });
        } catch (error) {
            console.error('Failed to save connection config:', error);
            notifier.show({ 
                header: 'Save Error', 
                message: 'Click for details.',
                type: 'bad',
                onClick: () => modal.show({ title: 'Save Error', content: error.message })
            });
        }
    }
    
    async handleConnectionTest() {
        const name = this.shadowRoot.querySelector('#connection-name-input').value;
        const schemaData = this.connectionSchemaForm.serialize();
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

    // Generation Config handlers
    handleGenerationItemAction(event) {
        const { id, action } = event.detail;
        const config = this.state.generationConfigs.find(c => c.id === id);
        if (!config) return;

        switch(action) {
            case 'select':
                if (this.state.selectedGenerationConfig?.id !== config.id) {
                    this.state.selectedGenerationConfig = JSON.parse(JSON.stringify(config));
                    this.state.selectedConnectionConfig = null; // Clear other selection
                    this.setNeedsSave(false);
                    this.updateView();
                }
                break;
            case 'delete':
                this.handleGenerationDelete(config);
                break;
            case 'activate':
                this.handleGenerationActivate(config);
                break;
        }
    }

    async handleGenerationAdd() {
        try {
            const newConfig = await api.post('/api/generation-configs', {
                name: 'New Generation Config',
                systemPrompt: '',
            });
            this.state.generationConfigs.push(newConfig);
            this.state.selectedGenerationConfig = newConfig;
            this.state.selectedConnectionConfig = null; // Clear other selection
            this.setNeedsSave(false);
            this.updateView();
        } catch (error) {
            notifier.show({
                header: 'Error',
                message: 'Could not create generation config.',
                type: 'bad',
            });
        }
    }

    handleGenerationDelete(item) {
        modal.confirm({
            title: 'Delete Generation Config',
            content: `Are you sure you want to delete "${item.name}"?`,
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/generation-configs/${item.id}`);
                    this.state.generationConfigs = this.state.generationConfigs.filter(c => c.id !== item.id);
                    if (this.state.selectedGenerationConfig?.id === item.id) {
                        this.state.selectedGenerationConfig = null;
                        this.setNeedsSave(false);
                    }
                    this.updateView();
                    notifier.show({ message: `Deleted "${item.name}".` });
                } catch (error) {
                    notifier.show({
                        header: 'Error',
                        message: 'Could not delete config.',
                        type: 'bad',
                    });
                }
            },
        });
    }

    async handleGenerationActivate(item) {
        const newActiveId = this.state.activeGenerationConfigId === item.id ? 'null' : item.id;
        try {
            const settings = await api.post(`/api/generation-configs/${newActiveId}/activate`, {});
            this.state.activeGenerationConfigId = settings.activeGenerationConfigId;
            this.renderConfigLists();
            const message = newActiveId !== 'null' ? `"${item.name}" is now the active config.` : 'Active config cleared.';
            notifier.show({
                type: 'good',
                header: 'Config Activated',
                message,
            });
        } catch (error) {
            notifier.show({
                header: 'Error',
                message: 'Could not activate config.',
                type: 'bad',
            });
        }
    }

    async saveGenerationConfig() {
        if (!this.state.selectedGenerationConfig || !this.state.needsSave) return;

        const paramData = this.generationSchemaForm.serialize();
        const activeConnection = this.state.connectionConfigs.find(c => c.id === this.state.activeConnectionConfigId);
        const providerId = activeConnection?.provider;
        let parameters = this.state.selectedGenerationConfig.parameters;
        if (providerId) {
            parameters = { ...parameters, [providerId]: paramData };
        }

        const updatedConfig = {
            ...this.state.selectedGenerationConfig,
            name: this.shadowRoot.querySelector('#generation-name-input').value,
            systemPrompt: this.shadowRoot.querySelector('#system-prompt-input').value,
            parameters,
        };

        try {
            const saved = await api.put(`/api/generation-configs/${updatedConfig.id}`, updatedConfig);
            const index = this.state.generationConfigs.findIndex(c => c.id === saved.id);
            if (index !== -1) {
                this.state.generationConfigs[index] = saved;
            } else {
                this.state.generationConfigs.push(saved);
            }
            this.state.selectedGenerationConfig = JSON.parse(JSON.stringify(saved));
            this.renderConfigLists();
            notifier.show({
                header: 'Saved',
                message: `"${saved.name}" has been updated.`,
                type: 'good',
            });
            this.setNeedsSave(false);
        } catch (error) {
            notifier.show({
                header: 'Save Error',
                message: 'Could not save generation config.',
                type: 'bad',
            });
        }
    }

    setNeedsSave(needsSave) {
        this.state.needsSave = needsSave;
        const saveIndicator = this.shadowRoot.querySelector('.generation-save-indicator');
        const saveButton = this.shadowRoot.querySelector('#generation-save-btn');
        if (saveIndicator) {
            saveIndicator.style.opacity = needsSave ? '1' : '0';
        }
        if (saveButton) {
            saveButton.disabled = !needsSave;
        }
    }

    handleBackToConfigs() {
        this.state.selectedConnectionConfig = null;
        this.state.selectedGenerationConfig = null;
        this.setNeedsSave(false);
        this.updateView();
    }

    renderConfigLists() {
        this.renderConnectionList();
        this.renderGenerationList();
    }

    renderConnectionList() {
        if (!this.connectionList) return;
        
        const itemsHtml = this.state.connectionConfigs
            .sort((a,b) => a.name.localeCompare(b.name))
            .map(config => {
                const isSelected = this.state.selectedConnectionConfig?.id === config.id;
                const isActive = this.state.activeConnectionConfigId === config.id;
                const activateTitle = isActive ? 'Currently active' : 'Set as active config';
                const iconUrl = this.getProviderIcon(config.provider);

                return `
                    <li data-id="${config.id}" class="${isSelected ? 'selected' : ''}">
                        <div class="provider-icon" style="--icon-url: url('${iconUrl}')"></div>
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
        
        this.connectionList.innerHTML = itemsHtml;
    }

    renderGenerationList() {
        if (!this.generationList) return;

        const itemsHtml = this.state.generationConfigs
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((config) => {
                const isSelected = this.state.selectedGenerationConfig?.id === config.id;
                const isActive = this.state.activeGenerationConfigId === config.id;
                const activateTitle = isActive ? 'Currently active' : 'Set as active config';

                return `
                    <li data-id="${config.id}" class="${isSelected ? 'selected' : ''}">
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

        this.generationList.innerHTML = itemsHtml;
    }
    
    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-editor-header');

        // Determine if any config is selected (regardless of tab)
        const hasSelectedConfig = this.state.selectedConnectionConfig || this.state.selectedGenerationConfig;

        if (isMobile) {
            if (hasSelectedConfig) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                const selectedConfig = this.state.selectedConnectionConfig || this.state.selectedGenerationConfig;
                this.shadowRoot.querySelector('#editor-title-mobile').textContent = selectedConfig?.name || 'Edit Config';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
            }
        } else {
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        this.renderConfigLists();
        this.updateEditors();
    }
    
    updateEditors() {
        this.updateConnectionEditor();
        this.updateGenerationEditor();
    }

    updateConnectionEditor() {
        const formWrapper = this.shadowRoot.querySelector('.connection-form-wrapper');
        const placeholder = this.shadowRoot.querySelector('.connection-placeholder');

        // Show connection editor only if connection config is selected
        if (this.state.selectedConnectionConfig) {
            formWrapper.style.display = 'block';
            placeholder.style.display = 'none';

            this.shadowRoot.querySelector('#connection-name-input').value = this.state.selectedConnectionConfig.name || '';

            const providerOptions = Object.keys(this.state.providerSchemas).map(id => {
                let label = id;
                if (id === 'v1') label = 'OpenAI-compatible';
                if (id === 'gemini') label = 'Google Gemini';
                return { value: id, label };
            });

            const baseSchema = [
                { name: 'provider', label: 'Provider Type', type: 'select', options: providerOptions }
            ];

            const selectedProviderId = this.state.selectedConnectionConfig.provider || 'v1';
            const dynamicSchema = this.state.providerSchemas[selectedProviderId] || [];

            this.connectionSchemaForm.schema = [...baseSchema, ...dynamicSchema];
            this.connectionSchemaForm.data = this.state.selectedConnectionConfig;
        } else {
            formWrapper.style.display = 'none';
            // Only show connection placeholder if no config is selected AND connection tab is active
            placeholder.style.display = (!this.state.selectedGenerationConfig && this.state.activeTab === 'connection') ? 'block' : 'none';
        }
    }

    updateGenerationEditor() {
        const formWrapper = this.shadowRoot.querySelector('.generation-form-wrapper');
        const placeholder = this.shadowRoot.querySelector('.generation-placeholder');

        // Show generation editor only if generation config is selected
        if (this.state.selectedGenerationConfig) {
            formWrapper.style.display = 'block';
            placeholder.style.display = 'none';

            this.shadowRoot.querySelector('#generation-name-input').value = this.state.selectedGenerationConfig.name;
            this.shadowRoot.querySelector('#system-prompt-input').value = this.state.selectedGenerationConfig.systemPrompt || '';
            
            const activeConnection = this.state.connectionConfigs.find(c => c.id === this.state.activeConnectionConfigId);
            this.shadowRoot.querySelector('#active-provider-name').textContent = activeConnection?.provider || 'None';
            this.renderGenerationParameterFields();
        } else {
            formWrapper.style.display = 'none';
            // Only show generation placeholder if no config is selected AND generation tab is active
            placeholder.style.display = (!this.state.selectedConnectionConfig && this.state.activeTab === 'generation') ? 'block' : 'none';
        }
    }

    renderGenerationParameterFields() {
        const container = this.shadowRoot.querySelector('#param-fields-container');
        const activeConnection = this.state.connectionConfigs.find(c => c.id === this.state.activeConnectionConfigId);

        if (!activeConnection) {
            container.innerHTML = `<p class="notice">No active connection. Please set one in the Connection tab.</p>`;
            this.generationSchemaForm.style.display = 'none';
            return;
        }

        const providerId = activeConnection.provider;
        const schema = this.state.providerParamSchemas[providerId];

        if (!schema || schema.length === 0) {
            container.innerHTML = `<p class="notice">Provider "${providerId}" has no configurable parameters.</p>`;
            this.generationSchemaForm.style.display = 'none';
            return;
        }

        container.innerHTML = '';
        this.generationSchemaForm.style.display = 'block';

        const defaultParams = {};
        for (const field of schema) {
            if (field.defaultValue !== undefined) {
                defaultParams[field.name] = field.defaultValue;
            }
        }

        const savedParamsForProvider = this.state.selectedGenerationConfig.parameters[providerId] || {};
        const finalParams = { ...defaultParams, ...savedParamsForProvider };

        this.generationSchemaForm.data = finalParams;
        this.generationSchemaForm.schema = schema;
    }
    
    getProviderIcon(provider) {
        switch (provider) {
            case 'v1':
                return 'assets/images/providers/v1.svg';
            case 'gemini':
                return 'assets/images/providers/gemini.svg';
            default:
                return 'assets/images/default_avatar.svg';
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
                        <!-- Connection Config Editor -->
                        <div class="connection-placeholder">
                            <h2>Select a connection to configure.</h2>
                        </div>
                        <div class="connection-form-wrapper" style="display: none;">
                            <form id="connection-editor-form">
                                <header class="editor-header">
                                    <input type="text" id="connection-name-input" class="editor-title-input" placeholder="Connection Configuration Name">
                                </header>
                                <schema-form id="connection-schema-form"></schema-form>
                                <div class="button-group">
                                    <button type="submit" class="button-primary">Save Changes</button>
                                    <button type="button" id="connection-test-btn" class="button-secondary">Test Connection</button>
                                </div>
                            </form>
                        </div>

                        <!-- Generation Config Editor -->
                        <div class="generation-placeholder">
                            <h2>Select or create a generation config.</h2>
                        </div>
                        <div class="generation-form-wrapper" style="display: none;">
                            <header class="generation-editor-header">
                                <input type="text" id="generation-name-input" class="editor-title-input" placeholder="Generation Config Name">
                                <div class="header-controls">
                                   <span class="generation-save-indicator">Unsaved changes</span>
                                   <button id="generation-save-btn" class="button-primary" disabled>Save</button>
                                </div>
                            </header>
                            <div class="generation-editor-body">
                                <section>
                                    <h3>System Prompt</h3>
                                    <p class="section-desc">This prompt will be used as the system instruction. Supports macros like {{characters}}, {{notes}}, {{player}}, etc.</p>
                                    <text-box id="system-prompt-input" placeholder="Enter your system prompt here..."></text-box>
                                </section>
                                <section>
                                    <h3>Parameters</h3>
                                    <p class="section-desc">Settings for the currently active connection type (<span id="active-provider-name">None</span>).</p>
                                    <div id="param-fields-container"></div>
                                    <schema-form id="generation-schema-form"></schema-form>
                                </section>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="panel-left">
                    <tab-container>
                        <tab-panel tab-id="connection" tab-title="Connection">
                            <header id="connection-list-header">
                                <h3>Connections</h3>
                                <div class="header-actions">
                                    <button class="icon-button" data-action="add" title="Add New Connection">
                                        <span class="material-icons">add</span>
                                    </button>
                                </div>
                            </header>
                            <item-list id="connection-list"></item-list>
                        </tab-panel>
                        <tab-panel tab-id="generation" tab-title="Generation">
                            <header id="generation-list-header">
                                <h3>Generation Settings</h3>
                                <div class="header-actions">
                                    <button class="icon-button" data-action="add" title="Add New Config">
                                        <span class="material-icons">add</span>
                                    </button>
                                </div>
                            </header>
                            <item-list id="generation-list"></item-list>
                        </tab-panel>
                    </tab-container>
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

            .connection-placeholder, .generation-placeholder { text-align: center; margin-top: 2rem; color: var(--text-secondary); }
            
            .editor-header, .generation-editor-header { margin-bottom: var(--spacing-lg); display: flex; align-items: center; gap: var(--spacing-md); }
            .generation-editor-header { padding: var(--spacing-md) var(--spacing-lg); border-bottom: 1px solid var(--bg-3); }
            .editor-title-input {
                font-size: 1.5rem; font-weight: 600; background: none; border: none; outline: none;
                width: 100%; color: var(--text-primary); border-bottom: 1px solid var(--bg-3); padding: var(--spacing-sm) 0;
                flex-grow: 1;
            }
            .editor-title-input:focus { border-bottom-color: var(--accent-primary); }

            .header-controls { display: flex; align-items: center; gap: var(--spacing-md); }
            .generation-save-indicator { font-size: var(--font-size-sm); color: var(--accent-warn); opacity: 0; transition: opacity 0.3s; }
            #generation-save-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; opacity: 1; }

            .generation-editor-body { display: flex; flex-direction: column; gap: var(--spacing-lg); flex-grow: 1; overflow-y: auto; padding: var(--spacing-lg); }
            section { margin-bottom: var(--spacing-lg); }
            section:last-of-type { margin-bottom: 0; }
            section h3 { margin-bottom: var(--spacing-xs); }
            .section-desc { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacing-md); }
            .notice { color: var(--text-disabled); font-style: italic; background-color: var(--bg-0); padding: var(--spacing-sm); }
            #param-fields-container { margin-bottom: var(--spacing-md); }
            
            #system-prompt-input { 
                min-height: 200px; max-height: 400px; width: 100%; resize: vertical; 
                padding: 0.75rem; background-color: var(--bg-1); 
                border: 1px solid var(--bg-3); border-radius: var(--radius-md); 
                font-family: var(--font-family);
            }
            #system-prompt-input:focus-within { 
                border-color: var(--accent-primary); 
                box-shadow: none; 
            }

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
            item-list .provider-icon {
                width: 40px; height: 40px; flex-shrink: 0;
                background-color: var(--accent-primary);
                mask-image: var(--icon-url); -webkit-mask-image: var(--icon-url);
                mask-size: 80%; mask-repeat: no-repeat; mask-position: center;
            }
            item-list li.selected .provider-icon { background-color: var(--bg-0); }
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

            @media (max-width: 768px) {
                .generation-editor-body { padding: var(--spacing-md); }
                .generation-editor-header { padding: var(--spacing-sm) var(--spacing-md); gap: var(--spacing-sm); }
            }
        `;
    }
}

customElements.define('ai-config-view', AIConfigView);