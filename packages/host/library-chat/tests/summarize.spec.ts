import type { KnowledgeDocument, LlmResolvedEndpoint } from '@tiggyknowledge/contracts'
import { describe, expect, it, vi } from 'vitest'
import { reduceSummaries, summarizeDocument } from '../src/summarize.ts'

const endpoint: LlmResolvedEndpoint = {
  providerId: 'provider',
  providerName: 'Provider',
  modelId: 'model-1',
  modelName: 'Model',
  model: 'model',
  baseUrl: 'https://example.test/v1',
  requestTimeoutMs: 5_000,
  maxInputTokens: 500,
  maxOutputTokens: 100,
  apiKeyConfigured: true,
}

const document: KnowledgeDocument = {
  id: 'doc-1',
  libraryId: 'library-a',
  title: '长文',
  originalName: 'long.md',
  sourceType: 'markdown',
  sourceAssetId: 'asset',
  contentHash: 'hash-1',
  sizeBytes: 3_000,
  indexStatus: 'ready',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('document map-reduce summarization', () => {
  it('batches every ordered chunk, recursively reduces, caches, and naturally misses on hash changes', async () => {
    const cache = new Map<string, string>()
    let count = 0
    const complete = vi.fn(async ({ messages }: { messages: Array<{ content: string }> }) => {
      count += 1
      return {
        content: messages[0]?.content.includes('Map 摘要') ? `局部摘要-${count}` : `归并摘要-${count}`,
        inputTokens: 10,
        outputTokens: 5,
      }
    })
    const dependencies = {
      llmClient: { complete },
      cache: {
        getDocumentSummary: (id: string, hash: string, model: string) => {
          const summary = cache.get(`${id}:${hash}:${model}`)
          return summary === undefined ? undefined : { summary }
        },
        saveDocumentSummary: (input: { documentId: string, contentHash: string, modelId: string, summary: string }) => {
          cache.set(`${input.documentId}:${input.contentHash}:${input.modelId}`, input.summary)
        },
      },
      listDocumentChunks: () => [
        { chunkId: '001', documentId: 'doc-1', libraryId: 'library-a', location: '一', title: '长文', body: '甲'.repeat(900) },
        { chunkId: '002', documentId: 'doc-1', libraryId: 'library-a', location: '二', title: '长文', body: '乙'.repeat(900) },
        { chunkId: '003', documentId: 'doc-1', libraryId: 'library-a', location: '三', title: '长文', body: '丙'.repeat(900) },
      ],
    }

    const first = await summarizeDocument(dependencies, document, endpoint, undefined, new AbortController().signal)
    expect(first.cached).toBe(false)
    expect(first.summary).toContain('归并摘要')
    const mapCalls = complete.mock.calls.filter(call => call[0].messages[0]?.content.includes('Map 摘要'))
    expect(mapCalls.length).toBeGreaterThanOrEqual(3)
    expect(complete.mock.calls.some(call => call[0].messages[0]?.content.includes('Reduce 摘要'))).toBe(true)
    for (const call of complete.mock.calls) expect(call[0].messages[1]?.content.length).toBeLessThanOrEqual(1_200)

    const callCount = complete.mock.calls.length
    const hit = await summarizeDocument(dependencies, document, endpoint, '不同关注点', new AbortController().signal)
    expect(hit.cached).toBe(false)
    expect(complete).toHaveBeenCalledTimes(callCount + 1)
    expect(complete.mock.calls.at(-1)?.[0].messages[1]?.content).toContain('关注点：不同关注点')

    await summarizeDocument(
      dependencies,
      { ...document, contentHash: 'hash-2' },
      endpoint,
      undefined,
      new AbortController().signal,
    )
    expect(complete.mock.calls.length).toBeGreaterThan(callCount + 1)
  })

  it('forces reduce convergence and falls back when a model changes citation numbers', async () => {
    const complete = vi.fn(async () => ({
      content: '错误重编号 [999]',
      inputTokens: 10,
      outputTokens: 5,
    }))
    const initial = Array.from({ length: 40 }, (_, index) => `[${index + 1}] 文档 ${index + 1} 的摘要`)
    const result = await reduceSummaries(
      { complete },
      initial,
      '整库',
      undefined,
      endpoint,
      new AbortController().signal,
    )
    expect(complete.mock.calls.length).toBeLessThan(80)
    expect(result).not.toContain('[999]')
    expect(result).toContain('[1]')
    expect(result).toContain('[40]')
  })

  it('threads cancellation into map calls', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(summarizeDocument({
      llmClient: { complete: vi.fn() },
      cache: { getDocumentSummary: () => undefined, saveDocumentSummary: vi.fn() },
      listDocumentChunks: () => [],
    }, document, endpoint, undefined, controller.signal)).rejects.toThrow('取消')
  })
})
