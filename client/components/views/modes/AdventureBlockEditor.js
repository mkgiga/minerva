import { BaseComponent } from "../../BaseComponent.js";
import { uuidv4 } from "../../../client.js";

export class AdventureBlockEditor extends BaseComponent {
    #activeType = "text"; // 'text', 'speech', or 'unformatted'
    #participants = [];
    #allCharacters = [];
    #selectedCharacterId = null;
    #customName = "";
    #userPersona = null;

    constructor() {
        super();
        this.render();
    }

    static get observedAttributes() {
        return ["type"];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "type" && oldValue !== newValue) {
            this.#activeType = newValue;
            this.#updateView();
        }
    }

    connectedCallback() {
        this.shadowRoot.querySelector(".type-cycler").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.#cycleType();
        });
        
        // Helper to bind actions with stopPropagation to prevent weird bubbling issues
        const bindAction = (selector, eventName) => {
            const btn = this.shadowRoot.querySelector(selector);
            if (btn) {
                btn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.dispatch(eventName);
                });
            }
        };

        bindAction(".btn-up", "block-up");
        bindAction(".btn-down", "block-down");
        bindAction(".btn-del", "block-delete");
        bindAction(".btn-add", "block-add");

        // Speech specific logic
        const avatarContainer = this.shadowRoot.querySelector(".avatar-wrapper");
        avatarContainer.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.#toggleDropdown();
        });

        const customNameInput = this.shadowRoot.querySelector("#custom-name");
        customNameInput.addEventListener("input", (e) => {
            this.#customName = e.target.value;
        });
        
        // Close dropdown when clicking anywhere else
        document.addEventListener('click', this.#handleGlobalClick.bind(this));

        this.#updateView();
    }
    
    disconnectedCallback() {
        document.removeEventListener('click', this.#handleGlobalClick.bind(this));
    }

    #handleGlobalClick(e) {
        // Close dropdown if click is outside
        const dropdown = this.shadowRoot.querySelector(".character-dropdown");
        if (dropdown && dropdown.style.display === 'block') {
            dropdown.style.display = 'none';
        }
    }

    setContext(allCharacters, participantIds, userPersona) {
        this.#allCharacters = allCharacters;
        this.#userPersona = userPersona;
        
        // Normalize participant IDs (handle objects vs strings)
        this.#participants = (participantIds || []).map(p => typeof p === 'object' ? p.id : p);
        
        // Default selection logic if none set
        if (!this.#selectedCharacterId) {
            if (this.#userPersona) {
                this.#selectedCharacterId = this.#userPersona.id;
            } else if (this.#participants.length > 0) {
                this.#selectedCharacterId = this.#participants[0];
            }
        }
        
        this.#renderCharacterDropdown();
        this.#updateCharacterDisplay();
    }

    get activeType() {
        return this.#activeType;
    }

    /**
     * Pre-fills the editor with data
     */
    setData(type, content, speechData = {}) {
        this.#activeType = type;
        
        if (type === 'text' || type === 'unformatted') {
            this.shadowRoot.querySelector('.text-input').value = content;
        } else if (type === 'speech') {
            this.shadowRoot.querySelector('.speech-input').value = content;
            
            // Logic to determine selected character from ID or Name
            if (speechData.id) {
                // Try to find if ID exists in participants or global list or is the persona
                const exists = this.#allCharacters.some(c => c.id === speechData.id) || 
                               this.#participants.includes(speechData.id) ||
                               (this.#userPersona && this.#userPersona.id === speechData.id);
                               
                if (exists) {
                    this.#selectedCharacterId = speechData.id;
                } else {
                    // ID provided but not found, treat as custom
                    this.#selectedCharacterId = "__custom__";
                    this.#customName = speechData.name || speechData.id;
                }
            } else if (speechData.name) {
                // Try to resolve name to ID
                const char = this.#allCharacters.find(c => c.name.toLowerCase() === speechData.name.toLowerCase());
                if (char) {
                    this.#selectedCharacterId = char.id;
                } else {
                    this.#selectedCharacterId = "__custom__";
                    this.#customName = speechData.name;
                }
            } else {
                this.#selectedCharacterId = "__custom__";
                this.#customName = "Unknown";
            }
        }
        this.#updateView();
        this.#updateCharacterDisplay();
    }

    #cycleType() {
        if (this.classList.contains("placeholder")) return;
        
        // Cycle: text -> speech -> unformatted -> text
        if (this.#activeType === "text") {
            this.#activeType = "speech";
        } else if (this.#activeType === "speech") {
            this.#activeType = "unformatted";
        } else {
            this.#activeType = "text";
        }
        
        this.#updateView();
    }

    #updateView() {
        const headerLabel = this.shadowRoot.querySelector(".type-label");
        const textEditor = this.shadowRoot.querySelector(".text-editor");
        const speechEditor = this.shadowRoot.querySelector(".speech-editor");
        const typeIcon = this.shadowRoot.querySelector(".type-icon");

        if (this.#activeType === "text") {
            headerLabel.textContent = "Narrative Text";
            typeIcon.textContent = "description";
            textEditor.style.display = "flex";
            speechEditor.style.display = "none";
        } else if (this.#activeType === "unformatted") {
            headerLabel.textContent = "Unformatted Text";
            typeIcon.textContent = "notes";
            textEditor.style.display = "flex"; // Reuse text editor layout
            speechEditor.style.display = "none";
        } else {
            headerLabel.textContent = "Character Speech";
            typeIcon.textContent = "record_voice_over";
            textEditor.style.display = "none";
            speechEditor.style.display = "grid";
        }
    }

    #toggleDropdown() {
        const dropdown = this.shadowRoot.querySelector(".character-dropdown");
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
    }

    #getCharacter(id) {
        if (this.#userPersona && this.#userPersona.id === id) {
            return this.#userPersona;
        }
        // Try to find in global list (which includes embedded chars if passed correctly via context)
        return this.#allCharacters.find(c => c.id === id);
    }

    #renderCharacterDropdown() {
        const list = this.shadowRoot.querySelector(".character-list");
        list.innerHTML = "";

        const createItem = (char, isPersona = false) => {
            const item = document.createElement("div");
            item.className = "dropdown-item";
            item.innerHTML = `
                <img src="${char.avatarUrl || 'assets/images/default_avatar.svg'}" class="dd-avatar">
                <span class="dd-name">${char.name}</span>
                ${isPersona ? '<span class="material-icons dd-icon" style="font-size: 14px; margin-left: auto; color: var(--accent-good);">account_circle</span>' : ''}
            `;
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                this.#selectedCharacterId = char.id;
                this.#updateCharacterDisplay();
                this.shadowRoot.querySelector(".character-dropdown").style.display = 'none';
            });
            list.appendChild(item);
        };

        // 1. Render User Persona (if exists)
        if (this.#userPersona) {
            createItem(this.#userPersona, true);
        }

        // 2. Render participants
        this.#participants.forEach(id => {
            // Skip if it's the persona (already rendered)
            if (this.#userPersona && id === this.#userPersona.id) return;

            const char = this.#getCharacter(id);
            if (!char) return; // Skip if missing data
            createItem(char, false);
        });

        // 3. Add Custom option
        const customItem = document.createElement("div");
        customItem.className = "dropdown-item custom-item";
        customItem.innerHTML = `
            <div class="dd-avatar custom-icon"><span class="material-icons">edit</span></div>
            <span class="dd-name">Custom</span>
        `;
        customItem.addEventListener("click", (e) => {
            e.stopPropagation();
            this.#selectedCharacterId = "__custom__";
            this.#updateCharacterDisplay();
            this.shadowRoot.querySelector(".character-dropdown").style.display = 'none';
        });
        list.appendChild(customItem);
    }

    #updateCharacterDisplay() {
        const avatarImg = this.shadowRoot.querySelector(".char-avatar-img");
        const nameLabel = this.shadowRoot.querySelector(".char-name-label");
        const customInput = this.shadowRoot.querySelector("#custom-name");

        if (this.#selectedCharacterId === "__custom__") {
            avatarImg.src = "assets/images/default_avatar.svg"; // Or a specific edit icon
            nameLabel.style.display = "none";
            customInput.style.display = "block";
            customInput.value = this.#customName;
            if (this.#activeType === 'speech' && document.activeElement !== customInput) {
                // Automatically focus custom input if switching to custom
                // But only if we aren't already there (avoids focus loop)
            }
        } else {
            const char = this.#getCharacter(this.#selectedCharacterId);
            if (char) {
                avatarImg.src = char.avatarUrl || "assets/images/default_avatar.svg";
                nameLabel.textContent = char.name;
            } else {
                // Fallback
                avatarImg.src = "assets/images/default_avatar.svg";
                nameLabel.textContent = "Select Character";
            }
            nameLabel.style.display = "block";
            customInput.style.display = "none";
        }
    }

    toXML() {
        const escapeXML = (str) => str.replace(/[<>&'"]/g, c => {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case "'": return '&apos;';
                case '"': return '&quot;';
                default: return c;
            }
        });

        if (this.#activeType === "text" || this.#activeType === "unformatted") {
            const content = this.shadowRoot.querySelector(".text-input").value.trim();
            if (!content) return "";
            return `<${this.#activeType}>\n${content}\n</${this.#activeType}>`;
        } else {
            const content = this.shadowRoot.querySelector(".speech-input").value.trim();
            if (!content) return "";
            
            let idAttr = "";
            let nameAttr = "";

            if (this.#selectedCharacterId === "__custom__") {
                const customName = this.shadowRoot.querySelector("#custom-name").value.trim() || "Unknown";
                nameAttr = ` name="${escapeXML(customName)}"`;
            } else if (this.#selectedCharacterId) {
                idAttr = ` id="${escapeXML(this.#selectedCharacterId)}"`;
            } else {
                // No selection made? Default to Unknown custom
                nameAttr = ` name="Unknown"`;
            }

            return `<speech${idAttr}${nameAttr}>\n${content}\n</speech>`;
        }
    }

    render() {
        super._initShadow(`
            <div class="block-container">
                <div class="block-header">
                    <div class="type-cycler" title="Click to switch block type">
                        <span class="material-icons type-icon">description</span>
                        <span class="type-label">Narrative Text</span>
                    </div>
                    <div class="actions">
                        <!-- Standard Actions -->
                        <button class="icon-btn btn-up" title="Move Up"><span class="material-icons">arrow_upward</span></button>
                        <button class="icon-btn btn-down" title="Move Down"><span class="material-icons">arrow_downward</span></button>
                        <button class="icon-btn btn-del" title="Remove Block"><span class="material-icons">delete</span></button>
                        
                        <!-- Placeholder Actions -->
                        <button class="icon-btn btn-add" title="Add Block"><span class="material-icons">add</span></button>
                    </div>
                </div>
                <div class="block-body">
                    <div class="text-editor">
                        <textarea class="text-input" placeholder="Describe events, actions, or the environment..."></textarea>
                    </div>
                    <div class="speech-editor">
                        <div class="avatar-column">
                            <div class="avatar-wrapper" title="Change Character">
                                <img src="assets/images/default_avatar.svg" class="char-avatar-img">
                                <div class="avatar-overlay"><span class="material-icons">expand_more</span></div>
                            </div>
                            <div class="character-dropdown">
                                <div class="character-list"></div>
                            </div>
                        </div>
                        <div class="content-column">
                            <div class="name-row">
                                <span class="char-name-label">Character Name</span>
                                <input type="text" id="custom-name" class="custom-name-input" placeholder="Enter Name">
                            </div>
                            <textarea class="speech-input" placeholder="Dialogue..."></textarea>
                        </div>
                    </div>
                </div>
            </div>
        `, `
            :host {
                display: block;
                margin-bottom: var(--spacing-sm);
            }
            .block-container {
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                overflow: visible; /* Allow dropdown to overflow */
                transition: border-color 0.2s;
                position: relative;
            }
            .block-container:focus-within {
                border-color: var(--accent-primary);
            }
            
            /* Header */
            .block-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                background-color: var(--bg-2);
                padding: 4px 8px;
                border-bottom: 1px solid var(--bg-3);
                user-select: none;
                border-top-left-radius: var(--radius-sm);
                border-top-right-radius: var(--radius-sm);
            }
            .type-cycler {
                display: flex;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                color: var(--text-secondary);
                font-size: 16px;
                font-weight: 600;
                padding: 2px 6px;
                border-radius: var(--radius-sm);
            }
            .type-cycler:hover {
                background-color: var(--bg-3);
                color: var(--text-primary);
            }
            .type-icon { font-size: 16px; }
            
            .actions { display: flex; gap: 2px; }
            .icon-btn {
                background: none; border: none; color: var(--text-secondary);
                cursor: pointer; padding: 2px; border-radius: var(--radius-sm);
                display: flex; align-items: center; justify-content: center;
            }
            .icon-btn:hover { background-color: var(--bg-3); color: var(--text-primary); }
            .btn-del:hover { color: var(--accent-danger); }
            .material-icons { font-size: 16px; }

            /* Body */
            .block-body { padding: 0; }
            
            /* Text Editor */
            textarea {
                width: 100%;
                min-height: 80px;
                background: transparent;
                border: none;
                padding: 8px;
                color: var(--text-primary);
                font-family: inherit;
                font-size: 0.9rem;
                resize: vertical;
                display: block;
                box-sizing: border-box;
            }
            textarea:focus { outline: none; }
            .text-editor textarea {
                border-bottom-left-radius: var(--radius-sm);
                border-bottom-right-radius: var(--radius-sm);
            }

            /* Speech Editor Layout */
            .speech-editor {
                display: grid;
                grid-template-columns: 40px 1fr;
                gap: var(--spacing-sm);
                padding: var(--spacing-sm);
                padding-left: var(--spacing-sm);
                border-left: 2px solid var(--accent-primary);
            }
            
            .avatar-column {
                position: relative;
                width: 40px;
            }
            
            .avatar-wrapper {
                width: 40px; height: 40px;
                position: relative;
                cursor: pointer;
                border-radius: var(--radius-md);
                overflow: hidden;
                background-color: var(--bg-3);
            }
            .char-avatar-img {
                width: 100%; height: 100%; object-fit: cover;
            }
            .avatar-overlay {
                position: absolute; inset: 0;
                background: rgba(0,0,0,0.3);
                display: flex; align-items: center; justify-content: center;
                opacity: 0; transition: opacity 0.2s;
            }
            .avatar-wrapper:hover .avatar-overlay { opacity: 1; }
            .avatar-overlay .material-icons { color: white; font-size: 18px; }

            .content-column {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .name-row {
                min-height: 20px;
                display: flex; align-items: center;
            }
            .char-name-label {
                font-weight: 600; 
                color: var(--text-primary); 
                font-size: 0.8rem;
                white-space: nowrap; 
                overflow: hidden; 
                text-overflow: ellipsis;
            }
            .custom-name-input {
                background: var(--bg-2);
                border: 1px solid var(--bg-3);
                color: var(--text-primary);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.8rem;
                width: 100%;
                display: none;
            }
            
            .speech-input {
                background: transparent;
                padding: 0;
                min-height: 60px;
                font-size: 0.9rem;
                line-height: 1.4;
            }

            /* Dropdown */
            .character-dropdown {
                display: none;
                position: absolute;
                top: 45px; left: 0;
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                z-index: 100;
                width: 180px;
                max-height: 200px;
                overflow-y: auto;
            }
            .dropdown-item {
                display: flex; align-items: center; gap: 8px;
                padding: 6px 8px;
                cursor: pointer;
                transition: background-color 0.15s;
                border-bottom: 1px solid var(--bg-3);
            }
            .dropdown-item:last-child { border-bottom: none; }
            .dropdown-item:hover { background-color: var(--bg-2); }
            
            .dd-avatar {
                width: 24px; height: 24px; border-radius: 50%; object-fit: cover; background-color: var(--bg-3);
            }
            .custom-icon {
                display: flex; align-items: center; justify-content: center;
                background-color: var(--bg-3); color: var(--text-secondary);
            }
            .custom-icon .material-icons { font-size: 14px; }
            .dd-name {
                font-size: 0.8rem; color: var(--text-primary);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }

            /* Placeholder Styling */
            :host(.placeholder) .block-body { display: none; }
            :host(.placeholder) .block-container { 
                background: transparent; 
                border: 1px dashed var(--bg-3); 
                opacity: 0.7;
            }
            :host(.placeholder) .block-header { 
                background: transparent; 
                border: none; 
                justify-content: center;
                padding: 2px;
                border-radius: var(--radius-sm);
            }
            :host(.placeholder) .type-cycler { display: none; }
            :host(.placeholder) .btn-up, 
            :host(.placeholder) .btn-down, 
            :host(.placeholder) .btn-del { display: none; }
            :host(.placeholder) .btn-add { 
                width: 100%; 
                height: 24px;
                background-color: var(--bg-2);
            }
            :host(.placeholder) .btn-add:hover { background-color: var(--bg-3); }
            :host(:not(.placeholder)) .btn-add { display: none; }
        `);
    }
}

customElements.define("adventure-block-editor", AdventureBlockEditor);