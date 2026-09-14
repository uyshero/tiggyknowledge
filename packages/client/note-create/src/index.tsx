import type { Context } from '@deepseek-ai/cordis'
import { ArrowLeft, FilePlus2, Save } from 'lucide-react'
import { useEffect, useState, type FormEvent, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { LibraryActionProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

function libraryIdOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  const libraryId = (value as Record<string, unknown>).libraryId
  return typeof libraryId === 'string' ? libraryId : ''
}

function tagNames(input: string): string[] {
  return input.split(/[,，\n]/).map(name => name.trim()).filter(Boolean)
}

export function apply(ctx: Context): void {
  function NoteCreatePage(): JSX.Element {
    const initialLibraryId = libraryIdOf(ctx.clientApp.getSnapshot().pageState)
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [libraryId, setLibraryId] = useState(initialLibraryId)
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [tags, setTags] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string>()

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.libraries(controller.signal).then(items => {
        setLibraries(items)
        setLibraryId(value => items.some(library => library.id === value) ? value : items[0]?.id ?? '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取知识库')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [])

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (saving || libraryId.length === 0) return
      setSaving(true)
      setError(undefined)
      try {
        const document = await ctx.connection.createNote(libraryId, { title, body, tagNames: tagNames(tags) })
        ctx.clientApp.selectPage('documents', { libraryId, documentId: document.id })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '知识条目创建失败')
      } finally {
        setSaving(false)
      }
    }

    return (
      <form className="page note-create-page" onSubmit={event => void submit(event)}>
        <header className="page-header compact-header">
          <div className="documents-title"><button className="icon-button" type="button" title="返回知识库" onClick={() => ctx.clientApp.selectPage('knowledge')}><ArrowLeft size={18} /></button><div><p className="eyebrow">Markdown</p><h1>新建知识条目</h1></div></div>
          <div className="header-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => ctx.clientApp.selectPage('knowledge')}>取消</button><button className="primary-button" type="submit" disabled={saving || loading || libraryId.length === 0 || title.trim().length === 0 || body.trim().length === 0}><Save size={16} />{saving ? '保存中...' : '保存条目'}</button></div>
        </header>
        <div className="note-editor-workspace">
          <div className="note-editor-meta">
            <label><span>知识库</span><select disabled={loading || saving} value={libraryId} onChange={event => setLibraryId(event.target.value)}>{libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
            <label><span>标签</span><input disabled={saving} maxLength={340} value={tags} onChange={event => setTags(event.target.value)} placeholder="产品，规范" /></label>
          </div>
          <label className="note-title-field"><span className="visually-hidden">标题</span><input autoFocus disabled={saving} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="知识条目标题" /></label>
          <label className="note-body-field"><span className="visually-hidden">Markdown 正文</span><textarea disabled={saving} maxLength={200000} value={body} onChange={event => setBody(event.target.value)} placeholder="输入 Markdown 正文" /></label>
          {libraries.length === 0 && !loading && <div className="form-error" role="alert">请先创建知识库。</div>}
          {error !== undefined && <div className="form-error" role="alert">{error}</div>}
        </div>
      </form>
    )
  }

  function NoteCreateAction({ library }: LibraryActionProps): JSX.Element {
    return <button className="library-action-button" type="button" title={`在 ${library.name} 新建知识条目`} onClick={() => ctx.clientApp.selectPage('note-create', { libraryId: library.id })}><FilePlus2 size={15} /><span className="visually-hidden">新建知识条目</span></button>
  }

  ctx.effect(() => {
    const disposePage = ctx.clientApp.registerPage({ id: 'note-create', label: '新建知识条目', icon: FilePlus2, component: NoteCreatePage, order: 14, section: 'hidden' })
    const disposeAction = ctx.clientApp.registerLibraryAction({ id: 'note-create', component: NoteCreateAction, order: 5 })
    return () => {
      disposeAction()
      disposePage()
    }
  }, 'client-note-create: register page and library action')
}
