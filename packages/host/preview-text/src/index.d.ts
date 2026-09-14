import { Context, Service } from '@deepseek-ai/cordis';
import type { KnowledgeDocument, KnowledgeDocumentPreview, KnowledgeDocumentSourceType } from '@tiggyknowledge/contracts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        knowledgePreview: TextPreview;
    }
}
export interface DocumentPreviewContent {
    content: string;
    truncated: boolean;
    pageCount?: number;
}
export type DocumentPreviewHandler = (document: KnowledgeDocument, bytes: Uint8Array) => DocumentPreviewContent | Promise<DocumentPreviewContent>;
export declare class TextPreview extends Service {
    static inject: string[];
    private readonly handlers;
    constructor(ctx: Context);
    register(sourceTypes: KnowledgeDocumentSourceType[], handler: DocumentPreviewHandler): () => void;
    preview(documentId: string): Promise<KnowledgeDocumentPreview>;
}
export default TextPreview;
//# sourceMappingURL=index.d.ts.map