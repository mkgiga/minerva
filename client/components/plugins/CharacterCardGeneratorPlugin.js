import { BasePlugin } from './BasePlugin.js';
import { api, modal, notifier } from '../../client.js';

class CharacterCardGeneratorPlugin extends BasePlugin {
    constructor() {
        super();
        
        // Set plugin metadata
        this.metadata = {
            id: 'character-card-generator',
            name: 'Character Card Generator',
            version: '1.0.0',
            description: 'Generate detailed character cards using AI',
            author: 'Minerva',
            icon: 'auto_awesome',
            category: 'generation',
            permissions: ['api.chat', 'characters.create'],
            configurable: false
        };
        
        // Plugin-specific state
        this.state = {
            characterName: '',
            hint: '',
            isGenerating: false,
            generatedCard: null,
            connectionConfig: null
        };
    }

    async onActivate() {
        await super.onActivate();
        await this.loadConnectionConfig();
    }
    
    onPluginReady() {
        this.attachEventListeners();
    }

    async loadConnectionConfig() {
        try {
            // First get the settings to find the active connection config ID
            const settings = await api.get('/api/settings');
            const activeConfigId = settings.activeConnectionConfigId;
            
            if (activeConfigId) {
                // Get all connection configs (returns array directly)
                const configs = await api.get('/api/connection-configs');
                // Find the active one
                this.state.connectionConfig = configs.find(c => c.id === activeConfigId);
            }
            
            this.updateConfigDisplay();
        } catch (error) {
            console.error('Failed to load connection config:', error);
            this.state.connectionConfig = null;
            this.updateConfigDisplay();
        }
    }

    updateConfigDisplay() {
        const configInfo = this.shadowRoot.querySelector('.config-info');
        if (!configInfo) return; // Element might not be rendered yet
        
        if (this.state.connectionConfig) {
            const provider = this.state.connectionConfig.provider || 'Unknown';
            const model = this.state.connectionConfig.modelId || 'Not configured';
            configInfo.innerHTML = `
                <div class="config-status">
                    <span class="material-icons">check_circle</span>
                    <span>Using ${provider} - ${model}</span>
                </div>
            `;
        } else {
            configInfo.innerHTML = `
                <div class="config-status warning">
                    <span class="material-icons">warning</span>
                    <span>No API configuration found. Please configure your API connection first.</span>
                </div>
            `;
        }
    }

    attachEventListeners() {
        const nameInput = this.shadowRoot.querySelector('#character-name');
        const hintInput = this.shadowRoot.querySelector('#character-hint');
        const generateBtn = this.shadowRoot.querySelector('#generate-btn');
        const saveBtn = this.shadowRoot.querySelector('#save-btn');
        const clearBtn = this.shadowRoot.querySelector('#clear-btn');

        nameInput.addEventListener('input', (e) => {
            this.state.characterName = e.target.value;
        });

        hintInput.addEventListener('input', (e) => {
            this.state.hint = e.target.value;
        });

        generateBtn.addEventListener('click', () => this.generateCharacter());
        saveBtn.addEventListener('click', () => this.saveCharacter());
        clearBtn.addEventListener('click', () => this.clearForm());
    }

