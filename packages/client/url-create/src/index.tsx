import type { Context } from '@deepseek-ai/cordis'
import { Link2, Save, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type FormEvent, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { LibraryActionProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

function tagNames(input: string): string[] {
  return input.split(/[,，\n]/).map(name => name.trim()).filter(Boolean)
}

export function apply(ctx: Context): void {
  let request: { libraryId: string } | undefined
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const getRequest = (): { libraryId: string } | undefined => request
  const open = (libraryId = ''): void => {
    request = { libraryId }
    for (const listener of listeners) listener()
  }
  const close = (): void => {
    request = undefined
    for (const listener of listeners) listener()
  }

  ctx.on('client/url-create/open', libraryId => open(libraryId ?? ''))

  function UrlCreateDialog(): JSX.Element | null {
    const current = useSyncExternalStore(subscribe, getRequest)
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [libraryId, setLibraryId] = useState('')
    const [url, setUrl] = useState('')
    const [title, setTitle] = useState('')
    const [tags, setTags] = useState('')
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string>()

    useEffect(() => {
      if (current === undefined) return
      setUrl('')
      setTitle('')
      setTags('')
      setError(undefined)
      setLibraryId(current.libraryId)
      const controller = new AbortController()
      setLoading(true)
      void ctx.connection.libraries(controller.signal).then(items => {
        setLibraries(items)
        setLibraryId(value => items.some(library => library.id === value) ? value : items[0]?.id ?? '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取知识库')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [current])

    useEffect(() => {
      if (current === undefined || saving) return
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') close()
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [current, saving])

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (saving || libraryId.length === 0) return
      setSaving(true)
      setError(undefined)
      try {
        const document = await ctx.connection.createUrl(libraryId, {
          url,
          tagNames: tagNames(tags),
          ...(title.trim().length === 0 ? {} : { title: title.trim() }),
        })
        close()
        ctx.clientApp.selectPage('documents', { libraryId: document.libraryId, documentId: document.id })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '网址条目创建失败')
      } finally {
        setSaving(false)
      }
    }

    if (current === undefined) return null

    return (
      <div className="dialog-backdrop">
        <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="create-url-title">
          <form onSubmit={event => void submit(event)}>
            <header className="dialog-header">
              <div>
                <p className="eyebrow">网址</p>
                <h2 id="create-url-title">添加网页</h2>
              </div>
              <button className="dialog-close" type="button" title="关闭" disabled={saving} onClick={close}><X size={18} /></button>
            </header>
            <div className="dialog-body">
              <label className="form-field">
                <span>知识库</span>
                <select disabled={loading || saving} value={libraryId} onChange={event => setLibraryId(event.target.value)}>
                  {libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>网址</span>
                <input autoFocus disabled={saving} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/docs" />
              </label>
              <label className="form-field">
                <span>标题（可选）</span>
                <input disabled={saving} maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="留空则使用页面标题" />
              </label>
              <label className="form-field">
                <span>标签</span>
                <input disabled={saving} maxLength={340} value={tags} onChange={event => setTags(event.target.value)} placeholder="产品，规范" />
              </label>
              <p className="url-create-hint">只保存网址。解析和预览都会实时加载页面，不存整页快照。</p>
              {libraries.length === 0 && !loading && <div className="form-error" role="alert">请先创建知识库。</div>}
              {error !== undefined && <div className="form-error" role="alert">{error}</div>}
            </div>
            <footer className="dialog-footer">
              <button className="secondary-button" type="button" disabled={saving} onClick={close}>取消</button>
              <button className="primary-button" type="submit" disabled={saving || loading || libraryId.length === 0 || url.trim().length === 0}>
                <Save size={16} />{saving ? '正在加载页面...' : '保存网址'}
              </button>
            </footer>
          </form>
        </section>
      </div>
    )
  }

  function UrlCreateAction({ library }: LibraryActionProps): JSX.Element {
    return <button className="library-action-button" type="button" title={`在 ${library.name} 添加网页`} onClick={() => open(library.id)}><Link2 size={15} /><span className="visually-hidden">添加网页</span></button>
  }

  ctx.effect(() => {
    const disposeOverlay = ctx.clientApp.registerAppOverlay({ id: 'url-create', component: UrlCreateDialog, order: 30 })
    const disposeAction = ctx.clientApp.registerLibraryAction({ id: 'url-create', component: UrlCreateAction, order: 6 })
    return () => {
      disposeAction()
      disposeOverlay()
      close()
    }
  }, 'client-url-create: register dialog and library action')
}
