// client/ChatModeRegistry.js
class ChatModeRegistry {
    #modes = new Map();

    register(renderer, tagName) {
        if (this.#modes.has(renderer)) {
            console.warn(`Chat mode for renderer '${renderer}' is being overwritten. Old: ${this.#modes.get(renderer).tagName}, New: ${tagName}`);
        }
        // Store both tag name and renderer key for easier iteration
        this.#modes.set(renderer, { renderer, tagName });
        console.log(`Registered chat mode: ${renderer} -> <${tagName}>`);
    }

    getTagName(renderer) {
        const modeInfo = this.#modes.get(renderer);
        if (!modeInfo) {
            console.warn(`No chat mode registered for renderer '${renderer}'. Falling back to default.`);
            // 'raw' is considered the default.
            return this.#modes.get('raw')?.tagName || 'default-chat-mode'; // Hardcoded fallback just in case.
        }
        return modeInfo.tagName;
    }

    /**
     * Returns an array of all registered mode information.
     * @returns {Array<{renderer: string, tagName: string}>}
     */
    getRegisteredModes() {
        return Array.from(this.#modes.values());
    }
}

export const chatModeRegistry = new ChatModeRegistry();