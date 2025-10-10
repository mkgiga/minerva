# Minerva

Minerva is a web-based graphical user interface (GUI) designed for interacting with Large Language Models (LLMs) inspired by projects like SillyTavern, with a special focus on roleplaying, storytelling, and other forms of creative writing. It provides a clean, user-friendly, and mobile-ready interface to create characters and engage with them in dynamic, multi-participant conversations.

---

![Minerva Screenshot](https://repository-images.githubusercontent.com/1024930548/3aa72e78-a0d5-4aee-9a0e-9add4fc418db)

---

## Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [How to Use Minerva](#how-to-use-minerva)
  - [1. Set Up an API Connection](#1-set-up-an-api-connection)
  - [2. Create Characters](#2-create-characters)
  - [3. Start a Chat](#3-start-a-chat)
- [For Developers](#for-developers)
  - [Project Structure](#project-structure)
  - [Backend Overview](#backend-overview)
  - [Frontend Overview](#frontend-overview)
  - [Creating a Custom Chat Mode](#creating-a-custom-chat-mode)
  - [Adding a New API Provider](#adding-a-new-api-provider)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)


## Features

-   **User-friendly**: A clean, intuitive, and responsive interface that works great on both desktop and mobile devices. No clutter, just your story.
-   **Save your prompts**: Create and manage a library of reusable text snippets (Strings). Use them to build complex prompts, define character personalities, or set up system instructions without repeating yourself.
-   **Multi-character chats**: Add any number of characters to a conversation. The AI is made aware of all participants through powerful macros like `{{characters}}`, allowing for dynamic group interactions.
-   **Note/Lorebooks**: Define Notes to inject consistent world-building, plot points, or contextual information into your chats. Notes can even have character-specific overrides, tailoring the context for each participant.
-   **Extendable chat interface**: Swap out the entire chat UI with custom 'Chat Modes'. Minerva comes with a standard text mode and a story-focused 'Adventure' mode, but developers can create entirely new experiences (e.g., a game-like RPG interface).
-   **No telemetry**: Your data is your own. All character data, chats, and configurations are saved locally to your machine. Minerva never sends data to third parties, except for the LLM API you configure.

## Getting Started

Follow these steps to get Minerva up and running on your computer.

### Prerequisites

-   **Node.js**: Minerva requires Node.js to run. You can download the recommended LTS version from [nodejs.org](https://nodejs.org/en/download/).

### Installation

1.  Download the project files, either by clicking "Code" -> "Download ZIP" or by using Git:
    ```bash
    git clone https://github.com/Codelord-Jack/Minerva.git
    cd Minerva
    ```

2.  Install the required Node.js packages by running the following command in the project directory:
    ```bash
    npm install
    ```
    
3.  Launch the server.
    -   **On Windows**: Simply double-click the `run.bat` file.
    -   **On macOS/Linux**: Run the following command in your terminal:
        ```bash
        npm start
        ```

4.  Open your web browser and go to the following address: **http://localhost:8077**.

## How to Use Minerva

Here is a quick guide to the core workflow. The interface is navigated using the sidebar buttons on the left (or bottom on mobile).

### 1. Set Up an API Connection
Navigate to **Connection Settings** (wifi icon). Create a new configuration, select the correct provider for your service (e.g., 'OpenAI-compatible' for LM Studio, Oobabooga, etc.), and enter your API URL and key if required. Click the radio button to make it the active connection.

### 2. Create Characters
Navigate to **Characters** (people icon). Click the '+' button to create a new character. Fill in their name, description, and upload an avatar. To set a character as your own persona in chats, click the user icon next to their name in the list.

### 3. Start a Chat
Navigate to **Chat** (chat icon). Create a new chat, which will appear in the left-hand list. Select it, and use the right-hand panel (or the 'people' icon on mobile) to add your previously created characters as participants. Now you're ready to start writing!

## For Developers

Minerva is built with a modular and extensible architecture. Contributions are welcome!

### Project Structure

-   `📁 client/`: Contains all frontend assets.
    -   `📁 components/`: Reusable Web Components that make up the UI.
    -   `client.js`: The main entry point for the frontend application.
-   `📁 server/`: Contains all backend Node.js server logic.
    -   `📁 providers/`: Home to the LLM provider classes (`base.js`, `v1.js`, `gemini.js`).
    -   `server.js`: The main Express server file that defines API endpoints and manages state.
-   `📁 data/`: The default directory where all user-created data (characters, chats, configs) is stored. This directory is created on first run.
-   `📄 config.yaml`: The main configuration file for the server.

### Backend Overview

The backend is a Node.js server using Express. It serves the static frontend files and provides a RESTful API for all data operations. It uses a Server-Sent Events (SSE) endpoint (`/api/events`) to push real-time updates to the client, ensuring the UI always reflects the current state of the data on disk.

Provider-specific logic is abstracted into **Provider** classes located in `server/providers`. Each provider extends `BaseProvider` and implements the logic required to communicate with a specific LLM API.

### Frontend Overview

The frontend is built with modern, framework-free JavaScript (ES6+) and uses the native **Web Components API** for creating a modular, reusable component library. This approach avoids large framework dependencies and encourages performant, targeted DOM updates instead of re-rendering entire views.

-   All custom elements extend `BaseComponent` (`client/components/BaseComponent.js`) for common boilerplate reduction.
-   Communication with the backend is handled via the `api` helper in `client/client.js`.
-   Global services for notifications and modals are also available in `client.js`.

### Creating a Custom Chat Mode

A key feature of Minerva is the ability to create new chat experiences.

1.  **Create the Component**: Create a new file in `client/components/views/modes/`, for example, `MyCoolMode.js`.
2.  **Extend BaseChatMode**: Your class must extend `BaseChatMode`.
    ```javascript
    import { BaseChatMode } from './BaseChatMode.js';
    export class MyCoolMode extends BaseChatMode {
        // ... implementation ...
    }
    ```
3.  **Implement Abstract Methods**: You must implement the abstract methods from `BaseChatMode`, such as `onInitialize()`, `onToken()`, `onStreamFinish()`, `getUserInput()`, `clearUserInput()`, and `updateInputState()`. These methods define how your mode renders messages and handles user input.
4.  **Define and Register**: At the end of your file, define the custom element and register it with the `ChatModeRegistry`.
    ```javascript
    import { chatModeRegistry } from '../../../ChatModeRegistry.js';
    // ...
    customElements.define('my-cool-mode', MyCoolMode);
    chatModeRegistry.register('my-cool-mode-key', 'my-cool-mode');
    ```
5.  **Import**: Finally, import your new mode file in `client/components/views/modes/index.js` so it's loaded by the application.
6.  **Settings (Optional)**: If your mode has user-configurable settings, implement the static `getSettingsSchema()` and `getDefaultSettings()` methods. The `UserPreferencesView` will automatically create a form for them.

### Adding a New API Provider

To add support for a new LLM backend:

1.  **Create Provider Class**: Create a new file in `server/providers/`, for example `newprovider.js`.
2.  **Extend BaseProvider**: Your class must extend `BaseProvider`.
    ```javascript
    import { BaseProvider } from './base.js';
    export class NewProviderProvider extends BaseProvider {
        // ... implementation ...
    }
    ```
3.  **Implement Methods**: Implement the required methods:
    -   `async *prompt()`: The core method for sending a prompt and yielding response tokens.
    -   `async healthCheck()`: A method to test the connection to the provider.
    -   `prepareMessages()`: A method to transform the standard message format into the provider-specific format.
4.  **Define Schemas**: Implement the static methods `getProviderSchema()` and `getGenerationParametersSchema()` to define the fields that will appear on the frontend for connection and generation settings.
5.  **Register Provider**: In `server.js`, import your new provider and add it to the `ADAPTERS` map.
    ```javascript
    import { NewProviderProvider } from './server/providers/newprovider.js';
    // ...
    const ADAPTERS = {
        v1: OpenAIV1Provider,
        gemini: GoogleGeminiProvider,
        newprovider: NewProviderProvider // Add your new provider here
    };
    ```

## Configuration

The server can be configured by editing the `config.yaml` file in the root directory.

-   **`server.host`**: The IP address for the server to listen on. `0.0.0.0` makes it accessible on your local network.
-   **`server.port`**: The port for the server to run on. Defaults to `8077`.
-   **`data.static_dir`**: The path to the frontend client files. Defaults to `client`.
-   **`data.data_dir`**: The path where user data is stored. Defaults to `data`.
-   **`server.cors`**: Advanced settings for Cross-Origin Resource Sharing, useful if you intend to access the Minerva API from a different web application.

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/Codelord-Jack/Minerva/issues).

## License

This project is licensed under the [MIT License](LICENSE).
