import { BaseComponent } from '../BaseComponent.js';

/**
 * A custom multi-line text input component that wraps a native <textarea>.
 * It auto-sizes based on content and can be styled by its parent.
 * It implements `value`, `name`, `placeholder`, and `disabled` properties
 * to behave like a standard form element.
 *
 * This component uses a CSS Grid-based technique for auto-sizing to ensure
 * cross-browser compatibility, especially for browsers like Safari on iOS
 * that do not yet support `field-sizing: content`.
 */
export class TextBox extends BaseComponent {
    static get observedAttributes() {
        return ['placeholder', 'value', 'name', 'disabled'];
    }

    #editor = null;
    #growWrap = null;
    #pendingValue = null;

    constructor() {
        super();
        this.render();
    }

    connectedCallback() {
        this.#editor = this.shadowRoot.querySelector('textarea');
        this.#growWrap = this.shadowRoot.querySelector('.grow-wrap');

        this.#editor.addEventListener('input', () => {
            this.#syncHeight();
            this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        });

        const initialValue = this.#pendingValue !== null ? this.#pendingValue : this.getAttribute('value');
        if (initialValue !== null) {
            this.value = initialValue; // The setter calls #syncHeight()
        }
        this.#pendingValue = null;

        this.#updateAttribute('placeholder', this.getAttribute('placeholder'));
        this.#updateAttribute('name', this.getAttribute('name'));
        this.#updateDisabledState();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (!this.#editor) return;

        switch (name) {
            case 'value':
                if (this.value !== newValue) {
                    this.value = newValue;
                }
                break;
            case 'placeholder':
            case 'name':
                this.#updateAttribute(name, newValue);
                break;
            case 'disabled':
                this.#updateDisabledState();
                break;
        }
    }

    get value() {
        if (this.#editor) {
            return this.#editor.value;
        }
        return this.#pendingValue || '';
    }

    set value(newValue) {
        const val = newValue || '';
        if (this.#editor) {
            this.#editor.value = val;
            this.#syncHeight();
        } else {
            this.#pendingValue = val;
        }
    }

    get name() {
        return this.getAttribute('name');
    }

    set name(newValue) {
        this.setAttribute('name', newValue);
    }

    get placeholder() {
        return this.getAttribute('placeholder');
    }

    set placeholder(newValue) {
        this.setAttribute('placeholder', newValue);
    }

    get disabled() {
        return this.hasAttribute('disabled');
    }

    set disabled(val) {
        if (val) {
            this.setAttribute('disabled', '');
        } else {
            this.removeAttribute('disabled');
        }
    }

    focus() {
        if (this.#editor) this.#editor.focus();
    }

    #syncHeight() {
        if (this.#growWrap) {
            this.#growWrap.dataset.replicatedValue = this.#editor.value;
        }
    }

    #updateAttribute(name, value) {
        if (value === null) {
            this.#editor.removeAttribute(name);
        } else {
            this.#editor.setAttribute(name, value);
        }
    }

    #updateDisabledState() {
        const isDisabled = this.hasAttribute('disabled');
        this.#editor.disabled = isDisabled;
        this.classList.toggle('disabled', isDisabled);
    }

    render() {
        const template = `<div class="grow-wrap"><textarea part="textarea"></textarea></div>`;
        const styles = `
            :host {
                display: block;
                /* Allow the host to become scrollable if a max-height is set by a parent. */
                overflow-y: auto;
                background-color: inherit;
            }

            :host(.disabled) {
                cursor: not-allowed;
            }

            /* This is the magic wrapper that grows with the content. */
            .grow-wrap {
                display: grid;
                background-color: inherit;
            }

            /* The pseudo-element mirrors the textarea's content and forces the wrapper to grow. */
            .grow-wrap::after {
                /* The space at the end is crucial for calculating the height of the last line. */
                content: attr(data-replicated-value) " ";
                white-space: pre-wrap;
                visibility: hidden;
                grid-area: 1 / 1 / 2 / 2;

                /* Match textarea styles for accurate sizing */
                font: inherit;
                padding: inherit;
                border: inherit;
                line-height: inherit;
                letter-spacing: inherit;
                word-break: break-word; /* Match textarea word wrapping */
            }

            textarea {
                /* The textarea is overlaid on top of the pseudo-element. */
                grid-area: 1 / 1 / 2 / 2;

                /* Fill the host element completely. */
                width: 100%;
                height: 100%;

                /* Inherit styles from the host for easy customization. */
                font: inherit;
                color: inherit;
                line-height: inherit;
                letter-spacing: inherit;
                padding: inherit;
                border: none;
                border-radius: inherit;
                background-color: inherit;

                /* Standard textarea resets. */
                resize: none;
                outline: none;
                box-sizing: border-box;
                overflow: hidden; /* Hide the internal scrollbar; the host handles scrolling. */
            }

            textarea::placeholder {
                color: var(--text-disabled);
            }

            textarea:disabled {
                color: var(--text-disabled);
                cursor: not-allowed;
            }
        `;
        super._initShadow(template, styles);
    }
}

customElements.define('text-box', TextBox);