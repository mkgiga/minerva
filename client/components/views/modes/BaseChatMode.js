import { BaseComponent } from '../../BaseComponent.js';

/**
 * @abstract
 * Base class for all chat rendering modes.
 * It's not meant to be instantiated directly.
 * Child classes must implement the rendering and interaction logic.
 */
export class BaseChatMode extends BaseComponent {
    #isSending = false;
    constructor() {
        super();
        if (this.constructor === BaseChatMode) {
            throw new TypeError('Abstract class "BaseChatMode" cannot be instantiated directly.');
        }

        this.chat = null;
        this.allCharacters = [];
        this.userPersona = null;
        this.mainView = null;
        this.rendererType = 'raw';
    }

    /**
     * Called by MainChatView to initialize the mode with the necessary data.
     * @param {object} data - The initialization data.
     * @param {object} data.chat - The full chat object.
     * @param {Array} data.allCharacters - All available characters.
     * @param {object|null} data.userPersona - The current user persona character.
     * @param {HTMLElement} data.mainView - A reference to the MainChatView instance.
     * @param {string} data.rendererType - The type of renderer ('raw', 'markdown', etc.).
     */
    initialize(data) {
        this.chat = data.chat;
        this.allCharacters = data.allCharacters;
        this.userPersona = data.userPersona;
        this.mainView = data.mainView;
        this.rendererType = data.rendererType;
        this.onInitialize();
    }
    
    get isSending() { return this.#isSending; }
    set isSending(value) { this.#isSending = value; }

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
     * @returns {object} The temporary assistant message object created by the mode, which will be updated by the stream.
     */
    onPromptStart(userMessage) {
        throw new Error('Method "onPromptStart()" must be implemented.');
    }

    /**
     * @abstract
     * Called by MainChatView when a regeneration/resend is triggered.
     * The mode is responsible for updating its UI to show a loading state.
     * @param {object} messageToRegen - The message object to regenerate from (can be 'user' or 'assistant').
     * @returns {object|null} The message object (either existing or new) that should be updated by the stream. Returns null if action can't be handled.
     */
    onRegenerateStart(messageToRegen) {
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

    /**
     * @abstract
     * Called by MainChatView whenever the underlying state changes.
     * The mode should use this to perform targeted DOM updates.
     * @param {object} detail - Information about what changed.
     * @param {Array<string>} detail.changed - A list of top-level state properties that were updated (e.g., ['selectedChat', 'allCharacters']).
     * @param {object} detail.oldState - The state before the update.
     * @param {object} detail.newState - The current state after the update.
     */
    onStateUpdate(detail) {
        throw new Error('Method "onStateUpdate()" must be implemented.');
    }

    /**
     * @abstract
     * Called by MainChatView for each token received from the streaming response.
     * @param {string} token - The new token string.
     * @param {object} messageToUpdate - The message object from the chat state being updated.
     */
    onToken(token, messageToUpdate) {
        throw new Error('Method "onToken()" must be implemented.');
    }

    /**
     * @abstract
     * Called by MainChatView when the streaming response is complete.
     * @param {object} messageToUpdate - The final message object.
     */
    onFinish(messageToUpdate) {
        throw new Error('Method "onFinish()" must be implemented.');
    }

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

    // --- API for Mode-to-Controller Communication ---

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
     * Sends a prompt to the main controller.
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
}