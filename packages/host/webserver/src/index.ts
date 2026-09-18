import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { resolve, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SystemSnapshot } from '@tiggyknowledge/contracts'
import { HttpError } from '@tiggyknowledge/http-router'
import type {} from '@tiggyknowledge/http-router'

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
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function extensionOf(path: string): string {
  const at = path.lastIndexOf('.')
  return at < 0 ? '' : path.slice(at)
}

export class WebServer extends Service {
  static inject = ['httpRouter']

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
          json(response, { error: error.code, message: error.message }, error.status)
          return
        }
        this.ctx.logger('webserver').error(error)
        json(response, { error: 'internal_error', message: '服务暂时不可用' }, 500)
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
      if (method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      json(response, { status: 'ok' })
      return
    }
    if (pathname === '/api/system') {
      if (method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      const snapshot: SystemSnapshot = {
        product: 'tiggyknowledge',
        version: this.ctx.appVersion,
        ...this.ctx.httpRouter.snapshot(),
      } as SystemSnapshot
      json(response, snapshot)
      return
    }
    if (await this.ctx.httpRouter.dispatch(request, response, url)) return
    if (pathname.startsWith('/api/')) throw new HttpError(404, 'api_not_found', '接口不存在')
    if (method !== 'GET') {
      response.writeHead(405, { allow: 'GET' })
      response.end()
      return
    }
    this.staticFile(pathname, response)
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

function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

export default WebServer
