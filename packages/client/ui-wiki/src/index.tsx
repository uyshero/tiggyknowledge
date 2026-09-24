import type { Context } from '@deepseek-ai/cordis'
import { ChevronRight, FileEdit, FolderClosed, FolderPlus, History, Library, Pencil, Plus, RefreshCw, Search, Settings, Sparkles, Square, Trash2, Undo2, Unlock, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type {
  UpdateWikiPageInput,
  WikiFolder,
  WikiGeneration,
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

function splitTableCells(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutEnd = inner.endsWith('|') ? inner.slice(0, -1) : inner
  return withoutEnd.split('|').map(cell => cell.trim())
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && !trimmed.startsWith('```')
}

function looksLikeTable(lines: string[], index: number): boolean {
  return isTableRow(lines[index] ?? '') && isTableSeparator(lines[index + 1] ?? '')
}

function alignmentOf(cell: string): 'left' | 'center' | 'right' | undefined {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return undefined
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
    if (looksLikeTable(lines, index)) {
      const header = splitTableCells(line)
      const alignments = splitTableCells(lines[index + 1] ?? '').map(alignmentOf)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && isTableRow(lines[index] ?? '') && !isTableSeparator(lines[index] ?? '')) {
        rows.push(splitTableCells(lines[index] ?? ''))
        index += 1
      }
      const columnCount = Math.max(header.length, ...rows.map(row => row.length), alignments.length)
      const pad = (cells: string[]): string[] => Array.from({ length: columnCount }, (_, column) => cells[column] ?? '')
      blocks.push(
        <div className="wiki-table-wrap" key={`table-${index}`}>
          <table>
            <thead>
              <tr>
                {pad(header).map((cell, column) => (
                  <th key={`th-${column}`} {...(alignments[column] === undefined ? {} : { style: { textAlign: alignments[column] } })}>
                    {inlineMarkdown(cell, `th-${index}-${column}`, onWikiLink)}
                  </th>
                ))}
              </tr>
            </thead>
            {rows.length > 0 && (
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`tr-${rowIndex}`}>
                    {pad(row).map((cell, column) => (
                      <td key={`td-${rowIndex}-${column}`} {...(alignments[column] === undefined ? {} : { style: { textAlign: alignments[column] } })}>
                        {inlineMarkdown(cell, `td-${index}-${rowIndex}-${column}`, onWikiLink)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>,
      )
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
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !/^(#{1,6})\s|^```|^> |^\s*[-*+]\s+|^\s*\d+\.\s+/.test(lines[index] ?? '') && !looksLikeTable(lines, index)) {
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
  if (phase === 'queued') return '已加入后台队列'
  if (phase.startsWith('summarizing:')) return '正在提取文章要点'
  if (phase === 'synthesizing') return '正在生成词条'
  if (phase === 'synthesizing:compact-retry') return '输出过长，正在紧凑重试'
  if (phase === 'completed') return '词条已生成'
  if (phase === 'cancelled') return '已取消'
  if (phase === 'failed') return '生成失败'
  return phase || '正在准备词条'
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
    event: '事件',
    topic: '专题',
    index: '首页',
    synthesis: '综合',
    comparison: '比较',
  }
  return labels[type]
}

function wikiPageId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('pageId' in value)) return undefined
  return typeof value.pageId === 'string' && value.pageId.length > 0 ? value.pageId : undefined
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

function catalogGroups(folders: WikiFolder[], pages: WikiPageSummary[]): Array<{ name: string, pages: WikiPageSummary[] }> {
  const topics = pages.filter(page => page.pageType !== 'index' && page.status === 'published')
  const folderById = new Map(folders.map(folder => [folder.id, folder]))
  const groups = new Map<string, WikiPageSummary[]>()
  for (const page of topics) {
    const folder = page.folderId === undefined ? undefined : folderById.get(page.folderId)
    const name = folder?.path.split('/')[0] || '未分组'
    const items = groups.get(name) ?? []
    items.push(page)
    groups.set(name, items)
  }
  return [...groups.entries()].map(([name, items]) => ({
    name,
    pages: items.sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, 'zh')),
  }))
}

export function apply(ctx: Context): void {
  function WikiPageView(): JSX.Element {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const [status, setStatus] = useState<WikiStatus>()
    const [pages, setPages] = useState<WikiPageSummary[]>([])
    const [folders, setFolders] = useState<WikiFolder[]>([])
    const [selectedPageId, setSelectedPageId] = useState<string>()
    const [page, setPage] = useState<WikiPage>()
    const [generation, setGeneration] = useState<WikiGeneration>()
    const [loading, setLoading] = useState(true)
    const [pageLoading, setPageLoading] = useState(false)
    const [error, setError] = useState<string>()
    const [busyDocumentId, setBusyDocumentId] = useState<string>()
    const [busyKind, setBusyKind] = useState<'accept' | 'skip'>()
    const [cancelling, setCancelling] = useState(false)
    const [editing, setEditing] = useState(false)
    const [editTitle, setEditTitle] = useState('')
    const [editSummary, setEditSummary] = useState('')
    const [editStatus, setEditStatus] = useState<WikiPageStatus>('published')
    const [editAliases, setEditAliases] = useState('')
    const [editPurpose, setEditPurpose] = useState('')
    const [editQuestions, setEditQuestions] = useState('')
    const [editFolderId, setEditFolderId] = useState('')
    const [editSections, setEditSections] = useState<UpdateWikiPageInput['sections']>([])
    const [saving, setSaving] = useState(false)
    const [unlocking, setUnlocking] = useState(false)
    const [publishing, setPublishing] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [revisions, setRevisions] = useState<WikiPageRevision[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [revertingVersion, setRevertingVersion] = useState<number>()
    const [treeQuery, setTreeQuery] = useState('')
    const [openQueue, setOpenQueue] = useState<'inbox' | 'reviews' | 'skipped'>()
    const [createPageOpen, setCreatePageOpen] = useState(false)
    const [createTitle, setCreateTitle] = useState('')
    const [createType, setCreateType] = useState<WikiPageSummary['pageType']>('concept')
    const [createFolderId, setCreateFolderId] = useState('')
    const [createSummary, setCreateSummary] = useState('')
    const [createPurpose, setCreatePurpose] = useState('')
    const [createQuestions, setCreateQuestions] = useState('')
    const [createSectionTitle, setCreateSectionTitle] = useState('说明')
    const [createBody, setCreateBody] = useState('')
    const [creatingPage, setCreatingPage] = useState(false)
    const [assistingPage, setAssistingPage] = useState(false)
    const [categoriesOpen, setCategoriesOpen] = useState(false)
    const [newCategoryName, setNewCategoryName] = useState('')
    const [renamingFolderId, setRenamingFolderId] = useState<string>()
    const [renameCategoryName, setRenameCategoryName] = useState('')
    const [categoryBusy, setCategoryBusy] = useState(false)

    const loadWorkspace = useCallback(async (signal?: AbortSignal): Promise<void> => {
      const nextStatus = await ctx.connection.wikiStatus(signal)
      setStatus(nextStatus)
      if (nextStatus.state === 'generating' && nextStatus.activeGenerationId !== undefined) {
        const active = await ctx.connection.wikiGeneration(nextStatus.activeGenerationId, signal)
        setGeneration(active)
      } else {
        setGeneration(nextStatus.lastGeneration)
      }
      const [nextPages, nextFolders] = await Promise.all([
        ctx.connection.wikiPages(signal),
        ctx.connection.wikiFolders(signal),
      ])
      setPages(nextPages)
      setFolders(nextFolders)
      const requested = wikiPageId(ctx.clientApp.getSnapshot().pageState)
      const drafts = nextPages
        .filter(item => item.pageType !== 'index' && item.status === 'draft')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      setSelectedPageId(current => {
        if (requested !== undefined && nextPages.some(item => item.id === requested)) return requested
        if (current !== undefined && nextPages.some(item => item.id === current)) return current
        return drafts[0]?.id ?? nextPages.find(item => item.pageType === 'index')?.id ?? nextPages[0]?.id
      })
      if (nextPages.length === 0) setPage(undefined)
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
      const requested = wikiPageId(app.pageState)
      if (requested === undefined || !pages.some(item => item.id === requested)) return
      setSelectedPageId(requested)
    }, [app.pageState, pages])

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

    const acceptDocument = async (documentId: string, force = false): Promise<void> => {
      if (busyDocumentId !== undefined) return
      setBusyDocumentId(documentId)
      setBusyKind('accept')
      setError(undefined)
      try {
        const next = await ctx.connection.startWikiGeneration({ documentId, mode: 'document', force })
        setGeneration(next)
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, force ? '无法完善这个词条' : '无法确认这篇文章'))
      } finally {
        setBusyDocumentId(undefined)
        setBusyKind(undefined)
      }
    }

    const skipDocument = async (documentId: string): Promise<void> => {
      if (busyDocumentId !== undefined) return
      setBusyDocumentId(documentId)
      setBusyKind('skip')
      setError(undefined)
      try {
        await ctx.connection.skipWikiInbox(documentId)
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法跳过这篇文章'))
      } finally {
        setBusyDocumentId(undefined)
        setBusyKind(undefined)
      }
    }

    const cancelGeneration = async (): Promise<void> => {
      if (cancelling || generation === undefined) return
      setCancelling(true)
      try {
        setGeneration(await ctx.connection.cancelWikiGeneration(generation.id))
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法取消 Wiki 生成'))
      } finally {
        setCancelling(false)
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
      setEditFolderId(page.folderId ?? '')
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
          status: page.status === 'draft' ? 'draft' : editStatus,
          folderId: editFolderId === '' ? null : editFolderId,
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

    const unlockPage = async (): Promise<void> => {
      if (page === undefined || unlocking) return
      setUnlocking(true)
      try {
        const updated = await ctx.connection.unlockWikiPage(page.id, { expectedVersion: page.version })
        setPage(updated)
        setPages(items => items.map(item => item.id === updated.id ? updated : item))
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法允许自动更新'))
      } finally {
        setUnlocking(false)
      }
    }

    const publishPage = async (): Promise<void> => {
      if (page === undefined || publishing) return
      setPublishing(true)
      setError(undefined)
      try {
        const updated = await ctx.connection.publishWikiPage(page.id, { expectedVersion: page.version })
        setPage(updated)
        setPages(items => items.map(item => item.id === updated.id ? updated : item))
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法确认收录这个词条'))
      } finally {
        setPublishing(false)
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

    const createManualPage = async (): Promise<void> => {
      if (creatingPage || createTitle.trim() === '' || createBody.trim() === '') return
      setCreatingPage(true)
      setError(undefined)
      try {
        const created = await ctx.connection.createWikiPage({
          title: createTitle.trim(),
          pageType: createType,
          ...(createFolderId === '' ? {} : { folderId: createFolderId }),
          summary: createSummary.trim(),
          purpose: createPurpose.trim(),
          questions: createQuestions.split('\n').map(item => item.trim()).filter(Boolean),
          sectionTitle: createSectionTitle.trim() || '说明',
          body: createBody.trim(),
        })
        setCreatePageOpen(false)
        setCreateTitle('')
        setCreateSummary('')
        setCreatePurpose('')
        setCreateQuestions('')
        setCreateSectionTitle('说明')
        setCreateBody('')
        await loadWorkspace()
        setSelectedPageId(created.id)
      } catch (reason) {
        setError(errorMessage(reason, '无法新增 Wiki 词条'))
      } finally {
        setCreatingPage(false)
      }
    }

    const assistManualPage = async (): Promise<void> => {
      if (assistingPage || createTitle.trim() === '') return
      setAssistingPage(true)
      setError(undefined)
      try {
        const draft = await ctx.connection.assistWikiPage({
          title: createTitle.trim(),
          pageType: createType,
          ...(createBody.trim() === '' ? {} : { notes: createBody.trim() }),
        })
        setCreateSummary(draft.summary)
        setCreatePurpose(draft.purpose)
        setCreateQuestions(draft.questions.join('\n'))
        setCreateSectionTitle(draft.sectionTitle)
        setCreateBody(draft.body)
      } catch (reason) {
        setError(errorMessage(reason, 'AI 无法补充这个词条'))
      } finally {
        setAssistingPage(false)
      }
    }

    const createCategory = async (): Promise<void> => {
      if (categoryBusy || newCategoryName.trim() === '') return
      setCategoryBusy(true)
      try {
        await ctx.connection.createWikiFolder({ name: newCategoryName.trim() })
        setNewCategoryName('')
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法创建分类'))
      } finally {
        setCategoryBusy(false)
      }
    }

    const renameCategory = async (): Promise<void> => {
      if (categoryBusy || renamingFolderId === undefined || renameCategoryName.trim() === '') return
      setCategoryBusy(true)
      try {
        await ctx.connection.updateWikiFolder(renamingFolderId, { name: renameCategoryName.trim() })
        setRenamingFolderId(undefined)
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法重命名分类'))
      } finally {
        setCategoryBusy(false)
      }
    }

    const deleteCategory = async (folder: WikiFolder): Promise<void> => {
      if (categoryBusy || !window.confirm(`删除分类“${folder.name}”？其中词条会移到“未分组”。`)) return
      setCategoryBusy(true)
      try {
        await ctx.connection.deleteWikiFolder(folder.id)
        await loadWorkspace()
      } catch (reason) {
        setError(errorMessage(reason, '无法删除分类'))
      } finally {
        setCategoryBusy(false)
      }
    }

    const sources = useMemo(() => sourceList(page), [page])
    const visiblePages = useMemo(() => {
      const query = treeQuery.trim().toLowerCase()
      if (query === '') return pages
      return pages.filter(item => item.title.toLowerCase().includes(query) || item.slug.toLowerCase().includes(query))
    }, [pages, treeQuery])
    const tree = useMemo(() => wikiTree(folders, visiblePages), [folders, visiblePages])
    const groups = useMemo(() => catalogGroups(folders, pages), [folders, pages])
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
    const generating = generation !== undefined && ACTIVE_GENERATION_STATES.has(generation.state)
    const inbox = status?.inbox ?? []
    const reviews = status?.reviews ?? []
    const skipped = status?.skipped ?? []
    useEffect(() => {
      if (openQueue === 'inbox' && inbox.length === 0) setOpenQueue(undefined)
      if (openQueue === 'reviews' && reviews.length === 0) setOpenQueue(undefined)
      if (openQueue === 'skipped' && skipped.length === 0) setOpenQueue(undefined)
    }, [inbox.length, openQueue, reviews.length, skipped.length])
    const queued = new Set(status?.queuedDocumentIds ?? [])
    const activeDocumentId = generation?.plan?.documentId
    const failed = generation?.state === 'failed'
    const indexView = page?.pageType === 'index'
    const toggleQueue = (queue: 'inbox' | 'reviews' | 'skipped'): void => {
      setOpenQueue(current => current === queue ? undefined : queue)
    }

    return (
      <div className="page wiki-page">
        <header className="page-header">
          <div><p className="eyebrow">AI 知识整理</p><h1>Wiki</h1></div>
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={() => setCategoriesOpen(true)}><FolderPlus size={15} />管理分类</button>
            <button className="primary-button" type="button" onClick={() => setCreatePageOpen(true)}><Plus size={15} />新增词条</button>
          </div>
        </header>

        {status !== undefined && (
          <section className="wiki-summary" aria-label="Wiki 摘要">
            <div><span>知识文档</span><strong>{status.changes.totalDocuments}</strong></div>
            <div><span>Wiki 词条</span><strong>{Math.max(0, status.pageCount - (pages.some(item => item.pageType === 'index') ? 1 : 0))}</strong></div>
            <button className={openQueue === 'inbox' ? 'active' : ''} type="button" disabled={inbox.length === 0} onClick={() => toggleQueue('inbox')}>
              <span>待确认文章</span><strong>{inbox.length}</strong>
            </button>
            <button className={openQueue === 'reviews' ? 'active' : ''} type="button" disabled={reviews.length === 0} onClick={() => toggleQueue('reviews')}>
              <span>待核对词条</span><strong>{reviews.length}</strong>
            </button>
            <button className={openQueue === 'skipped' ? 'active' : ''} type="button" disabled={skipped.length === 0} onClick={() => toggleQueue('skipped')}>
              <span>已跳过文章</span><strong>{skipped.length}</strong>
            </button>
          </section>
        )}

        {error !== undefined && <div className="wiki-error" role="alert">{error}</div>}

        {status !== undefined && !status.llmConfigured && (
          <div className="wiki-banner warning">
            <span>生成词条需要先配置 AI 模型。</span>
            <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('settings', { panelId: 'llm' })}><Settings size={14} />前往设置</button>
          </div>
        )}
        {generating && generation !== undefined && (
          <div className="wiki-banner generating" aria-live="polite">
            <RefreshCw className="wiki-spin" size={14} />
            <span>{generationPhaseLabel(generation.phase)} · {progress}%</span>
            <div className="wiki-progress compact" aria-label={`生成进度 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
            <button className="secondary-button" type="button" disabled={cancelling} onClick={() => void cancelGeneration()}><Square size={14} />{cancelling ? '正在取消...' : '取消'}</button>
          </div>
        )}
        {failed && !generating && generation?.error !== undefined && (
          <div className="wiki-banner failed" role="alert">
            <span>{generation.error}</span>
            {generation.plan?.documentId !== undefined && status?.llmConfigured === true && (
              <button className="secondary-button" type="button" disabled={busyDocumentId !== undefined} onClick={() => void acceptDocument(generation.plan!.documentId!)}>重试这篇文章</button>
            )}
          </div>
        )}
        <div className="wiki-body">
        {openQueue === 'inbox' && inbox.length > 0 && (
          <section className="wiki-queue" aria-label="待确认文章">
            <header>
              <div><p className="eyebrow">按文章确认</p><h2>待确认文章</h2></div>
              <button className="secondary-button" type="button" onClick={() => setOpenQueue(undefined)}><X size={14} />关闭</button>
            </header>
            <p className="wiki-queue-note">确认后作为后台任务逐篇生成词条，不影响阅读。</p>
            <div className="wiki-inbox-list">
              {inbox.map(item => {
                const running = generating && activeDocumentId === item.documentId
                const waiting = queued.has(item.documentId)
                return (
                  <article key={item.documentId}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.libraryName} · {item.change === 'added' ? '新文章' : '内容已更新'}{item.locked ? ' · 词条已锁定' : ''}{running ? ' · 生成中' : waiting ? ' · 排队中' : ''}</span>
                    </div>
                    <div className="wiki-inbox-actions">
                      <button className="secondary-button" type="button" disabled={busyDocumentId !== undefined || running} onClick={() => void skipDocument(item.documentId)}>
                        {busyDocumentId === item.documentId && busyKind === 'skip' ? '处理中...' : '暂不收录'}
                      </button>
                      <button className="primary-button" type="button" disabled={busyDocumentId !== undefined || item.locked || running || waiting || status?.llmConfigured !== true} onClick={() => void acceptDocument(item.documentId)}>
                        {busyDocumentId === item.documentId && busyKind === 'accept' ? '确认中...' : item.locked ? '请先解锁' : running ? '生成中' : waiting ? '排队中' : '确认生成'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )}
        {openQueue === 'reviews' && reviews.length > 0 && (
          <section className="wiki-queue" aria-label="待核对词条">
            <header>
              <div><p className="eyebrow">生成后核对</p><h2>待核对词条</h2></div>
              <button className="secondary-button" type="button" onClick={() => setOpenQueue(undefined)}><X size={14} />关闭</button>
            </header>
            <p className="wiki-queue-note">确认收录后才会出现在首页分类里。</p>
            <div className="wiki-inbox-list">
              {reviews.map(item => (
                <article key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{pageTypeLabel(item.pageType)} · 待核对</span>
                  </div>
                  <div className="wiki-inbox-actions">
                    <button className="primary-button" type="button" onClick={() => {
                      setSelectedPageId(item.id)
                      setOpenQueue(undefined)
                    }}>去核对</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {openQueue === 'skipped' && skipped.length > 0 && (
          <section className="wiki-queue skipped" aria-label="已跳过文章">
            <header>
              <div><p className="eyebrow">暂不收录记录</p><h2>已跳过文章</h2></div>
              <button className="secondary-button" type="button" onClick={() => setOpenQueue(undefined)}><X size={14} />关闭</button>
            </header>
            <p className="wiki-queue-note">可以重新解析，生成后仍需核对。</p>
            <div className="wiki-inbox-list">
              {skipped.map(item => {
                const running = generating && activeDocumentId === item.documentId
                const waiting = queued.has(item.documentId)
                return (
                  <article key={item.documentId}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.libraryName} · {item.change === 'added' ? '当时是新文章' : '当时内容已更新'} · 跳过于 {new Date(item.skippedAt).toLocaleString()}{item.locked ? ' · 词条已锁定' : ''}{running ? ' · 生成中' : waiting ? ' · 排队中' : ''}</span>
                    </div>
                    <div className="wiki-inbox-actions">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={busyDocumentId !== undefined || item.locked || running || waiting || status?.llmConfigured !== true}
                        onClick={() => void acceptDocument(item.documentId)}
                      >
                        {busyDocumentId === item.documentId && busyKind === 'accept' ? '解析中...' : item.locked ? '请先解锁' : running ? '生成中' : waiting ? '排队中' : '重新解析'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )}

        {loading ? (
          <div className="wiki-state">正在读取 Wiki...</div>
        ) : pages.length === 0 ? (
          <section className="wiki-empty">
            <div className="wiki-empty-icon"><Library size={23} /></div>
            <h2>{inbox.length > 0 ? '还没有词条' : skipped.length > 0 ? '这些文章被跳过了' : 'Wiki 还是空的'}</h2>
            <p>{inbox.length > 0 ? '点上方「待确认文章」后生成词条，不影响你继续阅读。' : skipped.length > 0 ? '点上方「已跳过文章」可以重新解析。' : '知识库出现新文章后，点上方数字即可处理。'}</p>
          </section>
        ) : (
          <main className="wiki-workbench">
            <nav className="wiki-tree" aria-label="Wiki 目录">
              <div className="wiki-pane-title">目录</div>
              <label className="wiki-tree-search">
                <Search size={13} />
                <input value={treeQuery} onChange={event => setTreeQuery(event.target.value)} placeholder="搜索词条" />
              </label>
              {tree.length === 0 ? <p className="wiki-no-sources">没有匹配的词条。</p> : tree.map(node => node.kind === 'folder' ? (
                <div className="wiki-folder" key={node.folder.id} style={{ paddingLeft: `${9 + node.depth * 16}px` }}>
                  <FolderClosed size={13} /><span>{node.folder.name}</span>
                </div>
              ) : (
                <button className={node.page.id === selectedPageId ? 'active' : ''} key={node.page.id} style={{ paddingLeft: `${12 + node.depth * 16}px` }} type="button" onClick={() => setSelectedPageId(node.page.id)}>
                  <ChevronRight size={13} /><span>{node.page.title}</span>
                  {node.page.status === 'draft' && <em>待核</em>}
                  {node.page.state !== 'ready' && <i />}
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
                    {page.status !== 'draft' && (
                      <label><span>发布状态</span><select value={editStatus} onChange={event => setEditStatus(event.target.value as WikiPageStatus)}><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></label>
                    )}
                    <label><span>所属分类</span><select value={editFolderId} onChange={event => setEditFolderId(event.target.value)}><option value="">未分组</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
                    <label><span>别名（逗号分隔）</span><input value={editAliases} onChange={event => setEditAliases(event.target.value)} /></label>
                  </div>
                  {editSections.map((section, sectionIndex) => (
                    <Fragment key={section.id}>
                      <div className="wiki-editor-section-head">
                        <label><span>章节标题</span><input value={section.title} onChange={event => setEditSections(items => items.map((item, index) => index === sectionIndex ? { ...item, title: event.target.value } : item))} /></label>
                        {editSections.length > 1 && (
                          <button className="secondary-button" type="button" onClick={() => setEditSections(items => items.filter((_, index) => index !== sectionIndex))}>删除章节</button>
                        )}
                      </div>
                      <label><span>Markdown 内容</span><textarea rows={12} value={section.body} onChange={event => setEditSections(items => items.map((item, index) => index === sectionIndex ? { ...item, body: event.target.value } : item))} /></label>
                    </Fragment>
                  ))}
                  <button className="secondary-button" type="button" onClick={() => setEditSections(items => [...items, { id: crypto.randomUUID(), title: '补充', body: '（在此补充）' }])}>
                    <Plus size={14} />添加章节
                  </button>
                  <p className="wiki-lock-note">{page.status === 'draft' ? '保存补充后仍需确认收录。补充内容会锁定，避免被后台覆盖。' : '保存后该词条会锁定，后台生成不会覆盖，直到你允许自动更新。'}</p>
                  <div className="wiki-editor-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button><button className="primary-button" type="button" disabled={saving || editTitle.trim() === ''} onClick={() => void savePage()}>{saving ? '保存中...' : page.status === 'draft' ? '保存补充' : '保存并锁定'}</button></div>
                </div>
              ) : indexView ? (
                <>
                  <header>
                    <div>
                      <h1>词条目录</h1>
                      <span>按分类浏览，不做额外解释</span>
                    </div>
                  </header>
                  <div className="wiki-catalog">
                    {groups.length === 0 ? <p className="wiki-no-sources">还没有词条。</p> : groups.map(group => (
                      <section key={group.name}>
                        <h2>{group.name}</h2>
                        <ul>
                          {group.pages.map(item => (
                            <li key={item.id}>
                              <button type="button" onClick={() => setSelectedPageId(item.id)}>{item.title}</button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <header>
                    <div className="wiki-page-heading">
                      <h1>{page.title}</h1>
                      <span>{pageTypeLabel(page.pageType)} · {page.status} · v{page.version} · 更新于 {new Date(page.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="wiki-page-actions">
                      <button className="secondary-button" type="button" onClick={() => void openHistory()}><History size={15} />版本</button>
                      {sources[0] !== undefined && (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={generating || busyDocumentId !== undefined || page.state === 'locked' || status?.llmConfigured !== true}
                          onClick={() => void acceptDocument(sources[0]!.documentId, true)}
                        >
                          <RefreshCw size={15} />
                          {busyDocumentId === sources[0].documentId && busyKind === 'accept' ? '完善中...' : '完善词条'}
                        </button>
                      )}
                      <button className="secondary-button" type="button" onClick={beginEdit}><FileEdit size={15} />{page.status === 'draft' ? '补充' : '编辑'}</button>
                      {page.status === 'draft' && (
                        <button className="primary-button" type="button" disabled={publishing} onClick={() => void publishPage()}>
                          {publishing ? '收录中...' : '确认收录'}
                        </button>
                      )}
                    </div>
                  </header>
                  {page.status === 'draft' && (
                    <div className="wiki-banner warning">
                      <span>这是新生成的词条，请先核对。原文没写清的地方可以补充，确认后才会出现在首页。</span>
                      <button className="secondary-button" type="button" onClick={beginEdit}><FileEdit size={14} />补充</button>
                      <button className="primary-button" type="button" disabled={publishing} onClick={() => void publishPage()}>{publishing ? '收录中...' : '确认收录'}</button>
                    </div>
                  )}
                  {page.state === 'locked' && (
                    <div className="wiki-banner warning">
                      <span>该词条已锁定，确认文章更新时不会自动覆盖。需要后台更新时，先允许自动更新。</span>
                      <button className="secondary-button" type="button" disabled={unlocking} onClick={() => void unlockPage()}><Unlock size={14} />{unlocking ? '解锁中...' : '允许自动更新'}</button>
                    </div>
                  )}
                  {page.state === 'source-missing' && <div className="wiki-source-warning">部分来源文档已删除。请确认剩余文章后重新生成，或手动修订。</div>}
                  {page.summary !== '' && <p className="wiki-page-summary">{page.summary}</p>}
                  {page.purpose !== '' && <div className="wiki-purpose"><strong>词条用途</strong><p>{page.purpose}</p></div>}
                  {page.questions.length > 0 && <div className="wiki-questions"><strong>它应该回答</strong><ul>{page.questions.map(question => <li key={question}>{question}</li>)}</ul></div>}
                  {page.sections.map(section => <section key={section.id}><h2>{section.title}</h2><Markdown content={section.body} onWikiLink={openWikiSlug} /></section>)}
                </>
              )}
            </article>
            <aside className="wiki-sources">
              <div className="wiki-pane-title">来源 · {sources.length}</div>
              {indexView || sources.length === 0 ? <p className="wiki-no-sources">{indexView ? '首页按分类列出词条，不绑定来源文档。' : '当前页面没有来源记录。'}</p> : sources.map(source => (
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
        </div>

        {createPageOpen && (
          <div className="wiki-dialog-backdrop">
            <section className="wiki-dialog wiki-create-dialog" role="dialog" aria-modal="true" aria-labelledby="wiki-create-title">
              <header>
                <div><p className="eyebrow">手动维护</p><h2 id="wiki-create-title">新增 Wiki 词条</h2></div>
                <button type="button" title="关闭" onClick={() => setCreatePageOpen(false)}><X size={18} /></button>
              </header>
              <div className="wiki-manage-form">
                <label><span>词条名称</span><input autoFocus value={createTitle} onChange={event => setCreateTitle(event.target.value)} placeholder="人物、组织、概念或事件名称" /></label>
                <div className="wiki-assist-row">
                  <button className="secondary-button" type="button" disabled={assistingPage || createTitle.trim() === '' || status?.llmConfigured !== true} onClick={() => void assistManualPage()}><Sparkles size={14} />{assistingPage ? 'AI 正在补充...' : 'AI 补充解释'}</button>
                  <span>AI 会生成可编辑草稿，不会直接创建词条。</span>
                </div>
                <div className="wiki-manage-grid">
                  <label><span>类型</span><select value={createType} onChange={event => setCreateType(event.target.value as WikiPageSummary['pageType'])}>
                    <option value="entity">人物 / 组织 / 地点</option><option value="concept">概念</option><option value="glossary">术语</option><option value="project">项目 / 产品</option><option value="policy">制度</option><option value="procedure">流程</option><option value="decision">决策</option><option value="event">事件</option><option value="topic">专题</option>
                  </select></label>
                  <label><span>分类</span><select value={createFolderId} onChange={event => setCreateFolderId(event.target.value)}><option value="">未分组</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>
                </div>
                <label><span>摘要</span><textarea rows={3} value={createSummary} onChange={event => setCreateSummary(event.target.value)} placeholder="一句话说明这个词条" /></label>
                <label><span>词条用途</span><input value={createPurpose} onChange={event => setCreatePurpose(event.target.value)} placeholder="这个词条帮助读者理解什么" /></label>
                <label><span>应该回答的问题（每行一个）</span><textarea rows={3} value={createQuestions} onChange={event => setCreateQuestions(event.target.value)} /></label>
                <label><span>章节标题</span><input value={createSectionTitle} onChange={event => setCreateSectionTitle(event.target.value)} /></label>
                <label><span>说明（Markdown）</span><textarea rows={12} value={createBody} onChange={event => setCreateBody(event.target.value)} placeholder="可先写下线索，再让 AI 补充定义、背景、关键事实和影响…" /></label>
              </div>
              <footer><button className="secondary-button" type="button" disabled={creatingPage || assistingPage} onClick={() => setCreatePageOpen(false)}>取消</button><button className="primary-button" type="button" disabled={creatingPage || assistingPage || createTitle.trim() === '' || createBody.trim() === ''} onClick={() => void createManualPage()}>{creatingPage ? '创建中...' : '创建词条'}</button></footer>
            </section>
          </div>
        )}

        {categoriesOpen && (
          <div className="wiki-dialog-backdrop">
            <section className="wiki-dialog wiki-categories-dialog" role="dialog" aria-modal="true" aria-labelledby="wiki-categories-title">
              <header>
                <div><p className="eyebrow">手动维护</p><h2 id="wiki-categories-title">管理分类</h2></div>
                <button type="button" title="关闭" onClick={() => setCategoriesOpen(false)}><X size={18} /></button>
              </header>
              <div className="wiki-category-create">
                <input value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} placeholder="新分类名称" onKeyDown={event => { if (event.key === 'Enter') void createCategory() }} />
                <button className="primary-button" type="button" disabled={categoryBusy || newCategoryName.trim() === ''} onClick={() => void createCategory()}><Plus size={14} />创建</button>
              </div>
              <div className="wiki-category-list">
                {folders.length === 0 ? <p>还没有分类。</p> : folders.map(folder => (
                  <article key={folder.id}>
                    {renamingFolderId === folder.id ? (
                      <input autoFocus value={renameCategoryName} onChange={event => setRenameCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void renameCategory() }} />
                    ) : <div><strong>{folder.name}</strong><span>{folder.path}</span></div>}
                    <div>
                      {renamingFolderId === folder.id ? (
                        <><button className="secondary-button" type="button" disabled={categoryBusy} onClick={() => setRenamingFolderId(undefined)}>取消</button><button className="primary-button" type="button" disabled={categoryBusy || renameCategoryName.trim() === ''} onClick={() => void renameCategory()}>保存</button></>
                      ) : (
                        <><button className="icon-button" type="button" title="重命名" disabled={categoryBusy} onClick={() => { setRenamingFolderId(folder.id); setRenameCategoryName(folder.name) }}><Pencil size={14} /></button><button className="icon-button" type="button" title="删除分类" disabled={categoryBusy} onClick={() => void deleteCategory(folder)}><Trash2 size={14} /></button></>
                      )}
                    </div>
                  </article>
                ))}
              </div>
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
