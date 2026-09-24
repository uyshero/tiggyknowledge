import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {
  AssistWikiPageInput,
  AssistWikiPageResult,
  CreateWikiFolderInput,
  CreateWikiPageInput,
  KnowledgeDocument,
  ConfirmWikiGenerationInput,
  LlmResolvedEndpoint,
  StartWikiGenerationInput,
  UpdateWikiPageInput,
  UpdateWikiFolderInput,
  WikiChangeSummary,
  WikiEstimate,
  WikiFolder,
  WikiGeneration,
  WikiGenerationMode,
  WikiInboxItem,
  WikiSkippedItem,
  WikiPage,
  WikiPageRevision,
  WikiPageSummary,
  WikiPageStatus,
  WikiPageType,
  WikiSource,
  WikiStatus,
} from '@tiggyknowledge/contracts'
import { isLlmReady, resolveWikiLlmModel } from '@tiggyknowledge/contracts'
import type { ChatCompletionResult } from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-credentials'
import type {} from '@tiggyknowledge/preview-text'
import type {} from '@tiggyknowledge/query'
import type {} from '@tiggyknowledge/settings-file'
import { contributeSurface } from '@tiggyknowledge/plugin-surface'
import type { WikiDocumentSnapshot, WikiFolderWrite, WikiPageWrite } from '@tiggyknowledge/wiki-sqlite'
import type {} from '@tiggyknowledge/wiki-sqlite'
import { wikiHttpRoutes } from './http.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmWiki: LlmWiki
  }
}

interface DocumentChangeSet {
  current: KnowledgeDocument[]
  added: KnowledgeDocument[]
  updated: KnowledgeDocument[]
  deleted: WikiDocumentSnapshot[]
}

interface GeneratedPage {
  title?: unknown
  slug?: unknown
  summary?: unknown
  pageType?: unknown
  status?: unknown
  aliases?: unknown
  purpose?: unknown
  questions?: unknown
  folderPath?: unknown
  parentSlug?: unknown
  sections?: unknown
}

interface PlannedPage extends WikiPageWrite {
  folderPath?: string[]
}

interface GeneratedSection {
  title?: unknown
  body?: unknown
  sourceDocumentIds?: unknown
}

const FULL_SUMMARY_MARKER = '<!-- wiki-summary:full-v2 -->'

export class LlmWiki extends Service {
  static inject = [
    'knowledgeCatalog',
    'knowledgePreview',
    'knowledgeQuery',
    'llmClient',
    'llmCredentials',
    'settings',
    'wikiStorage',
  ]

