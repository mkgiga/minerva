// client\components\ItemList.js
import { BaseComponent } from './BaseComponent.js';

class ItemList extends BaseComponent {
    constructor() {
        super();
        this._items = [];
        this._selectedId = null;
        this.activeId = null;
        this._userId = null; // Internal property for user persona
        this._headerActions = [];
        this.disabledIds = []; // Array of item IDs to be rendered as disabled
        this.readonlyIds = []; // Array of item IDs that cannot be removed
        this._customActions = [];
        this._multiSelect = false;
        this._multiSelectedIds = new Set();
        this.#expandedIds = new Set(); // For tree view
        this.render();
    }

    #expandedIds = new Set();

    static get observedAttributes() {
        return ['list-title', 'items-creatable', 'items-removable', 'items-activatable', 'items-user-selectable', 'items-appendable', 'has-avatar'];
    }

    set headerActions(actions) {
        this._headerActions = actions || [];
        if (this.shadowRoot.querySelector('header')) {
            this._updateHeader();
        }
    }

    get headerActions() {
        return this._headerActions;
    }

    set multiSelect(value) {
        const isMulti = !!value;
        if (this._multiSelect === isMulti) return;
        this._multiSelect = isMulti;
        if (!isMulti) {
            this.clearMultiSelection();
        }
        this._populateList();
    }

    get multiSelect() {
        return this._multiSelect;
    }

    attributeChangedCallback() {
        this._updateHeader();
        this._populateList();
    }
    
    connectedCallback() {
        this.shadowRoot.addEventListener('click', this.onClick.bind(this));
    }

    set items(newItems) {
        this._items = newItems || [];
        this._populateList();
    }
    get items() { return this._items; }

    set selectedId(id) {
        this._selectedId = id;
        this._updateSelection();
    }
    get selectedId() { return this._selectedId; }

    set userId(id) {
        if (this._userId !== id) {
            this._userId = id;
            this._populateList();
        }
    }
    get userId() {
        return this._userId;
    }

    addCustomAction({ icon, name, title, callback }) {
        this._customActions.push({ icon, name, title, callback });
        this._renderCustomActions();
    }

    getMultiSelectedIds() {
        return Array.from(this._multiSelectedIds);
    }

    clearMultiSelection() {
        this._multiSelectedIds.clear();
        this._populateList();
    }

