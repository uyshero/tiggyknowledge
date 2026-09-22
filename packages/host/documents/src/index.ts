import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/chunker-basic'
import type {} from '@tiggyknowledge/content-local'
import type {} from '@tiggyknowledge/document-metadata'
import type { DeleteKnowledgeDocumentsInput, DeleteKnowledgeDocumentsResult, DeleteKnowledgeLibraryResult, KnowledgeDocument, KnowledgeDocumentList, KnowledgeDocumentRevisionList, UpdateKnowledgeDocumentTitleInput, UpdateKnowledgeMarkdownNoteInput, UpdateKnowledgeUrlExtractedContentInput } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/index-fts'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'
import { composeUrlIndexBody, parseShortcutUrl } from '@tiggyknowledge/producer-url'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeDocuments: KnowledgeDocuments
  }
}

const MAX_DOCUMENT_JSON_BODY_BYTES = 800 * 1024

export class KnowledgeDocuments extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeContent', 'knowledgeChunker', 'knowledgeIndex', 'knowledgeMetadata']

  constructor(ctx: Context) {
    super(ctx, 'knowledgeDocuments')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-ui-documents',
        moduleName: '@tiggyknowledge/client-ui-documents',
        label: 'Documents',
        description: 'Document list and preview workbench',
      }],
      routes: [
        {
          id: 'documents:delete-library',
          methods: ['DELETE'],
          path: /^\/api\/libraries\/([^/]+)$/,
          handler: ({ assertSameOrigin, json, match }) => {
            assertSameOrigin()
            try {
              json(this.deleteLibrary(pathSegment(match)))
            } catch (error) {
              throw httpFromRange(error, 'library_not_found')
            }
          },
        },
        {
          id: 'documents:list',
          methods: ['GET'],
          path: /^\/api\/libraries\/([^/]+)\/documents$/,
          handler: ({ json, match }) => {
            try {
              json(this.list(pathSegment(match)))
            } catch (error) {
              throw httpFromRange(error, 'library_not_found')
            }
          },
        },
        {
          id: 'documents:content',
          methods: ['GET'],
          path: /^\/api\/documents\/([^/]+)\/content$/,
          handler: ({ response, match }) => {
            try {
              const source = this.source(pathSegment(match))
              const contentType = source.document.sourceType === 'pdf'
                ? 'application/pdf'
                : source.document.sourceType === 'markdown'
                  ? 'text/markdown; charset=utf-8'
                  : source.document.sourceType === 'audio'
                    ? (source.document.audioMimeType ?? 'audio/webm')
                    : 'text/plain; charset=utf-8'
              response.writeHead(200, {
                'cache-control': 'private, no-store',
                'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.document.originalName)}`,
                'content-length': source.bytes.byteLength,
                'content-type': contentType,
                'x-content-type-options': 'nosniff',
              })
              response.end(Buffer.from(source.bytes))
            } catch (error) {
              throw httpFromRange(error, 'document_not_found')
            }
          },
        },
        {
          id: 'documents:image',
          methods: ['GET'],
          path: /^\/api\/documents\/([^/]+)\/images\/([^/]+)$/,
          handler: ({ response, match }) => {
            try {
              const source = this.image(pathSegment(match, 1), pathSegment(match, 2))
              response.writeHead(200, {
                'cache-control': 'private, max-age=31536000, immutable',
                'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.name)}`,
                'content-length': source.bytes.byteLength,
                'content-type': source.mimeType,
                'x-content-type-options': 'nosniff',
              })
              response.end(Buffer.from(source.bytes))
            } catch (error) {
              throw httpFromRange(error, 'document_image_not_found')
            }
          },
        },
        {
          id: 'documents:title',
          methods: ['PUT'],
          path: /^\/api\/documents\/([^/]+)\/title$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.updateTitle(pathSegment(match), await readJson<UpdateKnowledgeDocumentTitleInput>()))
            } catch (error) {
              throw httpFromRange(error, 'invalid_document')
            }
          },
        },
        {
          id: 'documents:url-content',
          methods: ['PUT'],
          path: /^\/api\/documents\/([^/]+)\/url-content$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.updateUrlExtractedContent(pathSegment(match), await readJson<UpdateKnowledgeUrlExtractedContentInput>(MAX_DOCUMENT_JSON_BODY_BYTES)))
            } catch (error) {
              throw httpFromRange(error, 'invalid_document')
            }
          },
        },
        {
          id: 'documents:markdown-note',
          methods: ['PUT'],
          path: /^\/api\/documents\/([^/]+)\/markdown-note$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.updateMarkdownNote(pathSegment(match), await readJson<UpdateKnowledgeMarkdownNoteInput>(MAX_DOCUMENT_JSON_BODY_BYTES)))
            } catch (error) {
              throw httpFromRange(error, 'invalid_document')
            }
          },
        },
        {
          id: 'documents:revert-revision',
          methods: ['POST'],
          path: /^\/api\/documents\/([^/]+)\/revisions\/(\d+)\/revert$/,
          handler: ({ assertSameOrigin, json, match }) => {
            assertSameOrigin()
            try {
              json(this.revertRevision(pathSegment(match), Number(match?.[2])))
            } catch (error) {
              throw httpFromRange(error, 'invalid_revision')
            }
          },
        },
        {
          id: 'documents:revisions',
          methods: ['GET'],
          path: /^\/api\/documents\/([^/]+)\/revisions$/,
          handler: ({ json, match }) => {
            try {
              json(this.listRevisions(pathSegment(match)))
            } catch (error) {
              throw httpFromRange(error, 'document_not_found')
            }
          },
        },
        {
          id: 'documents:delete',
          methods: ['POST'],
          path: '/api/documents/delete',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            const input = await readJson<DeleteKnowledgeDocumentsInput>()
            try {
              json(this.delete(Array.isArray(input.ids) ? input.ids : []))
            } catch (error) {
              throw httpFromRange(error, 'invalid_delete')
            }
          },
        },
      ],
    })
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

  image(documentId: string, imageId: string): { name: string, mimeType: string, bytes: Uint8Array } {
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    const image = document.images?.find(item => item.id === imageId)
    if (image === undefined) throw new RangeError('笔记图片不存在')
    return {
      name: `${image.name}${extensionForImage(image.mimeType)}`,
      mimeType: image.mimeType,
      bytes: this.ctx.knowledgeContent.read(image.id),
    }
  }

  updateTitle(documentId: string, input: UpdateKnowledgeDocumentTitleInput): KnowledgeDocument {
    const title = validateTitle(input.title)
    const document = this.ctx.knowledgeCatalog.updateDocument(documentId, { title })
    if (isKnowledgeLibrary(this.ctx, document.libraryId)) this.ctx.knowledgeIndex.updateTitle(document.id, document.title)
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/changed', [document.id])
    return document
  }

  listRevisions(documentId: string): KnowledgeDocumentRevisionList {
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    const items = this.ctx.knowledgeCatalog.listDocumentRevisions(documentId)
    return {
      documentId,
      currentVersion: (items[0]?.version ?? 0) + 1,
      items,
    }
  }

  revertRevision(documentId: string, version: number): KnowledgeDocument {
    const revision = this.ctx.knowledgeCatalog.getDocumentRevision(documentId, version)
    return this.updateMarkdownNote(documentId, { title: revision.title, body: revision.body })
  }

  updateMarkdownNote(documentId: string, input: UpdateKnowledgeMarkdownNoteInput): KnowledgeDocument {
    const title = validateTitle(input.title)
    const body = validateBody(input.body)
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    if (document.sourceType !== 'markdown') throw new RangeError('只有 Markdown 知识条目支持内容编辑')
    const previous = parseMarkdownNote(new TextDecoder('utf-8').decode(this.ctx.knowledgeContent.read(document.sourceAssetId)))
    if (previous.title !== title || previous.body !== body) {
      this.ctx.knowledgeCatalog.addDocumentRevision({
        documentId,
        title: previous.title || document.title,
        body: previous.body,
        sourceAssetId: document.sourceAssetId,
      })
    }
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
    if (input.tagNames !== undefined) this.ctx.knowledgeMetadata.setTags(updated.id, input.tagNames)
    if (isKnowledgeLibrary(this.ctx, updated.libraryId)) {
      const chunks = this.ctx.knowledgeChunker.chunk({ body: markdown, sourceType: 'markdown' })
      try {
        this.ctx.knowledgeIndex.index({ id: updated.id, libraryId: updated.libraryId, title: updated.title }, chunks)
        updated = this.ctx.knowledgeCatalog.setDocumentIndexStatus(updated.id, 'ready')
      } catch (error) {
        updated = this.ctx.knowledgeCatalog.setDocumentIndexStatus(updated.id, 'failed')
        throw error
      }
    }
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/changed', [updated.id])
    return updated
  }

  updateUrlExtractedContent(documentId: string, input: UpdateKnowledgeUrlExtractedContentInput): KnowledgeDocument {
    const text = validateBody(input.text)
    const document = this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    if (document.sourceType !== 'url') throw new RangeError('只有网页知识条目支持同步页面正文')
    const url = parseShortcutUrl(document.originalName, this.ctx.knowledgeContent.read(document.sourceAssetId))
    const title = input.title === undefined || input.title.trim().length === 0 ? document.title : validateTitle(input.title)
    const body = composeUrlIndexBody(title, url, text)
    const current = this.ctx.knowledgeIndex.listDocumentChunks(document.id).map(chunk => chunk.body).join('\n').trim()
    const titleChanged = title !== document.title
    const shouldReindex = body.length > current.length + 40 || current === url || current.length < 80
    let updated = titleChanged ? this.ctx.knowledgeCatalog.updateDocument(documentId, { title }) : document
    if (!shouldReindex && !titleChanged) return updated
    if (shouldReindex) {
      updated = this.ctx.knowledgeCatalog.setDocumentIndexStatus(updated.id, 'pending')
      const chunks = this.ctx.knowledgeChunker.chunk({ body, sourceType: 'url' })
      try {
        this.ctx.knowledgeIndex.index({ id: updated.id, libraryId: updated.libraryId, title: updated.title }, chunks)
        updated = this.ctx.knowledgeCatalog.setDocumentIndexStatus(updated.id, 'ready')
      } catch (error) {
        updated = this.ctx.knowledgeCatalog.setDocumentIndexStatus(updated.id, 'failed')
        throw error
      }
    } else {
      this.ctx.knowledgeIndex.updateTitle(updated.id, updated.title)
    }
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/changed', [updated.id])
    return updated
  }

  deleteLibrary(libraryId: string): DeleteKnowledgeLibraryResult {
    const library = this.ctx.knowledgeCatalog.getLibrary(libraryId)
    if (library === undefined) throw new RangeError('知识库不存在')
    if (library.kind === 'studio') throw new RangeError('创作空间不能删除')
    const deleted = this.ctx.knowledgeCatalog.deleteLibrary(libraryId)
    const deletedDocumentIds = deleted.map(document => document.id)
    try {
      this.ctx.knowledgeIndex.removeDocuments(deletedDocumentIds)
    } catch (error) {
      this.ctx.logger('documents').warn('failed to clean deleted library index', error)
    }
    this.ctx.emit('knowledge/graph/invalidate')
    this.ctx.emit('knowledge/document/deleted', deletedDocumentIds)
    this.ctx.emit('knowledge/library/deleted', libraryId)
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

function isKnowledgeLibrary(ctx: Context, libraryId: string): boolean {
  return ctx.knowledgeCatalog.getLibrary(libraryId)?.kind === 'knowledge'
}

function parseMarkdownNote(content: string): { title: string, body: string } {
  const normalized = content.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.startsWith('# ')) {
    const title = lines[0].slice(2).trim()
    const bodyStart = lines[1]?.trim().length === 0 ? 2 : 1
    return {
      title,
      body: lines.slice(bodyStart).join('\n').replace(/\s+$/u, ''),
    }
  }
  return { title: '', body: normalized.replace(/\s+$/u, '') }
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

function extensionForImage(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/webp') return '.webp'
  return '.png'
}

export default KnowledgeDocuments
