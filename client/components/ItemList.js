// client/components/ItemList.js
import { BaseComponent } from './BaseComponent.js';

/**
 * A "dumb" component that provides a container for a list of items.
 * It uses a <slot> to allow parent components to inject fully-styled <li> elements.
 * It listens for clicks on slotted items and dispatches a single, generic 'item-action' event.
 */
class ItemList extends BaseComponent {
    constructor() {
        super();
        this.render();
    }

    connectedCallback() {
        // Use a capturing event listener on the host to catch clicks on slotted elements
        this.addEventListener('click', this.onClick.bind(this), true);
    }
    
    disconnectedCallback() {
        this.removeEventListener('click', this.onClick.bind(this), true);
    }

    onClick(event) {
        // event.composedPath() will give us the path of the event, even through shadow DOM boundaries.
        // We find the first `li` with a `data-id` in the event path.
        const listItem = event.composedPath().find(el => el.tagName === 'LI' && el.dataset.id);
        if (!listItem) return;

        // Stop the event from propagating further up if we've handled it.
        event.stopPropagation();

        const id = listItem.dataset.id;
        // Find the action target within the list item that was clicked.
        const actionTarget = event.composedPath().find(el => el.dataset && el.dataset.action && listItem.contains(el));
        
        // If an element with `data-action` was clicked, use that action. Otherwise, default to 'select'.
        const action = actionTarget ? actionTarget.dataset.action : 'select';

        this.dispatch('item-action', {
            id,
            action,
            target: event.target,
            listItem: listItem
        });
    }

    render() {
        super._initShadow(
            `<div class="list-container" part="container"><ul part="list"><slot></slot></ul></div>`,
            `
            :host {
                display: block;
                height: 100%;
                background-color: var(--bg-0);
                overflow: hidden; /* Let the container handle scroll */
            }
            .list-container {
                height: 100%;
                overflow-y: auto;
            }
            ul {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            `
        );
    }
}
customElements.define('item-list', ItemList);