import type { Context } from '@deepseek-ai/cordis'
import { ArrowLeft, BadgeInfo, FilePenLine, FileText, Search, Star, Tag, Trash2, Upload, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeDocument, KnowledgeDocumentMetadata, KnowledgeDocumentPreview, KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

interface DocumentPageState {
  libraryId?: string
  documentId?: string
  location?: string
  query?: string
}

type DocumentTypeFilter = 'all' | KnowledgeDocument['sourceType']
type DocumentSort = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'type-asc'

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function routeState(value: unknown): DocumentPageState {
  if (value === null || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  return {
    ...(typeof input.libraryId === 'string' ? { libraryId: input.libraryId } : {}),
    ...(typeof input.documentId === 'string' ? { documentId: input.documentId } : {}),
    ...(typeof input.location === 'string' ? { location: input.location } : {}),
    ...(typeof input.query === 'string' ? { query: input.query } : {}),
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatSourceType(sourceType: KnowledgeDocument['sourceType']): string {
  if (sourceType === 'markdown') return 'Markdown'
  if (sourceType === 'pdf') return 'PDF'
  return 'TXT'
}

function previewOffset(preview: KnowledgeDocumentPreview, location: string): number {
  if (preview.format === 'markdown') {
    const heading = location.split('/').at(-1)?.trim() ?? ''
    return heading.length === 0 ? 0 : Math.max(0, preview.content.indexOf(heading))
  }
  if (preview.format === 'pdf') return Math.max(0, preview.content.indexOf(location))
  const line = Number(location.match(/^第\s*(\d+)/)?.[1] ?? 1)
  if (!Number.isFinite(line) || line <= 1) return 0
  let offset = 0
  for (let current = 1; current < line; current += 1) {
    const next = preview.content.indexOf('\n', offset)
    if (next < 0) return offset
    offset = next + 1
  }
  return offset
}

function lineRange(content: string, location: string): { start: number, end: number } | undefined {
  const match = location.match(/^第\s*(\d+)(?:\s*-\s*(\d+))?\s*行/)
  if (match === null) return undefined
  const first = Number(match[1] ?? 1)
  const last = Number(match[2] ?? match[1] ?? 1)
  if (!Number.isInteger(first) || first < 1 || !Number.isInteger(last) || last < first) return undefined
  let start = 0
  for (let line = 1; line < first; line += 1) {
    const next = content.indexOf('\n', start)
    if (next < 0) return undefined
    start = next + 1
  }
  let end = start
  for (let line = first; line <= last; line += 1) {
    const next = content.indexOf('\n', end)
    if (next < 0) {
      end = content.length
      break
    }
    end = next + 1
  }
  return { start, end: Math.max(start, end) }
}

function findTermNear(content: string, query: string | undefined, offset: number): { start: number, end: number } | undefined {
  const terms = query?.match(/\S+/g)?.filter(term => term.length > 0).toSorted((left, right) => right.length - left.length) ?? []
  if (terms.length === 0) return undefined
  const lower = content.toLocaleLowerCase('zh-CN')
  const windowStart = Math.max(0, offset - 160)
  const windowEnd = Math.min(content.length, offset + 1600)
  const candidates = terms.flatMap(term => {
    const normalized = term.toLocaleLowerCase('zh-CN')
    const local = lower.slice(windowStart, windowEnd).indexOf(normalized)
    if (local >= 0) return [{ start: windowStart + local, end: windowStart + local + term.length }]
    const global = lower.indexOf(normalized)
    return global >= 0 ? [{ start: global, end: global + term.length }] : []
  })
  return candidates.toSorted((left, right) => Math.abs(left.start - offset) - Math.abs(right.start - offset))[0]
}

function previewHighlightRange(preview: KnowledgeDocumentPreview, location: string | undefined, query: string | undefined): { start: number, end: number } | undefined {
  const offset = location === undefined ? 0 : previewOffset(preview, location)
  const termRange = findTermNear(preview.content, query, offset)
  if (termRange !== undefined) return termRange
  if (location === undefined) return undefined
  const lines = lineRange(preview.content, location)
  if (lines !== undefined) return lines
  const marker = preview.format === 'markdown' ? location.split('/').at(-1)?.trim() ?? '' : location
  if (marker.length === 0) return undefined
  const start = preview.content.indexOf(marker, offset)
  if (start < 0) return undefined
  return { start, end: start + marker.length }
}

function isEditableMarkdownNote(document: KnowledgeDocument): boolean {
  return document.sourceType === 'markdown' && /-[a-f0-9]{8}\.md$/i.test(document.originalName)
}

function parseMarkdownNote(content: string): { title: string, body: string } {
  const normalized = content.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.startsWith('# ')) {
    const title = lines[0].slice(2).trim()
    if (lines[1]?.trim().length === 0) {
      return {
        title,
        body: lines.slice(2).join('\n').replace(/\s+$/u, ''),
      }
    }
  }
  return {
    title: '',
    body: normalized.replace(/\s+$/u, ''),
  }
}

function formatDocumentTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

function DocumentDetailsInspector({ documentId, document, metadata, preview }: { documentId: string, document?: KnowledgeDocument, metadata?: KnowledgeDocumentMetadata, preview?: KnowledgeDocumentPreview }): JSX.Element {
  const [localPreview, setLocalPreview] = useState<KnowledgeDocumentPreview | undefined>(preview)
  const [localMetadata, setLocalMetadata] = useState<KnowledgeDocumentMetadata | undefined>(metadata)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setLocalPreview(preview)
    setLocalMetadata(metadata)
    setError(undefined)
    return undefined
  }, [documentId, preview, metadata])

  const currentDocument = document ?? localPreview?.document
  const currentMetadata = localMetadata

  if (error !== undefined) {
    return <div className="document-detail-inspector error-state"><strong>无法读取条目详情</strong><span>{error}</span></div>
  }
  if (currentDocument === undefined) {
    return <div className="document-detail-inspector">正在读取条目详情...</div>
  }

  return (
    <section className="document-detail-inspector">
      <div className="document-detail-banner">
        <BadgeInfo size={18} />
        <div>
          <strong>条目详情</strong>
          <span>{formatSourceType(currentDocument.sourceType)} · {currentDocument.indexStatus === 'ready' ? '已索引' : currentDocument.indexStatus}</span>
        </div>
      </div>

      <div className="document-detail-grid">
        <section>
          <h3>基本信息</h3>
          <dl>
            <div><dt>标题</dt><dd>{currentDocument.title}</dd></div>
            <div><dt>原始文件</dt><dd>{currentDocument.originalName}</dd></div>
            <div><dt>知识库</dt><dd>{currentDocument.libraryId}</dd></div>
            <div><dt>来源类型</dt><dd>{formatSourceType(currentDocument.sourceType)}</dd></div>
          </dl>
        </section>
        <section>
          <h3>存储</h3>
          <dl>
            <div><dt>文件大小</dt><dd>{formatBytes(currentDocument.sizeBytes)}</dd></div>
            <div><dt>内容哈希</dt><dd title={currentDocument.contentHash}>{currentDocument.contentHash.slice(0, 12)}…{currentDocument.contentHash.slice(-8)}</dd></div>
            <div><dt>源资产</dt><dd title={currentDocument.sourceAssetId}>{currentDocument.sourceAssetId.slice(0, 12)}…{currentDocument.sourceAssetId.slice(-8)}</dd></div>
            <div><dt>创建时间</dt><dd>{formatDocumentTime(currentDocument.createdAt)}</dd></div>
            <div><dt>更新时间</dt><dd>{formatDocumentTime(currentDocument.updatedAt)}</dd></div>
          </dl>
        </section>
        <section>
          <h3>索引</h3>
          <dl>
            <div><dt>索引状态</dt><dd>{currentDocument.indexStatus}</dd></div>
            <div><dt>收藏</dt><dd>{currentMetadata?.isFavorite === true ? '已收藏' : '未收藏'}</dd></div>
            <div><dt>标签</dt><dd>{currentMetadata?.tags.length ? currentMetadata.tags.map(tag => tag.name).join('、') : '暂无标签'}</dd></div>
          </dl>
        </section>
        {localPreview?.pageCount !== undefined && (
          <section>
            <h3>预览</h3>
            <dl>
              <div><dt>页数</dt><dd>{localPreview.pageCount}</dd></div>
              <div><dt>预览格式</dt><dd>{localPreview.format}</dd></div>
              <div><dt>预览大小</dt><dd>{localPreview.truncated ? '已截断' : '完整'}</dd></div>
            </dl>
          </section>
        )}
      </div>
    </section>
  )
}

function highlightedPreview(preview: KnowledgeDocumentPreview, location: string | undefined, query: string | undefined): ReactNode[] {
  const range = previewHighlightRange(preview, location, query)
  if (range === undefined || range.end <= range.start) return [preview.content]
  return [
    <Fragment key="before">{preview.content.slice(0, range.start)}</Fragment>,
    <mark className="document-target-highlight" key="hit">{preview.content.slice(range.start, range.end)}</mark>,
    <Fragment key="after">{preview.content.slice(range.end)}</Fragment>,
  ]
}

export function apply(ctx: Context): void {
  function DocumentsPage(): JSX.Element {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const initial = routeState(app.pageState)
    const previewRef = useRef<HTMLPreElement>(null)
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [libraryId, setLibraryId] = useState(initial.libraryId ?? '')
    const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
    const [selectedDocumentId, setSelectedDocumentId] = useState(initial.documentId)
    const [targetLocation, setTargetLocation] = useState(initial.location)
    const [targetQuery, setTargetQuery] = useState(initial.query)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
    const [preview, setPreview] = useState<KnowledgeDocumentPreview>()
    const [metadata, setMetadata] = useState<KnowledgeDocumentMetadata>()
    const [loading, setLoading] = useState(true)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [error, setError] = useState<string>()
    const [previewError, setPreviewError] = useState<string>()
    const [confirmIds, setConfirmIds] = useState<string[]>()
    const [deleteError, setDeleteError] = useState<string>()
    const [deleting, setDeleting] = useState(false)
    const [tagDialogOpen, setTagDialogOpen] = useState(false)
    const [tagInput, setTagInput] = useState('')
    const [metadataSaving, setMetadataSaving] = useState(false)
    const [metadataError, setMetadataError] = useState<string>()
    const [documentQuery, setDocumentQuery] = useState('')
    const [typeFilter, setTypeFilter] = useState<DocumentTypeFilter>('all')
    const [sortBy, setSortBy] = useState<DocumentSort>('updated-desc')
    const [activeInspectorId, setActiveInspectorId] = useState<string>()
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editTitle, setEditTitle] = useState('')
    const [editBody, setEditBody] = useState('')
    const [editMarkdown, setEditMarkdown] = useState(false)
    const [editSaving, setEditSaving] = useState(false)
    const [editError, setEditError] = useState<string>()

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.libraries(controller.signal).then(items => {
        setLibraries(items)
        setLibraryId(value => value || items[0]?.id || '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '知识库加载失败')
      })
      return () => controller.abort()
    }, [])

    useEffect(() => {
      const next = routeState(app.pageState)
      if (next.libraryId !== undefined) setLibraryId(next.libraryId)
      if (next.documentId !== undefined) setSelectedDocumentId(next.documentId)
      if (next.location !== undefined) setTargetLocation(next.location)
      if (next.query !== undefined) setTargetQuery(next.query)
    }, [app.pageState])

    useEffect(() => {
      if (libraryId.length === 0) {
        setLoading(false)
        setDocuments([])
        return
      }
      const controller = new AbortController()
      setLoading(true)
      setError(undefined)
      void ctx.connection.documents(libraryId, controller.signal).then(result => {
        setDocuments(result.items)
        setSelectedDocumentId(value => value !== undefined && result.items.some(document => document.id === value) ? value : undefined)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '知识条目加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [libraryId])

    useEffect(() => {
      if (selectedDocumentId === undefined) {
        setPreview(undefined)
        setMetadata(undefined)
        setPreviewError(undefined)
        return
      }
      const controller = new AbortController()
      setPreviewLoading(true)
      setPreviewError(undefined)
      setMetadata(undefined)
      void Promise.all([
        ctx.connection.documentPreview(selectedDocumentId, controller.signal),
        ctx.connection.documentMetadata(selectedDocumentId, controller.signal),
      ]).then(([documentPreview, documentMetadata]) => {
        setPreview(documentPreview)
        setMetadata(documentMetadata)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setPreviewError(reason instanceof Error ? reason.message : '预览加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false)
      })
      return () => controller.abort()
    }, [selectedDocumentId])

    useEffect(() => {
      const element = previewRef.current
      if (element === null || preview === undefined || targetLocation === undefined) return
      const offset = previewOffset(preview, targetLocation)
      const ratio = preview.content.length === 0 ? 0 : offset / preview.content.length
      element.scrollTop = ratio * Math.max(0, element.scrollHeight - element.clientHeight)
    }, [preview, targetLocation])

    const selectLibrary = (id: string): void => {
      setLibraryId(id)
      setSelectedDocumentId(undefined)
      setTargetLocation(undefined)
      setTargetQuery(undefined)
      setSelectedIds(new Set())
    }

    const openDocument = (id: string): void => {
      setSelectedDocumentId(id)
      setTargetLocation(undefined)
      setTargetQuery(undefined)
      setActiveInspectorId(undefined)
      setEditDialogOpen(false)
    }

    const openEditDialog = (): void => {
      if (preview === undefined || selectedDocumentId === undefined) return
      const markdownEditable = isEditableMarkdownNote(preview.document)
      const parsed = markdownEditable ? parseMarkdownNote(preview.content) : undefined
      setEditMarkdown(markdownEditable)
      setEditTitle(preview.document.title)
      setEditBody(parsed?.body ?? '')
      setEditError(undefined)
      setEditDialogOpen(true)
    }

    const saveEdit = async (): Promise<void> => {
      if (selectedDocumentId === undefined || preview === undefined || editSaving) return
      const title = editTitle.trim()
      if (title.length === 0) {
        setEditError('标题不能为空')
        return
      }
      setEditSaving(true)
      setEditError(undefined)
      try {
        if (editMarkdown) {
          const body = editBody.trim()
          if (body.length === 0) {
            setEditError('正文不能为空')
            return
          }
          const updated = await ctx.connection.updateMarkdownNote(selectedDocumentId, { title, body, tagNames: [] })
          const [nextPreview, nextMetadata] = await Promise.all([
            ctx.connection.documentPreview(updated.id),
            ctx.connection.documentMetadata(updated.id),
          ])
          setDocuments(items => items.map(document => document.id === updated.id ? updated : document))
          setPreview(nextPreview)
          setMetadata(nextMetadata)
        } else {
          const updated = await ctx.connection.updateDocumentTitle(selectedDocumentId, { title })
          setDocuments(items => items.map(document => document.id === updated.id ? updated : document))
          setPreview(value => value === undefined ? value : { ...value, document: updated })
          setMetadata(await ctx.connection.documentMetadata(updated.id))
        }
        setTargetLocation(undefined)
        setTargetQuery(undefined)
        setActiveInspectorId(undefined)
        setEditDialogOpen(false)
      } catch (reason) {
        setEditError(reason instanceof Error ? reason.message : '更新失败')
      } finally {
        setEditSaving(false)
      }
    }

    const toggleDocument = (id: string): void => {
      setSelectedIds(value => {
        const next = new Set(value)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }

    const toggleAll = (): void => {
      setSelectedIds(value => {
        const next = new Set(value)
        const allVisibleSelected = visibleDocuments.length > 0 && visibleDocuments.every(document => next.has(document.id))
        for (const document of visibleDocuments) {
          if (allVisibleSelected) next.delete(document.id)
          else next.add(document.id)
        }
        return next
      })
    }

    const requestDelete = (ids: string[]): void => {
      setDeleteError(undefined)
      setConfirmIds(ids)
    }

    const confirmDelete = async (): Promise<void> => {
      if (confirmIds === undefined || deleting) return
      setDeleting(true)
      setDeleteError(undefined)
      try {
        const result = await ctx.connection.deleteDocuments(confirmIds)
        const deleted = new Set(result.deletedIds)
        setDocuments(items => items.filter(document => !deleted.has(document.id)))
        setSelectedIds(value => new Set([...value].filter(id => !deleted.has(id))))
        if (selectedDocumentId !== undefined && deleted.has(selectedDocumentId)) {
          setSelectedDocumentId(undefined)
          setTargetLocation(undefined)
          setTargetQuery(undefined)
          setPreview(undefined)
          setMetadata(undefined)
        }
        setLibraries(items => items.map(library => library.id === libraryId ? { ...library, documentCount: Math.max(0, library.documentCount - deleted.size) } : library))
        setConfirmIds(undefined)
      } catch (reason) {
        setDeleteError(reason instanceof Error ? reason.message : '删除失败')
      } finally {
        setDeleting(false)
      }
    }

    const toggleFavorite = async (): Promise<void> => {
      if (selectedDocumentId === undefined || metadata === undefined || metadataSaving) return
      setMetadataSaving(true)
      setMetadataError(undefined)
      try {
        setMetadata(await ctx.connection.setDocumentFavorite(selectedDocumentId, !metadata.isFavorite))
      } catch (reason) {
        setMetadataError(reason instanceof Error ? reason.message : '收藏操作失败')
      } finally {
        setMetadataSaving(false)
      }
    }

    const openTagDialog = (): void => {
      setTagInput(metadata?.tags.map(tag => tag.name).join('，') ?? '')
      setMetadataError(undefined)
      setTagDialogOpen(true)
    }

    const saveTags = async (): Promise<void> => {
      if (selectedDocumentId === undefined || metadataSaving) return
      const names = tagInput.split(/[,，\n]/).map(name => name.trim()).filter(Boolean)
      setMetadataSaving(true)
      setMetadataError(undefined)
      try {
        setMetadata(await ctx.connection.setDocumentTags(selectedDocumentId, names))
        setTagDialogOpen(false)
      } catch (reason) {
        setMetadataError(reason instanceof Error ? reason.message : '标签保存失败')
      } finally {
        setMetadataSaving(false)
      }
    }

    const selectedLibrary = libraries.find(library => library.id === libraryId)
    const visibleDocuments = useMemo(() => {
      const query = documentQuery.trim().toLocaleLowerCase('zh-CN')
      const filtered = documents.filter(document => {
        if (typeFilter !== 'all' && document.sourceType !== typeFilter) return false
        return query.length === 0 || document.title.toLocaleLowerCase('zh-CN').includes(query) || document.originalName.toLocaleLowerCase('zh-CN').includes(query)
      })
      return filtered.toSorted((left, right) => {
        if (sortBy === 'updated-desc') return right.updatedAt.localeCompare(left.updatedAt)
        if (sortBy === 'updated-asc') return left.updatedAt.localeCompare(right.updatedAt)
        if (sortBy === 'name-desc') return right.title.localeCompare(left.title, 'zh-CN')
        if (sortBy === 'type-asc') return formatSourceType(left.sourceType).localeCompare(formatSourceType(right.sourceType), 'zh-CN') || left.title.localeCompare(right.title, 'zh-CN')
        return left.title.localeCompare(right.title, 'zh-CN')
      })
    }, [documents, documentQuery, typeFilter, sortBy])
    const allSelected = visibleDocuments.length > 0 && visibleDocuments.every(document => selectedIds.has(document.id))
    const previewRenderer = preview === undefined ? undefined : ctx.clientApp.documentPreviewRenderer(preview.format)
    const PreviewRenderer = previewRenderer?.component
    const activeInspector = app.documentInspectors.find(inspector => inspector.id === activeInspectorId)
    const ActiveInspector = activeInspector?.component
    const graphEnabled = app.pages.some(page => page.id === 'graph')

    return (
      <div className="page documents-page">
        <header className="page-header compact-header documents-header">
          <div className="documents-title">
            <button className="icon-button" type="button" title="返回知识库" onClick={() => ctx.clientApp.selectPage('knowledge')}><ArrowLeft size={18} /></button>
            <div><p className="eyebrow">知识条目</p><h1>{selectedLibrary?.name ?? '全部条目'}</h1></div>
          </div>
          <div className="header-actions">
            {selectedIds.size > 0 && <button className="danger-button" type="button" onClick={() => requestDelete([...selectedIds])}><Trash2 size={16} />删除 {selectedIds.size} 项</button>}
            {graphEnabled && <button className="secondary-button" type="button" disabled={selectedDocumentId === undefined} onClick={() => ctx.clientApp.selectPage('graph', { libraryId, documentId: selectedDocumentId })}>图谱</button>}
            <button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('ingestion')}><Upload size={16} />继续导入</button>
          </div>
        </header>

        <div className="documents-toolbar">
          <label className="documents-library-select"><span>知识库</span><select value={libraryId} onChange={event => selectLibrary(event.target.value)}>{libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
          <div className="documents-view-controls">
            <label className="documents-query"><Search size={14} /><input aria-label="筛选条目名称" value={documentQuery} onChange={event => setDocumentQuery(event.target.value)} placeholder="筛选名称" /></label>
            <label><span className="visually-hidden">文件类型</span><select aria-label="文件类型" value={typeFilter} onChange={event => setTypeFilter(event.target.value as DocumentTypeFilter)}><option value="all">全部类型</option><option value="pdf">PDF</option><option value="markdown">Markdown</option><option value="text">TXT</option></select></label>
            <label><span className="visually-hidden">条目排序</span><select aria-label="条目排序" value={sortBy} onChange={event => setSortBy(event.target.value as DocumentSort)}><option value="updated-desc">最近更新</option><option value="updated-asc">最早更新</option><option value="name-asc">名称升序</option><option value="name-desc">名称降序</option><option value="type-asc">按类型</option></select></label>
            <span>{visibleDocuments.length === documents.length ? `${documents.length} 个条目` : `${visibleDocuments.length} / ${documents.length} 个条目`}</span>
          </div>
        </div>

        <div className="documents-workbench">
          <section className="document-list-pane" aria-label="知识条目列表">
            <div className="document-list-heading">
              <label><input type="checkbox" checked={allSelected} disabled={documents.length === 0} onChange={toggleAll} /><span>全选</span></label>
              <span>最近更新</span>
            </div>
            {loading ? (
              <div className="document-pane-state">正在读取知识条目...</div>
            ) : error !== undefined ? (
              <div className="document-pane-state error-state"><strong>无法读取知识条目</strong><span>{error}</span></div>
            ) : documents.length === 0 ? (
              <div className="document-pane-state"><FileText size={22} /><strong>知识库中还没有条目</strong><button className="secondary-button" type="button" onClick={() => ctx.clientApp.selectPage('ingestion')}>导入文件</button></div>
            ) : visibleDocuments.length === 0 ? (
              <div className="document-pane-state"><Search size={22} /><strong>没有符合条件的条目</strong><button className="secondary-button" type="button" onClick={() => { setDocumentQuery(''); setTypeFilter('all') }}>清除筛选</button></div>
            ) : (
              <div className="document-list">
                {visibleDocuments.map(document => (
                  <div className={`document-row ${selectedDocumentId === document.id ? 'active' : ''}`} key={document.id}>
                    <input type="checkbox" aria-label={`选择 ${document.title}`} checked={selectedIds.has(document.id)} onChange={() => toggleDocument(document.id)} />
                    <button className="document-open" type="button" onClick={() => openDocument(document.id)}>
                      <FileText size={16} />
                      <span><strong>{document.title}</strong><small>{document.originalName} · {formatBytes(document.sizeBytes)} · {DATE_FORMATTER.format(new Date(document.updatedAt))}</small></span>
                    </button>
                    <button className="document-delete" type="button" title="删除条目" onClick={() => requestDelete([document.id])}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="document-preview-pane" aria-label="条目预览">
            {selectedDocumentId === undefined ? (
              <div className="document-preview-empty"><FileText size={26} /><strong>选择条目查看内容</strong></div>
            ) : previewLoading ? (
              <div className="document-preview-empty">正在加载预览...</div>
            ) : previewError !== undefined ? (
              <div className="document-preview-empty error-state"><strong>无法预览</strong><span>{previewError}</span></div>
            ) : preview !== undefined ? (
              <>
                <header className="document-preview-header">
                  <div><h2>{preview.document.title}</h2><span>{preview.document.originalName} · {formatSourceType(preview.format)}{preview.pageCount === undefined ? '' : ` · ${preview.pageCount} 页`}{targetLocation === undefined ? '' : ` · ${targetLocation}`}</span></div>
                  <div className="preview-actions">
                    {app.documentInspectors.map(inspector => {
                      const InspectorIcon = inspector.icon
                      const active = inspector.id === activeInspectorId
                      return <button className={`icon-button ${active ? 'inspector-active' : ''}`} type="button" title={active ? '返回内容预览' : inspector.label} aria-pressed={active} key={inspector.id} onClick={() => setActiveInspectorId(active ? undefined : inspector.id)}><InspectorIcon size={16} /></button>
                    })}
                    <button className="icon-button" type="button" title={isEditableMarkdownNote(preview.document) ? '编辑笔记' : '重命名'} onClick={openEditDialog}><FilePenLine size={16} /></button>
                    <button className={`icon-button ${metadata?.isFavorite ? 'favorite-active' : ''}`} type="button" title={metadata?.isFavorite ? '取消收藏' : '收藏'} disabled={metadata === undefined || metadataSaving} onClick={() => void toggleFavorite()}><Star size={16} fill={metadata?.isFavorite ? 'currentColor' : 'none'} /></button>
                    <button className="icon-button" type="button" title="编辑标签" disabled={metadata === undefined} onClick={openTagDialog}><Tag size={16} /></button>
                    <button className="icon-button" type="button" title="删除条目" onClick={() => requestDelete([preview.document.id])}><Trash2 size={16} /></button>
                  </div>
                </header>
                <div className="document-metadata-bar">
                  <Tag size={14} />
                  {metadata?.tags.length ? metadata.tags.map(tag => <button key={tag.id} type="button" onClick={() => ctx.clientApp.selectPage('tags', { tagId: tag.id })}>{tag.name}</button>) : <span>暂无标签</span>}
                  <button className="metadata-edit-button" type="button" disabled={metadata === undefined} onClick={openTagDialog}>编辑</button>
                  {metadataError !== undefined && <em>{metadataError}</em>}
                </div>
                {ActiveInspector !== undefined ? (
                  <ActiveInspector
                    documentId={preview.document.id}
                    document={preview.document}
                    {...(metadata === undefined ? {} : { metadata })}
                    preview={preview}
                  />
                ) : PreviewRenderer === undefined ? (
                  <>
                    <pre className="document-content" ref={previewRef}>{highlightedPreview(preview, targetLocation, targetQuery)}</pre>
                    {preview.truncated && <div className="preview-truncated">内容较大，仅显示当前解析插件提取的前 200,000 个字符。</div>}
                  </>
                ) : (
                  <PreviewRenderer
                    contentUrl={ctx.connection.documentContentUrl(preview.document.id)}
                    preview={preview}
                    {...(targetLocation === undefined ? {} : { targetLocation })}
                    {...(targetQuery === undefined ? {} : { targetQuery })}
                  />
                )}
              </>
            ) : null}
          </section>
        </div>

        {confirmIds !== undefined && (
          <div className="dialog-backdrop">
            <section className="dialog-panel delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-documents-title">
              <header className="dialog-header"><div><p className="eyebrow">删除条目</p><h2 id="delete-documents-title">确认删除 {confirmIds.length} 个知识条目？</h2></div><button className="dialog-close" type="button" title="关闭" disabled={deleting} onClick={() => setConfirmIds(undefined)}><X size={18} /></button></header>
              <div className="dialog-body"><p>条目将从知识库和全文索引中移除，原始内容资产暂由本地回收策略保留。</p>{deleteError !== undefined && <div className="form-error" role="alert">{deleteError}</div>}</div>
              <footer className="dialog-footer"><button className="secondary-button" type="button" disabled={deleting} onClick={() => setConfirmIds(undefined)}>取消</button><button className="danger-button" type="button" disabled={deleting} onClick={() => void confirmDelete()}><Trash2 size={16} />{deleting ? '删除中...' : '删除'}</button></footer>
            </section>
          </div>
        )}

        {tagDialogOpen && (
          <div className="dialog-backdrop">
            <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="edit-tags-title">
              <header className="dialog-header"><div><p className="eyebrow">条目元数据</p><h2 id="edit-tags-title">编辑标签</h2></div><button className="dialog-close" type="button" title="关闭" disabled={metadataSaving} onClick={() => setTagDialogOpen(false)}><X size={18} /></button></header>
              <div className="dialog-body">
                <label className="form-field"><span>标签</span><textarea autoFocus rows={4} maxLength={340} value={tagInput} onChange={event => setTagInput(event.target.value)} placeholder="例如：产品，规范，研发" /></label>
                <p className="tag-dialog-hint">使用逗号或换行分隔，每个条目最多 10 个标签。</p>
                {metadataError !== undefined && <div className="form-error" role="alert">{metadataError}</div>}
              </div>
              <footer className="dialog-footer"><button className="secondary-button" type="button" disabled={metadataSaving} onClick={() => setTagDialogOpen(false)}>取消</button><button className="primary-button" type="button" disabled={metadataSaving} onClick={() => void saveTags()}>{metadataSaving ? '保存中...' : '保存标签'}</button></footer>
            </section>
          </div>
        )}

        {editDialogOpen && preview !== undefined && (
          <div className="dialog-backdrop">
            <section className={`dialog-panel document-edit-dialog ${editMarkdown ? 'markdown-editing' : 'rename-editing'}`} role="dialog" aria-modal="true" aria-labelledby="edit-document-title">
              <header className="dialog-header">
                <div>
                  <p className="eyebrow">{editMarkdown ? 'Markdown 笔记' : '重命名'}</p>
                  <h2 id="edit-document-title">{editMarkdown ? '编辑笔记' : '编辑标题'}</h2>
                </div>
                <button className="dialog-close" type="button" title="关闭" disabled={editSaving} onClick={() => setEditDialogOpen(false)}><X size={18} /></button>
              </header>
              <div className="dialog-body document-edit-body">
                <label className="form-field">
                  <span>标题</span>
                  <input autoFocus disabled={editSaving} maxLength={200} value={editTitle} onChange={event => setEditTitle(event.target.value)} placeholder="条目标题" />
                </label>
                {editMarkdown ? (
                  <label className="form-field">
                    <span>正文</span>
                    <textarea disabled={editSaving} maxLength={200000} rows={14} value={editBody} onChange={event => setEditBody(event.target.value)} placeholder="Markdown 正文" />
                  </label>
                ) : (
                  <div className="document-edit-hint">
                    <FilePenLine size={15} />
                    <span>当前条目仅支持重命名。Markdown 正文编辑仅对本地笔记启用。</span>
                  </div>
                )}
                {editError !== undefined && <div className="form-error" role="alert">{editError}</div>}
              </div>
              <footer className="dialog-footer">
                <button className="secondary-button" type="button" disabled={editSaving} onClick={() => setEditDialogOpen(false)}>取消</button>
                <button className="primary-button" type="button" disabled={editSaving} onClick={() => void saveEdit()}>{editSaving ? '保存中...' : '保存'}</button>
              </footer>
            </section>
          </div>
        )}
      </div>
    )
  }

  ctx.effect(() => {
    const disposeInspector = ctx.clientApp.registerDocumentInspector({
      id: 'details',
      label: '条目详情',
      icon: BadgeInfo,
      component: DocumentDetailsInspector,
      order: 10,
    })
    const disposePage = ctx.clientApp.registerPage({
      id: 'documents',
      label: '知识条目',
      icon: FileText,
      component: DocumentsPage,
      order: 12,
      section: 'hidden',
    })
    return () => {
      disposePage()
      disposeInspector()
    }
  }, 'ui-documents: page')
}
