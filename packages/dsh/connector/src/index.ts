import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tiggyknowledge-dsh-connector'
export const inject = ['tools', 'settings']

const DEFAULT_TOKEN_CREDENTIAL_REF = 'TIGGYKNOWLEDGE_TOKEN'

export interface Config {
  endpoint?: string
  token?: string
  tools?: {
    search?: boolean
    read?: boolean
    okf?: boolean
    write?: false
  }
}

export const Config: z<Config> = z.object({
  endpoint: z.string().default('http://127.0.0.1:3210'),
  token: z.string().role('secret').default(''),
  tools: z.object({
    search: z.boolean().default(true),
    read: z.boolean().default(true),
    okf: z.boolean().default(true),
    write: z.const(false).default(false),
  }).default({ search: true, read: true, okf: true, write: false }),
})

interface ConnectorConfig {
  endpoint: string
  token?: string
  tools: {
    search: boolean
    read: boolean
    okf: boolean
    write: false
  }
}

interface Library {
  id: string
  name: string
  description: string
  documentCount: number
  createdAt: string
  updatedAt: string
}

interface SearchResult {
  documentId: string
  knowledgeBaseId: string
  title: string
  originalName: string
  sourceType: 'text' | 'markdown' | 'pdf'
  location: string
  snippet: string
  score: number
  tags: { name: string }[]
  isFavorite: boolean
}

interface SearchResponse {
  query: string
  mode: 'keyword'
  total: number
  results: SearchResult[]
}

interface ReadResponse {
  documentId: string
  knowledgeBaseId: string
  title: string
  originalName: string
  sourceType: 'text' | 'markdown' | 'pdf'
  content: string
  offset: number
  returnedCharacters: number
  totalCharacters: number
  hasMore: boolean
  nextOffset?: number
  sourceTruncated: boolean
  truncated: boolean
  available?: boolean
  pageCount?: number
}

