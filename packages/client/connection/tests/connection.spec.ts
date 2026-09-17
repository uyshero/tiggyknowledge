import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import ConnectionService, { parseLibraryChatSse } from '../src/index.ts'

describe('library chat SSE parser', () => {
  it('buffers chunk boundaries and joins multiple data lines', async () => {
    let cancelled = false
    const encoded = new TextEncoder().encode(
      ': keepalive\r\n'
      + 'event: delta\r\n'
      + 'data: {"type":"delta",\r\n'
      + 'data: "messageId":"assistant-1","delta":"你好"}\r\n\r\n'
      + 'event: usage\n'
      + 'data: {"type":"usage","messageId":"assistant-1","usage":{"inputTokens":3,"outputTokens":2}}\n\n',
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 17))
        controller.enqueue(encoded.slice(17, 71))
        controller.enqueue(encoded.slice(71, 89))
        controller.enqueue(encoded.slice(89))
        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })

    const events = []
    for await (const event of parseLibraryChatSse(stream)) events.push(event)

    expect(events).toEqual([
      { type: 'delta', messageId: 'assistant-1', delta: '你好' },
      { type: 'usage', messageId: 'assistant-1', usage: { inputTokens: 3, outputTokens: 2 } },
    ])
    expect(cancelled).toBe(false)
  })

  it('emits a final event without a trailing blank line', async () => {
    const body = new TextEncoder().encode('event: error\ndata: {"type":"error","messageId":"a","error":"失败"}')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    })

    const events = []
    for await (const event of parseLibraryChatSse(stream)) events.push(event)
    expect(events).toEqual([{ type: 'error', messageId: 'a', error: '失败' }])
  })

  it('cancels the reader when the consumer exits before EOF', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: delta\ndata: {"type":"delta","messageId":"a","delta":"首段"}\n\n',
        ))
      },
      cancel() {
        cancelled = true
      },
    })
    const iterator = parseLibraryChatSse(stream)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'delta', delta: '首段' } })
    await iterator.return?.()
    expect(cancelled).toBe(true)
  })

  it('finishes a chat request immediately after a terminal event', async () => {
    let cancelled = false
    const message = {
      id: 'a',
      libraryId: 'library-a',
      role: 'assistant',
      state: 'completed',
      content: '完成',
      sources: [],
      tokenUsage: { inputTokens: 1, outputTokens: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    }
    const fetchMock = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `event: completed\ndata: ${JSON.stringify({ type: 'completed', message })}\n\n`,
        ))
      },
      cancel() {
        cancelled = true
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(ConnectionService)
      const events = []
      for await (const event of ctx.connection.sendLibraryChatMessage('library-a', {
        content: '问题',
        contextDocumentId: 'document-current',
      })) events.push(event)
      expect(events).toEqual([{ type: 'completed', message }])
      expect(cancelled).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/libraries/library-a/chat/messages', expect.objectContaining({
        body: JSON.stringify({ content: '问题', contextDocumentId: 'document-current' }),
      }))
    } finally {
      vi.unstubAllGlobals()
      await ctx.fiber.dispose()
    }
  })
})