    async generateCharacter() {
        if (!this.state.characterName.trim()) {
            notifier.show({
                header: 'Validation Error',
                message: 'Please enter a character name',
                type: 'warning'
            });
            return;
        }

        if (!this.state.connectionConfig) {
            notifier.show({
                header: 'Configuration Required',
                message: 'Please configure your API connection first',
                type: 'error'
            });
            return;
        }

        this.state.isGenerating = true;
        this.updateGeneratingState();

        try {
            const systemPrompt = `# Instructions
The user will give you a character name, and optionally, a brief description or a reference to a 3rd party IP that the character is from.

Your task, is to generate an NPC character card for a single-player roleplaying game, using any knowledge you may have on this character to your advantage (if the character already exists).

# Language rules
- Avoid flowery, writerly language.
- Avoid abstract metaphors and idioms.
- Use a concise, matter-of-fact tone; avoid making your output melodramatic.
- Economy of words applies; pack the text so it is information-rich.

Essentially, pretend that you are writing a Wikipedia entry, but in a more compact form.

# Output Format

Use this exact format in your output(yes, we use markdown):

## Information
Sex: <sex>
Race: <race>
Age: <age descriptor, usually a number, or an estimate>
Height: <height descriptor, usually a number, or an estimate>
Weight: <weight descriptor, usually a number, or an estimate>
Manner of speech: <(optional) manner of speech, only include this if it is distinctive - e.g. stutters, uses slang, uses elderly speech, etc.>

## Appearance
<summary of character's physical appearance, usually a few paragraphs, but not enormous>

## Character
<summary of character's nature, usually a few paragraphs, but not enormous>
`;
            const userPrompt = `Create a character card for: ${this.state.characterName}${this.state.hint ? `\n\nAdditional context/hints: ${this.state.hint}` : ''}`;

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            const response = await fetch('/api/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages,
                    stream: false,
                    temperature: 0.8,
                    max_tokens: 8000  // Increased for better character generation
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.statusText}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            
            // Parse the plain text response
            let characterData;
            try {
                characterData = this.parseCharacterFromText(content);
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                throw new Error('Invalid response format from AI');
            }

            this.state.generatedCard = characterData;
            this.displayGeneratedCard();
            
            notifier.show({
                header: 'Success',
                message: 'Character card generated successfully!',
                type: 'success'
            });

        } catch (error) {
            console.error('Generation failed:', error);
            notifier.show({
                header: 'Generation Failed',
                message: error.message || 'Failed to generate character card',
                type: 'error'
            });
        } finally {
            this.state.isGenerating = false;
            this.updateGeneratingState();
        }
    }