  private activeController: AbortController | undefined
  private readonly pendingDocumentIds: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'llmWiki')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-ui-wiki',
        moduleName: '@tiggyknowledge/client-ui-wiki',
        label: 'LLM Wiki',
        description: 'Global generated knowledge wiki',
      }],
      routes: wikiHttpRoutes(this),
    })
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const interrupted = this.ctx.wikiStorage.activeGeneration()
    if (interrupted !== undefined && interrupted.state !== 'planned') {
      this.ctx.wikiStorage.updateGeneration(interrupted.id, {
        state: 'failed',
        phase: 'failed',
        completedAt: new Date().toISOString(),
        error: '应用已重启，先前的 Wiki 生成任务未能完成',
      })
    }
    const disposeDeleted = this.ctx.on('knowledge/document/deleted', documentIds => {
      this.ctx.wikiStorage.markSourcesMissing(documentIds)
      for (const documentId of documentIds) this.ctx.wikiStorage.unskipInboxItem(documentId)
    })
    yield () => {
      disposeDeleted()
      this.activeController?.abort()
    }
  }

  status(): WikiStatus {
    const changes = this.changeSummary(this.collectChanges())
    const inbox = this.inbox()
    const skipped = this.skipped()
    const active = this.ctx.wikiStorage.activeGeneration()
    const latest = this.ctx.wikiStorage.latestGeneration()
    const pages = this.ctx.wikiStorage.listPages()
    const reviews = pages.filter(page => page.pageType !== 'index' && page.status === 'draft')
    const pageCount = pages.length
    const lastGeneratedAt = this.ctx.wikiStorage.lastGeneratedAt()
    const settings = this.currentSettings()
    let state: WikiStatus['state']
    if (active !== undefined && active.state !== 'planned') state = 'generating'
    else if (latest?.state === 'failed') state = 'failed'
    else if (pageCount === 0 && inbox.length === 0) state = 'never-generated'
    else if (inbox.length > 0 || reviews.length > 0) state = 'awaiting-confirmation'
    else state = 'ready'
    return {
      state,
      llmConfigured: isLlmReady(settings),
      pageCount,
      inbox,
      reviews,
      skipped,
      queuedDocumentIds: [...this.pendingDocumentIds],
      ...(lastGeneratedAt === undefined ? {} : { lastGeneratedAt }),
      ...(active === undefined ? {} : { activeGenerationId: active.id }),
      ...(latest === undefined ? {} : { lastGeneration: latest }),
      changes,
    }
  }

  inbox(): WikiInboxItem[] {
    const libraries = new Map(this.ctx.knowledgeCatalog.listLibraries().map(library => [library.id, library.name]))
    const changes = this.collectChanges()
    const pending = [...changes.added.map(document => ({ document, change: 'added' as const })),
      ...changes.updated.map(document => ({ document, change: 'updated' as const }))]
    return pending.flatMap(({ document, change }) => {
      if (this.ctx.wikiStorage.isInboxSkipped(document.id, document.contentHash)) return []
      const locked = this.ctx.wikiStorage.pagesForDocument(document.id).some(page => page.pageType !== 'index' && page.state === 'locked')
      return [{
        documentId: document.id,
        libraryId: document.libraryId,
        libraryName: libraries.get(document.libraryId) ?? '未分组',
        title: document.title,
        contentHash: document.contentHash,
        change,
        locked,
      }]
    })
  }

  skipped(): WikiSkippedItem[] {
    const libraries = new Map(this.ctx.knowledgeCatalog.listLibraries().map(library => [library.id, library.name]))
    const changes = this.collectChanges()
    const pending = [...changes.added.map(document => ({ document, change: 'added' as const })),
      ...changes.updated.map(document => ({ document, change: 'updated' as const }))]
    const skips = new Map(this.ctx.wikiStorage.listInboxSkips().map(item => [`${item.documentId}:${item.contentHash}`, item]))
    return pending.flatMap(({ document, change }) => {
      const skip = skips.get(`${document.id}:${document.contentHash}`)
      if (skip === undefined) return []
      const locked = this.ctx.wikiStorage.pagesForDocument(document.id).some(page => page.pageType !== 'index' && page.state === 'locked')
      return [{
        documentId: document.id,
        libraryId: document.libraryId,
        libraryName: libraries.get(document.libraryId) ?? '未分组',
        title: document.title,
        contentHash: document.contentHash,
        change,
        locked,
        skippedAt: skip.skippedAt,
      }]
    })
  }

  estimate(mode: WikiGenerationMode): WikiEstimate {
    const inbox = this.inbox()
    return {
      mode,
      documentsToProcess: inbox.length,
      estimatedInputTokens: inbox.length,
      changes: this.changeSummary(this.collectChanges()),
    }
  }

  start(input: StartWikiGenerationInput): WikiGeneration {
    const documentId = input.documentId
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new RangeError('请确认一篇知识文章后再生成词条')
    }
    return this.acceptDocument(documentId, input.force === true)
  }

  generation(id: string): WikiGeneration
  generation(): WikiGeneration | undefined
  generation(id?: string): WikiGeneration | undefined {
    if (id === undefined) return this.ctx.wikiStorage.latestGeneration()
    const generation = this.ctx.wikiStorage.getGeneration(id)
    if (generation === undefined) throw new RangeError('Wiki 生成任务不存在')
    return generation
  }

  cancel(id: string): WikiGeneration {
    const generation = this.ctx.wikiStorage.getGeneration(id)
    if (generation === undefined) throw new RangeError('Wiki 生成任务不存在')
    if (generation.state !== 'pending' && generation.state !== 'running' && generation.state !== 'planned') return generation
    this.activeController?.abort()
    return this.ctx.wikiStorage.updateGeneration(id, {
      state: 'cancelled',
      phase: 'cancelled',
      completedAt: new Date().toISOString(),
    })
  }

  confirm(_id: string, _input: ConfirmWikiGenerationInput): WikiGeneration {
    throw new RangeError('Wiki 已改为按文章确认，请对单篇知识文章生成词条')
  }

  skipDocument(documentId: string): WikiInboxItem[] {
    const document = this.findDocument(documentId)
    if (document === undefined) throw new RangeError('知识文档不存在')
    const queued = this.pendingDocumentIds.indexOf(document.id)
    if (queued >= 0) this.pendingDocumentIds.splice(queued, 1)
    this.ctx.wikiStorage.skipInboxItem(document.id, document.contentHash)
    return this.inbox()
  }

  unlockPage(id: string, expectedVersion: number): WikiPage {
    return this.ctx.wikiStorage.unlockPage(id, expectedVersion)
  }

  publishPage(id: string, expectedVersion: number): WikiPage {
    const current = this.page(id)
    if (current.pageType === 'index') throw new RangeError('首页无需核对')
    if (current.status === 'archived') throw new RangeError('已归档词条不能确认收录')
    return this.ctx.wikiStorage.publishPage(id, expectedVersion)
  }

  acceptDocument(documentId: string, force = false): WikiGeneration {
    const document = this.findDocument(documentId)
    if (document === undefined) throw new RangeError('知识文档不存在')
    this.ctx.wikiStorage.unskipInboxItem(document.id)
    const pending = this.inbox().find(item => item.documentId === document.id)
    const existing = this.ctx.wikiStorage.pagesForDocument(document.id).filter(page => page.pageType !== 'index')
    if (existing.some(page => page.state === 'locked')) throw new RangeError('该词条已锁定；该文章关联的词条需先全部允许自动更新')
    if (pending === undefined && !force) {
      const snapshot = this.ctx.wikiStorage.listDocumentSnapshots().find(item => item.documentId === document.id)
      if (snapshot !== undefined && snapshot.contentHash === document.contentHash) {
        throw new RangeError('该文章对应的词条已是最新')
      }
      throw new RangeError('这篇知识文章当前没有待确认的词条')
    }
    this.wikiEndpoint()
    if (!this.pendingDocumentIds.includes(document.id)) this.pendingDocumentIds.push(document.id)
    const active = this.ctx.wikiStorage.activeGeneration()
    if (active !== undefined && this.activeController !== undefined) {
      return active
    }
    return this.dequeueNext()
  }

  pages(): WikiPageSummary[] {
    return this.ctx.wikiStorage.listPages()
  }

  folders(): WikiFolder[] {
    return this.ctx.wikiStorage.listFolders()
  }

  createFolder(input: CreateWikiFolderInput): WikiFolder {
    const name = folderName(input.name)
    const folders = this.ctx.wikiStorage.listFolders()
    const parent = input.parentId === undefined ? undefined : folders.find(item => item.id === input.parentId)
    if (input.parentId !== undefined && parent === undefined) throw new RangeError('上级 Wiki 分类不存在')
    const path = parent === undefined ? name : `${parent.path}/${name}`
    if (folders.some(item => item.path === path)) throw new RangeError('同级分类名称已存在')
    const siblings = folders.filter(item => item.parentId === input.parentId)
    return this.ctx.wikiStorage.createFolder({
      id: randomUUID(),
      name,
      path,
      ...(parent === undefined ? {} : { parentId: parent.id }),
      depth: parent === undefined ? 0 : parent.depth + 1,
      order: siblings.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1,
    })
  }

  updateFolder(id: string, input: UpdateWikiFolderInput): WikiFolder {
    const folders = this.ctx.wikiStorage.listFolders()
    const current = folders.find(item => item.id === id)
    if (current === undefined) throw new RangeError('Wiki 分类不存在')
    const name = folderName(input.name)
    const parent = current.parentId === undefined ? undefined : folders.find(item => item.id === current.parentId)
    const path = parent === undefined ? name : `${parent.path}/${name}`
    if (folders.some(item => item.id !== id && item.path === path)) throw new RangeError('同级分类名称已存在')
    return this.ctx.wikiStorage.renameFolder(id, name, path)
  }

  deleteFolder(id: string): void {
    this.ctx.wikiStorage.deleteFolder(id)
  }

  createPage(input: CreateWikiPageInput): WikiPage {
    const title = text(input.title, '词条标题', 1, 200)
    const type = input.pageType === undefined ? 'concept' : pageType(input.pageType)
    if (type === 'index') throw new RangeError('不能手动创建 Wiki 首页')
    const folder = input.folderId === undefined
      ? undefined
      : this.ctx.wikiStorage.listFolders().find(item => item.id === input.folderId)
    if (input.folderId !== undefined && folder === undefined) throw new RangeError('Wiki 分类不存在')
    const existingSlugs = new Set(this.ctx.wikiStorage.listPages().map(item => item.slug))
    const slug = uniqueSlug(normalizeWikiSlug(undefined, title, type), existingSlugs)
    const body = text(input.body, '词条正文', 1, 200_000)
    const sourceDocumentIds = sourceIds(input.sourceDocumentIds)
    if (sourceDocumentIds.length > 20) throw new RangeError('来源文档最多 20 个')
    const sourceDocuments = this.ctx.knowledgeCatalog.getDocuments(sourceDocumentIds)
    if (sourceDocuments.length !== sourceDocumentIds.length) throw new RangeError('部分来源文档已不存在，请重新使用 AI 补充')
    return this.ctx.wikiStorage.createPage({
      id: randomUUID(),
      slug,
      title,
      summary: input.summary === undefined ? '' : text(input.summary, '页面摘要', 0, 500),
      pageType: type,
      status: 'published',
      aliases: input.aliases === undefined ? [] : aliases(input.aliases),
      purpose: input.purpose === undefined ? '' : text(input.purpose, '词条用途', 0, 500),
      questions: input.questions === undefined ? [] : questions(input.questions),
      ...(folder === undefined ? {} : { folderId: folder.id }),
      order: this.ctx.wikiStorage.listPages().reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1,
      state: 'locked',
      sections: [{
        id: randomUUID(),
        title: input.sectionTitle === undefined ? '说明' : text(input.sectionTitle, '章节标题', 1, 200),
        body,
        order: 0,
        state: 'locked',
        sources: sourceDocuments.map(wikiSource),
      }],
    })
  }

  async assistPage(input: AssistWikiPageInput): Promise<AssistWikiPageResult> {
    const title = text(input.title, '词条标题', 1, 200)
    const type = input.pageType === undefined ? 'concept' : pageType(input.pageType)
    if (type === 'index') throw new RangeError('Wiki 首页不能使用词条补充')
    const notes = input.notes === undefined ? '' : text(input.notes, '补充线索', 0, 5_000)
    const queries = [title, ...(notes === '' ? [] : [`${title} ${notes}`.slice(0, 200)])]
    const evidenceByChunk = new Map<string, ReturnType<typeof this.ctx.knowledgeQuery.search>['results'][number]>()
    for (const query of queries) {
      const search = this.ctx.knowledgeQuery.search({
        text: query,
        knowledgeBaseIds: [],
        mode: 'keyword',
        topK: 10,
      })
      for (const item of search.results) if (!evidenceByChunk.has(item.chunkId)) evidenceByChunk.set(item.chunkId, item)
    }
    const evidence = [...evidenceByChunk.values()].slice(0, 12)
    if (evidence.length === 0) throw new RangeError(`知识库文件中没有找到与“${title}”相关的内容，请先导入资料或补充更准确的线索`)
    const sourceDocumentIds = [...new Set(evidence.map(item => item.documentId))]
    const result = await this.ctx.llmClient.complete({
      settings: this.wikiEndpoint(),
      temperature: 0.2,
      json: true,
      maxAttempts: 3,
      messages: [
        {
          role: 'system',
          content: [
            '你是 Wiki 词条编辑助手。用户给出一个人物、组织、地点、产品、项目、术语、概念、决策或事件名称，请生成一份可继续编辑的中文解释草稿。',
            '只输出 JSON：{"summary":"不超过80字","purpose":"这个词条的用途","questions":["最多3个问题"],"sectionTitle":"说明","body":"Markdown 正文"}。',
            '正文应先给出清晰定义，再说明背景、关键特征、影响或与相关概念的区别。',
            '必须以输入中的 knowledgeEvidence 为事实依据；资料没有写明的内容要明确说明“知识库资料未说明”，不得用模型记忆补充具体事实。',
            '引用时只能使用 knowledgeEvidence 中已有的文件标题和位置，格式为【文件标题 · 位置】；正文末尾列出“依据”小节。',
            '用户提供的线索用于检索和组织内容，但不能覆盖知识库文件中的事实。不要输出思考过程。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            title,
            pageType: type,
            notes: notes || null,
            knowledgeEvidence: evidence.map(item => ({
              documentId: item.documentId,
              title: item.title,
              originalName: item.originalName,
              location: item.location,
              snippet: item.snippet,
            })),
          }),
        },
      ],
    })
    const parsed = parseJsonObject(result.content)
    return {
      summary: text(parsed.summary ?? '', '页面摘要', 0, 500),
      purpose: text(parsed.purpose ?? '', '词条用途', 0, 500),
      questions: generatedQuestions(parsed.questions),
      sectionTitle: text(parsed.sectionTitle ?? '说明', '章节标题', 1, 200),
      body: text(parsed.body, '词条正文', 1, 200_000),
      sourceDocumentIds,
    }
  }

  page(idOrSlug: string): WikiPage {
    const page = this.ctx.wikiStorage.getPage(idOrSlug)
    if (page === undefined) throw new RangeError('Wiki 页面不存在')
    return page
  }

  updatePage(id: string, input: UpdateWikiPageInput): WikiPage {
    const current = this.page(id)
    const title = text(input.title, '页面标题', 1, 200)
    if (!Array.isArray(input.sections) || input.sections.length === 0 || input.sections.length > 100) {
      throw new RangeError('Wiki 页面应包含 1 到 100 个章节')
    }
    const oldSections = new Map(current.sections.map(section => [section.id, section]))
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new RangeError('Wiki 页面版本无效')
    }
    const sectionIds = new Set<string>()
    const sections = input.sections.map((section, order) => {
      if (sectionIds.has(section.id)) throw new RangeError('Wiki 章节 ID 不能重复')
      sectionIds.add(section.id)
      const previous = oldSections.get(section.id)
      return {
        id: section.id,
        title: text(section.title, '章节标题', 1, 200),
        body: text(section.body, '章节正文', 1, 200_000),
        order,
        state: 'locked' as const,
        sources: previous?.sources ?? [],
      }
    })
    const folderId = input.folderId === undefined ? current.folderId : input.folderId ?? undefined
    if (folderId !== undefined && !this.ctx.wikiStorage.listFolders().some(folder => folder.id === folderId)) {
      throw new RangeError('Wiki 分类不存在')
    }
    return this.ctx.wikiStorage.updatePage({
      id: current.id,
      slug: current.slug,
      title,
      summary: input.summary === undefined ? current.summary : text(input.summary, '页面摘要', 0, 500),
      pageType: input.pageType === undefined ? current.pageType : pageType(input.pageType),
      status: input.status === undefined ? current.status : pageStatus(input.status),
      aliases: input.aliases === undefined ? current.aliases : aliases(input.aliases),
      purpose: input.purpose === undefined ? current.purpose : text(input.purpose, '词条用途', 0, 500),
      questions: input.questions === undefined ? current.questions : questions(input.questions),
      ...(folderId === undefined ? {} : { folderId }),
      ...(current.parentId === undefined ? {} : { parentId: current.parentId }),
      order: current.order,
      state: 'locked',
      sections,
    }, input.expectedVersion)
  }

  revisions(id: string): WikiPageRevision[] {
    return this.ctx.wikiStorage.listRevisions(id)
  }

  revertPage(id: string, version: number, expectedVersion: number): WikiPage {
    if (!Number.isInteger(version) || version < 1 || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new RangeError('Wiki 页面版本无效')
    }
    return this.ctx.wikiStorage.revertPage(id, version, expectedVersion)
  }

  pagesForDocument(documentId: string): WikiPageSummary[] {
    return this.ctx.wikiStorage.pagesForDocument(documentId)
  }

  private dequeueNext(): WikiGeneration {
    const documentId = this.pendingDocumentIds.shift()
    if (documentId === undefined) throw new RangeError('没有等待生成的文章')
    const document = this.findDocument(documentId)
    if (document === undefined) throw new RangeError('知识文档不存在')
    const settings = this.wikiEndpoint()
    const generation: WikiGeneration = {
      id: randomUUID(),
      mode: 'document',
      state: 'pending',
      phase: 'queued',
      totalSteps: 2,
      completedSteps: 0,
      estimatedInputTokens: Math.ceil(document.sizeBytes / 4),
      inputTokens: 0,
      outputTokens: 0,
      createdAt: new Date().toISOString(),
      plan: {
        documentFingerprint: document.contentHash,
        documentId: document.id,
        candidates: [],
        archivePages: [],
        preservedPageCount: this.ctx.wikiStorage.listPages().filter(page => page.pageType !== 'index').length,
      },
    }
    this.ctx.wikiStorage.createGeneration(generation)
    const controller = this.activeController = new AbortController()
    void this.runDocumentJob(generation.id, document, settings, controller).finally(() => {
      if (this.activeController === controller) this.activeController = undefined
      if (this.pendingDocumentIds.length > 0 && this.activeController === undefined) {
        try {
          this.dequeueNext()
        } catch {
          this.pendingDocumentIds.length = 0
        }
      }
    })
    return generation
  }

  private findDocument(documentId: string): KnowledgeDocument | undefined {
    return this.collectChanges().current.find(document => document.id === documentId)
  }

  private async runDocumentJob(
    id: string,
    document: KnowledgeDocument,
    settings: LlmResolvedEndpoint,
    controller: AbortController,
  ): Promise<void> {
    try {
      let generation = this.ctx.wikiStorage.updateGeneration(id, { state: 'running', phase: `summarizing:${document.id}` })
      this.throwIfCancelled(id, controller.signal)
      const preview = await this.ctx.knowledgePreview.preview(document.id)
      const chunks = splitDocumentForModel(preview.content, settings.maxInputTokens)
      generation = this.ctx.wikiStorage.updateGeneration(id, { totalSteps: chunks.length + 1 })
      const cachedValue = this.ctx.wikiStorage.cachedSummary(document.id, document.contentHash)
      const cachedCoversFullDocument = cachedValue !== undefined
        && (chunks.length === 1 || cachedValue.startsWith(FULL_SUMMARY_MARKER))
      let summary = cachedCoversFullDocument
        ? cachedValue.replace(FULL_SUMMARY_MARKER, '').trim()
        : ''
      if (!cachedCoversFullDocument) {
        const summaries: string[] = []
        for (const [index, chunk] of chunks.entries()) {
          this.throwIfCancelled(id, controller.signal)
          generation = this.ctx.wikiStorage.updateGeneration(id, {
            phase: `summarizing:${index + 1}/${chunks.length}`,
            completedSteps: index,
          })
          const result = await this.ctx.llmClient.complete({
            settings,
            signal: controller.signal,
            temperature: 0.1,
            maxAttempts: 3,
            messages: [
              {
                role: 'system',
                content: [
                  '你是知识库编辑，正在逐段遍历一篇长文。',
                  '请提取本段全部重要事实、数字、术语、专有名词、新词、人物、组织、项目、决策和事件，保留可验证细节。',
                  '对于事件注明时间、参与者、原因和影响（原文有写时）；不要因为追求简短而漏掉候选词条。',
                  '按要点组织，控制在 1200 个中文字符以内。',
                  '只输出本段结构化摘要正文，不要补充原文没有的具体事实。',
                ].join('\n'),
              },
              {
                role: 'user',
                content: `文档 ID: ${document.id}\n标题: ${document.title}\n全文分段: ${index + 1}/${chunks.length}\n\n${chunk}`,
              },
            ],
          })
          summaries.push(`## 第 ${index + 1}/${chunks.length} 段\n${result.content.trim()}`)
          generation = this.addUsage(generation, result)
          generation = this.ctx.wikiStorage.updateGeneration(id, { completedSteps: index + 1 })
        }
        summary = summaries.join('\n\n')
        this.ctx.wikiStorage.saveDocumentSummary(snapshot(document), `${FULL_SUMMARY_MARKER}\n${summary}`)
      } else {
        generation = this.ctx.wikiStorage.updateGeneration(id, { completedSteps: chunks.length })
      }
      generation = this.ctx.wikiStorage.updateGeneration(id, { phase: 'synthesizing' })
      this.throwIfCancelled(id, controller.signal)
      const libraryName = this.ctx.knowledgeCatalog.listLibraries().find(library => library.id === document.libraryId)?.name ?? '未分组'
      const existing = this.ctx.wikiStorage.pagesForDocument(document.id).filter(page => page.pageType !== 'index')
      if (existing.some(page => page.state === 'locked')) throw new RangeError('该词条已锁定；该文章关联的词条需先全部允许自动更新')
      const existingPages = existing.flatMap(item => {
        const value = this.ctx.wikiStorage.getPage(item.id)
        return value === undefined ? [] : [{
          slug: value.slug,
          title: value.title,
          pageType: value.pageType,
          summary: value.summary,
          purpose: value.purpose,
          sections: value.sections.map(section => ({ title: section.title, body: section.body })),
        }]
      })
      const existingPagesForPrompt = existingPages.map(page => ({
        slug: page.slug,
        title: page.title,
        pageType: page.pageType,
        summary: page.summary,
        purpose: page.purpose,
      }))
      const existingCategories = this.ctx.wikiStorage.listFolders().map(folder => folder.path)
      const synthesisDocument = {
        documentId: document.id,
        libraryId: document.libraryId,
        libraryName,
        title: document.title,
        contentHash: document.contentHash,
        ...(chunks.length === 1
          ? { content: preview.content }
          : { contentCoverage: `全文已按 ${chunks.length} 段逐段摘要；summary 覆盖全部分段。` }),
      }
      const maxSynthesisCharacters = modelCharacterLimit(settings.maxInputTokens)
      const synthesisEnvelope = (summaryValue: string, batchIndex: number, batchTotal: number): string => JSON.stringify({
        document: {
          ...synthesisDocument,
          summary: summaryValue,
          ...(batchTotal > 1 ? { synthesisBatch: `${batchIndex}/${batchTotal}` } : {}),
        },
        existingPages: existingPagesForPrompt,
        existingCategories,
      })
      const summaryParts = chunks.length === 1 ? [summary] : parseSegmentSummaries(summary)
      const emptyEnvelopeLength = synthesisEnvelope('', summaryParts.length, summaryParts.length).length
      const summaryBudget = maxSynthesisCharacters - emptyEnvelopeLength - 256
      if (summaryBudget < 512) {
        throw new RangeError('现有词条信息过多，无法在模型输入上限内安全合成')
      }
      const summaryBatches = packSegmentSummaries(summaryParts, summaryBudget)
      generation = this.ctx.wikiStorage.updateGeneration(id, { totalSteps: chunks.length + summaryBatches.length })
      const batchPages: PlannedPage[] = []
      for (const [batchIndex, batch] of summaryBatches.entries()) {
        this.throwIfCancelled(id, controller.signal)
        generation = this.ctx.wikiStorage.updateGeneration(id, {
          phase: summaryBatches.length === 1 ? 'synthesizing' : `synthesizing:${batchIndex + 1}/${summaryBatches.length}`,
          completedSteps: chunks.length + batchIndex,
        })
        const synthesisInput = synthesisEnvelope(batch.join('\n\n'), batchIndex + 1, summaryBatches.length)
        let synthesis = await this.ctx.llmClient.complete({
          settings: {
            ...settings,
            requestTimeoutMs: Math.max(settings.requestTimeoutMs, 180_000),
          },
          signal: controller.signal,
          temperature: 0.2,
          json: true,
          maxAttempts: 3,
          messages: [
            {
              role: 'system',
              content: [
                '你是 Wiki 编辑。不要把整篇文章改写成一个词条。请提取文章中最关键、值得长期检索和独立解释的人物、组织、地点、产品、项目、术语、概念、制度、流程、决策和事件，分别生成词条。',
                '提取优先级：新出现或反复出现的专有名词与新词 > 明确命名的人物、组织、产品和项目 > 有时间、参与者、原因或影响的事件与决策 > 普通背景概念。',
                '只保留有稳定名称、包含可验证事实或对理解知识库重要的对象；忽略泛词、一次性措辞、文章标题和仅有一句带过的次要对象。通常生成 2 到 8 个词条，信息不足时可以更少。',
                '只输出 JSON：{"pages":[{"title":"...","slug":"entity/example","summary":"不超过80字","pageType":"entity","aliases":[],"purpose":"...","questions":["..."],"folderPath":["人物"],"parentSlug":null,"sections":[{"title":"...","body":"Markdown","sourceDocumentIds":["文档ID"]}]}]}。',
                'pageType 只能是 entity、concept、glossary、project、policy、procedure、decision、event、topic。',
                '必须且只能使用输入中的这一篇文档 ID 作为 sourceDocumentIds。',
                '优先使用 existingCategories 中合适的分类；没有合适分类时，使用人物、组织、地点、产品与项目、术语与概念、制度与规则、流程与操作、决策、事件之一。',
                '如果对象与 existingPages 中词条相同，必须沿用其 slug 并更新内容，避免重复词条。',
                '词条要让没读过原文的人也能看懂。原文写明的事实、数字、结论必须忠实保留，不得编造文中没有的数据、日期、人名或决策。',
                '可以用通用知识补全简明解释，但必须与原文事实清楚区分，不得杜撰具体信息。',
                '不要写 Wiki 首页，不要写主题导航，不要输出思考过程。每页 1 到 3 个章节。',
              ].join('\n'),
            },
            { role: 'user', content: synthesisInput },
          ],
        })
        generation = this.addUsage(generation, synthesis)
        this.throwIfCancelled(id, controller.signal)
        try {
          batchPages.push(...this.parsePages(synthesis.content, [document]))
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('JSON')) throw error
          generation = this.ctx.wikiStorage.updateGeneration(id, { phase: 'synthesizing:compact-retry' })
          synthesis = await this.ctx.llmClient.complete({
            settings: {
              ...settings,
              requestTimeoutMs: Math.max(settings.requestTimeoutMs, 180_000),
            },
            signal: controller.signal,
            temperature: 0.1,
            json: true,
            maxAttempts: 2,
            messages: [
              {
                role: 'system',
                content: [
                  '上一次 Wiki JSON 被截断。请返回紧凑且完整的 {"pages":[...]}。',
                  '只保留最关键的 2 到 5 个人物、组织、地点、项目、概念、决策或事件词条，每页 1 到 2 个章节。',
                  '每个章节不超过 500 个中文字符。来源 ID 必须是输入中的文档。不得编造文中没有的具体事实。',
                ].join('\n'),
              },
              { role: 'user', content: synthesisInput },
            ],
          })
          generation = this.addUsage(generation, synthesis)
          this.throwIfCancelled(id, controller.signal)
          batchPages.push(...this.parsePages(synthesis.content, [document]))
        }
        generation = this.ctx.wikiStorage.updateGeneration(id, { completedSteps: chunks.length + batchIndex + 1 })
      }
      const parsedPages = mergePlannedPagesBySlug(batchPages)
      if (parsedPages.length === 0) throw new Error('LLM 未生成词条')
      const availableCategoryPaths = new Set(this.ctx.wikiStorage.listFolders().map(folder => folder.path))
      const generated = parsedPages.filter(page => page.pageType !== 'index').map(page => ({
        ...page,
        folderPath: page.folderPath !== undefined && availableCategoryPaths.has(page.folderPath.join('/'))
          ? page.folderPath
          : defaultFolderPath(page.pageType ?? 'concept'),
        status: 'draft' as const,
        sections: page.sections.map(section => ({
          ...section,
          sources: [wikiSource(document)],
        })),
      }))
      if (generated.length === 0) throw new Error('LLM 未提取到有效词条')
      const folders = this.ctx.wikiStorage.listFolders()
      const folderPathById = new Map(folders.map(folder => [folder.id, folder.path.split('/').filter(Boolean)]))
      const generatedSlugs = new Set(generated.map(page => page.slug))
      const replacedIds = new Set(existing.map(page => page.id))
      const preserved: PlannedPage[] = this.storedPages()
        .filter(page => page.pageType !== 'index' && !generatedSlugs.has(page.slug) && !replacedIds.has(page.id))
        .map(page => ({
          ...page,
          folderPath: page.folderId === undefined ? [] : folderPathById.get(page.folderId) ?? [],
        }))
      const planned = linkGeneratedPages([...generated, ...preserved], [...generated, ...preserved]) as PlannedPage[]
      const organized = organizePages(planned)
      const previous = this.ctx.wikiStorage.listDocumentSnapshots()
      const nextSnapshots = [
        ...previous.filter(item => item.documentId !== document.id),
        {
          ...snapshot(document),
          ...(summary === '' ? {} : { summary }),
        },
      ]
      this.ctx.wikiStorage.replaceWiki(organized.pages, nextSnapshots, new Date().toISOString(), organized.folders)
      this.ctx.wikiStorage.updateGeneration(id, {
        state: 'completed',
        phase: 'completed',
        completedSteps: chunks.length + summaryBatches.length,
        completedAt: new Date().toISOString(),
      })
    } catch (error) {
      const current = this.ctx.wikiStorage.getGeneration(id)
      if (current?.state === 'cancelled' || controller.signal.aborted) {
        if (current?.state !== 'cancelled') {
          this.ctx.wikiStorage.updateGeneration(id, {
            state: 'cancelled',
            phase: 'cancelled',
            completedAt: new Date().toISOString(),
          })
        }
        return
      }
      const failedPhase = current?.phase ?? 'unknown'
      this.ctx.wikiStorage.updateGeneration(id, {
        state: 'failed',
        phase: 'failed',
        completedAt: new Date().toISOString(),
        error: `${friendlyPhase(failedPhase)}：${error instanceof Error ? error.message : String(error)}`,
      })
      this.ctx.logger('llm-wiki').warn('wiki generation failed', error)
    }
  }

  private parsePages(raw: string, documents: KnowledgeDocument[]): PlannedPage[] {
    const parsed = parseJsonObject(raw)
    const sourcePages = Array.isArray(parsed.pages) ? parsed.pages as GeneratedPage[] : []
    if (sourcePages.length === 0 || sourcePages.length > 200) throw new Error('LLM 未返回有效的 Wiki 页面')
    const documentMap = new Map(documents.map(document => [document.id, document]))
    const slugs = new Set<string>()
    const pages = sourcePages.map((page, order) => {
      const title = text(page.title, '页面标题', 1, 200)
      const type = generatedPageType(page.pageType)
      const slug = uniqueSlug(normalizeWikiSlug(page.slug, title, type), slugs)
      const folderPath = generatedFolderPath(page.folderPath)
      const rawSections = Array.isArray(page.sections) ? page.sections as GeneratedSection[] : []
      if (rawSections.length === 0 || rawSections.length > 100) throw new Error(`Wiki 页面“${title}”章节无效`)
      return {
        id: randomUUID(),
        slug,
        title,
        summary: typeof page.summary === 'string' ? page.summary.trim().slice(0, 500) : '',
        pageType: type,
        status: generatedPageStatus(page.status),
        aliases: generatedAliases(page.aliases),
        purpose: typeof page.purpose === 'string' ? page.purpose.trim().slice(0, 500) : '',
        questions: generatedQuestions(page.questions),
        ...(folderPath === undefined ? {} : { folderPath }),
        order,
        state: 'ready' as const,
        parentSlug: typeof page.parentSlug === 'string' ? normalizeSlug(page.parentSlug, '') : undefined,
        sections: rawSections.map((section, sectionOrder) => {
          const sources = sourceIds(section.sourceDocumentIds).flatMap(documentId => {
            const document = documentMap.get(documentId)
            return document === undefined ? [] : [wikiSource(document)]
          })
          if (sources.length === 0) throw new Error(`Wiki 章节“${String(section.title ?? '')}”没有有效来源`)
          return {
            id: randomUUID(),
            title: text(section.title, '章节标题', 1, 200),
            body: text(section.body, '章节正文', 1, 200_000),
            order: sectionOrder,
            state: 'ready' as const,
            sources,
          }
        }),
      }
    })
    const idBySlug = new Map(pages.map(page => [page.slug, page.id]))
    return pages.map(({ parentSlug, ...page }) => {
      const parentId = parentSlug === undefined ? undefined : idBySlug.get(parentSlug)
      return {
        ...page,
        ...(parentId === undefined ? {} : { parentId }),
      }
    })
  }

  private storedPages(): WikiPageWrite[] {
    return this.pageWrites(this.ctx.wikiStorage.listPages())
  }

  private pageWrites(summaries: WikiPageSummary[]): WikiPageWrite[] {
    return summaries.flatMap(summary => {
      const page = this.ctx.wikiStorage.getPage(summary.id)
      if (page === undefined) return []
      return [{
        id: page.id,
        slug: page.slug,
        title: page.title,
        summary: page.summary,
        pageType: page.pageType,
        status: page.status,
        aliases: page.aliases,
        purpose: page.purpose,
        questions: page.questions,
        ...(page.folderId === undefined ? {} : { folderId: page.folderId }),
        ...(page.parentId === undefined ? {} : { parentId: page.parentId }),
        order: page.order,
        state: page.state,
        sections: page.sections,
      }]
    })
  }

  private collectChanges(): DocumentChangeSet {
    const current = this.ctx.knowledgeCatalog.listLibraries()
      .flatMap(library => this.ctx.knowledgeCatalog.listDocuments(library.id))
    const previous = this.ctx.wikiStorage.listDocumentSnapshots()
    const previousById = new Map(previous.map(item => [item.documentId, item]))
    const currentById = new Map(current.map(item => [item.id, item]))
    return {
      current,
      added: current.filter(document => !previousById.has(document.id)),
      updated: current.filter(document => {
        const item = previousById.get(document.id)
        return item !== undefined && item.contentHash !== document.contentHash
      }),
      deleted: previous.filter(item => !currentById.has(item.documentId)),
    }
  }

  private changeSummary(changes: DocumentChangeSet): WikiChangeSummary {
    return {
      totalDocuments: changes.current.length,
      added: changes.added.length,
      updated: changes.updated.length,
      deleted: changes.deleted.length,
    }
  }

  private addUsage(generation: WikiGeneration, result: ChatCompletionResult): WikiGeneration {
    return this.ctx.wikiStorage.updateGeneration(generation.id, {
      inputTokens: generation.inputTokens + result.inputTokens,
      outputTokens: generation.outputTokens + result.outputTokens,
    })
  }

  private throwIfCancelled(id: string, signal: AbortSignal): void {
    if (signal.aborted || this.ctx.wikiStorage.getGeneration(id)?.state === 'cancelled') {
      throw new Error('Wiki 生成任务已取消')
    }
  }

  private currentSettings() {
    return this.ctx.settings.llmIntegration(providerId => this.ctx.llmCredentials.status(providerId))
  }

  private wikiEndpoint(): LlmResolvedEndpoint {
    const endpoint = resolveWikiLlmModel(this.currentSettings())
    if (endpoint === undefined || endpoint.model.trim().length === 0) {
      throw new RangeError('尚未配置 Wiki 生成模型')
    }
    if (!endpoint.apiKeyConfigured) throw new RangeError('Wiki 生成模型尚未配置 API Key')
    this.ctx.llmCredentials.getApiKey(endpoint.providerId)
    return endpoint
  }
}

