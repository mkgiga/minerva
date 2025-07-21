// client/components/views/GenerationConfigView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../TextBox.js';
import '../SchemaForm.js';

class GenerationConfigView extends BaseComponent {
    #generationConfigs = [];
    #reusableStrings = [];
    #selectedGenConfig = null;
    #activeConnection = null;
    #adapterParamSchemas = {};
    #activeGenConfigId = null;
    #needsSave = false;

    #genConfigList = null; 

    constructor() {
        super();
        this.handleResourceChange = this.#handleResourceChange.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.#genConfigList = this.shadowRoot.querySelector('#gen-config-list');

        this.#attachEventListeners();
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
        await this.#fetchData();
        this.#setNeedsSave(false);
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
    }

    // Data Fetching
    async #fetchData() {
        try {
            const [genConfigs, strings, settings, connections, paramSchemas] = await Promise.all([
                api.get('/api/generation-configs'),
                api.get('/api/reusable-strings'),
                api.get('/api/settings'),
                api.get('/api/connection-configs'),
                api.get('/api/adapters/generation-schemas'),
            ]);
            this.#generationConfigs = genConfigs;
            this.#reusableStrings = strings;
            this.#adapterParamSchemas = paramSchemas;
            this.#activeGenConfigId = settings.activeGenerationConfigId;
            if (settings.activeConnectionConfigId) {
                this.#activeConnection = connections.find(c => c.id === settings.activeConnectionConfigId);
            }
            this.#updateView();
        } catch (error) {
            console.error("Failed to fetch data for Generation Config view:", error);
            notifier.show({ header: 'Error', message: 'Could not load generation config data.', type: 'bad' });
        }
    }

    // Event Listeners
    #attachEventListeners() {
        // Left Panel (Generation Configs)
        this.#genConfigList.addEventListener('item-action', e => this.#handleGenConfigItemAction(e.detail));
        this.shadowRoot.querySelector('#gen-config-list-header').addEventListener('click', e => {
            if(e.target.closest('[data-action="add"]')) this.#handleGenConfigAdd();
        });

        // Main Panel (Editor)
        this.shadowRoot.querySelector('#save-gen-config-btn').addEventListener('click', () => this.#saveGenConfig());
        this.shadowRoot.querySelector('#back-to-configs-btn').addEventListener('click', () => this.#handleBackToConfigs());
        this.shadowRoot.querySelector('#add-string-btn').addEventListener('click', () => this.#openAddStringModal());
        
        // Listen for changes on the name input and the schema form directly
        this.shadowRoot.querySelector('#gen-config-name').addEventListener('input', () => this.#setNeedsSave(true));
        this.shadowRoot.querySelector('schema-form').addEventListener('change', () => this.#setNeedsSave(true));
        this.shadowRoot.querySelector('#merge-strings-checkbox').addEventListener('change', () => this.#setNeedsSave(true));

        const promptStringsList = this.shadowRoot.querySelector('#prompt-strings-list');
        promptStringsList.addEventListener('click', e => {
            const button = e.target.closest('button[data-action]');
            if (!button || !this.#selectedGenConfig) return;
            
            e.stopPropagation();
            const action = button.dataset.action;
            const index = parseInt(button.dataset.index, 10);
            
            const promptStrings = this.#selectedGenConfig.promptStrings;

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
            this.#setNeedsSave(true);
            this.#renderPromptStringsList();
        });

        promptStringsList.addEventListener('change', e => {
            if (e.target.classList.contains('role-select')) {
                const index = parseInt(e.target.dataset.index, 10);
                const newRole = e.target.value;
                this.#selectedGenConfig.promptStrings[index].role = newRole;
                this.#setNeedsSave(true);
                this.#renderPromptStringsList();
            }
        });
    }

    #handleResourceChange(event) {
        const detail = event.detail;
        let needsFullUpdate = false;

        if (detail.resourceType === 'reusable_string') {
            let stringsChanged = false;
            switch (detail.eventType) {
                case 'create':
                    if (!this.#reusableStrings.some(s => s.id === detail.data.id)) {
                        this.#reusableStrings.push(detail.data);
                        stringsChanged = true;
                    }
                    break;
                case 'update': {
                    const index = this.#reusableStrings.findIndex(s => s.id === detail.data.id);
                    if (index > -1) {
                        this.#reusableStrings[index] = detail.data;
                        stringsChanged = true;
                    }
                    break;
                }
                case 'delete': {
                    const initialLength = this.#reusableStrings.length;
                    this.#reusableStrings = this.#reusableStrings.filter(s => s.id !== detail.data.id);
                    if (this.#reusableStrings.length < initialLength) {
                        stringsChanged = true;
                    }
                    break;
                }
            }
            if (stringsChanged) {
                this.#renderPromptStringsList();
            }
        } else if (detail.resourceType === 'generation_config') {
            switch (detail.eventType) {
                case 'create':
                    this.#generationConfigs.push(detail.data);
                    needsFullUpdate = true;
                    break;
                case 'update': {
                    const index = this.#generationConfigs.findIndex(c => c.id === detail.data.id);
                    if (index > -1) {
                        this.#generationConfigs[index] = detail.data;
                        if (this.#selectedGenConfig?.id === detail.data.id) {
                            this.#selectedGenConfig = JSON.parse(JSON.stringify(detail.data));
                        }
                        needsFullUpdate = true;
                    }
                    break;
                }
                case 'delete': {
                    const initialLength = this.#generationConfigs.length;
                    this.#generationConfigs = this.#generationConfigs.filter(c => c.id !== detail.data.id);
                    if (this.#generationConfigs.length < initialLength) {
                        if (this.#selectedGenConfig?.id === detail.data.id) {
                            this.#selectedGenConfig = null;
                            this.#setNeedsSave(false);
                        }
                        needsFullUpdate = true;
                    }
                    break;
                }
            }
        } else if (detail.resourceType === 'setting') {
            if (detail.data.activeGenerationConfigId !== this.#activeGenConfigId) {
                this.#activeGenConfigId = detail.data.activeGenerationConfigId;
                this.#updateGenConfigList();
            }
            if (detail.data.activeConnectionConfigId !== this.#activeConnection?.id) {
                this.#fetchData();
                return;
            }
        }

        if (needsFullUpdate) {
            this.#updateView();
        }
    }
    
    // State & Update Logic
    
    #setNeedsSave(needsSave) {
        this.#needsSave = needsSave;
        const saveIndicator = this.shadowRoot.querySelector('.save-indicator');
        const actualSaveButton = this.shadowRoot.querySelector('#save-gen-config-btn');
        if (saveIndicator) {
            saveIndicator.style.opacity = needsSave ? '1' : '0';
        }
        if (actualSaveButton) {
            actualSaveButton.disabled = !needsSave;
        }
    }

    #updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const panelLeft = this.shadowRoot.querySelector('.panel-left');
        const panelMain = this.shadowRoot.querySelector('.panel-main');
        const backButton = this.shadowRoot.querySelector('#back-to-configs-btn');
    
        if (isMobile) {
            if (this.#selectedGenConfig) {
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

        this.#updateGenConfigList();
        this.#updateMainPanel();
    }

    #updateGenConfigList() {
        if (!this.#genConfigList) return;

        const itemsHtml = this.#generationConfigs
            .sort((a,b) => a.name.localeCompare(b.name))
            .map(config => {
                const isSelected = this.#selectedGenConfig?.id === config.id;
                const isActive = this.#activeGenConfigId === config.id;
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
        
        this.#genConfigList.innerHTML = itemsHtml;
    }
    
    #updateMainPanel() {
        const mainPanel = this.shadowRoot.querySelector('.panel-main');
        const editor = mainPanel.querySelector('.editor-content');
        const placeholder = mainPanel.querySelector('.placeholder');

        if (this.#selectedGenConfig) {
            placeholder.style.display = 'none';
            editor.style.display = 'flex';
            editor.querySelector('#gen-config-name').value = this.#selectedGenConfig.name;
            this.shadowRoot.querySelector('#active-adapter-name').textContent = this.#activeConnection?.adapter || 'None';
            this.shadowRoot.querySelector('#merge-strings-checkbox').checked = this.#selectedGenConfig.mergeConsecutiveStrings || false;
            this.#renderParameterFields();
            this.#renderPromptStringsList();
        } else {
            placeholder.style.display = 'flex';
            editor.style.display = 'none';
        }
    }
    
    #renderParameterFields() {
        const schemaForm = this.shadowRoot.querySelector('schema-form');
        const container = this.shadowRoot.querySelector('#param-fields-container');

        if (!this.#activeConnection) {
            container.innerHTML = `<p class="notice">No active connection. Please set one in Connection Settings.</p>`;
            schemaForm.style.display = 'none';
            return;
        }

        const adapterId = this.#activeConnection.adapter;
        const schema = this.#adapterParamSchemas[adapterId];
        
        if (!schema || schema.length === 0) {
            container.innerHTML = `<p class="notice">Adapter "${adapterId}" has no configurable parameters.</p>`;
            schemaForm.style.display = 'none';
            return;
        }

        container.innerHTML = ''; // Clear any notices
        schemaForm.style.display = 'block';
        
        // 1. Create a default object from the schema's defaultValues
        const defaultParams = {};
        for (const field of schema) {
            if (field.defaultValue !== undefined) {
                defaultParams[field.name] = field.defaultValue;
            }
        }

        // 2. Merge saved parameters over the defaults
        // This ensures all schema fields have a value, either default or saved.
        const savedParamsForAdapter = this.#selectedGenConfig.parameters[adapterId] || {};
        const finalParams = { ...defaultParams, ...savedParamsForAdapter };
        
        schemaForm.data = finalParams; 
        schemaForm.schema = schema;
    }

    #renderPromptStringsList() {
        const container = this.shadowRoot.querySelector('#prompt-strings-list');
        container.innerHTML = '';
        if (!this.#selectedGenConfig || this.#selectedGenConfig.promptStrings.length === 0) {
            container.innerHTML = '<li class="notice">No strings added. Click "Add String" to build your prompt.</li>';
            return;
        }

        this.#selectedGenConfig.promptStrings.forEach((promptString, index) => {
            const string = this.#reusableStrings.find(s => s.id === promptString.stringId);
            if (!string) return; // Should not happen if data is consistent
            
            const isSystemString = string.id.startsWith('system-');
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
    
    // Event Handlers (renamed to private)

    #handleGenConfigItemAction({ id, action }) {
        const config = this.#generationConfigs.find(c => c.id === id);
        if (!config) return;

        switch (action) {
            case 'select':
                if (this.#selectedGenConfig?.id !== config.id) {
                    // Deep copy to prevent mutations from affecting the main list until saved
                    this.#selectedGenConfig = JSON.parse(JSON.stringify(config));
                    this.#setNeedsSave(false);
                    this.#updateView();
                }
                break;
            case 'delete':
                this.#handleGenConfigDelete(config);
                break;
            case 'activate':
                this.#handleGenConfigActivate(config);
                break;
        }
    }

    async #handleGenConfigAdd() {
        try {
            const newConfig = await api.post('/api/generation-configs', { name: 'New Config' });
            this.#generationConfigs.push(newConfig);
            this.#selectedGenConfig = newConfig;
            this.#setNeedsSave(false);
            this.#updateView();
        } catch (e) {
            notifier.show({ header: 'Error', message: 'Could not create generation config.', type: 'bad' });
        }
    }
    
    #handleGenConfigDelete(item) {
        modal.confirm({
            title: 'Delete Generation Config',
            content: `Are you sure you want to delete "${item.name}"?`,
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/generation-configs/${item.id}`);
                    this.#generationConfigs = this.#generationConfigs.filter(c => c.id !== item.id);
                    if (this.#selectedGenConfig?.id === item.id) {
                        this.#selectedGenConfig = null;
                        this.#setNeedsSave(false);
                    }
                    if (this.#activeGenConfigId === item.id) {
                        this.#activeGenConfigId = null;
                    }
                    this.#updateView();
                    notifier.show({ message: `Deleted "${item.name}".` });
                } catch (e) {
                    notifier.show({ header: 'Error', message: 'Could not delete config.', type: 'bad' });
                }
            }
        });
    }
    
    async #handleGenConfigActivate(item) {
        const newActiveId = this.#activeGenConfigId === item.id ? 'null' : item.id;
        try {
            const settings = await api.post(`/api/generation-configs/${newActiveId}/activate`, {});
            this.#activeGenConfigId = settings.activeGenerationConfigId;
            this.#updateGenConfigList();
            const message = newActiveId !== 'null' ? `"${item.name}" is now the active config.` : 'Active config cleared.';
            notifier.show({ type: 'good', header: 'Config Activated', message });
        } catch (error) {
            notifier.show({ header: 'Error', message: 'Could not activate config.', type: 'bad' });
        }
    }
    
    async #saveGenConfig() {
        if (!this.#selectedGenConfig || !this.#needsSave) return;
        
        const schemaForm = this.shadowRoot.querySelector('schema-form');
        const paramData = schemaForm.serialize();

        const adapterId = this.#activeConnection?.adapter;
        let parameters = this.#selectedGenConfig.parameters;
        if (adapterId) {
            parameters = { ...parameters, [adapterId]: paramData };
        }
        
        const updatedConfig = {
            ...this.#selectedGenConfig,
            name: this.shadowRoot.querySelector('#gen-config-name').value,
            mergeConsecutiveStrings: this.shadowRoot.querySelector('#merge-strings-checkbox').checked,
            // promptStrings are already updated directly on this.#selectedGenConfig
            parameters,
        };

        try {
            const saved = await api.put(`/api/generation-configs/${updatedConfig.id}`, updatedConfig);
            const index = this.#generationConfigs.findIndex(c => c.id === saved.id);
            if (index !== -1) {
                this.#generationConfigs[index] = saved;
            } else {
                this.#generationConfigs.push(saved);
            }
            // Update selectedGenConfig with the fresh data from the server
            this.#selectedGenConfig = JSON.parse(JSON.stringify(saved)); 
            
            this.#updateGenConfigList();
            notifier.show({ header: 'Saved', message: `"${saved.name}" has been updated.`, type: 'good'});
            this.#setNeedsSave(false);
        } catch (e) {
            notifier.show({ header: 'Save Error', message: 'Could not save generation config.', type: 'bad' });
        }
    }
    
    #openAddStringModal() {
        if (!this.#selectedGenConfig) return;

        const modalContent = document.createElement('div');
        const style = document.createElement('style');
        style.textContent = `
            #string-modal-list .avatar {
                width: 24px;
                height: 24px;
                background-color: var(--bg-3);
                border-radius: var(--radius-sm);
                flex-shrink: 0;
            }
            #string-modal-list li {
                display: flex;
                align-items: center;
                gap: var(--spacing-md);
                padding: var(--spacing-sm) var(--spacing-md);
                cursor: pointer;
            }
            #string-modal-list li:hover {
                background-color: var(--bg-2);
            }
        `;
        modalContent.appendChild(style);

        modalContent.style.height = '60vh';
        modalContent.style.display = 'flex';
        modalContent.style.flexDirection = 'column';

        const itemList = document.createElement('item-list');
        itemList.id = 'string-modal-list';
        modalContent.append(itemList);
        
        const sortedStrings = [...this.#reusableStrings].sort((a, b) => a.name.localeCompare(b.name));
        
        const renderStringList = () => {
            itemList.innerHTML = sortedStrings.map(s => {
                const isSystem = s.id.startsWith('system-');
                return `
                <li data-id="${s.id}" class="${isSystem ? 'system-defined' : ''}">
                    <img class="avatar" src="assets/images/system_icon.svg" alt="String icon">
                    <div class="item-name">${s.name}</div>
                </li>
            `}).join('');
        };
        
        const handleAction = e => {
            const { id, listItem } = e.detail;
            
            if (listItem && listItem.classList.contains('system-defined')) {
                notifier.show({ type: 'warn', message: 'System strings are managed automatically and cannot be added manually.' });
                return;
            }

            const selectedString = this.#reusableStrings.find(s => s.id === id);
            if (!selectedString) return;

            this.#selectedGenConfig.promptStrings.push({
                stringId: id,
                role: 'system' // Default role
            });
            this.#setNeedsSave(true);
            this.#renderPromptStringsList();
            modal.hide();
            notifier.show({ type: 'good', message: `Added "${selectedString.name}"` });
            itemList.removeEventListener('item-action', handleAction);
        };

        itemList.addEventListener('item-action', handleAction);
        
        modal.show({
            title: 'Add String to Sequence',
            content: modalContent,
            buttons: [{ label: 'Cancel', className: 'button-secondary', onClick: () => modal.hide() }]
        });
        
        renderStringList(); // Initial render
    }

    #handleBackToConfigs() {
        this.#selectedGenConfig = null;
        this.#setNeedsSave(false);
        this.#updateView();
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-left">
                    <header id="gen-config-list-header">
                        <h3>Generation Settings</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="Add New Config">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                    </header>
                    <item-list id="gen-config-list"></item-list>
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
                                <div class="section-header-with-controls">
                                    <h3>Prompt Sequence</h3>
                                    <div class="form-group-inline checkbox-group">
                                        <input type="checkbox" id="merge-strings-checkbox">
                                        <label for="merge-strings-checkbox">Merge consecutive strings of same role</label>
                                    </div>
                                </div>
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

            .panel-main { display: flex; flex-direction: column; background-color: var(--bg-0); padding: 0; }
            .panel-main .placeholder { flex-grow: 1; display: flex; align-items: center; justify-content: center; }
            .editor-content { display: none; flex-direction: column; height: 100%; overflow: hidden; }
            .editor-content header {
                display: flex; align-items: center; gap: var(--spacing-md); padding: var(--spacing-md) var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3); flex-shrink: 0; background-color: var(--bg-1);
            }
            #back-to-configs-btn {
                background: none; border: none; color: var(--text-secondary);
                cursor: pointer; padding: var(--spacing-xs); display: none;
            }
            #back-to-configs-btn:hover { color: var(--text-primary); }
            #back-to-configs-btn .material-icons { font-size: 1.5rem; }

            .editor-title-input { font-size: 1.25rem; font-weight: 600; background: none; border: none; outline: none; flex-grow: 1; color: var(--text-primary); }
            .header-controls { display: flex; align-items: center; gap: var(--spacing-md); }
            .save-indicator { font-size: var(--font-size-sm); color: var(--accent-warn); opacity: 0; transition: opacity 0.3s; }
            #save-gen-config-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; opacity: 1; }

            .editor-body { display: flex; flex-direction: column; gap: var(--spacing-lg); flex-grow: 1; overflow-y: auto; padding: var(--spacing-lg); background-color: var(--bg-1); border-radius: var(--radius-md); }
            section { margin-bottom: var(--spacing-lg); }
            section:last-of-type { margin-bottom: 0; }
            .section-header-with-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-xs); }
            .section-header-with-controls h3 { margin-bottom: 0; }
            .form-group-inline { display: flex; align-items: center; gap: var(--spacing-sm); }
            .checkbox-group label { font-size: var(--font-size-sm); color: var(--text-secondary); font-weight: 400; cursor: pointer; }
            .checkbox-group input[type="checkbox"] { margin: 0; }
            
            section h3 { margin-bottom: var(--spacing-xs); }
            .section-desc { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacing-md); }
            .notice { color: var(--text-disabled); font-style: italic; background-color: var(--bg-0); padding: var(--spacing-sm); }
            #param-fields-container { margin-bottom: var(--spacing-md); }
            #add-string-btn { width: 100%; margin-bottom: var(--spacing-md); padding: var(--spacing-sm) var(--spacing-md); }
            
            #prompt-strings-list { list-style: none; padding:0; display: flex; flex-direction: column; gap: var(--spacing-xs); }
            .used-string-item { display: flex; align-items: center; gap: var(--spacing-md); background: var(--bg-0); padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-sm); }
            .used-string-item.system-defined { background-color: var(--bg-2); }
            .used-string-item.system-defined .string-name { font-style: italic; color: var(--text-secondary); }
            
            .string-name { flex-grow: 1; }
            .string-controls { display: flex; align-items: center; gap: var(--spacing-sm); }
            .string-controls .role-select { padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--bg-3); background-color: var(--bg-1); }
            .string-controls .icon-btn { color: var(--text-secondary); padding: 4px; background: none; border: none; cursor: pointer; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
            .string-controls .icon-btn:hover { color: var(--text-primary); background: var(--bg-2); }
            .string-controls .icon-btn .material-icons { font-size: 1.1rem; }
            .string-actions { display: flex; }
            .string-actions .icon-btn { color: var(--text-secondary); padding: 4px; background: none; border: none; cursor: pointer; border-radius: 50%; display: flex; align-items: center;}
            .string-actions .icon-btn:hover { color: var(--text-primary); background: var(--bg-2); }
            .string-actions .icon-btn .material-icons { font-size: 1.25rem; }

            @media (max-width: 768px) {
                .editor-body { padding: var(--spacing-md); }
                .editor-content header { padding: var(--spacing-sm) var(--spacing-md); gap: var(--spacing-sm); }
                .section-header-with-controls { flex-direction: column; align-items: flex-start; gap: var(--spacing-xs); }
            }
        `;
    }
}
customElements.define('generation-config-view', GenerationConfigView);