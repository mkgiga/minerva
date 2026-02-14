/**
 * Temporary cleanup script to remove duplicate "New Note" and "New Character" entries.
 * Run with: node cleanup-duplicates.js
 *
 * This script will:
 * 1. Find all notes with name "New Note" and delete them
 * 2. Find all characters with name "New Character" and delete their folders
 */

import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = './data';
const NOTES_DIR = path.join(DATA_DIR, 'notes');
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');

async function cleanupNotes() {
    console.log('\n--- Cleaning up "New Note" entries ---');

    try {
        const files = await fs.readdir(NOTES_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        let deletedCount = 0;
        for (const file of jsonFiles) {
            const filePath = path.join(NOTES_DIR, file);
            try {
                const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                if (content.name === 'New Note') {
                    await fs.unlink(filePath);
                    console.log(`  Deleted: ${file}`);
                    deletedCount++;
                }
            } catch (e) {
                console.error(`  Error processing ${file}:`, e.message);
            }
        }

        console.log(`  Total notes deleted: ${deletedCount}`);
    } catch (e) {
        if (e.code === 'ENOENT') {
            console.log('  Notes directory does not exist, skipping.');
        } else {
            throw e;
        }
    }
}

async function cleanupCharacters() {
    console.log('\n--- Cleaning up "New Character" entries ---');

    try {
        const dirs = await fs.readdir(CHARACTERS_DIR, { withFileTypes: true });
        const charDirs = dirs.filter(d => d.isDirectory());

        let deletedCount = 0;
        for (const dir of charDirs) {
            const charJsonPath = path.join(CHARACTERS_DIR, dir.name, 'character.json');
            try {
                const content = JSON.parse(await fs.readFile(charJsonPath, 'utf-8'));
                if (content.name === 'New Character') {
                    const charDirPath = path.join(CHARACTERS_DIR, dir.name);
                    await fs.rm(charDirPath, { recursive: true, force: true });
                    console.log(`  Deleted: ${dir.name}/`);
                    deletedCount++;
                }
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    console.error(`  Error processing ${dir.name}:`, e.message);
                }
            }
        }

        console.log(`  Total characters deleted: ${deletedCount}`);
    } catch (e) {
        if (e.code === 'ENOENT') {
            console.log('  Characters directory does not exist, skipping.');
        } else {
            throw e;
        }
    }
}

async function main() {
    console.log('=== Duplicate Resource Cleanup Script ===');
    console.log('This will delete all "New Note" and "New Character" entries.');

    await cleanupNotes();
    await cleanupCharacters();

    console.log('\n=== Cleanup complete! ===');
    console.log('You can delete this script now: cleanup-duplicates.js');
}

main().catch(console.error);
