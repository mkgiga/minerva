import { BaseComponent } from './BaseComponent.js';
import { api, modal, notifier, imagePreview } from '../../client.js';

class CharacterEditor extends BaseComponent {
    constructor() {
        super();
        this._character = null;
        this._expressionGenInProgress = false;
        this._sseHandler = null;
        this.render();
    }
    
    set character(newChar) {
        this._character = newChar;
        this.#updateView();
    }

    get character() {
        return this._character;
    }
    
    connectedCallback() {
        
        const form = this.shadowRoot.querySelector('form');
        form.addEventListener('submit', this.onSave.bind(this));
        form.addEventListener('click', this.handleFormClick.bind(this));
        form.addEventListener('change', this.handleFormChange.bind(this));
        form.addEventListener('blur', this.handleFormBlur.bind(this), true);
        this.shadowRoot.querySelector('#character-avatar-upload').addEventListener('change', this.onAvatarChange.bind(this));
        
        // Listener for the new generate button
        this.shadowRoot.querySelector('#generate-btn').addEventListener('click', this.handleGenerate.bind(this));

        // Tag input handlers
        this.shadowRoot.querySelector('#character-tags-input').addEventListener('keydown', this.handleTagInput.bind(this));
        this.shadowRoot.querySelector('#character-tags-container').addEventListener('click', this.handleTagRemove.bind(this));

        this.#updateView();
    }

