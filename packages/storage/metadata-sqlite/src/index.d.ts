import { Context, Service } from '@deepseek-ai/cordis';
import type { KnowledgeDocumentMetadata, KnowledgeTag } from '@tiggyknowledge/contracts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        knowledgeMetadataStore: MetadataSqlite;
    }
}
export interface Config {
    dataDir: string;
}
export declare class MetadataSqlite extends Service {
    private database;
    private readonly databasePath;
    constructor(ctx: Context, config: Config);
    [Service.init](): AsyncGenerator<() => void>;
    schemaVersion(): number;
    metadata(documentId: string): KnowledgeDocumentMetadata;
    metadataMany(documentIds: string[]): Map<string, KnowledgeDocumentMetadata>;
    setTags(documentId: string, names: string[]): KnowledgeDocumentMetadata;
    setFavorite(documentId: string, favorite: boolean): KnowledgeDocumentMetadata;
    renameTag(tagId: string, name: string): KnowledgeTag;
    listTags(): KnowledgeTag[];
    taggedDocumentIds(tagId: string): string[];
    favoriteDocumentIds(): string[];
    private requireDatabase;
}
export default MetadataSqlite;
//# sourceMappingURL=index.d.ts.map