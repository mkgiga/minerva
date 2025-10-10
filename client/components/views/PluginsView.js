import { BaseComponent } from '../BaseComponent.js';
import '../ItemList.js';

class PluginsView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            currentPlugin: null,
            plugins: [
                {
                    id: 'character-card-generator',
                    name: 'Character Card Generator',
                    description: 'Generate character cards using AI',
                    icon: 'auto_awesome',
                    component: 'character-card-generator-plugin'
                }
            ]
        };
    }

    connectedCallback() {
        this.render();
        this.attachEventListeners();
    }

    attachEventListeners() {
        this.shadowRoot.addEventListener('item-action', this.handleItemAction.bind(this));
        this.shadowRoot.addEventListener('plugin-back', this.handlePluginBack.bind(this));
    }

    handleItemAction(event) {
        const { id, action } = event.detail;
        if (action === 'select') {
            const plugin = this.state.plugins.find(p => p.id === id);
            if (plugin) {
                this.state.currentPlugin = plugin;
                this.updateView();
            }
        }
    }

    handlePluginBack() {
        this.state.currentPlugin = null;
        this.updateView();
    }

    updateView() {
        const listView = this.shadowRoot.querySelector('.plugins-list');
        const pluginView = this.shadowRoot.querySelector('.plugin-view');
        const backButton = this.shadowRoot.querySelector('.back-button');
        const headerTitle = this.shadowRoot.querySelector('.header-title');
        
        if (this.state.currentPlugin) {
            listView.style.display = 'none';
            pluginView.style.display = 'flex';
            backButton.style.display = 'flex';
            headerTitle.textContent = this.state.currentPlugin.name;
            
            pluginView.innerHTML = '';
            const pluginElement = document.createElement(this.state.currentPlugin.component);
            pluginView.appendChild(pluginElement);
        } else {
            listView.style.display = 'flex';
            pluginView.style.display = 'none';
            backButton.style.display = 'none';
            headerTitle.textContent = 'Plugins';
        }
    }

    render() {
        this._initShadow(`
            <div class="plugins-container">
                <div class="panel-main">
                    <header class="view-header">
                        <div class="header-left">
                            <button class="back-button icon-button" style="display: none;">
                                <span class="material-icons">arrow_back</span>
                            </button>
                            <h2 class="header-title">Plugins</h2>
                        </div>
                        <div class="header-controls">
                        </div>
                    </header>
                    
                    <div class="content-area">
                        <div class="plugins-list">
                            <item-list>
                                ${this.state.plugins.map(plugin => `
                                    <li data-id="${plugin.id}" class="plugin-item">
                                        <span class="material-icons plugin-icon">${plugin.icon}</span>
                                        <div class="plugin-info">
                                            <div class="plugin-name">${plugin.name}</div>
                                            <div class="plugin-description">${plugin.description}</div>
                                        </div>
                                        <span class="material-icons chevron">chevron_right</span>
                                    </li>
                                `).join('')}
                            </item-list>
                        </div>
                        
                        <div class="plugin-view" style="display: none;">
                        </div>
                    </div>
                </div>
                
                <div class="panel-right-sidebar">
                    <header>
                        <h3>About Plugins</h3>
                    </header>
                    <div class="sidebar-content">
                        <p>Plugins extend Minerva's functionality with specialized tools and utilities.</p>
                        <p>Select a plugin from the list to get started.</p>
                    </div>
                </div>
            </div>
        `, this.styles());
        
        this.shadowRoot.querySelector('.back-button').addEventListener('click', () => this.handlePluginBack());
    }

    styles() {
        return `
            :host { display: contents; }
            
            .plugins-container {
                display: contents;
            }
            
            .panel-main {
                display: flex;
                flex-direction: column;
                height: 100%;
                overflow: hidden;
            }
            
            .view-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: var(--spacing-md) var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0;
            }
            
            .header-left {
                display: flex;
                align-items: center;
                gap: var(--spacing-md);
            }
            
            .header-title {
                margin: 0;
            }
            
            .back-button {
                padding: var(--spacing-xs);
                background: transparent;
                border: none;
                color: var(--text-primary);
                cursor: pointer;
                border-radius: var(--radius-sm);
                transition: background-color 0.2s;
            }
            
            .back-button:hover {
                background-color: var(--bg-2);
            }
            
            .content-area {
                flex-grow: 1;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
            }
            
            .plugins-list {
                padding: var(--spacing-lg);
                display: flex;
                flex-direction: column;
                flex-grow: 1;
            }
            
            .plugin-item {
                display: flex;
                align-items: center;
                gap: var(--spacing-md);
                padding: var(--spacing-md);
                background-color: var(--bg-1);
                border-radius: var(--radius-sm);
                cursor: pointer;
                transition: background-color 0.2s;
                margin-bottom: var(--spacing-sm);
            }
            
            .plugin-item:hover {
                background-color: var(--bg-2);
            }
            
            .plugin-icon {
                font-size: 2rem;
                color: var(--accent-primary);
            }
            
            .plugin-info {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: var(--spacing-xs);
            }
            
            .plugin-name {
                font-weight: 500;
                color: var(--text-primary);
            }
            
            .plugin-description {
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
            }
            
            .chevron {
                color: var(--text-disabled);
            }
            
            .plugin-view {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                padding: var(--spacing-lg);
            }
            
            .panel-right-sidebar {
                display: flex;
                flex-direction: column;
                background-color: var(--bg-1);
                border-left: 1px solid var(--bg-3);
                min-width: 280px;
            }
            
            .panel-right-sidebar header {
                padding: var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
            }
            
            .panel-right-sidebar header h3 {
                margin: 0;
            }
            
            .sidebar-content {
                padding: var(--spacing-md);
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }
            
            .sidebar-content p {
                margin: 0 0 var(--spacing-md) 0;
            }
            
            .sidebar-content p:last-child {
                margin-bottom: 0;
            }
            
            @media (max-width: 768px) {
                .panel-right-sidebar {
                    display: none;
                }
                
                .plugins-list {
                    padding: var(--spacing-md);
                }
                
                .plugin-view {
                    padding: var(--spacing-md);
                }
            }
        `;
    }
}

customElements.define('plugins-view', PluginsView);