    handleTagInput(event) {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            const input = event.target;
            const tag = input.value.trim().toLowerCase().replace(',', '');
            if (tag && !this._character.tags?.includes(tag)) {
                if (!this._character.tags) this._character.tags = [];
                this._character.tags.push(tag);
                this.#renderTags();
            }
            input.value = '';
        }
    }

    handleTagRemove(event) {
        const removeBtn = event.target.closest('.remove-tag');
        if (removeBtn) {
            const chip = removeBtn.closest('.tag-chip');
            const tag = chip.dataset.tag;
            this._character.tags = this._character.tags.filter(t => t !== tag);
            this.#renderTags();
        }
    }

    #renderTags() {
        const container = this.shadowRoot.querySelector('#character-tags-container');
        const input = container.querySelector('.tag-input');

        // Remove existing chips
        container.querySelectorAll('.tag-chip').forEach(chip => chip.remove());

        // Add chips for each tag
        const tags = this._character?.tags || [];
        tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.dataset.tag = tag;
            chip.innerHTML = `${tag}<button type="button" class="remove-tag">×</button>`;
            container.insertBefore(chip, input);
        });
    }

    handleFormClick(event) {
        // Expression handlers
        const addExprBtn = event.target.closest('#add-expression-btn');
        if (addExprBtn) {
            this.onAddExpression();
            return;
        }

        const genExprBtn = event.target.closest('#generate-expressions-btn');
        if (genExprBtn) {
            this.onGenerateExpressions();
            return;
        }

        const deleteExprBtn = event.target.closest('.delete-expression-item-btn');
        if (deleteExprBtn) {
            this.onDeleteExpression(deleteExprBtn.closest('.expression-item').dataset.filename);
            return;
        }

        const previewExpression = event.target.closest('.expression-item-preview');
        if (previewExpression) {
            imagePreview.show({ src: previewExpression.src, alt: previewExpression.alt });
            return; 
        }

        // Gallery handlers
        const addImageBtn = event.target.closest('#add-gallery-image-btn');
        if (addImageBtn) {
            this.onAddGalleryImage();
            return;
        }
        
        const deleteBtn = event.target.closest('.delete-gallery-item-btn');
        if (deleteBtn) {
            this.onDeleteGalleryImage(deleteBtn.closest('.gallery-item').dataset.filename);
            return;
        }

        // Handle clicks on gallery item previews
        const previewImage = event.target.closest('.gallery-item-preview');
        if (previewImage) {
            imagePreview.show({ src: previewImage.src, alt: previewImage.alt });
            return; 
        }
    }

    handleFormChange(event) {
        // Not used for now, using blur to save inputs
    }

    handleFormBlur(event) {
        // Handle Expression Name change
        const nameInput = event.target.closest('.expression-name-input');
        if (nameInput) {
            const itemEl = nameInput.closest('.expression-item');
            const filename = itemEl.dataset.filename;
            const newName = nameInput.value.trim();
            const originalName = this.character.expressions.find(item => item.src === filename)?.name;
            if (newName && newName !== originalName) {
                this.onExpressionNameChange(filename, newName);
            }
            return;
        }

        // Handle Gallery Alt Text change
        const altInput = event.target.closest('.alt-text-input');
        if (altInput) {
            const itemEl = altInput.closest('.gallery-item');
            const filename = itemEl.dataset.filename;
            const newAlt = altInput.value;
            const originalAlt = this.character.gallery.find(item => item.src === filename)?.alt;
            if (newAlt !== originalAlt) {
                this.onAltTextChange(filename, newAlt);
            }
            return;
        }
    }

    async handleGenerate() {
        const nameInput = this.shadowRoot.querySelector('#character-name-input');
        const descInput = this.shadowRoot.querySelector('#character-description');
        const btn = this.shadowRoot.querySelector('#generate-btn');
        const btnIcon = btn.querySelector('.material-icons');

        const name = nameInput.value.trim();
        const description = descInput.value.trim();

        if (!name && !description) {
            notifier.show({ type: 'warn', message: 'Please enter a name or description first.' });
            return;
        }

        // Set loading state
        btn.disabled = true;
        const originalIcon = btnIcon.textContent;
        btnIcon.textContent = 'hourglass_empty';
        btnIcon.classList.add('spinning');

        try {
            notifier.show({ message: 'Generating character profile...', duration: 2000 });
            
            const result = await api.post('/api/tools/generate-character', { name, description });
            
            if (result.name) nameInput.value = result.name;
            
            let appearance = result.appearance || '';
            let nature = result.nature || '';
            let height = result.attributes?.height || undefined;
            let weight = result.attributes?.weight || undefined;
            let age = result.attributes?.age || undefined;
            let sex = result.attributes?.sex || undefined;
            let race = result.attributes?.race || undefined;
            let combatAttributes = result.combatAttributes?.baseStats || undefined;
            let combatSection = `# Combat Info

${combatAttributes ? Object.entries(combatAttributes).map(([key, val]) => `- ${key.slice(0, 1).toUpperCase() + key.slice(1)}: ${val}`).join('\n') : 'N/A'}
            `.trim();

            let generatedDescription = `# Attributes

${sex ? `- Sex: ${sex}` : ''}
${age ? `- Age: ${age}` : ''}
${height ? `- Height: ${height}` : ''}
${weight ? `- Weight: ${weight}` : ''}
${race ? `- Race: ${race}` : ''}

${combatSection}

---

# Appearance

${appearance}

# Nature

${nature}

            `.trim().replace(/\n{3,}/g, '\n\n'); // Limit consecutive newlines
            
            descInput.value = generatedDescription;

            // Trigger save implicitly via dispatch if we want, or just let user save manually.
            // For better UX, we just update inputs and notify.
            notifier.show({ type: 'good', message: 'Character profile generated!' });

        } catch (error) {
            console.error('Generation failed:', error);
            notifier.show({ type: 'bad', header: 'Generation Failed', message: error.message });
        } finally {
            // Reset loading state
            btn.disabled = false;
            btnIcon.textContent = originalIcon;
            btnIcon.classList.remove('spinning');
        }
    }

    onSave(event) {
        event.preventDefault();
        const updatedCharacter = {
            ...this.character,
            id: this.shadowRoot.querySelector('#character-id-input').value.trim(),
            name: this.shadowRoot.querySelector('#character-name-input').value,
            description: this.shadowRoot.querySelector('#character-description').value,
            tags: this._character?.tags || [],
        };
        this.dispatch('character-save', { character: updatedCharacter });
    }

    async onAvatarChange(event) {
        if (event.target.id !== 'character-avatar-upload' || !event.target.files.length) return;
        
        const file = event.target.files[0];
        const formData = new FormData();
        formData.append('avatar', file);

        try {
            const updatedCharacter = await api.post(`/api/characters/${this._character.id}/avatar`, formData);
            this.dispatch('character-save', { character: updatedCharacter, isAvatarUpdate: true });
        } catch (error) {
            console.error('Failed to upload avatar:', error);
        }
    }
    
    async onAddExpression() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.onchange = async () => {
            const file = fileInput.files[0];
            if (!file) return;

            const content = document.createElement('div');
            content.innerHTML = `<p class="field-description">Provide a short, unique name for this expression (e.g., happy, sad, angry).</p>`;
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'form-group';
            nameInput.placeholder = 'e.g., smiling';
            content.appendChild(nameInput);

            modal.show({
                title: 'Add Expression',
                content,
                buttons: [
                    { label: 'Cancel', className: 'button-secondary', onClick: () => modal.hide() },
                    { 
                        label: 'Upload', 
                        className: 'button-primary',
                        onClick: async () => {
                            const name = nameInput.value.trim();
                            if (!name) {
                                notifier.show({type: 'bad', message: 'Expression name cannot be empty.'});
                                return;
                            }

                            const formData = new FormData();
                            formData.append('image', file);
                            formData.append('name', name);
                            
                            modal.hide();
                            notifier.show({ header: 'Uploading...', message: `Adding expression for ${this.character.name}.` });
                            try {
                                await api.post(`/api/characters/${this.character.id}/expressions`, formData);
                                notifier.show({ type: 'good', message: 'Expression added.' });
                            } catch (e) {
                                notifier.show({ type: 'bad', header: 'Upload Failed', message: e.message });
                            }
                        }
                    }
                ]
            });
            setTimeout(() => nameInput.focus(), 100);
        };
        fileInput.click();
    }

    async onExpressionNameChange(filename, newName) {
        try {
            await api.put(`/api/characters/${this.character.id}/expressions/${filename}`, { name: newName });
            notifier.show({ message: 'Expression name updated.' });
        } catch(e) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not update expression name.' });
        }
    }
    
    onDeleteExpression(filename) {
        modal.confirm({
            title: 'Delete Expression',
            content: 'Are you sure you want to delete this expression?',
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/characters/${this.character.id}/expressions/${filename}`);
                    notifier.show({ message: 'Expression deleted.' });
                } catch (e) {
                    notifier.show({ type: 'bad', header: 'Error', message: e.message });
                }
            }
        });
    }

    async onGenerateExpressions() {
        // Check if character has an avatar (required as base image)
        if (!this.character?.avatarUrl) {
            notifier.show({
                type: 'warn',
                header: 'Avatar Required',
                message: 'Please upload an avatar for this character first. The avatar will be used as the base image for generating expressions.'
            });
            return;
        }

        // Check SD WebUI availability
        notifier.show({ message: 'Checking Stable Diffusion availability...' });
        let sdHealth;
        try {
            sdHealth = await api.get('/api/tools/sd-health');
        } catch (e) {
            notifier.show({ type: 'bad', header: 'Connection Error', message: 'Could not check SD WebUI status.' });
            return;
        }

        if (!sdHealth.available) {
            notifier.show({
                type: 'bad',
                header: 'SD WebUI Not Available',
                message: sdHealth.error || 'Make sure Stable Diffusion WebUI is running with the ControlNet extension.'
            });
            return;
        }

        // Fetch default config from server
        let serverConfig;
        try {
            serverConfig = await api.get('/api/tools/expression-generator-config');
        } catch (e) {
            serverConfig = {
                steps: 20,
                cfgScale: 5.0,
                denoiseStrength: 0.7,
                defaultExpressions: {
                    happy: ['smiling', 'happy expression'],
                    sad: ['sad expression', 'downcast eyes'],
                    angry: ['angry expression', 'furrowed brow'],
                    surprised: ['surprised expression', 'wide eyes'],
                    neutral: ['neutral expression']
                }
            };
        }

        // Show configuration modal
        this.#showExpressionGeneratorModal(serverConfig);
    }

    #showExpressionGeneratorModal(serverConfig) {
        const content = document.createElement('div');
        content.className = 'expression-generator-modal';
        content.innerHTML = `
            <div class="expr-gen-section">
                <label>Base Appearance Tags</label>
                <p class="field-description">Tags that describe your character's base appearance (applies to all expressions). One tag per line or comma-separated.</p>
                <textarea id="expr-base-tags" class="form-group" rows="3" placeholder="e.g., 1girl, blonde hair, blue eyes, portrait"></textarea>
            </div>

            <div class="expr-gen-section">
                <label>Expressions to Generate</label>
                <p class="field-description">Define the expressions you want to generate. Each expression has a name and additional tags.</p>
                <div id="expr-variations-list"></div>
                <button type="button" id="add-expr-variation-btn" class="button-secondary button-sm">+ Add Expression</button>
            </div>

            <details class="expr-gen-advanced">
                <summary>Advanced Options</summary>
                <div class="advanced-options-grid">
                    <div class="form-group-inline">
                        <label for="expr-steps">Steps</label>
                        <input type="number" id="expr-steps" value="${serverConfig.steps}" min="1" max="150" class="form-group">
                    </div>
                    <div class="form-group-inline">
                        <label for="expr-cfg">CFG Scale</label>
                        <input type="number" id="expr-cfg" value="${serverConfig.cfgScale}" min="1" max="30" step="0.5" class="form-group">
                    </div>
                    <div class="form-group-inline">
                        <label for="expr-denoise">Denoise</label>
                        <input type="number" id="expr-denoise" value="${serverConfig.denoiseStrength}" min="0" max="1" step="0.05" class="form-group">
                    </div>
                </div>
            </details>

            <div id="expr-gen-progress" class="expr-gen-progress" style="display: none;">
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: 0%"></div>
                </div>
                <p class="progress-message">Preparing...</p>
            </div>
        `;

        // Add default expressions
        const variationsList = content.querySelector('#expr-variations-list');
        for (const [name, tags] of Object.entries(serverConfig.defaultExpressions || {})) {
            this.#addExpressionVariationRow(variationsList, name, tags.join(', '));
        }

        // Add expression button handler
        content.querySelector('#add-expr-variation-btn').addEventListener('click', () => {
            this.#addExpressionVariationRow(variationsList, '', '');
        });

        modal.show({
            title: 'Generate Expressions with AI',
            content,
            hideCloseButton: false,
            buttons: [
                {
                    label: 'Cancel',
                    className: 'button-secondary',
                    onClick: () => {
                        if (this._expressionGenInProgress) {
                            notifier.show({ type: 'warn', message: 'Generation in progress. Please wait for it to complete.' });
                            return;
                        }
                        modal.hide();
                    }
                },
                {
                    label: 'Generate',
                    className: 'button-primary',
                    onClick: () => this.#startExpressionGeneration(content)
                }
            ]
        });
    }

    #addExpressionVariationRow(container, name = '', tags = '') {
        const row = document.createElement('div');
        row.className = 'expr-variation-row';
        row.innerHTML = `
            <input type="text" class="expr-var-name form-group" placeholder="Name (e.g., happy)" value="${name}">
            <input type="text" class="expr-var-tags form-group" placeholder="Tags (e.g., smiling, bright eyes)" value="${tags}">
            <button type="button" class="remove-expr-var-btn icon-btn" title="Remove"><span class="material-icons">close</span></button>
        `;
        row.querySelector('.remove-expr-var-btn').addEventListener('click', () => row.remove());
        container.appendChild(row);
    }

    async #startExpressionGeneration(modalContent) {
        if (this._expressionGenInProgress) {
            notifier.show({ type: 'warn', message: 'Generation already in progress.' });
            return;
        }

        // Gather data from modal
        const baseTags = modalContent.querySelector('#expr-base-tags').value
            .split(/[,\n]/)
            .map(t => t.trim())
            .filter(Boolean);

        const variationRows = modalContent.querySelectorAll('.expr-variation-row');
        const expressionVariations = {};

        for (const row of variationRows) {
            const name = row.querySelector('.expr-var-name').value.trim();
            const tags = row.querySelector('.expr-var-tags').value
                .split(',')
                .map(t => t.trim())
                .filter(Boolean);

            if (name) {
                expressionVariations[name] = tags;
            }
        }

        if (Object.keys(expressionVariations).length === 0) {
            notifier.show({ type: 'warn', message: 'Please add at least one expression to generate.' });
            return;
        }

        // Get advanced options
        const steps = parseInt(modalContent.querySelector('#expr-steps').value) || 20;
        const cfgScale = parseFloat(modalContent.querySelector('#expr-cfg').value) || 5.0;
        const denoiseStrength = parseFloat(modalContent.querySelector('#expr-denoise').value) || 0.7;

        // Show progress UI
        const progressContainer = modalContent.querySelector('#expr-gen-progress');
        const progressBar = progressContainer.querySelector('.progress-bar');
        const progressMessage = progressContainer.querySelector('.progress-message');
        progressContainer.style.display = 'block';

        // Disable buttons while generating
        const generateBtn = modalContent.closest('.modal-content')?.querySelector('.button-primary');
        if (generateBtn) generateBtn.disabled = true;

        this._expressionGenInProgress = true;

        // Listen for SSE progress updates
        const progressHandler = (event) => {
            const data = event.detail;
            if (data.characterId !== this.character.id) return;

            const progress = Math.round((data.progress || 0) * 100);
            progressBar.style.width = `${progress}%`;
            progressMessage.textContent = data.message || `Generating... ${progress}%`;

            if (data.status === 'done' || data.status === 'error') {
                window.removeEventListener('expressionGenerationProgress', progressHandler);
            }
        };
        window.addEventListener('expressionGenerationProgress', progressHandler);

        try {
            // Fetch avatar as base64
            progressMessage.textContent = 'Loading avatar image...';
            const avatarUrl = this.character.avatarUrl.split('?')[0]; // Remove cache buster
            const avatarResponse = await fetch(avatarUrl);
            const avatarBlob = await avatarResponse.blob();
            const base64Avatar = await this.#blobToBase64(avatarBlob);

            progressMessage.textContent = 'Starting generation...';

            // Call the API
            const result = await api.post('/api/tools/generate-expressions', {
                characterId: this.character.id,
                baseImageData: base64Avatar,
                baseAppearanceTags: baseTags,
                expressionVariations,
                sdConfig: {
                    steps,
                    cfgScale,
                    denoiseStrength
                }
            });

            // Count successes and failures
            const results = Object.values(result.generatedImages || {});
            const successes = results.filter(r => r.success).length;
            const failures = results.filter(r => !r.success).length;

            if (successes > 0) {
                notifier.show({
                    type: 'good',
                    header: 'Generation Complete',
                    message: `Generated ${successes} expression(s)${failures > 0 ? `, ${failures} failed` : ''}.`
                });
            } else {
                notifier.show({
                    type: 'bad',
                    header: 'Generation Failed',
                    message: 'All expressions failed to generate. Check if SD WebUI is running correctly.'
                });
            }

            modal.hide();

        } catch (error) {
            console.error('Expression generation error:', error);
            notifier.show({
                type: 'bad',
                header: 'Generation Failed',
                message: error.message
            });
            progressMessage.textContent = `Error: ${error.message}`;
        } finally {
            this._expressionGenInProgress = false;
            window.removeEventListener('expressionGenerationProgress', progressHandler);
            if (generateBtn) generateBtn.disabled = false;
        }
    }

    #blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async onAddGalleryImage() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.onchange = async () => {
            const file = fileInput.files[0];
            if (!file) return;

            const content = document.createElement('div');
            content.innerHTML = `<p class="field-description">Provide a short, descriptive text for this image.</p>`;
            const altInput = document.createElement('input');
            altInput.type = 'text';
            altInput.className = 'form-group';
            altInput.placeholder = 'e.g., A portrait of the character smiling.';
            content.appendChild(altInput);

            modal.show({
                title: 'Add Image to Gallery',
                content,
                buttons: [
                    { label: 'Cancel', className: 'button-secondary', onClick: () => modal.hide() },
                    { 
                        label: 'Upload', 
                        className: 'button-primary',
                        onClick: async () => {
                            const formData = new FormData();
                            formData.append('image', file);
                            formData.append('alt', altInput.value);
                            modal.hide();
                            notifier.show({ header: 'Uploading...', message: `Adding ${file.name} to gallery.` });
                            try {
                                await api.post(`/api/characters/${this.character.id}/gallery`, formData);
                                notifier.show({ type: 'good', message: 'Image added to gallery.' });
                            } catch (e) {
                                notifier.show({ type: 'bad', header: 'Upload Failed', message: e.message });
                            }
                        }
                    }
                ]
            });
            setTimeout(() => altInput.focus(), 100);
        };
        fileInput.click();
    }
    
    async onAltTextChange(filename, newAlt) {
        try {
            await api.put(`/api/characters/${this.character.id}/gallery/${filename}`, { alt: newAlt });
            notifier.show({ message: 'Alt text updated.' });
        } catch(e) {
            notifier.show({ type: 'bad', header: 'Error', message: 'Could not update alt text.' });
        }
    }
    
    onDeleteGalleryImage(filename) {
        modal.confirm({
            title: 'Delete Image',
            content: 'Are you sure you want to delete this image from the gallery?',
            confirmLabel: 'Delete',
            confirmButtonClass: 'button-danger',
            onConfirm: async () => {
                try {
                    await api.delete(`/api/characters/${this.character.id}/gallery/${filename}`);
                    notifier.show({ message: 'Image deleted.' });
                } catch (e) {
                    notifier.show({ type: 'bad', header: 'Error', message: e.message });
                }
            }
        });
    }
    
    #updateView() {
        const formWrapper = this.shadowRoot.querySelector('.form-wrapper');
        const placeholder = this.shadowRoot.querySelector('.placeholder');
        const bgContainer = this.shadowRoot.querySelector('.background-avatar-container');
        if (!formWrapper || !placeholder || !bgContainer) return;

        if (!this._character) {
            formWrapper.style.display = 'none';
            placeholder.style.display = 'flex';
            bgContainer.style.opacity = '0';
        } else {
            placeholder.style.display = 'none';
            formWrapper.style.display = 'block';
            
            if (this._character.avatarUrl) {
                const cleanUrl = this._character.avatarUrl.split('?')[0]; 
                bgContainer.style.backgroundImage = `url(${cleanUrl})`;
                bgContainer.style.opacity = '0.15';
            } else {
                bgContainer.style.backgroundImage = 'none';
                bgContainer.style.opacity = '0';
            }

            this.shadowRoot.querySelector('.avatar-preview').src = this._character.avatarUrl || 'assets/images/default_avatar.svg';
            this.shadowRoot.querySelector('#character-name-input').value = this._character.name || '';
            this.shadowRoot.querySelector('#character-id-input').value = this._character.id || '';
            this.shadowRoot.querySelector('#character-description').value = this._character.description || '';
            this.shadowRoot.querySelector('#replace-char-id').textContent = this._character.id || 'id';

            this.#renderTags();
            this.#renderExpressions();
            this.#renderGallery();
        }
    }

    #renderExpressions() {
        const grid = this.shadowRoot.querySelector('#expressions-grid');
        if (!grid || !this.character?.expressions) return;

        if (this.character.expressions.length === 0) {
            grid.innerHTML = '<p class="field-description">No expressions defined.</p>';
            return;
        }

        grid.innerHTML = `
            <div class="expression-grid-header">
                <div class="expression-header-preview">Preview</div>
                <div class="expression-header-name">Name (key)</div>
                <div class="expression-header-actions">Actions</div>
            </div>
            ${this.character.expressions.map(item => `
                <div class="expression-item" data-filename="${item.src}">
                    <img src="${item.url}" alt="${item.name}" class="expression-item-preview">
                    <input type="text" class="expression-name-input form-group" value="${item.name || ''}" placeholder="Name this expression...">
                    <button type="button" class="delete-expression-item-btn icon-btn" title="Delete Expression"><span class="material-icons">delete</span></button>
                </div>
            `).join('')}
        `;
    }

    #renderGallery() {
        const galleryGrid = this.shadowRoot.querySelector('#gallery-grid');
        if (!galleryGrid || !this.character?.gallery) return;

        if (this.character.gallery.length === 0) {
            galleryGrid.innerHTML = '<p class="field-description">No images in gallery.</p>';
            return;
        }

        galleryGrid.innerHTML = `
            <div class="gallery-grid-header">
                <div class="gallery-header-preview">Preview</div>
                <div class="gallery-header-alt">Alt Text (description)</div>
                <div class="gallery-header-actions">Actions</div>
            </div>
            ${this.character.gallery.map(item => `
                <div class="gallery-item" data-filename="${item.src}">
                    <img src="${item.url}" alt="${item.alt}" class="gallery-item-preview">
                    <input type="text" class="alt-text-input form-group" value="${item.alt || ''}" placeholder="Describe the image...">
                    <button type="button" class="delete-gallery-item-btn icon-btn" title="Delete Image"><span class="material-icons">delete</span></button>
                </div>
            `).join('')}
        `;
    }

    render() {
        const template = `
            <div class="background-avatar-container"></div>
            <div class="view-container">
                <div class="placeholder">
                    <h2>Select a character to begin editing.</h2>
                </div>
                <div class="form-wrapper">
                    <form>
                        <div class="editor-header">
                            <label for="character-avatar-upload" class="avatar-label" title="Upload new avatar">
                                 <img class="avatar-preview" src="assets/images/default_avatar.svg" alt="Character Avatar">
                                 <div class="avatar-overlay"><span class="material-icons">upload</span></div>
                            </label>
                            <input type="file" id="character-avatar-upload" hidden accept="image/*">
                            <div class="editor-header-main">
                                <input type="text" id="character-name-input" class="editor-title" placeholder="Character Name">
                                <div class="form-group-inline">
                                    <label for="character-id-input">ID</label>
                                    <input type="text" id="character-id-input" placeholder="e.g., john_doe" class="id-input">
                                </div>
                            </div>
                        </div>

                        <div class="form-group">
                            <div class="label-row">
                                <label for="character-description">Description</label>
                                <button type="button" id="generate-btn" class="icon-button" title="Generate with AI"><span class="material-icons">auto_awesome</span></button>
                            </div>
                            <p class="field-description">The main prompt for the character. You can use macros like {{player.name}}.</p>
                            <text-box id="character-description" name="description"></text-box>
                        </div>

                        <div class="form-group">
                            <label>Tags</label>
                            <p class="field-description">Add tags to organize and filter characters. Press Enter or comma to add a tag.</p>
                            <div class="tags-input-container" id="character-tags-container">
                                <input type="text" class="tag-input" id="character-tags-input" placeholder="Add tag...">
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Expressions</label>
                            <p class="field-description">Named images for expressions. Can be referenced by name in chat modes, or included in prompts with {{<span id="replace-char-id">&lt;id&gt;</span>.expressions}}.</p>
                            <div id="expressions-grid"></div>
                            <div class="expression-buttons">
                                <button type="button" id="add-expression-btn" class="button-secondary">Add Expression</button>
                                <button type="button" id="generate-expressions-btn" class="button-secondary" title="Generate expressions using Stable Diffusion"><span class="material-icons">auto_awesome</span> Generate with AI</button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>Gallery</label>
                            <p class="field-description">Additional images for this character. Can be referenced in prompts with the {{<span id="replace-char-id">&lt;id&gt;</span>.images}} macro.</p>
                            <div id="gallery-grid"></div>
                            <button type="button" id="add-gallery-image-btn" class="button-secondary">Add Image</button>
                        </div>

                        <button type="submit" class="button-primary">Save Changes</button>
                    </form>
                </div>
            </div>
        `;
        super._initShadow(template, this.styles());
    }

    styles() {
        return `
            :host {
                display: block;
                height: 100%;
                position: relative;
                overflow: hidden;
            }
            .background-avatar-container {
                position: absolute;
                inset: -20px;
                background-size: cover;
                background-position: center top;
                filter: blur(16px) brightness(0.6);
                opacity: 0;
                transition: opacity 0.5s ease-in-out;
                mask-image: linear-gradient(to bottom, black 20%, transparent 85%);
                -webkit-mask-image: linear-gradient(to bottom, black 20%, transparent 85%);
            }
            .view-container {
                position: relative;
                z-index: 1;
                height: 100%;
                overflow-y: auto;
            }
            .placeholder {
                text-align: center;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .form-wrapper {
                display: none;
            }
            .editor-header {
                display: flex;
                align-items: flex-start;
                gap: var(--spacing-lg);
                margin-bottom: var(--spacing-lg);
            }
            .editor-header-main {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: var(--spacing-sm);
            }
            .editor-title {
                font-size: 1.5rem;
                font-weight: 600;
                background: none;
                border: none;
                outline: none;
                flex-grow: 1;
                color: var(--text-primary);
                padding: var(--spacing-xs);
                margin: -4px; /* Counteract padding */
                border-radius: var(--radius-sm);
            }
            .editor-title:focus {
                background-color: var(--bg-0);
                box-shadow: 0 0 0 2px var(--accent-primary-faded);
            }

            .form-group-inline {
                display: flex;
                align-items: center;
                gap: var(--spacing-sm);
                font-size: var(--font-size-sm);
            }
            .form-group-inline label {
                margin: 0;
                font-weight: 500;
                color: var(--text-secondary);
            }
            .id-input {
                background: none;
                border: 1px solid transparent;
                border-radius: var(--radius-sm);
                color: var(--text-secondary);
                padding: var(--spacing-xs);
                font-family: monospace;
                font-size: 0.9em;
            }
            .id-input:focus {
                background: var(--bg-0);
                border-color: var(--bg-3);
                color: var(--text-primary);
            }

            .avatar-label {
                position: relative;
                cursor: pointer;
                flex-shrink: 0;
            }
            .avatar-preview {
                width: 100px;
                height: 100px;
                border-radius: var(--radius-md);
                object-fit: cover;
                background-color: var(--bg-1);
                border: 2px solid var(--bg-3);
                transition: border-color var(--transition-fast);
            }
            .avatar-label:hover .avatar-preview {
                border-color: var(--accent-primary);
            }
            .avatar-overlay {
                position: absolute;
                inset: 0;
                background-color: rgba(0,0,0,0.5);
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity var(--transition-fast);
                border-radius: var(--radius-md);
            }
            .avatar-label:hover .avatar-overlay {
                opacity: 1;
            }
            
            #character-description {
                min-height: 250px;
                resize: vertical;
                padding: 0.75rem;
                background-color: var(--bg-1);
                border: 1px solid var(--bg-3);
                border-radius: var(--radius-sm);
                color: var(--text-primary);
                font-size: var(--font-size-md);
            }
            #character-description:focus-within {
                outline: none;
                border-color: var(--accent-primary);
                box-shadow: 0 0 0 2px var(--accent-primary-faded, rgba(138, 180, 248, 0.3));
                transition: var(--transition-fast);
            }
            
            #add-gallery-image-btn {
                margin-top: var(--spacing-md);
                width: 100%;
            }

            .expression-buttons {
                display: flex;
                gap: var(--spacing-sm);
                margin-top: var(--spacing-md);
            }
            .expression-buttons button {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: var(--spacing-xs);
            }
            .expression-buttons .material-icons {
                font-size: 1.2em;
            }

            #expressions-grid, #gallery-grid {
                display: flex;
                flex-direction: column;
                gap: var(--spacing-xs);
                margin-top: var(--spacing-sm);
            }
            .expression-grid-header, .expression-item,
            .gallery-grid-header, .gallery-item {
                display: grid;
                grid-template-columns: 80px 1fr 40px;
                gap: var(--spacing-md);
                align-items: center;
                padding: var(--spacing-xs);
            }
            .expression-grid-header, .gallery-grid-header {
                font-weight: 500;
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                border-bottom: 1px solid var(--bg-3);
                padding-bottom: var(--spacing-sm);
            }
            .expression-header-actions, .gallery-header-actions { text-align: center; }

            .expression-item-preview, .gallery-item-preview {
                width: 80px;
                height: 80px;
                object-fit: cover;
                border-radius: var(--radius-sm);
                background-color: var(--bg-0);
                cursor: pointer; /* Indicate it's clickable */
            }
            
            .expression-name-input, .alt-text-input { width: 100%; margin: 0; }

            .delete-expression-item-btn, .delete-gallery-item-btn { 
                padding: var(--spacing-xs);
                color: var(--text-secondary);
                background: none;
                border: none;
                cursor: pointer;
            }
            .delete-expression-item-btn:hover, .delete-gallery-item-btn:hover { color: var(--accent-danger); }

            .field-description {
                font-size: var(--font-size-sm);
                color: var(--text-secondary);
                margin-top: var(--spacing-xs);
                margin-bottom: var(--spacing-xs);
            }

            .label-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .spinning {
                animation: spin 1s linear infinite;
            }
        `;
    }
}

customElements.define('minerva-character-editor', CharacterEditor);