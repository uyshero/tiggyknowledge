import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/chunker-basic'
import type {} from '@tiggyknowledge/content-local'
import type { DeleteKnowledgeDocumentsResult, DeleteKnowledgeLibraryResult, KnowledgeDocument, KnowledgeDocumentList, UpdateKnowledgeDocumentTitleInput, UpdateKnowledgeMarkdownNoteInput } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/index-fts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeDocuments: KnowledgeDocuments
  }
}

export class KnowledgeDocuments extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeContent', 'knowledgeChunker', 'knowledgeIndex']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeDocuments')
  }

  list(libraryId: string): KnowledgeDocumentList {
    const library = this.ctx.knowledgeCatalog.getLibrary(libraryId)
    if (library === undefined) throw new RangeError('知识库不存在')
    return { library, items: this.ctx.knowledgeCatalog.listDocuments(libraryId) }
  }

  source(documentId: string): { document: KnowledgeDocument, bytes: Uint8Array } {
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    return { document, bytes: this.ctx.knowledgeContent.read(document.sourceAssetId) }
  }

  updateTitle(documentId: string, input: UpdateKnowledgeDocumentTitleInput): KnowledgeDocument {
    const title = validateTitle(input.title)
    const document = this.ctx.knowledgeCatalog.updateDocument(documentId, { title })
    this.ctx.knowledgeIndex.updateTitle(document.id, document.title)
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/changed', [document.id])
    return document
  }

  updateMarkdownNote(documentId: string, input: UpdateKnowledgeMarkdownNoteInput): KnowledgeDocument {
    const title = validateTitle(input.title)
    const body = validateBody(input.body)
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    if (document.sourceType !== 'markdown') throw new RangeError('只有 Markdown 知识条目支持内容编辑')
    const markdown = `# ${title}\n\n${body}\n`
    const asset = this.ctx.knowledgeContent.save(new TextEncoder().encode(markdown))
    this.ctx.knowledgeCatalog.registerAsset(asset)
    let updated = this.ctx.knowledgeCatalog.updateDocument(documentId, {
      title,
      sourceAssetId: asset.id,
      contentHash: asset.contentHash,
      sizeBytes: asset.sizeBytes,
      indexStatus: 'pending',
    })
    const chunks = this.ctx.knowledgeChunker.chunk({ body: markdown, sourceType: 'markdown' })
    try {
      this.ctx.knowledgeIndex.index({ id: updated.id, libraryId: updated.libraryId, title: updated.title }, chunks)
      updated = this.ctx.knowledgeCatalog.setDocumentIndexStatus(updated.id, 'ready')
    } catch (error) {
      updated = this.ctx.knowledgeCatalog.setDocumentIndexStatus(updated.id, 'failed')
      throw error
    }
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/changed', [updated.id])
    return updated
  }

  deleteLibrary(libraryId: string): DeleteKnowledgeLibraryResult {
    if (this.ctx.knowledgeCatalog.getLibrary(libraryId) === undefined) throw new RangeError('知识库不存在')
    const deleted = this.ctx.knowledgeCatalog.deleteLibrary(libraryId)
    const deletedDocumentIds = deleted.map(document => document.id)
    try {
      this.ctx.knowledgeIndex.removeDocuments(deletedDocumentIds)
    } catch (error) {
      this.ctx.logger('documents').warn('failed to clean deleted library index', error)
    }
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/deleted', deletedDocumentIds)
    return { deletedLibraryId: libraryId, deletedDocumentIds }
  }

  delete(ids: string[]): DeleteKnowledgeDocumentsResult {
    const normalized = [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))]
    if (normalized.length === 0 || normalized.length > 100) throw new RangeError('每次应删除 1 到 100 个知识条目')
    const documents = this.ctx.knowledgeCatalog.getDocuments(normalized)
    if (documents.length !== normalized.length) throw new RangeError('知识条目不存在')
    const deleted = this.ctx.knowledgeCatalog.deleteDocuments(normalized)
    this.ctx.knowledgeIndex.removeDocuments(deleted.map(document => document.id))
    this.ctx.emit('knowledge/graph/invalidate')
    const deletedIds = deleted.map(document => document.id)
    this.ctx.emit('knowledge/document/deleted', deletedIds)
    return { deletedIds }
  }
}

function validateTitle(title: string): string {
  if (typeof title !== 'string') throw new RangeError('标题必须是文本')
  const value = title.trim()
  if (value.length === 0 || value.length > 200 || /[\r\n]/.test(value)) {
    throw new RangeError('标题长度应为 1 到 200 个字符且不能换行')
  }
  return value
}

function validateBody(body: string): string {
  if (typeof body !== 'string') throw new RangeError('正文必须是文本')
  const value = body.trim()
  if (value.length === 0 || value.length > 200_000) throw new RangeError('正文长度应为 1 到 200,000 个字符')
  return value
}

export default KnowledgeDocuments
