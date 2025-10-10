// migrations/1.js

/**
 * up: This function is run at startup to migrate existing files on disk.
 * @param {object} paths - Object containing directory paths (e.g., CHARACTERS_DIR).
 * @param {object} utils - Utility functions (fs, glob, path).
 */
export async function up(paths, utils) {
    console.log("  [1] Stamping all data files with revision number 1.");
    const { fs, glob, path } = utils;

    // A list of all directories containing user data JSON files.
    const dataDirs = [
        paths.CHARACTERS_DIR,
        paths.CHATS_DIR,
        paths.CONNECTION_CONFIGS_DIR,
        paths.GENERATION_CONFIGS_DIR,
        paths.REUSABLE_STRINGS_DIR,
    ];

    for (const dir of dataDirs) {
        // For characters, the JSON is one level deeper inside the character's own folder.
        const pattern = dir === paths.CHARACTERS_DIR
            ? path.join(dir, '*', 'character.json').replace(/\\/g, '/')
            : path.join(dir, '*.json').replace(/\\/g, '/');
            
        const files = await glob(pattern);

        for (const file of files) {
            try {
                const content = await fs.readFile(file, 'utf-8');
                const data = JSON.parse(content);

                // Add revision number to the file.
                data._rev = 1;
                
                await fs.writeFile(file, JSON.stringify(data, null, 2));

            } catch (error) {
                // Log a warning but continue with other files.
                console.warn(`    - Could not process file ${file}: ${error.message}`);
            }
        }
    }
    console.log("  [1] Migration complete.");
}


/**
 * transform: This function is used to migrate in-memory data objects,
 *            typically when a user imports an old file.
 */
export const transform = {
    /**
     * @param {object} data - A character data object.
     * @returns {object} The migrated character data object.
     */
    character: (data) => {
        data._rev = 1;
        return data;
    },
    chat: (data) => {
        data._rev = 1;
        return data;
    },
    connection_config: (data) => {
        data._rev = 1;
        return data;
    },
    generation_config: (data) => {
        data._rev = 1;
        return data;
    },
    reusable_string: (data) => {
        data._rev = 1;
        return data;
    },
};