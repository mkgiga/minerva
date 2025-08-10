import { BaseComponent } from '../BaseComponent.js';

class MinervaSpinner extends BaseComponent {
    constructor() {
        super();
        this._getProgress = () => 0; // Default progress function
        this.render();
    }
    
    static get observedAttributes() {
        return ['mode'];
    }

    connectedCallback() {
        
        if (this.getAttribute('mode') === 'progress') {
            this.startProgressAnimation();
        }
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'mode' && oldValue !== newValue) {
            this.render(); // Re-render if mode changes
            if (newValue === 'progress') {
                this.startProgressAnimation();
            }
        }
    }

    set getProgress(func) {
        if (typeof func === 'function') {
            this._getProgress = func;
        }
    }

    startProgressAnimation() {
        const progressCircle = this.shadowRoot.querySelector('.progress-ring__circle.progress');
        if (!progressCircle) return;

        const radius = progressCircle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
        
        const update = () => {
            if (!this.isConnected) return; // Stop animation if disconnected
            const progress = this._getProgress();
            const offset = circumference - progress * circumference;
            progressCircle.style.strokeDashoffset = offset;
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        };
        requestAnimationFrame(update);
    }
    
    render() {
        const mode = this.getAttribute('mode') || 'infinite';
        const template = mode === 'progress' ? this.progressTemplate() : this.infiniteTemplate();
        super._initShadow(template, this.styles());
    }
    
    infiniteTemplate() {
        return `<div class="spinner"></div>`;
    }
    
    progressTemplate() {
        return `
            <svg class="progress-ring" width="38" height="38">
                <circle class="progress-ring__circle background" stroke-width="4" fill="transparent" r="17" cx="19" cy="19"/>
                <circle class="progress-ring__circle progress" stroke-width="4" fill="transparent" r="17" cx="19" cy="19"/>
            </svg>
        `;
    }

    styles() {
        return `
            :host {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
            }

            /* Infinite Spinner */
            .spinner {
                border: 4px solid var(--bg-3);
                border-top: 4px solid var(--accent-primary);
                border-radius: 50%;
                width: 32px;
                height: 32px;
                animation: spin 1s linear infinite;
            }

            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }

            /* Progress Spinner */
            .progress-ring {
                transform-origin: center;
                transform: rotate(-90deg); /* Start from top */
            }
            .progress-ring__circle {
                transition: stroke-dashoffset 0.1s;
            }
            .progress-ring__circle.background {
                stroke: var(--bg-3);
            }
            .progress-ring__circle.progress {
                stroke: var(--accent-primary);
                stroke-linecap: round;
            }
        `;
    }
}

customElements.define('minerva-spinner', MinervaSpinner);