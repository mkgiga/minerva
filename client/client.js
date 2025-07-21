// client/client.js
import './components/views/CharactersView.js';
import './components/views/MainChatView.js';
import './components/views/ConnectionConfigView.js';
import './components/views/GenerationConfigView.js';
import './components/views/UserPreferencesView.js';
import './components/views/StringsView.js';
import './components/views/ScenariosView.js';
import './components/views/modes/index.js';
import { BaseComponent } from './components/BaseComponent.js';
import './components/Notification.js';
import './components/Modal.js';
import './components/TextBox.js';
import './components/Spinner.js';
import './components/SchemaForm.js';
import './components/ImagePreview.js'; // NEW: Import the ImagePreview component

/**
 * A simple, dependency-free UUID v4 generator.
 * @returns {string} A new UUID.
 */
export function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * A simple API helper to interact with the backend
 */
export const api = {
    get: async (endpoint) => {
        const response = await fetch(endpoint);
        if (!response.ok) {
            const errorInfo = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Failed to fetch ${endpoint}: ${errorInfo.message || response.statusText}`);
        }
        return response.json();
    },
    post: async (endpoint, body) => {
        const options = {
            method: 'POST',
        };
        if (body instanceof FormData) {
            options.body = body;
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }
        const response = await fetch(endpoint, options);
        if (!response.ok) {
            const errorInfo = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Failed to POST to ${endpoint}: ${errorInfo.message || response.statusText}`);
        }
        return response.json();
    },
    put: async (endpoint, body) => {
        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorInfo = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Failed to PUT to ${endpoint}: ${errorInfo.message || response.statusText}`);
        }
        return response.json();
    },
    delete: async (endpoint) => {
        const response = await fetch(endpoint, { method: 'DELETE' });
        if (!response.ok && response.status !== 204) {
             const errorInfo = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(`Failed to DELETE ${endpoint}: ${errorInfo.message || response.statusText}`);
        }
        return; // No content on success
    },
};

// Global Services

class NotificationService {
    constructor() { this.container = null; }
    setContainer(element) { this.container = element; }
    show(options) {
        if (!this.container) {
            console.error('Notification container not set!');
            return;
        }
        const notification = document.createElement('minerva-notification');
        notification.init(options);
        // Add to the end of the container so new notifications are at the bottom
        this.container.appendChild(notification);
    }
}

export const notifier = new NotificationService();

class ModalService {
    constructor() { this.modalElement = null; }
    setModal(element) { this.modalElement = element; }

    show({ title, content, buttons = [], hideCloseButton = false }) {
        if (!this.modalElement) return;
        this.modalElement.clearButtons();
        for (const btn of buttons) {
            this.modalElement.addButton(btn);
        }
        this.modalElement.show({ title, content, hideCloseButton });
    }

    confirm({ title, content, confirmLabel = 'Confirm', onConfirm, confirmButtonClass = 'button-primary' }) {
        if (!this.modalElement) return;

        const buttons = [
            {
                label: 'Cancel',
                className: 'button-secondary',
                onClick: () => this.hide(),
            },
            {
                label: confirmLabel,
                className: confirmButtonClass,
                onClick: () => {
                    // Call onConfirm first, then hide
                    if (onConfirm) onConfirm();
                    this.hide();
                },
            }
        ];
        this.show({ title, content, buttons });
    }

    hide() {
        if (this.modalElement) this.modalElement.hide();
    }
}

export const modal = new ModalService();

class ImagePreviewService {
    #imagePreviewElement = null;

    constructor() { this.#imagePreviewElement = null; }
    setElement(element) { this.#imagePreviewElement = element; }
    show({ src, alt = '' }) {
        if (this.#imagePreviewElement) {
            this.#imagePreviewElement.show({ src, alt });
        }
    }
    hide() {
        if (this.#imagePreviewElement) {
            this.#imagePreviewElement.hide();
        }
    }
}

export const imagePreview = new ImagePreviewService();


/**
 * The root application component: <minerva-app>
 * Manages the main layout and view switching.
 */
class MinervaApp extends BaseComponent {
    #eventSource = null;

    constructor() {
        super();
        this.state = {
            activeMainView: 'chat', // Default view
        };
        this.initialStateForView = null;
    }

    connectedCallback() {
        this.renderInitialShell();
        this.shadowRoot.querySelector('.icon-sidebar').addEventListener('click', this.handleNavClick.bind(this));
        this.shadowRoot.querySelector('.main-view-wrapper').addEventListener('navigate-to-view', (e) => this.handleNavigate(e.detail));
        
        // Link services to their UI elements
        notifier.setContainer(this.shadowRoot.querySelector('#notification-container'));
        modal.setModal(this.shadowRoot.querySelector('minerva-modal'));
        imagePreview.setElement(this.shadowRoot.querySelector('minerva-image-preview')); // NEW: Link imagePreview service

        this.updateActiveView();
        this.#connectToSse();

        // Welcome notification on startup
        setTimeout(() => {
             notifier.show({ header: 'Welcome to Minerva!', message: 'Everything seems to be running correctly.' });
        }, 500);
    }

    disconnectedCallback() {
        if (this.#eventSource) {
            this.#eventSource.close();
        }
    }

    #connectToSse() {
        if (this.#eventSource) {
            this.#eventSource.close();
        }
        this.#eventSource = new EventSource('/api/events');

        this.#eventSource.addEventListener('resourceChange', (event) => {
            try {
                const detail = JSON.parse(event.data);
                this.dispatch('minerva-resource-changed', detail);
            } catch (error) {
                console.error('Could not parse SSE event data:', error, event.data);
            }
        });

        this.#eventSource.onerror = (err) => {
            console.error('SSE connection error. Attempting to reconnect...', err);
            this.#eventSource.close();
            // Reconnect after a delay
            setTimeout(() => this.#connectToSse(), 5000);
        };
    }
    
    handleNavClick(event) {
        const navButton = event.target.closest('.nav-button');
        if (navButton && navButton.dataset.view) {
            this.handleNavigate({ view: navButton.dataset.view });
        }
    }
    
    handleNavigate({ view, state = {} }) {
        if (!view || this.state.activeMainView === view) return;
        this.initialStateForView = { view, state };
        this.state.activeMainView = view;
        this.updateActiveView();
    }

    renderInitialShell() {
        const template = `
            <div class="app-layout-container">
                <aside class="icon-sidebar">
                    <button class="nav-button" data-view="preferences" title="User Preferences">
                        <span class="material-icons">settings</span>
                    </button>
                    <button class="nav-button" data-view="connection-config" title="Connection Settings">
                        <span class="material-icons">wifi</span>
                    </button>
                    <button class="nav-button" data-view="generation-config" title="Generation Settings">
                        <span class="material-icons">tune</span>
                    </button>
                    <button class="nav-button" data-view="strings" title="Strings">
                        <span class="material-icons">text_fields</span>
                    </button>
                     <button class="nav-button" data-view="scenarios" title="Scenarios">
                        <span class="material-icons">menu_book</span>
                    </button>
                    <button class="nav-button" data-view="characters" title="Characters">
                        <span class="material-icons">people</span>
                    </button>
                    <button class="nav-button" data-view="chat" title="Chat">
                        <span class="material-icons">chat</span>
                    </button>
                </aside>
                <div class="main-view-wrapper">
                    <characters-view data-view="characters" style="display: none;"></characters-view>
                    <scenarios-view data-view="scenarios" style="display: none;"></scenarios-view>
                    <main-chat-view data-view="chat" style="display: none;"></main-chat-view>
                    <connection-config-view data-view="connection-config" style="display: none;"></connection-config-view>
                    <generation-config-view data-view="generation-config" style="display: none;"></generation-config-view>
                    <user-preferences-view data-view="preferences" style="display: none;"></user-preferences-view>
                    <strings-view data-view="strings" style="display: none;"></strings-view>
                </div>
            </div>

            <!-- Global Overlay Elements -->
            <div id="notification-container"></div>
            <minerva-modal></minerva-modal>
            <minerva-image-preview></minerva-image-preview> <!-- NEW: Image Preview Element -->
        `;
        const styles = `
            .app-layout-container {
                display: flex;
                height: 100%;
                width: 100%;
            }
        `;
        super._initShadow(template, styles);
    }

    updateActiveView() {
        const activeViewName = this.state.activeMainView;
        
        const navButtons = this.shadowRoot.querySelectorAll('.icon-sidebar .nav-button');
        for (const btn of navButtons) {
            btn.classList.toggle('active', btn.dataset.view === activeViewName);
        }

        const views = this.shadowRoot.querySelectorAll('.main-view-wrapper > [data-view]');
        for (const view of views) {
            const isActive = view.dataset.view === activeViewName;
            view.style.display = isActive ? 'contents' : 'none';

            if (isActive && this.initialStateForView && this.initialStateForView.view === activeViewName) {
                if (typeof view.setInitialState === 'function') {
                    view.setInitialState(this.initialStateForView.state);
                    this.initialStateForView = null;
                }
            }
        }

        const wrapper = this.shadowRoot.querySelector('.main-view-wrapper');
        wrapper.className = 'main-view-wrapper'; // Reset classes
        const layoutClass = this.getViewLayoutClass(activeViewName);
        if (layoutClass) {
            wrapper.classList.add(layoutClass);
        }
    }

    getViewLayoutClass(view) {
        switch (view) {
            case 'chat':
                return 'layout-three-panel';
            case 'preferences':
                return 'layout-main-only';
            case 'characters':
            case 'connection-config':
            case 'generation-config':
            case 'strings':
            case 'scenarios':
                return ''; // Default two-panel layout (left and main)
            default:
                return '';
        }
    }
}

customElements.define('minerva-app', MinervaApp);

// PWA Service Worker Registration
window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    }
});

export default { MinervaApp, api, notifier, modal, imagePreview, uuidv4 };