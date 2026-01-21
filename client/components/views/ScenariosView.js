import { BaseComponent } from '../BaseComponent.js';
import { api, modal, notifier } from '../../client.js';
import '../ItemList.js';
import '../ScenarioEditor.js';

class ScenariosView extends BaseComponent {
    constructor() {
        super();
        this.state = {
            scenarios: [],
            selectedScenario: null,
            allCharacters: [],
            allNotes: [],
            sortMode: 'name-asc', // 'name-asc', 'name-desc', 'tag-group'
            selectedFilterTags: [], // Tags to filter by (OR logic)
        };

        this.handleResourceChange = this.handleResourceChange.bind(this);
        this.handleItemAction = this.handleItemAction.bind(this);
        this.handleEditorSave = this.handleEditorSave.bind(this);
        this.handleStartChat = this.handleStartChat.bind(this);
        this.handleColumnHeaderClick = this.handleColumnHeaderClick.bind(this);
        this.handleTagFilterClick = this.handleTagFilterClick.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.itemList = this.shadowRoot.querySelector('item-list');
        this.editor = this.shadowRoot.querySelector('scenario-editor');

        this.itemList.addEventListener('item-action', this.handleItemAction);
        this.shadowRoot.querySelector('#list-header').addEventListener('click', (e) => {
            if (e.target.closest('[data-action="add"]')) this.handleAdd();
        });
        this.shadowRoot.querySelector('#back-btn').addEventListener('click', () => {
            this.state.selectedScenario = null;
            this.updateView();
        });
        this.shadowRoot.querySelector('.list-header-row').addEventListener('click', this.handleColumnHeaderClick);
        this.shadowRoot.querySelector('.tag-filter-container').addEventListener('click', this.handleTagFilterClick);

        this.editor.addEventListener('scenario-save', (e) => this.handleEditorSave(e.detail));
        this.editor.addEventListener('start-chat', (e) => this.handleStartChat(e.detail.scenario));

        window.addEventListener('minerva-resource-changed', this.handleResourceChange);
        window.addEventListener('resize', () => this.updateView());

        await this.fetchData();
    }

    disconnectedCallback() {
        window.removeEventListener('minerva-resource-changed', this.handleResourceChange);
    }

    async fetchData() {
        try {
            const [scenarios, characters, notes] = await Promise.all([
                api.get('/api/scenarios'),
                api.get('/api/characters'),
                api.get('/api/notes')
            ]);
            this.state.scenarios = scenarios;
            this.state.allCharacters = characters;
            this.state.allNotes = notes;
            
            // Pass context to editor
            this.editor.allCharacters = characters;
            this.editor.allNotes = notes;

            this.updateView();
        } catch (error) {
            console.error('Failed to fetch data for ScenariosView:', error);
            notifier.show({ type: 'bad', message: 'Failed to load scenarios.' });
        }
    }

    handleResourceChange(event) {
        const { resourceType, eventType, data } = event.detail;
        
        if (resourceType === 'scenario') {
            if (eventType === 'create') {
                this.state.scenarios.push(data);
                this.state.selectedScenario = data;
            } else if (eventType === 'update') {
                const idx = this.state.scenarios.findIndex(s => s.id === data.id);
                if (idx !== -1) {
                    this.state.scenarios[idx] = data;
                    if (this.state.selectedScenario?.id === data.id) this.state.selectedScenario = data;
                }
            } else if (eventType === 'delete') {
                this.state.scenarios = this.state.scenarios.filter(s => s.id !== data.id);
                if (this.state.selectedScenario?.id === data.id) this.state.selectedScenario = null;
            }
            this.updateView();
        } else if (resourceType === 'character' || resourceType === 'note') {
            // Refresh auxiliary data if characters/notes change
            this.fetchData();
        }
    }

    handleItemAction(event) {
        const { id, action } = event.detail;
        const scenario = this.state.scenarios.find(s => s.id === id);
        if (!scenario) return;

        if (action === 'select') {
            this.state.selectedScenario = scenario;
            this.updateView();
        } else if (action === 'delete') {
            modal.confirm({
                title: 'Delete Scenario',
                content: `Are you sure you want to delete "${scenario.name}"?`,
                confirmButtonClass: 'button-danger',
                onConfirm: async () => {
                    await api.delete(`/api/scenarios/${scenario.id}`);
                    notifier.show({ message: 'Scenario deleted.' });
                }
            });
        }
    }

