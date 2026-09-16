import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type {
  KnowledgeDocument,
  LlmIntegrationSettings,
  StartWikiGenerationInput,
  UpdateWikiPageInput,
  WikiChangeSummary,
  WikiEstimate,
  WikiFolder,
  WikiGeneration,
  WikiGenerationMode,
  WikiPage,
  WikiPageRevision,
  WikiPageSummary,
  WikiPageStatus,
  WikiPageType,
  WikiSource,
  WikiStatus,
} from '@tiggyknowledge/contracts'
import type { ChatCompletionResult } from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-credentials'
import type {} from '@tiggyknowledge/preview-text'
import type {} from '@tiggyknowledge/settings-file'
import type { WikiDocumentSnapshot, WikiFolderWrite, WikiPageWrite } from '@tiggyknowledge/wiki-sqlite'
import type {} from '@tiggyknowledge/wiki-sqlite'

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

interface GeneratedCandidate {
  title?: unknown
  slug?: unknown
  pageType?: unknown
  aliases?: unknown
  purpose?: unknown
  questions?: unknown
  folderPath?: unknown
  sourceDocumentIds?: unknown
  factCount?: unknown
  referencePotential?: unknown
  stableIdentity?: unknown
  transient?: unknown
  estimatedCharacters?: unknown
  reasons?: unknown
}

interface EntryCandidate {
  title: string
  slug: string
  pageType: WikiPageType
  aliases: string[]
  purpose: string
  questions: string[]
  folderPath: string[]
  sourceDocumentIds: string[]
  factCount: number
  referencePotential: number
  stableIdentity: boolean
  transient: boolean
  estimatedCharacters: number
  score: number
  reasons: string[]
}

export class LlmWiki extends Service {
  static inject = [
    'knowledgeCatalog',
    'knowledgePreview',
    'llmClient',
    'llmCredentials',
    'settings',
    'wikiStorage',
  ]

  private activeController: AbortController | undefined

  constructor(ctx: Context) {
    super(ctx, 'llmWiki')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const interrupted = this.ctx.wikiStorage.activeGeneration()
    if (interrupted !== undefined) {
      this.ctx.wikiStorage.updateGeneration(interrupted.id, {
        state: 'failed',
        phase: 'failed',
        completedAt: new Date().toISOString(),
        error: '应用已重启，先前的 Wiki 生成任务未能完成',
      })
    }
    const disposeDeleted = this.ctx.on('knowledge/document/deleted', documentIds => {
      this.ctx.wikiStorage.markSourcesMissing(documentIds)
    })
    yield () => {
      disposeDeleted()
      this.activeController?.abort()
    }
  }

  status(): WikiStatus {
    const changes = this.changeSummary(this.collectChanges())
    const active = this.ctx.wikiStorage.activeGeneration()
    const latest = this.ctx.wikiStorage.latestGeneration()
    const pageCount = this.ctx.wikiStorage.listPages().length
    const lastGeneratedAt = this.ctx.wikiStorage.lastGeneratedAt()
    const credentials = this.ctx.llmCredentials.snapshot()
    const settings = this.settings(credentials.configured, credentials.preview)
    let state: WikiStatus['state']
    if (active !== undefined) state = 'generating'
    else if (latest?.state === 'failed') state = 'failed'
    else if (pageCount === 0) state = 'never-generated'
    else if (changes.added + changes.updated + changes.deleted > 0) state = 'stale'
    else state = 'ready'
    return {
      state,
      llmConfigured: settings.enabled && settings.model.length > 0 && credentials.configured,
      pageCount,
      ...(lastGeneratedAt === undefined ? {} : { lastGeneratedAt }),
      ...(active === undefined ? {} : { activeGenerationId: active.id }),
      ...(latest === undefined ? {} : { lastGeneration: latest }),
      changes,
    }
  }

  estimate(mode: WikiGenerationMode): WikiEstimate {
    validateMode(mode)
    const changes = this.collectChanges()
    const process = mode === 'incremental' ? [...changes.added, ...changes.updated] : changes.current
    return {
      mode,
      documentsToProcess: process.length,
      estimatedInputTokens: process.reduce((total, document) => total + Math.ceil(document.sizeBytes / 4), 0),
      changes: this.changeSummary(changes),
    }
  }

