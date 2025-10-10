import { MeiliSearch } from 'meilisearch';
import Character from '../models/Character.js';
import Note from '../models/Note.js';
import Scenario from '../models/Scenario.js';

class SearchService {
    constructor() {
        this.client = new MeiliSearch({
            host: process.env.MEILISEARCH_URL || 'http://localhost:7700',
            apiKey: process.env.MEILISEARCH_API_KEY
        });
        
        this.indexes = {
            characters: 'characters',
            notes: 'notes', 
            scenarios: 'scenarios'
        };
    }

    async initialize() {
        try {
            console.log('🔍 Initializing Meilisearch indexes...');
            
            // Create indexes with settings
            await this.setupCharactersIndex();
            await this.setupNotesIndex();
            await this.setupScenariosIndex();
            
            console.log('✅ Meilisearch indexes initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Meilisearch:', error);
        }
    }

    async setupCharactersIndex() {
        const index = this.client.index(this.indexes.characters);
        
        // Configure searchable attributes (what fields to search in)
        await index.updateSearchableAttributes([
            'name',
            'description', 
            'personality',
            'scenario',
            'tags',
            'authorName'
        ]);

        // Configure filterable attributes (what can be filtered)
        await index.updateFilterableAttributes([
            'isPublic',
            'authorName',
            'tags',
            'createdAt'
        ]);

        // Configure sortable attributes
        await index.updateSortableAttributes([
            'createdAt',
            'updatedAt',
            'downloads',
            'name'
        ]);

        // Configure ranking rules (relevance algorithm)
        await index.updateRankingRules([
            'words',      // Number of matched words
            'typo',       // Typo tolerance
            'proximity',  // Proximity of words
            'attribute',  // Attribute ranking
            'sort',       // Custom sort
            'exactness',  // Exact matches
            'downloads:desc' // Custom rule: prefer popular characters
        ]);
    }

    async setupNotesIndex() {
        const index = this.client.index(this.indexes.notes);
        
        await index.updateSearchableAttributes([
            'title',
            'content',
            'category',
            'tags',
            'authorName'
        ]);

        await index.updateFilterableAttributes([
            'isPublic',
            'category',
            'authorName',
            'tags',
            'createdAt'
        ]);

        await index.updateSortableAttributes([
            'createdAt',
            'updatedAt', 
            'downloads',
            'title'
        ]);
    }

    async setupScenariosIndex() {
        const index = this.client.index(this.indexes.scenarios);
        
        await index.updateSearchableAttributes([
            'name',
            'description',
            'category',
            'characters', // Character names in the scenario
            'tags',
            'authorName'
        ]);

        await index.updateFilterableAttributes([
            'isPublic',
            'category',
            'authorName', 
            'tags',
            'messageCount',
            'characterCount',
            'createdAt'
        ]);

        await index.updateSortableAttributes([
            'createdAt',
            'updatedAt',
            'downloads', 
            'name',
            'messageCount'
        ]);
    }

    // Transform MongoDB document to Meilisearch document
    transformCharacter(char) {
        return {
            id: char._id.toString(),
            name: char.name,
            description: char.description,
            personality: char.personality,
            scenario: char.scenario,
            firstMessage: char.firstMessage,
            exampleDialogue: char.exampleDialogue,
            avatar: char.avatar,
            authorName: char.authorName,
            tags: char.tags,
            isPublic: char.isPublic,
            downloads: char.stats?.downloads || 0,
            views: char.stats?.views || 0,
            createdAt: new Date(char.createdAt).getTime(), // Unix timestamp for sorting
            updatedAt: new Date(char.updatedAt).getTime()
        };
    }

    transformNote(note) {
        return {
            id: note._id.toString(),
            title: note.title,
            content: note.content,
            category: note.category,
            authorName: note.authorName,
            tags: note.tags,
            isPublic: note.isPublic,
            downloads: note.stats?.downloads || 0,
            views: note.stats?.views || 0,
            createdAt: new Date(note.createdAt).getTime(),
            updatedAt: new Date(note.updatedAt).getTime()
        };
    }

