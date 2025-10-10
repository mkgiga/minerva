/**
 * In order to make an extension for the frontend, add a folder with its name in the `client/extensions` directory.
 * In your new folder, create a `extension.json` file with the same structure as the default extension object shown below.
 * 
 */

const defaultManifest = {
    id: "example-extension", // required, must be unique. this is used by minerva when loading and storing the extension into a global registry
    title: "Minerva Extension", // required, must be unique
    description: "A sample extension for Minerva.", // optional, defaults to ""
    version: "1.0.0", // optional, defaults to "0.1.0"
    author: "Your Name", // optional, defaults to "Unknown"
    license: "MIT", // optional
    main: "index.js", // optional, defaults to "index.js". Must be a valid JavaScript file in the extension directory.
    tags: ["example", "extension", "tutorial"],
    
}