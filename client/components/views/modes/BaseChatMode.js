import { BaseComponent } from '../../BaseComponent.js';

/**
 * A builder class for constructing chat prompts.
 * Contains methods that return the same instance for method chaining.
 */
export class PromptBuilder {
    static new() {
        return new PromptBuilder();
    }

    constructor() {
        this.messages = [];
    }
    
    /**
     * 
     * @param {'user' | 'assistant' | 'system'} role 
     * @param {string} content
     * @param {string} [characterId] - Optional character ID to associate with the message. Mainly used to track which character the user was playing as at the time of sending the message. Becomes the user's persona by default if not specified when sending the prompt.
     */
    addMessage(role, content = '') {
        if (!(role in ['user', 'assistant', 'system'])) {
            throw new TypeError(`Invalid role: ${role}. Must be 'user', 'assistant', or 'system'.`);
        }

        this.messages.push({ role, content });
        
        return this; // chainable
    }
}

/**
 * @abstract
 * Base class for all chat rendering modes.
 * It's not meant to be instantiated directly.
 * Child classes must implement the rendering and interaction logic.
 */
export class BaseChatMode extends BaseComponent {
    #isSending = false;
    #chat = null;
    #messageMap = new Map();

    constructor() {
        super();
        if (this.constructor === BaseChatMode) {
            throw new TypeError('Abstract class "BaseChatMode" cannot be instantiated directly.');
        }

        this.allCharacters = [];
        this.userPersona = null;
        this.mainView = null;
        this.rendererType = 'raw';
        this.settings = {}; // To hold mode-specific settings
    }

    /**
     * Child classes can override this static getter to define a schema for their settings.
     * This schema will be used by UserPreferencesView to generate a settings form.
     * @returns {Array<object>} A schema compatible with the SchemaForm component.
     */
    static getSettingsSchema() {
        return [];
    }

    /**
     * Child classes can override this static getter to define default values for their settings.
     * @returns {object} An object with default setting values.
     */
    static getDefaultSettings() {
        return {};
    }

    /**
     * Called by MainChatView to initialize the mode with the necessary data.
     * @param {object} data - The initialization data.
     * @param {object} data.chat - The full chat object.
     * @param {Array} data.allCharacters - All available characters.
     * @param {object|null} data.userPersona - The current user persona character.
     * @param {HTMLElement} data.mainView - A reference to the MainChatView instance.
     * @param {string} data.rendererType - The type of renderer ('raw', 'markdown', etc.).
     * @param {object} data.settings - Mode-specific settings from global config.
     */
    initialize(data) {
        this.chat = data.chat;
        this.allCharacters = data.allCharacters;
        this.userPersona = data.userPersona;
        this.mainView = data.mainView;
        this.rendererType = data.rendererType;
        // Merge defaults with provided settings
        this.settings = { ...this.constructor.getDefaultSettings(), ...data.settings };
        this.onInitialize();
    }
    
