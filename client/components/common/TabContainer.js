import { BaseComponent } from '../BaseComponent.js';

/**
 * A minimal tab container component.
 * 
 * Usage:
 * <tab-container>
 *   <button tab="library" slot="tabs">Library</button>
 *   <button tab="browse" slot="tabs">Browse</button>
 *   <div tab="library">Library content...</div>
 *   <div tab="browse">Browse content...</div>
 * </tab-container>
 */
class TabContainer extends BaseComponent {
    constructor() {
        super();
        this.activeTabId = null;
        this._isInitialized = false;
    }

    connectedCallback() {
        this.render();
        this.tabSlot = this.shadowRoot.querySelector('slot[name="tabs"]');
        this.contentSlot = this.shadowRoot.querySelector('slot:not([name])');

        // Listen for changes in slotted content
        this.tabSlot.addEventListener('slotchange', () => this.initialize());
        this.contentSlot.addEventListener('slotchange', () => this.initialize());
        
        // Run once in case content is already present
        this.initialize();
    }

    initialize() {
        // Prevent re-initialization
        if (this._isInitialized) return;
        
        this.tabs = this.tabSlot.assignedElements({ flatten: true }).flatMap(el => el.matches('[tab]') ? [el] : Array.from(el.querySelectorAll('[tab]')));
        this.panels = this.contentSlot.assignedElements({ flatten: true }).filter(el => el.hasAttribute('tab'));
        
        if (this.tabs.length === 0 || this.panels.length === 0) return;

        this._isInitialized = true;

        this.tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                this.setActiveTab(tab.getAttribute('tab'));
            });
        });

        const preSelectedTab = this.tabs.find(tab => tab.classList.contains('active'));
        if (preSelectedTab) {
            this.setActiveTab(preSelectedTab.getAttribute('tab'));
        } else if (this.tabs.length > 0) {
            // Default to the first tab if none are pre-selected
            this.setActiveTab(this.tabs[0].getAttribute('tab'));
        }
    }

    setActiveTab(tabId) {
        if (!tabId || this.activeTabId === tabId) return;

        this.activeTabId = tabId;

        this.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('tab') === tabId);
        });

        this.panels.forEach(panel => {
            const isTargetPanel = panel.getAttribute('tab') === tabId;
            // Use 'display: contents' if the panel is a simple wrapper like <div>
            // to avoid breaking flex/grid layouts of the child element.
            // Check if the panel is a simple div or has its own display style defined.
            // For now, '' will restore its default/stylesheet display property.
            panel.style.display = isTargetPanel ? '' : 'none';
        });

        this.dispatchEvent(new CustomEvent('tab-change', {
            detail: { activeTab: tabId },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        super._initShadow(`
            <style>
                :host {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    overflow: hidden;
                }
                .tab-header {
                    flex-shrink: 0;
                }
                .tab-content-container {
                    flex-grow: 1;
                    overflow: hidden;
                    position: relative; /* For containing positioned children */
                }
                /* Hide panels by default to prevent flash of unstyled content */
                ::slotted([tab]) {
                    display: none; 
                }
                /* The active panel should fill the container */
                ::slotted([tab][style=""]) {
                    height: 100%;
                }
            </style>
            <div class="tab-header">
                <slot name="tabs"></slot>
            </div>
            <div class="tab-content-container">
                <slot></slot>
            </div>
        `);
    }
}

customElements.define('tab-container', TabContainer);