// todo: implement the VNPlayer component for minerva's VisualNovelChatMode rendering. come up with a json format for commands that can be executed by the player

export default class VNPlayer extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    flex-direction: column;
                }
                * {
                    box-sizing: border-box;
                    min-height: 0;
                    min-width: 0;
                }
                .interface-container-absolute {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    display: flex;
                    flex-direction: column;
                    pointer-events: none;
                }
                :host, .interface-container-absolute {
                    width: 100%;
                    height: 100%;
                    padding: 0;
                    margin: 0;
                    box-sizing: border-box;
                    overflow: hidden;
                }
                .scene-container {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    aspect-ratio: 16 / 9; /* Widescreen */
                    overflow: hidden;
                    background-color: #000000; /* Black bars on the sides */
                }
            </style>
            <div class="scene-container">
                <div class="interface-container-absolute">
                    <slot name="interface"></slot>
                    <slot name="textboxes"></slot>
                </div>
                <div class="layers-container">
                    <slot name="background" class="layer"></slot>
                    <slot name="actors" class="layer"></slot>
                    <slot name="foreground" class="layer"></slot>
                </div>
                <div class="interface-footer">
                    <slot name="footer"></slot>
                </div>
            </div>
        `;
    }

    connectedCallback() {

    }

    /** Add commands to be executed. */
    scheduleCommands(commands) {
        // assume this is a json string to parse
        if (typeof commands === 'string') {
            const deserializedCommands = JSON.parse(commands);
            this.#parseCommands(deserializedCommands);
        }
    }

    /**
     * Get a project resource by type and id. Should be implemented by the parent user of this component.
     * @param {'actor' | 'environment' | 'textbox' | 'image' | 'audio'} type 
     * @param {string} id
     * @abstract 
     */
    getProjectResource(type, id) {
        // Implement resource retrieval logic here.
    }

    #parseCommands(parsedCommands = {
        // this is an object instead of an array in case we need other metadata in the future
        commands: [],
    }) {
        /**
         * @type {Object.<string, (...args: any[]) => { execute: () => void, validate: () => boolean }> }
         */
        const commands = {
            "actor.show": (actorId) => {
                // show character in the scene. if the character is already present, it will be made visible instead
            },
            "actor.hide": (actorId) => {
                // hide character from the scene. they are still present within the player's DOM but not visible
            },
            "actor.remove": (actorId) => {
                // remove character from the scene
            },
            "actor.focus": (actorId) => {
                // set the speaker to the actor with the given id
            },
            "actor.toggleLayers": (actorId, ...layerIds) => {
                // toggles the image layers of the actor with the given id and hides all other layers
            },
            "scene.fadeIn": (duration = 3000) => {
                // implement
            },
            "scene.fadeOut": (duration = 3000) => {
                // implement
            },
            "environment.set": (environmentId) => {
                // implement
            },
            "environment.remove": (environmentId) => {
                // implement
            },
            "textbox.show": (textboxId, text) => {
                // implement
            },
        }
        // Implement command parsing logic here
    }
}

customElements.define('vn-player', VNPlayer);