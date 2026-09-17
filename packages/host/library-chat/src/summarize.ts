import type { KnowledgeDocument, LlmResolvedEndpoint } from '@tiggyknowledge/contracts'
import type { IndexedKnowledgeChunk } from '@tiggyknowledge/index-fts'
import type { ChatMessage, OpenAiCompatibleClient } from '@tiggyknowledge/llm-client'

export interface DocumentSummaryCache {
  getDocumentSummary(documentId: string, contentHash: string, modelId: string): { summary: string } | undefined
  saveDocumentSummary(input: {
    documentId: string
    contentHash: string
    modelId: string
    summary: string
  }): unknown
}

export interface DocumentSummarizerDependencies {
  llmClient: Pick<OpenAiCompatibleClient, 'complete'>
  cache: DocumentSummaryCache
  listDocumentChunks(documentId: string): IndexedKnowledgeChunk[]
}

export interface SummarizeProgress {
  phase: 'map' | 'reduce' | 'focus'
  completed: number
  total: number
}

export async function summarizeDocument(
  dependencies: DocumentSummarizerDependencies,
  document: KnowledgeDocument,
  endpoint: LlmResolvedEndpoint,
  focus: string | undefined,
  signal: AbortSignal,
  onProgress?: (progress: SummarizeProgress) => void,
): Promise<{ summary: string, cached: boolean }> {
  throwIfAborted(signal)
  const cached = dependencies.cache.getDocumentSummary(document.id, document.contentHash, endpoint.modelId)
  let baseSummary = cached?.summary
  if (baseSummary === undefined) {
    const chunks = dependencies.listDocumentChunks(document.id)
    if (chunks.length === 0) throw new Error(`文档“${document.title}”没有可总结的已索引内容`)
    if (chunks.some(chunk => chunk.documentId !== document.id || chunk.libraryId !== document.libraryId)) {
      throw new Error('索引分块与目标文档不一致')
    }

    const outputTokens = summaryOutputTokens(endpoint, 1_000)
    const inputCharacters = summaryInputCharacters(endpoint, outputTokens)
    const batches = chunkBatches(chunks, inputCharacters)
    const mapResults: string[] = []
    for (let start = 0; start < batches.length; start += 2) {
      throwIfAborted(signal)
      const pair = batches.slice(start, start + 2)
      const values = await Promise.all(pair.map((batch, offset) => dependencies.llmClient.complete({
        settings: { ...endpoint, maxOutputTokens: outputTokens },
        messages: summaryMessages(
          '你负责长文 Map 摘要。忠实提取事实、结论、数字、限定条件和章节关系；不得补写索引中没有的内容。不要声称已看到原始文件全文，只能说基于提供的索引分块。',
          `文档：${document.title}\n批次：${start + offset + 1}/${batches.length}\n\n${batch}`,
        ),
        signal,
        temperature: 0,
      })))
      mapResults.push(...values.map(value => value.content))
      onProgress?.({ phase: 'map', completed: Math.min(start + pair.length, batches.length), total: batches.length })
    }

    baseSummary = await reduceSummaries(
      dependencies.llmClient,
      mapResults,
      document.title,
      undefined,
      endpoint,
      signal,
      progress => onProgress?.({ phase: 'reduce', completed: progress.completed, total: progress.total }),
    )
    throwIfAborted(signal)
    dependencies.cache.saveDocumentSummary({
      documentId: document.id,
      contentHash: document.contentHash,
      modelId: endpoint.modelId,
      summary: baseSummary,
    })
  }
  if (focus === undefined) return { summary: baseSummary, cached: cached !== undefined }

  onProgress?.({ phase: 'focus', completed: 0, total: 1 })
  const outputTokens = summaryOutputTokens(endpoint, 800)
  const maximumCharacters = summaryInputCharacters(endpoint, outputTokens)
  const focused = await dependencies.llmClient.complete({
    settings: { ...endpoint, maxOutputTokens: outputTokens },
    messages: summaryMessages(
      '你负责从通用文档摘要中提炼指定关注点。只能使用摘要内已有事实；保留相关数字、限定条件和不确定性。若摘要没有相关信息，明确说明未发现。',
      `文档：${document.title}\n关注点：${focus}\n\n通用摘要：\n${clipPreservingCitations(baseSummary, maximumCharacters)}`,
    ),
    signal,
    temperature: 0,
  })
  throwIfAborted(signal)
  onProgress?.({ phase: 'focus', completed: 1, total: 1 })
  return { summary: focused.content, cached: false }
}

