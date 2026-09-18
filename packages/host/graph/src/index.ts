import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {} from '@tiggyknowledge/document-metadata'
import type { KnowledgeDocument, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphQuery, KnowledgeGraphResponse, KnowledgeTag } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/preview-text'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeGraph: KnowledgeGraph
  }
}

interface GraphDocumentRecord {
  document: KnowledgeDocument
  libraryName: string
  tags: KnowledgeTag[]
  content: string
  links: string[]
}

interface GraphState {
  documents: GraphDocumentRecord[]
  recordsById: Map<string, GraphDocumentRecord>
  nodesById: Map<string, KnowledgeGraphNode>
  edges: KnowledgeGraphEdge[]
  outgoing: Map<string, Set<string>>
  incoming: Map<string, Set<string>>
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replaceAll(/\s+/gu, ' ')
}

function isExternalLink(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

function stripTarget(target: string): string {
  const trimmed = target.trim().replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '')
  const beforeHash = trimmed.split('#')[0] ?? trimmed
  const beforeQuery = beforeHash.split('?')[0] ?? beforeHash
  return beforeQuery.trim()
}

function documentKeys(document: KnowledgeDocument): string[] {
  const original = document.originalName.replaceAll('\\', '/')
  const basename = original.split('/').at(-1) ?? original
  const stem = basename.replace(/\.[^.]+$/u, '')
  return unique([
    normalizeKey(document.title),
    normalizeKey(document.originalName),
    normalizeKey(original),
    normalizeKey(basename),
    normalizeKey(stem),
    normalizeKey(document.id),
  ])
}

function candidateKeys(raw: string): string[] {
  const cleaned = stripTarget(raw).replaceAll('\\', '/')
  const basename = cleaned.split('/').at(-1) ?? cleaned
  const stem = basename.replace(/\.[^.]+$/u, '')
  return unique([
    normalizeKey(cleaned),
    normalizeKey(basename),
    normalizeKey(stem),
  ])
}

function extractTargets(content: string): string[] {
  const targets: string[] = []
  const markdownLink = /\[[^\]]*]\(([^)]+)\)/g
  const wikiLink = /\[\[([^[\]]+)\]\]/g
  for (const match of content.matchAll(markdownLink)) {
    if (match[1] !== undefined) targets.push(match[1])
  }
  for (const match of content.matchAll(wikiLink)) {
    if (match[1] !== undefined) targets.push(match[1])
  }
  return targets
}

function hashTarget(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

function neighborhood(documentId: string, depth: number, outgoing: Map<string, Set<string>>, incoming: Map<string, Set<string>>): Set<string> {
  const result = new Set<string>([documentId])
  let frontier = new Set<string>([documentId])
  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>()
    for (const current of frontier) {
      const neighbors = new Set<string>([...(outgoing.get(current) ?? []), ...(incoming.get(current) ?? [])])
      for (const neighbor of neighbors) {
        if (result.has(neighbor)) continue
        result.add(neighbor)
        next.add(neighbor)
      }
    }
    frontier = next
  }
  return result
}

export class KnowledgeGraph extends Service {
  static inject = ['knowledgeCatalog', 'knowledgeMetadata', 'knowledgePreview']

  private state: GraphState | undefined
  private building: Promise<GraphState> | undefined

  constructor(ctx: Context) {
    super(ctx, 'knowledgeGraph')
    ctx.on('knowledge/graph/invalidate', () => this.invalidate())
    contributeSurface(ctx, {
      routes: [
        {
          id: 'graph:snapshot',
          methods: ['GET'],
          path: '/api/graph',
          handler: async ({ url, json }) => {
            json(await this.snapshot(graphQuery(url)))
          },
        },
        {
          id: 'graph:document',
          methods: ['GET'],
          path: /^\/api\/documents\/([^/]+)\/graph$/,
          handler: async ({ url, json, match }) => {
            try {
              json(await this.document(pathSegment(match), graphQuery(url)))
            } catch (error) {
              throw httpFromRange(error, 'document_not_found')
            }
          },
        },
      ],
    })
  }

  invalidate(): void {
    this.state = undefined
  }

