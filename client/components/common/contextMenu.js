import './DropdownMenu.js';
import './BottomSheet.js';

const MOBILE_QUERY = '(max-width: 768px)';

/**
 * Unified context menu utility that renders a DropdownMenu on desktop
 * or a BottomSheet on mobile, based on viewport width.
 *
 * Usage:
 * import { contextMenu } from '../common/contextMenu.js';
 *
 * contextMenu.show({
 *     items: [
 *         { icon: 'edit', label: 'Edit', action: 'edit' },
 *         { divider: true },
 *         { icon: 'delete', label: 'Delete', action: 'delete', danger: true }
 *     ],
 *     anchor: buttonElement,           // Positioning anchor (used by dropdown, ignored by bottom sheet)
 *     onAction: (action) => { ... },   // Called when an item is selected
 *     container: this.shadowRoot       // DOM node to append the menu into
 * });
 *
 * contextMenu.close();
 */
export const contextMenu = {
    /** @type {HTMLElement|null} */
    _activeMenu: null,

    /**
     * @param {Object} options
     * @param {Array} options.items - Menu items ({ icon, label, action, danger, divider })
     * @param {HTMLElement} [options.anchor] - Trigger element for dropdown positioning
     * @param {Function} options.onAction - Callback receiving the action string
     * @param {ShadowRoot|HTMLElement} options.container - Where to append the menu element
     * @returns {HTMLElement} The created menu element
     */
    show({ items, anchor, onAction, container }) {
        // Clean up any existing menu
        this.close();

        const isMobile = window.matchMedia(MOBILE_QUERY).matches;
        const tagName = isMobile ? 'bottom-sheet' : 'dropdown-menu';
        const menu = document.createElement(tagName);

        menu.setItems(items);

        menu.addEventListener('menu-action', (e) => {
            const action = e.detail.action;
            if (onAction) onAction(action);
            menu.remove();
            if (this._activeMenu === menu) this._activeMenu = null;
        });

        container.appendChild(menu);
        this._activeMenu = menu;

        if (isMobile) {
            menu.open();
        } else {
            menu.open(anchor);
        }

        return menu;
    },

    close() {
        if (this._activeMenu) {
            const menu = this._activeMenu;
            this._activeMenu = null;
            menu.close();
            setTimeout(() => menu.remove(), 250);
        }
    }
};
