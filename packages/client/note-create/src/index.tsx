import type { Context } from '@deepseek-ai/cordis'
import { ArrowLeft, FilePlus2, History, Save, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type JSX, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { LibraryActionProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeDocumentRevision, KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

function libraryIdOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  const libraryId = (value as Record<string, unknown>).libraryId
  return typeof libraryId === 'string' ? libraryId : ''
}

function documentIdOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  const documentId = (value as Record<string, unknown>).documentId
  return typeof documentId === 'string' ? documentId : ''
}

function tagNames(input: string): string[] {
  return input.split(/[,，\n]/).map(name => name.trim()).filter(Boolean)
}

function parseMarkdownNote(content: string): { title: string, body: string } {
  const normalized = content.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.startsWith('# ')) {
    const title = lines[0].slice(2).trim()
    const bodyStart = lines[1]?.trim().length === 0 ? 2 : 1
    return { title, body: lines.slice(bodyStart).join('\n').replace(/\s+$/u, '') }
  }
  return { title: '', body: normalized.replace(/\s+$/u, '') }
}

function safeHref(target: string): string | undefined {
  try {
    const url = new URL(target, 'https://knowledge.local')
    return url.protocol === 'http:' || url.protocol === 'https:' ? target : undefined
  } catch {
    return undefined
  }
}

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const result: ReactNode[] = []
  const pattern = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)\n]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) result.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('`')) result.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const href = parts?.[2] === undefined ? undefined : safeHref(parts[2])
      result.push(href === undefined || parts?.[1] === undefined ? <span key={key}>{token}</span> : <a href={href} key={key} rel="noreferrer">{parts[1]}</a>)
    } else if (token.startsWith('**')) result.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else result.push(<em key={key}>{token.slice(1, -1)}</em>)
    cursor = match.index + token.length
  }
  if (cursor < text.length) result.push(text.slice(cursor))
  return result
}

