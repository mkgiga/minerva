import { BaseChatMode } from "./BaseChatMode.js";
import { chatModeRegistry } from "../../../ChatModeRegistry.js";
import { uuidv4 } from "../../../client.js";
import "../../common/TextBox.js";
import "../../common/Spinner.js";

// --- Command Pattern Implementation for VNML ---

/**
 * @abstract
 * Base class for all undoable/redoable commands in the Visual Novel.
 */
class VNCommand {
    /**
     * @param {object} sceneState - The current state of the scene.
     * @returns {Promise<void>}
     */
    async execute(sceneState, component) { throw new Error("Execute not implemented"); }
    
    /**
     * @param {object} sceneState - The current state of the scene.
     */
    undo(sceneState, component) { throw new Error("Undo not implemented"); }

    /**
     * Determines if this command is a point where the story waits for user input.
     * @returns {boolean}
     */
    get isWaitPoint() { return false; }
}

class BackgroundCommand extends VNCommand {
    constructor(src, previousSrc) {
        super();
        this.src = src;
        this.previousSrc = previousSrc;
    }
    async execute(state, component) {
        state.background = this.src;
        component._stage.style.opacity = 0;
        await component._sleep(500);
        component._renderScene(state);
        component._stage.style.opacity = 1;
        await component._sleep(500);
    }
    undo(state, component) {
        state.background = this.previousSrc;
        component._renderScene(state);
    }
}

class EnterCommand extends VNCommand {
    constructor(charState) {
        super();
        this.charState = charState;
    }
    async execute(state, component) {
        state.charactersOnStage.set(this.charState.id, this.charState);
        const el = component._createCharacterElement(this.charState);
        this.charState.element = el;
        component._stage.appendChild(el);
        el.classList.add('enter');
        await component._sleep(500);
    }
    undo(state, component) {
        state.charactersOnStage.delete(this.charState.id);
        component._renderScene(state);
    }
}

class ExitCommand extends VNCommand {
    constructor(id, previousCharState) {
        super();
        this.id = id;
        this.previousCharState = previousCharState;
    }
    async execute(state, component) {
        const charOnStage = state.charactersOnStage.get(this.id);
        if (charOnStage?.element) {
            charOnStage.element.classList.add('exit');
            await component._sleep(500);
        }
        state.charactersOnStage.delete(this.id);
        component._renderScene(state);
    }
    undo(state, component) {
        if (this.previousCharState) {
            state.charactersOnStage.set(this.id, this.previousCharState);
        }
        component._renderScene(state);
    }
}

class DialogueCommand extends VNCommand {
    constructor(from, expression, text, isUserAction = false) {
        super();
        this.from = from;
        this.expression = expression;
        this.text = text;
        this.isUserAction = isUserAction;
        this.previousExpression = null;
    }
    get isWaitPoint() { return true; }

    async execute(state, component) {
        const character = this.isUserAction ? component.userPersona : component.getCharacterById(this.from);
        const speakerName = character?.name || this.from || 'Narration';

        if (this.expression && character) {
            const charOnStage = state.charactersOnStage.get(character.id);
            if (charOnStage) {
                this.previousExpression = charOnStage.expression; // Store for undo
                charOnStage.expression = this.expression;
                component._renderScene(state);
            }
        }
        
        component._speakerName.textContent = speakerName;
        await component._typewriter(this.text);
        await component._waitForUserInput();
    }
    undo(state, component) {
        if (this.previousExpression && this.from) {
            const charOnStage = state.charactersOnStage.get(this.from);
            if (charOnStage) {
                charOnStage.expression = this.previousExpression;
                component._renderScene(state);
            }
        }
    }
}

class NarrateCommand extends VNCommand {
    constructor(text) {
        super();
        this.text = text;
    }
    get isWaitPoint() { return true; }

    async execute(state, component) {
        component._speakerName.textContent = 'Narration';
        await component._typewriter(this.text);
        await component._waitForUserInput();
    }
    undo() { /* No visual state to undo */ }
}

