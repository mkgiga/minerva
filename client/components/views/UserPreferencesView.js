// client/components/views/UserPreferencesView.js
import { BaseComponent } from '../BaseComponent.js';
import { api, notifier } from '../../client.js';
import '../SchemaForm.js';

class UserPreferencesView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            settings: null,
        };
        this.formSchema = {
            chat: [
                {
                    name: 'renderer',
                    label: 'Chat Renderer',
                    type: 'select',
                    options: [
                        { value: 'raw', label: 'Raw Text' },
                        { value: 'markdown', label: 'Markdown' },
                        { value: 'vn', label: 'Adventure' },
                    ],
                    description: 'Determines how chat messages are displayed. Markdown supports rich text formatting and code blocks.'
                }
            ]
        };
        this.handleResourceChange = this.handleResourceChange.bind(this);
    }

    async connectedCallback() {
        this.render();
        await this.fetchSettings();
        this.shadowRoot.querySelector('#chat-settings-form').addEventListener('change', this.handleFormChange.bind(this));
        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
    }
    
    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
    }
    
    handleResourceChange(event) {
        const { resourceType, data } = event.detail;
        if (resourceType === 'setting') {
            this.state.settings = data;
            this.updateForm();
        }
    }

    async fetchSettings() {
        try {
            const settings = await api.get('/api/settings');
            this.state.settings = settings;
            this.updateForm();
        } catch (error) {
            console.error('Failed to fetch settings:', error);
            notifier.show({ header: 'Error', message: 'Could not load user preferences.', type: 'bad' });
        }
    }

    updateForm() {
        const chatForm = this.shadowRoot.querySelector('#chat-settings-form');
        if (chatForm && this.state.settings) {
            chatForm.schema = this.formSchema.chat;
            chatForm.data = this.state.settings.chat || {};
        }
    }

    async handleFormChange() {
        if (!this.state.settings) return;
        
        const chatForm = this.shadowRoot.querySelector('#chat-settings-form');
        const chatSettings = chatForm.serialize();
        
        // Construct a payload containing only the setting group that changed.
        const settingsPayload = { chat: { ...this.state.settings.chat, ...chatSettings } };
        
        try {
            // Send the update. The view will be updated via the SSE broadcast.
            await api.post('/api/settings', settingsPayload);
            notifier.show({ message: 'Chat settings saved.', type: 'good' });
        } catch (error) {
            console.error('Failed to save settings:', error);
            notifier.show({ header: 'Error', message: 'Could not save chat settings.', type: 'bad' });
            // On failure, refetch to revert the form to its actual server state.
            this.fetchSettings();
        }
    }
    
    render() {
        super._initShadow(`
            <div class="view-container">
                <header><h2>User Preferences</h2></header>
                <div class="preferences-grid">
                    <fieldset>
                        <legend>Appearance</legend>
                        <p class="placeholder-text">Theme and appearance settings will be available here in a future update.</p>
                    </fieldset>
                    <fieldset>
                        <legend>Chat</legend>
                        <schema-form id="chat-settings-form"></schema-form>
                    </fieldset>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            .view-container header {
                padding-bottom: var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
                margin-bottom: var(--spacing-lg);
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