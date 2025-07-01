import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../TextBox.js';
import '../SchemaForm.js';

class GenerationConfigView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            generationConfigs: [],
            reusableStrings: [],
            selectedGenConfig: null,
            activeConnection: null,
            adapterParamSchemas: {},
            activeGenConfigId: null,
            needsSave: false,
        };
    }

    async connectedCallback() {
        this.render();
        this.attachEventListeners();
        await this.fetchData();
    }

    async fetchData() {
        try {
            const [genConfigs, strings, settings, connections, paramSchemas] = await Promise.all([
                api.get('/api/generation-configs'),
                api.get('/api/reusable-strings'),
                api.get('/api/settings'),
                api.get('/api/connection-configs'),
                api.get('/api/adapters/generation-schemas'),
            ]);
            this.state.generationConfigs = genConfigs;
            this.state.reusableStrings = strings;
            this.state.adapterParamSchemas = paramSchemas;
            this.state.activeGenConfigId = settings.activeGenerationConfigId;
            if (settings.activeConnectionConfigId) {
                this.state.activeConnection = connections.find(c => c.id === settings.activeConnectionConfigId);
            }
            this.updateView();
        } catch (error) {
            console.error("Failed to fetch data for Generation Config view:", error);
            notifier.show({ header: 'Error', message: 'Could not load generation config data.', type: 'bad' });
        }
    }

    attachEventListeners() {
        // Left Panel (Generation Configs)
        const genConfigList = this.shadowRoot.querySelector('#gen-config-list');
        genConfigList.addEventListener('item-select', e => this.handleGenConfigSelect(e.detail.item));
        genConfigList.addEventListener('item-add', () => this.handleGenConfigAdd());
        genConfigList.addEventListener('item-delete', e => this.handleGenConfigDelete(e.detail.item));
        genConfigList.addEventListener('item-activate', e => this.handleGenConfigActivate(e.detail.item));

        // Main Panel (Editor)
        this.shadowRoot.querySelector('#save-gen-config-btn').addEventListener('click', () => this.saveGenConfig());
        this.shadowRoot.querySelector('#back-to-configs-btn').addEventListener('click', () => this.handleBackToConfigs());
        this.shadowRoot.querySelector('#add-string-btn').addEventListener('click', () => this.openAddStringModal());
        
        this.shadowRoot.querySelector('.editor-content').addEventListener('input', e => {
             if (e.target.closest('schema-form') || e.target.id === 'gen-config-name') {
                this.setNeedsSave(true);
            }
        });

        const promptStringsList = this.shadowRoot.querySelector('#prompt-strings-list');
        promptStringsList.addEventListener('click', e => {
            const button = e.target.closest('button[data-action]');
            if (!button || !this.state.selectedGenConfig) return;
            
            e.stopPropagation();
            const action = button.dataset.action;
            const index = parseInt(button.dataset.index, 10);
            
            const promptStrings = this.state.selectedGenConfig.promptStrings;

            if (action === 'remove-string') {
                promptStrings.splice(index, 1);
            } else if (action === 'move-string-up' && index > 0) {
                [promptStrings[index], promptStrings[index - 1]] = [promptStrings[index - 1], promptStrings[index]];
            } else if (action === 'move-string-down' && index < promptStrings.length - 1) {
                [promptStrings[index], promptStrings[index + 1]] = [promptStrings[index + 1], promptStrings[index]];
            } else if (action === 'edit-string') {
                const stringId = button.dataset.stringId;
                this.dispatch('navigate-to-view', {
                    view: 'strings',
                    state: { selectedStringId: stringId }
                });
            }
            this.setNeedsSave(true);
            this.renderPromptStringsList();
        });

        promptStringsList.addEventListener('change', e => {
            if (e.target.classList.contains('role-select')) {
                const index = parseInt(e.target.dataset.index, 10);
                const newRole = e.target.value;
                this.state.selectedGenConfig.promptStrings[index].role = newRole;
                this.setNeedsSave(true);
                this.renderPromptStringsList(); // Re-render to ensure consistency if needed
            }
        });
    }
    
    // --- State & Update Logic ---
    
    setNeedsSave(needsSave) {
        this.state.needsSave = needsSave;
        const saveIndicator = this.shadowRoot.querySelector('.save-indicator');
        const saveButton = this.shadowRoot.querySelector('#save-gen-config-btn');
        if (saveIndicator) {
            saveIndicator.style.opacity = needsSave ? '1' : '0';
        }
        if (saveButton) {
            saveButton.disabled = !needsSave;
        }
    }

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const backButton = this.shadowRoot.querySelector('#back-to-configs-btn');
    
        if (isMobile) {
            if (this.state.selectedGenConfig) {
                panelLeft.style.display = 'none';
                panelMain.style.display = 'flex';
                if (backButton) backButton.style.display = 'flex';
            } else {
                panelLeft.style.display = 'flex';
                panelMain.style.display = 'none';
                if (backButton) backButton.style.display = 'none';
            }
        } else {
            // Desktop behavior
            panelLeft.style.display = 'flex';
            panelMain.style.display = 'flex';
            if (backButton) backButton.style.display = 'none';
        }

        this.updateGenConfigList();
        this.updateMainPanel();
    }

    updateGenConfigList() {
        const list = this.shadowRoot.querySelector('#gen-config-list');
        list.activeId = this.state.activeGenConfigId;
        list.items = this.state.generationConfigs.map(c => ({...c, avatarUrl: 'assets/images/default_avatar.svg'}));
        list.selectedId = this.state.selectedGenConfig?.id;
    }
    
    updateMainPanel() {
        const mainPanel = this.shadowRoot.querySelector('.panel-main');
        const editor = mainPanel.querySelector('.editor-content');
        const placeholder = mainPanel.querySelector('.placeholder');

        if (this.state.selectedGenConfig) {
            placeholder.style.display = 'none';
            editor.style.display = 'flex';
            editor.querySelector('#gen-config-name').value = this.state.selectedGenConfig.name;
            this.shadowRoot.querySelector('#active-adapter-name').textContent = this.state.activeConnection?.adapter || 'None';
            this.renderParameterFields();
            this.renderPromptStringsList();
        } else {
            placeholder.style.display = 'flex';
            editor.style.display = 'none';
        }
    }
    
    renderParameterFields() {
        const schemaForm = this.shadowRoot.querySelector('schema-form');
        const container = this.shadowRoot.querySelector('#param-fields-container');

        if (!this.state.activeConnection) {
            container.innerHTML = `<p class="notice">No active connection. Please set one in Connection Settings.</p>`;
            schemaForm.style.display = 'none';
            return;
        }

        const adapterId = this.state.activeConnection.adapter;
        const schema = this.state.adapterParamSchemas[adapterId];
        
        if (!schema || schema.length === 0) {
            container.innerHTML = `<p class="notice">Adapter "${adapterId}" has no configurable parameters.</p>`;
            schemaForm.style.display = 'none';
            return;
        }

        container.innerHTML = ''; // Clear any notices
        schemaForm.style.display = 'block';
        
        const configParams = this.state.selectedGenConfig.parameters[adapterId] || {};
        
        schemaForm.schema = schema;
        schemaForm.data = configParams;
    }

    renderPromptStringsList() {
        const container = this.shadowRoot.querySelector('#prompt-strings-list');
        container.innerHTML = '';
        if (!this.state.selectedGenConfig || !this.state.selectedGenConfig.promptStrings.length === 0) {
            container.innerHTML = '<li class="notice">No strings added. Click "Add String" to build your prompt.</li>';
            return;
        }

        this.state.selectedGenConfig.promptStrings.forEach((promptString, index) => {
            const string = this.state.reusableStrings.find(s => s.id === promptString.stringId);
            if (!string) return; // Should not happen if data is consistent
            
            const isSystemString = string.id === 'system-chat-history';
            const itemClass = isSystemString ? 'system-defined' : '';

            const roleSelectorHtml = isSystemString ? '' : `
                <select class="role-select" data-index="${index}" title="Set role for this string">
                    <option value="system" ${promptString.role === 'system' ? 'selected' : ''}>System</option>
                    <option value="user" ${promptString.role === 'user' ? 'selected' : ''}>User</option>
                    <option value="assistant" ${promptString.role === 'assistant' ? 'selected' : ''}>Assistant</option>
                </select>
            `;
            
            const editButtonHtml = isSystemString ? '' : `
                <button class="icon-btn" data-action="edit-string" data-string-id="${string.id}" title="Edit String"><span class="material-icons">edit</span></button>
            `;
            
            container.innerHTML += `
                <li class="used-string-item ${itemClass}" data-id="${string.id}">
                    <span class="string-name">${string.name}</span>
                    <div class="string-controls">
                        ${roleSelectorHtml}
                        ${editButtonHtml}
                    </div>
                    <div class="string-actions">
                        <button class="icon-btn" data-action="move-string-up" data-index="${index}" title="Move Up"><span class="material-icons">arrow_upward</span></button>
                        <button class="icon-btn" data-action="move-string-down" data-index="${index}" title="Move Down"><span class="material-icons">arrow_downward</span></button>
                        <button class="icon-btn" data-action="remove-string" data-index="${index}" title="Remove"><span class="material-icons">remove_circle_outline</span></button>
                    </div>
                </li>
            `;
        });
    }
    
    // --- Event Handlers ---

    handleGenConfigSelect(item) {
        if (this.state.selectedGenConfig?.id !== item.id) {
            // Find the full config object from state
            const fullConfig = this.state.generationConfigs.find(c => c.id === item.id);
            // Deep copy to prevent mutations from affecting the main list until saved
            this.state.selectedGenConfig = JSON.parse(JSON.stringify(fullConfig));
            this.setNeedsSave(false);
            this.updateView();
        }
    }

    async handleGenConfigAdd() {
        try {
            const newConfig = await api.post('/api/generation-configs', { name: 'New Config' });
            this.state.generationConfigs.push(newConfig);
            this.state.selectedGenConfig = newConfig;
            this.setNeedsSave(false);
            this.updateView();
        } catch (e) {
            notifier.show({ header: 'Error', message: 'Could not create generation config.', type: 'bad' });
        }
    }
    
    handleGenConfigDelete(item) {
        modal.confirm({
            title: 'Delete Generation Config',
            content: `Are you sure you want to delete "${item.name}"?`,
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/generation-configs/${item.id}`);
                    this.state.generationConfigs = this.state.generationConfigs.filter(c => c.id !== item.id);
                    if (this.state.selectedGenConfig?.id === item.id) {
                        this.state.selectedGenConfig = null;
                        this.setNeedsSave(false);
                    }
                    if (this.state.activeGenConfigId === item.id) {
                        this.state.activeGenConfigId = null;
                    }
                    this.updateView();
                    notifier.show({ message: `Deleted "${item.name}".` });
                } catch (e) {
                    notifier.show({ header: 'Error', message: 'Could not delete config.', type: 'bad' });
                }
            }
        });
    }
    
    async handleGenConfigActivate(item) {
        const newActiveId = this.state.activeGenConfigId === item.id ? 'null' : item.id;
        try {
            const settings = await api.post(`/api/generation-configs/${newActiveId}/activate`, {});
            this.state.activeGenConfigId = settings.activeGenerationConfigId;
            this.updateGenConfigList();
            const message = newActiveId !== 'null' ? `"${item.name}" is now the active config.` : 'Active config cleared.';
            notifier.show({ type: 'good', header: 'Config Activated', message });
        } catch (error) {
            notifier.show({ header: 'Error', message: 'Could not activate config.', type: 'bad' });
        }
    }
    
    async saveGenConfig() {
        if (!this.state.selectedGenConfig || !this.state.needsSave) return;
        
        const paramData = this.shadowRoot.querySelector('schema-form').serialize();

        const adapterId = this.state.activeConnection?.adapter;
        let parameters = this.state.selectedGenConfig.parameters;
        if (adapterId) {
            parameters = { ...parameters, [adapterId]: paramData };
        }
        
        const updatedConfig = {
            ...this.state.selectedGenConfig,
            name: this.shadowRoot.querySelector('#gen-config-name').value,
            promptStrings: this.state.selectedGenConfig.promptStrings,
            parameters,
        };

        try {
            const saved = await api.put(`/api/generation-configs/${updatedConfig.id}`, updatedConfig);
            const index = this.state.generationConfigs.findIndex(c => c.id === saved.id);
            this.state.generationConfigs[index] = saved;
            this.state.selectedGenConfig = JSON.parse(JSON.stringify(saved)); // Update with saved version
            
            this.updateGenConfigList(); // Update name in list
            notifier.show({ header: 'Saved', message: `"${saved.name}" has been updated.`, type: 'good'});
            this.setNeedsSave(false);
        } catch (e) {
            notifier.show({ header: 'Save Error', message: 'Could not save generation config.', type: 'bad' });
        }
    }
    
    openAddStringModal() {
        if (!this.state.selectedGenConfig) return;

        const listContainer = document.createElement('div');
        listContainer.style.height = '60vh';
        listContainer.style.display = 'flex';
        
        const itemList = document.createElement('item-list');
        itemList.setAttribute('list-title', 'Select a String to Add');
        listContainer.append(itemList);
        
        const sortedStrings = [...this.state.reusableStrings].sort((a, b) => a.name.localeCompare(b.name));
        itemList.items = sortedStrings.map(s => ({
            id: s.id,
            name: s.name,
            avatarUrl: 'assets/images/system_icon.svg'
        }));
        
        itemList.addEventListener('item-select', e => {
            this.state.selectedGenConfig.promptStrings.push({
                stringId: e.detail.item.id,
                role: 'system' // Default role
            });
            this.setNeedsSave(true);
            this.renderPromptStringsList();
            modal.hide();
            notifier.show({ type: 'good', message: `Added "${e.detail.item.name}"` });
        });
        
        modal.show({
            title: 'Add String to Sequence',
            content: listContainer,
            buttons: [{ label: 'Cancel', className: 'button-secondary', onClick: () => modal.hide() }]
        });
    }

    handleBackToConfigs() {
        this.state.selectedGenConfig = null;
        this.setNeedsSave(false);
        this.updateView();
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <item-list
                        id="gen-config-list"
                        list-title="Generation Settings"
                        items-creatable
                        items-removable
                        items-activatable
                        has-avatar>
                    </item-list>
                </div>
                <div class="panel-main">
                    <div class="placeholder"><h2>Select or create a generation config.</h2></div>
                    <div class="editor-content">
                        <header>
                            <button id="back-to-configs-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                            <input type="text" id="gen-config-name" class="editor-title-input" placeholder="Generation Config Name">
                            <div class="header-controls">
                               <span class="save-indicator">Unsaved changes</span>
                               <button id="save-gen-config-btn" class="button-primary" disabled>Save</button>
                            </div>
                        </header>
                        <div class="editor-body">
                            <section>
                                <h3>Parameters</h3>
                                <p class="section-desc">Settings for the currently active connection type (<span id="active-adapter-name">None</span>).</p>
                                <div id="param-fields-container"></div>
                                <schema-form></schema-form>
                            </section>
                            <section>
                                <h3>Prompt Sequence</h3>
                                <p class="section-desc">Strings are combined in this order to form the final prompt.</p>
                                <button id="add-string-btn" class="button-secondary">Add String</button>
                                <ul id="prompt-strings-list"></ul>
                            </section>
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
                background-color: var(--bg-0);
                padding: 0;
            }
            .panel-main .placeholder {
                flex-grow: 1; display: flex; align-items: center; justify-content: center;
            }
            .editor-content {
                display: none; /* Changed to flex in JS */
                flex-direction: column;
                height: 100%;
                overflow: hidden;
            }
            .editor-content header {
                display: flex;
                align-items: center;
                gap: var(--spacing-md);
                padding: var(--spacing-md) var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0;
                background-color: var(--bg-1);
            }
            #back-to-configs-btn {
                background: none; border: none; color: var(--text-secondary);
                cursor: pointer; padding: var(--spacing-xs); display: none;
            }
            #back-to-configs-btn:hover { color: var(--text-primary); }
            #back-to-configs-btn .material-icons { font-size: 1.5rem; }

            .editor-title-input {
                font-size: 1.25rem; font-weight: 600; background: none; border: none;
                outline: none; flex-grow: 1; color: var(--text-primary);
            }
            .header-controls {
                display: flex; align-items: center; gap: var(--spacing-md);
            }
            .save-indicator {
                font-size: var(--font-size-sm); color: var(--accent-warn);
                opacity: 0; transition: opacity 0.3s;
            }
            #save-gen-config-btn:disabled {
                background-color: var(--bg-2); color: var(--text-disabled);
                cursor: not-allowed; opacity: 1;
            }

            .editor-body {
                display: flex; flex-direction: column;
                gap: var(--spacing-lg);
                flex-grow: 1;
                overflow-y: auto;
                padding: var(--spacing-lg);
                background-color: var(--bg-1);
                border-radius: var(--radius-md);
            }

            section { margin-bottom: var(--spacing-lg); }
            section:last-of-type { margin-bottom: 0; }
            section h3 { margin-bottom: var(--spacing-xs); }
            .section-desc { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacing-md); }
            .notice { color: var(--text-disabled); font-style: italic; background-color: var(--bg-0); padding: var(--spacing-sm); }
            
            #param-fields-container { margin-bottom: var(--spacing-md); }
            #add-string-btn { width: 100%; margin-bottom: var(--spacing-md); padding: var(--spacing-sm) var(--spacing-md); }
            
            #prompt-strings-list { list-style: none; padding:0; display: flex; flex-direction: column; gap: var(--spacing-xs); }
            .used-string-item {
                display: flex; align-items: center; gap: var(--spacing-md);
                background: var(--bg-0); padding: var(--spacing-sm) var(--spacing-md);
                border-radius: var(--radius-sm);
            }
            .used-string-item.system-defined { background-color: var(--bg-2); }
            .used-string-item.system-defined .string-name { font-style: italic; color: var(--text-secondary); }
            
            .string-name { flex-grow: 1; }

            .string-controls { display: flex; align-items: center; gap: var(--spacing-sm); }
            .string-controls .role-select {
                padding: 4px 8px;
                border-radius: var(--radius-sm);
                border: 1px solid var(--bg-3);
                background-color: var(--bg-1);
            }
            .string-controls .icon-btn {
                color: var(--text-secondary); padding: 4px; background: none; border: none; cursor: pointer;
                border-radius: 50%; display: flex; align-items: center; justify-content: center;
            }
             .string-controls .icon-btn:hover { color: var(--text-primary); background: var(--bg-2); }
            .string-controls .icon-btn .material-icons { font-size: 1.1rem; }
            
            .string-actions { display: flex; }
            .string-actions .icon-btn { color: var(--text-secondary); padding: 4px; background: none; border: none; cursor: pointer; border-radius: 50%; display: flex; align-items: center;}
            .string-actions .icon-btn:hover { color: var(--text-primary); background: var(--bg-2); }
            .string-actions .icon-btn .material-icons { font-size: 1.25rem; }

            @media (max-width: 768px) {
                .editor-body { padding: var(--spacing-md); }
                .editor-content header { padding: var(--spacing-sm) var(--spacing-md); gap: var(--spacing-sm); }
            }
        `;
    }
}
customElements.define('generation-config-view', GenerationConfigView);