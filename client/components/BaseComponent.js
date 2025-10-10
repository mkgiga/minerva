/**
 * A base class for our Web Components to reduce boilerplate.
 * It handles shadow DOM creation and provides a simple render method.
 */
export class BaseComponent extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    /**
     * Initializes the shadow DOM with a template and styles.
     * This is a destructive operation that replaces the entire shadow DOM content.
     * It should only be called once when the component is first connected.
     * @param {string} template - The HTML template string.
     * @param {string} [styles=''] - Component-specific CSS rules.
     */
    _initShadow(template, styles = '') {
        this.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
            <link rel="stylesheet" href="style.css">
            <style>
                /* Component-specific styles */
                ${styles}
            </style>
            ${template}
        `;
    }

    dispatch(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, {
            bubbles: true,
            composed: true,
            detail
        }));
    }
}