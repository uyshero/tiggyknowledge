import type { Context } from '@deepseek-ai/cordis'
import { BookOpen, FileText, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type FormEvent, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { CatalogSummary, KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function apply(ctx: Context): void {
  function KnowledgePage(): JSX.Element {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const [catalog, setCatalog] = useState<CatalogSummary | undefined>()
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [favoriteCount, setFavoriteCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string>()
    const [createOpen, setCreateOpen] = useState(false)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [createError, setCreateError] = useState<string>()
    const [submitting, setSubmitting] = useState(false)
    const [libraryToDelete, setLibraryToDelete] = useState<KnowledgeLibrary>()
    const [deleteError, setDeleteError] = useState<string>()
    const [deleting, setDeleting] = useState(false)
    const [libraryToEdit, setLibraryToEdit] = useState<KnowledgeLibrary>()
    const [editName, setEditName] = useState('')
    const [editDescription, setEditDescription] = useState('')
    const [editError, setEditError] = useState<string>()
    const [editing, setEditing] = useState(false)
    const graphEnabled = app.pages.some(page => page.id === 'graph')

    useEffect(() => {
      const controller = new AbortController()
      void Promise.all([
        ctx.connection.system(controller.signal),
        ctx.connection.libraries(controller.signal),
        ctx.connection.favoriteDocuments(controller.signal),
      ]).then(([snapshot, items, favorites]) => {
        setCatalog(snapshot.catalog)
        setLibraries(items)
        setFavoriteCount(favorites.length)
        setLoadError(undefined)
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : '知识库加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [])

    useEffect(() => {
      if (!createOpen) return
      const closeOnEscape = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && !submitting) setCreateOpen(false)
      }
      window.addEventListener('keydown', closeOnEscape)
      return () => window.removeEventListener('keydown', closeOnEscape)
    }, [createOpen, submitting])

    useEffect(() => {
      if (libraryToDelete === undefined) return
      const closeOnEscape = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && !deleting) setLibraryToDelete(undefined)
      }
      window.addEventListener('keydown', closeOnEscape)
      return () => window.removeEventListener('keydown', closeOnEscape)
    }, [libraryToDelete, deleting])

    const openCreate = (): void => {
      setName('')
      setDescription('')
      setCreateError(undefined)
      setCreateOpen(true)
    }

    const submitCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (submitting) return
      setSubmitting(true)
      setCreateError(undefined)
      try {
        const created = await ctx.connection.createLibrary({ name, description })
        setLibraries(items => [created, ...items])
        setCatalog(value => value === undefined ? value : { ...value, libraries: value.libraries + 1 })
        setCreateOpen(false)
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : '创建知识库失败')
      } finally {
        setSubmitting(false)
      }
    }

    const requestDelete = (library: KnowledgeLibrary): void => {
      setDeleteError(undefined)
      setLibraryToDelete(library)
    }

    const requestEdit = (library: KnowledgeLibrary): void => {
      setLibraryToEdit(library)
      setEditName(library.name)
      setEditDescription(library.description)
      setEditError(undefined)
    }

    const submitEdit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (libraryToEdit === undefined || editing) return
      setEditing(true)
      setEditError(undefined)
      try {
        const updated = await ctx.connection.updateLibrary(libraryToEdit.id, { name: editName, description: editDescription })
        setLibraries(items => items.map(library => library.id === updated.id ? updated : library))
        setLibraryToEdit(undefined)
      } catch (error) {
        setEditError(error instanceof Error ? error.message : '保存知识库失败')
      } finally {
        setEditing(false)
      }
    }

    const confirmDelete = async (): Promise<void> => {
      if (libraryToDelete === undefined || deleting) return
      setDeleting(true)
      setDeleteError(undefined)
      try {
        const result = await ctx.connection.deleteLibrary(libraryToDelete.id)
        setLibraries(items => items.filter(library => library.id !== result.deletedLibraryId))
        setCatalog(value => value === undefined ? value : {
          ...value,
          libraries: Math.max(0, value.libraries - 1),
          documents: Math.max(0, value.documents - result.deletedDocumentIds.length),
        })
        setLibraryToDelete(undefined)
        void ctx.connection.favoriteDocuments().then(items => setFavoriteCount(items.length)).catch(() => {})
      } catch (error) {
        setDeleteError(error instanceof Error ? error.message : '删除知识库失败')
      } finally {
        setDeleting(false)
      }
    }

    return (
      <div className="page knowledge-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">本地空间</p>
            <h1>知识库</h1>
          </div>
          <div className="header-actions">
            <button className="icon-button" type="button" title="搜索" onClick={() => ctx.clientApp.selectPage('search')}><Search size={18} /></button>
            {graphEnabled && <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('graph')}>图谱</button>}
            <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('ingestion')}><Upload size={16} />批量上传</button>
            <button className="primary-button" type="button" onClick={openCreate}><Plus size={16} />新建知识库</button>
          </div>
        </header>
        <section className="summary-strip" aria-label="知识库摘要">
          <div><span>知识库</span><strong>{catalog?.libraries ?? 0}</strong></div>
          <div><span>知识条目</span><strong>{catalog?.documents ?? 0}</strong></div>
          <div><span>收藏</span><strong>{favoriteCount}</strong></div>
        </section>
        {loading ? (
          <div className="workspace-state">正在读取本地知识库...</div>
        ) : loadError !== undefined ? (
          <div className="workspace-state error-state">
            <strong>无法读取知识库</strong>
            <span>{loadError}</span>
          </div>
        ) : libraries.length === 0 ? (
          <section className="empty-workspace">
            <div className="empty-icon"><BookOpen size={24} /></div>
            <h2>还没有知识库</h2>
            <p>创建知识库后即可导入 Markdown、TXT 和文本型 PDF。</p>
            <div className="empty-actions">
              <button className="primary-button" type="button" onClick={openCreate}><Plus size={16} />新建知识库</button>
              <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('ingestion')}><FileText size={16} />导入文件</button>
            </div>
          </section>
        ) : (
          <section className="library-workspace" aria-labelledby="library-list-title">
            <div className="library-section-heading">
              <div>
                <h2 id="library-list-title">全部知识库</h2>
                <p>{libraries.length} 个本地知识库</p>
              </div>
            </div>
            <div className="library-table-wrap">
              <table className="library-table">
                <thead><tr><th>名称</th><th>知识条目</th><th>最近更新</th><th><span className="visually-hidden">操作</span></th></tr></thead>
                <tbody>
                  {libraries.map(library => (
                    <tr key={library.id}>
                      <td><button className="library-name-button" type="button" onClick={() => ctx.clientApp.selectPage('documents', { libraryId: library.id })}><strong>{library.name}</strong><span>{library.description || '暂无简介'}</span></button></td>
                      <td>{library.documentCount}</td>
                      <td><time dateTime={library.updatedAt}>{DATE_FORMATTER.format(new Date(library.updatedAt))}</time></td>
                      <td><div className="library-row-actions">{app.libraryActions.map(action => { const LibraryAction = action.component; return <LibraryAction library={library} key={action.id} /> })}<button className="library-action-button" type="button" title={`编辑知识库 ${library.name}`} onClick={() => requestEdit(library)}><Pencil size={15} /></button><button className="library-action-button" type="button" title={`删除知识库 ${library.name}`} onClick={() => requestDelete(library)}><Trash2 size={15} /></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {createOpen && (
          <div className="dialog-backdrop">
            <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="create-library-title">
              <form onSubmit={event => void submitCreate(event)}>
                <header className="dialog-header">
                  <div><p className="eyebrow">本地空间</p><h2 id="create-library-title">新建知识库</h2></div>
                  <button className="dialog-close" type="button" title="关闭" disabled={submitting} onClick={() => setCreateOpen(false)}><X size={18} /></button>
                </header>
                <div className="dialog-body">
                  <label className="form-field">
                    <span>名称</span>
                    <input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：产品与研发" />
                    <small>{name.length}/80</small>
                  </label>
                  <label className="form-field">
                    <span>简介</span>
                    <textarea maxLength={500} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="说明这个知识库收录的内容" />
                    <small>{description.length}/500</small>
                  </label>
                  {createError !== undefined && <div className="form-error" role="alert">{createError}</div>}
                </div>
                <footer className="dialog-footer">
                  <button className="secondary-button" type="button" disabled={submitting} onClick={() => setCreateOpen(false)}>取消</button>
                  <button className="primary-button" type="submit" disabled={submitting || name.trim().length === 0}><Plus size={16} />{submitting ? '创建中...' : '创建'}</button>
                </footer>
              </form>
            </section>
          </div>
        )}
        {libraryToEdit !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="edit-library-title">
              <form onSubmit={event => void submitEdit(event)}>
                <header className="dialog-header"><div><p className="eyebrow">知识库信息</p><h2 id="edit-library-title">编辑知识库</h2></div><button className="dialog-close" type="button" title="关闭" disabled={editing} onClick={() => setLibraryToEdit(undefined)}><X size={18} /></button></header>
                <div className="dialog-body">
                  <label className="form-field"><span>名称</span><input autoFocus required maxLength={80} value={editName} onChange={event => setEditName(event.target.value)} /><small>{editName.length}/80</small></label>
                  <label className="form-field"><span>简介</span><textarea maxLength={500} rows={4} value={editDescription} onChange={event => setEditDescription(event.target.value)} placeholder="说明这个知识库收录的内容" /><small>{editDescription.length}/500</small></label>
                  {editError !== undefined && <div className="form-error" role="alert">{editError}</div>}
                </div>
                <footer className="dialog-footer"><button className="secondary-button" type="button" disabled={editing} onClick={() => setLibraryToEdit(undefined)}>取消</button><button className="primary-button" type="submit" disabled={editing || editName.trim().length === 0}>{editing ? '保存中...' : '保存'}</button></footer>
              </form>
            </section>
          </div>
        )}
        {libraryToDelete !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-library-title">
              <header className="dialog-header">
                <div><p className="eyebrow">删除知识库</p><h2 id="delete-library-title">确认删除“{libraryToDelete.name}”？</h2></div>
                <button className="dialog-close" type="button" title="关闭" disabled={deleting} onClick={() => setLibraryToDelete(undefined)}><X size={18} /></button>
              </header>
              <div className="dialog-body">
                <p>知识库及其中 {libraryToDelete.documentCount} 个知识条目将从目录和全文索引中移除。原始内容资产暂由本地回收策略保留。</p>
                {deleteError !== undefined && <div className="form-error" role="alert">{deleteError}</div>}
              </div>
              <footer className="dialog-footer">
                <button className="secondary-button" type="button" disabled={deleting} onClick={() => setLibraryToDelete(undefined)}>取消</button>
                <button className="danger-button" type="button" disabled={deleting} onClick={() => void confirmDelete()}><Trash2 size={16} />{deleting ? '删除中...' : '删除知识库'}</button>
              </footer>
            </section>
          </div>
        )}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'knowledge',
    label: '知识库',
    icon: BookOpen,
    component: KnowledgePage,
    order: 10,
    section: 'primary',
  }), 'ui-knowledge: page')
}
