// client/components/views/modes/index.js

// This file serves as an entry point for all chat mode components.
// Importing it ensures that all modes are defined and registered.

import './DefaultChatMode.js';
import './AdventureChatMode.js';

// To add a new chat mode:
// 1. Create your component file (e.g., NewChatMode.js) that extends BaseChatMode.
// 2. In your file, call customElements.define(...) and chatModeRegistry.register(...).
// 3. Add an import for your new file here: `import './NewChatMode.js';`