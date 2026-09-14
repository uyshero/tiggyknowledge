import type { Context } from '@deepseek-ai/cordis'
import { Clock3, FileText, Search, Star, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type FormEvent, type JSX, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeLibrary, KnowledgeSearchMode, KnowledgeSearchResponse, SemanticCapabilitySnapshot, SystemSnapshot } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

const SEARCH_HISTORY_KEY = 'tiggyknowledge.search.history'
const SEARCH_HISTORY_LIMIT = 8

function loadSearchHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const value = window.localStorage.getItem(SEARCH_HISTORY_KEY)
    const parsed = value === null ? [] : JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim().length > 0).slice(0, SEARCH_HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function highlightedSnippet(snippet: string): ReactNode[] {
  const parts = snippet.split(/(<\/?mark>)/i)
  let marked = false
  return parts.flatMap((part, index) => {
    if (/^<mark>$/i.test(part)) {
      marked = true
      return []
    }
    if (/^<\/mark>$/i.test(part)) {
      marked = false
      return []
    }
    if (part.length === 0) return []
    return [marked ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>]
  })
}

function canUseMode(mode: KnowledgeSearchMode, semantic: SemanticCapabilitySnapshot | undefined): boolean {
  if (mode === 'auto' || mode === 'keyword') return true
  return semantic?.enabledModes.includes(mode) === true
}

function modeLabel(mode: KnowledgeSearchMode): string {
  return { auto: '自动', keyword: '关键词', semantic: '语义', hybrid: '混合' }[mode]
}

export function apply(ctx: Context): void {
  function SearchPage(): JSX.Element {
    const requestRef = useRef<AbortController>()
    const [text, setText] = useState('')
    const [libraryId, setLibraryId] = useState('')
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [system, setSystem] = useState<SystemSnapshot>()
    const [mode, setMode] = useState<KnowledgeSearchMode>('auto')
    const [favoriteOnly, setFavoriteOnly] = useState(false)
    const [response, setResponse] = useState<KnowledgeSearchResponse>()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string>()
    const [history, setHistory] = useState<string[]>(() => loadSearchHistory())
    const semantic = system?.semanticSearch

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.libraries(controller.signal).then(setLibraries).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '知识库加载失败')
      })
      void ctx.connection.system(controller.signal).then(setSystem).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '系统能力加载失败')
      })
      return () => {
        controller.abort()
        requestRef.current?.abort()
      }
    }, [])

    useEffect(() => {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history))
      } catch {
        // ignore storage errors
      }
    }, [history])

    useEffect(() => {
      if (!canUseMode(mode, semantic)) setMode('auto')
    }, [mode, semantic])

    const executeSearch = async (query: string): Promise<void> => {
      if (query.length === 0 || loading) return
      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      setLoading(true)
      setError(undefined)
      try {
        const result = await ctx.connection.search({
          text: query,
          knowledgeBaseIds: libraryId.length === 0 ? [] : [libraryId],
          mode,
          topK: 20,
          favoriteOnly,
        }, controller.signal)
        setResponse(result)
        setHistory(current => [query, ...current.filter(item => item !== query)].slice(0, SEARCH_HISTORY_LIMIT))
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '搜索失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      await executeSearch(text.trim())
    }

    return (
      <div className="page search-page">
        <header className="page-header compact-header">
          <div>
            <p className="eyebrow">本地索引</p>
            <h1>搜索</h1>
          </div>
        </header>
        <div className="search-workspace">
          <form className="knowledge-search-bar" onSubmit={event => void submit(event)}>
            <label className="knowledge-search-input">
              <Search size={18} aria-hidden="true" />
              <span className="visually-hidden">搜索内容</span>
              <input
                autoFocus
                maxLength={200}
                placeholder="搜索知识库内容"
                value={text}
                onChange={event => setText(event.target.value)}
              />
            </label>
            <label className="knowledge-search-filter">
              <span className="visually-hidden">知识库</span>
              <select value={libraryId} onChange={event => setLibraryId(event.target.value)}>
                <option value="">全部知识库</option>
                {libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}
              </select>
            </label>
            <label className="knowledge-search-filter search-mode-filter">
              <span className="visually-hidden">检索模式</span>
              <select value={mode} onChange={event => setMode(event.target.value as KnowledgeSearchMode)}>
                <option value="auto">自动</option>
                <option value="keyword">关键词</option>
                <option value="semantic" disabled={!canUseMode('semantic', semantic)}>{canUseMode('semantic', semantic) ? '语义' : '语义（未安装）'}</option>
                <option value="hybrid" disabled={!canUseMode('hybrid', semantic)}>{canUseMode('hybrid', semantic) ? '混合' : '混合（未安装）'}</option>
              </select>
            </label>
            <label className="favorite-search-filter"><input type="checkbox" checked={favoriteOnly} onChange={event => setFavoriteOnly(event.target.checked)} /><Star size={15} />仅收藏</label>
              <button className="primary-button" type="submit" disabled={loading || text.trim().length === 0}>
                <Search size={16} />{loading ? '搜索中...' : '搜索'}
              </button>
          </form>

          {history.length > 0 && (
            <section className="search-history">
              <header><Clock3 size={14} /><span>最近搜索</span><button className="text-button" type="button" onClick={() => setHistory([])}><X size={13} />清空</button></header>
              <div className="search-history-list">{history.map(query => <button className="search-history-chip" type="button" key={query} onClick={() => { setText(query); void executeSearch(query) }}>{query}</button>)}</div>
            </section>
          )}

          {error !== undefined ? (
            <div className="search-state error-state" role="alert"><strong>无法完成搜索</strong><span>{error}</span></div>
          ) : response === undefined ? (
            <div className="search-state"><Search size={24} /><strong>输入关键词开始搜索</strong></div>
          ) : response.results.length === 0 ? (
            <div className="search-state"><FileText size={24} /><strong>没有找到相关内容</strong><span>可以尝试更换关键词或知识库范围。</span></div>
          ) : (
            <section className="search-results" aria-live="polite">
              <header><strong>{response.total} 条结果</strong><span>{modeLabel(response.mode)}检索</span></header>
              <div className="search-result-list">
                {response.results.map(result => (
                  <article className="search-result" key={`${result.documentId}:${result.chunkId}`}>
                    <div className="search-result-title">
                      <FileText size={16} />
                      <div><h2>{result.isFavorite && <Star className="favorite-inline-icon" size={13} fill="currentColor" />}{result.title}</h2><span>{result.originalName} · {result.location}</span></div>
                    </div>
                    <p>{highlightedSnippet(result.snippet)}</p>
                    {result.tags.length > 0 && <div className="search-result-tags">{result.tags.map(tag => <span key={tag.id}>{tag.name}</span>)}</div>}
                    <button className="search-result-open" type="button" onClick={() => ctx.clientApp.selectPage('documents', { libraryId: result.knowledgeBaseId, documentId: result.documentId, location: result.location, query: response.query })}>打开条目</button>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'search',
    label: '搜索',
    icon: Search,
    component: SearchPage,
    order: 15,
    section: 'primary',
  }), 'ui-search: page')
}