function snapshot(document: KnowledgeDocument): WikiDocumentSnapshot {
  return {
    documentId: document.id,
    libraryId: document.libraryId,
    title: document.title,
    contentHash: document.contentHash,
  }
}

function wikiSource(document: KnowledgeDocument): WikiSource {
  const libraryId = encodeURIComponent(document.libraryId)
  const documentId = encodeURIComponent(document.id)
  return {
    documentId: document.id,
    libraryId: document.libraryId,
    title: document.title,
    referenceUri: `tk://local/${libraryId}/${documentId}`,
    contentHash: document.contentHash,
  }
}

function sourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

function linkGeneratedPages(pages: WikiPageWrite[], targets: WikiPageWrite[]): WikiPageWrite[] {
  const terms = targets.flatMap(target => [target.title, ...(target.aliases ?? [])]
    .map(label => ({ label: label.trim(), slug: target.slug }))
    .filter(item => item.label.length >= 2))
    .sort((left, right) => right.label.length - left.label.length)
  return pages.map(page => ({
    ...page,
    sections: page.sections.map(section => ({
      ...section,
      body: page.pageType === 'index'
        ? section.body
        : autoLinkBody(section.body, page.slug, terms),
    })),
  }))
}

function autoLinkBody(body: string, currentSlug: string, terms: Array<{ label: string, slug: string }>): string {
  const protectedParts = body.split(/(\[\[[^\]\n]+\]\]|`[^`\n]*`|\[[^\]\n]+\]\([^)]+\))/g)
  return protectedParts.map((part, index) => {
    if (index % 2 === 1) return part
    let value = part
    const linked = new Set<string>()
    for (const term of terms) {
      if (term.slug === currentSlug || linked.has(term.slug)) continue
      const pattern = mentionPattern(term.label)
      if (!pattern.test(value)) continue
      value = value.replace(pattern, match => `[[${term.slug}|${match}]]`)
      linked.add(term.slug)
    }
    return value
  }).join('')
}

function mentionPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return /^[\p{L}\p{N}]+$/u.test(label) && /^[\x00-\x7F]+$/.test(label)
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu')
    : new RegExp(escaped, 'iu')
}

function createIndexPage(input: PlannedPage[]): WikiPageWrite {
  const groups = new Map<string, PlannedPage[]>()
  for (const page of input.filter(item => item.pageType !== 'index')) {
    const category = page.folderPath?.[0] ?? '未分组'
    const pages = groups.get(category) ?? []
    pages.push(page)
    groups.set(category, pages)
  }
  const body = [...groups.entries()].map(([name, pages]) => [
    `## ${name}`,
    ...pages.map(page => `- [[${page.slug}|${page.title}]]`),
  ].join('\n')).join('\n\n')
  return {
    id: randomUUID(),
    slug: 'index',
    title: 'Wiki 首页',
    summary: '',
    pageType: 'index',
    status: 'published',
    aliases: [],
    purpose: '',
    questions: [],
    order: -1,
    state: 'ready',
    sections: [{
      id: randomUUID(),
      title: '词条目录',
      body,
      order: 0,
      state: 'ready',
      sources: [],
    }],
  }
}