interface CredentialProviderLike {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

interface SettingsScopeLike<T> {
  get(): T
  watch(callback: (next: T) => void): () => void
}

interface SettingsProviderLike {
  register<T>(ns: string, schema: z<T>, options: { applies: 'restart'; base: Partial<T> }): SettingsScopeLike<T>
}

function resolveConfig(config: Config): ConnectorConfig {
  const endpoint = (config.endpoint ?? 'http://127.0.0.1:3210').replace(/\/+$/, '')
  const token = config.token !== undefined && config.token.length > 0 ? config.token : undefined
  return {
    endpoint,
    ...token === undefined ? {} : { token },
    tools: {
      search: config.tools?.search ?? true,
      read: config.tools?.read ?? true,
      okf: config.tools?.okf ?? true,
      write: false,
    },
  }
}

function credentialsOf(ctx: Context): CredentialProviderLike | undefined {
  return ctx.get('credentials') as CredentialProviderLike | undefined
}

function settingsOf(ctx: Context): SettingsProviderLike | undefined {
  return ctx.get('settings') as SettingsProviderLike | undefined
}

async function resolveToken(ctx: Context, config: ConnectorConfig): Promise<string> {
  const credentials = credentialsOf(ctx)
  if (credentials !== undefined) {
    const hit = await credentials.resolve(DEFAULT_TOKEN_CREDENTIAL_REF)
    if (hit !== undefined && hit.value.length > 0) return hit.value
  } else {
    const ambient = process.env[DEFAULT_TOKEN_CREDENTIAL_REF]
    if (ambient !== undefined && ambient.length > 0) return ambient
  }
  if (config.token !== undefined && config.token.length > 0) return config.token
  throw new Error(
    `tiggyknowledge connector: no access key for ${DEFAULT_TOKEN_CREDENTIAL_REF}; store it through dsh credentials or export ${DEFAULT_TOKEN_CREDENTIAL_REF}`,
  )
}

async function request<T>(ctx: Context, config: ConnectorConfig, path: string, init: RequestInit = {}): Promise<T> {
  const token = await resolveToken(ctx, config)
  const response = await fetch(`${config.endpoint}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: string } | undefined
    throw new Error(body?.message ?? `tiggyknowledge returned ${response.status}`)
  }
  return await response.json() as T
}

export function apply(ctx: Context, config: Config): void {
  let resolved = resolveConfig(config)
  const settings = settingsOf(ctx)
  if (settings !== undefined) {
    const scope = settings.register('tiggyknowledge', Config, { applies: 'restart', base: config })
    resolved = resolveConfig(scope.get())
    ctx.effect(() => scope.watch(next => {
      resolved = resolveConfig(next)
    }), 'tiggyknowledge connector: settings')
  }

  ctx.tools.register(defineTool({
    name: 'knowledge_status',
    description: 'Check whether the local tiggyknowledge sidecar is reachable and summarize its read-only knowledge capabilities.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (_args, exec) => await request(ctx, resolved, '/api/tiggyknowledge/status', { signal: exec.signal }),
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_list_libraries',
    description: 'List tiggyknowledge knowledge bases available to the connector.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                documentCount: { type: 'integer', required: true },
                createdAt: { type: 'string', required: true },
                updatedAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value: { items: Library[] }) => [{
        type: 'text',
        text: value.items.length === 0
          ? 'tiggyknowledge 当前没有知识库。'
          : value.items.map(item => `- ${item.name} (${item.id}) · ${item.documentCount} documents`).join('\n'),
      }],
    },
    execute: async (_args, exec) => await request(ctx, resolved, '/api/tiggyknowledge/libraries', { signal: exec.signal }),
  }))

  if (resolved.tools.search) {
    ctx.tools.register(defineTool({
      name: 'knowledge_search',
      description: 'Search tiggyknowledge. Use knowledgeBaseIds to target specific libraries; omit it to search all knowledge bases.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search query.' },
        knowledgeBaseIds: { type: 'array', items: { type: 'string' }, description: 'Optional tiggyknowledge library ids. Omitted means all knowledge bases.' },
        topK: { type: 'integer', description: 'Maximum results, 1-50.' },
        favoriteOnly: { type: 'boolean', description: 'Only return favorite documents.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const search = value as unknown as SearchResponse
          return [{
            type: 'text',
            text: search.results.length === 0
              ? `No tiggyknowledge results for ${JSON.stringify(search.query)}.`
              : search.results.map(result => [
              `- ${result.title} (${result.documentId})`,
              `  library: ${result.knowledgeBaseId}; source: ${result.sourceType}; score: ${result.score}`,
              `  snippet: ${result.snippet}`,
            ].join('\n')).join('\n'),
          }]
        },
      },
      execute: async (args, exec) => await request(ctx, resolved, '/api/tiggyknowledge/search', {
        body: JSON.stringify({
          favoriteOnly: args.favoriteOnly,
          knowledgeBaseIds: args.knowledgeBaseIds,
          query: args.query,
          topK: args.topK,
        }),
        method: 'POST',
        signal: exec.signal,
      }),
    }))
  }

  if (resolved.tools.read) {
    ctx.tools.register(defineTool({
      name: 'knowledge_read',
      description: 'Read a tiggyknowledge document by documentId. Use after knowledge_search when more source context is needed.',
      parameters: {
        documentId: { type: 'string', required: true, description: 'tiggyknowledge document id.' },
        offset: { type: 'integer', description: 'Zero-based character offset. Use nextOffset from the previous result to continue reading.' },
        maxCharacters: { type: 'integer', description: 'Maximum characters to return, 1-100000. Defaults to 20000.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const read = value as unknown as ReadResponse
          if (read.available === false) {
            return [{ type: 'text', text: `Document ${read.documentId} is outside the current TiggyKnowledge access-key scope.` }]
          }
          return [{
            type: 'text',
            text: [
            `${read.title} (${read.documentId})`,
            `library: ${read.knowledgeBaseId}; source: ${read.sourceType}`,
            `characters: ${read.offset}-${read.offset + read.returnedCharacters} of ${read.totalCharacters}; hasMore: ${String(read.hasMore)}`,
            ...(read.hasMore && read.nextOffset !== undefined
              ? [`Continue with knowledge_read using documentId ${JSON.stringify(read.documentId)} and offset ${read.nextOffset}.`]
              : []),
            ...(read.sourceTruncated ? ['The source extractor reached its safety limit; no content exists beyond the reported total.'] : []),
            '',
            read.content,
          ].join('\n'),
          }]
        },
      },
      execute: async (args, exec) => {
        const params = new URLSearchParams()
        if (args.maxCharacters !== undefined) params.set('maxCharacters', String(args.maxCharacters))
        if (args.offset !== undefined) params.set('offset', String(args.offset))
        const suffix = params.size > 0 ? `?${params.toString()}` : ''
        return await request(ctx, resolved, `/api/tiggyknowledge/documents/${encodeURIComponent(args.documentId)}/read${suffix}`, { signal: exec.signal })
      },
    }))
  }

  if (resolved.tools.okf) {
    ctx.tools.register(defineTool({
      name: 'knowledge_okf',
      description: 'Read the OKF mapping for a tiggyknowledge document by documentId.',
      parameters: {
        documentId: { type: 'string', required: true, description: 'tiggyknowledge document id.' },
        maxCharacters: { type: 'integer', description: 'Maximum concept body characters, 1-100000. Defaults to 20000.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args, exec) => {
        const params = new URLSearchParams()
        if (args.maxCharacters !== undefined) params.set('maxCharacters', String(args.maxCharacters))
        const suffix = params.size > 0 ? `?${params.toString()}` : ''
        return await request(ctx, resolved, `/api/tiggyknowledge/documents/${encodeURIComponent(args.documentId)}/okf${suffix}`, { signal: exec.signal })
      },
    }))
  }
}