    parseCharacterFromText(text) {
        const sections = {};
        
        // Split by ## headers
        const parts = text.split(/^##\s+/m).filter(p => p.trim());
        
        for (const part of parts) {
            const lines = part.split('\n');
            const header = lines[0].trim().toLowerCase();
            const content = lines.slice(1).join('\n').trim();
            
            switch(header) {
                case 'general information':
                    sections.generalInfo = content;
                    break;
                case 'general':
                    sections.general = content;
                    break;
                case 'appearance':
                    sections.appearance = content;
                    break;
                case 'character':
                    sections.character = content;
                    break;
            }
        }
        
        // Extract name from the General section (usually starts with the character's name)
        let name = this.state.characterName;
        if (sections.general) {
            const nameMatch = sections.general.match(/^([^.!?,]+)/);
            if (nameMatch) {
                name = nameMatch[1].trim();
            }
        }
        
        // Combine sections into the expected format
        const description = [
            sections.generalInfo || '',
            sections.general || '',
            sections.appearance || ''
        ].filter(s => s).join('\n\n');
        
        return {
            name: name,
            description: description,
            personality: sections.character || '',
            scenario: '',  // Not in the format you provided
            firstMessage: '',  // Not in the format you provided
            exampleDialogue: ''  // Not in the format you provided
        };
    }

    updateGeneratingState() {
        const generateBtn = this.shadowRoot.querySelector('#generate-btn');
        const spinner = this.shadowRoot.querySelector('.generating-spinner');
        const inputs = this.shadowRoot.querySelectorAll('input, textarea');
        
        if (this.state.isGenerating) {
            generateBtn.disabled = true;
            generateBtn.textContent = 'Generating...';
            spinner.style.display = 'flex';
            inputs.forEach(input => input.disabled = true);
        } else {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Character';
            spinner.style.display = 'none';
            inputs.forEach(input => input.disabled = false);
        }
    }

    displayGeneratedCard() {
        const resultContainer = this.shadowRoot.querySelector('.result-container');
        const card = this.state.generatedCard;
        
        if (!card) {
            resultContainer.style.display = 'none';
            return;
        }

        resultContainer.style.display = 'block';
        resultContainer.innerHTML = `
            <div class="generated-card">
                <h3>Generated Character Card</h3>
                
                <div class="card-section">
                    <h4>Name</h4>
                    <p>${card.name}</p>
                </div>
                
                <div class="card-section">
                    <h4>Description</h4>
                    <p>${card.description}</p>
                </div>
                
                <div class="card-section">
                    <h4>Personality</h4>
                    <p>${card.personality}</p>
                </div>
                
                <div class="card-section">
                    <h4>Scenario</h4>
                    <p>${card.scenario}</p>
                </div>
                
                <div class="card-section">
                    <h4>First Message</h4>
                    <p class="message-preview">${card.firstMessage}</p>
                </div>
                
                ${card.exampleDialogue ? `
                <div class="card-section">
                    <h4>Example Dialogue</h4>
                    <pre class="dialogue-preview">${card.exampleDialogue}</pre>
                </div>
                ` : ''}
                
                <div class="card-actions">
                    <button id="save-btn" class="button-primary">
                        <span class="material-icons">save</span>
                        Save Character
                    </button>
                    <button id="clear-btn" class="button-secondary">
                        <span class="material-icons">clear</span>
                        Clear
                    </button>
                </div>
            </div>
        `;
        
        // Re-attach event listeners for the new buttons
        this.shadowRoot.querySelector('#save-btn').addEventListener('click', () => this.saveCharacter());
        this.shadowRoot.querySelector('#clear-btn').addEventListener('click', () => this.clearForm());
    }

    async saveCharacter() {
        if (!this.state.generatedCard) {
            notifier.show({
                header: 'No Character',
                message: 'Please generate a character first',
                type: 'warning'
            });
            return;
        }

        try {
            const character = {
                ...this.state.generatedCard,
                tags: ['ai-generated'],
                metadata: {
                    generatedBy: 'Character Card Generator Plugin',
                    generatedAt: new Date().toISOString()
                }
            };

            const response = await api.post('/api/characters', character);
            
            notifier.show({
                header: 'Success',
                message: `Character "${character.name}" saved successfully!`,
                type: 'success'
            });

            // Ask if user wants to navigate to characters view
            modal.confirm({
                title: 'Character Saved',
                content: `Character "${character.name}" has been saved. Would you like to view your characters?`,
                confirmLabel: 'View Characters',
                onConfirm: () => {
                    this.dispatch('navigate-to-view', { viewPath: ['characters'] });
                }
            });

            this.clearForm();

        } catch (error) {
            console.error('Failed to save character:', error);
            notifier.show({
                header: 'Save Failed',
                message: error.message || 'Failed to save character',
                type: 'error'
            });
        }
    }

    clearForm() {
        this.state.characterName = '';
        this.state.hint = '';
        this.state.generatedCard = null;
        
        const nameInput = this.shadowRoot.querySelector('#character-name');
        const hintInput = this.shadowRoot.querySelector('#character-hint');
        const resultContainer = this.shadowRoot.querySelector('.result-container');
        
        nameInput.value = '';
        hintInput.value = '';
        resultContainer.style.display = 'none';
    }

    render() {
        this._initShadow(`
            <div class="plugin-container">
                ${this.createPluginHeader()}
                
                <div class="config-info"></div>
                
                <div class="generator-form">
                    <div class="form-group">
                        <label for="character-name">Character Name *</label>
                        <input 
                            type="text" 
                            id="character-name" 
                            placeholder="e.g., Elara Moonwhisper"
                            class="form-control"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label for="character-hint">Hints / Context (Optional)</label>
                        <textarea 
                            id="character-hint" 
                            placeholder="e.g., A wise elven mage from Lord of the Rings universe, specializes in healing magic..."
                            class="form-control"
                            rows="3"
                        ></textarea>
                        <span class="form-help">Provide any additional context, franchise, or characteristics you want the character to have</span>
                    </div>
                    
                    <div class="form-actions">
                        <button id="generate-btn" class="button-primary">
                            <span class="material-icons">auto_awesome</span>
                            Generate Character
                        </button>
                    </div>
                    
                    <div class="generating-spinner" style="display: none;">
                        <span class="material-icons spinning">refresh</span>
                        <p>Generating character card...</p>
                    </div>
                </div>
                
                <div class="result-container" style="display: none;"></div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            ${this.getBaseStyles()}
            
            .plugin-container {
                max-width: 800px;
                margin: 0 auto;
            }
            
            .config-info {
                margin-bottom: var(--spacing-lg);
            }
            
            .config-status {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                padding: var(--spacing-sm) var(--spacing-md);
                background-color: var(--bg-2);
                border-radius: var(--radius-sm);
                font-size: var(--font-size-sm);
            }
            
            .config-status .material-icons {
                font-size: 18px;
                color: var(--accent-success);
            }
            
            .config-status.error .material-icons {
                color: var(--accent-danger);
            }
            
            .config-status.warning .material-icons {
                color: var(--accent-warning, #ff9800);
            }
            
            .generator-form {
                background-color: var(--bg-1);
                padding: var(--spacing-lg);
                border-radius: var(--radius-md);
                margin-bottom: var(--spacing-lg);
            }
            
            .form-group {
                margin-bottom: var(--spacing-lg);
            }
            
            .form-group label {
                display: block;
                margin-bottom: var(--spacing-sm);
                font-weight: 500;
                color: var(--text-primary);
            }
            
            .form-control {
                width: 100%;
                padding: var(--spacing-sm) var(--spacing-md);
                background-color: var(--bg-2);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                color: var(--text-primary);
                font-size: var(--font-size-md);
                font-family: inherit;
            }
            
            .form-control:focus {
                outline: none;
                border-color: var(--accent-primary);
            }
            
            .form-control:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            textarea.form-control {
                resize: vertical;
                min-height: 80px;
            }
            
            .form-help {
                display: block;
                margin-top: var(--spacing-xs);
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
            }
            
            .form-actions {
                display: flex;
                gap: var(--spacing-md);
                justify-content: center;
            }
            
            .button-primary, .button-secondary {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                padding: var(--spacing-sm) var(--spacing-lg);
                border: none;
                border-radius: var(--radius-sm);
                font-size: var(--font-size-md);
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .button-primary {
                background-color: var(--accent-primary);
                color: white;
            }
            
            .button-primary:hover:not(:disabled) {
                background-color: var(--accent-primary-hover);
            }
            
            .button-secondary {
                background-color: var(--bg-2);
                color: var(--text-primary);
            }
            
            .button-secondary:hover:not(:disabled) {
                background-color: var(--bg-3);
            }
            
            button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .generating-spinner {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: var(--spacing-xl);
                color: var(--text-secondary);
            }
            
            .generating-spinner .material-icons {
                font-size: 3rem;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            
            .result-container {
                margin-bottom: var(--spacing-xl);
            }
            
            .generated-card {
                background-color: var(--bg-1);
                padding: var(--spacing-lg);
                border-radius: var(--radius-md);
            }
            
            .generated-card h3 {
                margin: 0 0 var(--spacing-lg) 0;
                color: var(--accent-primary);
            }
            
            .card-section {
                margin-bottom: var(--spacing-lg);
                padding-bottom: var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3);
            }
            
            .card-section:last-of-type {
                border-bottom: none;
            }
            
            .card-section h4 {
                margin: 0 0 var(--spacing-sm) 0;
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            
            .card-section p {
                margin: 0;
                color: var(--text-primary);
                line-height: 1.6;
            }
            
            .message-preview, .dialogue-preview {
                background-color: var(--bg-2);
                padding: var(--spacing-md);
                border-radius: var(--radius-sm);
                border-left: 3px solid var(--accent-primary);
            }
            
            .dialogue-preview {
                white-space: pre-wrap;
                font-family: inherit;
                font-size: var(--font-size-sm);
            }
            
            .card-actions {
                display: flex;
                gap: var(--spacing-md);
                justify-content: center;
                margin-top: var(--spacing-lg);
                padding-top: var(--spacing-lg);
                border-top: 1px solid var(--bg-3);
            }
            
            @media (max-width: 768px) {
                .generator-container {
                    padding: var(--spacing-md);
                }
                
                .generator-form {
                    padding: var(--spacing-md);
                }
                
                .generated-card {
                    padding: var(--spacing-md);
                }
            }
        `;
    }
}

customElements.define('character-card-generator-plugin', CharacterCardGeneratorPlugin);