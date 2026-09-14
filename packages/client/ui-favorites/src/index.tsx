import type { Context } from '@deepseek-ai/cordis'
import { FileText, Star } from 'lucide-react'
import { useEffect, useState, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeDocumentWithMetadata } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

export function apply(ctx: Context): void {
  function FavoritesPage(): JSX.Element {
    const [documents, setDocuments] = useState<KnowledgeDocumentWithMetadata[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>()

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.favoriteDocuments(controller.signal).then(setDocuments).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '收藏加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [])

    const removeFavorite = async (documentId: string): Promise<void> => {
      try {
        await ctx.connection.setDocumentFavorite(documentId, false)
        setDocuments(items => items.filter(item => item.document.id !== documentId))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '取消收藏失败')
      }
    }

    return (
      <div className="page metadata-page">
        <header className="page-header compact-header"><div><p className="eyebrow">本地空间</p><h1>收藏</h1></div><span className="page-count">{documents.length} 个条目</span></header>
        {loading ? <div className="metadata-empty">正在读取收藏...</div> : error !== undefined ? <div className="metadata-empty error-state"><strong>无法读取收藏</strong><span>{error}</span></div> : documents.length === 0 ? <div className="metadata-empty"><Star size={25} /><strong>还没有收藏</strong><span>在条目预览中点击星标即可收藏。</span></div> : <section className="favorite-document-list">{documents.map(item => <article key={item.document.id}><button className="favorite-document-open" type="button" onClick={() => ctx.clientApp.selectPage('documents', { libraryId: item.document.libraryId, documentId: item.document.id })}><FileText size={17} /><span><strong>{item.document.title}</strong><small>{item.libraryName} · {item.document.originalName}</small></span></button><div className="favorite-document-tags">{item.metadata.tags.map(tag => <button key={tag.id} type="button" onClick={() => ctx.clientApp.selectPage('tags', { tagId: tag.id })}>{tag.name}</button>)}</div><button className="icon-button favorite-active" type="button" title="取消收藏" onClick={() => void removeFavorite(item.document.id)}><Star size={16} fill="currentColor" /></button></article>)}</section>}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'favorites',
    label: '收藏',
    icon: Star,
    component: FavoritesPage,
    order: 17,
    section: 'primary',
  }), 'ui-favorites: page')
}
