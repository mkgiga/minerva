import { BaseComponent } from '../BaseComponent.js';
import '../ResourceCard.js';

class BrowseView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            resources: [],
            isLoading: false,
            error: null,
            viewMode: 'grid', // 'grid' or 'list'
            searchQuery: '',
            selectedType: 'all', // 'all', 'character', 'note', 'scenario'
            currentPage: 1,
            totalPages: 1,
            sortBy: 'recent',
            category: ''
        };
        
        this.handleSearch = this.handleSearch.bind(this);
        this.handleViewModeToggle = this.handleViewModeToggle.bind(this);
        this.handleTypeFilter = this.handleTypeFilter.bind(this);
        this.handleSortChange = this.handleSortChange.bind(this);
        this.handleResourceSelect = this.handleResourceSelect.bind(this);
        this.handleUploadClick = this.handleUploadClick.bind(this);
        this.handleUploadSubmit = this.handleUploadSubmit.bind(this);
    }

    async connectedCallback() {
        this.render();
        
        // Add event listeners
        this.shadowRoot.querySelector('#search-input').addEventListener('input', this.handleSearch);
        this.shadowRoot.querySelector('#view-mode-toggle').addEventListener('click', this.handleViewModeToggle);
        this.shadowRoot.querySelector('#type-filter').addEventListener('change', this.handleTypeFilter);
        this.shadowRoot.querySelector('#sort-select').addEventListener('change', this.handleSortChange);
        this.shadowRoot.querySelector('#upload-btn').addEventListener('click', this.handleUploadClick);
        this.shadowRoot.addEventListener('resource-select', this.handleResourceSelect);
        
        await this.fetchResources();
    }

    async fetchResources() {
        this.state.isLoading = true;
        this.updateView();

        try {
            // Build query parameters
            const params = new URLSearchParams({
                limit: 20,
                offset: 0
            });

            if (this.state.searchQuery) {
                params.append('q', this.state.searchQuery);
            }

            // Build sort parameter (Meilisearch format: field:asc/desc)
            let sortParam = [];
            switch (this.state.sortBy) {
                case 'popular':
                    sortParam = ['downloads:desc'];
                    break;
                case 'recent':
                    sortParam = ['createdAt:desc'];
                    break;
                case 'rating':
                    sortParam = ['rating:desc'];
                    break;
                case 'name':
                    sortParam = ['name:asc'];
                    break;
            }
            if (sortParam.length > 0) {
                params.append('sort', sortParam.join(','));
            }

            // Determine API endpoint
            let endpoint = 'http://localhost:3001/api/search';
            if (this.state.selectedType !== 'all') {
                endpoint += `/${this.state.selectedType}s`;
            }
            
            // Fetch from asset repository API
            const response = await fetch(`${endpoint}?${params}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            // Process results based on response format
            let resources = [];
            if (this.state.selectedType === 'all') {
                // Multi-search results
                if (data.results) {
                    // Combine all results with type information
                    if (data.results.characters?.hits) {
                        resources.push(...data.results.characters.hits.map(r => ({ ...r, type: 'character' })));
                    }
                    if (data.results.notes?.hits) {
                        resources.push(...data.results.notes.hits.map(r => ({ ...r, type: 'note' })));
                    }
                    if (data.results.scenarios?.hits) {
                        resources.push(...data.results.scenarios.hits.map(r => ({ ...r, type: 'scenario' })));
                    }
                    // Sort combined results by creation date (newest first)
                    resources.sort((a, b) => b.createdAt - a.createdAt);
                }
            } else {
                // Single-type search results
                const typeKey = this.state.selectedType + 's';
                resources = data[typeKey] || data.hits || [];
                resources = resources.map(r => ({ ...r, type: this.state.selectedType }));
            }

            // Transform to expected format
            this.state.resources = resources.map(resource => this.transformResource(resource));
            this.state.error = null;
        } catch (error) {
            console.error('Failed to fetch resources:', error);
            this.state.error = `Failed to load resources: ${error.message}`;
            this.state.resources = [];
        } finally {
            this.state.isLoading = false;
            this.updateView();
        }
    }

    transformResource(resource) {
        const baseTransform = {
            id: resource.id,
            name: resource.name,
            description: resource.description,
            type: resource.type,
            author: resource.authorName,
            downloads: resource.downloads || 0,
            rating: 4.5, // Default rating since we don't have ratings yet
            tags: resource.tags || [],
            isPublic: resource.isPublic,
            createdAt: resource.createdAt,
            updatedAt: resource.updatedAt
        };

        // Type-specific transformations
        switch (resource.type) {
            case 'character':
                return {
                    ...baseTransform,
                    personality: resource.personality,
                    scenario: resource.scenario,
                    firstMessage: resource.firstMessage,
                    exampleDialogue: resource.exampleDialogue,
                    avatarUrl: resource.avatar
                };
            case 'note':
                return {
                    ...baseTransform,
                    title: resource.title || resource.name,
                    content: resource.content,
                    category: resource.category
                };
            case 'scenario':
                return {
                    ...baseTransform,
                    category: resource.category,
                    characters: resource.characters,
                    messageCount: resource.messageCount,
                    characterCount: resource.characterCount
                };
            default:
                return baseTransform;
        }
    }

    handleSearch(event) {
        this.state.searchQuery = event.target.value;
        this.debounceSearch();
    }

    debounceSearch() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.fetchResources();
        }, 300);
    }

    handleViewModeToggle() {
        this.state.viewMode = this.state.viewMode === 'grid' ? 'list' : 'grid';
        this.updateView();
    }

    handleTypeFilter(event) {
        this.state.selectedType = event.target.value;
        this.fetchResources();
    }

    handleSortChange(event) {
        this.state.sortBy = event.target.value;
        this.fetchResources();
    }

    async handleResourceSelect(event) {
        const { resource } = event.detail;
        console.log('Selected resource:', resource);
        
        // Show confirmation dialog
        const action = this.getActionLabel(resource.type);
        const confirmImport = confirm(`${action} "${resource.name}" by ${resource.author}?\\n\\nThis will add the ${resource.type} to your local collection.`);
        
        if (confirmImport) {
            try {
                await this.importResource(resource);
            } catch (error) {
                console.error(`Failed to import ${resource.type}:`, error);
                alert(`Failed to import ${resource.type}: ${error.message}`);
            }
        }
    }

    getActionLabel(type) {
        switch (type) {
            case 'character': return 'Import character';
            case 'note': return 'Import note';
            case 'scenario': return 'Import scenario';
            default: return 'Import';
        }
    }

    async importResource(resource) {
        // First, track the download in the repository
        try {
            await fetch(`http://localhost:3001/api/${resource.type}s/${resource.id}/download`, {
                method: 'POST'
            });
        } catch (error) {
            console.warn('Failed to track download:', error);
        }

        // Import the resource into local Minerva
        const resourceData = this.prepareResourceData(resource);

        // Use Minerva's API for the specific resource type
        const response = await fetch(`/api/${resource.type}s`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(resourceData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `Failed to import ${resource.type}`);
        }

        const result = await response.json();
        
        // Show success message with option to navigate
        const goToResource = confirm(`${resource.type.charAt(0).toUpperCase() + resource.type.slice(1)} "${resource.name}" imported successfully!\\n\\nWould you like to view it now?`);
        
        if (goToResource) {
            // Navigate to the appropriate view
            window.dispatchEvent(new CustomEvent('navigate', {
                detail: { path: `${resource.type}s` }
            }));
        }

        return result;
    }

    prepareResourceData(resource) {
        const baseData = {
            name: resource.name,
            description: resource.description || '',
            tags: resource.tags || [],
            metadata: {
                importedFrom: 'repository',
                originalId: resource.id,
                originalAuthor: resource.author,
                importDate: new Date().toISOString()
            }
        };

        // Type-specific data preparation
        switch (resource.type) {
            case 'character':
                return {
                    ...baseData,
                    personality: resource.personality || '',
                    scenario: resource.scenario || '',
                    firstMessage: resource.firstMessage || '',
                    exampleDialogue: resource.exampleDialogue || '',
                    avatar: resource.avatarUrl || null
                };
            case 'note':
                return {
                    ...baseData,
                    title: resource.title || resource.name,
                    content: resource.content || '',
                    category: resource.category || 'general'
                };
            case 'scenario':
                return {
                    ...baseData,
                    category: resource.category || 'general',
                    characters: resource.characters || [],
                    messages: [] // Empty for imported scenarios
                };
            default:
                return baseData;
        }
    }

    getFilteredResources() {
        return this.state.resources;
    }

    handleUploadClick() {
        this.showUploadModal();
    }

    showUploadModal() {
        const modalContent = `
            <div class="upload-form">
                <div class="form-group">
                    <label for="upload-type">Resource Type:</label>
                    <select id="upload-type" class="form-control">
                        <option value="character">Character</option>
                        <option value="note">Note</option>
                        <option value="scenario">Scenario</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="local-resource">Select from your local collection:</label>
                    <select id="local-resource" class="form-control">
                        <option value="">Loading...</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="make-public" checked>
                        Make this resource public
                    </label>
                </div>
                
                <div class="form-group">
                    <label for="upload-tags">Tags (comma-separated):</label>
                    <input type="text" id="upload-tags" class="form-control" placeholder="fantasy, adventure, medieval">
                </div>
            </div>
        `;

        // Dispatch a custom event to request modal
        this.dispatchEvent(new CustomEvent('show-modal', {
            bubbles: true,
            detail: {
                title: 'Upload Resource to Repository',
                content: modalContent,
                buttons: [
                    {
                        label: 'Cancel',
                        className: 'button-secondary',
                        onClick: () => this.dispatchEvent(new CustomEvent('hide-modal', { bubbles: true }))
                    },
                    {
                        label: 'Upload',
                        className: 'button-primary',
                        onClick: () => this.handleUploadSubmit()
                    }
                ]
            }
        }));

        // Load local resources after modal is shown
        setTimeout(() => this.loadLocalResources(), 100);
    }

    async loadLocalResources() {
        try {
            const modal = document.querySelector('minerva-modal');
            if (!modal) return;

            const typeSelect = modal.shadowRoot.querySelector('#upload-type');
            const resourceSelect = modal.shadowRoot.querySelector('#local-resource');
            
            if (!typeSelect || !resourceSelect) return;

            const selectedType = typeSelect.value;
            
            // Fetch local resources of the selected type
            const response = await fetch(`/api/${selectedType}s`);
            const data = await response.json();
            
            const resources = data[selectedType + 's'] || data.resources || [];
            
            resourceSelect.innerHTML = resources.length > 0 
                ? `<option value="">Select a ${selectedType}...</option>` + 
                  resources.map(r => `<option value="${r.id || r._id}">${r.name || r.title}</option>`).join('')
                : `<option value="">No ${selectedType}s found in your local collection</option>`;

            // Update resource list when type changes
            typeSelect.addEventListener('change', () => this.loadLocalResources());

        } catch (error) {
            console.error('Failed to load local resources:', error);
            const resourceSelect = document.querySelector('#local-resource');
            if (resourceSelect) {
                resourceSelect.innerHTML = '<option value="">Error loading resources</option>';
            }
        }
    }

    async handleUploadSubmit() {
        try {
            const modal = document.querySelector('minerva-modal');
            if (!modal) return;

            const typeSelect = modal.shadowRoot.querySelector('#upload-type');
            const resourceSelect = modal.shadowRoot.querySelector('#local-resource');
            const publicCheckbox = modal.shadowRoot.querySelector('#make-public');
            const tagsInput = modal.shadowRoot.querySelector('#upload-tags');

            if (!typeSelect || !resourceSelect || !publicCheckbox || !tagsInput) {
                alert('Modal elements not found');
                return;
            }

            const selectedType = typeSelect.value;
            const selectedResourceId = resourceSelect.value;
            const isPublic = publicCheckbox.checked;
            const tags = tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag);

            if (!selectedResourceId) {
                alert('Please select a resource to upload');
                return;
            }

            // First, get the full resource data from local API
            const localResponse = await fetch(`/api/${selectedType}s/${selectedResourceId}`);
            if (!localResponse.ok) {
                throw new Error('Failed to fetch local resource');
            }

            const localData = await localResponse.json();
            const resource = localData[selectedType] || localData;

            // Prepare the upload data
            const uploadData = this.prepareUploadData(resource, selectedType, isPublic, tags);

            // Check if user is authenticated
            const accessToken = localStorage.getItem('repoAccessToken');
            if (!accessToken) {
                throw new Error('You must be signed in to upload resources. Please sign in from the user card.');
            }

            // Upload to repository
            const uploadResponse = await fetch(`http://localhost:3001/api/${selectedType}s`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify(uploadData)
            });

            if (!uploadResponse.ok) {
                const error = await uploadResponse.json();
                throw new Error(error.message || 'Upload failed');
            }

            window.modal.hide();
            alert(`${selectedType.charAt(0).toUpperCase() + selectedType.slice(1)} uploaded successfully!`);
            
            // Refresh the browse view to show the new resource
            await this.fetchResources();

        } catch (error) {
            console.error('Upload failed:', error);
            alert(`Upload failed: ${error.message}`);
        }
    }

    prepareUploadData(resource, type, isPublic, tags) {
        const baseData = {
            name: resource.name || resource.title,
            description: resource.description || '',
            tags: [...(resource.tags || []), ...tags],
            isPublic: isPublic
        };

        switch (type) {
            case 'character':
                return {
                    ...baseData,
                    personality: resource.personality || '',
                    scenario: resource.scenario || '',
                    firstMessage: resource.firstMessage || '',
                    exampleDialogue: resource.exampleDialogue || '',
                    avatar: resource.avatar || null
                };
                
            case 'note':
                return {
                    ...baseData,
                    title: resource.title || resource.name,
                    content: resource.content || '',
                    category: resource.category || 'general'
                };
                
            case 'scenario':
                return {
                    ...baseData,
                    category: resource.category || 'general',
                    characters: resource.characters || [],
                    // Don't include the actual messages for privacy
                    messageCount: resource.messages?.length || 0
                };
                
            default:
                return baseData;
        }
    }

    updateView() {
        const container = this.shadowRoot.querySelector('#resources-container');
        const loadingEl = this.shadowRoot.querySelector('#loading');
        const errorEl = this.shadowRoot.querySelector('#error');
        const emptyEl = this.shadowRoot.querySelector('#empty-state');
        const viewModeBtn = this.shadowRoot.querySelector('#view-mode-toggle');
        const typeFilter = this.shadowRoot.querySelector('#type-filter');
        const sortSelect = this.shadowRoot.querySelector('#sort-select');
        
        // Update controls
        const icon = this.state.viewMode === 'grid' ? 'view_list' : 'grid_view';
        const title = this.state.viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View';
        viewModeBtn.innerHTML = `<span class="material-icons">${icon}</span>`;
        viewModeBtn.title = title;
        
        // Update filter values
        typeFilter.value = this.state.selectedType;
        sortSelect.value = this.state.sortBy;
        
        // Update container class
        container.className = `resources-container ${this.state.viewMode}-view`;
        
        // Show/hide states
        loadingEl.style.display = this.state.isLoading ? 'flex' : 'none';
        errorEl.style.display = this.state.error ? 'block' : 'none';
        if (this.state.error) {
            errorEl.textContent = this.state.error;
        }
        
        const resources = this.getFilteredResources();
        const isEmpty = !this.state.isLoading && !this.state.error && resources.length === 0;
        emptyEl.style.display = isEmpty ? 'flex' : 'none';
        container.style.display = (!this.state.isLoading && !this.state.error && resources.length > 0) ? 'block' : 'none';
        
        // Render resources
        if (resources.length > 0) {
            container.innerHTML = resources.map(resource => {
                return `<resource-card type="${this.state.viewMode === 'grid' ? 'card' : 'list-item'}"></resource-card>`;
            }).join('');
            
            // Set resource data for each card
            const cards = container.querySelectorAll('resource-card');
            cards.forEach((card, index) => {
                card.resource = resources[index];
            });
        }
    }

    render() {
        this._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="view-header">
                        <h2>Browse Repository</h2>
                        <div class="header-controls">
                            <div class="search-bar">
                                <span class="material-icons">search</span>
                                <input type="text" id="search-input" placeholder="Search resources...">
                            </div>
                            <select id="type-filter" class="filter-select">
                                <option value="all">All Types</option>
                                <option value="character">Characters</option>
                                <option value="note">Notes</option>
                                <option value="scenario">Scenarios</option>
                            </select>
                            <button id="upload-btn" class="button-primary upload-button" title="Upload Resource">
                                <span class="material-icons">upload</span>
                                <span>Upload</span>
                            </button>
                            <button id="view-mode-toggle" class="icon-button" title="Switch View Mode">
                                <span class="material-icons">view_list</span>
                            </button>
                        </div>
                    </header>
                    
                    <div class="content-area">
                        <div id="loading" class="loading-state">
                            <span class="material-icons spinning">refresh</span>
                            <p>Loading resources...</p>
                        </div>
                        
                        <div id="error" class="error-state"></div>
                        
                        <div id="empty-state" class="empty-state">
                            <span class="material-icons">search_off</span>
                            <h3>No resources found</h3>
                            <p>Try adjusting your search terms or filters.</p>
                        </div>
                        
                        <div id="resources-container" class="resources-container grid-view"></div>
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
                                <option value="recent">Recently Added</option>
                                <option value="popular">Most Popular</option>
                                <option value="rating">Highest Rated</option>
                                <option value="name">Name A-Z</option>
                            </select>
                        </div>
                        
                        <div class="stats">
                            <p><strong>Remote Repository</strong></p>
                            <p>Browse and import shared content</p>
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
            
            .filter-select {
                padding: var(--spacing-sm); background-color: var(--bg-2);
                border: 1px solid var(--bg-3); border-radius: var(--radius-sm);
                color: var(--text-primary); font-size: var(--font-size-md);
            }
            
            .upload-button {
                display: flex; align-items: center; gap: var(--spacing-xs);
                padding: var(--spacing-sm) var(--spacing-md);
                background: var(--accent-primary); color: white; border: none;
                border-radius: var(--radius-sm); font-size: var(--font-size-md);
                cursor: pointer; transition: background-color 0.2s;
            }
            
            .upload-button:hover {
                background: var(--accent-primary-hover);
            }
            
            .upload-button .material-icons {
                font-size: 18px;
            }
            
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
            
            .resources-container.grid-view {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: var(--spacing-md);
            }
            
            .resources-container.list-view {
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
            
            /* Upload Modal Styles */
            .upload-form {
                display: flex; flex-direction: column; gap: var(--spacing-md);
            }
            
            .upload-form .form-group {
                display: flex; flex-direction: column; gap: var(--spacing-xs);
            }
            
            .upload-form label {
                font-weight: 500; color: var(--text-secondary); 
                font-size: var(--font-size-sm);
            }
            
            .upload-form .form-control {
                padding: var(--spacing-sm); background-color: var(--bg-1);
                border: 1px solid var(--bg-3); border-radius: var(--radius-sm);
                color: var(--text-primary); font-size: var(--font-size-md);
            }
            
            .upload-form label input[type="checkbox"] {
                margin-right: var(--spacing-xs);
            }
            
            @media (max-width: 768px) {
                .view-header { flex-direction: column; gap: var(--spacing-sm); align-items: stretch; }
                .header-controls { justify-content: space-between; flex-wrap: wrap; }
                .search-bar { min-width: 0; flex-grow: 1; }
                .upload-button { order: -1; align-self: flex-start; }
                .resources-container.grid-view {
                    grid-template-columns: 1fr;
                }
            }
        `;
    }
}

customElements.define('browse-view', BrowseView);