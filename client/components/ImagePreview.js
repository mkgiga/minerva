// client/components/ImagePreview.js
import { BaseComponent } from './BaseComponent.js';

class MinervaImagePreview extends BaseComponent {
    #imageElement = null;
    #closeButton = null;
    #backdrop = null;

    constructor() {
        super();
        this.render();
    }

    connectedCallback() {
        this.#imageElement = this.shadowRoot.querySelector('.preview-image');
        this.#closeButton = this.shadowRoot.querySelector('.close-button');
        this.#backdrop = this.shadowRoot.querySelector('.backdrop');

        this.#backdrop.addEventListener('click', this.#handleBackdropClick.bind(this));
        this.#closeButton.addEventListener('click', this.hide.bind(this));
        // Allow closing with Escape key
        document.addEventListener('keydown', this.#handleKeyDown.bind(this));
    }

    disconnectedCallback() {
        document.removeEventListener('keydown', this.#handleKeyDown.bind(this));
    }

    /**
     * Shows the image preview with the given source and alt text.
     * @param {object} options
     * @param {string} options.src - The URL of the image to display.
     * @param {string} [options.alt=''] - The alt text for the image.
     */
    show({ src, alt = '' }) {
        this.#imageElement.src = src;
        this.#imageElement.alt = alt;
        this.style.display = 'flex'; // Make the host element visible
        requestAnimationFrame(() => {
            this.classList.add('open'); // Trigger fade-in/scale-in animation
        });
    }

    hide() {
        this.classList.remove('open'); // Trigger fade-out/scale-out animation
        this.addEventListener('transitionend', (e) => {
            // Ensure the transition is for opacity before hiding the element
            if (e.propertyName === 'opacity' && !this.classList.contains('open')) {
                this.style.display = 'none';
            }
        }, { once: true });
    }

    #handleBackdropClick(event) {
        // Only hide if the click is directly on the backdrop or close button, not the image itself
        if (event.target === this.#backdrop) {
            this.hide();
        }
    }

    #handleKeyDown(event) {
        if (event.key === 'Escape' && this.classList.contains('open')) {
            this.hide();
        }
    }

    render() {
        const template = `
            <div class="backdrop">
                <div class="image-container">
                    <img class="preview-image" src="" alt="">
                    <button class="close-button" title="Close"><span class="material-icons">close</span></button>
                </div>
            </div>
        `;
        super._initShadow(template, this.styles());
    }

    styles() {
        return `
            :host {
                position: fixed;
                inset: 0;
                z-index: 2000; /* High z-index to overlay everything */
                display: none; /* Hidden by default, changed to flex by show() */
                opacity: 0;
                transition: opacity 0.2s ease-out;
            }
            :host(.open) {
                opacity: 1;
            }
            
            .backdrop {
                position: absolute;
                inset: 0;
                background-color: rgba(0, 0, 0, 0.8); /* Dark, semi-transparent overlay */
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer; /* Indicates it's clickable to close */
            }

            .image-container {
                position: relative;
                max-width: 90vw; /* Maximum width on screen */
                max-height: 90vh; /* Maximum height on screen */
                display: flex; /* To center the image inside */
                align-items: center;
                justify-content: center;
                background-color: var(--bg-1); /* Slight background for images with transparency */
                border-radius: var(--radius-md);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.5);
                transition: transform 0.2s ease-out;
                transform: scale(0.95); /* Initial scale for entry animation */
            }

            :host(.open) .image-container {
                transform: scale(1); /* Scale to 100% on open */
            }

            .preview-image {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain; /* Ensures the entire image fits within the container */
                border-radius: var(--radius-md); /* Match container border-radius */
            }

            .close-button {
                position: absolute;
                top: var(--spacing-sm);
                right: var(--spacing-sm);
                background-color: rgba(0, 0, 0, 0.5);
                color: var(--text-primary);
                border: none;
                border-radius: 50%;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                opacity: 0.7;
                transition: opacity var(--transition-fast), background-color var(--transition-fast);
            }

            .close-button:hover {
                opacity: 1;
                background-color: var(--accent-danger);
            }

            .close-button .material-icons {
                font-size: 20px;
            }

            /* Mobile adjustments */
            @media (max-width: 768px) {
                .image-container {
                    max-width: 95vw;
                    max-height: 95vh;
                }
                .close-button {
                    top: var(--spacing-xs);
                    right: var(--spacing-xs);
                    width: 40px;
                    height: 40px;
                }
                .close-button .material-icons {
                    font-size: 24px;
                }
            }
        `;
    }
}

customElements.define('minerva-image-preview', MinervaImagePreview);