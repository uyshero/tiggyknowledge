import type { Context } from '@deepseek-ai/cordis'
import { ChevronRight, FileEdit, FolderClosed, History, Library, RefreshCw, RotateCcw, Settings, Square, Undo2, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type {
  StartWikiGenerationInput,
  UpdateWikiPageInput,
  WikiEstimate,
  WikiFolder,
  WikiGeneration,
  WikiGenerationMode,
  WikiPage,
  WikiPageRevision,
  WikiPageSummary,
  WikiPageStatus,
  WikiSource,
  WikiStatus,
} from '@tiggyknowledge/contracts'
import './styles.css'

export const inject = ['clientApp', 'connection']

const ACTIVE_GENERATION_STATES = new Set(['pending', 'running'])

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function safeHref(value: string): string | undefined {
  const href = value.trim()
  if (href.startsWith('#') || href.startsWith('/') || href.startsWith('tk://local/')) return href
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? href : undefined
  } catch {
    return undefined
  }
}

function inlineMarkdown(text: string, keyPrefix: string, onWikiLink?: (slug: string) => void): ReactNode[] {
  const result: ReactNode[] = []
  const pattern = /(\[\[[^|\]\n]+(?:\|[^\]\n]+)?\]\]|`[^`\n]+`|\[[^\]\n]+\]\([^\s)\n]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) result.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('[[')) {
      const parts = /^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/.exec(token)
      const slug = parts?.[1]?.trim()
      const label = parts?.[2]?.trim() ?? slug
      result.push(slug === undefined || label === undefined
        ? <span key={key}>{token}</span>
        : <button className="wiki-link" key={key} type="button" onClick={() => onWikiLink?.(slug)}>{label}</button>)
    } else if (token.startsWith('`')) {
      result.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const label = parts?.[1]
      const target = parts?.[2]
      const href = target === undefined ? undefined : safeHref(target)
      result.push(href === undefined || label === undefined
        ? <span key={key}>{label ?? token}</span>
        : <a href={href} key={key} rel="noreferrer">{label}</a>)
    } else if (token.startsWith('**')) {
      result.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else {
      result.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) result.push(text.slice(cursor))
  return result
}

function Markdown({ content, onWikiLink }: { content: string, onWikiLink?: (slug: string) => void }): JSX.Element {
  const blocks: ReactNode[] = []
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += index < lines.length ? 1 : 0
      blocks.push(<pre key={`code-${index}`}><code data-language={language || undefined}>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = (heading[1] ?? '').length
      const children = inlineMarkdown(heading[2] ?? '', `heading-${index}`, onWikiLink)
      if (level === 1) blocks.push(<h1 key={`heading-${index}`}>{children}</h1>)
      else if (level === 2) blocks.push(<h2 key={`heading-${index}`}>{children}</h2>)
      else if (level === 3) blocks.push(<h3 key={`heading-${index}`}>{children}</h3>)
      else if (level === 4) blocks.push(<h4 key={`heading-${index}`}>{children}</h4>)
      else if (level === 5) blocks.push(<h5 key={`heading-${index}`}>{children}</h5>)
      else blocks.push(<h6 key={`heading-${index}`}>{children}</h6>)
      index += 1
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        items.push(<li key={`item-${index}`}>{inlineMarkdown((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''), `item-${index}`, onWikiLink)}</li>)
        index += 1
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push(<li key={`item-${index}`}>{inlineMarkdown((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''), `item-${index}`, onWikiLink)}</li>)
        index += 1
      }
      blocks.push(<ol key={`list-${index}`}>{items}</ol>)
      continue
    }
    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('> ')) {
        quote.push((lines[index] ?? '').slice(2))
        index += 1
      }
      blocks.push(<blockquote key={`quote-${index}`}>{inlineMarkdown(quote.join(' '), `quote-${index}`, onWikiLink)}</blockquote>)
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !/^(#{1,6})\s|^```|^> |^\s*[-*+]\s+|^\s*\d+\.\s+/.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(' '), `paragraph-${index}`, onWikiLink)}</p>)
  }
  return <div className="wiki-markdown">{blocks}</div>
}