    get isSending() { return this.#isSending; }
    set isSending(value) { this.#isSending = value; }

    get chat() {
        return this.#chat;
    }

    set chat(newChat) {
        this.#chat = newChat;
        this.#buildMessageMap();
    }

    #buildMessageMap() {
        this.#messageMap.clear();
        if (this.#chat?.messages) {
            for (const msg of this.#chat.messages) {
                this.#messageMap.set(msg.id, msg);
            }
        }
    }

    /**
     * @abstract
     * Called when the mode is first loaded.
     * Implement this to create the initial DOM structure for your chat mode.
     */
    onInitialize() {
        throw new Error('Method "onInitialize()" must be implemented.');
    }
    
    /**
     * @abstract
     * Called by MainChatView when a new prompt is submitted by the user.
     * The mode is responsible for adding the user's message to the display
     * and showing a loading/spinner state for the upcoming assistant response.
     * @param {object} userMessage - The user message object created by the controller.
     * @returns {string} The ID of the temporary assistant message element, which will be updated by the stream.
     */
    onPromptStart(userMessage) {
        throw new Error('Method "onPromptStart()" must be implemented.');
    }

    /**
     * @abstract
     * Called by MainChatView when a regeneration/resend is triggered.
     * The mode is responsible for updating its UI to show a loading state for the specified message.
     * @param {string} messageId - The ID of the message to regenerate from.
     */
    onRegenerateStart(messageId) {
        throw new Error('Method "onRegenerateStart()" must be implemented.');
    }

    /**
     * @todo
     * @abstract
     * The {{key}} syntax may be used to interpolate values into the user prompt.
     * This is how you can allow users to customize their prompts with dynamic data specific to your mode.
     * For example, if your mode keeps track of character stats, you could let {{john.health}} return the current hp of a character named John.
     */
    getStringMacro(key) {
        return "";
    }

    /**
     * @abstract
     * Called by MainChatView just before the mode is removed from the DOM.
     * Implement this to perform cleanup, like removing event listeners.
     */
    onDestroy() {
        // Optional implementation in child classes
    }

    // New Lifecycle Hooks for Fine-Grained Updates

    /**
     * Called when the active chat is switched entirely, or when a refresh is forced.
     * The mode should completely re-render its history.
     */
    onChatSwitched() {
        /* No-op by default. Child classes should implement this, typically by calling a full refresh method. */
    }
    
    /**
     * Called when the list of participants in the current chat changes.
     * The `this.chat.participants` property is already updated.
     */
    onParticipantsChanged() {
        /* No-op by default. */
    }

    /**
     * Called when new messages are added to the end of the current chat's history.
     * This is typically a user prompt and an assistant response pair from the backend.
     * @param {Array<object>} addedMessages - An array of the new message objects that were added.
     */
    onMessagesAdded(addedMessages) {
        /* No-op by default. */
    }

    /**
     * Called when a single message's content or properties have been updated (e.g., after an edit).
     * @param {object} updatedMessage - The full message object with updated content/properties.
     */
    onMessageUpdated(updatedMessage) {
        /* No-op by default. */
    }

    /**
     * Called when one or more messages have been deleted from the history.
     * @param {Array<string>} deletedMessageIds - An array of IDs of the deleted messages.
     */
    onMessagesDeleted(deletedMessageIds) {
        /* No-op by default. */
    }

    /**
     * Called when a chat is branched. The mode should clear and re-render for the new branch.
     * The `this.chat` property will have already been updated to the new chat object.
     */
    onChatBranched() {
        /* No-op by default. */
    }

    /**
     * Called when the global list of all available characters changes.
     * The `this.allCharacters` property is already updated.
     */
    onAllCharactersChanged() {
        /* No-op by default. */
    }

    /**
     * Called when the global user persona character is changed.
     * The `this.userPersona` property is already updated.
     */
    onUserPersonaChanged() {
        /* No-op by default. */
    }
    
    /**
     * Called by MainChatView when this mode's specific settings are changed.
     * The `this.settings` property is already updated with the new values.
     * @param {object} newSettings - The new settings object for this mode.
     */
    onSettingsChanged(newSettings) {
        /* No-op by default. Child classes can implement this. */
    }
    
    // Stream Lifecycle Hooks

    /**
     * Called by MainChatView before the streaming response begins.
     * @param {string} messageId - The ID of the message that will be updated.
     */
    onStreamStart(messageId) {
        // Optional implementation in child classes.
    }
    
    /**
     * @abstract
     * Called by MainChatView for each token received from the streaming response.
     * @param {string} token - The new token string.
     * @param {string} messageId - The ID of the message being updated.
     */
    onToken(token, messageId) {
        throw new Error('Method "onToken()" must be implemented.');
    }

    /**
     * @abstract
     * Called by MainChatView when the streaming response is complete.
     * @param {string} messageId - The ID of the message that was updated.
     */
    onStreamFinish(messageId) {
        throw new Error('Method "onStreamFinish()" must be implemented.');
    }
    
    /**
     * Called by MainChatView if the streaming response fails.
     * @param {Error} error - The error object.
     * @param {string} messageId - The ID of the message that failed to update.
     */
    onStreamError(error, messageId) {
        // Optional implementation in child classes.
        console.error(`Stream error for message ${messageId}:`, error);
    }
    
    // End of Stream Hooks

    /**
     * @abstract
     * Called by MainChatView to get the user's input text.
     * @returns {string} The text content from the input area.
     */
    getUserInput() {
        throw new Error('Method "getUserInput()" must be implemented.');
    }

    /**
     * @abstract
     * Called by MainChatView to clear the user's input after sending.
     */
    clearUserInput() {
        throw new Error('Method "clearUserInput()" must be implemented.');
    }
    
    /**
     * @abstract
     * Called to enable or disable the user input elements.
     * @param {boolean} isSending - Whether a message is currently being sent.
     */
    updateInputState(isSending) {
        throw new Error('Method "updateInputState()" must be implemented.');
    }

    // API for Mode-to-Controller Communication

    /**
     * A helper to quickly find a character from the main list by their ID.
     * @param {string} characterId - The ID of the character to find.
     * @returns {object|undefined} The character object or undefined if not found.
     */
    getCharacterById(characterId) {
        if (!characterId) return undefined;
        return this.allCharacters.find(c => c.id === characterId);
    }

    /**
     * A helper to quickly find a message from the current chat by its ID.
     * @param {string} messageId - The ID of the message to find.
     * @returns {object|undefined} The message object or undefined if not found.
     */
    getMessageById(messageId) {
        return this.#messageMap.get(messageId);
    }

    /**
     * Gets the full, ordered message history for the current chat.
     * @returns {Promise<Array<object>>} A promise that resolves to the message array.
     */
    async getFullHistory() {
        // The chat object is already the full chat data.
        return Promise.resolve(this.chat?.messages || []);
    }
    
    /**
     * Sends a prompt to the main controller using a custom, client-provided message history.
     * This is the entry point for chat modes that need to manipulate the prompt context.
     * @param {object} payload
     * @param {object} payload.userMessage - The user message object to be saved to history.
     * @param {Array<object>} payload.messages - The array of messages to be sent to the LLM for prompting.
     */
    sendChatCompletion({ userMessage, messages }) {
        this.dispatch('chat-mode-send-custom-prompt', { userMessage, messages });
    }

    /**
     * Requests a regeneration using a custom, client-provided message history.
     * @param {object} payload
     * @param {string} payload.messageId - The ID of the message to regenerate.
     * @param {Array<object>} payload.history - The array of messages to use as context for regeneration.
     */
    regenerateWithHistory({ messageId, history }) {
        this.dispatch('chat-mode-regenerate-with-history', { messageId, history });
    }

    /**
     * Sends a prompt to the main controller. Use this function to build the user prompt.
     * @param {string} promptText - The user's message.
     */
    sendPrompt(promptText) {
        this.dispatch('chat-mode-send-prompt', { promptText });
    }

    /**
     * Requests the main controller to regenerate a message response or resend the last user turn.
     * @param {string} messageId - The ID of the message to act upon.
     */
    regenerateMessage(messageId) {
        this.dispatch('chat-mode-regenerate-message', { messageId });
    }

    /**
     * Requests the main controller to create a new chat branch from a specific message.
     * @param {string} messageId - The ID of the message to branch from.
     */
    branchFromMessage(messageId) {
        this.dispatch('chat-mode-branch-message', { messageId });
    }
    
    /**
     * Requests the main controller to navigate to the parent of the current chat.
     */
    goToParentChat() {
        this.dispatch('chat-mode-go-to-parent');
    }

    /**
     * Requests the main controller to save an edited message.
     * @param {string} messageId - The ID of the message being edited.
     * @param {string} newContent - The new content of the message.
     */
    saveEditedMessage(messageId, newContent) {
        this.dispatch('chat-mode-edit-message', { messageId, newContent });
    }

    /**
     * Requests the main controller to delete a message.
     * @param {string} messageId - The ID of the message to delete.
     */
    deleteMessage(messageId) {
        this.dispatch('chat-mode-delete-message', { messageId });
    }

    /**
     * Requests the main controller to copy text to the clipboard.
     * @param {string} content - The text content to copy.
     */
    copyMessageContent(content) {
        this.dispatch('chat-mode-copy-message', { content });
    }
    
    /**
     * Requests the main controller to abort the current generation stream.
     */
    abortGeneration() {
        this.dispatch('chat-mode-abort-generation');
    }
    
    /**
     * Helper for building chat completion prompts in the format expected by the backend.
     * Useful if you aren't familiar with the minerva backend's chat completion API.
     * This will be converted to the appropriate format once sent to the backend using the current API provider class.
     */
    static PromptBuilder = PromptBuilder;
}


export default { BaseChatMode, PromptBuilder };