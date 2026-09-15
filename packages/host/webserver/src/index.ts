import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/client-bootstrap'
import type {
  CapabilitiesSnapshot,
  CreateKnowledgeLibraryInput,
  CreateKnowledgeNoteInput,
  DeleteKnowledgeDocumentsInput,
  DshKnowledgeLibraryList,
  DshKnowledgeOkfResponse,
  DshKnowledgeReadResponse,
  DshKnowledgeSearchInput,
  DshKnowledgeSearchResponse,
  DshKnowledgeStatus,
  GenerateDshIntegrationAccessKeyResult,
  KnowledgeDocument,
  KnowledgeCapabilities,
  KnowledgeGraphQuery,
  KnowledgeLibrary,
  KnowledgeLibraryList,
  KnowledgeMetadataDocumentList,
  KnowledgeOkfMapping,
  KnowledgeQuery,
  KnowledgeSourceReference,
  KnowledgeTagList,
  RenameKnowledgeTagInput,
  SetKnowledgeDocumentFavoriteInput,
  SetKnowledgeDocumentTagsInput,
  SystemSnapshot,
  UpdateDshIntegrationSettingsInput,
  UpdateKnowledgeDocumentTitleInput,
  UpdateKnowledgeLibraryInput,
  UpdateKnowledgeMarkdownNoteInput,
} from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/document-metadata'
import type {} from '@tiggyknowledge/documents'
import type {} from '@tiggyknowledge/graph'
import type {} from '@tiggyknowledge/ingestion-tags'
import type {} from '@tiggyknowledge/note-creator'
import type {} from '@tiggyknowledge/okf'
import type {} from '@tiggyknowledge/okf-export'
import type {} from '@tiggyknowledge/plugin-inventory'
import type {} from '@tiggyknowledge/query'
import type {} from '@tiggyknowledge/preview-text'
import type {} from '@tiggyknowledge/semantic-capabilities'
import type {} from '@tiggyknowledge/settings-file'
import type {} from '@tiggyknowledge/storage-manager'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
    appVersion: string
  }
}

export interface Config {
  host: '127.0.0.1' | '0.0.0.0'
  port: number
  distRoot: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const MAX_JSON_BODY_BYTES = 16 * 1024
const MAX_UPLOAD_BODY_BYTES = 50 * 1024 * 1024
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024
const MAX_UPLOAD_FILES = 50

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface PaginatedContent {
  content: string
  offset: number
  returnedCharacters: number
  totalCharacters: number
  hasMore: boolean
  nextOffset?: number
  sourceTruncated: boolean
  truncated: boolean
}

/** Slice one stable character window and expose an exact continuation cursor. */
export function paginateContent(
  content: string,
  offset: number,
  maxCharacters: number,
  sourceTruncated: boolean,
): PaginatedContent {
  const chunk = content.slice(offset, offset + maxCharacters)
  const end = offset + chunk.length
  const hasMore = end < content.length
  return {
    content: chunk,
    offset,
    returnedCharacters: chunk.length,
    totalCharacters: content.length,
    hasMore,
    ...(hasMore ? { nextOffset: end } : {}),
    sourceTruncated,
    truncated: hasMore || sourceTruncated,
  }
}

export function createCapabilitiesSnapshot(
  searchModes: KnowledgeCapabilities['searchModes'],
  hostPlugins: CapabilitiesSnapshot['hostPlugins'],
  version: string,
): CapabilitiesSnapshot {
  return {
    product: 'tiggyknowledge',
    version,
    capabilities: {
      protocolVersion: 1,
      basePath: '/api/tiggyknowledge',
      authentication: 'bearer',
      operations: [
        { id: 'status', method: 'GET', path: '/api/tiggyknowledge/status', readOnly: true },
        { id: 'libraries', method: 'GET', path: '/api/tiggyknowledge/libraries', readOnly: true },
        { id: 'search', method: 'POST', path: '/api/tiggyknowledge/search', readOnly: true },
        { id: 'read', method: 'GET', path: '/api/tiggyknowledge/documents/:id/read', readOnly: true },
        { id: 'okf', method: 'GET', path: '/api/tiggyknowledge/documents/:id/okf', readOnly: true },
      ],
      searchModes: [...new Set(searchModes)],
      referenceSchemes: ['tk://local'],
      write: false,
    },
    hostPlugins,
  }
}

export function createKnowledgeSourceReference(
  document: Pick<KnowledgeDocument, 'id' | 'libraryId' | 'title' | 'sourceType'>,
): KnowledgeSourceReference {
  const libraryId = encodeURIComponent(document.libraryId)
  const documentId = encodeURIComponent(document.id)
  return {
    uri: `tk://local/${libraryId}/${documentId}`,
    knowledgeBaseId: document.libraryId,
    documentId: document.id,
    title: document.title,
    sourceType: document.sourceType,
  }
}

function extensionOf(path: string): string {
  const at = path.lastIndexOf('.')
  return at < 0 ? '' : path.slice(at)
}

export class WebServer extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeTaggedIngestion', 'knowledgeNoteCreator', 'knowledgeDocuments', 'knowledgePreview', 'knowledgeMetadata', 'knowledgeOkf', 'knowledgeOkfExport', 'knowledgeQuery', 'knowledgeSemanticCapabilities', 'settings', 'storageManager', 'clientBootstrap', 'pluginInventory']