  async snapshot(query: KnowledgeGraphQuery = {}): Promise<KnowledgeGraphResponse> {
    const state = await this.ensureState()
    const libraryId = typeof query.libraryId === 'string' && query.libraryId.length > 0 ? query.libraryId : undefined
    const documentId = typeof query.documentId === 'string' && query.documentId.length > 0 ? query.documentId : undefined
    const depth = Number.isInteger(query.depth) && (query.depth ?? 0) >= 0 ? Math.min(6, query.depth ?? 0) : 1
    const includeMissing = query.includeMissing !== false

    if (documentId !== undefined) {
      const next: KnowledgeGraphQuery = { depth, includeMissing }
      if (libraryId !== undefined) next.libraryId = libraryId
      return this.document(documentId, next)
    }

    const selected = state.documents.filter(record => libraryId === undefined || record.document.libraryId === libraryId)
    const selectedIds = new Set(selected.map(record => record.document.id))
    const edges = state.edges.filter(edge => selectedIds.has(edge.source) && (selectedIds.has(edge.target) || (includeMissing && edge.target.startsWith('missing:'))))
    const nodes = selected.flatMap(record => [state.nodesById.get(record.document.id)])
      .filter((node): node is KnowledgeGraphNode => node !== undefined)
    const missingNodes = includeMissing
      ? [...new Set(edges.map(edge => edge.target).filter(id => id.startsWith('missing:')))]
        .map(id => state.nodesById.get(id))
        .filter((node): node is KnowledgeGraphNode => node !== undefined)
      : []
    return {
      scope: 'global',
      generatedAt: new Date().toISOString(),
      depth,
      ...(libraryId === undefined ? {} : { libraryId }),
      nodes: [...nodes, ...missingNodes],
      edges,
    }
  }

  async document(documentId: string, query: Pick<KnowledgeGraphQuery, 'depth' | 'includeMissing' | 'libraryId'> = {}): Promise<KnowledgeGraphResponse> {
    const state = await this.ensureState()
    const center = state.recordsById.get(documentId)
    if (center === undefined) throw new RangeError('知识条目不存在')
    const depth = Number.isInteger(query.depth) && (query.depth ?? 0) >= 0 ? Math.min(6, query.depth ?? 0) : 1
    const includeMissing = query.includeMissing !== false
    const visited = neighborhood(documentId, depth, state.outgoing, state.incoming)

    let scopeIds = visited
    if (typeof query.libraryId === 'string' && query.libraryId.length > 0) {
      const filtered = new Set([...visited].filter(id => {
        const node = state.nodesById.get(id)
        return node !== undefined && (!node.documentId || node.libraryId === query.libraryId)
      }))
      filtered.add(documentId)
      scopeIds = filtered
    }

    const edges = state.edges.filter(edge => scopeIds.has(edge.source) && (scopeIds.has(edge.target) || (includeMissing && edge.target.startsWith('missing:'))))
    const nodes = [...scopeIds].map(id => state.nodesById.get(id)).filter((node): node is KnowledgeGraphNode => node !== undefined)
    const missingNodes = includeMissing
      ? [...new Set(edges.map(edge => edge.target).filter(id => id.startsWith('missing:')))]
        .map(id => state.nodesById.get(id))
        .filter((node): node is KnowledgeGraphNode => node !== undefined)
      : []

    return {
      scope: 'local',
      generatedAt: new Date().toISOString(),
      depth,
      centerDocumentId: documentId,
      ...(typeof query.libraryId === 'string' && query.libraryId.length > 0 ? { libraryId: query.libraryId } : {}),
      nodes: [...nodes, ...missingNodes],
      edges,
    }
  }

  private async ensureState(): Promise<GraphState> {
    if (this.state !== undefined) return this.state
    if (this.building !== undefined) return await this.building
    this.building = this.rebuild()
    try {
      this.state = await this.building
      return this.state
    } finally {
      this.building = undefined
    }
  }

