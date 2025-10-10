import { BaseChatMode } from "./BaseChatMode.js";
import { chatModeRegistry } from "../../../ChatModeRegistry.js";
import { uuidv4, notifier } from "../../../client.js";
import "../../common/TextBox.js";
import "../../common/Spinner.js";

export class VisualNovelMode extends BaseChatMode {
    // DOM Elements
    #stage = null;
    #dialogueBox = null;
    #speakerName = null;
    #dialogueText = null;
    #choicesContainer = null;
    #continueIndicator = null;
    #form = null;
    #textbox = null;
    #sendButton = null;
    #fab = null;
    #inputToggle = null;

    // State
    #sceneState = null;
    #isAnimating = false;
    #skipAnimation = false;
    #currentDialogueAnimator = null;
    #streamingContent = null;
    #animationPromiseResolver = null;
    #sceneAdvanceResolver = null;

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
        // DOM Elements
        this.#stage = this.shadowRoot.querySelector('#vn-stage');
        this.#dialogueBox = this.shadowRoot.querySelector('#vn-dialogue-box');
        this.#speakerName = this.shadowRoot.querySelector('#vn-speaker-name');
        this.#dialogueText = this.shadowRoot.querySelector('#vn-dialogue-text');
        this.#choicesContainer = this.shadowRoot.querySelector('#vn-choices');
        this.#continueIndicator = this.shadowRoot.querySelector('#vn-continue-indicator');
        this.#form = this.shadowRoot.querySelector('#chat-form');
        this.#textbox = this.#form.querySelector('text-box');
        this.#sendButton = this.#form.querySelector('.send-button');
        this.#fab = this.shadowRoot.querySelector('#vn-fab');
        this.#inputToggle = this.shadowRoot.querySelector('#vn-input-toggle');

        // Event Listeners
        this.#form.addEventListener('submit', this.#handleSend.bind(this));
        this.#textbox.addEventListener('input', () => this.updateInputState(this.isSending));
        this.#textbox.addEventListener('keydown', this.#handleTextboxKeydown.bind(this));
        this.#choicesContainer.addEventListener('click', this.#handleChoiceClick.bind(this));
        this.#fab.addEventListener('click', this.#toggleDialogueBox.bind(this));
        this.#inputToggle.addEventListener('click', this.#toggleInputForm.bind(this));
        this.#dialogueBox.addEventListener('click', this.#handleDialogueBoxClick.bind(this));
        this.#stage.addEventListener('click', this.#handleDialogueBoxClick.bind(this));
        
