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
export class TabContainer extends HTMLElement {
    #activeTab = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.render();
    }

    connectedCallback() {
        this.shadowRoot.addEventListener('click', this.#handleTabClick.bind(this));
        this.addEventListener('slotchange', this.#handleSlotChange.bind(this));
        
        // Initialize the first tab as active
        this.#initializeActiveTab();
    }

    #handleSlotChange() {
        this.#initializeActiveTab();
    }

    #initializeActiveTab() {
        const tabs = this.#getTabButtons();
        if (tabs.length > 0 && !this.#activeTab) {
            this.#setActiveTab(tabs[0].getAttribute('tab'));
        }
    }

    #handleTabClick(event) {
        const clickedTab = event.target.closest('[slot="tabs"][tab]');
        if (!clickedTab) return;

        const tabId = clickedTab.getAttribute('tab');
        this.#setActiveTab(tabId);
        
        this.dispatchEvent(new CustomEvent('tab-change', {
            detail: { activeTab: tabId },
            bubbles: true
        }));
    }

    #setActiveTab(tabId) {
        if (this.#activeTab === tabId) return;

        const tabButtons = this.#getTabButtons();
        const tabPanels = this.#getTabPanels();

        // Update button states
        tabButtons.forEach(button => {
            if (button.getAttribute('tab') === tabId) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        // Update panel visibility
        tabPanels.forEach(panel => {
            if (panel.getAttribute('tab') === tabId) {
                panel.style.display = 'block';
            } else {
                panel.style.display = 'none';
            }
        });

        this.#activeTab = tabId;
    }

    #getTabButtons() {
        return Array.from(this.querySelectorAll('[slot="tabs"][tab]'));
    }

    #getTabPanels() {
        return Array.from(this.querySelectorAll(':scope > [tab]:not([slot])'));
    }

    // Public API
    get activeTab() {
        return this.#activeTab;
    }

    setActiveTab(tabId) {
        this.#setActiveTab(tabId);
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    height: 100%;
                    margin: 0;
                    padding: 0;
                }

                .tab-buttons {
                    display: flex;
                    flex-shrink: 0;
                }

                .tab-panels {
                    flex: 1;
                    overflow: hidden;
                }
            </style>
            <div class="tab-buttons">
                <slot name="tabs"></slot>
            </div>
            <div class="tab-panels">
                <slot></slot>
            </div>
        `;
    }
}

customElements.define('tab-container', TabContainer);