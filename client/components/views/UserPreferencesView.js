// client/components/views/UserPreferencesView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, notifier, modal } from '../../client.js'; // Import modal for error details
import { chatModeRegistry } from '../../ChatModeRegistry.js';
import '../SchemaForm.js';

class UserPreferencesView extends BaseComponent {
    #chatSettingsForm = null;
    #chatModeSettingsContainer = null;
    #saveButton = null;
    #saveIndicator = null;
    #needsSave = false; // New state to track unsaved changes

    constructor() {
        super();
        this.state = {
            settings: null,
            connectionConfigs: [],
        };
        // Define the schema for the main chat settings (static)
        this.formSchema = {
            chat: [
                {
                    name: 'renderer',
                    label: 'Chat Renderer',
                    type: 'select',
                    options: [
                        { value: 'raw', label: 'Raw Text' },
                        { value: 'markdown', label: 'Markdown' },
                        { value: 'adventure', label: 'Adventure' },
                        { value: 'visual-novel', label: 'Visual Novel' },
                    ],
                    description: 'Determines how chat messages are displayed. Markdown supports rich text formatting and code blocks.'
                },
                {
                    name: 'curateResponse',
                    label: 'Curate/Enhance AI Responses',
                    type: 'checkbox',
                    defaultValue: false,
                    description: 'Passes the AI\'s response through a second prompt to enhance writing quality. May increase response time and cost.'
                },
                {
                    name: 'curationConnectionConfigId',
                    label: 'Curation Provider',
                    type: 'select',
                    options: [], // Populated dynamically
                    description: 'Optional: Select a specific connection to use for the curation step (e.g. a smaller local model). If blank, uses the main connection.'
                }
            ]
        };
        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleFormChange = this.handleFormChange.bind(this);
        this.saveSettings = this.saveSettings.bind(this); // Bind new save method
    }

    async connectedCallback() {
        // Initial render of the component's main structure
        this.render();

        this.#chatSettingsForm = this.shadowRoot.querySelector('#chat-settings-form');
        this.#chatModeSettingsContainer = this.shadowRoot.querySelector('#chat-mode-settings-container');
        this.#saveButton = this.shadowRoot.querySelector('#save-preferences-btn');
        this.#saveIndicator = this.shadowRoot.querySelector('.save-indicator');

        // Attach a single listener to the shadowRoot for all schema-form changes
        this.shadowRoot.addEventListener('change', this.handleFormChange);
        this.#saveButton.addEventListener('click', this.saveSettings); // Listen to save button click
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);

        // Initialize dynamic chat mode settings forms (creates the elements and sets their schema)
        this.#initChatModeSettingsForms();
        
