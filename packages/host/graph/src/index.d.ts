import { Context, Service } from '@deepseek-ai/cordis';
import type { KnowledgeGraphQuery, KnowledgeGraphResponse } from '@tiggyknowledge/contracts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        knowledgeGraph: KnowledgeGraph;
    }
}
export declare class KnowledgeGraph extends Service {
    static inject: string[];
    private state;
    private building;
    constructor(ctx: Context);
    invalidate(): void;
    snapshot(query?: KnowledgeGraphQuery): Promise<KnowledgeGraphResponse>;
    document(documentId: string, query?: Pick<KnowledgeGraphQuery, 'depth' | 'includeMissing' | 'libraryId'>): Promise<KnowledgeGraphResponse>;
    private ensureState;
    private rebuild;
}
export default KnowledgeGraph;
//# sourceMappingURL=index.d.ts.map