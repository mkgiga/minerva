// server/migrations.js
import fs from 'fs/promises';
import { glob } from 'glob';
import path from 'path';
import { pathToFileURL } from 'url';

// The revision number of the application's current data structure.
// Increment this every time you make a breaking change to a data format.
export const CURRENT_REV = 1;

// The path to the file that stores the current version of the user's data directory.
const VERSION_FILE_PATH = 'data/version.json';
// The directory where migration scripts are stored.
const MIGRATIONS_DIR = 'migrations';

/**
 * Gets the current revision of the data directory from the version file.
 * @returns {Promise<number>} The current revision number, or 0 if no version file exists.
 */
async function getDataVersion() {
    try {
        const content = await fs.readFile(VERSION_FILE_PATH, 'utf-8');
        const json = JSON.parse(content);
        return json.revision || 0;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return 0; // No version file means it's pre-migration system.
        }
        throw error;
    }
}

/**
 * Updates the version file with the new revision number.
 * @param {number} revision - The new revision number to save.
 */
async function setDataVersion(revision) {
    await fs.writeFile(VERSION_FILE_PATH, JSON.stringify({ revision }, null, 2));
}

/**
 * Loads a migration module dynamically.
 * @param {number} revision - The revision number of the migration script to load.
 * @returns {Promise<object>} The loaded migration module.
 */
async function loadMigration(revision) {
    try {
        // Create an absolute path to the migration script.
        const migrationPath = path.join(process.cwd(), MIGRATIONS_DIR, `${revision}.js`);
        // Convert the file path to a file URL, which is required by the ESM import() statement on Windows.
        const migrationUrl = pathToFileURL(migrationPath);
        return await import(migrationUrl.href);
    } catch (error) {
        console.error(`Error loading migration script for revision ${revision}:`, error);
        throw new Error(`Migration script for revision ${revision} not found or contains an error.`);
    }
}

/**
 * Runs all necessary migrations on the data directory at startup.
 * It compares the data version to the application's current revision and applies
 * migrations sequentially.
 * @param {object} paths - An object containing paths to data directories.
 */
export async function runMigrations(paths) {
    console.log('Checking for necessary data migrations...');
    const currentDataVersion = await getDataVersion();
    console.log(`Current data revision: ${currentDataVersion}, Application revision: ${CURRENT_REV}`);

    if (currentDataVersion >= CURRENT_REV) {
        console.log('Data is up to date. No migrations needed.');
        return;
    }

    for (let v = currentDataVersion + 1; v <= CURRENT_REV; v++) {
        console.log(`Applying migration for revision ${v}...`);
        try {
            const migration = await loadMigration(v);
            if (typeof migration.up !== 'function') {
                throw new Error(`Migration ${v} is invalid: missing 'up' export.`);
            }
            await migration.up(paths, { glob, fs, path });
            await setDataVersion(v);
            console.log(`Successfully applied migration for revision ${v}.`);
        } catch (error) {
            console.error(`\x1b[31;1mFATAL: Migration for revision ${v} failed. The server will not start.\x1b[0m`);
            console.error(error);
            process.exit(1);
        }
    }
    console.log('All migrations applied successfully.');
}

/**
 * Migrates a single, in-memory data object to the current application revision.
 * This is used for handling imported files that may be of an older format.
 * @param {object} data - The data object to migrate (e.g., from an imported character file).
 * @param {string} type - The type of data ('character', 'chat', etc.).
 * @returns {Promise<object>} The migrated data object.
 */
export async function migrateData(data, type) {
    // If the data has no revision, assume it's pre-migration (revision 0).
    const dataRev = data._rev || 0;

    if (dataRev >= CURRENT_REV) {
        return data; // Already up to date.
    }

    let migratedData = data;
    for (let v = dataRev + 1; v <= CURRENT_REV; v++) {
        const migration = await loadMigration(v);
        if (migration.transform && typeof migration.transform[type] === 'function') {
            migratedData = migration.transform[type](migratedData);
        }
    }
    return migratedData;
}