export async function reduceSummaries(
  llmClient: Pick<OpenAiCompatibleClient, 'complete'>,
  initial: string[],
  title: string,
  focus: string | undefined,
  endpoint: LlmResolvedEndpoint,
  signal: AbortSignal,
  onProgress?: (progress: { completed: number, total: number }) => void,
): Promise<string> {
  if (initial.length === 0) throw new Error('没有可合并的摘要')
  const outputTokens = summaryOutputTokens(endpoint, 1_200)
  const maximumCharacters = summaryInputCharacters(endpoint, outputTokens)
  let level = initial
  const totalLevels = Math.ceil(Math.log2(Math.max(1, initial.length)))
  let completedLevels = 0
  while (level.length > 1) {
    if (completedLevels >= 16) throw new Error('摘要 Reduce 超过最大层数')
    const groups = reductionPairs(level, maximumCharacters)
    if (groups.length >= level.length) throw new Error('摘要 Reduce 未能收敛')
    const next: string[] = []
    for (let start = 0; start < groups.length; start += 2) {
      throwIfAborted(signal)
      const pair = groups.slice(start, start + 2)
      const values = await Promise.all(pair.map((group, offset) => llmClient.complete({
        settings: { ...endpoint, maxOutputTokens: outputTokens },
        messages: summaryMessages(
          '你负责递归 Reduce 摘要。合并重复信息，保留冲突、关键事实、数字、限定条件与来源文档名称；不得引入输入之外的事实。所有形如 [n] 的来源编号必须原样保留，不得重编号或新增编号。',
          `主题：${title}\nReduce 组：${start + offset + 1}/${groups.length}${focus === undefined ? '' : `\n关注点：${focus}`}\n\n${group}`,
        ),
        signal,
        temperature: 0,
      })))
      next.push(...values.map((value, index) => citationSafeReduction(pair[index] ?? '', value.content, maximumCharacters)))
    }
    level = next
    completedLevels += 1
    onProgress?.({ completed: completedLevels, total: totalLevels })
  }
  return level[0] ?? ''
}

function chunkBatches(chunks: IndexedKnowledgeChunk[], maximumCharacters: number): string[] {
  const pieces: string[] = []
  for (const chunk of chunks) {
    const prefix = `位置：${chunk.location}\n`
    const bodyMaximum = Math.max(1, maximumCharacters - prefix.length - 32)
    for (let offset = 0; offset < chunk.body.length; offset += bodyMaximum) {
      pieces.push(`${prefix}${chunk.body.slice(offset, offset + bodyMaximum)}`)
    }
  }
  return textBatches(pieces, maximumCharacters)
}

function textBatches(values: string[], maximumCharacters: number): string[] {
  const batches: string[] = []
  let current = ''
  for (const value of values) {
    for (let offset = 0; offset < value.length; offset += maximumCharacters) {
      const piece = value.slice(offset, offset + maximumCharacters)
      const separator = current.length === 0 ? '' : '\n\n---\n\n'
      if (current.length > 0 && current.length + separator.length + piece.length > maximumCharacters) {
        batches.push(current)
        current = ''
      }
      current += `${current.length === 0 ? '' : separator}${piece}`
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function reductionPairs(values: string[], maximumCharacters: number): string[] {
  const groups: string[] = []
  for (let index = 0; index < values.length; index += 2) {
    const pair = values.slice(index, index + 2)
    const perValue = Math.max(64, Math.floor((maximumCharacters - 7 * Math.max(0, pair.length - 1)) / pair.length))
    groups.push(pair.map(value => clipPreservingCitations(value, perValue)).join('\n\n---\n\n'))
  }
  return groups
}

function citationSafeReduction(input: string, output: string, maximumCharacters: number): string {
  const allowed = citationNumbers(input)
  if (allowed.size === 0) return clipPreservingCitations(output, maximumCharacters)
  const emitted = citationNumbers(output)
  const hasUnknown = [...emitted].some(number => !allowed.has(number))
  const missing = [...allowed].some(number => !emitted.has(number))
  return hasUnknown || missing
    ? compactPerCitation(input, maximumCharacters)
    : clipPreservingCitations(output, maximumCharacters)
}

function compactPerCitation(input: string, maximumCharacters: number): string {
  const starts = [...input.matchAll(/\[(\d{1,6})\]/g)]
  if (starts.length === 0) return clipPreservingCitations(input, maximumCharacters)
  const perSource = Math.max(32, Math.floor(maximumCharacters / starts.length))
  return starts.map((match, index) => {
    const start = match.index ?? 0
    const end = starts[index + 1]?.index ?? input.length
    return clipPreservingCitations(input.slice(start, end).trim(), perSource)
  }).join('\n')
}

function citationNumbers(value: string): Set<number> {
  return new Set([...value.matchAll(/\[(\d{1,6})\]/g)].map(match => Number(match[1])))
}

function clipPreservingCitations(value: string, maximumCharacters: number): string {
  if (value.length <= maximumCharacters) return value
  const citations = [...citationNumbers(value)].map(number => `[${number}]`).join(' ')
  const reserved = citations.length === 0 ? 0 : Math.min(citations.length + 1, Math.floor(maximumCharacters / 3))
  const bodyMaximum = Math.max(1, maximumCharacters - reserved)
  const body = bodyMaximum < 8 ? value.slice(0, bodyMaximum) : `${value.slice(0, bodyMaximum - 2)}…`
  return citations.length === 0 ? body : `${citations.slice(0, reserved - 1)}\n${body}`
}

function summaryOutputTokens(endpoint: LlmResolvedEndpoint, preferred: number): number {
  return Math.max(1, Math.min(
    endpoint.maxOutputTokens,
    preferred,
    Math.max(1, Math.floor(endpoint.maxInputTokens * 0.15)),
  ))
}

function summaryInputCharacters(endpoint: LlmResolvedEndpoint, outputTokens: number): number {
  return Math.max(512, (endpoint.maxInputTokens - outputTokens - 300) * 3)
}

function summaryMessages(system: string, content: string): ChatMessage[] {
  return [{ role: 'system', content: system }, { role: 'user', content }]
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('聊天生成已取消')
}