function organizePages(input: PlannedPage[]): {
  pages: WikiPageWrite[]
  folders: WikiFolderWrite[]
} {
  const planned = [...input]
  if (!planned.some(page => page.pageType === 'index')) {
    planned.unshift(createIndexPage(input))
  }

  const folders = new Map<string, WikiFolderWrite>()
  const pages = planned.map(({ folderPath, ...page }) => {
    const type = page.pageType ?? 'concept'
    const path = type === 'index' ? [] : folderPath?.length ? folderPath : defaultFolderPath(type)
    let parentId: string | undefined
    let currentPath = ''
    for (const [depth, name] of path.entries()) {
      currentPath = currentPath === '' ? name : `${currentPath}/${name}`
      let folder = folders.get(currentPath)
      if (folder === undefined) {
        folder = {
          id: stableFolderId(currentPath),
          name,
          path: currentPath,
          ...(parentId === undefined ? {} : { parentId }),
          depth,
          order: folders.size,
        }
        folders.set(currentPath, folder)
      }
      parentId = folder.id
    }
    return {
      ...page,
      ...(parentId === undefined ? {} : { folderId: parentId }),
    }
  })
  return { pages, folders: [...folders.values()] }
}

function generatedFolderPath(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result = value.flatMap(item => typeof item === 'string' ? [normalizeFolderName(item)] : [])
    .filter((item): item is string => item !== undefined)
    .slice(0, 2)
  return result.length === 0 ? undefined : result
}

