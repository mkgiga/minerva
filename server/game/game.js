// TODO: THIS IS NOT IMPLEMENTED OR USED YET, STILL IN THE DESIGN PHASE!!

import { ActorInstance } from "./actor.js";
import { SceneInstance, SceneDefinition, SceneLayer } from "./scene.js";
import { GameEventNarrate } from "./events/narrate.js";
import { GameEventPause } from "./events/pause.js";
import { GameEventSpeech } from "./events/speech.js";
import { GameEventAttack } from "./events/attack.js";

/**
 * Represents a stateful game world where events are deterministically processed to mutate the game state.
 * Each game instance is based on a scenario definition and contains instantiated game objects such as actors and items.
 * The user prompt is utilized as the primary driver for informing the LLM of the current game state,
 * although the user prompt will also contain any actions taken by the player, meaning the user and the LLM
 * can both influence the game state (though the player gets a simplified workflow via simple text prompts for now,
 * later we can play around with adding UI elements for the player to trigger specific actions like examining objects,
 * addressing specific NPCs when they are in the vicinity, etc).
 */
export class Game {

    state = {
        /**
         * Game object definitions.
         * Used as blueprints to instantiate game objects and to look up static metadata such as names, descriptions, etc.
         * Loaded from a scenario definition.
         */
        definitions: {
            actors: {}, // character sheets
            notes: {}, // extra user-specified behavioral instructions for the LLM
            scenes: {}, // scene definitions for different locations
            items: {}, // item definitions for static metadata like name, contextual event listener hooks like (onUse(target), onExamine(), etc.) Items are defined in scenario definitions and the event code is base64-encoded so they don't escape json strings.
        },

        /**
         * The scenario definition this game is based on.
         */
        scenario: null,

        /**
         * The instantiated game objects.
         */
        instances: {
            actors: {},
            items: {},
        },

        /**
         * Progresses on every turn based on how much time the LLM thinks the action took.
         * Is relative to the scenario's starting time. Gets Serialized into a full date time format when generating the user prompt.
         */
        time: {
            year: 0,
            month: 0,
            day: 0,
            hour: 0,
            minute: 0,
            second: 0,
            millisecond: 0,
        },

        /**
         * The current scene state.
         */
        scene: null,

        /**
         * The actor instance that is currently being focused.
         * The prompt is generated based on how this actor perceives the world.
         */
        targetActor: null,
    }

    /**
     * Internal engine state management object.
     */
    #internal = {
        cursor: {
            i: 0,
        },
        
        /**
         * Preprocessed GameEvent instances (from JSON game events `{ type: '...', params: { ... } }`)
         * The cursor points to the next event to be processed.
         * 
         * Call #executeEvent() to execute the next event, calling its execute() method.
         * Call #undoEvent() to undo the last executed event, calling its undo() method.
         * 
         * GameEvents cache immutable snapshots of their params at the time of creation,
         * so that undo/redo operations can be performed reliably.
         * 
         */
        log: [],
    }

    /**
     * Create a game instance.
     * @param {Partial<typeof this.state>} args
     * @param {Object} options
     */
    constructor(args = {
        state: {},
        options: {},
    }) {
        Object.assign(this.state, args.state);
    }

    /**
     * Process a series of events which may or may not mutate the game state.
     */
    process(events = []) {

    }

    init(actorDefinitions = {}, noteDefinitions = {}, messages = []) {
        // clear existing state
        // instantiate actors
        // instantiate notes
        const contentMessages = [];
        for (const msg of messages) {
            const role = msg.role;
            const content = msg.content;
            contentMessages.push({ role, content });
        }
    }

    /**
     * Preprocess a json event into a GameEvent instance.
     */
    static jsonToGameEvent({
        type = 'pause',
        params = {
            time: 1000
        }
    }) {
        return new Game.GameEventsMap[type]({ ctx: this, params });
    }

    /**
     * Initialize the internal event log with GameEvent instances.
     */
    #initEventLog(events = []) {
        const internalEventLog = this.#internal.log;
        
        internalEventLog = [];

        for (let y = 0; y < events.length; y++) {
            const ev = events[y];
            const type = ev.type;
            const params = ev.params || {};
            const gameEvent = new Game.GameEventsMap[type]({ ctx: this, params });
            internalEventLog.push(gameEvent);
        }

        this.#internal.log = internalEventLog;
    }

    /**
     * Process all unprocessed events in the internal log.
     */
    async #processEvents(start = 0, end = undefined) {
        if (end === undefined) {
            end = this.#internal.log.length;
        }
        for (let i = start; i < end; i++) {

        }
    }

    #undoEvent() {
        if (this.#internal.cursor.i <= 0) {
            return; // nothing to undo
        }

        const eventToUndo = this.#internal.log[this.#internal.cursor.i - 1];
    }

    /** Lookup table for game event types and their corresponding classes */
    static GameEventsMap = {
        pause: GameEventPause,
        narrate: GameEventNarrate,
        speech: GameEventSpeech,
        attack: GameEventAttack,
        // ... other event types ... /
    }
}