    transformScenario(scenario) {
        return {
            id: scenario._id.toString(),
            name: scenario.name,
            description: scenario.description,
            category: scenario.category,
            characters: scenario.characters,
            authorName: scenario.authorName,
            tags: scenario.tags,
            isPublic: scenario.isPublic,
            messageCount: scenario.messages?.length || 0,
            characterCount: scenario.characters?.length || 0,
            downloads: scenario.stats?.downloads || 0,
            views: scenario.stats?.views || 0,
            createdAt: new Date(scenario.createdAt).getTime(),
            updatedAt: new Date(scenario.updatedAt).getTime()
        };
    }

    // Sync all data from MongoDB to Meilisearch
    async fullSync() {
        try {
            console.log('🔄 Starting full sync from MongoDB to Meilisearch...');
            
            // Sync characters
            const characters = await Character.find({}).lean();
            if (characters.length > 0) {
                const searchCharacters = characters.map(char => this.transformCharacter(char));
                await this.client.index(this.indexes.characters).addDocuments(searchCharacters);
                console.log(`📚 Synced ${characters.length} characters`);
            }

            // Sync notes
            const notes = await Note.find({}).lean();
            if (notes.length > 0) {
                const searchNotes = notes.map(note => this.transformNote(note));
                await this.client.index(this.indexes.notes).addDocuments(searchNotes);
                console.log(`📝 Synced ${notes.length} notes`);
            }

            // Sync scenarios
            const scenarios = await Scenario.find({}).lean();
            if (scenarios.length > 0) {
                const searchScenarios = scenarios.map(scenario => this.transformScenario(scenario));
                await this.client.index(this.indexes.scenarios).addDocuments(searchScenarios);
                console.log(`🎭 Synced ${scenarios.length} scenarios`);
            }

            console.log('✅ Full sync completed successfully');
        } catch (error) {
            console.error('❌ Full sync failed:', error);
            throw error;
        }
    }

    // Add single document to search index
    async addDocument(type, document) {
        try {
            let searchDoc;
            switch (type) {
                case 'character':
                    searchDoc = this.transformCharacter(document);
                    await this.client.index(this.indexes.characters).addDocuments([searchDoc]);
                    break;
                case 'note':
                    searchDoc = this.transformNote(document);
                    await this.client.index(this.indexes.notes).addDocuments([searchDoc]);
                    break;
                case 'scenario':
                    searchDoc = this.transformScenario(document);
                    await this.client.index(this.indexes.scenarios).addDocuments([searchDoc]);
                    break;
            }
        } catch (error) {
            console.error(`Failed to add ${type} to search index:`, error);
        }
    }

    // Update document in search index
    async updateDocument(type, document) {
        await this.addDocument(type, document); // Meilisearch handles updates the same as adds
    }

    // Remove document from search index
    async removeDocument(type, documentId) {
        try {
            let indexName;
            switch (type) {
                case 'character':
                    indexName = this.indexes.characters;
                    break;
                case 'note':
                    indexName = this.indexes.notes;
                    break;
                case 'scenario':
                    indexName = this.indexes.scenarios;
                    break;
            }
            
            if (indexName) {
                await this.client.index(indexName).deleteDocument(documentId.toString());
            }
        } catch (error) {
            console.error(`Failed to remove ${type} from search index:`, error);
        }
    }

    // Search across all indexes or specific type
    async search(query, options = {}) {
        const {
            type, // 'character', 'note', 'scenario', or null for all
            filters = '',
            sort = [],
            limit = 20,
            offset = 0,
            attributesToHighlight = ['*']
        } = options;

        try {
            const searchOptions = {
                limit,
                offset,
                filter: filters,
                sort,
                attributesToHighlight
            };

            if (type) {
                // Search specific index
                const indexName = this.indexes[type + 's'] || this.indexes[type];
                const index = this.client.index(indexName);
                return await index.search(query, searchOptions);
            } else {
                // Multi-index search
                const results = await this.client.multiSearch({
                    queries: [
                        { indexUid: this.indexes.characters, q: query, ...searchOptions },
                        { indexUid: this.indexes.notes, q: query, ...searchOptions },
                        { indexUid: this.indexes.scenarios, q: query, ...searchOptions }
                    ]
                });
                
                return {
                    characters: results.results[0],
                    notes: results.results[1], 
                    scenarios: results.results[2]
                };
            }
        } catch (error) {
            console.error('Search failed:', error);
            throw error;
        }
    }
}

// Singleton instance
const searchService = new SearchService();

export default searchService;