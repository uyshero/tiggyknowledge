import type { Context } from '@deepseek-ai/cordis'
import { AlertTriangle, CheckCircle2, GitCompare, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type {
  WikiGovernanceSnapshot,
  WikiIssue,
  WikiIssueType,
  WikiLintFinding,
  WikiPage,
  WikiPageRevision,
  WikiPageSummary,
} from '@tiggyknowledge/contracts'
import './styles.css'

export const inject = ['clientApp', 'connection']

type Tab = 'versions' | 'issues' | 'lint' | 'trash'
type DiffKind = 'same' | 'added' | 'removed'

interface DiffLine {
  kind: DiffKind
  text: string
}

const ISSUE_LABELS: Record<WikiIssueType, string> = {
  'contradictory-facts': '事实冲突',
  'out-of-date': '内容过期',
  'mixed-entities': '实体混淆',
  'source-missing': '来源失效',
  other: '其他问题',
}

export function apply(ctx: Context): void {
  function GovernancePage(): JSX.Element {
    const [tab, setTab] = useState<Tab>('versions')
    const [snapshot, setSnapshot] = useState<WikiGovernanceSnapshot>()
    const [pages, setPages] = useState<WikiPageSummary[]>([])
    const [issues, setIssues] = useState<WikiIssue[]>([])
    const [findings, setFindings] = useState<WikiLintFinding[]>([])
    const [trash, setTrash] = useState<WikiPageSummary[]>([])
    const [selectedPageId, setSelectedPageId] = useState('')
    const [currentPage, setCurrentPage] = useState<WikiPage>()
    const [revisions, setRevisions] = useState<WikiPageRevision[]>([])
    const [selectedVersion, setSelectedVersion] = useState<number>()
    const [issuePageId, setIssuePageId] = useState('')
    const [issueType, setIssueType] = useState<WikiIssueType>('contradictory-facts')
    const [issueDescription, setIssueDescription] = useState('')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string>()

    const reload = useCallback(async (signal?: AbortSignal): Promise<void> => {
      const [nextSnapshot, nextPages, nextIssues, nextFindings, nextTrash] = await Promise.all([
        ctx.connection.wikiGovernance(signal),
        ctx.connection.wikiPages(signal),
        ctx.connection.wikiIssues(signal),
        ctx.connection.wikiLint(signal),
        ctx.connection.wikiTrash(signal),
      ])
      setSnapshot(nextSnapshot)
      setPages(nextPages)
      setIssues(nextIssues)
      setFindings(nextFindings)
      setTrash(nextTrash)
      setSelectedPageId(value => nextPages.some(page => page.id === value) ? value : nextPages[0]?.id ?? '')
      setIssuePageId(value => nextPages.some(page => page.id === value) ? value : nextPages[0]?.id ?? '')
    }, [])

    useEffect(() => {
      const controller = new AbortController()
      void reload(controller.signal)
        .catch(reason => {
          if (!controller.signal.aborted) setError(message(reason))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
      return () => controller.abort()
    }, [reload])

    useEffect(() => {
      if (selectedPageId === '') {
        setCurrentPage(undefined)
        setRevisions([])
        return
      }
      const controller = new AbortController()
      void Promise.all([
        ctx.connection.wikiPage(selectedPageId, controller.signal),
        ctx.connection.wikiPageRevisions(selectedPageId, controller.signal),
      ]).then(([page, history]) => {
        setCurrentPage(page)
        setRevisions(history)
        setSelectedVersion(history[0]?.version)
      }).catch(reason => {
        if (!controller.signal.aborted) setError(message(reason))
      })
      return () => controller.abort()
    }, [selectedPageId])

    const selectedRevision = revisions.find(revision => revision.version === selectedVersion)
    const diff = useMemo(() => selectedRevision === undefined || currentPage === undefined
      ? []
      : lineDiff(revisionText(selectedRevision), pageText(currentPage)), [currentPage, selectedRevision])

    const createIssue = async (): Promise<void> => {
      if (issuePageId === '' || issueDescription.trim() === '' || busy) return
      setBusy(true)
      try {
        await ctx.connection.createWikiIssue({
          pageId: issuePageId,
          type: issueType,
          description: issueDescription.trim(),
        })
        setIssueDescription('')
        await reload()
      } catch (reason) {
        setError(message(reason))
      } finally {
        setBusy(false)
      }
    }

    const resolveIssue = async (issue: WikiIssue): Promise<void> => {
      setBusy(true)
      try {
        await ctx.connection.updateWikiIssue(issue.id, { status: issue.status === 'open' ? 'resolved' : 'open' })
        await reload()
      } catch (reason) {
        setError(message(reason))
      } finally {
        setBusy(false)
      }
    }

    const restore = async (page: WikiPageSummary): Promise<void> => {
      setBusy(true)
      try {
        await ctx.connection.restoreWikiPage(page.id, page.version)
        await reload()
      } catch (reason) {
        setError(message(reason))
      } finally {
        setBusy(false)
      }
    }

    const purge = async (page: WikiPageSummary): Promise<void> => {
      if (!window.confirm(`永久删除“${page.title}”？此操作无法撤销。`)) return
      setBusy(true)
      try {
        await ctx.connection.purgeWikiPage(page.id)
        await reload()
      } catch (reason) {
        setError(message(reason))
      } finally {
        setBusy(false)
      }
    }

    if (loading) return <div className="page governance-state">正在读取 Wiki 治理状态...</div>

    return (
      <div className="settings-section governance-page">
        <div className="section-heading">
          <div><h2>Wiki 治理</h2><p>维护版本、问题、内容质量和回收站。</p></div>
        </div>
        {snapshot !== undefined && (
          <section className="governance-summary">
            <div><span>待处理问题</span><strong>{snapshot.openIssues}</strong></div>
            <div><span>Lint 提示</span><strong>{snapshot.lintFindings}</strong></div>
            <div><span>回收站</span><strong>{snapshot.archivedPages}</strong></div>
          </section>
        )}
        {error !== undefined && <div className="governance-error">{error}</div>}
        <nav className="governance-tabs">
          <button className={tab === 'versions' ? 'active' : ''} onClick={() => setTab('versions')}><GitCompare size={15} />版本 Diff</button>
          <button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}><AlertTriangle size={15} />问题</button>
          <button className={tab === 'lint' ? 'active' : ''} onClick={() => setTab('lint')}><ShieldCheck size={15} />Lint</button>
          <button className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}><Trash2 size={15} />回收站</button>
        </nav>

        {tab === 'versions' && (
          <main className="governance-panel">
            <div className="governance-controls">
              <label>页面<select value={selectedPageId} onChange={event => setSelectedPageId(event.target.value)}>{pages.map(page => <option key={page.id} value={page.id}>{page.title} · v{page.version}</option>)}</select></label>
              <label>历史版本<select value={selectedVersion ?? ''} onChange={event => setSelectedVersion(Number(event.target.value))}><option value="">选择版本</option>{revisions.map(revision => <option key={revision.version} value={revision.version}>v{revision.version} · {revision.editSource}</option>)}</select></label>
            </div>
            {diff.length === 0 ? <Empty text="该页面还没有可比较的历史版本。" /> : (
              <div className="governance-diff">{diff.map((line, index) => <div className={line.kind} key={`${index}-${line.text}`}><b>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</b><code>{line.text || ' '}</code></div>)}</div>
            )}
          </main>
        )}

        {tab === 'issues' && (
          <main className="governance-panel">
            <section className="governance-create">
              <select value={issuePageId} onChange={event => setIssuePageId(event.target.value)}>{pages.map(page => <option key={page.id} value={page.id}>{page.title}</option>)}</select>
              <select value={issueType} onChange={event => setIssueType(event.target.value as WikiIssueType)}>{Object.entries(ISSUE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <input placeholder="记录需要后续处理的问题" value={issueDescription} onChange={event => setIssueDescription(event.target.value)} />
              <button className="primary-button" disabled={busy || issueDescription.trim() === ''} onClick={() => void createIssue()}><Plus size={14} />添加</button>
            </section>
            {issues.length === 0 ? <Empty text="还没有人工标记的问题。" /> : <div className="governance-list">{issues.map(issue => <article key={issue.id}><div><strong>{issue.pageTitle}</strong><span>{ISSUE_LABELS[issue.type]} · {issue.status === 'open' ? '待处理' : '已解决'}</span><p>{issue.description}</p></div><button className="secondary-button" disabled={busy} onClick={() => void resolveIssue(issue)}><CheckCircle2 size={14} />{issue.status === 'open' ? '标记解决' : '重新打开'}</button></article>)}</div>}
          </main>
        )}

        {tab === 'lint' && (
          <main className="governance-panel">
            {findings.length === 0 ? <Empty text="未发现 Wiki 结构问题。" /> : <div className="governance-list">{findings.map(item => <article key={item.id}><div><strong>{item.pageTitle}</strong><span>{item.severity === 'warning' ? '警告' : '建议'} · {item.type}</span><p>{item.message}</p></div><button className="secondary-button" onClick={() => ctx.clientApp.selectPage('wiki')}>查看页面</button></article>)}</div>}
          </main>
        )}

        {tab === 'trash' && (
          <main className="governance-panel">
            {trash.length === 0 ? <Empty text="回收站为空。" /> : <div className="governance-list">{trash.map(page => <article key={page.id}><div><strong>{page.title}</strong><span>{page.pageType} · v{page.version} · {new Date(page.updatedAt).toLocaleString()}</span><p>{page.summary || '无摘要'}</p></div><div className="governance-actions"><button className="secondary-button" disabled={busy} onClick={() => void restore(page)}><RotateCcw size={14} />恢复为草稿</button><button className="danger-button" disabled={busy} onClick={() => void purge(page)}><Trash2 size={14} />永久删除</button></div></article>)}</div>}
          </main>
        )}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerSettingsPanel({
    id: 'wiki-governance',
    label: 'Wiki 治理',
    component: GovernancePage,
    order: 26,
  }), 'wiki-governance: settings panel')
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="governance-empty">{text}</div>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Wiki 治理操作失败'
}

function revisionText(revision: WikiPageRevision): string {
  return [`# ${revision.title}`, revision.summary, ...revision.sections.flatMap(section => [`## ${section.title}`, section.body])].join('\n')
}

function pageText(page: WikiPage): string {
  return [`# ${page.title}`, page.summary, ...page.sections.flatMap(section => [`## ${section.title}`, section.body])].join('\n')
}

function lineDiff(before: string, after: string): DiffLine[] {
  const left = before.replace(/\r\n?/g, '\n').split('\n')
  const right = after.replace(/\r\n?/g, '\n').split('\n')
  if (left.length > 500 || right.length > 500) {
    return [...left.map(text => ({ kind: 'removed' as const, text })), ...right.map(text => ({ kind: 'added' as const, text }))]
  }
  const width = right.length + 1
  const matrix = new Uint16Array((left.length + 1) * width)
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const at = i * width + j
      matrix[at] = left[i] === right[j]
        ? (matrix[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(matrix[(i + 1) * width + j] ?? 0, matrix[i * width + j + 1] ?? 0)
    }
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ kind: 'same', text: left[i] ?? '' })
      i += 1
      j += 1
    } else if ((matrix[(i + 1) * width + j] ?? 0) >= (matrix[i * width + j + 1] ?? 0)) {
      result.push({ kind: 'removed', text: left[i] ?? '' })
      i += 1
    } else {
      result.push({ kind: 'added', text: right[j] ?? '' })
      j += 1
    }
  }
  while (i < left.length) result.push({ kind: 'removed', text: left[i++] ?? '' })
  while (j < right.length) result.push({ kind: 'added', text: right[j++] ?? '' })
  return result
}
