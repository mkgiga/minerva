import { BaseComponent } from '../BaseComponent.js';

/**
 * A mobile-friendly bottom sheet menu component.
 * Same item format and event interface as DropdownMenu.
 * Supports swipe-to-close gesture.
 *
 * Usage:
 * const sheet = document.createElement('bottom-sheet');
 * sheet.setItems([
 *   { icon: 'copy', label: 'Copy', action: 'copy' },
 *   { divider: true },
 *   { icon: 'delete', label: 'Delete', action: 'delete', danger: true }
 * ]);
 * sheet.addEventListener('menu-action', (e) => console.log(e.detail.action));
 * document.body.appendChild(sheet);
 * sheet.open();
 */
class BottomSheet extends BaseComponent {
    constructor() {
        super();
        this.items = [];
        this._dragStartY = 0;
        this._dragging = false;
        this.render();

        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleItemClick = this.handleItemClick.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);
    }

    connectedCallback() {
        const sheet = this.shadowRoot.querySelector('.bottom-sheet-menu');
        sheet.addEventListener('click', this.handleItemClick);
        sheet.addEventListener('touchstart', this._onTouchStart, { passive: true });
        sheet.addEventListener('touchmove', this._onTouchMove, { passive: false });
        sheet.addEventListener('touchend', this._onTouchEnd);

        const backdrop = this.shadowRoot.querySelector('.bottom-sheet-backdrop');
        backdrop.addEventListener('pointerdown', this.handleBackdropClick);
    }

    disconnectedCallback() {
        document.removeEventListener('keydown', this.handleKeydown);
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

    handleBackdropClick() {
        this.close();
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            this.close();
        }
    }

    // --- Swipe-to-close gesture ---

    _onTouchStart(e) {
        const sheet = this.shadowRoot.querySelector('.bottom-sheet-menu');
        // Only allow drag when content is scrolled to top
        if (sheet.scrollTop > 0) return;

        this._dragStartY = e.touches[0].clientY;
        this._dragging = false;
    }

    _onTouchMove(e) {
        if (this._dragStartY === null) return;

        const currentY = e.touches[0].clientY;
        const deltaY = currentY - this._dragStartY;

        // Only drag downward
        if (deltaY <= 0) {
            if (this._dragging) this._resetDragStyles();
            return;
        }

        // Once we start dragging, prevent scrolling
        e.preventDefault();
        this._dragging = true;

        const sheet = this.shadowRoot.querySelector('.bottom-sheet-menu');
        const backdrop = this.shadowRoot.querySelector('.bottom-sheet-backdrop');

        // Move sheet with finger, no transition lag
        sheet.style.transition = 'none';
        sheet.style.transform = `translateY(${deltaY}px)`;

        // Fade backdrop proportionally
        const sheetHeight = sheet.offsetHeight;
        const opacity = Math.max(0, 0.5 * (1 - deltaY / sheetHeight));
        backdrop.style.transition = 'none';
        backdrop.style.background = `rgba(0, 0, 0, ${opacity})`;
    }

    _onTouchEnd() {
        if (!this._dragging) {
            this._dragStartY = null;
            return;
        }

        const sheet = this.shadowRoot.querySelector('.bottom-sheet-menu');
        const currentTranslate = parseFloat(sheet.style.transform.replace('translateY(', '')) || 0;
        const threshold = Math.min(80, sheet.offsetHeight * 0.3);

        this._dragging = false;
        this._dragStartY = null;

        if (currentTranslate > threshold) {
            this.close();
        } else {
            this._snapBack();
        }
    }

    _snapBack() {
        const sheet = this.shadowRoot.querySelector('.bottom-sheet-menu');
        const backdrop = this.shadowRoot.querySelector('.bottom-sheet-backdrop');

        // Re-enable transitions for the snap-back animation
        sheet.style.transition = '';
        sheet.style.transform = '';
        backdrop.style.transition = '';
        backdrop.style.background = '';
    }

    _resetDragStyles() {
        this._dragging = false;
        this._snapBack();
    }

    // --- Open / Close ---

    open() {
        const backdrop = this.shadowRoot.querySelector('.bottom-sheet-backdrop');
        const sheet = this.shadowRoot.querySelector('.bottom-sheet-menu');

        // Hide visually while the browser computes the starting translateY(100%) layout
        sheet.style.visibility = 'hidden';
        this.classList.add('active');

        // Force layout so the off-screen position is committed
        sheet.getBoundingClientRect();

        // Reveal and transition in
        sheet.style.visibility = '';
        backdrop.classList.add('visible');
        sheet.classList.add('open');

        document.addEventListener('keydown', this.handleKeydown);
    }

    close() {
        const backdrop = this.shadowRoot.querySelector('.bottom-sheet-backdrop');
        const sheet = this.shadowRoot.querySelector('.bottom-sheet-menu');

        // Clear any leftover drag inline styles
        sheet.style.transition = '';
        sheet.style.transform = '';
        backdrop.style.transition = '';
        backdrop.style.background = '';

        backdrop.classList.remove('visible');
        sheet.classList.remove('open');

        document.removeEventListener('keydown', this.handleKeydown);

        // Remove after animation completes
        setTimeout(() => this.classList.remove('active'), 250);
    }

    setItems(items) {
        this.items = items;
        this.renderMenu();
    }

    renderMenu() {
        const menuEl = this.shadowRoot.querySelector('.bottom-sheet-menu');

        menuEl.innerHTML = `
            <div class="sheet-handle"></div>
            ${this.items.map(item => {
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
            }).join('')}
        `;
    }

    render() {
        super._initShadow(`
            <div class="bottom-sheet-backdrop"></div>
            <div class="bottom-sheet-menu"></div>
        `, this.styles());
    }

    styles() {
        return `
            :host {
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: none;
            }

            :host(.active) {
                display: block;
            }

            .bottom-sheet-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0);
                transition: background 0.25s ease;
            }

            .bottom-sheet-backdrop.visible {
                background: rgba(0, 0, 0, 0.5);
            }

            .bottom-sheet-menu {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: var(--bg-1);
                border-top: 1px solid var(--bg-3);
                border-radius: var(--radius-lg) var(--radius-lg) 0 0;
                padding: var(--spacing-xs) 0;
                padding-bottom: max(var(--spacing-sm), env(safe-area-inset-bottom));
                transform: translateY(100%);
                transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                max-height: 60vh;
                overflow-y: auto;
            }

            .bottom-sheet-menu.open {
                transform: translateY(0);
            }

            .sheet-handle {
                width: 32px;
                height: 4px;
                border-radius: 2px;
                background: var(--bg-3);
                margin: var(--spacing-md) auto;
            }

            .menu-item {
                display: flex;
                align-items: center;
                gap: var(--spacing-md);
                padding: var(--spacing-md) var(--spacing-lg);
                cursor: pointer;
                transition: background-color 0.15s ease;
                color: var(--text-primary);
                font-size: 1rem;
                user-select: none;
                min-height: 48px;
            }

            .menu-item:active {
                background-color: var(--bg-2);
            }

            .menu-item.danger {
                color: var(--accent-danger);
            }

            .menu-item .material-icons {
                font-size: 22px;
                width: 22px;
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
        `;
    }
}

customElements.define('bottom-sheet', BottomSheet);
