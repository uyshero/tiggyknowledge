import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    httpRouter: HttpRouter
  }
}

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface HttpRouteContext {
  request: IncomingMessage
  response: ServerResponse
  method: string
  url: URL
  pathname: string
  match?: RegExpMatchArray
  assertSameOrigin(): void
  json(value: unknown, status?: number): void
  readJson<T>(): Promise<T>
}

export interface HttpRouteDefinition {
  id: string
  methods: readonly HttpMethod[]
  path: string | RegExp
  handler(context: HttpRouteContext): void | Promise<void>
}

const MAX_JSON_BODY_BYTES = 16 * 1024

export class HttpRouter extends Service {
  private readonly routes = new Map<string, HttpRouteDefinition>()
  private readonly snapshotContributors = new Map<string, () => Record<string, unknown>>()

  constructor(ctx: Context) {
    super(ctx, 'httpRouter')
  }

  register(route: HttpRouteDefinition): () => void {
    if (this.routes.has(route.id)) throw new Error(`http-router: duplicate route id ${route.id}`)
    if (route.methods.length === 0) throw new Error(`http-router: route ${route.id} has no methods`)
    if (route.path instanceof RegExp && (route.path.global || route.path.sticky)) {
      throw new Error(`http-router: route ${route.id} must not use a global or sticky expression`)
    }
    this.routes.set(route.id, route)
    return () => this.routes.delete(route.id)
  }

  registerSnapshotContributor(id: string, contributor: () => Record<string, unknown>): () => void {
    if (this.snapshotContributors.has(id)) throw new Error(`http-router: duplicate snapshot contributor ${id}`)
    this.snapshotContributors.set(id, contributor)
    return () => this.snapshotContributors.delete(id)
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [id, contributor] of this.snapshotContributors) {
      const values = contributor()
      for (const [key, value] of Object.entries(values)) {
        if (Object.hasOwn(result, key)) throw new Error(`http-router: duplicate snapshot field ${key} from ${id}`)
        result[key] = value
      }
    }
    return result
  }

  async dispatch(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    const pathname = url.pathname
    const method = request.method ?? 'GET'
    for (const route of this.routes.values()) {
      const match = typeof route.path === 'string'
        ? route.path === pathname ? undefined : null
        : pathname.match(route.path)
      if (match === null) continue
      if (!route.methods.includes(method as HttpMethod)) {
        response.writeHead(405, { allow: route.methods.join(', ') })
        response.end()
        return true
      }
      const context: HttpRouteContext = {
        request,
        response,
        method,
        url,
        pathname,
        ...(match === undefined ? {} : { match }),
        assertSameOrigin: () => assertSameOrigin(request),
        json: (value, status = 200) => json(response, value, status),
        readJson: async <T>() => await readJson<T>(request),
      }
      await route.handler(context)
      return true
    }
    return false
  }
}

function assertSameOrigin(request: IncomingMessage): void {
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

function json(response: ServerResponse, value: unknown, status: number): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', '请求必须使用 JSON')
  }
  const buffer = await readBody(request, MAX_JSON_BODY_BYTES)
  try {
    return JSON.parse(buffer.toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'invalid_json', '请求 JSON 无法解析')
  }
}

async function readBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maximumBytes) throw new HttpError(413, 'body_too_large', '请求内容过大')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximumBytes) throw new HttpError(413, 'body_too_large', '请求内容过大')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export default HttpRouter
