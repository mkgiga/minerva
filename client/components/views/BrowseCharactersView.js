import { BaseComponent } from '../BaseComponent.js';
import '../ResourceCard.js';

class BrowseCharactersView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            characters: [],
            isLoading: false,
            error: null,
            viewMode: 'grid', // 'grid' or 'list'
            searchQuery: '',
            currentPage: 1,
            totalPages: 1
        };
        
        this.handleSearch = this.handleSearch.bind(this);
        this.handleViewModeToggle = this.handleViewModeToggle.bind(this);
        this.handleResourceSelect = this.handleResourceSelect.bind(this);
    }

    async connectedCallback() {
        this.render();
        
        // Add event listeners
        this.shadowRoot.querySelector('#search-input').addEventListener('input', this.handleSearch);
        this.shadowRoot.querySelector('#view-mode-toggle').addEventListener('click', this.handleViewModeToggle);
        this.shadowRoot.addEventListener('resource-select', this.handleResourceSelect);
        
        await this.fetchCharacters();
    }

    async fetchCharacters() {
        this.state.isLoading = true;
        this.updateView();

        try {
            // Build query parameters
            const params = new URLSearchParams({
                limit: this.state.limit || 20,
                offset: this.state.offset || 0,
                sort: this.state.sort || '-createdAt'
            });

            if (this.state.searchQuery) {
                params.append('search', this.state.searchQuery);
            }

            // Fetch from asset repository API
            const response = await fetch(`http://localhost:3001/api/characters?${params}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Transform API data to match expected format
            this.state.characters = data.characters.map(char => ({
                id: char._id,
                name: char.name,
                description: char.description,
                personality: char.personality,
                scenario: char.scenario,
                firstMessage: char.firstMessage,
                exampleDialogue: char.exampleDialogue,
                avatarUrl: char.avatar,
                type: 'character',
                author: char.authorName,
                downloads: char.stats?.downloads || 0,
                rating: 4.5, // Default rating since we don't have ratings yet
                tags: char.tags || [],
                isPublic: char.isPublic,
                createdAt: char.createdAt,
                updatedAt: char.updatedAt
            }));

            // Update pagination info
            this.state.totalPages = Math.ceil(data.pagination.total / (this.state.limit || 20));
            this.state.hasMore = data.pagination.hasMore;
            
            this.state.error = null;
        } catch (error) {
            console.error('Failed to fetch characters:', error);
            this.state.error = `Failed to load characters: ${error.message}`;
            this.state.characters = [];
        } finally {
            this.state.isLoading = false;
            this.updateView();
        }
    }

    handleSearch(event) {
        this.state.searchQuery = event.target.value.toLowerCase();
        this.updateView();
    }

    handleViewModeToggle() {
        this.state.viewMode = this.state.viewMode === 'grid' ? 'list' : 'grid';
        this.updateView();
    }

    async handleResourceSelect(event) {
        const { resource } = event.detail;
        console.log('Selected remote character:', resource);
        
        // Show confirmation dialog
        const confirmImport = confirm(`Import character "${resource.name}" by ${resource.author}?\n\nThis will add the character to your local collection.`);
        
        if (confirmImport) {
            try {
                await this.importCharacter(resource);
            } catch (error) {
                console.error('Failed to import character:', error);
                alert(`Failed to import character: ${error.message}`);
            }
        }
    }

    async importCharacter(resource) {
        // First, track the download in the repository
        try {
            await fetch(`http://localhost:3001/api/characters/${resource.id}/download`, {
                method: 'POST'
            });
        } catch (error) {
            console.warn('Failed to track download:', error);
        }

        // Import the character into local Minerva
        const characterData = {
            name: resource.name,
            description: resource.description || '',
            personality: resource.personality || '',
            scenario: resource.scenario || '',
            firstMessage: resource.firstMessage || '',
            exampleDialogue: resource.exampleDialogue || '',
            avatar: resource.avatarUrl || null,
            tags: resource.tags || [],
            metadata: {
                importedFrom: 'repository',
                originalId: resource.id,
                originalAuthor: resource.author,
                importDate: new Date().toISOString()
            }
        };

        // Use Minerva's character creation API
        const response = await fetch('/api/characters', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(characterData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to import character');
        }

        const result = await response.json();
        
        // Show success message with option to navigate to character
        const goToCharacter = confirm(`Character "${resource.name}" imported successfully!\n\nWould you like to view the character now?`);
        
        if (goToCharacter) {
            // Navigate to characters view
            window.dispatchEvent(new CustomEvent('navigate', {
                detail: { path: 'characters' }
            }));
        }

        return result;
    }

    getFilteredCharacters() {
        if (!this.state.searchQuery) return this.state.characters;
        
        return this.state.characters.filter(char => 
            char.name.toLowerCase().includes(this.state.searchQuery) ||
            char.description.toLowerCase().includes(this.state.searchQuery) ||
            char.author.toLowerCase().includes(this.state.searchQuery)
        );
    }

    updateView() {
        const container = this.shadowRoot.querySelector('#characters-container');
        const loadingEl = this.shadowRoot.querySelector('#loading');
        const errorEl = this.shadowRoot.querySelector('#error');
        const emptyEl = this.shadowRoot.querySelector('#empty-state');
        const viewModeBtn = this.shadowRoot.querySelector('#view-mode-toggle');
        
        // Update view mode button
        const icon = this.state.viewMode === 'grid' ? 'view_list' : 'grid_view';
        const title = this.state.viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View';
        viewModeBtn.innerHTML = `<span class="material-icons">${icon}</span>`;
        viewModeBtn.title = title;
        
        // Update container class
        container.className = `characters-container ${this.state.viewMode}-view`;
        
        // Show/hide states
        loadingEl.style.display = this.state.isLoading ? 'flex' : 'none';
        errorEl.style.display = this.state.error ? 'block' : 'none';
        if (this.state.error) {
            errorEl.textContent = this.state.error;
        }
        
        const filteredCharacters = this.getFilteredCharacters();
        const isEmpty = !this.state.isLoading && !this.state.error && filteredCharacters.length === 0;
        emptyEl.style.display = isEmpty ? 'flex' : 'none';
        container.style.display = (!this.state.isLoading && !this.state.error && filteredCharacters.length > 0) ? 'block' : 'none';
        
        // Render characters
        if (filteredCharacters.length > 0) {
            container.innerHTML = filteredCharacters.map(char => {
                return `<resource-card type="${this.state.viewMode === 'grid' ? 'card' : 'list-item'}"></resource-card>`;
            }).join('');
            
            // Set resource data for each card
            const cards = container.querySelectorAll('resource-card');
            cards.forEach((card, index) => {
                card.resource = filteredCharacters[index];
            });
        }
    }

    render() {
        this._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="view-header">
                        <h2>Browse Characters</h2>
                        <div class="header-controls">
                            <div class="search-bar">
                                <span class="material-icons">search</span>
                                <input type="text" id="search-input" placeholder="Search characters...">
                            </div>
                            <button id="view-mode-toggle" class="icon-button" title="Switch View Mode">
                                <span class="material-icons">view_list</span>
                            </button>
                        </div>
                    </header>
                    
                    <div class="content-area">
                        <div id="loading" class="loading-state">
                            <span class="material-icons spinning">refresh</span>
                            <p>Loading characters...</p>
                        </div>
                        
                        <div id="error" class="error-state"></div>
                        
                        <div id="empty-state" class="empty-state">
                            <span class="material-icons">search_off</span>
                            <h3>No characters found</h3>
                            <p>Try adjusting your search terms.</p>
                        </div>
                        
                        <div id="characters-container" class="characters-container grid-view"></div>
                    </div>
                </div>
                
                <div class="panel-right-sidebar">
                    <header>
                        <h3>Filters</h3>
                    </header>
                    <div class="filters-content">
                        <div class="filter-group">
                            <label>Sort By</label>
                            <select id="sort-select">
                                <option value="popular">Most Popular</option>
                                <option value="recent">Recently Added</option>
                                <option value="rating">Highest Rated</option>
                                <option value="name">Name A-Z</option>
                            </select>
                        </div>
                        
                        <div class="filter-group">
                            <label>Category</label>
                            <select id="category-select">
                                <option value="">All Categories</option>
                                <option value="fantasy">Fantasy</option>
                                <option value="sci-fi">Sci-Fi</option>
                                <option value="modern">Modern</option>
                                <option value="historical">Historical</option>
                            </select>
                        </div>
                        
                        <div class="stats">
                            <p><strong>Remote Repository</strong></p>
                            <p>Characters available for download</p>
                        </div>
                    </div>
                </div>
            </div>
        `, this.styles());
        
        this.updateView();
    }

    styles() {
        return `
            .panel-main { display: flex; flex-direction: column; height: 100%; }
            .panel-right-sidebar { flex-direction: column; }
            
            .view-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md) var(--spacing-lg); border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0; gap: var(--spacing-md);
            }
            
            .view-header h2 { margin: 0; }
            
            .header-controls {
                display: flex; align-items: center; gap: var(--spacing-md);
            }
            
            .search-bar {
                display: flex; align-items: center; gap: var(--spacing-sm);
                background-color: var(--bg-2); border-radius: var(--radius-sm);
                padding: var(--spacing-xs) var(--spacing-sm); min-width: 300px;
            }
            
            .search-bar .material-icons { color: var(--text-secondary); font-size: 18px; }
            .search-bar input {
                background: none; border: none; outline: none; color: var(--text-primary);
                flex-grow: 1; font-size: var(--font-size-md);
            }
            .search-bar input::placeholder { color: var(--text-disabled); }
            
            .content-area {
                flex-grow: 1; padding: var(--spacing-lg); overflow-y: auto;
            }
            
            .loading-state, .empty-state {
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                color: var(--text-disabled); text-align: center; min-height: 300px; gap: var(--spacing-md);
            }
            
            .loading-state .material-icons {
                font-size: 3rem; animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            
            .empty-state .material-icons { font-size: 4rem; }
            .empty-state h3 { margin: 0; color: var(--text-primary); }
            .empty-state p { margin: 0; }
            
            .error-state {
                color: var(--accent-danger); text-align: center; padding: var(--spacing-lg);
                background-color: rgba(242, 139, 130, 0.1); border-radius: var(--radius-sm);
            }
            
            .characters-container.grid-view {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: var(--spacing-md);
            }
            
            .characters-container.list-view {
                display: flex; flex-direction: column; gap: var(--spacing-xs);
            }
            
            .panel-right-sidebar header {
                padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3);
            }
            .panel-right-sidebar header h3 { margin: 0; }
            
            .filters-content {
                padding: var(--spacing-md); display: flex; flex-direction: column; gap: var(--spacing-lg);
            }
            
            .filter-group {
                display: flex; flex-direction: column; gap: var(--spacing-sm);
            }
            
            .filter-group label {
                font-weight: 500; color: var(--text-secondary); font-size: var(--font-size-sm);
            }
            
            .filter-group select {
                padding: var(--spacing-sm); background-color: var(--bg-1);
                border: 1px solid var(--bg-3); border-radius: var(--radius-sm);
                color: var(--text-primary); font-size: var(--font-size-md);
            }
            
            .stats {
                background-color: var(--bg-2); padding: var(--spacing-md);
                border-radius: var(--radius-sm); font-size: var(--font-size-sm);
            }
            .stats p { margin: 0 0 var(--spacing-xs) 0; }
            .stats p:last-child { margin-bottom: 0; color: var(--text-secondary); }
            
            @media (max-width: 768px) {
                .view-header { flex-direction: column; gap: var(--spacing-sm); align-items: stretch; }
                .header-controls { justify-content: space-between; }
                .search-bar { min-width: 0; flex-grow: 1; }
                .characters-container.grid-view {
                    grid-template-columns: 1fr;
                }
            }
        `;
    }
}

customElements.define('browse-characters-view', BrowseCharactersView);