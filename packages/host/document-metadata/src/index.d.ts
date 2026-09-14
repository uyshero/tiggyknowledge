import { Context, Service } from '@deepseek-ai/cordis';
import type { KnowledgeDocumentMetadata, KnowledgeDocumentWithMetadata, KnowledgeTag } from '@tiggyknowledge/contracts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        knowledgeMetadata: DocumentMetadata;
    }
}
export declare class DocumentMetadata extends Service {
    static inject: string[];
    constructor(ctx: Context);
    get(documentId: string): KnowledgeDocumentMetadata;
    getMany(documentIds: string[]): Map<string, KnowledgeDocumentMetadata>;
    normalizeTags(names: string[]): string[];
    setTags(documentId: string, names: string[]): KnowledgeDocumentMetadata;
    setFavorite(documentId: string, favorite: boolean): KnowledgeDocumentMetadata;
    renameTag(tagId: string, name: string): KnowledgeTag;
    listTags(): KnowledgeTag[];
    taggedDocuments(tagId: string): KnowledgeDocumentWithMetadata[];
    favoriteDocuments(): KnowledgeDocumentWithMetadata[];
    private enrich;
    private requireDocument;
}
export default DocumentMetadata;
//# sourceMappingURL=index.d.ts.map