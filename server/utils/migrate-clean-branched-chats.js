/**
 * Migration script to clean up duplicated messages in branched chats.
 *
 * This script fixes the bug where branched chats were incorrectly saving parent messages
 * in their own messages array, causing exponential message duplication.
 *
 * Usage: node server/utils/migrate-clean-branched-chats.js [--dry-run]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHATS_DIR = path.join(__dirname, '../../data/chats');
const isDryRun = process.argv.includes('--dry-run');

/**
 * Recursively collects message IDs from parent chain up to branch point.
 * This tells us which messages in the current chat are actually inherited.
 */
async function collectParentMessageIds(chatId, branchPointMessageId, visitedChatIds = new Set()) {
    // Prevent circular references
    if (visitedChatIds.has(chatId)) {
        console.warn(`⚠️  Circular reference detected at chat ${chatId}`);
        return new Set();
    }
    visitedChatIds.add(chatId);

    const chatPath = path.join(CHATS_DIR, `${chatId}.json`);

    try {
        const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
        const messageIds = new Set();

        // If this chat has a parent, recursively collect its message IDs first
        if (chatData.parentId) {
            const parentIds = await collectParentMessageIds(
                chatData.parentId,
                chatData.branchPointMessageId,
                visitedChatIds
            );
            for (const id of parentIds) {
                messageIds.add(id);
            }
        }

        // Then add this chat's message IDs up to the branch point
        if (branchPointMessageId) {
            const branchIndex = chatData.messages.findIndex(m => m.id === branchPointMessageId);
            if (branchIndex !== -1) {
                // Include message IDs up to and including the branch point
                for (let i = 0; i <= branchIndex; i++) {
                    messageIds.add(chatData.messages[i].id);
                }
            } else {
                // Branch point not found, include all message IDs
                console.warn(`⚠️  Branch point ${branchPointMessageId} not found in chat ${chatId}`);
                for (const msg of chatData.messages) {
                    messageIds.add(msg.id);
                }
            }
        } else {
            // No branch point specified, include all message IDs
            for (const msg of chatData.messages) {
                messageIds.add(msg.id);
            }
        }

        return messageIds;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`⚠️  Parent chat ${chatId} not found`);
            return new Set();
        }
        throw error;
    }
}

/**
 * Cleans a single chat by removing inherited messages and deduplicating.
 */
async function cleanBranchedChat(chatPath) {
    const chatData = JSON.parse(await fs.readFile(chatPath, 'utf-8'));
    const chatId = chatData.id;

    const originalMessageCount = chatData.messages.length;

    // Collect all message IDs that should be inherited from parents (if this is a branch)
    let inheritedMessageIds = new Set();
    if (chatData.parentId && chatData.branchPointMessageId) {
        inheritedMessageIds = await collectParentMessageIds(
            chatData.parentId,
            chatData.branchPointMessageId
        );
    }

    // Filter out inherited messages AND deduplicate messages within this chat
    const seenMessageIds = new Set();
    const ownMessages = [];
    let duplicatesWithinChat = 0;

    for (const msg of chatData.messages) {
        // Skip inherited messages
        if (inheritedMessageIds.has(msg.id)) {
            continue;
        }

        // Skip duplicate messages within this chat
        if (seenMessageIds.has(msg.id)) {
            duplicatesWithinChat++;
            continue;
        }

        seenMessageIds.add(msg.id);
        ownMessages.push(msg);
    }

    const removedCount = originalMessageCount - ownMessages.length;

    if (removedCount === 0) {
        return { chatId, skipped: true, reason: 'no duplicates found' };
    }

    // Update the chat data
    chatData.messages = ownMessages;

    // Save the cleaned chat (unless dry run)
    if (!isDryRun) {
        await fs.writeFile(chatPath, JSON.stringify(chatData, null, 2));
    }

    return {
        chatId,
        cleaned: true,
        originalCount: originalMessageCount,
        newCount: ownMessages.length,
        removedCount,
        duplicatesWithinChat,
        inheritedRemoved: removedCount - duplicatesWithinChat
    };
}

/**
 * Main migration function
 */
async function migrate() {
    console.log('🔍 Scanning for corrupted branched chats...\n');

    if (isDryRun) {
        console.log('🔬 DRY RUN MODE - No files will be modified\n');
    }

    try {
        // Read all chat files
        const files = await fs.readdir(CHATS_DIR);
        const chatFiles = files.filter(f => f.endsWith('.json'));

        console.log(`Found ${chatFiles.length} chat files\n`);

        let cleanedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let totalMessagesRemoved = 0;

        // Process each chat
        for (const file of chatFiles) {
            const chatPath = path.join(CHATS_DIR, file);

            try {
                const result = await cleanBranchedChat(chatPath);

                if (result.cleaned) {
                    cleanedCount++;
                    totalMessagesRemoved += result.removedCount;
                    console.log(`✅ Cleaned ${result.chatId}:`);
                    console.log(`   ${result.originalCount} → ${result.newCount} messages (removed ${result.removedCount})`);
                    if (result.duplicatesWithinChat > 0) {
                        console.log(`   ⚠️  ${result.duplicatesWithinChat} duplicate(s) within same file, ${result.inheritedRemoved} inherited from parent`);
                    }
                } else if (result.skipped) {
                    skippedCount++;
                    // Uncomment to see skipped chats:
                    // console.log(`⏭️  Skipped ${result.chatId}: ${result.reason}`);
                }
            } catch (error) {
                errorCount++;
                console.error(`❌ Error processing ${file}:`, error.message);
            }
        }

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('MIGRATION SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total chats processed: ${chatFiles.length}`);
        console.log(`✅ Cleaned: ${cleanedCount}`);
        console.log(`⏭️  Skipped: ${skippedCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`📦 Total messages removed: ${totalMessagesRemoved}`);

        if (isDryRun) {
            console.log('\n🔬 This was a dry run. Run without --dry-run to apply changes.');
        } else {
            console.log('\n✅ Migration complete!');
        }

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
migrate();
