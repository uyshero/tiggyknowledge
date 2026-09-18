import type { IncomingMessage } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {
  CapabilitiesSnapshot,
  DshKnowledgeLibraryList,
  DshKnowledgeOkfResponse,
  DshKnowledgeReadResponse,
  DshKnowledgeSearchInput,
  DshKnowledgeSearchResponse,
  DshKnowledgeStatus,
  GenerateDshIntegrationAccessKeyResult,
  KnowledgeCapabilities,
  KnowledgeDocument,
  KnowledgeLibrary,
  KnowledgeOkfMapping,
  KnowledgeSourceReference,
  UpdateDshIntegrationSettingsInput,
} from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/okf'
import type {} from '@tiggyknowledge/plugin-inventory'
import { contributeSurface, HttpError, pathSegment } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/preview-text'
import type {} from '@tiggyknowledge/query'
import type {} from '@tiggyknowledge/semantic-capabilities'
import type {} from '@tiggyknowledge/settings-file'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentApi: AgentApi
    appVersion: string
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
  okfEnabled = true,
): CapabilitiesSnapshot {
  const operations: CapabilitiesSnapshot['capabilities']['operations'] = [
    { id: 'status', method: 'GET', path: '/api/tiggyknowledge/status', readOnly: true },
    { id: 'libraries', method: 'GET', path: '/api/tiggyknowledge/libraries', readOnly: true },
    { id: 'search', method: 'POST', path: '/api/tiggyknowledge/search', readOnly: true },
    { id: 'read', method: 'GET', path: '/api/tiggyknowledge/documents/:id/read', readOnly: true },
  ]
  if (okfEnabled) {
    operations.push({ id: 'okf', method: 'GET', path: '/api/tiggyknowledge/documents/:id/okf', readOnly: true })
  }
  return {
    product: 'tiggyknowledge',
    version,
    capabilities: {
      protocolVersion: 1,
      basePath: '/api/tiggyknowledge',
      authentication: 'bearer',
      operations,
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

export class AgentApi extends Service {
  static inject = [
    'knowledgeCatalog',
    'knowledgePreview',
    'knowledgeQuery',
    'knowledgeSemanticCapabilities',
    'pluginInventory',
    'settings',
  ]

  constructor(ctx: Context) {
    super(ctx, 'agentApi')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-settings-dsh-integration',
        moduleName: '@tiggyknowledge/client-settings-dsh-integration',
        label: '智能体集成',
        description: '智能体接入与只读知识库配置',
      }],
      routes: [
        {
          id: 'agent:capabilities',
          methods: ['GET'],
          path: '/api/capabilities',
          handler: ({ json }) => {
            json(createCapabilitiesSnapshot(
              this.ctx.knowledgeSemanticCapabilities.snapshot().enabledModes,
              this.ctx.pluginInventory.list(),
              this.ctx.appVersion,
              this.okfEnabled(),
            ))
          },
        },
        {
          id: 'agent:integration-settings',
          methods: ['PUT'],
          path: '/api/settings/agent-integration',
          handler: async ({ assertSameOrigin, json, readJson }) => {
            assertSameOrigin()
            const input = await readJson<UpdateDshIntegrationSettingsInput>()
            try {
              json(this.ctx.settings.updateDshIntegration(input))
            } catch (error) {
              if (error instanceof RangeError) throw new HttpError(400, 'invalid_agent_integration_settings', error.message)
              throw error
            }
          },
        },
        {
          id: 'agent:integration-access-key',
          methods: ['POST'],
          path: '/api/settings/agent-integration/access-key',
          handler: ({ assertSameOrigin, json }) => {
            assertSameOrigin()
            const result: GenerateDshIntegrationAccessKeyResult = this.ctx.settings.generateDshIntegrationAccessKey()
            json(result, 201)
          },
        },
        {
          id: 'agent:status',
          methods: ['GET'],
          path: '/api/tiggyknowledge/status',
          handler: ({ request, json }) => {
            this.assertAccess(request)
            const catalog = this.ctx.knowledgeCatalog.summary()
            const scopedLibraries = this.scopedLibraries()
            const status: DshKnowledgeStatus = {
              product: 'tiggyknowledge',
              version: this.ctx.appVersion,
              dataDirectory: catalog.dataDirectory,
              libraries: scopedLibraries.length,
              documents: scopedLibraries.reduce((total, library) => total + library.documentCount, 0),
              capabilities: { search: true, read: true, okf: this.okfEnabled(), write: false },
            }
            json(status)
          },
        },
        {
          id: 'agent:libraries',
          methods: ['GET'],
          path: '/api/tiggyknowledge/libraries',
          handler: ({ request, json }) => {
            this.assertAccess(request)
            const result: DshKnowledgeLibraryList = { items: this.scopedLibraries() }
            json(result)
          },
        },
        {
          id: 'agent:search',
          methods: ['POST'],
          path: '/api/tiggyknowledge/search',
          handler: async ({ request, json, readJson }) => {
            this.assertAccess(request)
            const input = await readJson<DshKnowledgeSearchInput>()
            try {
              const search = this.ctx.knowledgeQuery.search({
                text: input.query,
                knowledgeBaseIds: this.resolveSearchLibraryIds(input.knowledgeBaseIds),
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
              json(result)
            } catch (error) {
              if (error instanceof RangeError) throw new HttpError(400, 'invalid_tiggyknowledge_query', error.message)
              throw error
            }
          },
        },
        {
          id: 'agent:read',
          methods: ['GET'],
          path: /^\/api\/tiggyknowledge\/documents\/([^/]+)\/read$/,
          handler: async ({ request, url, json, match }) => {
            this.assertAccess(request)
            const maxCharacters = parseMaxCharacters(url, 20_000)
            const offset = parseOffset(url)
            const documentId = pathSegment(match)
            if (!this.isDocumentAllowed(documentId)) {
              json(emptyRead(documentId, offset))
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
              json(result)
            } catch (error) {
              if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
              throw error
            }
          },
        },
      ],
    })
    ctx.inject(['knowledgeOkf'], ctx => {
      contributeSurface(ctx, {
        routes: [{
          id: 'agent:okf',
          methods: ['GET'],
          path: /^\/api\/tiggyknowledge\/documents\/([^/]+)\/okf$/,
          handler: async ({ request, url, json, match }) => {
            this.assertAccess(request)
            const maxCharacters = parseMaxCharacters(url, 20_000)
            const documentId = pathSegment(match)
            if (!this.isDocumentAllowed(documentId)) {
              json(emptyOkf(documentId))
              return
            }
            try {
              const mapping = await this.ctx.knowledgeOkf.mapping(documentId)
              mapping.concept.body = mapping.concept.body.slice(0, maxCharacters)
              const document = this.findDocument(documentId)
              const result: DshKnowledgeOkfResponse = {
                ...mapping,
                ...(document === undefined ? {} : { reference: createKnowledgeSourceReference(document) }),
              }
              json(result)
            } catch (error) {
              if (error instanceof RangeError) throw new HttpError(404, 'document_not_found', error.message)
              throw error
            }
          },
        }],
      })
    })
  }

  private okfEnabled(): boolean {
    return this.ctx.get('knowledgeOkf') !== undefined
  }

  private assertAccess(request: IncomingMessage): void {
    const authorization = request.headers.authorization
    const prefix = 'Bearer '
    if (typeof authorization !== 'string' || !authorization.startsWith(prefix)) {
      throw new HttpError(401, 'missing_tiggyknowledge_access_key', '缺少智能体访问 Key')
    }
    if (!this.ctx.settings.verifyDshIntegrationAccessKey(authorization.slice(prefix.length).trim())) {
      throw new HttpError(403, 'invalid_tiggyknowledge_access_key', '智能体访问 Key 无效')
    }
  }

  private defaultLibraryIds(): string[] {
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

  private scopedLibraries(): KnowledgeLibrary[] {
    const libraries = this.ctx.knowledgeCatalog.listLibraries()
    const defaultLibraryIds = this.defaultLibraryIds()
    if (defaultLibraryIds.length === 0) return libraries
    const allowed = new Set(defaultLibraryIds)
    return libraries.filter(library => allowed.has(library.id))
  }

  private resolveSearchLibraryIds(requested: unknown): string[] {
    const requestedIds = Array.isArray(requested)
      ? [...new Set(requested.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      : []
    const defaultLibraryIds = this.defaultLibraryIds()
    if (defaultLibraryIds.length === 0) return requestedIds
    const allowed = new Set(defaultLibraryIds)
    if (requestedIds.length === 0) return defaultLibraryIds
    return requestedIds.filter(id => allowed.has(id))
  }

  private findDocument(documentId: string): KnowledgeDocument | undefined {
    if (documentId.length === 0) return undefined
    return this.ctx.knowledgeCatalog.getDocuments([documentId])[0]
  }

  private isDocumentAllowed(documentId: string): boolean {
    const document = this.findDocument(documentId)
    if (document === undefined) return true
    const defaultLibraryIds = this.defaultLibraryIds()
    return defaultLibraryIds.length === 0 || defaultLibraryIds.includes(document.libraryId)
  }
}

function parseMaxCharacters(url: URL, fallback: number): number {
  const raw = url.searchParams.get('maxCharacters')
  if (raw === null || raw.length === 0) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new HttpError(400, 'invalid_limit', 'maxCharacters 应为 1 到 100000 之间的整数')
  return value
}

function parseOffset(url: URL): number {
  const raw = url.searchParams.get('offset')
  if (raw === null || raw.length === 0) return 0
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, 'invalid_offset', 'offset 应为大于或等于 0 的安全整数')
  }
  return value
}

function emptyRead(documentId: string, offset: number): DshKnowledgeReadResponse {
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

function emptyOkf(documentId: string): KnowledgeOkfMapping {
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

export default AgentApi
