# --- TEMP OVERRIDE ---

Because this application has no users yet, no migrations are necessary. Skip the migration process.

# --- END TEMP OVERRIDE ---

## How to Handle Data Format Changes (Migrations)

This project uses a file-based migration system to handle breaking changes in the structure of user data (like characters, chats, and configurations). This ensures that users who update the application after a long time won't have their data corrupted.

The system is powered by migration scripts located in the `/migrations` directory.

### Core Concepts

*   **Revision Number (`_rev`)**: All major data files (`character.json`, `chat.json`, etc.) must have a `_rev` property indicating the data structure version they conform to.
*   **Current Revision (`CURRENT_REV`)**: A constant in `server/migrations.js` that defines the latest revision number the application code expects.
*   **Migration Scripts**: Numbered JavaScript files in `/migrations` (e.g., `1.js`, `2.js`) that contain the logic to upgrade data from one revision to the next.

### When to Create a Migration

You need to create a new migration whenever you make a change to a data file's structure that is not backward-compatible. Examples include:

*   Adding a new, required property to a character.
*   Renaming a property.
*   Changing the data type of a property (e.g., from a string to an object).
*   Restructuring data within the file.

### How to Make a Breaking Change: Step-by-Step

Let's say we want to add a `greeting` field to all character files.

#### Step 1: Increment `CURRENT_REV`

Open `server/migrations.js` and increment the `CURRENT_REV` constant.

```javascript
// server/migrations.js
export const CURRENT_REV = 2; // Was 1, now it's 2
```

#### Step 2: Create a New Migration File

In the `/migrations` directory, create a new file named `2.js` (matching the new `CURRENT_REV`).

#### Step 3: Implement the Migration Logic

Your new migration file needs to export two main things: an `up` function and a `transform` object.

*   `up()`: This function runs at server startup and migrates all existing files on disk from the previous revision to this new one. 
*   `transform`: This object contains functions to migrate a single in-memory data object. This is crucial for correctly handling old files that a user might import.

Here is a template for `migrations/2.js`:

```javascript
// migrations/2.js

/**
 * up: Migrates existing files on disk.
 * @param {object} paths - Object containing directory paths (e.g., CHARACTERS_DIR).
 * @param {object} utils - Utility functions (fs, glob, path).
 */
export async function up(paths, utils) {
    console.log("  [2] Your migration description here.");
    const { fs, glob, path } = utils;

    // Example: Migrating all character.json files
    const charFiles = await glob(path.join(paths.CHARACTERS_DIR, '*', 'character.json').replace(/\\/g, '/'));

    for (const file of charFiles) {
        try {
            const content = await fs.readFile(file, 'utf-8');
            const data = JSON.parse(content);

            // YOUR MIGRATION LOGIC FOR THE FILE GOES HERE
            // Example: Rename 'greeting' to 'first_message'
            if ('greeting' in data) {
                data.first_message = data.greeting;
                delete data.greeting;
            }
            
            // Update the revision number
            data._rev = 2;
            
            await fs.writeFile(file, JSON.stringify(data, null, 2));

        } catch (error) {
            console.warn(`    - Could not process file ${file}: ${error.message}`);
        }
    }
    console.log("  [2] Migration complete.");
}


/**
 * transform: Migrates in-memory data objects (for imports).
 */
export const transform = {
    /**
     * @param {object} data - A character data object from the previous revision (1).
     * @returns {object} The migrated character data object for revision 2.
     */
    character: (data) => {
        // YOUR MIGRATION LOGIC FOR AN IN-MEMORY OBJECT GOES HERE
        // Example: Rename 'greeting' to 'first_message'
        if ('greeting' in data) {
            data.first_message = data.greeting;
            delete data.greeting;
        }

        // Update the revision number
        data._rev = 2;
        return data;
    },
    
    // Add other resource types if they also changed in this revision
    // chat: (data) => { ... },
};
```

#### Step 4: Update the Server-Side Data Model

Finally, update the corresponding data class in `server.js` to reflect the new structure. This ensures that any *new* objects created by the application will already be in the correct, latest format.

```javascript
// server.js -> Character class

class Character {
    // ... other properties
    first_message = ''; // New field
    _rev = CURRENT_REV; // This should always point to the latest revision

    constructor(data = {}) {
        // Update default values here
        Object.assign(this, {
            // ...
            first_message: '',
            _rev: CURRENT_REV
        }, data);
    }
    
    toSaveObject() {
        return {
            _rev: this._rev,
            // ...
            first_message: this.first_message,
        };
    }
}
```

By following these steps, you ensure that both existing user data and newly created/imported data are handled correctly, preventing data corruption and making the application much more robust.