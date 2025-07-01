// client/ChatModeRegistry.js
class ChatModeRegistry {
    #modes = new Map();

    register(renderer, tagName) {
        if (this.#modes.has(renderer)) {
            console.warn(`Chat mode for renderer '${renderer}' is being overwritten. Old: ${this.#modes.get(renderer)}, New: ${tagName}`);
        }
        this.#modes.set(renderer, tagName);
        console.log(`Registered chat mode: ${renderer} -> <${tagName}>`);
    }

    getTagName(renderer) {
        const tagName = this.#modes.get(renderer);
        if (!tagName) {
            console.warn(`No chat mode registered for renderer '${renderer}'. Falling back to default.`);
            // 'raw' is considered the default.
            return this.#modes.get('raw') || 'default-chat-mode'; // Hardcoded fallback just in case.
        }
        return tagName;
    }
}

export const chatModeRegistry = new ChatModeRegistry();