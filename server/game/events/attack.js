import z from "zod";

export class GameEventAttack extends GameEvent {
    static type = 'attack';
    
    constructor({ 
        ctx,
        params = {
            attacker: null, // actor instance id
            target: null,   // actor instance id
            // damage is derived from attacker's state
        }
    }) {
        super({ ctx, params });
    }

    async execute() {
        // implement attack logic here
    }

    async undo() {
        // implement undo logic here
    }
}