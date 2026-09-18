import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-runtime'

export const inject = ['clientApp']

function CopyIcon({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function FileIcon({ size = 17 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

interface DuplicateDocument {
  id: string
  libraryId: string
  libraryName: string
  title: string
  originalName: string
  updatedAt: string
}

interface DuplicateGroup {
  contentHash: string
  sizeBytes: number
  documents: DuplicateDocument[]
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function apply(ctx: Context): void {
  function DuplicatesPage(): JSX.Element {
    const [groups, setGroups] = useState<DuplicateGroup[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>()

    useEffect(() => {
      const controller = new AbortController()
      void fetch('/api/ext/example-duplicates/groups', { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`无法读取重复条目（${String(response.status)}）`)
          return await response.json() as { groups?: DuplicateGroup[] }
        })
        .then(body => {
          setGroups(Array.isArray(body.groups) ? body.groups : [])
          setError(undefined)
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '重复条目加载失败')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
      return () => controller.abort()
    }, [])

    return (
      <div className="page metadata-page">
        <header className="page-header compact-header">
          <div><p className="eyebrow">第三方插件</p><h1>重复条目</h1></div>
          <span className="page-count">{groups.length} 组</span>
        </header>
        {loading ? <div className="metadata-empty">正在按内容哈希查找重复条目...</div> : error !== undefined ? <div className="metadata-empty error-state"><strong>无法读取重复条目</strong><span>{error}</span></div> : groups.length === 0 ? <div className="metadata-empty"><CopyIcon size={25} /><strong>没有重复条目</strong><span>导入相同文件后会按内容哈希归到同一组。</span></div> : <section className="favorite-document-list">{groups.map(group => <article key={group.contentHash}><div className="favorite-document-open" style={{ cursor: 'default' }}><CopyIcon size={17} /><span><strong>{group.documents.length} 条相同内容</strong><small>{formatBytes(group.sizeBytes)} · {group.contentHash.slice(0, 12)}</small></span></div>{group.documents.map(document => <button className="favorite-document-open" key={document.id} type="button" onClick={() => ctx.clientApp.selectPage('documents', { libraryId: document.libraryId, documentId: document.id })}><FileIcon /><span><strong>{document.title}</strong><small>{document.libraryName} · {document.originalName}</small></span></button>)}</article>)}</section>}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'example-duplicates',
    label: '重复条目',
    icon: CopyIcon,
    component: DuplicatesPage,
    order: 50,
    section: 'secondary',
  }), 'example-duplicates: page')
}
