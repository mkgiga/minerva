// client/components/views/GenerationConfigView.js
import { BaseComponent } from "../BaseComponent.js";
import { api, modal, notifier } from "../../client.js";
import "../ItemList.js";
import "../TextBox.js";
import "../SchemaForm.js";

class GenerationConfigView extends BaseComponent {
    #generationConfigs = [];
    #selectedGenConfig = null;
    #activeConnection = null;
    #adapterParamSchemas = {};
    #activeGenConfigId = null;
    #needsSave = false;

    #genConfigList = null;

    constructor() {
        super();
        this.handleResourceChange = this.#handleResourceChange.bind(this);
    }

    async connectedCallback() {
        this.render();
        this.#genConfigList = this.shadowRoot.querySelector("#gen-config-list");

        this.#attachEventListeners();
        window.addEventListener(
            "minerva-resource-changed",
            this.handleResourceChange
        );
        await this.#fetchData();
        this.#setNeedsSave(false);
    }

    disconnectedCallback() {
        window.removeEventListener(
            "minerva-resource-changed",
            this.handleResourceChange
        );
    }

    // Data Fetching
    async #fetchData() {
        try {
            const [genConfigs, settings, connections, paramSchemas] =
                await Promise.all([
                    api.get("/api/generation-configs"),
                    api.get("/api/settings"),
                    api.get("/api/connection-configs"),
                    api.get("/api/adapters/generation-schemas"),
                ]);
            this.#generationConfigs = genConfigs;
            this.#adapterParamSchemas = paramSchemas;
            this.#activeGenConfigId = settings.activeGenerationConfigId;
            if (settings.activeConnectionConfigId) {
                this.#activeConnection = connections.find(
                    (c) => c.id === settings.activeConnectionConfigId
                );
            }
            this.#updateView();
        } catch (error) {
            console.error(
                "Failed to fetch data for Generation Config view:",
                error
            );
            notifier.show({
                header: "Error",
                message: "Could not load generation config data.",
                type: "bad",
            });
        }
    }

    // Event Listeners
    #attachEventListeners() {
        // Left Panel (Generation Configs)
        this.#genConfigList.addEventListener("item-action", (e) =>
            this.#handleGenConfigItemAction(e.detail)
        );
        this.shadowRoot
            .querySelector("#gen-config-list-header")
            .addEventListener("click", (e) => {
                if (e.target.closest('[data-action="add"]'))
                    this.#handleGenConfigAdd();
            });

        // Main Panel (Editor)
        this.shadowRoot
            .querySelector("#save-gen-config-btn")
            .addEventListener("click", () => this.#saveGenConfig());
        this.shadowRoot
            .querySelector("#back-to-configs-btn")
            .addEventListener("click", () => this.#handleBackToConfigs());

        // Listen for changes on form inputs
        this.shadowRoot
            .querySelector("#gen-config-name")
            .addEventListener("input", () => this.#setNeedsSave(true));
        this.shadowRoot
            .querySelector("#system-prompt-input")
            .addEventListener("change", () => this.#setNeedsSave(true));
        this.shadowRoot
            .querySelector("schema-form")
            .addEventListener("change", () => this.#setNeedsSave(true));
    }

    #handleResourceChange(event) {
        const detail = event.detail;
        let needsFullUpdate = false;

        if (detail.resourceType === "generation_config") {
            switch (detail.eventType) {
                case "create":
                    this.#generationConfigs.push(detail.data);
                    needsFullUpdate = true;
                    break;
                case "update": {
                    const index = this.#generationConfigs.findIndex(
                        (c) => c.id === detail.data.id
                    );
                    if (index > -1) {
                        this.#generationConfigs[index] = detail.data;
                        if (this.#selectedGenConfig?.id === detail.data.id) {
                            this.#selectedGenConfig = JSON.parse(
                                JSON.stringify(detail.data)
                            );
                            this.#setNeedsSave(false); // Overwrite local changes with server state
                        }
                        needsFullUpdate = true;
                    }
                    break;
                }
                case "delete": {
                    const initialLength = this.#generationConfigs.length;
                    this.#generationConfigs = this.#generationConfigs.filter(
                        (c) => c.id !== detail.data.id
                    );
                    if (this.#generationConfigs.length < initialLength) {
                        if (this.#selectedGenConfig?.id === detail.data.id) {
                            this.#selectedGenConfig = null;
                            this.#setNeedsSave(false);
                        }
                        needsFullUpdate = true;
                    }
                    break;
                }
            }
        } else if (detail.resourceType === "setting") {
            if (
                detail.data.activeGenerationConfigId !== this.#activeGenConfigId
            ) {
                this.#activeGenConfigId = detail.data.activeGenerationConfigId;
                this.#updateGenConfigList();
            }
            if (
                detail.data.activeConnectionConfigId !==
                this.#activeConnection?.id
            ) {
                this.#fetchData();
                return;
            }
        }

        if (needsFullUpdate) {
            this.#updateView();
        }
    }

    // State & Update Logic

    #setNeedsSave(needsSave) {
        this.#needsSave = needsSave;
        const saveIndicator = this.shadowRoot.querySelector(".save-indicator");
        const actualSaveButton = this.shadowRoot.querySelector(
            "#save-gen-config-btn"
        );
        if (saveIndicator) {
            saveIndicator.style.opacity = needsSave ? "1" : "0";
        }
        if (actualSaveButton) {
            actualSaveButton.disabled = !needsSave;
        }
    }

    #updateView() {
        const isMobile = window.matchMedia("(max-width: 768px)").matches;
        const panelLeft = this.shadowRoot.querySelector(".panel-left");
        const panelMain = this.shadowRoot.querySelector(".panel-main");
        const backButton = this.shadowRoot.querySelector(
            "#back-to-configs-btn"
        );

        if (isMobile) {
            if (this.#selectedGenConfig) {
                panelLeft.style.display = "none";
                panelMain.style.display = "flex";
                if (backButton) backButton.style.display = "flex";
            } else {
                panelLeft.style.display = "flex";
                panelMain.style.display = "none";
                if (backButton) backButton.style.display = "none";
            }
        } else {
            // Desktop behavior
            panelLeft.style.display = "flex";
            panelMain.style.display = "flex";
            if (backButton) backButton.style.display = "none";
        }

        this.#updateGenConfigList();
        this.#updateMainPanel();
    }

    #updateGenConfigList() {
        if (!this.#genConfigList) return;

        const itemsHtml = this.#generationConfigs
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((config) => {
                const isSelected = this.#selectedGenConfig?.id === config.id;
                const isActive = this.#activeGenConfigId === config.id;
                const activateTitle = isActive
                    ? "Currently active"
                    : "Set as active config";

                return `
                    <li data-id="${config.id}" class="${
                    isSelected ? "selected" : ""
                }">
                        <div class="item-name">${config.name}</div>
                        <div class="actions">
                            <button class="icon-button activate-btn ${
                                isActive ? "active" : ""
                            }" data-action="activate" title="${activateTitle}">
                                <span class="material-icons">${
                                    isActive
                                        ? "radio_button_checked"
                                        : "radio_button_off"
                                }</span>
                            </button>
                            <button class="icon-button delete-btn" data-action="delete" title="Delete">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    </li>
                `;
            })
            .join("");

        this.#genConfigList.innerHTML = itemsHtml;
    }

    #updateMainPanel() {
        const mainPanel = this.shadowRoot.querySelector(".panel-main");
        const editor = mainPanel.querySelector(".editor-content");
        const placeholder = mainPanel.querySelector(".placeholder");

        if (this.#selectedGenConfig) {
            placeholder.style.display = "none";
            editor.style.display = "flex";
            editor.querySelector("#gen-config-name").value =
                this.#selectedGenConfig.name;
            editor.querySelector("#system-prompt-input").value =
                this.#selectedGenConfig.systemPrompt || "";
            this.shadowRoot.querySelector("#active-adapter-name").textContent =
                this.#activeConnection?.adapter || "None";
            this.#renderParameterFields();
        } else {
            placeholder.style.display = "flex";
            editor.style.display = "none";
        }
    }

    #renderParameterFields() {
        const schemaForm = this.shadowRoot.querySelector("schema-form");
        const container = this.shadowRoot.querySelector(
            "#param-fields-container"
        );

        if (!this.#activeConnection) {
            container.innerHTML = `<p class="notice">No active connection. Please set one in Connection Settings.</p>`;
            schemaForm.style.display = "none";
            return;
        }

        const adapterId = this.#activeConnection.adapter;
        const schema = this.#adapterParamSchemas[adapterId];

        if (!schema || schema.length === 0) {
            container.innerHTML = `<p class="notice">Adapter "${adapterId}" has no configurable parameters.</p>`;
            schemaForm.style.display = "none";
            return;
        }

        container.innerHTML = ""; // Clear any notices
        schemaForm.style.display = "block";

        // 1. Create a default object from the schema's defaultValues
        const defaultParams = {};
        for (const field of schema) {
            if (field.defaultValue !== undefined) {
                defaultParams[field.name] = field.defaultValue;
            }
        }

        // 2. Merge saved parameters over the defaults
        // This ensures all schema fields have a value, either default or saved.
        const savedParamsForAdapter =
            this.#selectedGenConfig.parameters[adapterId] || {};
        const finalParams = { ...defaultParams, ...savedParamsForAdapter };

        schemaForm.data = finalParams;
        schemaForm.schema = schema;
    }

    // Event Handlers (renamed to private)

    #handleGenConfigItemAction({ id, action }) {
        const config = this.#generationConfigs.find((c) => c.id === id);
        if (!config) return;

        switch (action) {
            case "select":
                if (this.#selectedGenConfig?.id !== config.id) {
                    // Deep copy to prevent mutations from affecting the main list until saved
                    this.#selectedGenConfig = JSON.parse(
                        JSON.stringify(config)
                    );
                    this.#setNeedsSave(false);
                    this.#updateView();
                }
                break;
            case "delete":
                this.#handleGenConfigDelete(config);
                break;
            case "activate":
                this.#handleGenConfigActivate(config);
                break;
        }
    }

    async #handleGenConfigAdd() {
        try {
            const newConfig = await api.post("/api/generation-configs", {
                name: "New Config",
                systemPrompt: "",
            });
            this.#generationConfigs.push(newConfig);
            this.#selectedGenConfig = newConfig;
            this.#setNeedsSave(false);
            this.#updateView();
        } catch (e) {
            notifier.show({
                header: "Error",
                message: "Could not create generation config.",
                type: "bad",
            });
        }
    }

    #handleGenConfigDelete(item) {
        modal.confirm({
            title: "Delete Generation Config",
            content: `Are you sure you want to delete "${item.name}"?`,
            confirmButtonClass: "button-danger",
            onConfirm: async () => {
                try {
                    await api.delete(`/api/generation-configs/${item.id}`);
                    this.#generationConfigs = this.#generationConfigs.filter(
                        (c) => c.id !== item.id
                    );
                    if (this.#selectedGenConfig?.id === item.id) {
                        this.#selectedGenConfig = null;
                        this.#setNeedsSave(false);
                    }
                    if (this.#activeGenConfigId === item.id) {
                        this.#activeGenConfigId = null;
                    }
                    this.#updateView();
                    notifier.show({ message: `Deleted "${item.name}".` });
                } catch (e) {
                    notifier.show({
                        header: "Error",
                        message: "Could not delete config.",
                        type: "bad",
                    });
                }
            },
        });
    }

    async #handleGenConfigActivate(item) {
        const newActiveId =
            this.#activeGenConfigId === item.id ? "null" : item.id;
        try {
            const settings = await api.post(
                `/api/generation-configs/${newActiveId}/activate`,
                {}
            );
            this.#activeGenConfigId = settings.activeGenerationConfigId;
            this.#updateGenConfigList();
            const message =
                newActiveId !== "null"
                    ? `"${item.name}" is now the active config.`
                    : "Active config cleared.";
            notifier.show({
                type: "good",
                header: "Config Activated",
                message,
            });
        } catch (error) {
            notifier.show({
                header: "Error",
                message: "Could not activate config.",
                type: "bad",
            });
        }
    }

    async #saveGenConfig() {
        if (!this.#selectedGenConfig || !this.#needsSave) return;

        const schemaForm = this.shadowRoot.querySelector("schema-form");
        const paramData = schemaForm.serialize();

        const adapterId = this.#activeConnection?.adapter;
        let parameters = this.#selectedGenConfig.parameters;
        if (adapterId) {
            parameters = { ...parameters, [adapterId]: paramData };
        }

        const updatedConfig = {
            ...this.#selectedGenConfig,
            name: this.shadowRoot.querySelector("#gen-config-name").value,
            systemPrompt: this.shadowRoot.querySelector("#system-prompt-input").value,
            parameters,
        };

        try {
            const saved = await api.put(
                `/api/generation-configs/${updatedConfig.id}`,
                updatedConfig
            );
            const index = this.#generationConfigs.findIndex(
                (c) => c.id === saved.id
            );
            if (index !== -1) {
                this.#generationConfigs[index] = saved;
            } else {
                this.#generationConfigs.push(saved);
            }
            // Update selectedGenConfig with the fresh data from the server
            this.#selectedGenConfig = JSON.parse(JSON.stringify(saved));

            this.#updateGenConfigList();
            notifier.show({
                header: "Saved",
                message: `"${saved.name}" has been updated.`,
                type: "good",
            });
            this.#setNeedsSave(false);
        } catch (e) {
            notifier.show({
                header: "Save Error",
                message: "Could not save generation config.",
                type: "bad",
            });
        }
    }

    #handleBackToConfigs() {
        this.#selectedGenConfig = null;
        this.#setNeedsSave(false);
        this.#updateView();
    }

    render() {
        super._initShadow(
            `
            <div style="display: contents;">
                <div class="panel-main">
                    <div class="placeholder"><h2>Select or create a generation config.</h2></div>
                    <div class="editor-content">
                        <header>
                            <button id="back-to-configs-btn" class="icon-btn" title="Back to list"><span class="material-icons">arrow_back</span></button>
                            <input type="text" id="gen-config-name" class="editor-title-input" placeholder="Generation Config Name">
                            <div class="header-controls">
                               <span class="save-indicator">Unsaved changes</span>
                               <button id="save-gen-config-btn" class="button-primary" disabled>Save</button>
                            </div>
                        </header>
                        <div class="editor-body">
                            <section>
                                <h3>System Prompt</h3>
                                <p class="section-desc">This prompt will be used as the system instruction. Supports macros like {{characters}}, {{notes}}, {{player}}, etc.</p>
                                <text-box id="system-prompt-input" placeholder="Enter your system prompt here..."></text-box>
                            </section>
                            <section>
                                <h3>Parameters</h3>
                                <p class="section-desc">Settings for the currently active connection type (<span id="active-adapter-name">None</span>).</p>
                                <div id="param-fields-container"></div>
                                <schema-form></schema-form>
                            </section>
                        </div>
                    </div>
                </div>
                <div class="panel-left">
                    <header id="gen-config-list-header">
                        <h3>Generation Settings</h3>
                        <div class="header-actions">
                            <button class="icon-button" data-action="add" title="Add New Config">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                    </header>
                    <item-list id="gen-config-list"></item-list>
                </div>
            </div>
        `,
            this.styles()
        );
    }

    styles() {
        return `
            .panel-left { flex-direction: column; border-right: none; border-left: 1px solid var(--bg-3); }
            .panel-left header {
                display: flex; justify-content: space-between; align-items: center;
                padding: var(--spacing-md); border-bottom: 1px solid var(--bg-3);
                flex-shrink: 0; gap: var(--spacing-sm);
            }
            .panel-left header h3 { margin: 0; }
            .header-actions .icon-button {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                transition: var(--transition-fast); display: flex; align-items: center;
                justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm);
            }
            .header-actions .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }

            item-list li {
                display: flex; align-items: center; padding: var(--spacing-sm) var(--spacing-md);
                cursor: pointer; border-bottom: 1px solid var(--bg-3); transition: var(--transition-fast); gap: var(--spacing-sm);
            }
            item-list li:hover { background-color: var(--bg-2); }
            item-list li.selected { background-color: var(--accent-primary); color: var(--bg-0); }
            item-list li.selected .item-name { font-weight: 600; }
            item-list .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-grow: 1; }
            item-list .actions { display: flex; flex-shrink: 0; gap: var(--spacing-xs); }
            item-list .icon-button {
                background: none; border: none; color: var(--text-secondary); cursor: pointer;
                transition: var(--transition-fast); display: flex; align-items: center;
                justify-content: center; padding: var(--spacing-xs); border-radius: var(--radius-sm);
            }
            item-list li:not(.selected) .icon-button:hover { color: var(--text-primary); background-color: var(--bg-2); }
            item-list li.selected .icon-button:hover { color: var(--bg-1); }
            item-list .delete-btn:hover { color: var(--accent-danger); }
            item-list .activate-btn.active { color: var(--accent-primary); }
            item-list li.selected .activate-btn.active { color: var(--bg-0); }

            .panel-main { display: flex; flex-direction: column; padding: 0; }
            .panel-main .placeholder { flex-grow: 1; display: flex; align-items: center; justify-content: center; }
            .editor-content { display: none; flex-direction: column; height: 100%; overflow: hidden; }
            .editor-content header {
                display: flex; align-items: center; gap: var(--spacing-md); padding: var(--spacing-md) var(--spacing-lg);
                border-bottom: 1px solid var(--bg-3); flex-shrink: 0;
            }
            #back-to-configs-btn {
                background: none; border: none; color: var(--text-secondary);
                cursor: pointer; padding: var(--spacing-xs); display: none;
            }
            #back-to-configs-btn:hover { color: var(--text-primary); }
            #back-to-configs-btn .material-icons { font-size: 1.5rem; }

            .editor-title-input { font-size: 1.25rem; font-weight: 600; background: none; border: none; outline: none; flex-grow: 1; color: var(--text-primary); }
            .header-controls { display: flex; align-items: center; gap: var(--spacing-md); }
            .save-indicator { font-size: var(--font-size-sm); color: var(--accent-warn); opacity: 0; transition: opacity 0.3s; }
            #save-gen-config-btn:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; opacity: 1; }

            .editor-body { display: flex; flex-direction: column; gap: var(--spacing-lg); flex-grow: 1; overflow-y: auto; padding: var(--spacing-lg); }
            section { margin-bottom: var(--spacing-lg); }
            section:last-of-type { margin-bottom: 0; }
            
            section h3 { margin-bottom: var(--spacing-xs); }
            .section-desc { font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: var(--spacing-md); }
            .notice { color: var(--text-disabled); font-style: italic; background-color: var(--bg-0); padding: var(--spacing-sm); }
            #param-fields-container { margin-bottom: var(--spacing-md); }
            
            #system-prompt-input { 
                min-height: 200px; max-height: 400px; width: 100%; resize: vertical; 
                padding: 0.75rem;
                background-color: var(--bg-1); 
                border: 1px solid var(--bg-3); 
                border-radius: var(--radius-md); 
                font-family: var(--font-family);
            }
            #system-prompt-input:focus-within { 
                border-color: var(--accent-primary); 
                box-shadow: none; 
            }

            @media (max-width: 768px) {
                .editor-body { padding: var(--spacing-md); }
                .editor-content header { padding: var(--spacing-sm) var(--spacing-md); gap: var(--spacing-sm); }
            }
        `;
    }
}
customElements.define("generation-config-view", GenerationConfigView);