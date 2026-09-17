import { Context, Service } from '@deepseek-ai/cordis'
import type { LibraryChatTask, SendLibraryChatMessageInput } from '@tiggyknowledge/contracts'
import { HttpError, type HttpRouteDefinition } from '@tiggyknowledge/http-router'
import type {} from '@tiggyknowledge/library-chat'

export class LibraryChatApi extends Service {
  static inject = ['httpRouter', 'libraryChat']

  constructor(ctx: Context) {
    super(ctx, 'libraryChatApi')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const disposers = ROUTES.map(route => this.ctx.httpRouter.register({
      ...route,
      handler: context => route.handler.call(this, context),
    }))
    yield () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }
}

type Route = Omit<HttpRouteDefinition, 'handler'> & {
  handler(this: LibraryChatApi, context: Parameters<HttpRouteDefinition['handler']>[0]): void | Promise<void>
}

const CHAT_PATH = /^\/api\/libraries\/([^/]+)\/chat$/
const MESSAGE_PATH = /^\/api\/libraries\/([^/]+)\/chat\/messages$/
const CANCEL_PATH = /^\/api\/libraries\/([^/]+)\/chat\/cancel$/

const ROUTES: Route[] = [
  {
    id: 'library-chat:snapshot',
    methods: ['GET', 'DELETE'],
    path: CHAT_PATH,
    handler({ method, assertSameOrigin, json, match }) {
      const libraryId = decodeLibraryId(match)
      try {
        if (method === 'DELETE') {
          assertSameOrigin()
          this.ctx.libraryChat.clear(libraryId)
          json({ libraryId, messages: [] })
          return
        }
        json(this.ctx.libraryChat.snapshot(libraryId))
      } catch (error) {
        throw chatHttpError(error)
      }
    },
  },
  {
    id: 'library-chat:send',
    methods: ['POST'],
    path: MESSAGE_PATH,
    async handler({ request, response, assertSameOrigin, match, readJson }) {
      assertSameOrigin()
      const libraryId = decodeLibraryId(match)
      const input = validateSendInput(await readJson<unknown>())
      let stream: AsyncIterable<import('@tiggyknowledge/contracts').LibraryChatStreamEvent>
      try {
        stream = this.ctx.libraryChat.start(libraryId, input)
      } catch (error) {
        throw chatHttpError(error)
      }
      response.writeHead(200, {
        'cache-control': 'no-cache, no-store',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      })
      response.flushHeaders()
      let disconnected = false
      const onDisconnect = (): void => {
        if (response.writableEnded) return
        disconnected = true
        this.ctx.libraryChat.cancel(libraryId)
      }
      request.once('aborted', onDisconnect)
      response.once('close', onDisconnect)
      try {
        for await (const event of stream) {
          if (disconnected || response.destroyed) break
          response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        }
      } finally {
        request.removeListener('aborted', onDisconnect)
        response.removeListener('close', onDisconnect)
        if (!response.writableEnded && !response.destroyed) response.end()
      }
    },
  },
  {
    id: 'library-chat:cancel',
    methods: ['POST'],
    path: CANCEL_PATH,
    handler({ assertSameOrigin, json, match }) {
      assertSameOrigin()
      const libraryId = decodeLibraryId(match)
      try {
        const message = this.ctx.libraryChat.cancel(libraryId)
        json({
          libraryId,
          cancelled: message !== undefined,
          ...(message === undefined ? {} : { message }),
        })
      } catch (error) {
        throw chatHttpError(error)
      }
    },
  },
]

function decodeLibraryId(match: RegExpMatchArray | undefined): string {
  try {
    return decodeURIComponent(match?.[1] ?? '')
  } catch {
    throw new HttpError(400, 'invalid_library_id', '知识库 ID 无效')
  }
}

function chatHttpError(error: unknown): HttpError | unknown {
  if (!(error instanceof RangeError)) return error
  const conflict = error.message.includes('正在生成')
  return new HttpError(conflict ? 409 : 400, conflict ? 'chat_generation_active' : 'invalid_chat_request', error.message)
}

const CHAT_TASKS: readonly LibraryChatTask[] = [
  'retrieval',
  'summarize-current-document',
  'summarize-named-document',
  'summarize-library',
]

function validateSendInput(value: unknown): SendLibraryChatMessageInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_chat_request', '聊天请求必须是 JSON 对象')
  }
  const input = value as Record<string, unknown>
  if (typeof input.content !== 'string') {
    throw new HttpError(400, 'invalid_chat_request', 'content 必须是字符串')
  }
  for (const field of ['modelId', 'contextDocumentId'] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      throw new HttpError(400, 'invalid_chat_request', `${field} 必须是字符串`)
    }
  }
  if (input.taskOverride !== undefined && !(CHAT_TASKS as readonly unknown[]).includes(input.taskOverride)) {
    throw new HttpError(400, 'invalid_chat_request', 'taskOverride 无效')
  }
  return {
    content: input.content,
    ...(typeof input.modelId === 'string' ? { modelId: input.modelId } : {}),
    ...(typeof input.contextDocumentId === 'string' ? { contextDocumentId: input.contextDocumentId } : {}),
    ...(input.taskOverride === undefined ? {} : { taskOverride: input.taskOverride as LibraryChatTask }),
  }
}

export default LibraryChatApi
