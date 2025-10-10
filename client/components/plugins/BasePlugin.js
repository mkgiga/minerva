import { BaseComponent } from '../BaseComponent.js';

/**
 * Base class for all plugin components.
 * Provides a standard interface and metadata for plugins.
 */
export class BasePlugin extends BaseComponent {
    constructor() {
        super();
        
        // Plugin metadata - should be overridden by subclasses
        this.metadata = {
            id: 'base-plugin',
            name: 'Base Plugin',
            version: '1.0.0',
            description: 'Base plugin class',
            author: 'System',
            icon: 'extension',
            category: 'utility',
            permissions: [],
            configurable: false
        };
        
        // Plugin state
        this.pluginState = {
            initialized: false,
            config: {},
            userPreferences: {}
        };
    }
    
    /**
     * Called when the plugin is first loaded
     * Override this to perform initialization tasks
     */
    async initialize() {
        this.pluginState.initialized = true;
    }
    
    /**
     * Called when the plugin is activated/shown
     * Override this to perform activation tasks
     */
    async onActivate() {
        if (!this.pluginState.initialized) {
            await this.initialize();
        }
    }
    
    /**
     * Called when the plugin is deactivated/hidden
     * Override this to perform cleanup tasks
     */
    async onDeactivate() {
        // Override in subclasses if needed
    }
    
    /**
     * Get plugin metadata
     * Can be used by the plugin system to display info
     */
    getMetadata() {
        return this.metadata;
    }
    
    /**
     * Get plugin configuration
     * Override this to provide plugin-specific configuration
     */
    getConfig() {
        return this.pluginState.config;
    }
    
    /**
     * Set plugin configuration
     * Override this to handle plugin-specific configuration
     */
    async setConfig(config) {
        this.pluginState.config = { ...this.pluginState.config, ...config };
    }
    
    /**
     * Get required permissions for this plugin
     * Can be used for future permission system
     */
    getRequiredPermissions() {
        return this.metadata.permissions || [];
    }
    
    /**
     * Check if plugin has a specific permission
     */
    hasPermission(permission) {
        // For now, all plugins have all permissions
        // This can be expanded with a proper permission system
        return true;
    }
    
    /**
     * Save plugin state to storage
     * Can be used for persisting plugin data
     */
    async saveState() {
        const stateKey = `plugin_state_${this.metadata.id}`;
        try {
            localStorage.setItem(stateKey, JSON.stringify(this.pluginState));
            return true;
        } catch (error) {
            console.error(`Failed to save plugin state for ${this.metadata.id}:`, error);
            return false;
        }
    }
    
    /**
     * Load plugin state from storage
     */
    async loadState() {
        const stateKey = `plugin_state_${this.metadata.id}`;
        try {
            const savedState = localStorage.getItem(stateKey);
            if (savedState) {
                const parsedState = JSON.parse(savedState);
                this.pluginState = { ...this.pluginState, ...parsedState };
                return true;
            }
        } catch (error) {
            console.error(`Failed to load plugin state for ${this.metadata.id}:`, error);
        }
        return false;
    }
    
    /**
     * Emit a plugin event
     * Can be used for inter-plugin communication
     */
    emitPluginEvent(eventName, data) {
        this.dispatch(`plugin-${eventName}`, {
            pluginId: this.metadata.id,
            ...data
        });
    }
    
    /**
     * Standard connectedCallback that handles plugin lifecycle
     */
    async connectedCallback() {
        await this.loadState();
        this.render();
        await this.onActivate();
        this.onPluginReady();
    }
    
    /**
     * Standard disconnectedCallback that handles plugin cleanup
     */
    async disconnectedCallback() {
        await this.saveState();
        await this.onDeactivate();
    }
    
    /**
     * Called when the plugin is fully ready
     * Override this to add event listeners or perform post-render tasks
     */
    onPluginReady() {
        // Override in subclasses
    }
    
    /**
     * Render method - must be implemented by subclasses
     */
    render() {
        throw new Error('Plugin must implement render() method');
    }
    
    /**
     * Helper method to create a standard plugin header
     */
    createPluginHeader() {
        return `
            <div class="plugin-header">
                <div class="plugin-title">
                    <span class="material-icons plugin-icon">${this.metadata.icon}</span>
                    <h3>${this.metadata.name}</h3>
                    <span class="plugin-version">v${this.metadata.version}</span>
                </div>
                <p class="plugin-description">${this.metadata.description}</p>
            </div>
        `;
    }
    
    /**
     * Helper method to get base plugin styles
     */
    getBaseStyles() {
        return `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }
            
            .plugin-container {
                height: 100%;
                overflow-y: auto;
                padding: var(--spacing-lg);
            }
            
            .plugin-header {
                margin-bottom: var(--spacing-lg);
                padding-bottom: var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3);
            }
            
            .plugin-title {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                margin-bottom: var(--spacing-sm);
            }
            
            .plugin-title h3 {
                margin: 0;
                color: var(--text-primary);
            }
            
            .plugin-icon {
                font-size: 1.5rem;
                color: var(--accent-primary);
            }
            
            .plugin-version {
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                background-color: var(--bg-2);
                padding: 2px 8px;
                border-radius: var(--radius-sm);
            }
            
            .plugin-description {
                margin: 0;
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }
            
            .plugin-content {
                padding: var(--spacing-lg) 0;
            }
            
            .plugin-error {
                background-color: rgba(242, 139, 130, 0.1);
                border: 1px solid var(--accent-danger);
                border-radius: var(--radius-sm);
                padding: var(--spacing-md);
                margin: var(--spacing-md) 0;
            }
            
            .plugin-error .material-icons {
                color: var(--accent-danger);
                margin-right: var(--spacing-sm);
            }
            
            .plugin-loading {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 200px;
                color: var(--text-secondary);
            }
            
            .plugin-loading .material-icons {
                font-size: 3rem;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
    }
}