  start(input: StartWikiGenerationInput): WikiGeneration {
    validateMode(input.mode)
    if (this.ctx.wikiStorage.activeGeneration() !== undefined || this.activeController !== undefined) {
      throw new RangeError('已有 Wiki 生成任务正在运行')
    }
    const settings = this.currentSettings()
    if (!settings.enabled) throw new RangeError('LLM 集成尚未启用')
    if (settings.model.trim().length === 0) throw new RangeError('尚未配置 LLM 模型')
    this.ctx.llmCredentials.getApiKey()

    const estimate = this.estimate(input.mode)
    const needsSynthesis = input.mode !== 'incremental'
      || estimate.changes.added + estimate.changes.updated + estimate.changes.deleted > 0
    const generation: WikiGeneration = {
      id: randomUUID(),
      mode: input.mode,
      state: 'pending',
      phase: 'queued',
      totalSteps: estimate.documentsToProcess + (needsSynthesis ? 2 : 0),
      completedSteps: 0,
      estimatedInputTokens: estimate.estimatedInputTokens,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: new Date().toISOString(),
    }
    this.ctx.wikiStorage.createGeneration(generation)
    const controller = this.activeController = new AbortController()
    void this.runGeneration(generation.id, settings, controller).finally(() => {
      if (this.activeController === controller) this.activeController = undefined
    })
    return generation
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
    if (generation.state !== 'pending' && generation.state !== 'running') return generation
    this.activeController?.abort()
    return this.ctx.wikiStorage.updateGeneration(id, {
      state: 'cancelled',
      phase: 'cancelled',
      completedAt: new Date().toISOString(),
    })
  }

  pages(): WikiPageSummary[] {
    return this.ctx.wikiStorage.listPages()
  }