    handleColumnHeaderClick(event) {
        const col = event.target.closest('.list-header-col');
        if (!col) return;

        const sortBy = col.dataset.sort;
        if (!sortBy) return;

        if (sortBy === 'name') {
            if (this.state.sortMode === 'name-asc') {
                this.state.sortMode = 'name-desc';
            } else {
                this.state.sortMode = 'name-asc';
            }
        } else if (sortBy === 'tags') {
            this.state.sortMode = 'tag-group';
        }

        this.#updateSortIndicators();
        this.renderList();
    }

    handleTagFilterClick(event) {
        const btn = event.target.closest('.tag-filter-btn');
        const dropdown = this.shadowRoot.querySelector('.tag-filter-dropdown');
        const checkbox = event.target.closest('input[type="checkbox"]');
        const clearBtn = event.target.closest('.clear-filter-btn');

        if (btn) {
            dropdown.classList.toggle('show');
            this.#renderTagFilterDropdown();
        } else if (checkbox) {
            const tag = checkbox.value;
            if (checkbox.checked) {
                if (!this.state.selectedFilterTags.includes(tag)) {
                    this.state.selectedFilterTags.push(tag);
                }
            } else {
                this.state.selectedFilterTags = this.state.selectedFilterTags.filter(t => t !== tag);
            }
            this.#updateFilterBtnState();
            this.renderList();
        } else if (clearBtn) {
            this.state.selectedFilterTags = [];
            this.#renderTagFilterDropdown();
            this.#updateFilterBtnState();
            this.renderList();
        } else if (!event.target.closest('.tag-filter-dropdown')) {
            dropdown.classList.remove('show');
        }
    }

    #updateSortIndicators() {
        const nameCol = this.shadowRoot.querySelector('.list-header-col[data-sort="name"]');
        const tagsCol = this.shadowRoot.querySelector('.list-header-col[data-sort="tags"]');

        nameCol.classList.remove('sort-asc', 'sort-desc', 'sort-active');
        tagsCol.classList.remove('sort-active');

