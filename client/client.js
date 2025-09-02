// client/client.js
import './components/views/CharactersView.js';
import './components/views/MainChatView.js';
import './components/views/UserPreferencesView.js';
import './components/views/NotesView.js';
import './components/views/modes/index.js';
// New view imports
import './components/views/AIConnectionView.js';
import './components/views/AIGenerationView.js';
import './components/views/BrowseScenariosView.js';
import './components/views/BrowseView.js';

import { BaseComponent } from './components/BaseComponent.js';
import './components/Notification.js';
import './components/Modal.js';
import './components/UserCard.js';
import './components/common/TextBox.js';
import './components/common/Spinner.js';
import './components/SchemaForm.js';
import './components/ImagePreview.js';

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
    #viewHierarchy = {
        preferences: { label: 'Preferences', icon: 'settings', component: 'user-preferences-view', layout: 'layout-main-only' },
        'ai-config': {
            label: 'Configuration',
            icon: 'psychology',
            children: {
                connections: { label: 'API', icon: 'hub', component: 'ai-connection-view', layout: 'layout-main-right' },
                generation: { label: 'Generation', icon: 'tune', component: 'ai-generation-view', layout: 'layout-main-right' }
            }
        },
        notes: { label: 'Notes', icon: 'menu_book', component: 'notes-view', layout: 'layout-main-right' },
        characters: { label: 'Characters', icon: 'people', component: 'characters-view', layout: 'layout-main-right' },
        browse: { label: 'Browse', icon: 'travel_explore', component: 'browse-view', layout: 'layout-main-right' },
        chat: { label: 'Chat', icon: 'chat', component: 'main-chat-view', layout: 'layout-three-panel' },
    };

    constructor() {
        super();
        this.state = {
            activeViewPath: ['chat'], // Default view path
        };
        this.initialStateForView = null;
    }

    connectedCallback() {
        this.renderInitialShell();
        this.shadowRoot.querySelector('.icon-sidebar').addEventListener('click', this.#handleNavClick.bind(this));
        this.shadowRoot.querySelector('.mobile-sub-nav').addEventListener('click', this.#handleNavClick.bind(this));
        this.shadowRoot.querySelector('.main-view-wrapper').addEventListener('navigate-to-view', (e) => this.handleNavigate(e.detail));
        
        // Add modal event handlers
        this.shadowRoot.addEventListener('show-modal', this.#handleShowModal.bind(this));
        this.shadowRoot.addEventListener('hide-modal', this.#handleHideModal.bind(this));
        
        // Add auth event handlers
        this.shadowRoot.addEventListener('show-auth', this.#handleShowAuth.bind(this));
        this.shadowRoot.addEventListener('auth-success', this.#handleAuthSuccess.bind(this));
        this.shadowRoot.addEventListener('show-notification', this.#handleShowNotification.bind(this));
        
        notifier.setContainer(this.shadowRoot.querySelector('#notification-container'));
        modal.setModal(this.shadowRoot.querySelector('minerva-modal'));
        imagePreview.setElement(this.shadowRoot.querySelector('minerva-image-preview'));

        this.updateActiveView();
        this.#connectToSse();
        
        // Handle window resize for mobile sub-nav
        window.addEventListener('resize', () => {
            this.#renderMobileSubNav();
        });

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
        if (this.#eventSource) this.#eventSource.close();
        this.#eventSource = new EventSource('/api/events');

        this.#eventSource.addEventListener('resourceChange', (event) => {
            try {
                this.dispatch('minerva-resource-changed', JSON.parse(event.data));
            } catch (error) {
                console.error('Could not parse SSE event data:', error, event.data);
            }
        });

        this.#eventSource.onerror = (err) => {
            console.error('SSE connection error. Attempting to reconnect...', err);
            this.#eventSource.close();
            setTimeout(() => this.#connectToSse(), 5000);
        };
    }
    
    #handleNavClick(event) {
        const navButton = event.target.closest('.nav-button');
        if (navButton && navButton.dataset.viewPath) {
            const path = navButton.dataset.viewPath.split(',');
            this.handleNavigate({ viewPath: path });
        }
    }
    
    handleNavigate({ view, viewPath, state = {} }) {
        const newPath = viewPath || [view]; // Support old `view` property for now
        if (!newPath || this.state.activeViewPath.join(',') === newPath.join(',')) return;
        
        this.initialStateForView = { path: newPath, state };
        this.state.activeViewPath = newPath;
        this.updateActiveView();
    }

    #renderSidebar() {
        const sidebar = this.shadowRoot.querySelector('.icon-sidebar');
        let html = '<user-card></user-card><div class="nav-section">';
        for (const [key, view] of Object.entries(this.#viewHierarchy)) {
            if (view.children) {
                const firstChildKey = Object.keys(view.children)[0];
                html += `
                    <div class="nav-group expanded" data-group-key="${key}">
                        <button class="nav-button parent" data-view-path="${key},${firstChildKey}" title="${view.label}">
                            <span class="material-icons">${view.icon}</span>
                            <span class="btn-label">${view.label}</span>
                        </button>
                        <div class="nav-children">
                            ${Object.entries(view.children).map(([childKey, childView]) => `
                                <button class="nav-button child" data-view-path="${key},${childKey}" title="${childView.label}">
                                    <span class="material-icons">${childView.icon}</span>
                                    <span class="btn-label">${childView.label}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                html += `
                     <button class="nav-button" data-view-path="${key}" title="${view.label}">
                        <span class="material-icons">${view.icon}</span>
                        <span class="btn-label">${view.label}</span>
                    </button>
                `;
            }
        }
        html += '</div>';
        sidebar.innerHTML = html;
    }

    #renderMobileSubNav() {
        const subNav = this.shadowRoot.querySelector('.mobile-sub-nav');
        const [parentKey] = this.state.activeViewPath;
        const parentView = this.#viewHierarchy[parentKey];
        
        // Only show mobile sub-nav on mobile screens (768px or less)
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        
        if (isMobile && parentView && parentView.children) {
            subNav.style.display = 'flex';
            subNav.innerHTML = Object.entries(parentView.children).map(([childKey, childView]) => `
                <button class="nav-button" data-view-path="${parentKey},${childKey}">
                     <span class="material-icons">${childView.icon}</span>
                     <span>${childView.label}</span>
                </button>
            `).join('');
        } else {
            subNav.style.display = 'none';
            subNav.innerHTML = '';
        }
    }

    renderInitialShell() {
        const template = `
            <div class="app-layout-container">
                <aside class="icon-sidebar"></aside>
                <div class="main-view-host">
                    <div class="main-view-wrapper">
                        ${Object.values(this.#viewHierarchy).flatMap(v => v.children ? Object.values(v.children) : v).map(view => 
                            view.component ? `<${view.component} data-view-key="${view.component}" style="display: none;"></${view.component}>` : ''
                        ).join('')}
                    </div>
                    <nav class="mobile-sub-nav"></nav>
                </div>
            </div>
            <!-- Global Overlay Elements -->
            <div id="notification-container"></div>
            <minerva-modal></minerva-modal>
            <minerva-image-preview></minerva-image-preview>
        `;
        const styles = `
            /* Default styles are for desktop */
            .app-layout-container { display: flex; flex-direction: row; height: 100%; width: 100%; }
            .main-view-host { flex-grow: 1; display: flex; overflow: hidden; }
            .main-view-wrapper { flex-grow: 1; display: grid; overflow: hidden; }
            .mobile-sub-nav { display: none; }
            
            /* Mobile Support */
            @media (max-width: 768px) {
                .app-layout-container {
                    flex-direction: column-reverse; /* Reverses order: main-view-host first, icon-sidebar last */
                }
                .main-view-host {
                    flex-grow: 1;
                    flex-direction: column; /* Stack content above sub-nav */
                    overflow: hidden;
                    display: flex;
                }
                .main-view-wrapper {
                    flex-grow: 1;
                    overflow-y: auto;
                    display: grid;
                }
                .mobile-sub-nav {
                    display: none; /* Let JS control the display */
                }
            }
        `;
        super._initShadow(template, styles);
        this.#renderSidebar();
    }

    updateActiveView() {
        const path = this.state.activeViewPath;
        const [parentKey, childKey] = path;
        
        const parentView = this.#viewHierarchy[parentKey];
        const activeView = childKey ? parentView?.children?.[childKey] : parentView;

        // Update sidebar buttons
        for (const btn of this.shadowRoot.querySelectorAll('.icon-sidebar .nav-button, .mobile-sub-nav .nav-button')) {
            btn.classList.toggle('active', btn.dataset.viewPath === path.join(','));
        }
        for (const group of this.shadowRoot.querySelectorAll('.icon-sidebar .nav-group')) {
            group.classList.toggle('active-parent', group.dataset.groupKey === parentKey);
        }

        // Show the correct view component
        let componentToShow = null;
        for (const viewEl of this.shadowRoot.querySelectorAll('.main-view-wrapper > [data-view-key]')) {
            const isActive = viewEl.dataset.viewKey === activeView?.component;
            viewEl.style.display = isActive ? 'contents' : 'none';
            if (isActive) componentToShow = viewEl;
        }

        // Set initial state if navigating to a new view
        if (componentToShow && this.initialStateForView && this.initialStateForView.path.join(',') === path.join(',')) {
            if (typeof componentToShow.setInitialState === 'function') {
                componentToShow.setInitialState(this.initialStateForView.state);
                this.initialStateForView = null;
            }
        }
        
        // Update main layout class
        const wrapper = this.shadowRoot.querySelector('.main-view-wrapper');
        wrapper.className = 'main-view-wrapper'; // Reset class
        if (activeView?.layout) {
            wrapper.classList.add(activeView.layout);
        }
        
        this.#renderMobileSubNav();
    }
    
    #handleShowModal(event) {
        const { title, content, buttons } = event.detail;
        modal.show({ title, content, buttons });
    }
    
    #handleHideModal(event) {
        modal.hide();
    }
    
    #handleShowAuth(event) {
        const { mode = 'signin' } = event.detail || {};
        this.showAuthModal(mode);
    }

    showAuthModal(mode = 'signin') {
        const self = this; // Store reference to MinervaApp instance
        const isSignUp = mode === 'signup';
        const title = isSignUp ? 'Create Account' : 'Sign In';
        const subtitle = isSignUp 
            ? 'Join the repository to share your creations' 
            : 'Sign in to upload and manage your resources';

        const content = `
            <div class="auth-modal-content">
                <p class="auth-subtitle">${subtitle}</p>
                <form id="auth-form" class="auth-form">
                    <div class="form-group">
                        <label for="email">Email</label>
                        <input 
                            type="email" 
                            id="email" 
                            name="email" 
                            placeholder="your.email@example.com"
                            required
                        >
                    </div>

                    ${isSignUp ? `
                        <div class="form-group">
                            <label for="username">Username</label>
                            <input 
                                type="text" 
                                id="username" 
                                name="username" 
                                placeholder="YourUsername"
                                required
                            >
                        </div>
                    ` : ''}

                    <div class="form-group">
                        <label for="password">Password</label>
                        <input 
                            type="password" 
                            id="password" 
                            name="password" 
                            placeholder="At least 6 characters"
                            required
                        >
                    </div>

                    ${isSignUp ? `
                        <div class="form-group">
                            <label for="confirmPassword">Confirm Password</label>
                            <input 
                                type="password" 
                                id="confirmPassword" 
                                name="confirmPassword" 
                                placeholder="Repeat your password"
                                required
                            >
                        </div>
                    ` : ''}

                    <div class="error-message" style="display: none;"></div>

                    <div class="auth-switch">
                        ${isSignUp 
                            ? 'Already have an account? <button type="button" class="link-button" data-mode="signin">Click here to log in.</button>'
                            : 'New user? <button type="button" class="link-button" data-mode="signup">Click here to register.</button>'
                        }
                    </div>
                </form>
            </div>

            <style>
                .modal-body {
                    padding: 0 !important;
                }
                
                .auth-modal-content {
                    padding: var(--spacing-md);
                }

                .auth-subtitle {
                    margin: 0 0 var(--spacing-xs) 0;
                    color: var(--text-secondary);
                    font-size: var(--font-size-sm);
                    line-height: 1.4;
                    text-align: center;
                }

                .auth-form {
                    display: flex;
                    flex-direction: column;
                    gap: var(--spacing-sm);
                    margin: 0;
                    padding: 0;
                }

                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: var(--spacing-xs);
                }

                .form-group label {
                    font-weight: 500;
                    color: var(--text-secondary);
                    font-size: var(--font-size-sm);
                }

                .form-group input {
                    padding: var(--spacing-md);
                    background: var(--bg-2);
                    border: 1px solid var(--bg-3);
                    border-radius: var(--radius-sm);
                    color: var(--text-primary);
                    font-size: var(--font-size-md);
                    transition: border-color 0.2s;
                }

                .form-group input:focus {
                    outline: none;
                    border-color: var(--accent-primary);
                }

                .form-group input::placeholder {
                    color: var(--text-disabled);
                }

                .success-message {
                    background: var(--accent-success);
                    color: white;
                    padding: var(--spacing-md);
                    border-radius: var(--radius-sm);
                    margin-bottom: var(--spacing-lg);
                    text-align: center;
                    font-size: var(--font-size-sm);
                }

                .error-message {
                    background: var(--accent-danger);
                    color: white;
                    padding: var(--spacing-md);
                    border-radius: var(--radius-sm);
                    text-align: center;
                    font-size: var(--font-size-sm);
                }

                .auth-switch {
                    text-align: center;
                    margin-top: 0;
                    color: var(--text-secondary);
                    font-size: var(--font-size-sm);
                }

                .link-button {
                    background: none;
                    border: none;
                    color: var(--accent-primary);
                    cursor: pointer;
                    font-size: var(--font-size-sm);
                    text-decoration: underline;
                    padding: 0;
                }

                .link-button:hover {
                    color: var(--accent-primary-hover);
                }
            </style>
        `;

        const buttons = [
            {
                label: 'Cancel',
                className: 'button-secondary',
                onClick: () => modal.hide()
            },
            {
                label: isSignUp ? 'Create Account' : 'Sign In',
                className: 'button-primary',
                onClick: () => self.handleAuthSubmit(mode)
            }
        ];

        modal.show({ title, content, buttons });

        // Focus first input after modal is shown
        setTimeout(() => {
            const modalElement = self.shadowRoot.querySelector('minerva-modal');
            const firstInput = modalElement ? modalElement.shadowRoot.querySelector('.modal-body #auth-form input') : null;
            if (firstInput) firstInput.focus();
            
            // Attach link button event listeners for mode switching
            const linkButtons = modalElement ? modalElement.shadowRoot.querySelectorAll('.modal-body .link-button[data-mode]') : [];
            linkButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    const newMode = e.target.dataset.mode;
                    modal.hide();
                    setTimeout(() => self.showAuthModal(newMode), 200);
                });
            });
        }, 100);
    }

    async handleAuthSubmit(mode) {
        console.log('handleAuthSubmit called with mode:', mode);
        
        // Wait a tick for the DOM to update after modal.show()
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Get the modal from the MinervaApp's shadow DOM (not document root)
        const modalElement = this.shadowRoot.querySelector('minerva-modal');
        console.log('Modal element:', modalElement);
        
        if (modalElement && modalElement.shadowRoot) {
            console.log('Modal shadow root exists');
            const modalBody = modalElement.shadowRoot.querySelector('.modal-body');
            console.log('Modal body:', modalBody);
            console.log('Modal body innerHTML:', modalBody ? modalBody.innerHTML : 'No modal body');
        }
        
        // Look for the form within the modal's shadow DOM body
        const form = modalElement ? modalElement.shadowRoot.querySelector('.modal-body #auth-form') : null;
        console.log('Form found:', form);
        
        if (!form) {
            console.error('Auth form not found');
            return;
        }

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        console.log('Form data:', data);

        // Validate form
        const validation = this.validateAuthForm(data, mode);
        if (!validation.isValid) {
            console.log('Validation failed:', validation.error);
            this.showAuthError(validation.error);
            return;
        }
        
        console.log('Validation passed, proceeding with authentication...');

        // Show loading state  
        const submitButton = modalElement ? modalElement.shadowRoot.querySelector('.modal-controls .button-primary') : null;
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="material-icons spinning">refresh</span> Processing...';
        }

        try {
            if (mode === 'signin') {
                await this.handleSignIn(data);
            } else {
                await this.handleSignUp(data);
            }
        } catch (error) {
            this.showAuthError(error.message);
        } finally {
            // Reset button
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = mode === 'signup' ? 'Create Account' : 'Sign In';
            }
        }
    }

    validateAuthForm(data, mode) {
        const { email, username, password, confirmPassword } = data;
        
        if (!email?.trim()) {
            return { isValid: false, error: 'Email is required' };
        }
        
        if (!email.includes('@') || !email.includes('.')) {
            return { isValid: false, error: 'Please enter a valid email address' };
        }

        if (mode === 'signup' && !username?.trim()) {
            return { isValid: false, error: 'Username is required' };
        }

        if (mode === 'signup' && username && username.length < 3) {
            return { isValid: false, error: 'Username must be at least 3 characters' };
        }

        if (!password) {
            return { isValid: false, error: 'Password is required' };
        }

        if (password.length < 6) {
            return { isValid: false, error: 'Password must be at least 6 characters' };
        }

        if (mode === 'signup' && password !== confirmPassword) {
            return { isValid: false, error: 'Passwords do not match' };
        }

        return { isValid: true };
    }

    showAuthError(message) {
        const modalElement = this.shadowRoot.querySelector('minerva-modal');
        const errorDiv = modalElement ? modalElement.shadowRoot.querySelector('.modal-body .error-message') : null;
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    }

    showAuthSuccess(message) {
        const modalElement = this.shadowRoot.querySelector('minerva-modal');
        const successDiv = modalElement ? modalElement.shadowRoot.querySelector('.modal-body .success-message') : null;
        if (successDiv) {
            successDiv.textContent = message;
            successDiv.style.display = 'block';
            setTimeout(() => {
                successDiv.style.display = 'none';
            }, 5000);
        }
    }

    async handleSignIn(data) {
        console.log('Attempting sign in with data:', { email: data.email, password: '[REDACTED]' });
        const { email, password } = data;

        const response = await fetch('http://localhost:3001/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        console.log('Sign in response status:', response.status);

        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(responseData.message || 'Sign in failed');
        }

        // Store tokens
        localStorage.setItem('repoAccessToken', responseData.accessToken);
        localStorage.setItem('repoRefreshToken', responseData.refreshToken);

        // Dispatch success event
        this.#handleAuthSuccess({
            detail: { 
                type: 'signin',
                user: responseData.user,
                tokens: {
                    accessToken: responseData.accessToken,
                    refreshToken: responseData.refreshToken
                }
            }
        });

        // Close modal
        modal.hide();
    }

    async handleSignUp(data) {
        console.log('Attempting sign up with data:', { email: data.email, username: data.username, password: '[REDACTED]' });
        const { email, username, password } = data;

        const response = await fetch('http://localhost:3001/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, username, password })
        });
        
        console.log('Sign up response status:', response.status);

        const responseData = await response.json();

        if (!response.ok) {
            throw new Error(responseData.message || 'Sign up failed');
        }

        // Store tokens if returned
        if (responseData.accessToken && responseData.refreshToken) {
            localStorage.setItem('repoAccessToken', responseData.accessToken);
            localStorage.setItem('repoRefreshToken', responseData.refreshToken);
        }

        // Dispatch success event
        this.#handleAuthSuccess({
            detail: { 
                type: 'signup',
                user: responseData.user,
                tokens: responseData.accessToken ? {
                    accessToken: responseData.accessToken,
                    refreshToken: responseData.refreshToken
                } : null,
                message: responseData.message
            }
        });

        // If no tokens returned, show success and switch to signin
        if (!responseData.accessToken) {
            this.showAuthSuccess('Account created successfully! Please sign in.');
            setTimeout(() => {
                this.showAuthModal('signin');
            }, 2000);
        } else {
            // Close modal if automatically signed in
            modal.hide();
        }
    }
    
    #handleAuthSuccess(event) {
        const { type, user, message } = event.detail;
        
        // Show success notification
        let notificationMessage = type === 'signin' 
            ? `Welcome back, ${user.username}!` 
            : message || `Welcome, ${user.username}! Account created successfully.`;
            
        notifier.show({
            header: 'Authentication Success',
            message: notificationMessage,
            type: 'success'
        });
        
        // Refresh user card status
        const userCard = this.shadowRoot.querySelector('user-card');
        if (userCard && typeof userCard.checkRepoStatus === 'function') {
            userCard.checkRepoStatus();
        }
    }
    
    #handleShowNotification(event) {
        const { header, message, type } = event.detail;
        notifier.show({ header, message, type });
    }
}
customElements.define('minerva-app', MinervaApp);

window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(error => console.error('Service Worker registration failed:', error));
    }
});

export default { MinervaApp, api, notifier, modal, imagePreview, uuidv4 };