        // Initial setup
        this.#rebuildAndRenderScene();
    }
    
    // --- Lifecycle & State Management ---

    onChatSwitched() { this.#rebuildAndRenderScene(); }
    onMessagesAdded() { this.#rebuildAndRenderScene(); }
    onMessageUpdated() { this.#rebuildAndRenderScene(); }
    onMessagesDeleted() { this.#rebuildAndRenderScene(); }
    onChatBranched() { this.#rebuildAndRenderScene(); }

    async #rebuildAndRenderScene() {
        this.#sceneState = { background: 'var(--bg-0)', charactersOnStage: new Map() };

        if (!this.chat || this.chat.messages.length === 0) {
            this.#renderScene(this.#sceneState); // Render empty stage
            this.#dialogueBox.classList.add('active');
            this.#form.classList.remove('hidden');
            this.#speakerName.textContent = 'The story begins...';
            this.#dialogueText.innerHTML = '<em>Type your first action to start the scene.</em>';
            this.updateInputState(false);
            return;
        }

        for (const msg of this.chat.messages) {
            if (msg.role === 'assistant') {
                this.#applySceneML(msg.content, this.#sceneState);
            }
        }
        
        this.#renderScene(this.#sceneState);
        this.#renderFinalDialogueState();
        this.updateInputState(this.isSending);
    }
    
    #renderFinalDialogueState() {
        const lastMessage = this.chat.messages.at(-1);
        if (!lastMessage || lastMessage.role !== 'assistant') {
            this.#clearDialogue();
            this.#form.classList.remove('hidden'); // Show input if story is waiting for user
            this.updateInputState(false);
            return;
        }

        try {
            const doc = this.#parseXML(lastMessage.content);
            const sceneNode = doc?.querySelector("scene");
            if (!sceneNode) { this.#clearDialogue(); return; }

            const lastActionNode = Array.from(sceneNode.children).filter(n => ['dialogue', 'narrate', 'prompt'].includes(n.nodeName.toLowerCase())).pop();

            if (!lastActionNode) {
                this.#clearDialogue();
                this.#form.classList.remove('hidden');
                return;
            }

            this.#dialogueBox.classList.add('active');
            switch (lastActionNode.nodeName.toLowerCase()) {
                case 'dialogue':
                    const from = lastActionNode.getAttribute('from');
                    const character = this.getCharacterById(from);
                    this.#speakerName.textContent = character?.name || from || 'Narration';
                    this.#dialogueText.innerHTML = lastActionNode.textContent;
                    this.#form.classList.remove('hidden');
                    break;
                case 'narrate':
                    this.#speakerName.textContent = 'Narration';
                    this.#dialogueText.innerHTML = lastActionNode.textContent;
                    this.#form.classList.remove('hidden');
                    break;
                case 'prompt':
                    this.#renderChoices(lastActionNode);
                    break;
            }
        } catch (e) {
            console.error("Error rendering final dialogue state:", e);
            this.#clearDialogue();
        }
    }

    #applySceneML(xmlContent, state) {
        try {
            const doc = this.#parseXML(xmlContent);
            const sceneNode = doc?.querySelector("scene");
            if (!sceneNode) return;

            for (const node of sceneNode.children) {
                switch (node.nodeName.toLowerCase()) {
                    case 'background':
                        state.background = node.getAttribute('src') || 'var(--bg-0)';
                        break;
                    case 'enter': {
                        const id = node.getAttribute('id');
                        if (id) state.charactersOnStage.set(id, {
                            id,
                            expression: node.getAttribute('expression'),
                            position: node.getAttribute('position') || 'center',
                        });
                        break;
                    }
                    case 'exit': {
                        const id = node.getAttribute('id');
                        if (id) state.charactersOnStage.delete(id);
                        break;
                    }
                    case 'dialogue': {
                        const id = node.getAttribute('from');
                        const expression = node.getAttribute('expression');
                        if (id && expression && state.charactersOnStage.has(id)) {
                            state.charactersOnStage.get(id).expression = expression;
                        }
                        break;
                    }
                }
            }
        } catch (e) {
            console.error("Error parsing VNML:", e, xmlContent);
        }
    }

    #renderScene(state) {
        this.#stage.style.backgroundImage = state.background.startsWith('#') || state.background.startsWith('var') 
            ? 'none' : `url(${state.background})`;
        this.#stage.style.backgroundColor = state.background.startsWith('#') || state.background.startsWith('var')
            ? state.background : 'var(--bg-0)';

        this.#stage.querySelectorAll('.vn-character').forEach(el => el.remove());
        for (const [id, charState] of state.charactersOnStage.entries()) {
            const charElement = this.#createCharacterElement(charState);
            this.#stage.appendChild(charElement);
            charState.element = charElement;
        }
    }
    
    #createCharacterElement({ id, expression, position }) {
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

    #parseXML(xmlContent) {
        let processedContent = xmlContent.trim();
        
        // Remove markdown fences.
        processedContent = processedContent.replace(/^`{3,}(xml)?\s*\n?/, '').replace(/\n?`{3,}$/, '').trim();

        // Strip any conversational text before the first XML tag.
        const firstTagIndex = processedContent.indexOf('<');
        if (firstTagIndex > 0) {
            processedContent = processedContent.substring(firstTagIndex);
        }
        
        // Strip any conversational text after the last XML tag.
        const lastTagIndex = processedContent.lastIndexOf('>');
        if (lastTagIndex !== -1 && lastTagIndex < processedContent.length - 1) {
            processedContent = processedContent.substring(0, lastTagIndex + 1);
        }

        if (!processedContent) {
            throw new Error("XML content is empty after sanitization.");
        }

        const wrappedContent = `<scene>${processedContent}</scene>`;

        const parser = new DOMParser();
        const doc = parser.parseFromString(wrappedContent, "application/xml");
        const parseError = doc.querySelector("parsererror");
        if (parseError) {
            console.error("Failed to parse the following content:", processedContent);
            throw new Error("XML Parse Error: " + parseError.textContent);
        }
        return doc;
    }
    
    // --- Animations & Live Updates ---
    
    onStreamStart() { this.#streamingContent = ''; }
    onToken(token) { this.#streamingContent += token; }
    
    async onStreamFinish() {
        if (this.#streamingContent) {
            await this.#animateSceneUpdate(this.#streamingContent);
        } else {
            this.#isAnimating = false;
            this.updateInputState(false);
        }
        this.#streamingContent = null;
    }

    onStreamError(error) {
        this.#isAnimating = false;
        this.updateInputState(false);
        this.#dialogueBox.classList.add('active');
        this.#speakerName.textContent = 'Error';
        this.#dialogueText.innerHTML = `<em>Could not get a valid response. ${error.message}</em>`;
        this.#streamingContent = null;
    }

    async #animateSceneUpdate(xmlContent) {
        this.#isAnimating = true;
        this.updateInputState(true);
        this.#clearDialogue();
        
        try {
            const doc = this.#parseXML(xmlContent);
            const sceneNode = doc.querySelector("scene");
            if (!sceneNode) throw new Error("No valid SceneML tags found.");

            for (const node of sceneNode.children) {
                const isPrompt = node.nodeName.toLowerCase() === 'prompt';
                await this.#animateNode(node);
                if (isPrompt) {
                    // Animation is over and is now waiting for user input. Exit the loop.
                    return;
                }
            }
        } catch (e) {
            console.error("Error animating VNML:", e, xmlContent);
            this.#dialogueBox.classList.add('active');
            this.#speakerName.textContent = 'Error';
            this.#dialogueText.innerHTML = `<em>Could not render scene. Check prompt instructions.</em>`;
        }
        
        // This is reached if the scene did not end with a <prompt>
        this.#isAnimating = false;
        this.updateInputState(false);
        this.#form.classList.remove('hidden');
        this.#clearDialogue(false); // Clear text but keep box open
    }
    
    async #animateNode(node) {
        switch (node.nodeName.toLowerCase()) {
            case 'background': {
                const src = node.getAttribute('src');
                this.#stage.style.opacity = 0;
                await this.#sleep(500);
                this.#sceneState.background = src;
                this.#renderScene(this.#sceneState);
                this.#stage.style.opacity = 1;
                await this.#sleep(500);
                break;
            }
            case 'enter': {
                const id = node.getAttribute('id');
                const charState = { id, expression: node.getAttribute('expression'), position: node.getAttribute('position') || 'center' };
                const charEl = this.#createCharacterElement(charState);
                charState.element = charEl;
                this.#sceneState.charactersOnStage.set(id, charState);
                this.#stage.appendChild(charEl);
                charEl.classList.add('enter');
                await this.#sleep(500);
                break;
            }
            case 'exit': {
                const id = node.getAttribute('id');
                const charState = this.#sceneState.charactersOnStage.get(id);
                if (charState?.element) {
                    charState.element.classList.add('exit');
                    await this.#sleep(500);
                    charState.element.remove();
                }
                this.#sceneState.charactersOnStage.delete(id);
                break;
            }
            case 'dialogue': {
                const from = node.getAttribute('from');
                const expression = node.getAttribute('expression');
                const character = this.getCharacterById(from);
                
                if (character && expression) {
                    const charOnStage = this.#sceneState.charactersOnStage.get(character.id);
                    if (charOnStage) {
                        charOnStage.expression = expression;
                        const newEl = this.#createCharacterElement(charOnStage);
                        charOnStage.element.replaceWith(newEl);
                        charOnStage.element = newEl;
                    }
                }
                this.#speakerName.textContent = character?.name || from || 'Narration';
                await this.#typewriter(node.textContent);
                await this.#waitForUserInput();
                break;
            }
            case 'narrate':
                this.#speakerName.textContent = 'Narration';
                await this.#typewriter(node.textContent);
                await this.#waitForUserInput();
                break;
            case 'prompt':
                this.#renderChoices(node);
                this.#isAnimating = false;
                this.updateInputState(false);
                break;
            case 'pause':
                await this.#sleep(parseFloat(node.getAttribute('for') || 0) * 1000);
                break;
            case 'sound':
                console.warn(`[VN Mode] <sound> tag is not yet implemented. src: ${node.getAttribute('src')}`);
                break;
            case 'effect':
                console.warn(`[VN Mode] <effect> tag is not yet implemented. type: ${node.getAttribute('type')}`);
                break;
        }
    }
    
    #renderChoices(promptNode) {
        this.#dialogueBox.classList.add('active');
        this.#speakerName.textContent = 'Choice';

        const infoNode = promptNode.querySelector('info');
        this.#dialogueText.innerHTML = infoNode ? `<em>${infoNode.textContent}</em>` : '';
        
        this.#choicesContainer.innerHTML = '';
        for (const choiceNode of promptNode.querySelectorAll('choice')) {
            const button = document.createElement('button');
            button.className = 'vn-choice-button';
            button.textContent = choiceNode.textContent;
            this.#choicesContainer.appendChild(button);
        }
    }

    #sleep = (ms) => new Promise(resolve => {
        const timeoutId = setTimeout(resolve, ms);
        if (this.#skipAnimation) {
            clearTimeout(timeoutId);
            resolve();
        }
    });

    #typewriter(text) {
        return new Promise(async (resolve) => {
            this.#dialogueText.innerHTML = '';
            this.#dialogueBox.classList.add('active');
            if (this.#currentDialogueAnimator) this.#currentDialogueAnimator.stop();
            
            this.#currentDialogueAnimator = { stopped: false, stop: function() { this.stopped = true; } };
            const localAnimator = this.#currentDialogueAnimator;

            if (this.#skipAnimation || this.settings.typewriterSpeed === 0) {
                this.#dialogueText.innerHTML = text;
            } else {
                for (const char of text) {
                    if (localAnimator.stopped) {
                        this.#dialogueText.innerHTML = text; // Finish immediately if stopped
                        break;
                    }
                    this.#dialogueText.innerHTML += char;
                    await this.#sleep(this.settings.typewriterSpeed);
                }
            }
            
            if (!localAnimator.stopped) this.#currentDialogueAnimator = null;
            this.#skipAnimation = false; // Reset skip flag after animation
            resolve();
        });
    }

    async #waitForUserInput() {
        if (this.#skipAnimation) return;
        this.#continueIndicator.classList.remove('hidden');
        await new Promise(resolve => this.#sceneAdvanceResolver = resolve);
        this.#sceneAdvanceResolver = null;
        this.#continueIndicator.classList.add('hidden');
    }

    // --- Event Handlers & UI ---
    
    #handleSend(event) {
        event.preventDefault();
        const promptText = this.getUserInput();
        if (promptText && !this.#sendButton.disabled) {
            this.sendPrompt(promptText);
        }
    }
    
    #handleTextboxKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!this.#sendButton.disabled) {
                this.#handleSend(event);
            }
        }
    }
    
    #handleChoiceClick(event) {
        if (event.target.classList.contains('vn-choice-button')) {
            if (this.isSending || this.#isAnimating) return;
            const choiceText = event.target.textContent;
            this.sendPrompt(choiceText);
            this.#clearDialogue();
            if (this.#animationPromiseResolver) {
                this.#animationPromiseResolver();
                this.#animationPromiseResolver = null;
            }
        }
    }
    
    #handleDialogueBoxClick() {
        if (this.#isAnimating) {
            if (this.#currentDialogueAnimator) { // If typewriter is running
                this.#skipAnimation = true;
                this.#currentDialogueAnimator.stop();
            } else if (this.#sceneAdvanceResolver) { // If waiting for input to advance scene
                this.#sceneAdvanceResolver();
            }
        }
    }
    
    #toggleDialogueBox() {
        this.#dialogueBox.classList.toggle('active');
    }
    
    #toggleInputForm() {
        this.#form.classList.toggle('hidden');
        if (!this.#form.classList.contains('hidden')) {
            this.#textbox.focus();
        }
    }
    
    #clearDialogue(hideBox = true) {
        this.#speakerName.textContent = '';
        this.#dialogueText.innerHTML = '';
        this.#choicesContainer.innerHTML = '';
        if (hideBox) {
            this.#dialogueBox.classList.remove('active');
        }
        this.#form.classList.add('hidden');
        this.#continueIndicator.classList.add('hidden');
    }

    onPromptStart() {
        this.updateInputState(true);
        this.clearUserInput();
        this.#clearDialogue();
        this.#dialogueBox.classList.add('active');
        this.#speakerName.textContent = 'Thinking...';
        this.#dialogueText.innerHTML = '<div class="spinner-container"><minerva-spinner></minerva-spinner></div>';
        return `vn-response-${uuidv4()}`;
    }
    
    getUserInput() { return this.#textbox.value; }
    clearUserInput() { this.#textbox.value = ''; }

    updateInputState(isSending = false) {
        this.isSending = isSending;
        const isWaitingForChoice = this.#choicesContainer.children.length > 0;
        // Custom input is disabled only when the system is busy.
        const isDisabled = isSending || this.#isAnimating;

        this.#textbox.disabled = isDisabled;
        this.#sendButton.disabled = isDisabled || this.getUserInput().trim() === '';
        
        // Disable choice buttons while busy
        for (const button of this.#choicesContainer.children) {
            button.disabled = isDisabled;
        }
        
        const fabIcon = this.#fab.querySelector('.material-icons');
        if (isSending || this.#isAnimating) {
            this.#fab.classList.add('processing');
            fabIcon.textContent = 'hourglass_empty';
        } else {
            this.#fab.classList.remove('processing');
            fabIcon.textContent = 'chat_bubble';
        }
    }
    
    render() {
        super._initShadow(`
            <div id="vn-container">
                <div id="vn-stage"></div>
                <div id="vn-dialogue-box">
                    <div id="vn-dialogue-header">
                        <div id="vn-speaker-name"></div>
                        <button id="vn-input-toggle" class="icon-btn" title="Toggle custom input"><span class="material-icons">edit</span></button>
                    </div>
                    <div id="vn-dialogue-content">
                        <div id="vn-dialogue-text"></div>
                        <div id="vn-choices"></div>
                        <div id="vn-continue-indicator" class="hidden">
                            <span class="material-icons">arrow_drop_down</span>
                        </div>
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
        #vn-input-toggle { color: var(--text-primary); background-color: var(--bg-2); border-radius: 50%; width: 32px; height: 32px; }
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