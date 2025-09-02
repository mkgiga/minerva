import { BaseComponent } from './BaseComponent.js';

class ResourceCard extends BaseComponent {
    constructor() {
        super();
        this._resource = null;
        this._type = 'card'; // 'card' or 'list-item'
    }

    static get observedAttributes() {
        return ['type'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'type' && oldValue !== newValue) {
            this._type = newValue || 'card';
            if (this.shadowRoot) this.render();
        }
    }

    /**
     * Set the resource data to display
     * @param {Object} resource - The resource object (character/note)
     */
    set resource(value) {
        this._resource = value;
        if (this.shadowRoot) this.render();
    }

    get resource() {
        return this._resource;
    }

    /**
     * Set the display type
     * @param {string} value - 'card' or 'list-item'
     */
    set type(value) {
        this.setAttribute('type', value);
    }

    get type() {
        return this._type;
    }

    connectedCallback() {
        this.render();
        this.addEventListener('click', this.handleClick.bind(this));
    }

    handleClick(event) {
        if (!this._resource) return;
        
        // Dispatch a custom event with the resource data
        this.dispatchEvent(new CustomEvent('resource-select', {
            bubbles: true,
            detail: {
                resource: this._resource,
                action: 'select'
            }
        }));
    }

    render() {
        if (!this._resource) {
            this._initShadow('<div class="placeholder">No resource data</div>', this.styles());
            return;
        }

        const template = this._type === 'card' 
            ? this.renderCard() 
            : this.renderListItem();
        
        this._initShadow(template, this.styles());
    }

    renderCard() {
        const { name, description, avatarUrl, type } = this._resource;
        const truncatedDescription = description && description.length > 120 
            ? description.substring(0, 120) + '...' 
            : description || '';
        
        const typeIcon = type === 'note' ? 'note' : 'person';
        const fallbackAvatar = type === 'note' 
            ? 'assets/images/default_note.svg' 
            : 'assets/images/default_avatar.svg';

        return `
            <div class="resource-card">
                <div class="card-header">
                    ${avatarUrl ? `<img class="card-avatar" src="${avatarUrl}" alt="${this._escapeHtml(name)}'s avatar">` : ''}
                    <div class="card-header-text">
                        <h3 class="card-title">${this._escapeHtml(name)}</h3>
                        <span class="card-type">
                            <span class="material-icons">${typeIcon}</span>
                            ${type === 'note' ? 'Note' : 'Character'}
                        </span>
                    </div>
                </div>
                ${truncatedDescription ? `
                    <div class="card-description">
                        <p>${this._escapeHtml(truncatedDescription)}</p>
                    </div>
                ` : ''}
                <div class="card-footer">
                    <span class="card-action">Click to select</span>
                </div>
            </div>
        `;
    }

    renderListItem() {
        const { name, avatarUrl, type } = this._resource;
        const typeIcon = type === 'note' ? 'note' : 'person';
        const fallbackAvatar = type === 'note' 
            ? 'assets/images/default_note.svg' 
            : 'assets/images/default_avatar.svg';

        return `
            <div class="resource-list-item">
                ${avatarUrl ? `<img class="list-avatar" src="${avatarUrl}" alt="${this._escapeHtml(name)}'s avatar">` : `<div class="list-avatar-placeholder"><span class="material-icons">${typeIcon}</span></div>`}
                <div class="list-item-content">
                    <span class="list-item-name">${this._escapeHtml(name)}</span>
                    <span class="list-item-type">${type === 'note' ? 'Note' : 'Character'}</span>
                </div>
            </div>
        `;
    }

    styles() {
        return `
            :host {
                display: block;
                cursor: pointer;
            }

            .placeholder {
                padding: var(--spacing-md);
                color: var(--text-disabled);
                font-style: italic;
                text-align: center;
            }

            /* Card Mode Styles */
            .resource-card {
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-md);
                padding: var(--spacing-md);
                display: flex;
                flex-direction: column;
                gap: var(--spacing-sm);
                transition: var(--transition-fast);
                height: 200px; /* Fixed height for grid layout */
            }

            .resource-card:hover {
                border-color: var(--accent-primary);
                box-shadow: 0 2px 8px rgba(138, 180, 248, 0.2);
                transform: translateY(-1px);
            }

            .card-header {
                display: flex;
                align-items: flex-start;
                gap: var(--spacing-sm);
            }

            .card-avatar {
                width: 48px;
                height: 48px;
                border-radius: var(--radius-sm);
                object-fit: cover;
                flex-shrink: 0;
                background-color: var(--bg-3);
            }

            .card-header-text {
                flex-grow: 1;
                min-width: 0;
            }

            .card-title {
                font-size: 1.1rem;
                font-weight: 600;
                margin: 0 0 var(--spacing-xs) 0;
                color: var(--text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .card-type {
                display: flex;
                align-items: center;
                gap: var(--spacing-xs);
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
            }

            .card-type .material-icons {
                font-size: 16px;
            }

            .card-description {
                flex-grow: 1;
                overflow: hidden;
            }

            .card-description p {
                margin: 0;
                font-size: var(--font-size-sm);
                line-height: 1.4;
                color: var(--text-secondary);
                display: -webkit-box;
                -webkit-line-clamp: 4;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }

            .card-footer {
                display: flex;
                justify-content: flex-end;
                margin-top: auto;
            }

            .card-action {
                font-size: var(--font-size-sm);
                color: var(--accent-primary);
                opacity: 0;
                transition: var(--transition-fast);
            }

            .resource-card:hover .card-action {
                opacity: 1;
            }

            /* List Item Mode Styles */
            .resource-list-item {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                padding: var(--spacing-sm);
                border-radius: var(--radius-sm);
                transition: var(--transition-fast);
                width: 100%;
            }

            .resource-list-item:hover {
                background-color: var(--bg-2);
            }

            .list-avatar {
                width: 40px;
                height: 40px;
                border-radius: var(--radius-sm);
                object-fit: cover;
                flex-shrink: 0;
                background-color: var(--bg-3);
            }

            .list-avatar-placeholder {
                width: 40px;
                height: 40px;
                border-radius: var(--radius-sm);
                background-color: var(--bg-3);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }

            .list-avatar-placeholder .material-icons {
                font-size: 20px;
                color: var(--text-disabled);
            }

            .list-item-content {
                flex-grow: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .list-item-name {
                font-weight: 500;
                color: var(--text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .list-item-type {
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
            }
        `;
    }
}

customElements.define('resource-card', ResourceCard);
export { ResourceCard };