function MarkdownPreview({ content }: { content: string }): JSX.Element {
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
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += index < lines.length ? 1 : 0
      blocks.push(<pre key={`code-${index}`}><code>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading !== null) {
      const level = (heading[1] ?? '').length
      const children = inlineMarkdown(heading[2] ?? '', `heading-${index}`)
      const key = `heading-${index}`
      blocks.push(level === 1 ? <h1 key={key}>{children}</h1> : level === 2 ? <h2 key={key}>{children}</h2> : <h3 key={key}>{children}</h3>)
      index += 1
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? '')) {
        items.push(<li key={`item-${index}`}>{inlineMarkdown((lines[index] ?? '').replace(/^\s*[-*+]\s+/, ''), `item-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push(<li key={`item-${index}`}>{inlineMarkdown((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''), `item-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ol key={`list-${index}`}>{items}</ol>)
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !/^(#{1,6})\s|^```|^\s*[-*+]\s+|^\s*\d+\.\s+/.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(' '), `paragraph-${index}`)}</p>)
  }
  return <div className="note-markdown">{blocks.length === 0 ? <p className="note-preview-empty">右侧会同步显示 Markdown 预览。</p> : blocks}</div>
}

export function apply(ctx: Context): void {
  function NoteWorkspacePage({ mode }: { mode: 'create' | 'edit' }): JSX.Element {
    const pageState = ctx.clientApp.getSnapshot().pageState
    const initialLibraryId = libraryIdOf(pageState)
    const initialDocumentId = documentIdOf(pageState)
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [libraryId, setLibraryId] = useState(initialLibraryId)
    const [documentId, setDocumentId] = useState(initialDocumentId)
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [tags, setTags] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string>()
    const [historyOpen, setHistoryOpen] = useState(false)
    const [revisions, setRevisions] = useState<KnowledgeDocumentRevision[]>([])
    const [currentVersion, setCurrentVersion] = useState(1)
    const [reverting, setReverting] = useState<number>()

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.libraries(controller.signal).then(items => {
        setLibraries(items)
        setLibraryId(value => items.some(library => library.id === value) ? value : items[0]?.id ?? '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取知识库')
      }).finally(() => {
        if (!controller.signal.aborted && mode === 'create') setLoading(false)
      })
      return () => controller.abort()
    }, [mode])

    useEffect(() => {
      if (mode !== 'edit' || initialDocumentId.length === 0) return
      const controller = new AbortController()
      setDocumentId(initialDocumentId)
      void Promise.all([
        ctx.connection.documentPreview(initialDocumentId, controller.signal),
        ctx.connection.documentMetadata(initialDocumentId, controller.signal),
        ctx.connection.documentRevisions(initialDocumentId, controller.signal),
      ]).then(([preview, metadata, history]) => {
        const parsed = parseMarkdownNote(preview.content)
        setTitle(parsed.title || preview.document.title)
        setBody(parsed.body)
        setLibraryId(preview.document.libraryId)
        setTags(metadata.tags.map(tag => tag.name).join('，'))
        setRevisions(history.items)
        setCurrentVersion(history.currentVersion)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取笔记')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [initialDocumentId, mode])

    const preview = useMemo(() => (title.trim().length === 0 ? body : `# ${title.trim()}\n\n${body}`), [body, title])
    const back = (): void => {
      if (mode === 'edit' && libraryId.length > 0 && documentId.length > 0) {
        ctx.clientApp.selectPage('documents', { libraryId, documentId })
        return
      }
      ctx.clientApp.selectPage(libraryId.length === 0 ? 'knowledge' : 'documents', libraryId.length === 0 ? undefined : { libraryId })
    }

    const refreshHistory = async (id: string): Promise<void> => {
      const history = await ctx.connection.documentRevisions(id)
      setRevisions(history.items)
      setCurrentVersion(history.currentVersion)
    }

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (saving || libraryId.length === 0) return
      setSaving(true)
      setError(undefined)
      try {
        if (mode === 'create') {
          const document = await ctx.connection.createNote(libraryId, { title, body, tagNames: tagNames(tags) })
          ctx.clientApp.selectPage('documents', { libraryId, documentId: document.id })
          return
        }
        if (documentId.length === 0) throw new Error('笔记不存在')
        const document = await ctx.connection.updateMarkdownNote(documentId, { title, body, tagNames: tagNames(tags) })
        setDocumentId(document.id)
        setLibraryId(document.libraryId)
        await refreshHistory(document.id)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : mode === 'create' ? '知识条目创建失败' : '笔记保存失败')
      } finally {
        setSaving(false)
      }
    }

    const revertTo = async (version: number): Promise<void> => {
      if (documentId.length === 0 || reverting !== undefined) return
      setReverting(version)
      setError(undefined)
      try {
        const document = await ctx.connection.revertDocumentRevision(documentId, version)
        const preview = await ctx.connection.documentPreview(document.id)
        const parsed = parseMarkdownNote(preview.content)
        setTitle(parsed.title || document.title)
        setBody(parsed.body)
        await refreshHistory(document.id)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '回滚失败')
      } finally {
        setReverting(undefined)
      }
    }

    return (
      <form className="page note-create-page" onSubmit={event => void submit(event)}>
        <header className="page-header compact-header">
          <div className="documents-title">
            <button className="icon-button" type="button" title="返回" onClick={back}><ArrowLeft size={18} /></button>
            <div>
              <p className="eyebrow">Markdown</p>
              <h1>{mode === 'create' ? '新建知识条目' : '编辑笔记'}</h1>
            </div>
          </div>
          <div className="header-actions">
            {mode === 'edit' && (
              <button className={`secondary-button ${historyOpen ? 'active' : ''}`} type="button" disabled={loading} onClick={() => setHistoryOpen(value => !value)}>
                <History size={16} />版本{currentVersion > 1 ? ` v${currentVersion}` : ''}
              </button>
            )}
            <button className="secondary-button" type="button" disabled={saving} onClick={back}>取消</button>
            <button className="primary-button" type="submit" disabled={saving || loading || libraryId.length === 0 || title.trim().length === 0 || body.trim().length === 0}>
              <Save size={16} />{saving ? '保存中...' : mode === 'create' ? '保存条目' : '保存修改'}
            </button>
          </div>
        </header>
        <div className={`note-editor-workspace ${historyOpen ? 'with-history' : ''}`}>
          <div className="note-editor-main">
            <div className="note-editor-meta">
              <label><span>知识库</span><select disabled={loading || saving || mode === 'edit'} value={libraryId} onChange={event => setLibraryId(event.target.value)}>{libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
              <label><span>标签</span><input disabled={saving} maxLength={340} value={tags} onChange={event => setTags(event.target.value)} placeholder="产品，规范" /></label>
            </div>
            <label className="note-title-field"><span className="visually-hidden">标题</span><input autoFocus disabled={saving || loading} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="知识条目标题" /></label>
            <div className="note-split" aria-label="笔记编辑与预览">
              <label className="note-body-field">
                <span className="visually-hidden">Markdown 正文</span>
                <textarea disabled={saving || loading} maxLength={200000} value={body} onChange={event => setBody(event.target.value)} placeholder="输入 Markdown 正文" />
              </label>
              <section className="note-preview-pane" aria-label="实时预览">
                <p className="note-preview-label">预览</p>
                <MarkdownPreview content={preview} />
              </section>
            </div>
            {libraries.length === 0 && !loading && <div className="form-error" role="alert">请先创建知识库。</div>}
            {error !== undefined && <div className="form-error" role="alert">{error}</div>}
          </div>
          {historyOpen && mode === 'edit' && (
            <aside className="note-history" aria-label="版本历史">
              <div className="note-history-current"><strong>当前 v{currentVersion}</strong><span>保存后会留下上一版</span></div>
              {revisions.length === 0 ? <p>还没有历史版本。</p> : revisions.map(revision => (
                <article key={revision.version}>
                  <div>
                    <strong>v{revision.version} · {revision.title}</strong>
                    <span>{new Date(revision.createdAt).toLocaleString()}</span>
                  </div>
                  <button className="secondary-button" type="button" disabled={reverting !== undefined} onClick={() => void revertTo(revision.version)}>
                    <Undo2 size={14} />{reverting === revision.version ? '回滚中...' : '回滚'}
                  </button>
                </article>
              ))}
            </aside>
          )}
        </div>
      </form>
    )
  }

  function NoteCreateAction({ library }: LibraryActionProps): JSX.Element {
    return <button className="library-action-button" type="button" title={`在 ${library.name} 新建知识条目`} onClick={() => ctx.clientApp.selectPage('note-create', { libraryId: library.id })}><FilePlus2 size={15} /><span className="visually-hidden">新建知识条目</span></button>
  }

  ctx.effect(() => {
    const disposeCreate = ctx.clientApp.registerPage({ id: 'note-create', label: '新建知识条目', icon: FilePlus2, component: () => <NoteWorkspacePage mode="create" />, order: 14, section: 'hidden' })
    const disposeEdit = ctx.clientApp.registerPage({ id: 'note-edit', label: '编辑笔记', icon: FilePlus2, component: () => <NoteWorkspacePage mode="edit" />, order: 16, section: 'hidden' })
    const disposeAction = ctx.clientApp.registerLibraryAction({ id: 'note-create', component: NoteCreateAction, order: 5 })
    return () => {
      disposeAction()
      disposeEdit()
      disposeCreate()
    }
  }, 'client-note-create: register page and library action')
}
