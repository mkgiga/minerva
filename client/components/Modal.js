import { BaseComponent } from './BaseComponent.js';

class MinervaModal extends BaseComponent {
    constructor() {
        super();
    }

    connectedCallback() {
        this.render();
        const backdrop = this.shadowRoot.querySelector('.modal-backdrop');
        const closeBtn = this.shadowRoot.querySelector('.close-btn');

        backdrop.addEventListener('click', (e) => {
            // Hide only if the click is on the backdrop itself, not the content
            if (e.target === backdrop) this.hide();
        });
        closeBtn.addEventListener('click', () => this.hide());
    }

    /**
     * Displays the modal with the given options.
     * @param {object} options - The modal options.
     * @param {string} options.title - The text to display in the modal header.
     * @param {string|HTMLElement} options.content - The content for the modal body.
     * @param {boolean} [options.hideCloseButton=false] - Hides the 'x' button if true.
     */
    show({ title, content, hideCloseButton = false }) {
        this.shadowRoot.querySelector('.modal-title').textContent = title || '';
        const body = this.shadowRoot.querySelector('.modal-body');
        body.innerHTML = ''; // Clear previous content

        if (typeof content === 'string') {
            body.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            body.appendChild(content);
        }

        const closeBtn = this.shadowRoot.querySelector('.close-btn');
        closeBtn.style.display = hideCloseButton ? 'none' : 'flex';

        this.style.display = 'block';
        requestAnimationFrame(() => this.classList.add('open'));
    }

    hide() {
        this.classList.remove('open');
        this.addEventListener('transitionend', () => {
            // Ensure the transition is for closing before hiding the element
            if (!this.classList.contains('open')) {
                this.style.display = 'none';
            }
        }, { once: true });
    }

    /**
     * Adds a button to the modal's footer.
     * @param {object} options - The button options.
     * @param {string} options.label - The text on the button.
     * @param {string} [options.className='button-primary'] - CSS classes for styling.
     * @param {function} options.onClick - The callback function to execute on click.
     */
    addButton({ label, className = 'button-primary', onClick }) {
        const button = document.createElement('button');
        button.textContent = label;
        button.className = className;
        button.addEventListener('click', onClick);
        this.shadowRoot.querySelector('.modal-controls').appendChild(button);
    }
    
    clearButtons() {
        this.shadowRoot.querySelector('.modal-controls').innerHTML = '';
    }

    render() {
        const template = `
            <div class="modal-backdrop">
                <div class="modal-content">
                    <header>
                        <h2 class="modal-title"></h2>
                        <button class="close-btn" title="Close"><span class="material-icons">close</span></button>
                    </header>
                    <div class="modal-body">
                        <!-- Content goes here -->
                    </div>
                    <footer>
                        <div class="modal-controls">
                            <!-- Buttons are added here dynamically -->
                        </div>
                    </footer>
                </div>
            </div>
        `;
        super._initShadow(template, this.styles());
    }

    styles() {
        return `
            :host {
                position: fixed; inset: 0; z-index: 1200;
                display: none; /* Hidden by default */
                opacity: 0;
                transition: opacity 0.2s ease-in-out;
            }
            :host(.open) { opacity: 1; }
            
            .modal-backdrop { 
                position: absolute; 
                inset: 0; 
                background-color: rgba(0,0,0,0.6);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .modal-content {
                background-color: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius-md);
                width: 90%; max-width: 500px; max-height: 80vh;
                display: flex; flex-direction: column;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                transform: scale(0.95);
                transition: transform 0.2s ease-in-out;
            }
            :host(.open) .modal-content { transform: scale(1); }
            
            header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md) var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0;
            }
            header h2 { margin: 0; }
            
            .close-btn {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                padding: var(--spacing-xs); display: flex; align-items: center; justify-content: center;
            }
            .close-btn:hover { color: var(--text-primary); }
            
            .modal-body {
                overflow-y: auto; padding: var(--spacing-lg); flex-grow: 1;
                line-height: 1.6;
                white-space: pre-wrap; /* For simple text messages */
            }
            
            footer {
                padding: var(--spacing-md) var(--spacing-lg);
                border-top: 1px solid var(--bg-3);
                flex-shrink: 0;
            }
            .modal-controls { display: flex; justify-content: flex-end; gap: var(--spacing-md); }

            /* Buttons use global styles imported via BaseComponent */
            .modal-controls button {
                padding: 0.6rem 1.2rem;
            }
        `;
    }
}
customElements.define('minerva-modal', MinervaModal);