function normalizeFolderName(value: string): string | undefined {
  const name = value.trim().replaceAll('/', '／').slice(0, 50)
  if (name.length === 0 || /^(entity|concept|summary)$/i.test(name)) return undefined
  return name
}

function defaultFolderPath(type: WikiPageType): string[] {
  if (type === 'entity') return ['实体']
  if (type === 'concept' || type === 'glossary') return ['术语与概念']
  if (type === 'project') return ['项目']
  if (type === 'policy') return ['制度与规则']
  if (type === 'procedure') return ['流程与操作']
  if (type === 'decision') return ['决策']
  if (type === 'event') return ['事件']
  if (type === 'topic' || type === 'synthesis') return ['专题']
  if (type === 'comparison') return ['对比']
  if (type === 'summary') return ['文档摘要']
  return ['综合']
}

function stableFolderId(path: string): string {
  return `folder-${createHash('sha256').update(path).digest('hex').slice(0, 24)}`
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('LLM 返回内容不是 JSON')
  let value: unknown
  try {
    value = JSON.parse(trimmed.slice(start, end + 1))
  } catch (error) {
    throw new Error('LLM 返回的 Wiki JSON 无法解析', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('LLM 返回的 Wiki JSON 结构无效')
  return value as Record<string, unknown>
}

function normalizeSlug(value: unknown, fallback: string): string {
  const source = typeof value === 'string' ? value : fallback
  const slug = source.toLowerCase().trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  return slug.length === 0 ? 'page' : slug
}

function normalizeWikiSlug(value: unknown, fallback: string, type: WikiPageType): string {
  if (type === 'index') return 'index'
  const raw = typeof value === 'string' ? value.trim() : ''
  const parts = raw.split('/').filter(Boolean)
  const base = normalizeSlug(parts.at(-1), fallback)
  return type !== 'synthesis' && type !== 'comparison'
    ? `${type}/${base}`
    : `${type}/${base}`
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base
  let suffix = 2
  while (used.has(slug)) slug = `${base}-${suffix++}`
  used.add(slug)
  return slug
}

function modelCharacterLimit(maxTokens: number): number {
  return Math.max(4_000, maxTokens * 4)
}

export function parseSegmentSummaries(summary: string): string[] {
  const matches = [...summary.matchAll(/^## 第 (\d+)\/(\d+) 段\s*$/gm)]
  if (matches.length === 0) return summary.trim() === '' ? [] : [summary.trim()]
  return matches.map((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? summary.length
    return summary.slice(start, end).trim()
  }).filter(Boolean)
}

export function packSegmentSummaries(parts: string[], maxCharacters: number): string[][] {
  if (parts.length === 0) return [['']]
  const batches: string[][] = []
  let current: string[] = []
  let currentLength = 0
  for (const part of parts) {
    if (part.length > maxCharacters) throw new RangeError('单段摘要超过模型输入上限，请提高模型输入长度后重试')
    const separator = current.length === 0 ? 0 : 2
    if (current.length > 0 && currentLength + separator + part.length > maxCharacters) {
      batches.push(current)
      current = []
      currentLength = 0
    }
    current.push(part)
    currentLength += (current.length === 1 ? 0 : 2) + part.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function mergePlannedPagesBySlug(pages: PlannedPage[]): PlannedPage[] {
  const merged = new Map<string, PlannedPage>()
  for (const page of pages) {
    const current = merged.get(page.slug)
    if (current === undefined) {
      merged.set(page.slug, page)
      continue
    }
    const sections = [...current.sections]
    for (const section of page.sections) {
      const existing = sections.find(item => item.title === section.title)
      if (existing === undefined) {
        sections.push({ ...section, order: sections.length })
        continue
      }
      if (section.body !== existing.body && !existing.body.includes(section.body)) {
        existing.body = `${existing.body}\n\n${section.body}`
      }
      existing.sources = [...existing.sources, ...section.sources.filter(source =>
        !existing.sources.some(item => item.documentId === source.documentId))]
    }
    const mergedSummary = (page.summary?.length ?? 0) > (current.summary?.length ?? 0) ? page.summary : current.summary
    const mergedPurpose = (page.purpose?.length ?? 0) > (current.purpose?.length ?? 0) ? page.purpose : current.purpose
    merged.set(page.slug, {
      ...current,
      ...(mergedSummary === undefined ? {} : { summary: mergedSummary }),
      ...(mergedPurpose === undefined ? {} : { purpose: mergedPurpose }),
      aliases: [...new Set([...(current.aliases ?? []), ...(page.aliases ?? [])])],
      questions: [...new Set([...(current.questions ?? []), ...(page.questions ?? [])])],
      sections,
    })
  }
  return [...merged.values()].map((page, order) => ({ ...page, order }))
}

export function splitDocumentForModel(content: string, maxTokens: number): string[] {
  const maxCharacters = Math.min(120_000, Math.max(12_000, Math.floor(maxTokens * 3)))
  if (content.length <= maxCharacters) return [content]
  const chunks: string[] = []
  let cursor = 0
  while (cursor < content.length) {
    const target = Math.min(content.length, cursor + maxCharacters)
    if (target === content.length) {
      chunks.push(content.slice(cursor))
      break
    }
    const minimumBoundary = cursor + Math.floor(maxCharacters * 0.7)
    const pageBoundary = content.lastIndexOf('\f', target)
    const paragraphBoundary = content.lastIndexOf('\n\n', target)
    const lineBoundary = content.lastIndexOf('\n', target)
    const boundary = Math.max(pageBoundary, paragraphBoundary, lineBoundary)
    const end = boundary >= minimumBoundary ? boundary + (boundary === pageBoundary ? 1 : boundary === paragraphBoundary ? 2 : 1) : target
    chunks.push(content.slice(cursor, end))
    cursor = end
  }
  return chunks
}

function text(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new RangeError(`${label}必须是文本`)
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new RangeError(`${label}长度应为 ${minimum} 到 ${maximum} 个字符`)
  }
  return normalized
}

function generatedPageType(value: unknown): WikiPageType {
  return value === 'entity' || value === 'concept' || value === 'glossary'
    || value === 'project' || value === 'policy' || value === 'procedure'
    || value === 'decision' || value === 'event' || value === 'topic' || value === 'index'
    || value === 'synthesis' || value === 'comparison'
    ? value
    : 'concept'
}

function generatedPageStatus(value: unknown): WikiPageStatus {
  return value === 'draft' || value === 'published' ? value : 'published'
}

function generatedAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim()).filter(item => item.length > 0))].slice(0, 20)
}

function generatedQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap(item => typeof item === 'string' && item.trim() !== ''
    ? [item.trim().slice(0, 200)]
    : []))].slice(0, 5)
}