  private readonly config: Config
  private listeningPort: number | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'webServer')
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
      throw new Error(`webserver: invalid port ${String(config.port)}`)
    }
    this.config = { ...config, distRoot: resolve(config.distRoot) }
  }

  get url(): string {
    if (this.listeningPort === undefined) throw new Error('webserver: server is not listening')
    const host = this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host
    return `http://${host}:${this.listeningPort}`
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void>> {
    const server: Server = createServer((request, response) => {
      this.handle(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.end()
          return
        }
        if (error instanceof HttpError) {
          this.json(response, { error: error.code, message: error.message }, error.status)
          return
        }
        this.ctx.logger('webserver').error(error)
        this.json(response, { error: 'internal_error', message: '服务暂时不可用' }, 500)
      })
    })
    await new Promise<void>((accept, reject) => {
      server.once('error', reject)
      server.listen(this.config.port, this.config.host, () => {
        server.off('error', reject)
        const address = server.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('webserver: listener did not expose a TCP address'))
          return
        }
        this.listeningPort = address.port
        accept()
      })
    })
    yield () => new Promise<void>((accept, reject) => {
      server.close(error => error === undefined ? accept() : reject(error))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://localhost')
    const pathname = url.pathname
    if (pathname === '/api/health') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      this.json(response, { status: 'ok' })
      return
    }
    if (pathname === '/api/capabilities') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      this.json(response, createCapabilitiesSnapshot(
        this.ctx.knowledgeSemanticCapabilities.snapshot().enabledModes,
        this.ctx.pluginInventory.list(),
        this.ctx.appVersion,
      ))
      return
    }
    if (pathname === '/api/system') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      const snapshot: SystemSnapshot = {
        product: 'tiggyknowledge',
        version: this.ctx.appVersion,
        catalog: this.ctx.knowledgeCatalog.summary(),
        settings: this.ctx.settings.snapshot(),
        semanticSearch: this.ctx.knowledgeSemanticCapabilities.snapshot(),
        hostPlugins: this.ctx.pluginInventory.list(),
        clientBoot: this.ctx.clientBootstrap.manifest(),
      }
      this.json(response, snapshot)
      return
    }
    if (pathname === '/api/system/open-data-directory') {
      if (method !== 'POST') return this.methodNotAllowed(response, ['POST'])
      this.assertSameOrigin(request)
      try {
        this.json(response, await this.ctx.storageManager.openDataDirectory())
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'data_directory_not_found', error.message)
        throw new HttpError(500, 'open_data_directory_failed', error instanceof Error ? error.message : '无法打开本地数据目录')
      }
      return
    }
    if (pathname === '/api/settings/agent-integration') {
      if (method !== 'PUT') return this.methodNotAllowed(response, ['PUT'])
      this.assertSameOrigin(request)
      const input = await this.readJson<UpdateDshIntegrationSettingsInput>(request)
      try {
        this.json(response, this.ctx.settings.updateDshIntegration(input))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'invalid_agent_integration_settings', error.message)
        throw error
      }
      return
    }
    if (pathname === '/api/settings/agent-integration/access-key') {
      if (method !== 'POST') return this.methodNotAllowed(response, ['POST'])
      this.assertSameOrigin(request)
      const result: GenerateDshIntegrationAccessKeyResult = this.ctx.settings.generateDshIntegrationAccessKey()
      this.json(response, result, 201)
      return
    }
    if (pathname === '/api/tiggyknowledge/status') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      this.assertTiggyKnowledgeAccess(request)
      const catalog = this.ctx.knowledgeCatalog.summary()
      const scopedLibraries = this.scopedTiggyKnowledgeLibraries()
      const status: DshKnowledgeStatus = {
        product: 'tiggyknowledge',
        version: this.ctx.appVersion,
        dataDirectory: catalog.dataDirectory,
        libraries: scopedLibraries.length,
        documents: scopedLibraries.reduce((total, library) => total + library.documentCount, 0),
        capabilities: { search: true, read: true, okf: true, write: false },
      }
      this.json(response, status)
      return
    }
    if (pathname === '/api/tiggyknowledge/libraries') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      this.assertTiggyKnowledgeAccess(request)
      const result: DshKnowledgeLibraryList = { items: this.scopedTiggyKnowledgeLibraries() }
      this.json(response, result)
      return
    }
    if (pathname === '/api/tiggyknowledge/search') {
      if (method !== 'POST') return this.methodNotAllowed(response, ['POST'])
      this.assertTiggyKnowledgeAccess(request)
      const input = await this.readJson<DshKnowledgeSearchInput>(request)
      try {
        const search = this.ctx.knowledgeQuery.search({
          text: input.query,
          knowledgeBaseIds: this.resolveTiggyKnowledgeSearchLibraryIds(input.knowledgeBaseIds),
          ...(input.topK === undefined ? {} : { topK: input.topK }),
          ...(input.favoriteOnly === undefined ? {} : { favoriteOnly: input.favoriteOnly }),
        })
        const result: DshKnowledgeSearchResponse = {
          ...search,
          results: search.results.map(item => ({
            ...item,
            reference: createKnowledgeSourceReference({
              id: item.documentId,
              libraryId: item.knowledgeBaseId,
              title: item.title,
              sourceType: item.sourceType,
            }),
          })),
        }
        this.json(response, result)
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'invalid_tiggyknowledge_query', error.message)
        throw error
      }
      return
    }
    const tiggyKnowledgeReadMatch = pathname.match(/^\/api\/tiggyknowledge\/documents\/([^/]+)\/read$/)
    if (tiggyKnowledgeReadMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      this.assertTiggyKnowledgeAccess(request)
      const maxCharacters = this.parseMaxCharacters(url, 20_000)
      const offset = this.parseOffset(url)
      const documentId = decodeURIComponent(tiggyKnowledgeReadMatch[1] ?? '')
      if (!this.isTiggyKnowledgeDocumentAllowed(documentId)) {
        this.json(response, this.emptyTiggyKnowledgeRead(documentId, offset))
        return
      }
      try {
        const preview = await this.ctx.knowledgePreview.preview(documentId)
        const page = paginateContent(preview.content, offset, maxCharacters, preview.truncated)
        const result: DshKnowledgeReadResponse = {
          documentId: preview.document.id,
          knowledgeBaseId: preview.document.libraryId,
          title: preview.document.title,
          originalName: preview.document.originalName,
          sourceType: preview.document.sourceType,
          ...page,
          reference: createKnowledgeSourceReference(preview.document),
          ...(preview.pageCount === undefined ? {} : { pageCount: preview.pageCount }),
        }
        this.json(response, result)
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
        throw error
      }
      return
    }
    const tiggyKnowledgeOkfMatch = pathname.match(/^\/api\/tiggyknowledge\/documents\/([^/]+)\/okf$/)
    if (tiggyKnowledgeOkfMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      this.assertTiggyKnowledgeAccess(request)
      const maxCharacters = this.parseMaxCharacters(url, 20_000)
      const documentId = decodeURIComponent(tiggyKnowledgeOkfMatch[1] ?? '')
      if (!this.isTiggyKnowledgeDocumentAllowed(documentId)) {
        this.json(response, this.emptyTiggyKnowledgeOkf(documentId))
        return
      }
      try {
        const mapping = await this.ctx.knowledgeOkf.mapping(documentId)
        mapping.concept.body = mapping.concept.body.slice(0, maxCharacters)
        const document = this.findTiggyKnowledgeDocument(documentId)
        const result: DshKnowledgeOkfResponse = {
          ...mapping,
          ...(document === undefined ? {} : { reference: createKnowledgeSourceReference(document) }),
        }
        this.json(response, result)
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
        throw error
      }
      return
    }
    if (pathname === '/api/libraries') {
      if (method === 'GET') {
        const result: KnowledgeLibraryList = { items: this.ctx.knowledgeCatalog.listLibraries() }
        this.json(response, result)
        return
      }
      if (method === 'POST') {
        this.assertSameOrigin(request)
        const input = await this.readJson<CreateKnowledgeLibraryInput>(request)
        try {
          this.json(response, this.ctx.knowledgeCatalog.createLibrary(input), 201)
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(400, 'invalid_library', error.message)
          throw error
        }
        return
      }
      return this.methodNotAllowed(response, ['GET', 'POST'])
    }
    const libraryMatch = pathname.match(/^\/api\/libraries\/([^/]+)$/)
    if (libraryMatch !== null) {
      const libraryId = decodeURIComponent(libraryMatch[1] ?? '')
      if (method === 'PUT') {
        this.assertSameOrigin(request)
        const input = await this.readJson<UpdateKnowledgeLibraryInput>(request)
        try {
          this.json(response, this.ctx.knowledgeCatalog.updateLibrary(libraryId, input))
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(error.message === '知识库不存在' ? 404 : 400, 'invalid_library', error.message)
          throw error
        }
        return
      }
      if (method === 'DELETE') {
        this.assertSameOrigin(request)
        try {
          this.json(response, this.ctx.knowledgeDocuments.deleteLibrary(libraryId))
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(404, 'library_not_found', error.message)
          throw error
        }
        return
      }
      return this.methodNotAllowed(response, ['PUT', 'DELETE'])
    }
    const importMatch = pathname.match(/^\/api\/libraries\/([^/]+)\/imports$/)
    if (importMatch !== null) {
      if (method !== 'POST') return this.methodNotAllowed(response, ['POST'])
      this.assertSameOrigin(request)
      const libraryId = decodeURIComponent(importMatch[1] ?? '')
      const upload = await this.readUploadFiles(request)
      try {
        this.json(response, await this.ctx.knowledgeTaggedIngestion.ingest(libraryId, upload.files, upload.tagNames))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(error.message === '知识库不存在' ? 404 : 400, 'invalid_ingestion', error.message)
        throw error
      }
      return
    }
    const noteMatch = pathname.match(/^\/api\/libraries\/([^/]+)\/notes$/)
    if (noteMatch !== null) {
      if (method !== 'POST') return this.methodNotAllowed(response, ['POST'])
      this.assertSameOrigin(request)
      const input = await this.readJson<CreateKnowledgeNoteInput>(request)
      try {
        this.json(response, await this.ctx.knowledgeNoteCreator.create(decodeURIComponent(noteMatch[1] ?? ''), input), 201)
      } catch (error) {
        if (error instanceof RangeError) {
          throw new HttpError(error.message === '知识库不存在' ? 404 : 400, 'invalid_note', error.message)
        }
        throw error
      }
      return
    }
    const documentsMatch = pathname.match(/^\/api\/libraries\/([^/]+)\/documents$/)
    if (documentsMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      try {
        this.json(response, this.ctx.knowledgeDocuments.list(decodeURIComponent(documentsMatch[1] ?? '')))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'library_not_found', error.message)
        throw error
      }
      return
    }
    const okfBundleMatch = pathname.match(/^\/api\/libraries\/([^/]+)\/okf-bundle$/)
    if (okfBundleMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      try {
        const bundle = await this.ctx.knowledgeOkfExport.exportLibrary(decodeURIComponent(okfBundleMatch[1] ?? ''))
        response.writeHead(200, {
          'cache-control': 'private, no-store',
          'content-disposition': `attachment; filename="tiggyknowledge-okf.zip"; filename*=UTF-8''${encodeURIComponent(bundle.filename)}`,
          'content-length': bundle.bytes.byteLength,
          'content-type': 'application/zip',
          'x-content-type-options': 'nosniff',
          'x-okf-concepts': String(bundle.validation.conceptFiles),
          'x-okf-validation': bundle.validation.status,
          'x-okf-version': bundle.validation.okfVersion,
        })
        response.end(Buffer.from(bundle.bytes))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'library_not_found', error.message)
        throw error
      }
      return
    }
    const documentContentMatch = pathname.match(/^\/api\/documents\/([^/]+)\/content$/)
    if (documentContentMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      try {
        const source = this.ctx.knowledgeDocuments.source(decodeURIComponent(documentContentMatch[1] ?? ''))
        const contentType = source.document.sourceType === 'pdf'
          ? 'application/pdf'
          : source.document.sourceType === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8'
        response.writeHead(200, {
          'cache-control': 'private, no-store',
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.document.originalName)}`,
          'content-length': source.bytes.byteLength,
          'content-type': contentType,
          'x-content-type-options': 'nosniff',
        })
        response.end(Buffer.from(source.bytes))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
        throw error
      }
      return
    }
    const documentOkfMatch = pathname.match(/^\/api\/documents\/([^/]+)\/okf$/)
    if (documentOkfMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      try {
        this.json(response, await this.ctx.knowledgeOkf.mapping(decodeURIComponent(documentOkfMatch[1] ?? '')))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
        throw error
      }
      return
    }
    const previewMatch = pathname.match(/^\/api\/documents\/([^/]+)\/preview$/)
    if (previewMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      try {
        this.json(response, await this.ctx.knowledgePreview.preview(decodeURIComponent(previewMatch[1] ?? '')))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(error.message === '知识条目不存在' ? 404 : 400, 'preview_unavailable', error.message)
        throw error
      }
      return
    }
    const metadataMatch = pathname.match(/^\/api\/documents\/([^/]+)\/metadata$/)
    if (metadataMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      try {
        this.json(response, this.ctx.knowledgeMetadata.get(decodeURIComponent(metadataMatch[1] ?? '')))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
        throw error
      }
      return
    }
    const documentTitleMatch = pathname.match(/^\/api\/documents\/([^/]+)\/title$/)
    if (documentTitleMatch !== null) {
      if (method !== 'PUT') return this.methodNotAllowed(response, ['PUT'])
      this.assertSameOrigin(request)
      const input = await this.readJson<UpdateKnowledgeDocumentTitleInput>(request)
      try {
        this.json(response, this.ctx.knowledgeDocuments.updateTitle(decodeURIComponent(documentTitleMatch[1] ?? ''), input))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(error.message === '知识条目不存在' ? 404 : 400, 'invalid_document', error.message)
        throw error
      }
      return
    }
    const markdownNoteMatch = pathname.match(/^\/api\/documents\/([^/]+)\/markdown-note$/)
    if (markdownNoteMatch !== null) {
      if (method !== 'PUT') return this.methodNotAllowed(response, ['PUT'])
      this.assertSameOrigin(request)
      const input = await this.readJson<UpdateKnowledgeMarkdownNoteInput>(request)
      try {
        this.json(response, this.ctx.knowledgeDocuments.updateMarkdownNote(decodeURIComponent(markdownNoteMatch[1] ?? ''), input))
      } catch (error) {
        if (error instanceof RangeError) {
          throw new HttpError(error.message === '知识条目不存在' ? 404 : 400, 'invalid_document', error.message)
        }
        throw error
      }
      return
    }
    const documentTagsMatch = pathname.match(/^\/api\/documents\/([^/]+)\/tags$/)
    if (documentTagsMatch !== null) {
      if (method !== 'PUT') return this.methodNotAllowed(response, ['PUT'])
      this.assertSameOrigin(request)
      const input = await this.readJson<SetKnowledgeDocumentTagsInput>(request)
      try {
        this.json(response, this.ctx.knowledgeMetadata.setTags(decodeURIComponent(documentTagsMatch[1] ?? ''), Array.isArray(input.names) ? input.names : []))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(error.message === '知识条目不存在' ? 404 : 400, 'invalid_tags', error.message)
        throw error
      }
      return
    }
    const documentFavoriteMatch = pathname.match(/^\/api\/documents\/([^/]+)\/favorite$/)
    if (documentFavoriteMatch !== null) {
      if (method !== 'PUT') return this.methodNotAllowed(response, ['PUT'])
      this.assertSameOrigin(request)
      const input = await this.readJson<SetKnowledgeDocumentFavoriteInput>(request)
      if (typeof input.favorite !== 'boolean') throw new HttpError(400, 'invalid_favorite', '收藏状态必须是布尔值')
      try {
        this.json(response, this.ctx.knowledgeMetadata.setFavorite(decodeURIComponent(documentFavoriteMatch[1] ?? ''), input.favorite))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
        throw error
      }
      return
    }
    if (pathname === '/api/tags') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      const result: KnowledgeTagList = { items: this.ctx.knowledgeMetadata.listTags() }
      this.json(response, result)
      return
    }
    const tagRenameMatch = pathname.match(/^\/api\/tags\/([^/]+)$/)
    if (tagRenameMatch !== null) {
      if (method !== 'PUT') return this.methodNotAllowed(response, ['PUT'])
      this.assertSameOrigin(request)
      const input = await this.readJson<RenameKnowledgeTagInput>(request)
      try {
        this.json(response, this.ctx.knowledgeMetadata.renameTag(decodeURIComponent(tagRenameMatch[1] ?? ''), input.name))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(error.message === '标签不存在' ? 404 : 400, 'invalid_tag', error.message)
        throw error
      }
      return
    }
    const tagDocumentsMatch = pathname.match(/^\/api\/tags\/([^/]+)\/documents$/)
    if (tagDocumentsMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      try {
        const result: KnowledgeMetadataDocumentList = { items: this.ctx.knowledgeMetadata.taggedDocuments(decodeURIComponent(tagDocumentsMatch[1] ?? '')) }
        this.json(response, result)
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'tag_not_found', error.message)
        throw error
      }
      return
    }
    if (pathname === '/api/favorites') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      const result: KnowledgeMetadataDocumentList = { items: this.ctx.knowledgeMetadata.favoriteDocuments() }
      this.json(response, result)
      return
    }
    if (pathname === '/api/documents/delete') {
      if (method !== 'POST') return this.methodNotAllowed(response, ['POST'])
      this.assertSameOrigin(request)
      const input = await this.readJson<DeleteKnowledgeDocumentsInput>(request)
      try {
        this.json(response, this.ctx.knowledgeDocuments.delete(Array.isArray(input.ids) ? input.ids : []))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(error.message === '知识条目不存在' ? 404 : 400, 'invalid_delete', error.message)
        throw error
      }
      return
    }
    if (pathname === '/api/search') {
      if (method !== 'POST') return this.methodNotAllowed(response, ['POST'])
      this.assertSameOrigin(request)
      const query = await this.readJson<KnowledgeQuery>(request)
      try {
        this.json(response, this.ctx.knowledgeQuery.search(query))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'invalid_query', error.message)
        throw error
      }
      return
    }
    if (pathname === '/api/graph') {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      const graph = this.ctx.get('knowledgeGraph')
      if (graph === undefined) throw new HttpError(404, 'graph_plugin_disabled', '图谱插件未启用')
      const query: KnowledgeGraphQuery = {}
      const libraryId = url.searchParams.get('libraryId')
      if (libraryId !== null && libraryId.length > 0) query.libraryId = libraryId
      const depth = url.searchParams.get('depth')
      if (depth !== null) query.depth = Number(depth)
      if (url.searchParams.get('includeMissing') === 'false') query.includeMissing = false
      this.json(response, await graph.snapshot(query))
      return
    }
    const documentGraphMatch = pathname.match(/^\/api\/documents\/([^/]+)\/graph$/)
    if (documentGraphMatch !== null) {
      if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
      const graph = this.ctx.get('knowledgeGraph')
      if (graph === undefined) throw new HttpError(404, 'graph_plugin_disabled', '图谱插件未启用')
      const query: KnowledgeGraphQuery = {}
      const libraryId = url.searchParams.get('libraryId')
      if (libraryId !== null && libraryId.length > 0) query.libraryId = libraryId
      const depth = url.searchParams.get('depth')
      if (depth !== null) query.depth = Number(depth)
      if (url.searchParams.get('includeMissing') === 'false') query.includeMissing = false
      try {
        this.json(response, await graph.document(decodeURIComponent(documentGraphMatch[1] ?? ''), query))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
        throw error
      }
      return
    }
    if (pathname.startsWith('/api/')) throw new HttpError(404, 'api_not_found', '接口不存在')
    if (method !== 'GET') return this.methodNotAllowed(response, ['GET'])
    this.staticFile(pathname, response)
  }

  private json(response: ServerResponse, value: unknown, status = 200): void {
    response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    response.end(JSON.stringify(value))
  }

  private methodNotAllowed(response: ServerResponse, methods: string[]): void {
    response.writeHead(405, { allow: methods.join(', ') })
    response.end()
  }

  private assertSameOrigin(request: IncomingMessage): void {
    const host = request.headers.host
    const origin = request.headers.origin
    if (host === undefined || origin === undefined) throw new HttpError(403, 'invalid_origin', '写入请求必须来自当前应用')
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      throw new HttpError(403, 'invalid_origin', '请求来源无效')
    }
    if (originHost !== host) throw new HttpError(403, 'invalid_origin', '写入请求必须来自当前应用')
  }

  private assertTiggyKnowledgeAccess(request: IncomingMessage): void {
    const authorization = request.headers.authorization
    const prefix = 'Bearer '
    if (authorization === undefined || !authorization.startsWith(prefix)) {
      throw new HttpError(401, 'missing_tiggyknowledge_access_key', '缺少智能体访问 Key')
    }
    if (!this.ctx.settings.verifyDshIntegrationAccessKey(authorization.slice(prefix.length).trim())) {
      throw new HttpError(403, 'invalid_tiggyknowledge_access_key', '智能体访问 Key 无效')
    }
  }

  private tiggyKnowledgeDefaultLibraryIds(): string[] {
    const value = this.ctx.settings.snapshot().values.dshIntegration
    const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
    if (!Array.isArray(source.defaultKnowledgeBaseIds)) return []
    const ids: string[] = []
    const seen = new Set<string>()
    for (const item of source.defaultKnowledgeBaseIds) {
      if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue
      seen.add(item)
      ids.push(item)
    }
    return ids
  }

  private scopedTiggyKnowledgeLibraries(): KnowledgeLibrary[] {
    const libraries = this.ctx.knowledgeCatalog.listLibraries()
    const defaultLibraryIds = this.tiggyKnowledgeDefaultLibraryIds()
    if (defaultLibraryIds.length === 0) return libraries
    const allowed = new Set(defaultLibraryIds)
    return libraries.filter(library => allowed.has(library.id))
  }

  private resolveTiggyKnowledgeSearchLibraryIds(requested: unknown): string[] {
    const requestedIds = Array.isArray(requested)
      ? [...new Set(requested.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      : []
    const defaultLibraryIds = this.tiggyKnowledgeDefaultLibraryIds()
    if (defaultLibraryIds.length === 0) return requestedIds
    const allowed = new Set(defaultLibraryIds)
    if (requestedIds.length === 0) return defaultLibraryIds
    return requestedIds.filter(id => allowed.has(id))
  }

  private findTiggyKnowledgeDocument(documentId: string): KnowledgeDocument | undefined {
    if (documentId.length === 0) return undefined
    return this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
  }

  private isTiggyKnowledgeDocumentAllowed(documentId: string): boolean {
    const document = this.findTiggyKnowledgeDocument(documentId)
    if (document === undefined) return true
    const defaultLibraryIds = this.tiggyKnowledgeDefaultLibraryIds()
    return defaultLibraryIds.length === 0 || defaultLibraryIds.includes(document.libraryId)
  }

  private emptyTiggyKnowledgeRead(documentId: string, offset: number): DshKnowledgeReadResponse {
    return {
      available: false,
      documentId,
      knowledgeBaseId: '',
      title: '',
      originalName: '',
      sourceType: 'text',
      content: '',
      offset,
      returnedCharacters: 0,
      totalCharacters: 0,
      hasMore: false,
      sourceTruncated: false,
      truncated: false,
    }
  }

  private emptyTiggyKnowledgeOkf(documentId: string): KnowledgeOkfMapping {
    const now = new Date().toISOString()
    return {
      documentId,
      concept: {
        id: documentId,
        type: 'Concept',
        path: '',
        title: '',
        description: '当前文档不在访问 Key 允许的知识库范围内。',
        tags: [],
        body: '',
        generatedBy: 'process:tiggyknowledge-scope-filter',
        generatedAt: now,
        sources: [],
      },
      storage: {
        bundleState: 'runtime-mapped',
        originalAssetId: '',
        indexStatus: 'ready',
      },
      validation: {
        status: 'not-run',
        message: '当前文档不在访问 Key 允许的知识库范围内，已返回空 OKF 映射。',
      },
    }
  }

  private parseMaxCharacters(url: URL, fallback: number): number {
    const raw = url.searchParams.get('maxCharacters')
    if (raw === null || raw.length === 0) return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new HttpError(400, 'invalid_limit', 'maxCharacters 应为 1 到 100000 之间的整数')
    return value
  }

  private parseOffset(url: URL): number {
    const raw = url.searchParams.get('offset')
    if (raw === null || raw.length === 0) return 0
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new HttpError(400, 'invalid_offset', 'offset 应为大于或等于 0 的安全整数')
    }
    return value
  }

  private async readJson<T>(request: IncomingMessage): Promise<T> {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'unsupported_media_type', '请求必须使用 JSON')
    }
    const body = await this.readBody(request, MAX_JSON_BODY_BYTES)
    try {
      return JSON.parse(body.toString('utf8')) as T
    } catch {
      throw new HttpError(400, 'invalid_json', '请求 JSON 无法解析')
    }
  }

  private async readUploadFiles(request: IncomingMessage): Promise<{ files: { name: string, bytes: Uint8Array }[], tagNames: string[] }> {
    const contentType = request.headers['content-type']
    if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
      throw new HttpError(415, 'unsupported_media_type', '上传请求必须使用 multipart/form-data')
    }
    const body = await this.readBody(request, MAX_UPLOAD_BODY_BYTES)
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined) continue
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
    let form: FormData
    try {
      form = await new Request('http://localhost/upload', { method: 'POST', headers, body: Uint8Array.from(body).buffer }).formData()
    } catch {
      throw new HttpError(400, 'invalid_multipart', '无法解析上传内容')
    }
    const entries = form.getAll('files')
    if (entries.length === 0) throw new HttpError(400, 'empty_upload', '至少选择一个文件')
    if (entries.length > MAX_UPLOAD_FILES) throw new HttpError(400, 'too_many_files', `每次最多上传 ${MAX_UPLOAD_FILES} 个文件`)
    const files: { name: string, bytes: Uint8Array }[] = []
    for (const entry of entries) {
      if (!(entry instanceof File)) throw new HttpError(400, 'invalid_file', '上传字段必须是文件')
      if (entry.size > MAX_UPLOAD_FILE_BYTES) throw new HttpError(413, 'file_too_large', `${entry.name} 超过 25 MB`)
      const name = entry.name.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? ''
      if (name.length === 0 || name.length > 255) throw new HttpError(400, 'invalid_file_name', '文件名无效')
      files.push({ name, bytes: new Uint8Array(await entry.arrayBuffer()) })
    }
    const tagNames = form.getAll('tags').map(value => {
      if (typeof value !== 'string') throw new HttpError(400, 'invalid_tags', '标签必须是文本')
      return value
    })
    return { files, tagNames }
  }

  private async readBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
    const declared = Number(request.headers['content-length'])
    if (Number.isFinite(declared) && declared > maximumBytes) throw new HttpError(413, 'body_too_large', '请求内容过大')
    const chunks: Buffer[] = []
    let size = 0
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      size += chunk.byteLength
      if (size > maximumBytes) throw new HttpError(413, 'body_too_large', '请求内容过大')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  private staticFile(pathname: string, response: ServerResponse): void {
    const decoded = decodeURIComponent(pathname)
    const requested = resolve(this.config.distRoot, `.${decoded}`)
    if (requested !== this.config.distRoot && !requested.startsWith(this.config.distRoot + sep)) {
      response.writeHead(403)
      response.end()
      return
    }
    const candidate = existsSync(requested) && statSync(requested).isFile()
      ? requested
      : resolve(this.config.distRoot, 'index.html')
    if (!existsSync(candidate)) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Web build not found. Run pnpm build:web.')
      return
    }
    const contentType = CONTENT_TYPES[extensionOf(candidate)] ?? 'application/octet-stream'
    response.writeHead(200, {
      'content-type': contentType,
      'cache-control': candidate.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    response.end(readFileSync(candidate))
  }
}

export default WebServer