class PromptCommand extends VNCommand {
    constructor(info, choices) {
        super();
        this.info = info;
        this.choices = choices;
    }
    get isWaitPoint() { return true; }
    
    async execute(state, component) {
        component._renderChoices(this.info, this.choices);
        await new Promise(resolve => component._animationPromiseResolver = resolve);
    }
    undo() { /* No visual state to undo */ }
}

class PauseCommand extends VNCommand {
    constructor(duration) {
        super();
        this.duration = duration;
    }
    async execute(state, component) {
        await component._sleep(this.duration * 1000);
    }
    undo() { /* No-op */ }
}

// --- Visual Novel Mode Refactor ---

export class VisualNovelMode extends BaseChatMode {
    // DOM Elements accessed by commands
    _stage = null;
    _dialogueBox = null;
    _speakerName = null;
    _dialogueText = null;
    _choicesContainer = null;
    _continueIndicator = null;
    _animationPromiseResolver = null;
    _sceneAdvanceResolver = null;

    // DOM Elements for internal use only
    #form = null;
    #textbox = null;
    #sendButton = null;
    #fab = null;
    #inputToggle = null;
    #prevButton = null;
    #nextButton = null;

    // State
    _sceneState = null;
    #commandQueue = [];
    #currentCommandIndex = -1;
    #isAnimating = false;
    #skipTypewriter = false;
    #currentDialogueAnimator = null;
    #streamingContent = null;
    
    static getSettingsSchema() {
        return [
            {
                name: "typewriterSpeed",
                label: "Typewriter Speed (ms per character)",
                type: "range",
                min: 0,
                max: 100,
                step: 1,
                defaultValue: 25,
                description: "The delay between each character in the typewriter effect. Set to 0 for instant text."
            }
        ];
    }

    static getDefaultSettings() {
        return { typewriterSpeed: 25 };
    }