function pageType(value: WikiPageType): WikiPageType {
  if (value === 'summary' || value === 'entity' || value === 'concept' || value === 'glossary'
    || value === 'project' || value === 'policy' || value === 'procedure'
    || value === 'decision' || value === 'event' || value === 'topic' || value === 'index'
    || value === 'synthesis' || value === 'comparison') return value
  throw new RangeError('Wiki 页面类型无效')
}

function pageStatus(value: WikiPageStatus): WikiPageStatus {
  if (value === 'draft' || value === 'published' || value === 'archived') return value
  throw new RangeError('Wiki 页面状态无效')
}

function aliases(value: string[]): string[] {
  if (!Array.isArray(value)) throw new RangeError('Wiki 页面别名必须是数组')
  if (value.length > 20) throw new RangeError('Wiki 页面别名最多 20 个')
  return [...new Set(value.map(item => text(item, '页面别名', 1, 100)))]
}

function questions(value: string[]): string[] {
  if (!Array.isArray(value)) throw new RangeError('Wiki 词条问题必须是数组')
  if (value.length > 5) throw new RangeError('Wiki 词条问题最多 5 个')
  return [...new Set(value.map(item => text(item, '词条问题', 1, 200)))]
}

function folderName(value: unknown): string {
  if (typeof value !== 'string') throw new RangeError('分类名称必须是文本')
  const name = normalizeFolderName(value)
  if (name === undefined) throw new RangeError('分类名称不能为空')
  return name
}

function friendlyPhase(phase: string): string {
  if (phase === 'planning') return '规划并筛选 Wiki 词条'
  if (phase === 'planning:compact-retry') return '紧凑重试词条规划'
  if (phase === 'synthesizing') return '生成 Wiki 页面'
  if (phase === 'synthesizing:compact-retry') return '紧凑重试 Wiki 页面'
  const synthesisBatch = /^synthesizing:(\d+)\/(\d+)$/.exec(phase)
  if (synthesisBatch !== null) return `分批生成 Wiki 页面 ${synthesisBatch[1]}/${synthesisBatch[2]}`
  if (phase.startsWith('summarizing:')) return `摘要文档 ${phase.slice('summarizing:'.length)}`
  if (phase === 'scanning') return '扫描知识库'
  return phase
}

export default LlmWiki
