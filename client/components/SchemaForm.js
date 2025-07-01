import { BaseComponent } from './BaseComponent.js';

/**
 * A component that dynamically generates a form based on a JSON schema.
 *
 * Properties:
 * - schema {Array<object>}: An array of field definition objects.
 * - data {object}: An object containing the initial data for the form fields.
 *
 * Events:
 * - change: Fired when any input value changes. The event detail contains an
 *   object with the changed field's name and new value, e.g., { name: 'new value' }.
 */
class SchemaForm extends BaseComponent {
    constructor() {
        super();
        this._schema = [];
        this._data = {};
        this.render();
    }

    set schema(newSchema) {
        this._schema = newSchema || [];
        this.render();
    }
    get schema() { return this._schema; }

    set data(newData) {
        this._data = newData || {};
        if (this.isConnected) {
            this.populateForm();
        }
    }
    get data() { return this._data; }

    connectedCallback() {
        
        this.shadowRoot.addEventListener('input', this.handleInput.bind(this));
    }
    
    /**
     * Serializes the current form state into a JavaScript object.
     * @returns {object} The form data.
     */
    serialize() {
        const data = {};
        const formElements = this.shadowRoot.querySelectorAll('input, select, text-box, textarea');

        for (const el of formElements) {
            if (!el.name) continue;

            if (el.type === 'checkbox') {
                data[el.name] = el.checked;
            } else {
                data[el.name] = el.value;
            }
        }

        // Convert number strings to actual numbers where appropriate
        for (const field of this.schema) {
            if ((field.type === 'number' || field.type === 'range') && data[field.name] != null && data[field.name] !== '') {
                data[field.name] = Number(data[field.name]);
            }
        }
        return data;
    }

    handleInput(event) {
        const target = event.target;
        if (!target.name) return;

        let value = target.type === 'checkbox' ? target.checked : target.value;
        
        // Update range value display
        if (target.type === 'range') {
            const valueSpan = target.closest('.range-container')?.querySelector('.range-value');
            if (valueSpan) valueSpan.textContent = value;
        }
        
        this.dispatch('change', { [target.name]: value });
    }

    populateForm() {
        if (!this.isConnected || !this._data) return;
        for (const field of this.schema) {
            const el = this.shadowRoot.querySelector(`[name="${field.name}"]`);
            if (el && this._data[field.name] !== undefined) {
                if (el.type === 'checkbox') {
                    el.checked = this._data[field.name];
                } else {
                    el.value = this._data[field.name];
                }
            }
        }
    }

    render() {
        const formHtml = this.schema.map(field => {
            const id = `field-${field.name}`;
            const value = this._data[field.name] ?? field.defaultValue ?? '';
            let inputHtml = '';

            switch (field.type) {
                case 'range':
                    inputHtml = `
                        <div class="range-container">
                            <input type="range" id="${id}" name="${field.name}" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">
                            <span class="range-value">${value}</span>
                        </div>
                    `;
                    break;
                case 'select':
                    const optionsHtml = (field.options || []).map(opt => 
                        `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
                    ).join('');
                    inputHtml = `<select id="${id}" name="${field.name}">${optionsHtml}</select>`;
                    break;
                case 'textarea':
                     inputHtml = `<text-box id="${id}" name="${field.name}" placeholder="${field.placeholder || ''}"></text-box>`;
                     break;
                default:
                    inputHtml = `<input type="${field.type || 'text'}" id="${id}" name="${field.name}" value="${value}" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>`;
            }

            return `
                <div class="form-group">
                    <label for="${id}">${field.label}</label>
                    ${inputHtml}
                    ${field.description ? `<p class="field-description">${field.description}</p>` : ''}
                </div>
            `;
        }).join('');

        super._initShadow(formHtml, this.styles());
        this.populateForm();
    }
    
    styles() {
        return `
            /* All form element styling is inherited from global style.css */
            .range-container { display: flex; align-items: center; gap: var(--spacing-md); }
            .range-container input[type="range"] { flex-grow: 1; }
            .range-value { font-family: monospace; font-size: 0.9em; min-width: 4ch; text-align: right; }
            .field-description {
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                margin-top: var(--spacing-xs);
            }
            text-box {
                min-height: 100px;
                resize: vertical;
                padding: 0.75rem;
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                color: var(--text-primary);
                font-size: var(--font-size-md);
            }
            text-box:focus-within {
                outline: none;
                border-color: var(--accent-primary);
                box-shadow: 0 0 0 2px var(--accent-primary-faded, rgba(138, 180, 248, 0.3));
                transition: var(--transition-fast);
            }
        `;
    }
}
customElements.define('schema-form', SchemaForm);