        if (this.state.sortMode === 'name-asc') {
            nameCol.classList.add('sort-asc', 'sort-active');
        } else if (this.state.sortMode === 'name-desc') {
            nameCol.classList.add('sort-desc', 'sort-active');
        } else if (this.state.sortMode === 'tag-group') {
            tagsCol.classList.add('sort-active');
        }
    }

    #updateFilterBtnState() {
        const btn = this.shadowRoot.querySelector('.tag-filter-btn');
        const count = this.state.selectedFilterTags.length;
        if (count > 0) {
            btn.classList.add('has-filter');
            btn.querySelector('.filter-count').textContent = count;
            btn.querySelector('.filter-count').style.display = 'inline';
        } else {
            btn.classList.remove('has-filter');
            btn.querySelector('.filter-count').style.display = 'none';
        }
    }

    #getAllUniqueTags() {
        const tagsSet = new Set();
        for (const scenario of this.state.scenarios) {
            if (scenario.tags && Array.isArray(scenario.tags)) {
                scenario.tags.forEach(tag => tagsSet.add(tag));
            }
        }
        return Array.from(tagsSet).sort();
    }

    #renderTagFilterDropdown() {
        const dropdown = this.shadowRoot.querySelector('.tag-filter-dropdown');
        const allTags = this.#getAllUniqueTags();

        if (allTags.length === 0) {
            dropdown.innerHTML = '<div class="no-tags">No tags defined yet</div>';
            return;
        }

        dropdown.innerHTML = `
            <div class="tag-filter-list">
                ${allTags.map(tag => `
                    <label class="tag-filter-item">
                        <input type="checkbox" value="${tag}" ${this.state.selectedFilterTags.includes(tag) ? 'checked' : ''}>
                        <span>${tag}</span>
                    </label>
                `).join('')}
            </div>
            ${this.state.selectedFilterTags.length > 0 ? '<button class="clear-filter-btn">Clear filters</button>' : ''}
        `;
    }

    async handleAdd() {
        try {
            const newScenario = await api.post('/api/scenarios', { name: 'New Scenario' });
            this.state.selectedScenario = newScenario; // Optimistic selection
            // List update handled by SSE
        } catch (error) {
            notifier.show({ type: 'bad', message: 'Failed to create scenario.' });
        }
    }

    async handleEditorSave({ scenario, isImageUpdate }) {
        try {
            if (isImageUpdate) {
                // Image updates are handled via separate endpoint in editor, 
                // just notify here if needed, but SSE will trigger view update.
                notifier.show({ type: 'good', message: 'Image uploaded.' });
            } else {
                await api.put(`/api/scenarios/${scenario.id}`, scenario);
                notifier.show({ type: 'good', message: 'Scenario saved.' });
            }
        } catch (error) {
            notifier.show({ type: 'bad', message: 'Failed to save scenario.' });
        }
    }

    async handleStartChat(scenario) {
        try {
            const payload = {
                name: scenario.name,
                participants: [...scenario.participants],
                notes: [...scenario.notes],
                firstMessage: scenario.firstMessage
            };
            
            const newChat = await api.post('/api/chats', payload);
            
            // Navigate to main chat view and select the new chat
            this.dispatch('navigate-to-view', { 
                view: 'chat', 
                state: { selectedChatId: newChat.id } // MainChatView needs to support this
            });
            
            notifier.show({ type: 'good', message: 'Chat started from scenario.' });
        } catch (error) {
            console.error(error);
            notifier.show({ type: 'bad', message: 'Failed to start chat.' });
        }
    }

    renderList() {
        // Filter scenarios
        let filtered = this.state.scenarios;
        if (this.state.selectedFilterTags.length > 0) {
            filtered = filtered.filter(scenario => {
                if (!scenario.tags || scenario.tags.length === 0) return false;
                return this.state.selectedFilterTags.some(tag => scenario.tags.includes(tag));
            });
        }

        // Sort/group scenarios
        let html = '';
        if (this.state.sortMode === 'tag-group') {
            html = this.#renderGroupedByTag(filtered);
        } else {
            const sorted = [...filtered].sort((a, b) => {
                const cmp = a.name.localeCompare(b.name);
                return this.state.sortMode === 'name-desc' ? -cmp : cmp;
            });
            html = sorted.map(s => this.#renderScenarioItem(s)).join('');
        }

        this.itemList.innerHTML = html;
    }

    #renderGroupedByTag(scenarios) {
        const groups = new Map();
        const untagged = [];

        for (const scenario of scenarios) {
            if (scenario.tags && scenario.tags.length > 0) {
                const firstTag = scenario.tags[0];
                if (!groups.has(firstTag)) {
                    groups.set(firstTag, []);
                }
                groups.get(firstTag).push(scenario);
            } else {
                untagged.push(scenario);
            }
        }

        const sortedGroupNames = Array.from(groups.keys()).sort();

        let html = '';
        for (const groupName of sortedGroupNames) {
            const groupScenarios = groups.get(groupName).sort((a, b) => a.name.localeCompare(b.name));
            html += `<div class="list-group-header">${groupName}</div>`;
            html += groupScenarios.map(s => this.#renderScenarioItem(s)).join('');
        }

        if (untagged.length > 0) {
            untagged.sort((a, b) => a.name.localeCompare(b.name));
            html += `<div class="list-group-header">Untagged</div>`;
            html += untagged.map(s => this.#renderScenarioItem(s)).join('');
        }

        return html;
    }

    #renderScenarioItem(scenario) {
        const isSelected = this.state.selectedScenario?.id === scenario.id;
        const tags = scenario.tags || [];
        const displayTags = tags.slice(0, 2);
        const moreTags = tags.length > 2 ? tags.length - 2 : 0;
        const tagsHtml = displayTags.length > 0
            ? `<div class="item-tags">${displayTags.map(t => `<span class="item-tag">${t}</span>`).join('')}${moreTags > 0 ? `<span class="item-tag more">+${moreTags}</span>` : ''}</div>`
            : '';

        return `
            <li data-id="${scenario.id}" class="${isSelected ? 'selected' : ''}">
                <div class="list-item-row">
                    <img src="${scenario.avatarUrl || 'assets/images/default_avatar.svg'}" class="list-avatar">
                    <div class="item-info">
                        <div class="item-name">${scenario.name}</div>
                        ${tagsHtml}
                    </div>
                    <div class="actions">
                        <button class="icon-button delete-btn" data-action="delete" title="Delete"><span class="material-icons">delete</span></button>
                    </div>
                </div>
            </li>
        `;
    }

    updateView() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const sidebar = this.shadowRoot.querySelector('.panel-right-sidebar');
        const main = this.shadowRoot.querySelector('.panel-main');
        const mobileHeader = this.shadowRoot.querySelector('.mobile-header');

        if (isMobile) {
            if (this.state.selectedScenario) {
                sidebar.style.display = 'none';
                main.style.display = 'flex';
                mobileHeader.style.display = 'flex';
                this.shadowRoot.querySelector('#mobile-title').textContent = this.state.selectedScenario.name;
            } else {
                sidebar.style.display = 'flex';
                main.style.display = 'none';
            }
        } else {
            sidebar.style.display = 'flex';
            main.style.display = 'flex';
            mobileHeader.style.display = 'none';
        }

        this.renderList();
        this.editor.scenario = this.state.selectedScenario;
    }

    render() {
        super._initShadow(`
            <div style="display: contents;">
                <div class="panel-main">
                    <header class="mobile-header">
                        <button id="back-btn" class="icon-button"><span class="material-icons">arrow_back</span></button>
                        <h2 id="mobile-title">Editor</h2>
                    </header>
                    <scenario-editor></scenario-editor>
                </div>
                <div class="panel-right-sidebar">
                    <header id="list-header">
                        <h3>Scenarios</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="New Scenario"><span class="material-icons">add</span></button>
                        </div>
                    </header>
                    <div class="list-controls">
                        <div class="list-header-row">
                            <div class="list-header-col sort-asc sort-active" data-sort="name">
                                <span>Name</span>
                                <span class="material-icons sort-icon">arrow_upward</span>
                            </div>
                            <div class="list-header-col" data-sort="tags">
                                <span>Tags</span>
                            </div>
                        </div>
                        <div class="tag-filter-container">
                            <button class="tag-filter-btn" title="Filter by tags">
                                <span class="material-icons">filter_list</span>
                                <span class="filter-count" style="display:none;">0</span>
                            </button>
                            <div class="tag-filter-dropdown"></div>
                        </div>
                    </div>
                    <item-list></item-list>
                </div>
            </div>
        `, this.styles());
    }

    styles() {
        return `
            .panel-right-sidebar { flex-direction: column; border-left: 1px solid var(--bg-3); background: var(--bg-0); }
            #list-header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; }
            #list-header h3 { margin: 0; }
            .header-actions .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 4px; }
            .header-actions .icon-button:hover { background-color: var(--bg-2); color: var(--text-primary); }

            /* List Controls - Sort and Filter */
            .list-controls {
                display: flex;
                align-items: center;
                padding: var(--spacing-xs) var(--spacing-md);
                border-bottom: 1px solid var(--bg-3);
                gap: var(--spacing-sm);
                flex-shrink: 0;
            }
            .list-header-row {
                display: flex;
                flex: 1;
                gap: var(--spacing-md);
            }
            .list-header-col {
                display: flex;
                align-items: center;
                gap: 2px;
                cursor: pointer;
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                padding: var(--spacing-xs);
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
                user-select: none;
            }
            .list-header-col:hover {
                color: var(--text-primary);
                background: var(--bg-2);
            }
            .list-header-col.sort-active {
                color: var(--accent-primary);
                font-weight: 600;
            }
            .list-header-col .sort-icon {
                font-size: 14px;
                opacity: 0;
                transition: var(--transition-fast);
            }
            .list-header-col.sort-active .sort-icon {
                opacity: 1;
            }
            .list-header-col.sort-desc .sort-icon {
                transform: rotate(180deg);
            }
            .list-header-col[data-sort="name"] { flex: 1; }
            .list-header-col[data-sort="tags"] { flex-shrink: 0; }

            /* Tag Filter */
            .tag-filter-container {
                position: relative;
            }
            .tag-filter-btn {
                display: flex;
                align-items: center;
                gap: 4px;
                background: none;
                border: 1px solid var(--bg-3);
                color: var(--text-secondary);
                cursor: pointer;
                padding: var(--spacing-xs);
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
            }
            .tag-filter-btn:hover {
                color: var(--text-primary);
                background: var(--bg-2);
            }
            .tag-filter-btn.has-filter {
                color: var(--accent-primary);
                border-color: var(--accent-primary);
            }
            .tag-filter-btn .material-icons { font-size: 18px; }
            .tag-filter-btn .filter-count {
                font-size: 10px;
                font-weight: 600;
                background: var(--accent-primary);
                color: var(--bg-0);
                border-radius: 8px;
                padding: 0 5px;
                min-width: 14px;
                text-align: center;
            }
            .tag-filter-dropdown {
                display: none;
                position: absolute;
                top: 100%;
                right: 0;
                margin-top: var(--spacing-xs);
                background: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                box-shadow: var(--shadow-lg);
                min-width: 160px;
                max-height: 250px;
                overflow-y: auto;
                z-index: 100;
            }
            .tag-filter-dropdown.show { display: block; }
            .tag-filter-list {
                padding: var(--spacing-xs);
            }
            .tag-filter-item {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                padding: var(--spacing-xs) var(--spacing-sm);
                cursor: pointer;
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
            }
            .tag-filter-item:hover {
                background: var(--bg-2);
            }
            .tag-filter-item input[type="checkbox"] {
                margin: 0;
            }
            .clear-filter-btn {
                display: block;
                width: 100%;
                padding: var(--spacing-sm);
                background: none;
                border: none;
                border-top: 1px solid var(--bg-3);
                color: var(--accent-danger);
                cursor: pointer;
                font-size: var(--font-size-sm);
            }
            .clear-filter-btn:hover {
                background: var(--bg-2);
            }
            .no-tags {
                padding: var(--spacing-md);
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
                text-align: center;
            }

            .list-item-row { display: flex; align-items: center; padding: 8px 16px; gap: 10px; cursor: pointer; border-bottom: 1px solid var(--bg-3); }
            .list-item-row:hover { background-color: var(--bg-2); }
            li.selected .list-item-row { background-color: var(--accent-primary); color: var(--bg-0); }
            li.selected .icon-button { color: var(--bg-0); }
            li.selected .icon-button:hover { background-color: rgba(255,255,255,0.2); }

            .list-avatar { width: 36px; height: 36px; border-radius: 4px; object-fit: cover; background: var(--bg-3); flex-shrink: 0; }
            .item-info {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .item-tags {
                display: flex;
                gap: 4px;
                flex-wrap: wrap;
            }
            .item-tag {
                font-size: 0.65rem;
                padding: 1px 6px;
                background: var(--bg-2);
                border-radius: 8px;
                color: var(--text-secondary);
            }
            li.selected .item-tag {
                background: rgba(255,255,255,0.2);
                color: var(--bg-0);
            }
            .item-tag.more {
                font-style: italic;
            }

            /* Group headers */
            .list-group-header {
                font-weight: 600;
                font-size: var(--font-size-sm);
                padding: var(--spacing-sm) var(--spacing-md);
                background: var(--bg-2);
                color: var(--text-secondary);
                border-bottom: 1px solid var(--bg-3);
                position: sticky;
                top: 0;
                z-index: 1;
            }

            .panel-main { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
            .mobile-header { display: none; align-items: center; padding: 10px; border-bottom: 1px solid var(--bg-3); gap: 10px; background: var(--bg-1); }
            #mobile-title { margin: 0; font-size: 1.1rem; flex-grow: 1; }

            /* ALLOW SCROLLING: Removed overflow: hidden so component styles take effect */
            scenario-editor { flex-grow: 1; min-height: 0; }

            @media (max-width: 768px) {
                .panel-right-sidebar { border: none; width: 100%; }
            }
        `;
    }
}

customElements.define('scenarios-view', ScenariosView);