    onInitialize() {
        this.render();
        // --- DOM Element References ---
        this._stage = this.shadowRoot.querySelector('#vn-stage');
        this._dialogueBox = this.shadowRoot.querySelector('#vn-dialogue-box');
        this._speakerName = this.shadowRoot.querySelector('#vn-speaker-name');
        this._dialogueText = this.shadowRoot.querySelector('#vn-dialogue-text');
        this._choicesContainer = this.shadowRoot.querySelector('#vn-choices');
        this._continueIndicator = this.shadowRoot.querySelector('#vn-continue-indicator');
        this.#form = this.shadowRoot.querySelector('#chat-form');
        this.#textbox = this.#form.querySelector('text-box');
        this.#sendButton = this.#form.querySelector('.send-button');
        this.#fab = this.shadowRoot.querySelector('#vn-fab');
        this.#inputToggle = this.shadowRoot.querySelector('#vn-input-toggle');
        this.#prevButton = this.shadowRoot.querySelector('#vn-prev-btn');
        this.#nextButton = this.shadowRoot.querySelector('#vn-next-btn');

        // --- Event Listeners ---
        this.#form.addEventListener('submit', this.#handleSend.bind(this));
        this.#textbox.addEventListener('input', () => this.updateInputState(this.isSending));
        this.#textbox.addEventListener('keydown', this.#handleTextboxKeydown.bind(this));
        this._choicesContainer.addEventListener('click', this.#handleChoiceClick.bind(this));
        this.#fab.addEventListener('click', this.#toggleDialogueBox.bind(this));
        this.#inputToggle.addEventListener('click', this.#toggleInputForm.bind(this));
        this._dialogueBox.addEventListener('click', this.#handleDialogueBoxClick.bind(this));
        this._stage.addEventListener('click', this.#handleDialogueBoxClick.bind(this));
        this.#prevButton.addEventListener('click', this.#handlePrevious.bind(this));
        this.#nextButton.addEventListener('click', this.#handleNext.bind(this));
        
        this.#buildAndDisplayCommandQueue();
    }
    
    // --- Lifecycle Hooks ---
    onChatSwitched() { this.#buildAndDisplayCommandQueue(); }
    onMessagesAdded() { this.#buildAndDisplayCommandQueue(); }
    onMessageUpdated() { this.#buildAndDisplayCommandQueue(); }
    onMessagesDeleted() { this.#buildAndDisplayCommandQueue(); }
    onChatBranched() { this.#buildAndDisplayCommandQueue(); }
    
    // --- Command Queue & State Management ---

    async #buildAndDisplayCommandQueue() {
        if (this.#isAnimating) return;
        
        this._sceneState = { background: 'var(--bg-0)', charactersOnStage: new Map() };
        this.#commandQueue = [];
        this.#currentCommandIndex = -1;

        if (!this.chat || this.chat.messages.length === 0) {
            this._renderScene(this._sceneState);
            this._dialogueBox.classList.add('active');
            this.#form.classList.remove('hidden');
            this._speakerName.textContent = 'The story begins...';
            this._dialogueText.innerHTML = '<em>Type your first action to start the scene.</em>';
            this.updateInputState(false);
            return;
        }

        const tempBuildState = { background: 'var(--bg-0)', charactersOnStage: new Map() };
        for (const msg of this.chat.messages) {
            if (msg.role === 'assistant') {
                this.#parseAndQueueAssistantMessage(msg.content, tempBuildState);
            } else if (msg.role === 'user') {
                this.#parseAndQueueUserMessage(msg.content);
            }
        }
        
        // Jump to the end of the newly built queue without animation
        await this.#jumpToCommand(this.#commandQueue.length - 1, true);
    }

    #parseAndQueueAssistantMessage(xmlContent, state) {
        try {
            const doc = this._tryRepairVNML(xmlContent);
            if (!doc || doc.querySelector("parsererror")) {
                // If repair fails or content is empty, queue a simple narration command with the raw content as a fallback.
                console.error("Failed to parse VNML, showing as raw text.");
                this.#commandQueue.push(new NarrateCommand(`[Parse Error]\n${xmlContent}`));
                return;
            }

            const rootNode = doc.documentElement;
            if (!rootNode) return;

            for (const node of rootNode.children) {
                let command = null;
                switch (node.nodeName.toLowerCase()) {
                    case 'background':
                        command = new BackgroundCommand(node.getAttribute('src'), state.background);
                        state.background = node.getAttribute('src');
                        break;
                    case 'enter': {
                        const charState = { id: node.getAttribute('id'), expression: node.getAttribute('expression'), position: node.getAttribute('position') || 'center' };
                        command = new EnterCommand(charState);
                        state.charactersOnStage.set(charState.id, charState);
                        break;
                    }
                    case 'exit': {
                        const id = node.getAttribute('id');
                        command = new ExitCommand(id, state.charactersOnStage.get(id));
                        state.charactersOnStage.delete(id);
                        break;
                    }
                    case 'dialogue':
                        command = new DialogueCommand(node.getAttribute('from'), node.getAttribute('expression'), node.textContent);
                        const charOnStage = state.charactersOnStage.get(node.getAttribute('from'));
                        if (charOnStage) charOnStage.expression = node.getAttribute('expression');
                        break;
                    case 'narrate':
                        command = new NarrateCommand(node.textContent);
                        break;
                    case 'prompt': {
                        const info = node.querySelector('info')?.textContent || '';
                        const choices = Array.from(node.querySelectorAll('choice')).map(c => c.textContent);
                        command = new PromptCommand(info, choices);
                        break;
                    }
                    case 'pause':
                        command = new PauseCommand(parseFloat(node.getAttribute('for') || 0));
                        break;
                }
                if (command) this.#commandQueue.push(command);
            }
        } catch (e) {
            console.error("Error parsing and queueing VNML:", e, xmlContent);
        }
    }

    #parseAndQueueUserMessage(content) {
        let command;
        if (content.startsWith('<choice>') && content.endsWith('</choice>')) {
            content = content.slice(8, -9); // Strip choice tags for display
        }
        // User input with quotes is treated as dialogue from the player persona
        if (content.includes('"')) {
            command = new DialogueCommand(this.userPersona?.id, null, content, true);
        } else {
            command = new NarrateCommand(content);
        }
        this.#commandQueue.push(command);
    }
    
    // --- Navigation & Execution Engine ---

    async #jumpToCommand(targetIndex, instant = false) {
        if (this.#isAnimating || targetIndex === this.#currentCommandIndex) return;

        this.#isAnimating = true;

        if (instant) {
            // For an instant jump, calculate the final state without animations
            const finalState = { background: 'var(--bg-0)', charactersOnStage: new Map() };
            
            // Create a dummy component that inherits methods but has no-op animations
            const dummyComponent = Object.create(Object.getPrototypeOf(this));
            Object.assign(dummyComponent, this); // copy instance properties
            dummyComponent._sleep = async ()=>{};
            dummyComponent._renderScene = ()=>{};
            dummyComponent._typewriter = async ()=>{};
            dummyComponent._waitForUserInput = async ()=>{};

            if (targetIndex > -1) {
                for (let i = 0; i <= targetIndex; i++) {
                    await this.#commandQueue[i].execute(finalState, dummyComponent);
                }
            }

            // Apply final state and render scene once
            this._sceneState = finalState;
            this._renderScene(this._sceneState);
            
            // Now, manually display the UI for the final command without waiting
            const finalCmd = this.#commandQueue[targetIndex];
            if (finalCmd) {
                if (finalCmd instanceof DialogueCommand || finalCmd instanceof NarrateCommand) {
                    this._clearDialogue(false);
                    const character = (finalCmd.isUserAction) ? this.userPersona : this.getCharacterById(finalCmd.from);
                    this._speakerName.textContent = (finalCmd instanceof NarrateCommand) ? 'Narration' : (character?.name || finalCmd.from || 'Narration');
                    this._dialogueText.innerHTML = finalCmd.text;
                    this._dialogueBox.classList.add('active');
                } else if (finalCmd instanceof PromptCommand) {
                    this._clearDialogue(false);
                    this._renderChoices(finalCmd.info, finalCmd.choices);
                } else {
                    this._clearDialogue(true);
                }
            } else {
                this._clearDialogue(true);
            }
            
        } else { // Animated jump
            const isForward = targetIndex > this.#currentCommandIndex;
            if (isForward) {
                for (let i = this.#currentCommandIndex + 1; i <= targetIndex; i++) {
                    const command = this.#commandQueue[i];
                    if (command.isWaitPoint) this._clearDialogue(false);
                    await command.execute(this._sceneState, this);
                }
            } else { // Backward (undo)
                for (let i = this.#currentCommandIndex; i > targetIndex; i--) {
                    const command = this.#commandQueue[i];
                    command.undo(this._sceneState, this);
                }
                // After undoing, render the final state and re-execute the target command's UI part
                this._renderScene(this._sceneState);
                const targetCmd = this.#commandQueue[targetIndex];
                if (targetCmd && targetCmd.isWaitPoint) {
                    this._clearDialogue(false);
                    await targetCmd.execute(this._sceneState, this);
                }
            }
        }

        this.#currentCommandIndex = targetIndex;
        this.#isAnimating = false;
        this.updateInputState(false);
    }

    #findNextWaitPoint(startIndex) {
        for (let i = startIndex + 1; i < this.#commandQueue.length; i++) {
            if (this.#commandQueue[i].isWaitPoint) return i;
        }
        return -1; // Not found
    }

    #findPreviousWaitPoint(startIndex) {
        for (let i = startIndex - 1; i >= 0; i--) {
            if (this.#commandQueue[i].isWaitPoint) return i;
        }
        return -1; // Not found
    }

    async #handleNext() {
        if (this.#isAnimating || this.isSending) return;
        const nextIndex = this.#findNextWaitPoint(this.#currentCommandIndex);
        if (nextIndex > -1) {
            await this.#jumpToCommand(nextIndex);
        }
    }

    async #handlePrevious() {
        if (this.#isAnimating || this.isSending) return;
        const prevIndex = this.#findPreviousWaitPoint(this.#currentCommandIndex);
        if (prevIndex > -1) {
            await this.#jumpToCommand(prevIndex);
        }
    }

    // --- Live Stream Handling ---

    onStreamStart() { this.#streamingContent = ''; }
    onToken(token) { this.#streamingContent += token; }

    async onStreamFinish() {
        if (this.isSending && this.#streamingContent) {
            const startIndex = this.#commandQueue.length;
            this.#parseAndQueueAssistantMessage(this.#streamingContent, this._sceneState);
            const endIndex = this.#commandQueue.length - 1;
            
            if (endIndex >= startIndex) {
                await this.#jumpToCommand(endIndex);
            }
        }
        this.#streamingContent = null;
        this.#isAnimating = false;
        this.updateInputState(false);
    }

    onStreamError(error) {
        this.#isAnimating = false;
        this.updateInputState(false);
        this._dialogueBox.classList.add('active');
        this._speakerName.textContent = 'Error';
        this._dialogueText.innerHTML = `<em>Could not get a valid response. ${error.message}</em>`;
        this.#streamingContent = null;
    }

    onPromptStart() {
        this.updateInputState(true);
        this.clearUserInput();
        this._clearDialogue();
        this._dialogueBox.classList.add('active');
        this._speakerName.textContent = 'Thinking...';
        this._dialogueText.innerHTML = '<div class="spinner-container"><minerva-spinner></minerva-spinner></div>';
        return `vn-response-${uuidv4()}`;
    }

    // --- UI Rendering & Helpers ---

    _renderScene(state) {
        this._stage.style.backgroundImage = state.background.startsWith('#') || state.background.startsWith('var') 
            ? 'none' : `url(${state.background})`;
        this._stage.style.backgroundColor = state.background.startsWith('#') || state.background.startsWith('var')
            ? state.background : 'var(--bg-0)';

        this._stage.innerHTML = '';
        for (const [id, charState] of state.charactersOnStage.entries()) {
            const charElement = this._createCharacterElement(charState);
            this._stage.appendChild(charElement);
            charState.element = charElement;
        }
    }

    _createCharacterElement({ id, expression, position }) {
        const character = this.getCharacterById(id);
        const el = document.createElement('div');
        el.className = `vn-character vn-pos-${position}`;
        el.dataset.characterId = id;
        
        let imageUrl = character?.avatarUrl || '/assets/images/default_avatar.svg';
        if (expression && character?.expressions) {
            const expr = character.expressions.find(e => e.name?.toLowerCase() === expression.toLowerCase());
            if (expr) imageUrl = expr.url;
        }
        el.innerHTML = `<img src="${imageUrl}" alt="${character?.name || id}" />`;
        return el;
    }
    
    _renderChoices(info, choices) {
        this._dialogueBox.classList.add('active');
        this._speakerName.textContent = 'Choice';
        this._dialogueText.innerHTML = info ? `<em>${info}</em>` : '';
        this._choicesContainer.innerHTML = '';
        for (const choiceText of choices) {
            const button = document.createElement('button');
            button.className = 'vn-choice-button';
            button.textContent = choiceText;
            this._choicesContainer.appendChild(button);
        }
    }

    _sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    _typewriter(text) {
        return new Promise(async (resolve) => {
            this._dialogueText.innerHTML = '';
            this._dialogueBox.classList.add('active');
            if (this.#currentDialogueAnimator) this.#currentDialogueAnimator.stop();
            this.#currentDialogueAnimator = { stopped: false, stop: function() { this.stopped = true; } };
            const localAnimator = this.#currentDialogueAnimator;

            if (this.#skipTypewriter || this.settings.typewriterSpeed === 0) {
                this._dialogueText.innerHTML = text;
            } else {
                for (const char of text) {
                    if (localAnimator.stopped) { this._dialogueText.innerHTML = text; break; }
                    this._dialogueText.innerHTML += char;
                    await this._sleep(this.settings.typewriterSpeed);
                }
            }
            this.#currentDialogueAnimator = null;
            this.#skipTypewriter = false;
            resolve();
        });
    }

    async _waitForUserInput() {
        this._continueIndicator.classList.remove('hidden');
        await new Promise(resolve => this._sceneAdvanceResolver = resolve);
        this._sceneAdvanceResolver = null;
        this._continueIndicator.classList.add('hidden');
    }

    _clearDialogue(hideBox = true) {
        this._speakerName.textContent = '';
        this._dialogueText.innerHTML = '';
        this._choicesContainer.innerHTML = '';
        if (hideBox) this._dialogueBox.classList.remove('active');
        this.#form.classList.add('hidden');
        this._continueIndicator.classList.add('hidden');
    }
    
    #levenshteinDistance(s1, s2) {
        s1 = s1.toLowerCase();
        s2 = s2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    _tryRepairVNML(xmlContent) {
        let processed = (xmlContent || '').trim().replace(/^`{3,}(xml)?\s*\n?/, '').replace(/\n?`{3,}$/, '').trim();
        if (!processed) return null;
    
        // Sanitize by trimming anything before the first tag and after the last.
        const firstTag = processed.indexOf('<');
        if (firstTag > 0) processed = processed.substring(firstTag);
        const lastTag = processed.lastIndexOf('>');
        if (lastTag !== -1 && lastTag < processed.length - 1) processed = processed.substring(0, lastTag + 1);
        if (!processed) return null;
        
        const wrapped = `<root>${processed}</root>`;
        const parser = new DOMParser();
        let doc = parser.parseFromString(wrapped, "application/xml");
        let parserError = doc.querySelector("parsererror");
        if (!parserError) return doc; // It's valid, no repair needed.
    
        console.warn("VNML parsing failed, attempting repair. Error:", parserError.textContent);
    
        const tagNames = ["background", "enter", "exit", "narrate", "dialogue", "prompt", "info", "choice", "pause"];
    
        const findBestMatch = (badTag) => {
            let bestMatch = null;
            let minDistance = Infinity;
            for (const goodTag of tagNames) {
                const distance = this.#levenshteinDistance(badTag, goodTag);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMatch = goodTag;
                }
            }
            // Only repair if it's a close match (e.g., typo)
            return minDistance <= 2 ? bestMatch : null;
        };
    
        const repairedContent = processed.replace(/(<\/?)([\w-]+)(.*?>)/g, (match, opening, tagName, rest) => {
            if (tagNames.includes(tagName.toLowerCase())) return match;
            const bestMatch = findBestMatch(tagName);
            if (bestMatch) {
                console.log(`Repairing VNML tag: '${tagName}' -> '${bestMatch}'`);
                return `${opening}${bestMatch}${rest}`;
            }
            return match; // Return original if no good match
        });
    
        const repairedWrapped = `<root>${repairedContent}</root>`;
        doc = parser.parseFromString(repairedWrapped, "application/xml");
        parserError = doc.querySelector("parsererror");
        if (parserError) console.error("VNML repair failed. Final error:", parserError.textContent);
        else console.log("VNML repair successful.");
        return doc;
    }

    // --- UI Event Handlers ---

    #handleSend(event) {
        event.preventDefault();
        const promptText = this.getUserInput();
        if (promptText && !this.#sendButton.disabled) this.sendPrompt(promptText);
    }
    
    #handleTextboxKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!this.#sendButton.disabled) this.#handleSend(event);
        }
    }
    
    #handleChoiceClick(event) {
        if (event.target.classList.contains('vn-choice-button')) {
            if (this.isSending || this.#isAnimating) return;
            const choiceText = event.target.textContent;
            this.sendPrompt(`<choice>${choiceText}</choice>`);
            this._clearDialogue();
            if (this._animationPromiseResolver) {
                this._animationPromiseResolver();
                this._animationPromiseResolver = null;
            }
        }
    }
    
    #handleDialogueBoxClick() {
        if (this._sceneAdvanceResolver) {
            this._sceneAdvanceResolver();
        } else if (this.#currentDialogueAnimator) {
            this.#skipTypewriter = true;
            this.#currentDialogueAnimator.stop();
        } else if (!this.#isAnimating && !this.isSending) {
            // If nothing is animating or waiting, clicking advances the story
            this.#handleNext();
        }
    }
    
    #toggleDialogueBox() { this._dialogueBox.classList.toggle('active'); }
    #toggleInputForm() { this.#form.classList.toggle('hidden'); if (!this.#form.classList.contains('hidden')) this.#textbox.focus(); }
    
    getUserInput() { return this.#textbox.value; }
    clearUserInput() { this.#textbox.value = ''; }

    updateInputState(isSending = false) {
        this.isSending = isSending;
        const isDisabled = isSending || this.#isAnimating;

        this.#textbox.disabled = isDisabled;
        this.#sendButton.disabled = isDisabled || this.getUserInput().trim() === '';
        
        for (const button of this._choicesContainer.children) button.disabled = isDisabled;
        
        const fabIcon = this.#fab.querySelector('.material-icons');
        if (isDisabled) {
            this.#fab.classList.add('processing');
            fabIcon.textContent = 'hourglass_empty';
        } else {
            this.#fab.classList.remove('processing');
            fabIcon.textContent = 'chat_bubble';
        }
        
        // Update nav buttons
        const canGoBack = this.#findPreviousWaitPoint(this.#currentCommandIndex) > -1;
        const canGoForward = this.#findNextWaitPoint(this.#currentCommandIndex) > -1;
        this.#prevButton.disabled = isDisabled || !canGoBack;
        this.#nextButton.disabled = isDisabled || !canGoForward;
    }
    
    render() {
        super._initShadow(`
            <div id="vn-container">
                <div id="vn-stage"></div>
                <div id="vn-dialogue-box">
                    <div id="vn-dialogue-header">
                        <div id="vn-speaker-name"></div>
                        <div class="header-controls">
                            <button id="vn-prev-btn" class="icon-btn" title="Previous"><span class="material-icons">arrow_back_ios</span></button>
                            <button id="vn-next-btn" class="icon-btn" title="Next"><span class="material-icons">arrow_forward_ios</span></button>
                            <button id="vn-input-toggle" class="icon-btn" title="Toggle custom input"><span class="material-icons">edit</span></button>
                        </div>
                    </div>
                    <div id="vn-dialogue-content">
                        <div id="vn-dialogue-text"></div>
                        <div id="vn-choices"></div>
                        <div id="vn-continue-indicator" class="hidden"><span class="material-icons">arrow_drop_down</span></div>
                    </div>
                    <form id="chat-form" class="hidden">
                        <text-box name="message" placeholder="Type your action... (Enter to send)"></text-box>
                        <button type="submit" class="send-button" title="Send"><span class="material-icons">send</span></button>
                    </form>
                </div>
                <button id="vn-fab" class="icon-btn" title="Toggle Dialogue"><span class="material-icons">chat_bubble</span></button>
            </div>
        `, this.styles());
    }

    styles() { return `
        :host { display: flex; flex-direction: column; height: 100%; }
        #vn-container { flex-grow: 1; position: relative; overflow: hidden; background-color: var(--bg-0); }
        #vn-stage { width: 100%; height: 100%; background-size: cover; background-position: center; transition: background-image 1s ease-in-out, background-color 1s ease-in-out, opacity 0.5s ease-in-out; display: flex; justify-content: center; align-items: flex-end; }
        
        .vn-character { position: absolute; bottom: 0; height: 80%; max-width: 40%; transition: transform 0.5s ease-in-out, opacity 0.5s ease-in-out; will-change: transform, opacity; display: flex; justify-content: center; align-items: flex-end; }
        .vn-character img { height: 100%; width: 100%; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)); }
        .vn-pos-left { transform: translateX(-60%); }
        .vn-pos-right { transform: translateX(60%); }
        .vn-pos-center { transform: translateX(0); z-index: 5; }
        .vn-character.enter { animation: vn-enter 0.5s ease-out forwards; }
        .vn-character.exit { animation: vn-exit 0.5s ease-in forwards; }
        @keyframes vn-enter { from { opacity: 0; transform: translateY(20px) translateX(var(--tx, 0)); } to { opacity: 1; transform: translateY(0) translateX(var(--tx, 0)); } }
        .vn-pos-left.enter { --tx: -60%; } .vn-pos-right.enter { --tx: 60%; }
        @keyframes vn-exit { to { opacity: 0; } }
        
        #vn-dialogue-box { position: absolute; bottom: 2%; left: 5%; right: 5%; height: 30%; min-height: 150px; background-color: rgba(0,0,0,0.7); border: 2px solid var(--bg-3); border-radius: var(--radius-md); padding: var(--spacing-sm); display: flex; flex-direction: column; z-index: 10; transform: translateY(150%); transition: transform 0.3s ease-out; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
        #vn-dialogue-box.active { transform: translateY(0); }
        #vn-dialogue-header { display: flex; justify-content: space-between; align-items: center; position: absolute; top: 0; left: 0; right: 0; transform: translateY(-50%); padding: 0 var(--spacing-lg); }
        #vn-speaker-name { background-color: var(--bg-2); color: var(--accent-primary); padding: var(--spacing-xs) var(--spacing-md); border-radius: var(--radius-sm); font-weight: 600; }
        .header-controls { display: flex; align-items: center; gap: var(--spacing-sm); background-color: var(--bg-2); padding: var(--spacing-xs); border-radius: var(--radius-md); }
        #vn-input-toggle, #vn-prev-btn, #vn-next-btn { color: var(--text-primary); border-radius: 50%; width: 32px; height: 32px; }
        #vn-prev-btn:disabled, #vn-next-btn:disabled { color: var(--text-disabled); cursor: not-allowed; }
        
        #vn-dialogue-content { flex-grow: 1; overflow: hidden; display: flex; flex-direction: column; margin-top: var(--spacing-lg); position: relative; }
        #vn-dialogue-text { flex-grow: 1; overflow-y: auto; line-height: 1.6; }
        .spinner-container { display: flex; align-items: center; justify-content: center; height: 100%; }
        
        #vn-choices { display: flex; flex-direction: column; align-items: center; gap: var(--spacing-sm); margin-top: var(--spacing-sm); flex-shrink: 0; }
        .vn-choice-button { background-color: var(--bg-1); color: var(--text-primary); border: 1px solid var(--bg-3); padding: var(--spacing-sm) var(--spacing-lg); border-radius: var(--radius-sm); cursor: pointer; transition: var(--transition-fast); width: 80%; text-align: center; }
        .vn-choice-button:hover:not(:disabled) { background-color: var(--accent-primary); color: var(--bg-0); }
        .vn-choice-button:disabled { color: var(--text-disabled); background-color: var(--bg-2); cursor: not-allowed; }

        #vn-continue-indicator { position: absolute; bottom: var(--spacing-sm); right: var(--spacing-md); color: var(--text-primary); animation: bounce 2s infinite; }
        #vn-continue-indicator.hidden { display: none; }
        @keyframes bounce { 0%, 20%, 50%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-10px); } 60% { transform: translateY(-5px); } }

        #chat-form { display: flex; gap: var(--spacing-md); padding-top: var(--spacing-sm); border-top: 1px solid var(--bg-3); }
        #chat-form.hidden { display: none; }
        #chat-form text-box { flex-grow: 1; max-height: 100px; background-color: var(--bg-0); }
        
        #vn-fab { position: absolute; bottom: var(--spacing-md); right: var(--spacing-md); z-index: 20; width: 56px; height: 56px; border-radius: 50%; background-color: var(--accent-primary); color: var(--bg-0); box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
        #vn-fab.processing { animation: pulse 2s infinite; pointer-events: none; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 var(--accent-primary-faded); } 70% { box-shadow: 0 0 0 10px rgba(138, 180, 248, 0); } 100% { box-shadow: 0 0 0 0 rgba(138, 180, 248, 0); } }

        .send-button { flex-shrink: 0; width: 48px; height: 48px; border: none; background-color: var(--accent-primary); color: var(--bg-0); border-radius: var(--radius-md); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: var(--transition-fast); }
        .send-button:disabled { background-color: var(--bg-2); color: var(--text-disabled); cursor: not-allowed; }
    `;}
}

customElements.define("visual-novel-mode", VisualNovelMode);
chatModeRegistry.register("visual-novel", "visual-novel-mode");