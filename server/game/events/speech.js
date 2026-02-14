import { GameEvent } from "./base.js";

export class GameEventSpeech extends GameEvent {
    static type = 'speech';
    static get describe() {
        return `
speech({ id, expr, text })
    - id: string | string[]
        The actor instance ID or array of IDs of the speaker(s).
    - expr: string?
        Optional expression to set on the speaker.
    - text: string
        The spoken dialogue text.
        `.trim();
    }
    constructor({ 
        ctx,
        params = {
            target: '', // actor instance id or array of ids
            text: '',   // speech text
            expr: undefined, // optional expression to set on speaker
        }
    }) {
        super({ ctx, params });
    }

    async execute() {
        // no state mutation, just emit to frontend
    }

    async undo() {
        // Speech events set the current focused speaker
        // so that expr events modify the correct actor's expression using the game state's story.focusedActors
    }
}