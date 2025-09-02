import { BaseComponent } from '../BaseComponent.js';
import '../ResourceCard.js';

class BrowseScenariosView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            scenarios: [],
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
        
        await this.fetchScenarios();
    }

    async fetchScenarios() {
        this.state.isLoading = true;
        this.updateView();

        try {
            // TODO: Replace with actual API endpoint for remote scenario repository
            // For now, simulate remote data
            await new Promise(resolve => setTimeout(resolve, 900)); // Simulate network delay
            
            // Mock data - replace with actual API call
            this.state.scenarios = [
                {
                    id: 'chat-export-1',
                    name: 'Medieval Tavern Romance',
                    description: 'A cozy roleplay chat between a traveling merchant and a tavern keeper. Features detailed character development and romantic storytelling. 45 messages total.',
                    type: 'scenario',
                    author: 'RomanceWriter',
                    downloads: 1234,
                    rating: 4.8,
                    category: 'romance',
                    messageCount: 45,
                    characters: ['Elara the Tavern Keeper', 'Marcus the Merchant']
                },
                {
                    id: 'chat-export-2',
                    name: 'Space Station Crew Drama',
                    description: 'An intense sci-fi roleplay involving a malfunctioning space station and crew conflicts. Multiple branching storylines and character interactions. 128 messages.',
                    type: 'scenario',
                    author: 'SciFiExplorer',
                    downloads: 892,
                    rating: 4.6,
                    category: 'sci-fi',
                    messageCount: 128,
                    characters: ['Captain Hayes', 'Engineer Torres', 'Dr. Kim']
                },
                {
                    id: 'chat-export-3',
                    name: 'Detective Partnership',
                    description: 'A noir mystery chat following two detectives solving a murder case in 1940s Los Angeles. Rich dialogue and atmospheric descriptions. 67 messages.',
                    type: 'scenario',
                    author: 'NoirFan',
                    downloads: 2103,
                    rating: 4.9,
                    category: 'mystery',
                    messageCount: 67,
                    characters: ['Detective Sullivan', 'Detective Chen']
                },
                {
                    id: 'chat-export-4',
                    name: 'Fantasy Academy Students',
                    description: 'A lighthearted fantasy roleplay at a magical academy. Student life, friendships, and magical mishaps. Great for slice-of-life scenarios. 89 messages.',
                    type: 'scenario',
                    author: 'FantasyStudent',
                    downloads: 1567,
                    rating: 4.7,
                    category: 'fantasy',
                    messageCount: 89,
                    characters: ['Alex the Fire Mage', 'Luna the Healer', 'Kai the Shapeshifter']
                },
                {
                    id: 'chat-export-5',
                    name: 'Post-Apocalypse Survivors',
                    description: 'A survival drama chat set in a zombie apocalypse. Focuses on human relationships and moral choices in extreme situations. 156 messages.',
                    type: 'scenario',
                    author: 'SurvivalGM',
                    downloads: 743,
                    rating: 4.5,
                    category: 'horror',
                    messageCount: 156,
                    characters: ['Sarah the Medic', 'Jake the Engineer', 'Maya the Scout']
                }
            ];

            this.state.error = null;
        } catch (error) {
            console.error('Failed to fetch scenarios:', error);
            this.state.error = 'Failed to load scenarios from remote repository.';
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
        console.log('Selected remote scenario:', resource);
        
        // TODO: Show scenario preview modal or import dialog
        // This is where you'd implement the logic to preview or import the chat scenario
        alert(`Selected: ${resource.name}\\nAuthor: ${resource.author}\\nCategory: ${resource.category}\\nMessages: ${resource.messageCount}\\nCharacters: ${resource.characters.join(', ')}`);
    }

    getFilteredScenarios() {
        if (!this.state.searchQuery) return this.state.scenarios;
        
        return this.state.scenarios.filter(scenario => 
            scenario.name.toLowerCase().includes(this.state.searchQuery) ||
            scenario.description.toLowerCase().includes(this.state.searchQuery) ||
            scenario.author.toLowerCase().includes(this.state.searchQuery) ||
            scenario.category.toLowerCase().includes(this.state.searchQuery) ||
            scenario.characters.some(char => char.toLowerCase().includes(this.state.searchQuery))
        );
    }

    updateView() {
        const container = this.shadowRoot.querySelector('#scenarios-container');
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
        container.className = `scenarios-container ${this.state.viewMode}-view`;
        
        // Show/hide states
        loadingEl.style.display = this.state.isLoading ? 'flex' : 'none';
        errorEl.style.display = this.state.error ? 'block' : 'none';
        if (this.state.error) {
            errorEl.textContent = this.state.error;
        }
        
        const filteredScenarios = this.getFilteredScenarios();
        const isEmpty = !this.state.isLoading && !this.state.error && filteredScenarios.length === 0;
        emptyEl.style.display = isEmpty ? 'flex' : 'none';
        container.style.display = (!this.state.isLoading && !this.state.error && filteredScenarios.length > 0) ? 'block' : 'none';
        
        // Render scenarios
        if (filteredScenarios.length > 0) {
            container.innerHTML = filteredScenarios.map(scenario => {
                return `<resource-card type="${this.state.viewMode === 'grid' ? 'card' : 'list-item'}"></resource-card>`;
            }).join('');
            
            // Set resource data for each card
            const cards = container.querySelectorAll('resource-card');
            cards.forEach((card, index) => {
                card.resource = filteredScenarios[index];
            });
        }
    }

    render() {
        this._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="view-header">
                        <h2>Browse Scenarios</h2>
                        <div class="header-controls">
                            <div class="search-bar">
                                <span class="material-icons">search</span>
                                <input type="text" id="search-input" placeholder="Search scenarios...">
                            </div>
                            <button id="view-mode-toggle" class="icon-button" title="Switch View Mode">
                                <span class="material-icons">view_list</span>
                            </button>
                        </div>
                    </header>
                    
                    <div class="content-area">
                        <div id="loading" class="loading-state">
                            <span class="material-icons spinning">refresh</span>
                            <p>Loading scenarios...</p>
                        </div>
                        
                        <div id="error" class="error-state"></div>
                        
                        <div id="empty-state" class="empty-state">
                            <span class="material-icons">search_off</span>
                            <h3>No scenarios found</h3>
                            <p>Try adjusting your search terms.</p>
                        </div>
                        
                        <div id="scenarios-container" class="scenarios-container grid-view"></div>
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
                                <option value="romance">Romance</option>
                                <option value="fantasy">Fantasy</option>
                                <option value="sci-fi">Sci-Fi</option>
                                <option value="mystery">Mystery</option>
                                <option value="horror">Horror</option>
                                <option value="slice-of-life">Slice of Life</option>
                                <option value="adventure">Adventure</option>
                                <option value="drama">Drama</option>
                            </select>
                        </div>
                        
                        <div class="filter-group">
                            <label>Length</label>
                            <select id="length-select">
                                <option value="">Any Length</option>
                                <option value="short">Short (1-50 messages)</option>
                                <option value="medium">Medium (51-100 messages)</option>
                                <option value="long">Long (100+ messages)</option>
                            </select>
                        </div>
                        
                        <div class="filter-group">
                            <label>Characters</label>
                            <select id="characters-select">
                                <option value="">Any Character Count</option>
                                <option value="duo">Duo (2 characters)</option>
                                <option value="small">Small Group (3-4 characters)</option>
                                <option value="large">Large Group (5+ characters)</option>
                            </select>
                        </div>
                        
                        <div class="stats">
                            <p><strong>Remote Repository</strong></p>
                            <p>Exported chat conversations and roleplay scenarios</p>
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
            
            .scenarios-container.grid-view {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: var(--spacing-md);
            }
            
            .scenarios-container.list-view {
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
                .scenarios-container.grid-view {
                    grid-template-columns: 1fr;
                }
            }
        `;
    }
}

customElements.define('browse-scenarios-view', BrowseScenariosView);