
/**
 * @abstract
 * Game Event base class
 * Implementation of this class must provide execute() and undo() methods
 * They **must** both be deterministic and rely solely on their initial parameters
 */
export class GameEvent {
    static type = 'meta.example';

    /**
     * The input data as it was provided at the time of execution.
     * Undo/Redo relies on this data being immutable or it will get corrupted.
     * @immutable
     */
    params = {};

    /**
     * The game context for this event - provides access to game state.
     * @type {import('../game.js').Game}
     */
    ctx = null;

    /**
     * Create a new Game Event
     * @param {Object} options
     * @param {import('../game.js').Game} options.ctx - The game context for this event - provides access to game state.
     * @param {Object} options.params - The parameters for this event
     * @param {Object} options.metadata - Metadata for this event (not stored in params)
     * @param {string} [options.metadata.role] - The role of the original chat completion object that generated this event in case we need to reference it later (e.g. 'user' or 'assistant')
     */
    constructor({
        ctx,
        params = {},
        metadata = {
            role: undefined
        }
    }) {
        if (new.target === GameEvent) {
            throw new Error(`GameEvent is an abstract class and cannot be instantiated directly.`);
        }

        // --- Enforce abstract class properties ---

        if (Object.hasOwn(new.target, 'type') === false) {
            throw new Error(`GameEvent subclasses must define a static "type" property.`);
        }

        if (Object.hasOwn(new.target, 'describe') === false) {
            throw new Error(`GameEvent subclasses must define a static "describe" method that documents how to invoke the event. It is format-agnostic.`);
        }

        this.ctx = ctx;
        // ensure no references are kept to mutable objects
        const deepClone = structuredClone(params);
        const snapshot = Object.freeze(deepClone);

        this.params = snapshot;
        this.metadata = metadata;
    }

    /**
     * Executes the event using the stored data snapshot.
     * Return value should be a string that describes the outcome of the event for the LLM to consume next time, getting prepended to the next user prompt.
     */
    async execute() {
        throw new Error("execute() not implemented");
    }

    /**
     * Reverts the event using the stored data snapshot.
     */
    async undo() {
        throw new Error("undo() not implemented");
    }

    toJSON() {
        return {
            ...structuredClone(this.params),
            type: this.constructor.type
        };
    }
}
