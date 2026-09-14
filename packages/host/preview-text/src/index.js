import { Service } from '@deepseek-ai/cordis';
const MAX_PREVIEW_CHARACTERS = 200_000;
export class TextPreview extends Service {
    static inject = ['knowledgeCatalog', 'knowledgeContent'];
    handlers = new Map();
    constructor(ctx) {
        super(ctx, 'knowledgePreview');
        const handler = (_document, bytes) => {
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            return {
                content: content.slice(0, MAX_PREVIEW_CHARACTERS),
                truncated: content.length > MAX_PREVIEW_CHARACTERS,
            };
        };
        this.register(['text', 'markdown'], handler);
    }
    register(sourceTypes, handler) {
        for (const sourceType of sourceTypes) {
            if (this.handlers.has(sourceType))
                throw new Error(`preview: duplicate source type ${sourceType}`);
        }
        for (const sourceType of sourceTypes)
            this.handlers.set(sourceType, handler);
        return () => {
            for (const sourceType of sourceTypes) {
                if (this.handlers.get(sourceType) === handler)
                    this.handlers.delete(sourceType);
            }
        };
    }
    async preview(documentId) {
        const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0];
        if (document === undefined)
            throw new RangeError('知识条目不存在');
        const handler = this.handlers.get(document.sourceType);
        if (handler === undefined)
            throw new RangeError('当前没有可用的预览插件');
        const result = await handler(document, this.ctx.knowledgeContent.read(document.sourceAssetId));
        return {
            document,
            content: result.content,
            format: document.sourceType,
            truncated: result.truncated,
            ...(result.pageCount === undefined ? {} : { pageCount: result.pageCount }),
        };
    }
}
export default TextPreview;
//# sourceMappingURL=index.js.map