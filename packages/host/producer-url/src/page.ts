const MAX_HTML_BYTES = 1_500_000
const MAX_TEXT_CHARACTERS = 200_000
const FETCH_TIMEOUT_MS = 15_000

export interface FetchedPage {
  url: string
  title: string
  text: string
  truncated: boolean
}

export type FetchPage = (url: string) => Promise<FetchedPage>

export function normalizePageUrl(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new RangeError('网址不能为空')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`)
    } catch {
      throw new RangeError('网址格式不正确')
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RangeError('只支持 http 或 https 网址')
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new RangeError('网址不能包含用户名或密码')
  }
  parsed.hash = ''
  return parsed.href
}

export function parseShortcutUrl(fileName: string, bytes: Uint8Array): string {
  if (bytes.length >= 6 && bytes[0] === 0x62 && bytes[1] === 0x70 && bytes[2] === 0x6c && bytes[3] === 0x69 && bytes[4] === 0x73 && bytes[5] === 0x74) {
    throw new RangeError('暂不支持二进制 webloc，请改用 XML 格式或直接添加网址')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  } catch {
    throw new RangeError('网址文件不是有效的 UTF-8 文本')
  }
  if (text.length === 0) throw new RangeError('网址文件内容为空')
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.webloc')) {
    const match = text.match(/<key>\s*URL\s*<\/key>\s*<string>\s*([^<]+)\s*<\/string>/i)
    if (match?.[1] === undefined) throw new RangeError('webloc 中没有找到网址')
    return normalizePageUrl(decodeHtmlEntities(match[1]))
  }
  const shortcut = text.match(/^\s*URL\s*=\s*(.+)$/im)?.[1]?.trim()
  if (shortcut !== undefined) return normalizePageUrl(shortcut)
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('[') && !line.startsWith(';'))
  if (lines.length === 1) return normalizePageUrl(lines[0] ?? '')
  throw new RangeError('无法从文件中解析网址')
}

export function extractHtmlDocument(html: string, fallbackTitle: string): { title: string, text: string, truncated: boolean } {
  const titleTag = decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const ogTitle = decodeHtmlEntities(
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
    ?? '',
  ).replace(/\s+/g, ' ').trim()
  const twitterTitle = decodeHtmlEntities(
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i)?.[1]
    ?? '',
  ).replace(/\s+/g, ' ').trim()
  const weixinHeading = decodeHtmlEntities((html.match(/id=["']activity-name["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  const heading = decodeHtmlEntities((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  const genericWeixinTitle = titleTag === '微信公众平台' || titleTag === '微信公众号'
  const title = weixinHeading || ogTitle || twitterTitle || (genericWeixinTitle ? '' : titleTag) || heading || fallbackTitle
  const article = html.match(/id=["']js_content["'][^>]*>([\s\S]*?)$/i)?.[1] ?? html
  const withoutNoise = article
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeHtmlEntities(withoutNoise)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return {
    title,
    text: text.slice(0, MAX_TEXT_CHARACTERS),
    truncated: text.length > MAX_TEXT_CHARACTERS,
  }
}

export async function fetchPageText(url: string): Promise<FetchedPage> {
  const target = normalizePageUrl(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const weixin = /(?:^|\.)weixin\.qq\.com$/i.test(new URL(target).hostname)
    const response = await fetch(target, {
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        ...(weixin ? { referer: 'https://mp.weixin.qq.com/' } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`页面返回 ${response.status}`)
    const finalUrl = normalizePageUrl(response.url || target)
    const contentType = response.headers.get('content-type') ?? ''
    const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim() || 'utf-8'
    const bytes = new Uint8Array(await response.arrayBuffer())
    const truncatedBytes = bytes.byteLength > MAX_HTML_BYTES
    const slice = truncatedBytes ? bytes.subarray(0, MAX_HTML_BYTES) : bytes
    const decoded = decodeBytes(slice, charset)
    const fallback = hostnameTitle(finalUrl)
    if (/html|xhtml|xml|text\/plain|^$/i.test(contentType)) {
      const extracted = extractHtmlDocument(decoded, fallback)
      return {
        url: finalUrl,
        title: extracted.title,
        text: extracted.text,
        truncated: extracted.truncated || truncatedBytes,
      }
    }
    return {
      url: finalUrl,
      title: fallback,
      text: decoded.slice(0, MAX_TEXT_CHARACTERS),
      truncated: decoded.length > MAX_TEXT_CHARACTERS || truncatedBytes,
    }
  } catch (error) {
    if (error instanceof RangeError) throw error
    if (error instanceof Error && error.name === 'AbortError') throw new Error('页面加载超时')
    throw new Error(error instanceof Error ? `无法加载页面：${error.message}` : '无法加载页面')
  } finally {
    clearTimeout(timer)
  }
}

export function hostnameTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

export function internetShortcut(url: string): string {
  return `[InternetShortcut]\nURL=${normalizePageUrl(url)}\n`
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const normalized = charset.toLowerCase().replace(/[_-]/g, '')
  const label = normalized === 'gb2312' || normalized === 'gbk' || normalized === 'gb18030' ? 'gb18030' : 'utf-8'
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
}
