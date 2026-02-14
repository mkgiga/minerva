import { GameEvent } from "./base.js";

export class GameEventPause extends GameEvent {
    static type = 'pause';
    
    constructor({ 
        ctx, 
        params = {
            duration: 1000, // duration in milliseconds
        }
    }) {
        super({ ctx, params });
    }

    async execute() {
        // do we wait in the backend's game loop or do we just let the frontend pause rendering?
        // if we skip waiting in the backend, we can compute the game state as fast as possible from start to finish(?)
    }

    async undo() {
        // likewise would pausing be undone by waiting again but moving backwards in time?
    }
}