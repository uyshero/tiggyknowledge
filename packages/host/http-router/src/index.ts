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

export interface HttpUpload {
  files: { name: string, bytes: Uint8Array }[]
  tagNames: string[]
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
  readJson<T>(maxBytes?: number): Promise<T>
  readUpload(): Promise<HttpUpload>
}

export interface HttpRouteDefinition {
  id: string
  methods: readonly HttpMethod[]
  path: string | RegExp
  handler(context: HttpRouteContext): void | Promise<void>
}

const MAX_JSON_BODY_BYTES = 16 * 1024
const MAX_UPLOAD_BODY_BYTES = 50 * 1024 * 1024
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024
const MAX_UPLOAD_FILES = 50

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
    const allowed = new Set<HttpMethod>()
    let pathMatched = false
    for (const route of this.routes.values()) {
      const match = typeof route.path === 'string'
        ? route.path === pathname ? undefined : null
        : pathname.match(route.path)
      if (match === null) continue
      pathMatched = true
      if (!route.methods.includes(method as HttpMethod)) {
        for (const allowedMethod of route.methods) allowed.add(allowedMethod)
        continue
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
        readJson: async <T>(maxBytes?: number) => await readJson<T>(request, maxBytes),
        readUpload: async () => await readUpload(request),
      }
      await route.handler(context)
      return true
    }
    if (!pathMatched) return false
    response.writeHead(405, { allow: [...allowed].join(', ') })
    response.end()
    return true
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

async function readJson<T>(request: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<T> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', '请求必须使用 JSON')
  }
  const buffer = await readBody(request, maxBytes)
  try {
    return JSON.parse(buffer.toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'invalid_json', '请求 JSON 无法解析')
  }
}

async function readUpload(request: IncomingMessage): Promise<HttpUpload> {
  const contentType = request.headers['content-type']
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'unsupported_media_type', '上传请求必须使用 multipart/form-data')
  }
  const body = await readBody(request, MAX_UPLOAD_BODY_BYTES)
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
  const files: HttpUpload['files'] = []
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