        // Fetch settings and populate forms with actual data
        await this.fetchAllData();
        this.#setNeedsSave(false); // Ensure initial state is 'no unsaved changes'
    }
    
    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
        this.shadowRoot.removeEventListener('change', this.handleFormChange);
        this.#saveButton.removeEventListener('click', this.saveSettings);
    }
    
    handleResourceChange(event) {
        const { resourceType, data } = event.detail;
        if (resourceType === 'setting') {
            // When settings are broadcast, update the internal state and the forms.
            // Importantly, we reset #needsSave to false because the server confirms the change.
            this.state.settings = data;
            this.#updateSettingsForms();
            this.#setNeedsSave(false);
        } else if (resourceType === 'connection_config') {
            // Refresh connection list if configs change
            this.fetchConnections();
        }
    }

    async fetchAllData() {
        try {
            await Promise.all([
                this.fetchSettings(),
                this.fetchConnections()
            ]);
        } catch (error) {
            console.error('Failed to load data:', error);
            notifier.show({ header: 'Error', message: 'Could not load user preferences.', type: 'bad' });
        }
    }

    async fetchConnections() {
        try {
            const connections = await api.get('/api/connection-configs');
            this.state.connectionConfigs = connections;
            this.#updateSchemaOptions();
        } catch (error) {
            console.error('Failed to fetch connections:', error);
        }
    }

    async fetchSettings() {
        const settings = await api.get('/api/settings');
        this.state.settings = settings;
        this.#updateSettingsForms();
    }

    #updateSchemaOptions() {
        const curationField = this.formSchema.chat.find(f => f.name === 'curationConnectionConfigId');
        if (curationField) {
            const options = [{ value: '', label: 'Same as Main Connection' }];
            // Sort connections by name
            const sortedConnections = [...this.state.connectionConfigs].sort((a, b) => a.name.localeCompare(b.name));
            sortedConnections.forEach(c => {
                options.push({ value: c.id, label: c.name || 'Unnamed Connection' });
            });
            curationField.options = options;
        }
        
        // Update schema on the form component if it exists
        if (this.#chatSettingsForm) {
            this.#chatSettingsForm.schema = this.formSchema.chat;
            // Also need to re-apply data because setting schema might reset fields in some implementations
            if (this.state.settings) {
                this.#chatSettingsForm.data = this.state.settings.chat || {};
            }
        }
    }

    /**
     * Updates the `data` property of all schema-forms based on the current state.settings.
     * This method does not re-render the forms themselves, only their values.
     */
    #updateSettingsForms() {
        if (!this.state.settings) return;

        // Update main chat settings form
        if (this.#chatSettingsForm) {
            this.#chatSettingsForm.data = this.state.settings.chat || {};
        }

        // Update individual chat mode settings forms
        for (const form of this.#chatModeSettingsContainer.querySelectorAll('schema-form')) {
            const renderer = form.dataset.renderer;
            // Get the actual class using the registered tag name
            const ModeClass = customElements.get(chatModeRegistry.getTagName(renderer)); 
            
            // Re-merge defaults with saved settings for the specific mode
            const defaultSettings = ModeClass.getDefaultSettings ? ModeClass.getDefaultSettings() : {};
            const savedSettings = this.state.settings.chatModes?.[renderer] || {};
            form.data = { ...defaultSettings, ...savedSettings };
        }
    }

    /**
     * Sets the #needsSave flag and updates the visibility/enabled state of the save UI.
     * @param {boolean} needsSave - True if there are unsaved changes, false otherwise.
     */
    #setNeedsSave(needsSave) {
        this.#needsSave = needsSave;
        if (this.#saveButton) {
            this.#saveButton.disabled = !needsSave;
        }
        if (this.#saveIndicator) {
            this.#saveIndicator.style.opacity = needsSave ? '1' : '0';
        }
    }

    /**
     * Event handler for form changes. It just marks that changes are unsaved.
     * The actual saving happens when the user clicks the "Save" button.
     */
    handleFormChange() {
        this.#setNeedsSave(true);
    }
    
    /**
     * Handles the saving of all preferences.
     */
    async saveSettings() {
        if (!this.#needsSave || !this.state.settings) return;

        const mainChatSettings = this.#chatSettingsForm.serialize();
        const chatModeSettings = {};
        for (const form of this.#chatModeSettingsContainer.querySelectorAll('schema-form')) {
            const renderer = form.dataset.renderer;
            chatModeSettings[renderer] = form.serialize();
        }

        const settingsPayload = {
            chat: mainChatSettings,
            chatModes: chatModeSettings
        };
        
        try {
            await api.post('/api/settings', settingsPayload);
            notifier.show({ message: 'Settings saved.', type: 'good' });
            // Set needsSave to false immediately for better UX. The SSE will re-confirm.
            this.#setNeedsSave(false);
        } catch (error) {
            console.error('Failed to save settings:', error);
            notifier.show({ 
                header: 'Error', 
                message: 'Click for details.',
                type: 'bad',
                onClick: () => modal.show({ title: 'Save Error', content: error.message })
            });
            // On failure, refetch to revert the form to its actual server state.
            // This will also reset #needsSave to false.
            await this.fetchSettings();
            this.#setNeedsSave(false);
        }
    }

    /**
     * Renders the static structure of the UserPreferencesView and initializes
     * the main chat settings form. Dynamic chat mode forms are initialized separately.
     */
    render() {
        super._initShadow(`
            <div class="view-container">
                <header>
                    <h2>User Preferences</h2>
                    <div class="header-controls">
                        <span class="save-indicator">Unsaved changes</span>
                        <button id="save-preferences-btn" class="button-primary" disabled>Save</button>
                    </div>
                </header>
                <div class="preferences-grid">
                    <fieldset>
                        <legend>Appearance</legend>
                        <p class="placeholder-text">Theme and appearance settings will be available here in a future update.</p>
                    </fieldset>
                    <fieldset>
                        <legend>Chat</legend>
                        <schema-form id="chat-settings-form"></schema-form>
                    </fieldset>
                    <fieldset>
                        <legend>Chat Mode Settings</legend>
                        <div id="chat-mode-settings-container">
                             <p class="placeholder-text">Loading chat mode settings...</p>
                        </div>
                    </fieldset>
                </div>
            </div>
        `, this.styles());

        // Set the schema for the static chat settings form during initial render
        this.#chatSettingsForm = this.shadowRoot.querySelector('#chat-settings-form');
        if (this.#chatSettingsForm) {
            this.#chatSettingsForm.schema = this.formSchema.chat;
        }
    }

    /**
     * Initializes and appends the schema-form elements for each registered chat mode.
     * This is called once during connectedCallback to build the form structure.
     */
    #initChatModeSettingsForms() {
        if (!this.#chatModeSettingsContainer) return;

        this.#chatModeSettingsContainer.innerHTML = ''; // Clear initial placeholder

        const registeredModes = chatModeRegistry.getRegisteredModes();
        let hasSettings = false;

        for (const modeInfo of registeredModes) {
            const ModeClass = customElements.get(modeInfo.tagName);
            if (!ModeClass || typeof ModeClass.getSettingsSchema !== 'function') continue;

            const schema = ModeClass.getSettingsSchema();
            if (schema.length > 0) {
                hasSettings = true;
                const fieldset = document.createElement('fieldset');
                const legend = document.createElement('legend');
                // Display name for the mode (e.g., 'Raw', 'Markdown', 'Adventure')
                const modeDisplayName = modeInfo.renderer.charAt(0).toUpperCase() + modeInfo.renderer.slice(1).replace('-', ' ');
                legend.textContent = `${modeDisplayName} Mode Settings`;

                const form = document.createElement('schema-form');
                form.id = `chat-mode-settings-${modeInfo.renderer}`;
                form.dataset.renderer = modeInfo.renderer;
                form.schema = schema; // Set the schema here once

                fieldset.appendChild(legend);
                fieldset.appendChild(form);
                this.#chatModeSettingsContainer.appendChild(fieldset);
            }
        }

        if (!hasSettings) {
            this.#chatModeSettingsContainer.innerHTML = '<p class="placeholder-text">No configurable settings found for any installed chat modes.</p>';
        }
    }

    styles() {
        return `
            .view-container header {
                padding-bottom: var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
                margin-bottom: var(--spacing-lg);
                display: flex; /* Make header a flex container */
                justify-content: space-between; /* Space out title and controls */
                align-items: center; /* Vertically align items */
            }
            .view-container header h2 {
                margin: 0; /* Remove default margin from h2 */
            }
            .header-controls {
                display: flex;
                align-items: center;
                gap: var(--spacing-md);
            }
            .save-indicator {
                font-size: var(--font-size-sm);
                color: var(--accent-warn);
                opacity: 0;
                transition: opacity 0.3s;
            }
            #save-preferences-btn:disabled {
                background-color: var(--bg-2);
                color: var(--text-disabled);
                cursor: not-allowed;
                opacity: 1; /* Keep fully visible when disabled */
            }
            .preferences-grid {
                display: flex;
                flex-flow: row wrap;
                gap: var(--spacing-lg);
            }
            fieldset {
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-md);
                padding: var(--spacing-lg);
                min-width: 320px;
                flex: 1;
            }
            legend {
                padding: 0 var(--spacing-sm);
                font-weight: 600;
                color: var(--text-secondary);
            }
            .placeholder-text {
                color: var(--text-disabled);
            }
        `;
    }
}
customElements.define('user-preferences-view', UserPreferencesView);