    onClick(event) {
        const expander = event.target.closest('.expander');
        if (expander) {
            event.stopPropagation();
            const listItem = event.target.closest('li[data-id]');
            if (listItem) {
                const id = listItem.dataset.id;
                if (this.#expandedIds.has(id)) {
                    this.#expandedIds.delete(id);
                } else {
                    this.#expandedIds.add(id);
                }
                this._populateList();
            }
            return;
        }

        const customActionButton = event.target.closest('.custom-action-btn');
        if (customActionButton) {
            event.stopPropagation();
            const actionName = customActionButton.dataset.action;
            const action = this._customActions.find(a => a.name === actionName);
            if (action && action.callback) {
                action.callback();
            }
            return;
        }

        const button = event.target.closest('[data-action]');
        const listItem = event.target.closest('li[data-id]');

        if (button) {
            event.stopPropagation();
            const action = button.dataset.action;
            const id = button.dataset.id;
            
            if (action === 'add') {
                this.dispatch('item-add', {});
            } else if (id) {
                const item = this._findItemById(this._items, id);
                if (item) this.dispatch(`item-${action}`, { item });
            } else {
                this.dispatch('header-action', { action });
            }
        } else if (listItem) {
            if (listItem.classList.contains('disabled')) {
                return;
            }
            const id = listItem.dataset.id;
            const item = this._findItemById(this._items, id);
            if (!item) return;

            if (this.multiSelect) {
                const checkbox = listItem.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    if (checkbox.checked) {
                        this._multiSelectedIds.add(id);
                    } else {
                        this._multiSelectedIds.delete(id);
                    }
                    this.dispatch('multi-selection-change', { selectedIds: this.getMultiSelectedIds() });
                }
            } else {
                this.dispatch('item-select', { item });
            }
        }
    }
    
    _findItemById(items, id) {
        for (const item of items) {
            if (item.id === id) return item;
            if (item.children && item.children.length > 0) {
                const found = this._findItemById(item.children, id);
                if (found) return found;
            }
        }
        return null;
    }

    render() {
        super._initShadow(`
            <header></header>
            <div class="custom-actions-bar"></div>
            <div class="list-content"><ul></ul></div>
        `, this.styles());
        this._updateHeader();
        this._renderCustomActions();
        this._populateList();
    }
    
    _renderCustomActions() {
        const container = this.shadowRoot.querySelector('.custom-actions-bar');
        if (!container) return;

        if (this._customActions.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = this._customActions.map(action => `
            <button class="custom-action-btn" data-action="${action.name}" title="${action.title}">
                <span class="material-icons">${action.icon}</span>
            </button>
        `).join('');
    }

    _updateHeader() {
        const header = this.shadowRoot.querySelector('header');
        if (!header) return;

        header.innerHTML = `<h3>${this.getAttribute('list-title') || 'Items'}</h3><div class="header-actions"></div>`;
        const actionsContainer = header.querySelector('.header-actions');
        
        for (const action of (this._headerActions || [])) {
            actionsContainer.innerHTML += `<button class="icon-button" data-action="${action.name}" title="${action.title || ''}"><span class="material-icons">${action.icon}</span></button>`;
        }
        if (this.hasAttribute('items-creatable')) {
            actionsContainer.innerHTML += `<button class="add-button" data-action="add" title="Add New"><span class="material-icons">add</span></button>`;
        }
    }

    _populateList() {
        const listEl = this.shadowRoot.querySelector('ul');
        if (!listEl) return;
        listEl.innerHTML = this._renderList(this._items, 0);
    }

    _renderList(items, level) {
        if (!items || items.length === 0) return '';
        return items.map(item => this._renderItem(item, level)).join('');
    }

    _renderItem(item, level) {
        const isExpanded = this.#expandedIds.has(item.id);
        const hasChildren = item.children && item.children.length > 0;
        
        const childrenHtml = hasChildren && isExpanded
            ? `<ul class="child-list">${this._renderList(item.children, level + 1)}</ul>`
            : '';

        const expanderHtml = hasChildren
            ? `<button class="expander icon-button"><span class="material-icons">${isExpanded ? 'expand_more' : 'chevron_right'}</span></button>`
            : `<span class="expander-placeholder"></span>`;
        
        const removable = this.hasAttribute('items-removable');
        const activatable = this.hasAttribute('items-activatable');
        const userSelectable = this.hasAttribute('items-user-selectable');
        const appendable = this.hasAttribute('items-appendable');
        const hasAvatar = this.hasAttribute('has-avatar');
        
        let actionsHtml = '';
        if (appendable) {
            actionsHtml += `<button class="icon-button" data-action="append" data-id="${item.id}" title="Add to config"><span class="material-icons">add_circle_outline</span></button>`;
        }
        if (userSelectable) {
            const isUser = this._userId === item.id;
            actionsHtml += `<button class="icon-button user-btn ${isUser ? 'active' : ''}" data-action="set-user" data-id="${item.id}" title="${isUser ? 'Unset as User Persona' : 'Set as User Persona'}"><span class="material-icons">account_circle</span></button>`;
        }
        if (activatable) {
            const isActive = this.activeId === item.id;
            actionsHtml += `<button class="icon-button activate-btn ${isActive ? 'active' : ''}" data-action="activate" data-id="${item.id}" title="${isActive ? 'Currently active' : 'Set as active config'}"><span class="material-icons">${isActive ? 'radio_button_checked' : 'radio_button_off'}</span></button>`;
        }
        const isReadonly = this.readonlyIds && this.readonlyIds.includes(item.id);
        if (removable && !isReadonly) {
            actionsHtml += `<button class="icon-button delete" data-action="delete" data-id="${item.id}" title="Delete"><span class="material-icons">delete</span></button>`;
        }
        
        const isUserPersona = userSelectable && this._userId === item.id;
        const isDisabled = this.disabledIds && this.disabledIds.includes(item.id);
        const isSystemDefined = item.isSystemDefined;
        
        const isMultiSelected = this.multiSelect && this._multiSelectedIds.has(item.id);
        const checkboxHtml = this.multiSelect 
            ? `<input type="checkbox" class="multiselect-checkbox" ${isMultiSelected ? 'checked' : ''} data-id="${item.id}">` 
            : '';
            
        const avatarHtml = hasAvatar ? `<img class="avatar" src="${item.avatarUrl || 'assets/images/default_avatar.svg'}" alt="${item.name}'s avatar">` : '';

        const liClasses = [
            item.id === this._selectedId ? 'selected' : '',
            isUserPersona ? 'user-persona' : '',
            isDisabled ? 'disabled' : '',
            isSystemDefined ? 'system-defined' : '',
            this.multiSelect ? 'multi-select-mode' : '',
        ].join(' ').trim();

        const style = `padding-left: calc(var(--spacing-sm) + ${level * 16}px);`;

        return `
            <li data-id="${item.id}" class="${liClasses}" style="${style}">
                ${expanderHtml}
                ${checkboxHtml}
                ${avatarHtml}
                <div class="item-name">${item.name}</div>
                <div class="actions">${actionsHtml}</div>
            </li>
            ${childrenHtml}
        `;
    }

    _updateSelection() {
        this.shadowRoot.querySelectorAll('li.selected').forEach(el => el.classList.remove('selected'));
        if (this._selectedId) {
            const newEl = this.shadowRoot.querySelector(`li[data-id="${this._selectedId}"]`);
            if (newEl) newEl.classList.add('selected');
        }
    }

    styles() {
        return `
            :host { display: flex; flex-direction: column; height: 100%; background-color: var(--bg-1); }
            header { display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3); flex-shrink: 0; gap: var(--spacing-sm); }
            header h3 { flex-grow: 1; margin-bottom: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .header-actions { display: flex; align-items: center; flex-shrink: 0; gap: var(--spacing-xs); }
            .custom-actions-bar { display: none; padding: var(--spacing-xs) var(--spacing-sm); padding-left: var(--spacing-md); border-bottom: 1px solid var(--bg-3); gap: var(--spacing-sm); background-color: var(--bg-1); flex-wrap: wrap; }
            .custom-action-btn { display: inline-flex; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-xs) var(--spacing-sm); background: var(--bg-1); border: none; color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-sm); transition: var(--transition-fast); aspect-ratio: 1; }
            .custom-action-btn:hover { background: var(--bg-3); color: var(--text-primary); }
            .custom-action-btn .material-icons { font-size: 1.1rem; }
            .list-content { overflow-y: auto; flex-grow: 1; }
            ul { list-style: none; padding: 0; margin: 0; }
            li { position: relative; display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md); cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast); gap: var(--spacing-sm); }
            li:hover { background-color: var(--bg-2); }
            li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            li.selected .item-name { font-weight: 600; }
            li.user-persona::before { content: 'User'; position: absolute; top: 3px; left: -2px; background-color: var(--accent-warn); color: var(--bg-0); font-size: 0.65rem; font-weight: 600; padding: 2px 5px; border-radius: var(--radius-sm); z-index: 1; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
            li.disabled { opacity: 0.5; cursor: not-allowed; }
            li.disabled:hover { background-color: var(--bg-1); }
            li.system-defined .item-name { font-style: italic; color: var(--text-secondary); }
            li.selected.system-defined .item-name { color: var(--bg-1); }
            li.multi-select-mode { padding-left: var(--spacing-sm); }
            .multiselect-checkbox { flex-shrink: 0; }
            .avatar { width: 40px; height: 40px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0; background-color: var(--bg-3); }
            .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; display: flex; align-items: center; gap: 8px; }
            .actions { display: flex; flex-shrink: 0; gap: var(--spacing-xs); }
            .add-button, .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; transition: var(--transition-fast); display: flex; align-items: center; justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm); }
            .add-button:hover, .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            .icon-button.delete:hover { color: var(--accent-danger); }
            li.selected .icon-button.delete:hover { color: var(--accent-danger); }
            .icon-button.activate-btn.active { color: var(--accent-primary); }
            li.selected .icon-button.activate-btn.active { color: var(--bg-0); }
            .icon-button.user-btn.active { color: var(--accent-warn); }
            li.selected .icon-button.user-btn.active, li.selected .icon-button.activate-btn.active { color: var(--bg-0); }

            .expander, .expander-placeholder { width: 24px; height: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
            .expander { cursor: pointer; border-radius: 50%; }
            .expander:hover { background-color: rgba(255, 255, 255, 0.1); }
            li.selected .expander:hover { background-color: rgba(0, 0, 0, 0.1); }

            ul.child-list { list-style: none; padding: 0; margin: 0; width: 100%; }
            .child-list li { border-top: 1px solid var(--bg-3); border-bottom: none; }
        `;
    }
}
customElements.define('item-list', ItemList);