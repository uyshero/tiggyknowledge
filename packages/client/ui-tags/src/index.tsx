import type { Context } from '@deepseek-ai/cordis'
import { FileText, Pencil, Tag, X } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeDocumentWithMetadata, KnowledgeTag } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

function initialTagId(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const tagId = (value as Record<string, unknown>).tagId
  return typeof tagId === 'string' ? tagId : undefined
}

export function apply(ctx: Context): void {
  function TagsPage(): JSX.Element {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const [tags, setTags] = useState<KnowledgeTag[]>([])
    const [tagId, setTagId] = useState(initialTagId(app.pageState) ?? '')
    const [documents, setDocuments] = useState<KnowledgeDocumentWithMetadata[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>()
    const [renameDialogOpen, setRenameDialogOpen] = useState(false)
    const [renameInput, setRenameInput] = useState('')
    const [renameError, setRenameError] = useState<string>()
    const [renaming, setRenaming] = useState(false)

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.tags(controller.signal).then(items => {
        setTags(items)
        setTagId(value => items.some(tag => tag.id === value) ? value : items[0]?.id ?? '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '标签加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [])

    useEffect(() => {
      if (tagId.length === 0) {
        setDocuments([])
        return
      }
      const controller = new AbortController()
      setLoading(true)
      void ctx.connection.taggedDocuments(tagId, controller.signal).then(setDocuments).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '标签条目加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [tagId])

    const selectedTag = tags.find(tag => tag.id === tagId)

    const openRenameDialog = (): void => {
      if (selectedTag === undefined) return
      setRenameInput(selectedTag.name)
      setRenameError(undefined)
      setRenameDialogOpen(true)
    }

    const saveRename = async (): Promise<void> => {
      if (selectedTag === undefined || renaming) return
      const name = renameInput.trim()
      if (name.length === 0) {
        setRenameError('标签名称不能为空')
        return
      }
      setRenaming(true)
      setRenameError(undefined)
      try {
        const renamed = await ctx.connection.renameTag(selectedTag.id, { name })
        const nextTags = await ctx.connection.tags()
        setTags(nextTags)
        setTagId(value => nextTags.some(tag => tag.id === value) ? value : renamed.id)
        setRenameDialogOpen(false)
      } catch (reason) {
        setRenameError(reason instanceof Error ? reason.message : '标签重命名失败')
      } finally {
        setRenaming(false)
      }
    }

    return (
      <div className="page metadata-page">
        <header className="page-header compact-header"><div><p className="eyebrow">条目元数据</p><h1>全部标签</h1></div></header>
        {error !== undefined ? (
          <div className="workspace-state error-state"><strong>无法读取标签</strong><span>{error}</span></div>
        ) : tags.length === 0 && !loading ? (
          <div className="metadata-empty"><Tag size={25} /><strong>还没有标签</strong><span>打开知识条目后即可添加标签。</span></div>
        ) : (
          <div className="tags-workbench">
            <aside className="tag-list-pane">
              <div className="tag-list-title">标签</div>
              {tags.map(tag => <button className={tag.id === tagId ? 'active' : ''} key={tag.id} type="button" onClick={() => setTagId(tag.id)}><Tag size={15} /><span>{tag.name}</span><em>{tag.documentCount}</em></button>)}
            </aside>
            <section className="metadata-document-pane">
              <header className="tag-detail-header">
                <div><h2>{selectedTag?.name ?? '标签'}</h2><span>{documents.length} 个知识条目</span></div>
                <button className="icon-button" type="button" title="重命名标签" disabled={selectedTag === undefined} onClick={openRenameDialog}><Pencil size={15} /></button>
              </header>
              {loading ? <div className="metadata-empty">正在读取条目...</div> : documents.length === 0 ? <div className="metadata-empty"><FileText size={22} /><strong>这个标签下没有条目</strong></div> : <div className="metadata-document-list">{documents.map(item => <button key={item.document.id} type="button" onClick={() => ctx.clientApp.selectPage('documents', { libraryId: item.document.libraryId, documentId: item.document.id })}><FileText size={17} /><span><strong>{item.document.title}</strong><small>{item.libraryName} · {item.document.originalName}</small></span><div>{item.metadata.tags.map(tag => <em key={tag.id}>{tag.name}</em>)}</div></button>)}</div>}
            </section>
          </div>
        )}
        {renameDialogOpen && selectedTag !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel tag-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-tag-title">
              <header className="dialog-header"><div><p className="eyebrow">标签管理</p><h2 id="rename-tag-title">重命名标签</h2></div><button className="dialog-close" type="button" title="关闭" disabled={renaming} onClick={() => setRenameDialogOpen(false)}><X size={18} /></button></header>
              <div className="dialog-body">
                <label className="form-field"><span>标签名称</span><input autoFocus disabled={renaming} maxLength={32} value={renameInput} onChange={event => setRenameInput(event.target.value)} placeholder="输入新的标签名称" /></label>
                {renameError !== undefined && <div className="form-error" role="alert">{renameError}</div>}
                <p className="tag-dialog-hint">如果新名称已存在，系统会自动合并两个标签。</p>
              </div>
              <footer className="dialog-footer"><button className="secondary-button" type="button" disabled={renaming} onClick={() => setRenameDialogOpen(false)}>取消</button><button className="primary-button" type="button" disabled={renaming} onClick={() => void saveRename()}>{renaming ? '保存中...' : '保存'}</button></footer>
            </section>
          </div>
        )}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'tags',
    label: '全部标签',
    icon: Tag,
    component: TagsPage,
    order: 19,
    section: 'hidden',
  }), 'ui-tags: page')
}
