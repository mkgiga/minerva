import { BaseComponent } from './BaseComponent.js';

class UserCard extends BaseComponent {
    constructor() {
        super();
        this.state = {
            user: null,
            isLoading: true,
            error: null,
            repoStatus: 'checking' // 'online', 'offline', 'checking'
        };
    }

    async connectedCallback() {
        this.render();
        await Promise.all([
            this.loadUserInfo(),
            this.checkRepoStatus()
        ]);
        
        // Add logout button event listener
        this.shadowRoot.addEventListener('click', this.handleLogout.bind(this));
        
        // Check repo status periodically
        this.statusInterval = setInterval(() => this.checkRepoStatus(), 30000); // Check every 30 seconds
    }

    disconnectedCallback() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }
    }

    handleLogout(event) {
        if (event.target.closest('.signin-btn')) {
            // Show auth modal for sign in
            this.dispatchEvent(new CustomEvent('show-auth', {
                bubbles: true,
                detail: { mode: 'signin' }
            }));
        } else if (event.target.closest('.signup-btn')) {
            // Show auth modal for sign up
            this.dispatchEvent(new CustomEvent('show-auth', {
                bubbles: true,
                detail: { mode: 'signup' }
            }));
        } else if (event.target.closest('.logout-btn')) {
            // Handle logout
            this.performLogout();
        }
    }

    performLogout() {
        // Clear tokens
        this.clearTokens();
        
        // Update state
        this.state.repoStatus = 'offline';
        this.state.repoUser = null;
        this.updateView();
        
        // Show notification
        this.dispatchEvent(new CustomEvent('show-notification', {
            bubbles: true,
            detail: {
                header: 'Signed Out',
                message: 'You have been signed out of the repository.',
                type: 'info'
            }
        }));
    }

    async checkRepoStatus() {
        try {
            const accessToken = localStorage.getItem('repoAccessToken');
            const refreshToken = localStorage.getItem('repoRefreshToken');

            // First check if repository is accessible
            const healthResponse = await fetch('http://localhost:3001/health');
            if (!healthResponse.ok) {
                throw new Error('Repository not accessible');
            }

            // If we have tokens, try to authenticate
            if (accessToken) {
                const authResponse = await fetch('http://localhost:3001/api/auth/profile', {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                });

                if (authResponse.ok) {
                    const userData = await authResponse.json();
                    this.state.repoStatus = 'online';
                    this.state.repoUser = userData.user;
                } else if (authResponse.status === 401 && refreshToken) {
                    // Access token expired, try to refresh
                    const refreshed = await this.refreshAccessToken(refreshToken);
                    if (refreshed) {
                        // Retry with new token
                        await this.checkRepoStatus();
                        return;
                    } else {
                        // Refresh failed, user needs to login again
                        this.clearTokens();
                        this.state.repoStatus = 'offline';
                        this.state.repoUser = null;
                    }
                } else {
                    // Invalid token
                    this.clearTokens();
                    this.state.repoStatus = 'offline';
                    this.state.repoUser = null;
                }
            } else {
                // No tokens, user is offline
                this.state.repoStatus = 'offline';
                this.state.repoUser = null;
            }
        } catch (error) {
            console.log('Repository status check failed:', error.message);
            this.state.repoStatus = 'offline';
            this.state.repoUser = null;
        }
        
        this.updateView();
    }

    async refreshAccessToken(refreshToken) {
        try {
            const response = await fetch('http://localhost:3001/api/auth/refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refreshToken })
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('repoAccessToken', data.accessToken);
                if (data.refreshToken) {
                    localStorage.setItem('repoRefreshToken', data.refreshToken);
                }
                return true;
            } else {
                return false;
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
            return false;
        }
    }

    clearTokens() {
        localStorage.removeItem('repoAccessToken');
        localStorage.removeItem('repoRefreshToken');
    }

    async loadUserInfo() {
        try {
            this.state.isLoading = true;
            this.updateView();

            // For now, use mock user data since we don't have user authentication in main Minerva
            // In a real implementation, this would fetch from a user API
            await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call
            
            this.state.user = {
                username: 'Local User',
                email: 'user@minerva.local',
                avatar: null,
                stats: {
                    charactersCreated: await this.getLocalResourceCount('characters'),
                    notesCreated: await this.getLocalResourceCount('notes'),
                    chatsCreated: await this.getLocalResourceCount('chats')
                }
            };
            
            this.state.isLoading = false;
            this.state.error = null;
        } catch (error) {
            console.error('Failed to load user info:', error);
            this.state.error = error.message;
            this.state.isLoading = false;
        }
        
        this.updateView();
    }

    async getLocalResourceCount(type) {
        try {
            const response = await fetch(`/api/${type}`);
            if (!response.ok) return 0;
            
            const data = await response.json();
            const resources = data[type] || data.resources || [];
            return Array.isArray(resources) ? resources.length : 0;
        } catch (error) {
            console.error(`Failed to count ${type}:`, error);
            return 0;
        }
    }

    updateView() {
        const content = this.shadowRoot.querySelector('.user-card-content');
        if (!content) return;

        if (this.state.isLoading) {
            content.innerHTML = `
                <div class="loading">
                    <span class="material-icons spinning">refresh</span>
                    <span>Loading...</span>
                </div>
            `;
            return;
        }

        if (this.state.error) {
            content.innerHTML = `
                <div class="error">
                    <span class="material-icons">error</span>
                    <span>Failed to load user info</span>
                </div>
            `;
            return;
        }

        if (!this.state.user) {
            content.innerHTML = `
                <div class="no-user">
                    <span class="material-icons">person</span>
                    <span>No user data</span>
                </div>
            `;
            return;
        }

        const { user, repoStatus, repoUser } = this.state;
        
        // Use repoUser username if authenticated, otherwise use local user
        const displayUsername = repoUser ? repoUser.username : user.username;
        const displayAvatar = repoUser?.avatar || user.avatar;
        
        // Determine status display
        const statusInfo = this.getStatusInfo(repoStatus);
        
        content.innerHTML = `
            <div class="user-info">
                <div class="user-avatar">
                    ${displayAvatar 
                        ? `<img src="${displayAvatar}" alt="${displayUsername}" class="avatar-image">`
                        : `<span class="material-icons">person</span>`
                    }
                </div>
                <div class="user-details">
                    <div class="username-row">
                        <div class="username">${displayUsername}</div>
                        <div class="repo-status ${statusInfo.class}" title="${statusInfo.tooltip}">
                            <div class="status-circle"></div>
                            <span class="status-text">${statusInfo.text}</span>
                        </div>
                    </div>
                    <div class="user-stats">
                        ${repoUser ? `
                            <div class="stat">
                                <span class="material-icons">people</span>
                                <span>${repoUser.stats.charactersUploaded}</span>
                            </div>
                            <div class="stat">
                                <span class="material-icons">menu_book</span>
                                <span>${repoUser.stats.notesUploaded}</span>
                            </div>
                            <div class="stat">
                                <span class="material-icons">article</span>
                                <span>${repoUser.stats.scenariosUploaded}</span>
                            </div>
                            <div class="stat">
                                <span class="material-icons">download</span>
                                <span>${repoUser.stats.totalDownloads}</span>
                            </div>
                        ` : `
                            <div class="stat">
                                <span class="material-icons">people</span>
                                <span>${user.stats.charactersCreated}</span>
                            </div>
                            <div class="stat">
                                <span class="material-icons">menu_book</span>
                                <span>${user.stats.notesCreated}</span>
                            </div>
                            <div class="stat">
                                <span class="material-icons">chat</span>
                                <span>${user.stats.chatsCreated}</span>
                            </div>
                        `}
                    </div>
                </div>
            </div>
            <div class="user-actions">
                ${repoStatus === 'offline' ? `
                    <div class="auth-buttons">
                        <button class="signin-btn" title="Sign in to repository">
                            <span class="material-icons">login</span>
                            <span>Sign In</span>
                        </button>
                        <button class="signup-btn" title="Create account">
                            <span class="material-icons">person_add</span>
                            <span>Sign Up</span>
                        </button>
                    </div>
                ` : `
                    <button class="logout-btn" title="Log out">
                        <span class="material-icons">logout</span>
                        <span>Log out</span>
                    </button>
                `}
            </div>
        `;
    }

    getStatusInfo(status) {
        switch (status) {
            case 'online':
                return {
                    class: 'status-online',
                    text: 'Online',
                    tooltip: 'Connected to repository - you can upload resources'
                };
            case 'offline':
                return {
                    class: 'status-offline',
                    text: 'Offline',
                    tooltip: 'Not connected to repository - sign in to upload resources'
                };
            case 'checking':
            default:
                return {
                    class: 'status-checking',
                    text: 'Checking...',
                    tooltip: 'Checking connection to repository'
                };
        }
    }

    render() {
        this._initShadow(`
            <div class="user-card">
                <div class="user-card-content"></div>
            </div>
        `, this.styles());
        
        this.updateView();
    }

    styles() {
        return `
            .user-card {
                padding: var(--spacing-md);
                background: var(--bg-2);
                border-bottom: 1px solid var(--bg-3);
                margin-bottom: var(--spacing-md);
            }
            
            .user-card-content {
                display: flex;
                flex-direction: column;
                gap: var(--spacing-sm);
            }
            
            .loading, .error, .no-user {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }
            
            .loading .material-icons {
                animation: spin 1s linear infinite;
                font-size: 16px;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            
            .error {
                color: var(--accent-danger);
            }
            
            .user-info {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
            }
            
            .user-avatar {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: var(--bg-3);
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                flex-shrink: 0;
            }
            
            .user-avatar .material-icons {
                font-size: 24px;
                color: var(--text-secondary);
            }
            
            .avatar-image {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            
            .user-details {
                flex-grow: 1;
                min-width: 0;
            }
            
            .username-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: var(--spacing-xs);
                gap: var(--spacing-sm);
            }
            
            .username {
                font-weight: 600;
                color: var(--text-primary);
                font-size: var(--font-size-md);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                flex-grow: 1;
            }
            
            .repo-status {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                flex-shrink: 0;
            }
            
            .status-circle {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            
            .status-text {
                font-size: var(--font-size-xs);
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .status-online .status-circle {
                background: #22c55e;
                box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
            }
            
            .status-online .status-text {
                color: #22c55e;
            }
            
            .status-offline .status-circle {
                background: #ef4444;
            }
            
            .status-offline .status-text {
                color: #ef4444;
            }
            
            .status-checking .status-circle {
                background: #f59e0b;
                animation: pulse 2s ease-in-out infinite;
            }
            
            .status-checking .status-text {
                color: #f59e0b;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            .user-stats {
                display: flex;
                gap: var(--spacing-sm);
            }
            
            .stat {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
            }
            
            .stat .material-icons {
                font-size: 14px;
            }
            
            .repo-user-info {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                font-size: var(--font-size-xs);
                color: var(--text-secondary);
                margin-top: var(--spacing-xs);
                padding: var(--spacing-xs);
                background: var(--bg-3);
                border-radius: var(--radius-sm);
            }
            
            .repo-user-info .material-icons {
                font-size: 14px;
                color: var(--accent-primary);
            }
            
            .user-actions {
                margin-top: var(--spacing-xs);
            }
            
            .auth-buttons {
                display: flex;
                gap: var(--spacing-xs);
            }
            
            .signin-btn, .signup-btn, .logout-btn {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                padding: var(--spacing-xs) var(--spacing-sm);
                background: none;
                border: none;
                border-radius: var(--radius-sm);
                font-size: var(--font-size-sm);
                cursor: pointer;
                transition: all 0.2s;
                color: var(--text-secondary);
                flex: 1;
                justify-content: center;
            }
            
            .signin-btn:hover, .signup-btn:hover {
                background: var(--bg-3);
                color: var(--accent-primary);
            }
            
            .logout-btn {
                width: 100%;
                border: 1px solid var(--bg-3);
            }
            
            .logout-btn:hover {
                background: var(--bg-3);
                color: var(--text-primary);
                border-color: var(--bg-4);
            }
            
            .signin-btn .material-icons, .signup-btn .material-icons, .logout-btn .material-icons {
                font-size: 16px;
            }
            
            @media (max-width: 768px) {
                .user-card {
                    display: none; /* Hide on mobile to save space */
                }
            }
        `;
    }
}

customElements.define('user-card', UserCard);