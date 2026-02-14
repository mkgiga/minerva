import { GameEvent } from "./base.js";

export class GameEventNarrate extends GameEvent {
    static type = 'narrate';
    static get describe() {
        return `
### 'narrate'
  - text: string
    The text content to display in the text box.
  - icon: string?
    Optional icon to render alongside the narration.
        `.trim();
    }
    
    constructor({ ctx, params = {} }) {
        super({ ctx, params });
    }

    async execute() {
        // no state mutation, just emit to frontend
    }

    async undo() {
        // Narration events may not be undoable in a traditional sense.
        // We would just have to emit narrate:undo to the frontend to handle it visually.
    }
}