import { BaseComponent } from './BaseComponent.js';

const LINGER_DURATION = 5000; // ms
const FADE_DURATION = 500; // ms

class MinervaNotification extends BaseComponent {
    constructor() {
        super();
        this.openHandler = null;
        this.timeoutId = null;
        this.type = 'info'; // Default type
        this.render();
    }

    /**
     * Initializes the notification with data. Call this before appending to the DOM.
     * @param {object} options - The notification options.
     * @param {string} options.header - The main title of the notification.
     * @param {string} options.message - The body text of the notification.
     * @param {string} [options.subheader] - Optional text below the header.
     * @param {string} [options.type='info'] - Type of notification ('info', 'good', 'warn', 'bad').
     * @param {function} [options.onClick] - A callback for when the notification is clicked.
     */
    init({ header, message, subheader, type = 'info', onClick }) {
        this.header = header;
        this.message = message;
        this.subheader = subheader;
        this.type = type;
        this.openHandler = onClick;
    }

    connectedCallback() {
        
        this.shadowRoot.querySelector('.notification-box').addEventListener('click', this._onOpen.bind(this));
        this.shadowRoot.querySelector('.close-btn').addEventListener('click', this._onClose.bind(this));
        
        // Start slide-in animation, then begin the dismissal lifecycle.
        requestAnimationFrame(() => {
            const box = this.shadowRoot.querySelector('.notification-box');
            if (box) box.classList.add('visible');
        });
        
        this.timeoutId = setTimeout(() => {
            this.startFadeOut();
        }, LINGER_DURATION);
    }

    _onOpen(event) {
        if (event.target.closest('.close-btn')) return; // Ignore clicks on the close button
        if (this.openHandler) this.openHandler();
        this.startFadeOut(); // Clicking the notification also dismisses it.
    }

    _onClose(event) {
        event.stopPropagation(); // Prevent the main click handler from firing.
        this.startFadeOut();
    }



    startFadeOut() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        const box = this.shadowRoot.querySelector('.notification-box');
        // Check if the fade-out hasn't already started
        if (box && !box.classList.contains('fading-out')) {
            box.classList.remove('visible');
            box.classList.add('fading-out');
            box.addEventListener('animationend', () => this.destroy(), { once: true });
        }
    }

    destroy() {
        this.remove();
    }

    render() {
        const subheaderHtml = this.subheader ? `<div class="subheader">${this.subheader}</div>` : '';
        const template = `
            <div class="notification-box" type="${this.type}">
                <div class="content">
                    <div class="header">${this.header}</div>
                    ${subheaderHtml}
                    <div class="message">${this.message}</div>
                </div>
                <button class="close-btn" title="Dismiss">
                    <span class="material-icons">close</span>
                </button>
            </div>
        `;
        super._initShadow(template, this.styles());
    }

    styles() {
        return `
            @keyframes slideInUp {
                from { opacity: 0; transform: translateY(100%); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes fadeOut {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(20px); }
            }

            :host {
                pointer-events: auto; /* Re-enable pointer events for the notification itself. */
            }

            .notification-box {
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-md);
                padding: var(--spacing-md);
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                display: flex;
                gap: var(--spacing-md);
                cursor: pointer;
                transition: background-color var(--transition-fast);
                opacity: 0;
                border-left: 4px solid var(--accent-primary);
            }
            .notification-box.visible {
                animation: slideInUp 0.3s cubic-bezier(0.25, 0.8, 0.25, 1) forwards;
            }
            
            .notification-box.fading-out {
                animation: fadeOut ${FADE_DURATION / 1000}s ease-in forwards;
                pointer-events: none;
                user-select: none; 
            }

            .notification-box:hover {
                background-color: var(--bg-2);
            }

            .notification-box[type="good"] { border-left-color: var(--accent-good); }
            .notification-box[type="warn"] { border-left-color: var(--accent-warn); }
            .notification-box[type="bad"] { border-left-color: var(--accent-danger); }
            .notification-box[type="info"] { border-left-color: var(--accent-primary); }


            .content { flex-grow: 1; overflow: hidden; }
            .header { font-weight: 600; color: var(--text-primary); }
            .subheader, .message {
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .subheader { margin-top: -4px; margin-bottom: 4px; }

            .notification-box[type="good"] .header { color: var(--accent-good); }
            .notification-box[type="warn"] .header { color: var(--accent-warn); }
            .notification-box[type="bad"] .header { color: var(--accent-danger); }
            .notification-box[type="info"] .header { color: var(--accent-primary); }

            .close-btn {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                padding: 0; align-self: flex-start; line-height: 1;
            }
            .close-btn:hover { color: var(--text-primary); }
            .close-btn .material-icons { font-size: 1.2rem; }
        `;
    }
}
customElements.define('minerva-notification', MinervaNotification);