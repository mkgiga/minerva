import { BaseComponent } from '../BaseComponent.js';

/**
 * A standalone dropdown menu component that can be positioned anywhere.
 *
 * Usage:
 * const dropdown = document.createElement('dropdown-menu');
 * dropdown.setItems([
 *   { icon: 'copy', label: 'Copy', action: 'copy' },
 *   { icon: 'edit', label: 'Edit', action: 'edit' },
 *   { divider: true },
 *   { icon: 'delete', label: 'Delete', action: 'delete', danger: true }
 * ]);
 * dropdown.addEventListener('menu-action', (e) => {
 *   console.log('Action:', e.detail.action);
 * });
 * dropdown.open(x, y); // Open at specific coordinates
 */
class DropdownMenu extends BaseComponent {
    constructor() {
        super();
        this.items = [];
        this.render();

        // Bind methods
        this.handleOutsideClick = this.handleOutsideClick.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleItemClick = this.handleItemClick.bind(this);
    }

    connectedCallback() {
        this.attachEventListeners();
    }

    disconnectedCallback() {
        this.close();
        document.removeEventListener('click', this.handleOutsideClick);
        document.removeEventListener('keydown', this.handleKeydown);
    }

    attachEventListeners() {
        const menu = this.shadowRoot.querySelector('.dropdown-menu');
        menu.addEventListener('click', this.handleItemClick);
    }

    handleItemClick(event) {
        const item = event.target.closest('.menu-item');
        if (!item || item.classList.contains('divider')) return;

        const action = item.dataset.action;
        if (action) {
            this.dispatch('menu-action', { action });
            this.close();
        }
    }

    handleOutsideClick(event) {
        // Check if click is outside this component
        if (!this.contains(event.target) && !event.composedPath().includes(this)) {
            this.close();
        }
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            this.close();
        }
    }

    /**
     * Opens the dropdown at a specific position relative to a trigger element
     * @param {HTMLElement} triggerElement - The element that triggered the dropdown
     */
    open(triggerElement) {
        if (!triggerElement) return;

        // Make the host visible
        this.classList.add('active');

        const menu = this.shadowRoot.querySelector('.dropdown-menu');

        // Position the menu relative to the trigger
        this.positionMenu(triggerElement);

        // Add open class for animation
        setTimeout(() => menu.classList.add('open'), 10);

        // Add global listeners
        setTimeout(() => {
            document.addEventListener('click', this.handleOutsideClick);
            document.addEventListener('keydown', this.handleKeydown);
        }, 0);
    }

    close() {
        const menu = this.shadowRoot.querySelector('.dropdown-menu');
        menu.classList.remove('open');

        // Hide the host after animation
        setTimeout(() => this.classList.remove('active'), 200);

        // Remove global listeners
        document.removeEventListener('click', this.handleOutsideClick);
        document.removeEventListener('keydown', this.handleKeydown);
    }

    positionMenu(triggerElement) {
        const menu = this.shadowRoot.querySelector('.dropdown-menu');

        // Get the trigger's position relative to the viewport
        const triggerRect = triggerElement.getBoundingClientRect();

        // Initially position the menu to get its dimensions
        menu.style.position = 'fixed';
        menu.style.visibility = 'hidden';
        menu.style.display = 'block';

        const menuRect = menu.getBoundingClientRect();

        // Calculate position
        let top = triggerRect.bottom + 4;
        let left = triggerRect.right - menuRect.width; // Align to right edge of trigger by default

        // Check if menu would go off the bottom of the screen
        if (top + menuRect.height > window.innerHeight) {
            // Position above the trigger
            top = triggerRect.top - menuRect.height - 4;
        }

        // Check if menu would go off the right side of the screen
        if (left + menuRect.width > window.innerWidth) {
            // Align to the right edge of viewport with padding
            left = window.innerWidth - menuRect.width - 8;
        }

        // Check if menu would go off the left side of the screen
        if (left < 8) {
            left = 8;
        }

        // Apply the calculated position
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.visibility = '';
    }

    setItems(items) {
        this.items = items;
        this.renderMenu();
    }

    renderMenu() {
        const menuEl = this.shadowRoot.querySelector('.dropdown-menu');

        menuEl.innerHTML = this.items.map(item => {
            if (item.divider) {
                return '<div class="menu-divider"></div>';
            }

            const dangerClass = item.danger ? 'danger' : '';
            const iconHtml = item.icon ? `<span class="material-icons">${item.icon}</span>` : '';

            return `
                <div class="menu-item ${dangerClass}" data-action="${item.action || ''}">
                    ${iconHtml}
                    <span class="menu-label">${item.label}</span>
                </div>
            `;
        }).join('');
    }

    render() {
        super._initShadow(`
            <div class="dropdown-menu"></div>
        `, this.styles());
    }

    styles() {
        return `
            :host {
                position: fixed;
                z-index: 10000;
                display: none;
            }

            :host(.active) {
                display: block;
            }

            .dropdown-menu {
                min-width: 160px;
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-md);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                opacity: 0;
                transform: translateY(-8px);
                transition: opacity 0.2s ease, transform 0.2s ease;
                padding: var(--spacing-xs) 0;
            }

            .dropdown-menu.open {
                opacity: 1;
                transform: translateY(0);
            }

            .menu-item {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                padding: var(--spacing-xs) var(--spacing-md);
                cursor: pointer;
                transition: background-color 0.15s ease;
                color: var(--text-primary);
                font-size: 0.9rem;
                user-select: none;
            }

            .menu-item:hover {
                background-color: var(--bg-2);
            }

            .menu-item.danger {
                color: var(--accent-danger);
            }

            .menu-item .material-icons {
                font-size: 18px;
                width: 18px;
                flex-shrink: 0;
            }

            .menu-label {
                flex-grow: 1;
            }

            .menu-divider {
                height: 1px;
                background-color: var(--bg-3);
                margin: var(--spacing-xs) 0;
            }

            @media (max-width: 768px) {
                .dropdown-trigger {
                    width: 28px;
                    height: 28px;
                }

                .dropdown-trigger .material-icons {
                    font-size: 20px;
                }

                .menu-item {
                    padding: var(--spacing-sm) var(--spacing-md);
                    font-size: 0.95rem;
                }
            }
        `;
    }
}

customElements.define('dropdown-menu', DropdownMenu);