function sourceList(page: WikiPage | undefined): WikiSource[] {
  const seen = new Set<string>()
  const sources: WikiSource[] = []
  for (const section of page?.sections ?? []) {
    for (const source of section.sources) {
      if (seen.has(source.documentId)) continue
      seen.add(source.documentId)
      sources.push(source)
    }
  }
  return sources
}

function generationPhaseLabel(phase: string): string {
  if (phase === 'scanning') return '正在扫描知识库'
  if (phase.startsWith('summarizing:')) return '正在提取文档事实'
  if (phase === 'planning') return '正在规划、评分并归并候选词条'
  if (phase === 'planning:compact-retry') return '候选输出过长，正在紧凑重试'
  if (phase === 'synthesizing') return '正在为通过筛选的词条生成正文'
  if (phase === 'synthesizing:compact-retry') return '输出过长，正在紧凑重试'
  if (phase === 'completed') return 'Wiki 生成完成'
  return phase || '正在准备知识文档'
}

function pageTypeLabel(type: WikiPageSummary['pageType']): string {
  const labels: Record<WikiPageSummary['pageType'], string> = {
    summary: '摘要',
    entity: '实体',
    concept: '概念',
    glossary: '术语',
    project: '项目',
    policy: '制度',
    procedure: '流程',
    decision: '决策',
    topic: '专题',
    index: '导航',
    synthesis: '综合',
    comparison: '比较',
  }
  return labels[type]
}

type WikiTreeNode =
  | { kind: 'folder', folder: WikiFolder, depth: number }
  | { kind: 'page', page: WikiPageSummary, depth: number }

function wikiTree(folders: WikiFolder[], pages: WikiPageSummary[]): WikiTreeNode[] {
  const result: WikiTreeNode[] = []
  const visit = (parentId: string | undefined, depth: number): void => {
    for (const folder of folders.filter(item => item.parentId === parentId).sort((a, b) => a.order - b.order)) {
      result.push({ kind: 'folder', folder, depth })
      for (const page of pages.filter(item => item.folderId === folder.id).sort((a, b) => a.order - b.order)) {
        result.push({ kind: 'page', page, depth: depth + 1 })
      }
      visit(folder.id, depth + 1)
    }
  }
  for (const page of pages.filter(item => item.folderId === undefined).sort((a, b) => a.order - b.order)) {
    result.push({ kind: 'page', page, depth: 0 })
  }
  visit(undefined, 0)
  return result
}