  private async rebuild(): Promise<GraphState> {
    const libraries = new Map(this.ctx.knowledgeCatalog.listLibraries().map(library => [library.id, library.name]))
    const documents = this.ctx.knowledgeCatalog.listLibraries().flatMap(library => this.ctx.knowledgeCatalog.listDocuments(library.id))
    const metadata = this.ctx.knowledgeMetadata.getMany(documents.map(document => document.id))
    const records: GraphDocumentRecord[] = []
    for (const document of documents) {
      try {
        const preview = await this.ctx.knowledgePreview.preview(document.id)
        records.push({
          document,
          libraryName: libraries.get(document.libraryId) ?? '未知知识库',
          tags: metadata.get(document.id)?.tags ?? [],
          content: preview.content,
          links: extractTargets(preview.content),
        })
      } catch {
        records.push({
          document,
          libraryName: libraries.get(document.libraryId) ?? '未知知识库',
          tags: metadata.get(document.id)?.tags ?? [],
          content: '',
          links: [],
        })
      }
    }

    const keys = new Map<string, string[]>()
    for (const record of records) {
      for (const key of documentKeys(record.document)) {
        const list = keys.get(key)
        if (list === undefined) keys.set(key, [record.document.id])
        else if (!list.includes(record.document.id)) list.push(record.document.id)
      }
    }

    const nodesById = new Map<string, KnowledgeGraphNode>()
    const edges: KnowledgeGraphEdge[] = []
    const outgoing = new Map<string, Set<string>>()
    const incoming = new Map<string, Set<string>>()
    const edgeIds = new Set<string>()
    const missing = new Map<string, KnowledgeGraphNode>()

    for (const record of records) {
      const node: KnowledgeGraphNode = {
        id: record.document.id,
        label: record.document.title,
        kind: 'document',
        libraryId: record.document.libraryId,
        libraryName: record.libraryName,
        documentId: record.document.id,
        originalName: record.document.originalName,
        sourceType: record.document.sourceType,
        tags: record.tags,
        linkCount: 0,
        incomingCount: 0,
        outgoingCount: 0,
      }
      nodesById.set(node.id, node)
    }

    const resolveDocument = (source: GraphDocumentRecord, target: string): KnowledgeDocument | undefined => {
      const candidates = candidateKeys(target)
      for (const key of candidates) {
        const matches = keys.get(key) ?? []
        const sameLibrary = matches.find(id => records.find(record => record.document.id === id)?.document.libraryId === source.document.libraryId)
        if (sameLibrary !== undefined) return records.find(record => record.document.id === sameLibrary)?.document
      }
      for (const key of candidates) {
        const matches = keys.get(key) ?? []
        if (matches[0] !== undefined) return records.find(record => record.document.id === matches[0])?.document
      }
      return undefined
    }

    for (const record of records) {
      for (const raw of record.links) {
        if (isExternalLink(raw)) continue
        const target = stripTarget(raw)
        if (target.length === 0 || target.startsWith('#')) continue
        const resolved = resolveDocument(record, target)
        if (resolved?.id === record.document.id) continue
        const targetId = resolved?.id ?? `missing:${hashTarget(target)}`
        if (resolved === undefined) {
          if (!missing.has(targetId)) {
            missing.set(targetId, {
              id: targetId,
              label: target,
              kind: 'missing',
              tags: [],
              linkCount: 0,
              incomingCount: 0,
              outgoingCount: 0,
              missing: true,
            })
          }
        }
        const edgeId = `${record.document.id}->${targetId}`
        if (edgeIds.has(edgeId)) continue
        edgeIds.add(edgeId)
        const edge: KnowledgeGraphEdge = { id: edgeId, source: record.document.id, target: targetId }
        if (resolved !== undefined) edge.label = '链接'
        edges.push(edge)
        outgoing.set(record.document.id, new Set([...(outgoing.get(record.document.id) ?? []), targetId]))
        incoming.set(targetId, new Set([...(incoming.get(targetId) ?? []), record.document.id]))
      }
    }

    for (const node of nodesById.values()) {
      node.outgoingCount = outgoing.get(node.id)?.size ?? 0
      node.incomingCount = incoming.get(node.id)?.size ?? 0
      node.linkCount = node.outgoingCount + node.incomingCount
    }

    for (const node of missing.values()) {
      node.outgoingCount = outgoing.get(node.id)?.size ?? 0
      node.incomingCount = incoming.get(node.id)?.size ?? 0
      node.linkCount = node.outgoingCount + node.incomingCount
      nodesById.set(node.id, node)
    }

    return {
      documents: records,
      recordsById: new Map(records.map(record => [record.document.id, record])),
      nodesById,
      edges,
      outgoing,
      incoming,
    }
  }
}

function graphQuery(url: URL): KnowledgeGraphQuery {
  const query: KnowledgeGraphQuery = {}
  const libraryId = url.searchParams.get('libraryId')
  if (libraryId !== null && libraryId.length > 0) query.libraryId = libraryId
  const depth = url.searchParams.get('depth')
  if (depth !== null) query.depth = Number(depth)
  if (url.searchParams.get('includeMissing') === 'false') query.includeMissing = false
  return query
}

export default KnowledgeGraph