  folders(): WikiFolder[] {
    return this.ctx.wikiStorage.listFolders()
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

  private async runGeneration(id: string, settings: LlmIntegrationSettings, controller: AbortController): Promise<void> {
    try {
      let generation = this.ctx.wikiStorage.updateGeneration(id, { state: 'running', phase: 'scanning' })
      const changes = this.collectChanges()
      const documents = generation.mode === 'incremental' ? [...changes.added, ...changes.updated] : changes.current
      if (changes.current.length === 0) {
        if (generation.mode !== 'incremental') throw new RangeError('没有可用于生成 Wiki 的文档')
        this.ctx.wikiStorage.replaceWiki([], [], new Date().toISOString())
        this.ctx.wikiStorage.updateGeneration(id, {
          state: 'completed',
          phase: 'completed',
          completedSteps: generation.totalSteps,
          completedAt: new Date().toISOString(),
        })
        return
      }

      if (generation.mode === 'incremental'
        && changes.added.length + changes.updated.length + changes.deleted.length === 0) {
        this.throwIfCancelled(id, controller.signal)
        this.ctx.wikiStorage.updateGeneration(id, {
          state: 'completed',
          phase: 'completed',
          completedAt: new Date().toISOString(),
        })
        return
      }

      for (const document of documents) {
        this.throwIfCancelled(id, controller.signal)
        generation = this.ctx.wikiStorage.updateGeneration(id, { phase: `summarizing:${document.id}` })
        const cached = generation.mode !== 'rebuild'
          ? this.ctx.wikiStorage.cachedSummary(document.id, document.contentHash)
          : undefined
        if (cached === undefined) {
          const preview = await this.ctx.knowledgePreview.preview(document.id)
          const result = await this.ctx.llmClient.complete({
            settings,
            signal: controller.signal,
            temperature: 0.1,
            maxAttempts: 3,
            messages: [
              {
                role: 'system',
                content: '你是知识库编辑。请准确概括文档的核心事实、术语、流程和约束，保留可验证细节。只输出摘要正文。',
              },
              {
                role: 'user',
                content: `文档 ID: ${document.id}\n标题: ${document.title}\n\n${truncateForModel(preview.content, settings.maxInputTokens)}`,
              },
            ],
          })
          this.ctx.wikiStorage.saveDocumentSummary(snapshot(document), result.content.trim())
          generation = this.addUsage(generation, result)
        }
        generation = this.ctx.wikiStorage.updateGeneration(id, { completedSteps: generation.completedSteps + 1 })
      }

      this.throwIfCancelled(id, controller.signal)
      const currentSnapshots = changes.current.map(document => {
        const value = snapshot(document)
        const summary = this.ctx.wikiStorage.cachedSummary(document.id, document.contentHash)
        return summary === undefined ? value : { ...value, summary }
      })
      const documentInput = currentSnapshots.map(item => ({
        documentId: item.documentId,
        libraryId: item.libraryId,
        title: item.title,
        contentHash: item.contentHash,
        summary: item.summary ?? '',
      }))
      generation = this.ctx.wikiStorage.updateGeneration(id, { phase: 'planning' })
      const planningInput = truncateForModel(JSON.stringify({
        documents: documentInput,
        existingPages: this.ctx.wikiStorage.listPages().map(page => ({
          title: page.title,
          slug: page.slug,
          pageType: page.pageType,
          aliases: page.aliases,
        })),
      }), settings.maxInputTokens)
      let planning = await this.ctx.llmClient.complete({
        settings: {
          ...settings,
          requestTimeoutMs: Math.max(settings.requestTimeoutMs, 180_000),
        },
        signal: controller.signal,
        temperature: 0,
        json: true,
        maxAttempts: 3,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Wiki 词条规划器，只提出值得独立成页的知识对象，不生成正文。',
              '只输出 JSON：{"candidates":[{"title":"...","slug":"entity/example","pageType":"entity","aliases":[],"purpose":"它在工作或个人知识管理中的具体用途","questions":["这个词条应回答的问题"],"folderPath":["领域"],"sourceDocumentIds":["真实文档ID"],"factCount":4,"referencePotential":2,"stableIdentity":true,"transient":false,"estimatedCharacters":500,"reasons":["可独立解释","会被复用"]}]}。',
              'pageType 只能是 entity、concept、glossary、project、policy、procedure、decision、topic、synthesis、comparison。',
              '同一对象的简称、旧称、英文名必须放入 aliases，不得拆成多个候选；相同对象应复用已有页面的 slug。',
              'factCount 是可独立验证的事实数量；referencePotential 为 0 到 2，表示其他页面引用价值。',
              'stableIdentity 仅用于名称和边界长期稳定的对象；transient 标记临时通知、一次性事件或短期状态。',
              'estimatedCharacters 是基于证据可写出的正文字符数。普通名词、单条事实、文档标题和章节标题不得成为候选。',
              'purpose 必须说明该页如何帮助定位、理解、决策或执行；questions 提供 1 到 5 个用户未来会主动询问的问题。无法给出明确用途和问题时不要建页。',
              'entity 表示稳定对象；glossary/concept 统一语言；project 跟踪长期工作对象；policy 表示规则约束；procedure 指导执行；decision 保存重要结论；topic/synthesis/comparison 用于跨文档整合。',
              'sourceDocumentIds 必须来自输入；宁缺毋滥，候选数量应与知识规模相称。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: planningInput,
          },
        ],
      })
      generation = this.addUsage(generation, planning)
      this.throwIfCancelled(id, controller.signal)
      let candidates: EntryCandidate[]
      try {
        candidates = parseCandidates(planning.content, changes.current)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('JSON')) throw error
        generation = this.ctx.wikiStorage.updateGeneration(id, { phase: 'planning:compact-retry' })
        planning = await this.ctx.llmClient.complete({
          settings: {
            ...settings,
            requestTimeoutMs: Math.max(settings.requestTimeoutMs, 180_000),
          },
          signal: controller.signal,
          temperature: 0,
          json: true,
          maxAttempts: 2,
          messages: [
            {
              role: 'system',
              content: [
                '上一次词条规划 JSON 被截断。请返回紧凑且完整的 {"candidates":[...]}，不要代码围栏或解释。',
                '只保留 3 到 12 个最有独立成页价值的候选。',
                '候选字段：title、slug、pageType、aliases、purpose、questions、folderPath、sourceDocumentIds、factCount、referencePotential、stableIdentity、transient、estimatedCharacters、reasons。',
                '同义名称必须合并，来源 ID 必须来自输入。',
              ].join('\n'),
            },
            { role: 'user', content: planningInput },
          ],
        })
        generation = this.addUsage(generation, planning)
        this.throwIfCancelled(id, controller.signal)
        candidates = parseCandidates(planning.content, changes.current)
      }
      const acceptedCandidates = mergeCandidates(candidates).filter(candidateAccepted)
      if (acceptedCandidates.length === 0) throw new Error('词条规划未发现达到独立成页标准的候选')
      generation = this.ctx.wikiStorage.updateGeneration(id, {
        candidateCount: candidates.length,
        acceptedCandidateCount: acceptedCandidates.length,
        completedSteps: generation.completedSteps + 1,
        phase: 'synthesizing',
      })
      const acceptedSourceIds = new Set(acceptedCandidates.flatMap(candidate => candidate.sourceDocumentIds))
      const synthesisInput = truncateForModel(JSON.stringify({
        documents: documentInput.filter(document => acceptedSourceIds.has(document.documentId)),
        acceptedCandidates,
      }), settings.maxInputTokens)
      let synthesis = await this.ctx.llmClient.complete({
        settings: {
          ...settings,
          requestTimeoutMs: Math.max(settings.requestTimeoutMs, 180_000),
        },
        signal: controller.signal,
        temperature: 0.1,
        json: true,
        maxAttempts: 3,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Wiki 编辑。仅为输入中的 acceptedCandidates 生成结构清晰、避免重复的中文 Wiki 正文。',
              '不要输出思考过程，只生成紧凑、有效的最终 JSON；页面和章节数量应与资料规模相称。',
              '只输出 JSON：{"pages":[{"title":"...","slug":"entity/example","summary":"短摘要","pageType":"entity","aliases":[],"purpose":"用途","questions":["问题"],"folderPath":["一级目录","二级目录"],"parentSlug":null,"sections":[{"title":"...","body":"Markdown","sourceDocumentIds":["文档ID"]}]}]}。',
              'pageType 只能使用候选中已有的类型。',
              '同一主题必须复用唯一稳定 slug；每个事实章节必须列出真实 sourceDocumentIds，不得编造 ID。',
              'aliases 必须列出正文中出现的常用简称、旧称、英文名和同义表达；同一对象的不同名称不得拆成多个页面。',
              '按主题而不是按源文件建页：多篇文档讨论同一主题时必须合并到同一页面，一篇文档包含多个实质主题时可以拆成多页。',
              'folderPath 是独立目录位置，最多两级；优先使用稳定、宽泛的领域分类，不得使用 entity、concept 或源文件名作为目录。',
              '不要生成 index 页面，系统会自动创建首页；总输出应控制在 3000 Token 内。',
              '不得创建 acceptedCandidates 之外的新页面；title、slug、pageType、aliases、folderPath 必须沿用候选规划。',
            ].join('\n'),
          },
          { role: 'user', content: synthesisInput },
        ],
      })
      generation = this.addUsage(generation, synthesis)
      this.throwIfCancelled(id, controller.signal)
      let parsedPages: PlannedPage[]
      try {
        parsedPages = this.parsePages(synthesis.content, changes.current)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('JSON')) throw error
        generation = this.ctx.wikiStorage.updateGeneration(id, { phase: 'synthesizing:compact-retry' })
        synthesis = await this.ctx.llmClient.complete({
          settings: {
            ...settings,
            requestTimeoutMs: Math.max(settings.requestTimeoutMs, 180_000),
          },
          signal: controller.signal,
          temperature: 0,
          json: true,
          maxAttempts: 2,
          messages: [
            {
              role: 'system',
              content: [
                '上一次 Wiki JSON 因输出过长而截断。请重新生成更紧凑且完整的 JSON，不要续写残片。',
                '只返回 {"pages":[...]}，不要 Markdown 代码围栏和思考过程。',
                '生成 3 到 6 个跨文档主题页；每页 1 到 3 个章节，每个章节正文不超过 400 个中文字符。',
                '页面字段：title、slug、summary、pageType、aliases、purpose、questions、folderPath、parentSlug、sections。',
                '章节字段：title、body、sourceDocumentIds；来源 ID 必须来自输入。不要生成 index 页面。',
              ].join('\n'),
            },
            { role: 'user', content: synthesisInput },
          ],
        })
        generation = this.addUsage(generation, synthesis)
        this.throwIfCancelled(id, controller.signal)
        parsedPages = this.parsePages(synthesis.content, changes.current)
      }
      parsedPages = restrictToCandidates(parsedPages, acceptedCandidates)
      if (parsedPages.length === 0) throw new Error('LLM 未生成任何已通过规划的 Wiki 页面')
      const consolidated = consolidatePages(parsedPages, this.ctx.wikiStorage.listPages())
      const planned = organizePages(consolidated, changes.current)
      const preserved = this.lockedPages()
      const preservedSlugs = new Set(preserved.map(page => page.slug))
      const generated = linkGeneratedPages(
        planned.pages.filter(page => !preservedSlugs.has(page.slug)),
        [...planned.pages, ...preserved],
      )
      this.ctx.wikiStorage.replaceWiki([
        ...generated,
        ...preserved,
      ], currentSnapshots, new Date().toISOString(), planned.folders)
      this.ctx.wikiStorage.updateGeneration(id, {
        state: 'completed',
        phase: 'completed',
        completedSteps: generation.totalSteps,
        inputTokens: generation.inputTokens,
        outputTokens: generation.outputTokens,
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

  private lockedPages(): WikiPageWrite[] {
    return this.ctx.wikiStorage.listPages().flatMap(summary => {
      if (summary.state !== 'locked') return []
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

  private settings(configured: boolean, preview?: string): LlmIntegrationSettings {
    return this.ctx.settings.llmIntegration(configured, preview)
  }

  private currentSettings(): LlmIntegrationSettings {
    const credentials = this.ctx.llmCredentials.snapshot()
    return this.settings(credentials.configured, credentials.preview)
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

function parseCandidates(raw: string, documents: KnowledgeDocument[]): EntryCandidate[] {
  const parsed = parseJsonObject(raw)
  const generated = Array.isArray(parsed.candidates) ? parsed.candidates as GeneratedCandidate[] : []
  if (generated.length === 0 || generated.length > 200) throw new Error('LLM 未返回有效的词条候选')
  const validDocumentIds = new Set(documents.map(document => document.id))
  const slugs = new Set<string>()
  return generated.map(candidate => {
    const title = text(candidate.title, '候选词条标题', 1, 200)
    const pageType = generatedPageType(candidate.pageType)
    if (pageType === 'index') throw new Error('词条规划不得生成首页候选')
    const sourceDocumentIds = sourceIds(candidate.sourceDocumentIds).filter(id => validDocumentIds.has(id))
    const base = {
      title,
      slug: uniqueSlug(normalizeWikiSlug(candidate.slug, title, pageType), slugs),
      pageType,
      aliases: generatedAliases(candidate.aliases),
      purpose: typeof candidate.purpose === 'string' ? candidate.purpose.trim().slice(0, 500) : '',
      questions: generatedQuestions(candidate.questions),
      folderPath: generatedFolderPath(candidate.folderPath) ?? [],
      sourceDocumentIds,
      factCount: boundedInteger(candidate.factCount, 0, 100),
      referencePotential: boundedInteger(candidate.referencePotential, 0, 2),
      stableIdentity: candidate.stableIdentity === true,
      transient: candidate.transient === true,
      estimatedCharacters: boundedInteger(candidate.estimatedCharacters, 0, 200_000),
      reasons: Array.isArray(candidate.reasons)
        ? candidate.reasons.flatMap(reason => typeof reason === 'string' && reason.trim() !== '' ? [reason.trim().slice(0, 100)] : []).slice(0, 10)
        : [],
      score: 0,
    }
    return { ...base, score: candidateScore(base) }
  })
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function candidateScore(candidate: Omit<EntryCandidate, 'score'>): number {
  let score = candidate.sourceDocumentIds.length >= 2 ? 3 : -2
  if (candidate.factCount >= 3) score += 2
  score += candidate.referencePotential
  if (candidate.stableIdentity) score += 1
  if (candidate.transient) score -= 3
  if (candidate.estimatedCharacters < 200) score -= 2
  return score
}

function candidateAccepted(candidate: EntryCandidate): boolean {
  if (candidate.sourceDocumentIds.length === 0 || candidate.purpose.length < 8 || candidate.questions.length === 0) return false
  switch (candidate.pageType) {
    case 'entity':
      return candidate.stableIdentity && !candidate.transient
        && candidate.factCount >= 2 && candidate.estimatedCharacters >= 150
    case 'concept':
    case 'glossary':
      return candidate.stableIdentity && !candidate.transient
        && candidate.referencePotential >= 1 && candidate.factCount >= 2
    case 'project':
      return candidate.stableIdentity && candidate.factCount >= 3
        && candidate.estimatedCharacters >= 200
    case 'policy':
      return !candidate.transient && candidate.factCount >= 3
        && candidate.estimatedCharacters >= 200
    case 'procedure':
      return !candidate.transient && candidate.factCount >= 3
        && candidate.referencePotential >= 1 && candidate.estimatedCharacters >= 200
    case 'decision':
      return candidate.factCount >= 2 && candidate.estimatedCharacters >= 120
    case 'topic':
    case 'synthesis':
    case 'comparison':
      return candidate.sourceDocumentIds.length >= 2 && candidate.factCount >= 3
        && candidate.estimatedCharacters >= 250
    case 'summary':
    case 'index':
      return false
  }
}

function mergeCandidates(input: EntryCandidate[]): EntryCandidate[] {
  const result: EntryCandidate[] = []
  for (const candidate of input) {
    const match = result.find(item => compatiblePageTypes(item.pageType, candidate.pageType)
      && identitiesOverlap(item.title, item.aliases, candidate.title, candidate.aliases))
    if (match === undefined) {
      result.push(candidate)
      continue
    }
    const aliases = new Set([...match.aliases, candidate.title, ...candidate.aliases])
    aliases.delete(match.title)
    match.aliases = [...aliases].slice(0, 20)
    if (candidate.purpose.length > match.purpose.length) match.purpose = candidate.purpose
    match.questions = [...new Set([...match.questions, ...candidate.questions])].slice(0, 5)
    match.sourceDocumentIds = [...new Set([...match.sourceDocumentIds, ...candidate.sourceDocumentIds])]
    match.factCount = Math.max(match.factCount, candidate.factCount)
    match.referencePotential = Math.max(match.referencePotential, candidate.referencePotential)
    match.stableIdentity ||= candidate.stableIdentity
    match.transient &&= candidate.transient
    match.estimatedCharacters = Math.max(match.estimatedCharacters, candidate.estimatedCharacters)
    match.reasons = [...new Set([...match.reasons, ...candidate.reasons])].slice(0, 10)
    match.score = candidateScore(match)
  }
  return result
}

function restrictToCandidates(pages: PlannedPage[], candidates: EntryCandidate[]): PlannedPage[] {
  return pages.flatMap(page => {
    const candidate = candidates.find(item => item.slug === page.slug
      || (compatiblePageTypes(item.pageType, page.pageType ?? 'concept')
        && identitiesOverlap(item.title, item.aliases, page.title, page.aliases ?? [])))
    if (candidate === undefined) return []
    return [{
      ...page,
      slug: candidate.slug,
      title: candidate.title,
      pageType: candidate.pageType,
      aliases: candidate.aliases,
      purpose: candidate.purpose,
      questions: candidate.questions,
      ...(candidate.folderPath.length === 0 ? {} : { folderPath: candidate.folderPath }),
    }]
  })
}

function consolidatePages(pages: PlannedPage[], existing: WikiPageSummary[]): PlannedPage[] {
  const resolved = pages.map(page => {
    const match = existing.find(candidate => compatiblePageTypes(candidate.pageType, page.pageType ?? 'concept')
      && identitiesOverlap(page.title, page.aliases ?? [], candidate.title, candidate.aliases))
    return match === undefined ? page : { ...page, slug: match.slug }
  })
  const groups: PlannedPage[] = []
  for (const page of resolved) {
    if (page.pageType === 'index') {
      if (!groups.some(item => item.pageType === 'index')) groups.push(page)
      continue
    }
    const target = groups.find(candidate => compatiblePageTypes(candidate.pageType ?? 'concept', page.pageType ?? 'concept')
      && (candidate.slug === page.slug
        || identitiesOverlap(page.title, page.aliases ?? [], candidate.title, candidate.aliases ?? [])))
    if (target === undefined) {
      groups.push(page)
      continue
    }
    const aliases = new Set([...(target.aliases ?? []), page.title, ...(page.aliases ?? [])])
    aliases.delete(target.title)
    target.aliases = [...aliases].slice(0, 20)
    if (page.summary !== undefined && page.summary.length > (target.summary?.length ?? 0)) target.summary = page.summary
    target.sections = mergeSections(target.sections, page.sections)
  }
  return groups.map((page, order) => ({ ...page, order }))
}

function identitiesOverlap(
  leftTitle: string,
  leftAliases: string[],
  rightTitle: string,
  rightAliases: string[],
): boolean {
  const left = new Set([leftTitle, ...leftAliases].map(normalizeIdentity).filter(Boolean))
  return [rightTitle, ...rightAliases].map(normalizeIdentity)
    .some(value => value.length >= 2 && left.has(value))
}

function compatiblePageTypes(left: WikiPageType, right: WikiPageType): boolean {
  if (left === right) return true
  return (left === 'concept' || left === 'glossary') && (right === 'concept' || right === 'glossary')
    || (left === 'topic' || left === 'synthesis') && (right === 'topic' || right === 'synthesis')
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function mergeSections(
  current: PlannedPage['sections'],
  incoming: PlannedPage['sections'],
): PlannedPage['sections'] {
  const result = current.map(section => ({ ...section, sources: [...section.sources] }))
  for (const section of incoming) {
    const match = result.find(item => normalizeIdentity(item.title) === normalizeIdentity(section.title))
    if (match === undefined) {
      result.push({ ...section, order: result.length })
      continue
    }
    if (!match.body.includes(section.body)) match.body = `${match.body}\n\n${section.body}`
    const sources = new Map(match.sources.map(source => [source.documentId, source]))
    for (const source of section.sources) sources.set(source.documentId, source)
    match.sources = [...sources.values()]
  }
  return result.map((section, order) => ({ ...section, order }))
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

function organizePages(input: PlannedPage[], documents: KnowledgeDocument[]): {
  pages: WikiPageWrite[]
  folders: WikiFolderWrite[]
} {
  const planned = [...input]
  if (!planned.some(page => page.pageType === 'index')) {
    const sources = documents.map(wikiSource)
    planned.unshift({
      id: randomUUID(),
      slug: 'index',
      title: 'Wiki 首页',
      summary: `汇总 ${documents.length} 篇源文档形成的主题知识导航。`,
      pageType: 'index',
      status: 'published',
      aliases: [],
      purpose: '提供整个 Wiki 的主题导航和知识入口。',
      questions: ['当前 Wiki 包含哪些核心知识？', '我应该从哪个词条开始浏览？'],
      order: -1,
      state: 'ready',
      sections: [{
        id: randomUUID(),
        title: '主题导航',
        body: input.map(page => `- [[${page.slug}|${page.title}]]${page.summary === undefined || page.summary === '' ? '' : `：${page.summary}`}`).join('\n'),
        order: 0,
        state: 'ready',
        sources,
      }],
    })
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

function truncateForModel(content: string, maxTokens: number): string {
  const maxCharacters = Math.max(4_000, maxTokens * 4)
  if (content.length <= maxCharacters) return content
  return `${content.slice(0, maxCharacters)}\n\n[内容已截断]`
}

function text(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new RangeError(`${label}必须是文本`)
  const normalized = value.trim()
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new RangeError(`${label}长度应为 ${minimum} 到 ${maximum} 个字符`)
  }
  return normalized
}

function validateMode(mode: WikiGenerationMode): void {
  if (mode !== 'initial' && mode !== 'incremental' && mode !== 'rebuild') {
    throw new RangeError('Wiki 生成模式无效')
  }
}

function generatedPageType(value: unknown): WikiPageType {
  return value === 'entity' || value === 'concept' || value === 'glossary'
    || value === 'project' || value === 'policy' || value === 'procedure'
    || value === 'decision' || value === 'topic' || value === 'index'
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
    || value === 'decision' || value === 'topic' || value === 'index'
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

function friendlyPhase(phase: string): string {
  if (phase === 'planning') return '规划并筛选 Wiki 词条'
  if (phase === 'planning:compact-retry') return '紧凑重试词条规划'
  if (phase === 'synthesizing') return '生成 Wiki 页面'
  if (phase === 'synthesizing:compact-retry') return '紧凑重试 Wiki 页面'
  if (phase.startsWith('summarizing:')) return `摘要文档 ${phase.slice('summarizing:'.length)}`
  if (phase === 'scanning') return '扫描知识库'
  return phase
}

export default LlmWiki
