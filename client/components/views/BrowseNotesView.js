import { BaseComponent } from '../BaseComponent.js';
import '../ResourceCard.js';

class BrowseNotesView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            notes: [],
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
        
        await this.fetchNotes();
    }

    async fetchNotes() {
        this.state.isLoading = true;
        this.updateView();

        try {
            // TODO: Replace with actual API endpoint for remote note repository
            // For now, simulate remote data
            await new Promise(resolve => setTimeout(resolve, 800)); // Simulate network delay
            
            // Mock data - replace with actual API call
            this.state.notes = [
                {
                    id: 'note-remote-1',
                    name: 'Medieval Fantasy Setting',
                    description: 'A comprehensive guide to medieval fantasy worldbuilding, including kingdoms, magic systems, and political structures. Perfect for fantasy RPG campaigns.',
                    type: 'note',
                    author: 'DungeonMaster42',
                    downloads: 856,
                    rating: 4.7,
                    category: 'worldbuilding'
                },
                {
                    id: 'note-remote-2',
                    name: 'Cyberpunk City Guide',
                    description: 'Everything you need to know about Neo-Tokyo 2087: districts, corporations, underground networks, and street culture. Includes NPC lists and plot hooks.',
                    type: 'note',
                    author: 'CyberScribe',
                    downloads: 623,
                    rating: 4.5,
                    category: 'sci-fi'
                },
                {
                    id: 'note-remote-3',
                    name: 'Modern Mystery Toolkit',
                    description: 'Investigation mechanics, clue systems, and red herring techniques for modern-day mystery scenarios. Includes police procedures and forensic basics.',
                    type: 'note',
                    author: 'DetectiveNoir',
                    downloads: 492,
                    rating: 4.8,
                    category: 'modern'
                },
                {
                    id: 'note-remote-4',
                    name: 'Space Exploration Primer',
                    description: 'Comprehensive notes on realistic space travel, alien contact protocols, and stellar phenomena. Great for hard sci-fi campaigns.',
                    type: 'note',
                    author: 'CosmicGM',
                    downloads: 378,
                    rating: 4.6,
                    category: 'sci-fi'
                }
            ];

            this.state.error = null;
        } catch (error) {
            console.error('Failed to fetch notes:', error);
            this.state.error = 'Failed to load notes from remote repository.';
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

    handleResourceSelect(event) {
        const { resource } = event.detail;
        console.log('Selected remote note:', resource);
        
        // TODO: Show note preview modal or import dialog
        // This is where you'd implement the logic to preview or import the note
        alert(`Selected: ${resource.name}\nAuthor: ${resource.author}\nCategory: ${resource.category}\nDownloads: ${resource.downloads}`);
    }

    getFilteredNotes() {
        if (!this.state.searchQuery) return this.state.notes;
        
        return this.state.notes.filter(note => 
            note.name.toLowerCase().includes(this.state.searchQuery) ||
            note.description.toLowerCase().includes(this.state.searchQuery) ||
            note.author.toLowerCase().includes(this.state.searchQuery) ||
            note.category.toLowerCase().includes(this.state.searchQuery)
        );
    }

    updateView() {
        const container = this.shadowRoot.querySelector('#notes-container');
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
        container.className = `notes-container ${this.state.viewMode}-view`;
        
        // Show/hide states
        loadingEl.style.display = this.state.isLoading ? 'flex' : 'none';
        errorEl.style.display = this.state.error ? 'block' : 'none';
        if (this.state.error) {
            errorEl.textContent = this.state.error;
        }
        
        const filteredNotes = this.getFilteredNotes();
        const isEmpty = !this.state.isLoading && !this.state.error && filteredNotes.length === 0;
        emptyEl.style.display = isEmpty ? 'flex' : 'none';
        container.style.display = (!this.state.isLoading && !this.state.error && filteredNotes.length > 0) ? 'block' : 'none';
        
        // Render notes
        if (filteredNotes.length > 0) {
            container.innerHTML = filteredNotes.map(note => {
                return `<resource-card type="${this.state.viewMode === 'grid' ? 'card' : 'list-item'}"></resource-card>`;
            }).join('');
            
            // Set resource data for each card
            const cards = container.querySelectorAll('resource-card');
            cards.forEach((card, index) => {
                card.resource = filteredNotes[index];
            });
        }
    }

    render() {
        this._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="view-header">
                        <h2>Browse Notes</h2>
                        <div class="header-controls">
                            <div class="search-bar">
                                <span class="material-icons">search</span>
                                <input type="text" id="search-input" placeholder="Search notes...">
                            </div>
                            <button id="view-mode-toggle" class="icon-button" title="Switch View Mode">
                                <span class="material-icons">view_list</span>
                            </button>
                        </div>
                    </header>
                    
                    <div class="content-area">
                        <div id="loading" class="loading-state">
                            <span class="material-icons spinning">refresh</span>
                            <p>Loading notes...</p>
                        </div>
                        
                        <div id="error" class="error-state"></div>
                        
                        <div id="empty-state" class="empty-state">
                            <span class="material-icons">search_off</span>
                            <h3>No notes found</h3>
                            <p>Try adjusting your search terms.</p>
                        </div>
                        
                        <div id="notes-container" class="notes-container grid-view"></div>
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
                                <option value="worldbuilding">Worldbuilding</option>
                                <option value="sci-fi">Sci-Fi</option>
                                <option value="fantasy">Fantasy</option>
                                <option value="modern">Modern</option>
                                <option value="historical">Historical</option>
                                <option value="system">Game Systems</option>
                            </select>
                        </div>
                        
                        <div class="filter-group">
                            <label>Type</label>
                            <select id="type-select">
                                <option value="">All Types</option>
                                <option value="worldbuilding">Worldbuilding</option>
                                <option value="scenario">Scenarios</option>
                                <option value="rules">Rule Sets</option>
                                <option value="reference">Reference</option>
                            </select>
                        </div>
                        
                        <div class="stats">
                            <p><strong>Remote Repository</strong></p>
                            <p>Community-created notes and guides</p>
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
            
            .notes-container.grid-view {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: var(--spacing-md);
            }
            
            .notes-container.list-view {
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
                .notes-container.grid-view {
                    grid-template-columns: 1fr;
                }
            }
        `;
    }
}

customElements.define('browse-notes-view', BrowseNotesView);