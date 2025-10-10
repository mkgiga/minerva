// client/components/views/AIGenerationView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../SchemaForm.js';
import '../common/TextBox.js';

class AIGenerationView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            generationConfigs: [],
            selectedGenerationConfig: null,
            activeGenerationConfigId: null,
            providerParamSchemas: {},
            connectionConfigs: [],
            activeConnectionConfigId: null,
            needsSave: false,
        };
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this._hasAutoSelectedFirst = false;
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');
        this.schemaForm = this.shadowRoot.querySelector('#generation-schema-form');

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
        this.shadowRoot.querySelector('#list-header').addEventListener('click', e => {
            if (e.target.closest('[data-action="add"]')) this.handleAdd();
        });
        
        this.shadowRoot.querySelector('#save-btn').addEventListener('click', () => this.saveConfig());
        this.shadowRoot.querySelector('#save-btn-mobile').addEventListener('click', () => this.saveConfig());
        this.shadowRoot.querySelector('#generation-name-input').addEventListener('input', () => this.setNeedsSave(true));
        this.shadowRoot.querySelector('#system-prompt-input').addEventListener('change', () => this.setNeedsSave(true));
        this.schemaForm.addEventListener('change', () => this.setNeedsSave(true));
        this.shadowRoot.querySelector('#back-to-list-btn').addEventListener('click', () => this.handleBackToList());
    }

    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        let changed = false;

        if (resourceType === 'generation_config') {
            switch (eventType) {
                case 'create':
                    this.state.generationConfigs.push(data);
                    this.state.selectedGenerationConfig = JSON.parse(JSON.stringify(data));
                    this.setNeedsSave(false);
                    changed = true;
                    break;
                case 'update':
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
                case 'delete':
                    if (this.state.selectedGenerationConfig?.id === data.id) {
                        this.state.selectedGenerationConfig = null;
                        this.setNeedsSave(false);
                    }
                    this.state.generationConfigs = this.state.generationConfigs.filter(c => c.id !== data.id);
                    changed = true;
                    break;
            }
        } else if (resourceType === 'setting' || resourceType === 'connection_config') {
            this.fetchData(); // Refetch all data if settings or connections change
            return;
        }

        if (changed) {
            this.updateView();
        }
    }

    async fetchData() {
        try {
            const [genConfigs, settings, paramSchemas, connectionConfigs] = await Promise.all([
                api.get('/api/generation-configs'),
                api.get('/api/settings'),
                api.get('/api/providers/generation-schemas'),
                api.get('/api/connection-configs'),
            ]);
            this.state.generationConfigs = genConfigs;
            this.state.activeGenerationConfigId = settings.activeGenerationConfigId;
            this.state.providerParamSchemas = paramSchemas;
            this.state.connectionConfigs = connectionConfigs;
            this.state.activeConnectionConfigId = settings.activeConnectionConfigId;

            if (!this._hasAutoSelectedFirst && genConfigs.length > 0) {
                const sortedConfigs = genConfigs.sort((a,b) => a.name.localeCompare(b.name));
                this.state.selectedGenerationConfig = JSON.parse(JSON.stringify(sortedConfigs[0]));
                this._hasAutoSelectedFirst = true;
            }
            this.updateView();
        } catch (error) {
            notifier.show({ header: 'Error', message: 'Could not load generation configurations.' });
        }
    }

    handleItemAction(event) {
        const { id, action } = event.detail;
        const config = this.state.generationConfigs.find(c => c.id === id);
        if (!config) return;

        switch(action) {
            case 'select':
                if (this.state.selectedGenerationConfig?.id !== config.id) {
                    this.state.selectedGenerationConfig = JSON.parse(JSON.stringify(config));
                    this.setNeedsSave(false);
                    this.updateView();
                }
                break;
            case 'delete':
                this.handleDelete(config);
                break;
            case 'activate':
                this.handleActivate(config);
                break;
        }
    }

    async handleAdd() {
        await api.post('/api/generation-configs', { name: 'New Generation Config', systemPrompt: '' });
    }

    handleDelete(item) {
        modal.confirm({
            title: 'Delete Generation Config',
            content: `Are you sure you want to delete "${item.name}"?`,
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                await api.delete(`/api/generation-configs/${item.id}`);
                notifier.show({ message: `Deleted "${item.name}".` });
            },
        });
    }

    async handleActivate(item) {
        const newActiveId = this.state.activeGenerationConfigId === item.id ? 'null' : item.id;
        await api.post(`/api/generation-configs/${newActiveId}/activate`);
        notifier.show({ type: 'good', message: newActiveId !== 'null' ? `"${item.name}" is now active.` : 'Active config cleared.' });
    }

    async saveConfig() {
        if (!this.state.selectedGenerationConfig || !this.state.needsSave) return;

        const paramData = this.schemaForm.serialize();
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
        await api.put(`/api/generation-configs/${updatedConfig.id}`, updatedConfig);
        notifier.show({ type: 'good', message: `"${updatedConfig.name}" has been updated.` });
        this.setNeedsSave(false);
    }

    setNeedsSave(needsSave) {
        this.state.needsSave = needsSave;
        const saveIndicator = this.shadowRoot.querySelector('.save-indicator');
        const mobileSaveIndicator = this.shadowRoot.querySelector('.mobile-save-indicator');
        const saveButton = this.shadowRoot.querySelector('#save-btn');
        const mobileSaveButton = this.shadowRoot.querySelector('#save-btn-mobile');
        
        if (saveIndicator) saveIndicator.style.opacity = needsSave ? '1' : '0';
        if (mobileSaveIndicator) mobileSaveIndicator.style.opacity = needsSave ? '1' : '0';
        if (saveButton) saveButton.disabled = !needsSave;
        if (mobileSaveButton) mobileSaveButton.disabled = !needsSave;
    }

    handleBackToList() {
        this.state.selectedGenerationConfig = null;
        this.updateView();
    }

    #renderList() {
        const sortedConfigs = this.state.generationConfigs.sort((a, b) => a.name.localeCompare(b.name));
        this.itemList.innerHTML = sortedConfigs.map(config => {
            const isSelected = this.state.selectedGenerationConfig?.id === config.id;
            const isActive = this.state.activeGenerationConfigId === config.id;
            return `
                <li data-id="${config.id}" class="${isSelected ? 'selected' : ''}">
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
        if (this.state.selectedGenerationConfig) {
            editor.style.display = 'flex';
            this.shadowRoot.querySelector('#generation-name-input').value = this.state.selectedGenerationConfig.name;
            this.shadowRoot.querySelector('#editor-title-mobile').textContent = this.state.selectedGenerationConfig.name || 'Edit Config';
            this.shadowRoot.querySelector('#system-prompt-input').value = this.state.selectedGenerationConfig.systemPrompt || '';
            this.renderParameterFields();
        } else {
            editor.style.display = 'none';
        }
    }
    
    renderParameterFields() {
        const container = this.shadowRoot.querySelector('#param-fields-container');
        const activeConnection = this.state.connectionConfigs.find(c => c.id === this.state.activeConnectionConfigId);
        this.shadowRoot.querySelector('#active-provider-name').textContent = activeConnection?.provider || 'None';

        if (!activeConnection) {
            container.innerHTML = `<p class="notice">No active connection. Please set one in the Connections view.</p>`;
            this.schemaForm.style.display = 'none';
            return;
        }

        const providerId = activeConnection.provider;
        const schema = this.state.providerParamSchemas[providerId];

        if (!schema || schema.length === 0) {
            container.innerHTML = `<p class="notice">Provider "${providerId}" has no configurable parameters.</p>`;
            this.schemaForm.style.display = 'none';
            return;
        }

        container.innerHTML = '';
        this.schemaForm.style.display = 'block';
        const defaultParams = Object.fromEntries(schema.filter(f => f.defaultValue !== undefined).map(f => [f.name, f.defaultValue]));
        const savedParams = this.state.selectedGenerationConfig.parameters[providerId] || {};
        this.schemaForm.data = { ...defaultParams, ...savedParams };
        this.schemaForm.schema = schema;
    }

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelRightSidebar = this.shadowRoot.querySelector('.panel-right-sidebar');
        const panelMain = this.shadowRoot.querySelector('.panel-main');

        if (isMobile) {
            panelRightSidebar.style.display = this.state.selectedGenerationConfig ? 'none' : 'flex';
            panelMain.style.display = this.state.selectedGenerationConfig ? 'flex' : 'none';
        } else {
            panelRightSidebar.style.display = 'flex';
            panelMain.style.display = 'flex';
        }
        this.#renderList();
        this.updateEditor();
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-editor-header">
                        <button id="back-to-list-btn" class="icon-btn" title="Back"><span class="material-icons">arrow_back</span></button>
                        <h2 id="editor-title-mobile">Editor</h2>
                        <div class="mobile-header-controls">
                            <span class="save-indicator mobile-save-indicator">Unsaved changes</span>
                            <button id="save-btn-mobile" class="button-primary" disabled>Save</button>
                        </div>
                    </header>
                    <div class="editor-container">
                        <div class="placeholder"><h2>Select a generation config to edit.</h2></div>
                        <div class="editor-content">
                            <header class="main-editor-header">
                                <input type="text" id="generation-name-input" class="editor-title-input" placeholder="Generation Config Name">
                                <div class="header-controls">
                                   <span class="save-indicator">Unsaved changes</span>
                                   <button id="save-btn" class="button-primary" disabled>Save</button>
                                </div>
                            </header>
                            <div class="editor-body">
                                <section>
                                    <h3>System Prompt</h3>
                                    <p class="section-desc">Supports macros like {{characters}}, {{notes}}, {{player}}, etc.</p>
                                    <text-box id="system-prompt-input" placeholder="Enter system prompt..."></text-box>
                                </section>
                                <section>
                                    <h3>Parameters</h3>
                                    <p class="section-desc">For active provider: <span id="active-provider-name">None</span></p>
                                    <div id="param-fields-container"></div>
                                    <schema-form id="generation-schema-form"></schema-form>
                                </section>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="panel-right-sidebar">
                    <header id="list-header">
                        <h3>Generation Configs</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="New Config"><span class="material-icons">add</span></button>
                        </div>
                    </header>
                    <item-list></item-list>
                </div>
            </div>`, this.styles());
    }

    styles() { return `
        .panel-right-sidebar { flex-direction: column; }
        #list-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; }
        #list-header h3 { margin: 0; }
        .header-actions .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; transition: var(--transition-fast); display: flex; align-items: center; justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm); }
        .header-actions .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
        
        item-list { flex-grow: 1; overflow-y: auto; }
        item-list li { display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md); cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast); }
        item-list li:hover { background-color: var(--bg-2); }
        item-list li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
        .item-name { flex-grow: 1; font-weight: 500; }
        li.selected .item-name { font-weight: 600; }
        .actions { display: flex; gap: var(--spacing-xs); }
        .actions .icon-button { color: var(--text-secondary); }
        li.selected .actions .icon-button { color: var(--bg-0); }
        li:not(.selected) .actions .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
        .activate-btn.active { color: var(--accent-primary); }
        li.selected .activate-btn.active { color: var(--bg-0); }

        .panel-main { display: none; flex-direction: column; }
        .editor-container { padding: 0; overflow: hidden; height: 100%; display: flex; flex-direction: column; }
        .editor-content { display: none; flex-direction: column; height: 100%; }
        .panel-main[style*="display: flex"] .editor-content { display: flex; }
        .panel-main[style*="display: flex"] .placeholder { display: none; }
        .mobile-editor-header { display: none; align-items: center; padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; gap: var(--spacing-md); }
        #editor-title-mobile { font-size: 1.1rem; flex-grow: 1; }
        .mobile-header-controls { display: flex; align-items: center; gap: var(--spacing-sm); }
        .mobile-save-indicator { font-size: var(--font-size-sm); color: var(--accent-warn); opacity: 0; transition: opacity 0.3s; }
        #save-btn-mobile:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; }
        
        .main-editor-header { display: flex; align-items: center; gap: var(--spacing-md); padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md); border-bottom: 1px solid var(--bg-3); }
        .editor-title-input { font-size: 1.5rem; font-weight: 600; background: none; border: none; outline: none; width: 100%; color: var(--text-primary); flex-grow: 1; }
        .header-controls { display: flex; align-items: center; gap: var(--spacing-md); }
        .save-indicator { font-size: var(--font-size-sm); color: var(--accent-warn); opacity: 0; transition: opacity 0.3s; }
        #save-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; }
        .editor-body { flex-grow: 1; overflow-y: auto; padding: var(--spacing-lg); }
        .section-desc { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacing-md); }
        #system-prompt-input { min-height: 200px; max-height: 400px; box-sizing: border-box; width: 100%; border: 1px solid var(--bg-3); border-radius: var(--radius-sm); padding: var(--spacing-sm); font-family: inherit; font-size: 1rem; color: var(--text-primary); padding: var(--spacing-sm); }
        
        @media (max-width: 768px) {
            .mobile-editor-header { display: flex; }
            .main-editor-header { display: none; }
            .editor-container { padding: 0; }
            .editor-body { padding: var(--spacing-md); }
        }
    `;}
}
customElements.define('ai-generation-view', AIGenerationView);