export function apply(ctx: Context): void {
  function WikiPageView(): JSX.Element {
    const [status, setStatus] = useState<WikiStatus>()
    const [pages, setPages] = useState<WikiPageSummary[]>([])
    const [folders, setFolders] = useState<WikiFolder[]>([])
    const [selectedPageId, setSelectedPageId] = useState<string>()
    const [page, setPage] = useState<WikiPage>()
    const [generation, setGeneration] = useState<WikiGeneration>()
    const [loading, setLoading] = useState(true)
    const [pageLoading, setPageLoading] = useState(false)
    const [error, setError] = useState<string>()
    const [confirmation, setConfirmation] = useState<{ estimate: WikiEstimate, mode: WikiGenerationMode }>()
    const [estimating, setEstimating] = useState<WikiGenerationMode>()
    const [starting, setStarting] = useState(false)
    const [cancelling, setCancelling] = useState(false)
    const [confirmingPlan, setConfirmingPlan] = useState(false)
    const [selectedCandidateSlugs, setSelectedCandidateSlugs] = useState<string[]>([])
    const [selectedArchiveSlugs, setSelectedArchiveSlugs] = useState<string[]>([])
    const [editing, setEditing] = useState(false)
    const [editTitle, setEditTitle] = useState('')
    const [editSummary, setEditSummary] = useState('')
    const [editStatus, setEditStatus] = useState<WikiPageStatus>('published')
    const [editAliases, setEditAliases] = useState('')
    const [editPurpose, setEditPurpose] = useState('')
    const [editQuestions, setEditQuestions] = useState('')
    const [editSections, setEditSections] = useState<UpdateWikiPageInput['sections']>([])
    const [saving, setSaving] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [revisions, setRevisions] = useState<WikiPageRevision[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [revertingVersion, setRevertingVersion] = useState<number>()

    const loadWorkspace = useCallback(async (signal?: AbortSignal): Promise<void> => {
      const nextStatus = await ctx.connection.wikiStatus(signal)
      setStatus(nextStatus)
      if (nextStatus.state === 'generating' && nextStatus.activeGenerationId !== undefined) {
        const active = await ctx.connection.wikiGeneration(nextStatus.activeGenerationId, signal)
        setGeneration(active)
      } else {
        setGeneration(nextStatus.lastGeneration)
      }
      if (nextStatus.pageCount > 0) {
        const [nextPages, nextFolders] = await Promise.all([
          ctx.connection.wikiPages(signal),
          ctx.connection.wikiFolders(signal),
        ])
        setPages(nextPages)
        setFolders(nextFolders)
        setSelectedPageId(current => current !== undefined && nextPages.some(item => item.id === current) ? current : nextPages[0]?.id)
      } else {
        setPages([])
        setFolders([])
        setSelectedPageId(undefined)
        setPage(undefined)
      }
    }, [])

    useEffect(() => {
      const controller = new AbortController()
      setLoading(true)
      void loadWorkspace(controller.signal)
        .then(() => setError(undefined))
        .catch(reason => {
          if (!controller.signal.aborted) setError(errorMessage(reason, '无法读取 Wiki 状态'))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
      return () => controller.abort()
    }, [loadWorkspace])

    useEffect(() => {
      const refresh = (): void => {
        if (document.visibilityState !== 'visible') return
        void loadWorkspace().catch(reason => setError(errorMessage(reason, '无法刷新 Wiki 状态')))
      }
      const handleVisibility = (): void => {
        if (document.visibilityState === 'visible') refresh()
      }
      window.addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', handleVisibility)
      return () => {
        window.removeEventListener('focus', refresh)
        document.removeEventListener('visibilitychange', handleVisibility)
      }
    }, [loadWorkspace])

    useEffect(() => {
      if (selectedPageId === undefined) return
      const controller = new AbortController()
      setPageLoading(true)
      setEditing(false)
      setHistoryOpen(false)
      void ctx.connection.wikiPage(selectedPageId, controller.signal)
        .then(value => {
          setPage(value)
          setError(undefined)
        })
        .catch(reason => {
          if (!controller.signal.aborted) setError(errorMessage(reason, '无法读取 Wiki 页面'))
        })
        .finally(() => {
          if (!controller.signal.aborted) setPageLoading(false)
        })
      return () => controller.abort()
    }, [selectedPageId])

    useEffect(() => {
      if (generation === undefined || !ACTIVE_GENERATION_STATES.has(generation.state)) return
      const controller = new AbortController()
      const timer = window.setTimeout(() => {
        void ctx.connection.wikiGeneration(generation.id, controller.signal)
          .then(next => {
            setGeneration(next)
            if (!ACTIVE_GENERATION_STATES.has(next.state)) void loadWorkspace()
          })
          .catch(reason => {
            if (!controller.signal.aborted) setError(errorMessage(reason, '无法读取生成进度'))
          })
      }, 1500)
      return () => {
        controller.abort()
        window.clearTimeout(timer)
      }
    }, [generation, loadWorkspace])

    useEffect(() => {
      if (generation?.state !== 'planned' || generation.plan === undefined) return
      setSelectedCandidateSlugs(generation.plan.candidates.map(candidate => candidate.slug))
      setSelectedArchiveSlugs([])
    }, [generation?.id, generation?.state])

    const requestGeneration = async (mode: WikiGenerationMode): Promise<void> => {
      if (estimating !== undefined) return
      setEstimating(mode)
      setError(undefined)
      try {
        const estimate = await ctx.connection.wikiEstimate(mode)
        setConfirmation({ estimate, mode })
      } catch (reason) {
        setError(errorMessage(reason, '无法估算 Wiki 生成任务'))
      } finally {
        setEstimating(undefined)
      }
    }

    const startGeneration = async (): Promise<void> => {
      if (confirmation === undefined || starting) return
      setStarting(true)
      setError(undefined)
      try {
        const input: StartWikiGenerationInput = { mode: confirmation.mode }
        const next = await ctx.connection.startWikiGeneration(input)
        setGeneration(next)
        setStatus(current => current === undefined ? current : { ...current, state: 'generating', activeGenerationId: next.id })
        setConfirmation(undefined)
      } catch (reason) {
        setError(errorMessage(reason, '无法启动 Wiki 生成'))
      } finally {
        setStarting(false)
      }
    }

    const cancelGeneration = async (): Promise<void> => {
      if (cancelling) return
      setCancelling(true)
      try {
        if (generation === undefined) return
        setGeneration(await ctx.connection.cancelWikiGeneration(generation.id))
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法取消 Wiki 生成'))
      } finally {
        setCancelling(false)
      }
    }

    const confirmPlan = async (): Promise<void> => {
      if (generation?.state !== 'planned' || confirmingPlan) return
      setConfirmingPlan(true)
      setError(undefined)
      try {
        setGeneration(await ctx.connection.confirmWikiGeneration(generation.id, {
          candidateSlugs: selectedCandidateSlugs,
          archiveSlugs: selectedArchiveSlugs,
        }))
      } catch (reason) {
        setError(errorMessage(reason, '无法确认 Wiki 生成计划'))
      } finally {
        setConfirmingPlan(false)
      }
    }

    const beginEdit = (): void => {
      if (page === undefined) return
      setEditTitle(page.title)
      setEditSummary(page.summary)
      setEditStatus(page.status)
      setEditAliases(page.aliases.join('、'))
      setEditPurpose(page.purpose)
      setEditQuestions(page.questions.join('\n'))
      setEditSections(page.sections.map(section => ({ id: section.id, title: section.title, body: section.body })))
      setEditing(true)
    }

    const savePage = async (): Promise<void> => {
      if (page === undefined || saving || editTitle.trim() === '') return
      setSaving(true)
      try {
        const updated = await ctx.connection.updateWikiPage(page.id, {
          title: editTitle.trim(),
          summary: editSummary.trim(),
          pageType: page.pageType,
          status: editStatus,
          aliases: editAliases.split(/[、,\n]/).map(item => item.trim()).filter(Boolean),
          purpose: editPurpose.trim(),
          questions: editQuestions.split('\n').map(item => item.trim()).filter(Boolean),
          expectedVersion: page.version,
          sections: editSections,
        })
        setPage(updated)
        setPages(items => updated.status === 'archived'
          ? items.filter(item => item.id !== updated.id)
          : items.map(item => item.id === updated.id ? updated : item))
        setEditing(false)
        if (updated.status === 'archived') await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法保存 Wiki 页面'))
      } finally {
        setSaving(false)
      }
    }

    const openHistory = async (): Promise<void> => {
      if (page === undefined || historyLoading) return
      setHistoryOpen(true)
      setHistoryLoading(true)
      try {
        setRevisions(await ctx.connection.wikiPageRevisions(page.id))
      } catch (reason) {
        setError(errorMessage(reason, '无法读取 Wiki 版本历史'))
      } finally {
        setHistoryLoading(false)
      }
    }

    const revertTo = async (version: number): Promise<void> => {
      if (page === undefined || revertingVersion !== undefined) return
      setRevertingVersion(version)
      try {
        const updated = await ctx.connection.revertWikiPage(page.id, {
          version,
          expectedVersion: page.version,
        })
        setPage(updated)
        setPages(items => items.map(item => item.id === updated.id ? updated : item))
        setRevisions(await ctx.connection.wikiPageRevisions(page.id))
      } catch (reason) {
        setError(errorMessage(reason, '无法回滚 Wiki 页面'))
      } finally {
        setRevertingVersion(undefined)
      }
    }

    const sources = useMemo(() => sourceList(page), [page])
    const tree = useMemo(() => wikiTree(folders, pages), [folders, pages])
    const relatedPages = useMemo(() => {
      const slugs = new Set([...(page?.outLinks ?? []), ...(page?.inLinks ?? [])])
      return pages.filter(item => slugs.has(item.slug))
    }, [page, pages])
    const openWikiSlug = useCallback((slug: string): void => {
      const target = pages.find(item => item.slug === slug)
      if (target === undefined) {
        setError(`词条链接不存在或已归档：${slug}`)
        return
      }
      setSelectedPageId(target.id)
    }, [pages])
    const progress = generation === undefined || generation.totalSteps <= 0
      ? 0
      : Math.min(100, Math.round(generation.completedSteps / generation.totalSteps * 100))
    const generated = (status?.pageCount ?? 0) > 0
    const generating = generation !== undefined && ACTIVE_GENERATION_STATES.has(generation.state)
    const planningReady = generation?.state === 'planned' && generation.plan !== undefined

    return (
      <div className="page wiki-page">
        <header className="page-header">
          <div><p className="eyebrow">AI 知识整理</p><h1>Wiki</h1></div>
          {generated && (
            <div className="header-actions">
              <button className="secondary-button" type="button" disabled={generating || planningReady || estimating !== undefined} onClick={() => void requestGeneration('incremental')}><RefreshCw size={16} />{estimating === 'incremental' ? '估算中...' : '更新 Wiki'}</button>
              <button className="secondary-button" type="button" disabled={generating || planningReady || estimating !== undefined} onClick={() => void requestGeneration('rebuild')}><RotateCcw size={16} />{estimating === 'rebuild' ? '估算中...' : '完整重建'}</button>
            </div>
          )}
        </header>

        {status !== undefined && (
          <section className="wiki-summary" aria-label="Wiki 摘要">
            <div><span>知识文档</span><strong>{status.changes.totalDocuments}</strong></div>
            <div><span>Wiki 页面</span><strong>{status.pageCount}</strong></div>
            <div><span>待处理变更</span><strong>{status.changes.added + status.changes.updated + status.changes.deleted}</strong></div>
            <div><span>最近生成</span><strong>{status.lastGeneratedAt === undefined ? '尚未生成' : new Date(status.lastGeneratedAt).toLocaleDateString()}</strong></div>
          </section>
        )}

        {error !== undefined && <div className="wiki-error" role="alert">{error}</div>}
        {loading ? (
          <div className="wiki-state">正在读取 Wiki...</div>
        ) : status !== undefined && !status.llmConfigured ? (
          <section className="wiki-empty">
            <div className="wiki-empty-icon"><Settings size={23} /></div>
            <h2>先配置 AI 模型</h2>
            <p>生成 Wiki 需要可用的模型地址、模型名称和 API Key。配置完成后返回此处开始生成。</p>
            <button className="primary-button" type="button" onClick={() => ctx.clientApp.selectPage('settings', { panelId: 'llm' })}><Settings size={16} />前往 AI 模型设置</button>
          </section>
        ) : !generated && !generating && !planningReady ? (
          <section className="wiki-empty">
            <div className="wiki-empty-icon"><Library size={23} /></div>
            <h2>还没有生成 Wiki</h2>
            <p>AI 将分析 {status?.changes.totalDocuments ?? 0} 篇知识文档，整理为带来源引用的结构化 Wiki。</p>
            <button className="primary-button" type="button" disabled={estimating !== undefined} onClick={() => void requestGeneration('initial')}><Library size={16} />{estimating === 'initial' ? '正在估算...' : '生成 Wiki'}</button>
          </section>
        ) : generating ? (
          <section className="wiki-generation" aria-live="polite">
            <RefreshCw className="wiki-spin" size={24} />
            <h2>正在生成 Wiki</h2>
            <p>{generationPhaseLabel(generation.phase)}</p>
            <div className="wiki-progress" aria-label={`生成进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
            <div className="wiki-progress-meta"><span>{generation.completedSteps} / {generation.totalSteps} 步</span><span>{progress}%</span></div>
            {generation.candidateCount !== undefined && <div className="wiki-progress-meta"><span>候选 {generation.candidateCount} 个</span><span>通过 {generation.acceptedCandidateCount ?? 0} 个</span></div>}
            <button className="secondary-button" type="button" disabled={cancelling} onClick={() => void cancelGeneration()}><Square size={14} />{cancelling ? '正在取消...' : '取消生成'}</button>
          </section>
        ) : generation?.state === 'planned' && generation.plan !== undefined ? (
          <section className="wiki-plan">
            <header>
              <div><p className="eyebrow">写入前预览</p><h2>确认 Wiki 生成计划</h2></div>
              <span>现有 Wiki 尚未修改</span>
            </header>
            <div className="wiki-plan-summary">
              <div><strong>{generation.plan.candidates.length}</strong><span>通过准入的候选</span></div>
              <div><strong>{generation.plan.preservedPageCount}</strong><span>原样保留词条</span></div>
              <div><strong>{generation.plan.archivePages.length}</strong><span>建议归档</span></div>
            </div>
            <div className="wiki-plan-list">
              {generation.plan.candidates.map(candidate => {
                const selected = selectedCandidateSlugs.includes(candidate.slug)
                return (
                  <label className={`wiki-plan-item ${selected ? 'selected' : ''}`} key={candidate.slug}>
                    <input type="checkbox" checked={selected} onChange={() => setSelectedCandidateSlugs(items => selected ? items.filter(slug => slug !== candidate.slug) : [...items, candidate.slug])} />
                    <div>
                      <div className="wiki-plan-title"><strong>{candidate.title}</strong><span>{candidate.action === 'create' ? '新增' : candidate.action === 'restore' ? '恢复' : '更新'} · {pageTypeLabel(candidate.pageType)} · {candidate.score} 分</span></div>
                      <p>{candidate.purpose}</p>
                      {candidate.reasons.length > 0 && <small>{candidate.reasons.join('；')}</small>}
                      <small>来源：{candidate.sourceTitles.join('、') || '未知来源'}</small>
                    </div>
                  </label>
                )
              })}
            </div>
            {generation.plan.archivePages.length > 0 && (
              <div className="wiki-plan-archive">
                <h3>建议归档（默认不执行）</h3>
                <p>仅勾选你确认不再需要的词条。</p>
                {generation.plan.archivePages.map(candidate => {
                  const selected = selectedArchiveSlugs.includes(candidate.slug)
                  return <label key={candidate.slug}><input type="checkbox" checked={selected} onChange={() => setSelectedArchiveSlugs(items => selected ? items.filter(slug => slug !== candidate.slug) : [...items, candidate.slug])} /><span>{candidate.title}</span></label>
                })}
              </div>
            )}
            <footer>
              <button className="secondary-button" type="button" disabled={cancelling || confirmingPlan} onClick={() => void cancelGeneration()}>{cancelling ? '取消中...' : '放弃本次计划'}</button>
              <button className="primary-button" type="button" disabled={confirmingPlan} onClick={() => void confirmPlan()}>{confirmingPlan ? '正在启动...' : `确认生成 ${selectedCandidateSlugs.length} 个词条`}</button>
            </footer>
          </section>
        ) : generation?.state === 'failed' && !generated ? (
          <section className="wiki-empty"><h2>生成失败</h2><p>{generation.error ?? '生成任务未能完成，请重试。'}</p><button className="primary-button" type="button" onClick={() => void requestGeneration('initial')}>重新生成</button></section>
        ) : (
          <main className="wiki-workbench">
            <nav className="wiki-tree" aria-label="Wiki 目录">
              <div className="wiki-pane-title">目录</div>
              {tree.map(node => node.kind === 'folder' ? (
                <div className="wiki-folder" key={node.folder.id} style={{ paddingLeft: `${9 + node.depth * 16}px` }}>
                  <FolderClosed size={13} /><span>{node.folder.name}</span>
                </div>
              ) : (
                <button className={node.page.id === selectedPageId ? 'active' : ''} key={node.page.id} style={{ paddingLeft: `${12 + node.depth * 16}px` }} type="button" onClick={() => setSelectedPageId(node.page.id)}>
                  <ChevronRight size={13} /><span>{node.page.title}</span>{node.page.state !== 'ready' && <i />}
                </button>
              ))}
            </nav>
            <article className="wiki-content">
              {pageLoading || page === undefined ? <div className="wiki-state">正在读取页面...</div> : editing ? (
                <div className="wiki-editor">
                  <label><span>页面标题</span><input value={editTitle} onChange={event => setEditTitle(event.target.value)} /></label>
                  <label><span>页面摘要</span><textarea rows={3} value={editSummary} onChange={event => setEditSummary(event.target.value)} /></label>
                  <label><span>词条用途</span><textarea rows={2} value={editPurpose} onChange={event => setEditPurpose(event.target.value)} /></label>
                  <label><span>这个词条应该回答的问题（每行一个）</span><textarea rows={4} value={editQuestions} onChange={event => setEditQuestions(event.target.value)} /></label>
                  <div className="wiki-editor-grid">
                    <label><span>发布状态</span><select value={editStatus} onChange={event => setEditStatus(event.target.value as WikiPageStatus)}><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></label>
                    <label><span>别名（逗号分隔）</span><input value={editAliases} onChange={event => setEditAliases(event.target.value)} /></label>
                  </div>
                  {editSections.map((section, sectionIndex) => (
                    <Fragment key={section.id}>
                      <label><span>章节标题</span><input value={section.title} onChange={event => setEditSections(items => items.map((item, index) => index === sectionIndex ? { ...item, title: event.target.value } : item))} /></label>
                      <label><span>Markdown 内容</span><textarea rows={12} value={section.body} onChange={event => setEditSections(items => items.map((item, index) => index === sectionIndex ? { ...item, body: event.target.value } : item))} /></label>
                    </Fragment>
                  ))}
                  <div className="wiki-editor-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button><button className="primary-button" type="button" disabled={saving || editTitle.trim() === ''} onClick={() => void savePage()}>{saving ? '保存中...' : '保存页面'}</button></div>
                </div>
              ) : (
                <>
                  <header>
                    <div>
                      <h1>{page.title}</h1>
                      <span>{pageTypeLabel(page.pageType)} · {page.status} · v{page.version} · 更新于 {new Date(page.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="wiki-page-actions">
                      <button className="secondary-button" type="button" onClick={() => void openHistory()}><History size={15} />版本</button>
                      <button className="secondary-button" type="button" onClick={beginEdit}><FileEdit size={15} />编辑</button>
                    </div>
                  </header>
                  {page.state === 'source-missing' && <div className="wiki-source-warning">部分来源文档已删除。请更新 Wiki，系统会撤回失效来源贡献。</div>}
                  {page.summary !== '' && <p className="wiki-page-summary">{page.summary}</p>}
                  {page.purpose !== '' && <div className="wiki-purpose"><strong>词条用途</strong><p>{page.purpose}</p></div>}
                  {page.questions.length > 0 && <div className="wiki-questions"><strong>它应该回答</strong><ul>{page.questions.map(question => <li key={question}>{question}</li>)}</ul></div>}
                  {page.sections.map(section => <section key={section.id}><h2>{section.title}</h2><Markdown content={section.body} onWikiLink={openWikiSlug} /></section>)}
                </>
              )}
            </article>
            <aside className="wiki-sources">
              <div className="wiki-pane-title">来源 · {sources.length}</div>
              {sources.length === 0 ? <p className="wiki-no-sources">当前页面没有来源记录。</p> : sources.map(source => (
                <a href={source.referenceUri} key={source.documentId} onClick={event => {
                  event.preventDefault()
                  ctx.clientApp.selectPage('documents', { libraryId: source.libraryId, documentId: source.documentId })
                }}>
                  <strong>{source.title}</strong><span>{source.referenceUri}</span>
                </a>
              ))}
              <div className="wiki-pane-title">关联词条 · {relatedPages.length}</div>
              {relatedPages.length === 0 ? <p className="wiki-no-sources">当前页面没有关联词条。</p> : relatedPages.map(related => (
                <button className="wiki-related-link" key={related.id} type="button" onClick={() => setSelectedPageId(related.id)}>
                  <strong>{related.title}</strong><span>{related.slug}</span>
                </button>
              ))}
            </aside>
          </main>
        )}

        {confirmation !== undefined && (
          <div className="wiki-dialog-backdrop">
            <section className="wiki-dialog" role="dialog" aria-modal="true" aria-labelledby="wiki-confirm-title">
              <header><div><p className="eyebrow">生成确认</p><h2 id="wiki-confirm-title">{confirmation.mode === 'rebuild' ? '完整重建 Wiki？' : confirmation.mode === 'initial' ? '生成 Wiki？' : '更新 Wiki？'}</h2></div><button type="button" disabled={starting} title="关闭" onClick={() => setConfirmation(undefined)}><X size={18} /></button></header>
              <div className="wiki-dialog-body">
                <p>本次将处理 <strong>{confirmation.estimate.documentsToProcess}</strong> 篇文档，预计使用 <strong>{confirmation.estimate.estimatedInputTokens.toLocaleString()}</strong> 个输入 token。</p>
                <dl><div><dt>新增</dt><dd>{confirmation.estimate.changes.added}</dd></div><div><dt>更新</dt><dd>{confirmation.estimate.changes.updated}</dd></div><div><dt>删除</dt><dd>{confirmation.estimate.changes.deleted}</dd></div></dl>
                {confirmation.mode === 'rebuild' && <p className="wiki-dialog-warning">完整重建会重新生成全部 Wiki 页面，但不会修改原始知识文档。</p>}
              </div>
              <footer><button className="secondary-button" type="button" disabled={starting} onClick={() => setConfirmation(undefined)}>取消</button><button className="primary-button" type="button" disabled={starting} onClick={() => void startGeneration()}>{starting ? '正在启动...' : '确认生成'}</button></footer>
            </section>
          </div>
        )}
        {historyOpen && page !== undefined && (
          <div className="wiki-dialog-backdrop">
            <section className="wiki-dialog wiki-history-dialog" role="dialog" aria-modal="true" aria-labelledby="wiki-history-title">
              <header>
                <div><p className="eyebrow">页面治理</p><h2 id="wiki-history-title">版本历史</h2></div>
                <button type="button" title="关闭" onClick={() => setHistoryOpen(false)}><X size={18} /></button>
              </header>
              <div className="wiki-history-list">
                <div className="wiki-history-current"><strong>当前 v{page.version}</strong><span>{page.lastEditSource}</span></div>
                {historyLoading ? <p>正在读取历史...</p> : revisions.length === 0 ? <p>还没有历史版本。</p> : revisions.map(revision => (
                  <article key={revision.version}>
                    <div><strong>v{revision.version}</strong><span>{revision.editSource} · {new Date(revision.editedAt).toLocaleString()}</span></div>
                    <button className="secondary-button" type="button" disabled={revertingVersion !== undefined} onClick={() => void revertTo(revision.version)}>
                      <Undo2 size={14} />{revertingVersion === revision.version ? '回滚中...' : '回滚到此版本'}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'wiki',
    label: 'Wiki',
    icon: Library,
    component: WikiPageView,
    order: 11,
    section: 'primary',
  }), 'ui-wiki: page')
}
