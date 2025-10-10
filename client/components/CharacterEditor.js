import { BaseComponent } from './BaseComponent.js';
import { api, modal, notifier, imagePreview } from '../../client.js';

class CharacterEditor extends BaseComponent {
    constructor() {
        super();
        this._character = null;
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
        this.#updateView();
    }

    handleFormClick(event) {
        // Expression handlers
        const addExprBtn = event.target.closest('#add-expression-btn');
        if (addExprBtn) {
            this.onAddExpression();
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

    onSave(event) {
        event.preventDefault();
        const updatedCharacter = {
            ...this.character,
            id: this.shadowRoot.querySelector('#character-id-input').value.trim(),
            name: this.shadowRoot.querySelector('#character-name-input').value,
            description: this.shadowRoot.querySelector('#character-description').value,
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
                            <label for="character-description">Description</label>
                            <p class="field-description">The main prompt for the character. You can use macros like {{player.name}}.</p>
                            <text-box id="character-description" name="description"></text-box>
                        </div>

                        <div class="form-group">
                            <label>Expressions</label>
                            <p class="field-description">Named images for expressions. Can be referenced by name in chat modes, or included in prompts with {{<span id="replace-char-id">&lt;id&gt;</span>.expressions}}.</p>
                            <div id="expressions-grid"></div>
                            <button type="button" id="add-expression-btn" class="button-secondary">Add Expression</button>
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
            
            #add-gallery-image-btn, #add-expression-btn {
                margin-top: var(--spacing-md);
                width: 100%;
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
        `;
    }
}

customElements.define('minerva-character-editor', CharacterEditor);