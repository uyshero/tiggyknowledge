import type { Context } from '@deepseek-ai/cordis'
import { ExternalLink, RotateCw } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { DocumentPreviewRendererProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'

export const inject = ['clientApp', 'connection']

function pageUrl(preview: DocumentPreviewRendererProps['preview']): string | undefined {
  if (preview.sourceUrl !== undefined && preview.sourceUrl.length > 0) return preview.sourceUrl
  const original = preview.document.originalName.trim()
  try {
    const parsed = new URL(original)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href
  } catch {
    return undefined
  }
  return undefined
}

function isDesktopShell(): boolean {
  return /Electron\//.test(navigator.userAgent)
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

const GENERIC_PAGE_TITLES = /^(微信公众平台|微信公众号|安全验证|访问验证|请稍候|加载中|just a moment(\.\.\.)?|security verification|checking your browser|please wait|loading(\.\.\.)?)$/i

export function documentTitleLooksLikeAddress(title: string, url: string): boolean {
  const cleaned = title.replace(/\s+/g, ' ').trim().replace(/\/$/, '')
  if (cleaned.length === 0 || /^https?:\/\//i.test(cleaned) || GENERIC_PAGE_TITLES.test(cleaned)) return true
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./i, '')
    const lower = cleaned.toLowerCase()
    const noProto = url.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase()
    return lower === host.toLowerCase()
      || lower === parsed.hostname.toLowerCase()
      || lower === `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '').toLowerCase()
      || lower === noProto
  } catch {
    return false
  }
}

export function pageTitleLooksUseful(title: string, url: string): boolean {
  const cleaned = title.replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0 || cleaned.length > 200 || /^https?:\/\//i.test(cleaned)) return false
  if (GENERIC_PAGE_TITLES.test(cleaned)) return false
  const host = hostnameOf(url)
  return host.length === 0 || cleaned.toLowerCase() !== host.toLowerCase()
}

export function pageTextLooksUseful(text: string, url: string): boolean {
  const cleaned = text.replace(/\u00a0/g, ' ').trim()
  if (cleaned.length < 80) return false
  if (cleaned === url || (cleaned.startsWith(url) && cleaned.length < url.length + 40)) return false
  const lower = cleaned.toLocaleLowerCase()
  if (/(安全验证|访问验证|checking your browser|just a moment|enable javascript and cookies|please wait|security verification)/i.test(lower) && cleaned.length < 400) {
    return false
  }
  return true
}

export function shouldReplaceExtractedText(current: string, next: string): boolean {
  if (next.trim().length < 80) return false
  if (current.trim().length < 80) return true
  return next.length >= current.length + 200 || next.length >= Math.floor(current.length * 1.3)
}

const EXTRACT_PAGE_TEXT = `(() => {
  const reject = 'script,style,noscript,svg,nav,footer,header,aside,form,iframe,[role="navigation"],[role="banner"],[role="contentinfo"]'
  const nodes = [...document.querySelectorAll('article, main, [role="main"], [itemprop="articleBody"], #js_content, #content, .article-content, .post-content, .entry-content, .markdown-body, .blog-content, .blog-content-inner, .main-content, .rich_media_content')]
  if (nodes.length === 0 && document.body != null) nodes.push(document.body)
  const score = (node) => {
    const clone = node.cloneNode(true)
    clone.querySelectorAll(reject).forEach((item) => item.remove())
    const text = String(clone.innerText || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim()
    return { text, length: text.length }
  }
  const ranked = nodes.map(score).sort((left, right) => right.length - left.length)
  const best = ranked[0]
  const fallback = document.body == null ? { text: '', length: 0 } : score(document.body)
  const picked = best != null && best.length >= 80 ? best : fallback
  return picked.text.slice(0, 200000)
})()`

function chromeUserAgent(): string {
  const chrome = /Chrome\/[\d.]+/.exec(navigator.userAgent)?.[0] ?? 'Chrome/140.0.0.0'
  if (navigator.userAgent.includes('Windows')) {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`
  }
  if (navigator.userAgent.includes('Linux')) {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`
  }
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ${chrome} Safari/537.36`
}

function highlightedText(content: string, location: string | undefined, query: string | undefined): ReactNode[] {
  const offset = location === undefined ? 0 : Math.max(0, content.indexOf(location))
  const terms = query?.match(/\S+/g)?.filter(term => term.length > 0).toSorted((left, right) => right.length - left.length) ?? []
  const lower = content.toLocaleLowerCase('zh-CN')
  const term = terms.flatMap(term => {
    const normalized = term.toLocaleLowerCase('zh-CN')
    const local = lower.slice(offset, Math.min(content.length, offset + 2000)).indexOf(normalized)
    if (local >= 0) return [{ start: offset + local, end: offset + local + term.length }]
    const global = lower.indexOf(normalized)
    return global >= 0 ? [{ start: global, end: global + term.length }] : []
  })[0]
  const start = term?.start ?? (location === undefined ? -1 : content.indexOf(location))
  if (start < 0) return [content]
  const end = term?.end ?? start + (location?.length ?? 0)
  return [
    <Fragment key="before">{content.slice(0, start)}</Fragment>,
    <mark className="document-target-highlight" key="hit">{content.slice(start, end)}</mark>,
    <Fragment key="after">{content.slice(end)}</Fragment>,
  ]
}

function UrlPageFrame({ ctx, documentId, documentTitle, frameKey, onExtractedText, title, url }: { ctx: Context, documentId: string, documentTitle: string, frameKey: number, onExtractedText?: (text: string) => void, title: string, url: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const documentTitleRef = useRef(documentTitle)
  const adoptedTitleRef = useRef(false)
  const syncedTextRef = useRef('')
  const [failed, setFailed] = useState(false)
  const desktop = isDesktopShell()
  documentTitleRef.current = documentTitle

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    adoptedTitleRef.current = false
    syncedTextRef.current = ''
    setFailed(false)
    host.replaceChildren()

    if (desktop) {
      const view = document.createElement('webview') as HTMLElement & {
        executeJavaScript?: (code: string) => Promise<unknown>
        getTitle?: () => string
      }
      view.className = 'url-preview-frame'
      view.setAttribute('partition', 'persist:url-preview')
      view.setAttribute('allowpopups', 'true')
      view.setAttribute('useragent', chromeUserAgent())
      const adoptTitle = (raw: string): void => {
        if (adoptedTitleRef.current) return
        const nextTitle = raw.replace(/\s+/g, ' ').trim()
        if (!documentTitleLooksLikeAddress(documentTitleRef.current, url) || !pageTitleLooksUseful(nextTitle, url)) return
        adoptedTitleRef.current = true
        void ctx.connection.updateDocumentTitle(documentId, { title: nextTitle.slice(0, 200) }).then(document => {
          ctx.emit('client/document/updated', document)
        }).catch(() => {
          adoptedTitleRef.current = false
        })
      }
      const syncExtractedContent = async (): Promise<void> => {
        const pageTitle = typeof view.getTitle === 'function' ? view.getTitle() : ''
        adoptTitle(pageTitle)
        if (typeof view.executeJavaScript !== 'function') return
        const raw = await view.executeJavaScript(EXTRACT_PAGE_TEXT)
        const text = typeof raw === 'string' ? raw.replace(/\u00a0/g, ' ').trim() : ''
        if (!pageTextLooksUseful(text, url) || !shouldReplaceExtractedText(syncedTextRef.current, text)) return
        syncedTextRef.current = text
        onExtractedText?.(text)
        const nextTitle = pageTitle.replace(/\s+/g, ' ').trim()
        void ctx.connection.updateUrlExtractedContent(documentId, {
          text: text.slice(0, 200_000),
          ...(pageTitleLooksUseful(nextTitle, url) ? { title: nextTitle.slice(0, 200) } : {}),
        }).then(document => {
          ctx.emit('client/document/updated', document)
        }).catch(() => {
          if (syncedTextRef.current === text) syncedTextRef.current = ''
        })
      }
      const onFail = (event: Event): void => {
        const detail = event as Event & { errorCode?: number, isMainFrame?: boolean }
        if (detail.isMainFrame === false || detail.errorCode === -3) return
        setFailed(true)
      }
      const onTitle = (event: Event): void => {
        adoptTitle((event as Event & { title?: string }).title ?? '')
      }
      const onLoaded = (): void => {
        void syncExtractedContent().catch(() => {})
      }
      const retry = window.setTimeout(onLoaded, 1200)
      view.addEventListener('did-fail-load', onFail)
      view.addEventListener('page-title-updated', onTitle)
      view.addEventListener('dom-ready', onLoaded)
      view.addEventListener('did-stop-loading', onLoaded)
      host.append(view)
      view.setAttribute('src', url)
      return () => {
        window.clearTimeout(retry)
        view.removeEventListener('did-fail-load', onFail)
        view.removeEventListener('page-title-updated', onTitle)
        view.removeEventListener('dom-ready', onLoaded)
        view.removeEventListener('did-stop-loading', onLoaded)
        view.remove()
      }
    }

    const frame = document.createElement('iframe')
    frame.className = 'url-preview-frame'
    frame.referrerPolicy = 'no-referrer-when-downgrade'
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads')
    frame.src = url
    frame.title = title
    host.append(frame)
    return () => frame.remove()
  }, [ctx, desktop, documentId, frameKey, url])

  return (
    <div className="url-preview-stage">
      <div className="url-preview-host" ref={hostRef} />
      {failed && (
        <div className="url-preview-fallback">
          <strong>内置浏览器无法打开此页</strong>
          <a className="primary-button" href={url} rel="noreferrer" target="_blank"><ExternalLink size={15} />用系统浏览器打开</a>
        </div>
      )}
      {!desktop && (
        <p className="url-preview-hint">
          普通网页内嵌常被站点拦截。桌面版会用内置浏览器加载；也可
          <a href={url} rel="noreferrer" target="_blank">在系统浏览器打开</a>
          。
        </p>
      )}
    </div>
  )
}

function UrlDocumentPreview({ ctx, preview, targetLocation, targetQuery }: DocumentPreviewRendererProps & { ctx: Context }): JSX.Element {
  const url = useMemo(() => pageUrl(preview), [preview])
  const [mode, setMode] = useState<'page' | 'text'>('page')
  const [frameKey, setFrameKey] = useState(0)
  const [extractedText, setExtractedText] = useState<string>()
  const textContent = extractedText ?? preview.content

  useEffect(() => {
    setExtractedText(undefined)
  }, [preview.document.id, frameKey])

  return (
    <section className="url-preview" aria-label="网页预览">
      <div className="url-preview-toolbar">
        <div className="segmented pdf-preview-mode" aria-label="预览模式">
          <button className={mode === 'page' ? 'active' : ''} type="button" onClick={() => setMode('page')}>页面</button>
          <button className={mode === 'text' ? 'active' : ''} type="button" onClick={() => setMode('text')}>文本</button>
        </div>
        {url !== undefined && <code className="url-preview-address">{url}</code>}
        <div className="pdf-file-actions">
          <button type="button" title="重新加载页面" disabled={url === undefined} onClick={() => setFrameKey(value => value + 1)}><RotateCw size={16} /></button>
          {url !== undefined && <a href={url} rel="noreferrer" target="_blank" title="在系统浏览器打开"><ExternalLink size={16} /></a>}
        </div>
      </div>
      {mode === 'page' ? (
        url === undefined ? (
          <div className="url-preview-state error-state"><strong>没有可打开的网址</strong></div>
        ) : (
          <UrlPageFrame ctx={ctx} documentId={preview.document.id} documentTitle={preview.document.title} frameKey={frameKey} onExtractedText={setExtractedText} title={preview.document.title} url={url} />
        )
      ) : (
        <>
          <pre className="document-content pdf-text-content">{highlightedText(textContent, targetLocation, targetQuery)}</pre>
          {preview.truncated && <div className="preview-truncated">内容较大，仅显示当前实时解析的前 200,000 个字符。</div>}
        </>
      )}
    </section>
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.clientApp.registerDocumentPreviewRenderer({
    component: props => <UrlDocumentPreview ctx={ctx} {...props} />,
    format: 'url',
  }), 'client-preview-url: register renderer')
}
