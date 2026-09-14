import { Service } from '@deepseek-ai/cordis';
function normalizeTagNames(input) {
    const names = [];
    const seen = new Set();
    for (const value of input) {
        if (typeof value !== 'string')
            throw new RangeError('标签名称必须是文本');
        const name = value.trim();
        if (name.length === 0 || name.length > 32)
            throw new RangeError('标签名称长度应为 1 到 32 个字符');
        const key = name.toLocaleLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        names.push(name);
    }
    if (names.length > 10)
        throw new RangeError('每个知识条目最多设置 10 个标签');
    return names;
}
export class DocumentMetadata extends Service {
    static inject = ['knowledgeCatalog', 'knowledgeMetadataStore'];
    constructor(ctx) {
        super(ctx, 'knowledgeMetadata');
    }
    get(documentId) {
        this.requireDocument(documentId);
        return this.ctx.knowledgeMetadataStore.metadata(documentId);
    }
    getMany(documentIds) {
        return this.ctx.knowledgeMetadataStore.metadataMany(documentIds);
    }
    normalizeTags(names) {
        return normalizeTagNames(names);
    }
    setTags(documentId, names) {
        this.requireDocument(documentId);
        const result = this.ctx.knowledgeMetadataStore.setTags(documentId, this.normalizeTags(names));
        this.ctx.knowledgeGraph.invalidate();
        return result;
    }
    setFavorite(documentId, favorite) {
        this.requireDocument(documentId);
        const result = this.ctx.knowledgeMetadataStore.setFavorite(documentId, favorite);
        this.ctx.knowledgeGraph.invalidate();
        return result;
    }
    renameTag(tagId, name) {
        const result = this.ctx.knowledgeMetadataStore.renameTag(tagId, name);
        this.ctx.knowledgeGraph.invalidate();
        return result;
    }
    listTags() {
        return this.ctx.knowledgeMetadataStore.listTags();
    }
    taggedDocuments(tagId) {
        if (!this.listTags().some(tag => tag.id === tagId))
            throw new RangeError('标签不存在');
        return this.enrich(this.ctx.knowledgeMetadataStore.taggedDocumentIds(tagId));
    }
    favoriteDocuments() {
        return this.enrich(this.ctx.knowledgeMetadataStore.favoriteDocumentIds());
    }
    enrich(ids) {
        const documents = new Map(this.ctx.knowledgeCatalog.getDocuments(ids).map(document => [document.id, document]));
        const libraries = new Map(this.ctx.knowledgeCatalog.listLibraries().map(library => [library.id, library.name]));
        const metadata = this.getMany(ids);
        return ids.flatMap(id => {
            const document = documents.get(id);
            if (document === undefined)
                return [];
            return [{
                    document,
                    libraryName: libraries.get(document.libraryId) ?? '未知知识库',
                    metadata: metadata.get(id) ?? { documentId: id, tags: [], isFavorite: false },
                }];
        });
    }
    requireDocument(id) {
        if (typeof id !== 'string' || id.length === 0 || this.ctx.knowledgeCatalog.getDocuments([id]).length === 0) {
            throw new RangeError('知识条目不存在');
        }
    }
}
export default DocumentMetadata;
//# sourceMappingURL=index.js.map