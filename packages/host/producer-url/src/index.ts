import { basename, extname } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/producer-text'
import { fetchPageText, hostnameTitle, parseShortcutUrl, type FetchedPage, type FetchPage } from './page.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    urlProducer: UrlProducer
  }
}

export interface Config {
  fetchPage?: FetchPage
}

export interface ExtractedUrl {
  url: string
  title: string
  body: string
}

export class UrlProducer extends Service {
  static inject = ['textProducer']

  private readonly fetchPage: FetchPage

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'urlProducer')
    this.fetchPage = config.fetchPage ?? fetchPageText
    ctx.effect(() => ctx.textProducer.register(['.url', '.webloc'], async (fileName, bytes) => {
      const extracted = await this.extract(fileName, bytes)
      return {
        title: extracted.title,
        body: extracted.body,
        sourceType: 'url',
      }
    }), 'producer-url: register')
  }

  fetch(url: string): Promise<FetchedPage> {
    return this.fetchPage(url)
  }

  async extract(fileName: string, bytes: Uint8Array): Promise<ExtractedUrl> {
    const url = parseShortcutUrl(fileName, bytes)
    const fallback = basename(fileName, extname(fileName)).replace(/-[a-f0-9]{8}$/i, '').trim() || hostnameTitle(url)
    try {
      const page = await this.fetchPage(url)
      return {
        url: page.url,
        title: page.title || fallback,
        body: composeUrlIndexBody(page.title || fallback, page.url, page.text),
      }
    } catch {
      return {
        url,
        title: fallback,
        body: url,
      }
    }
  }
}

export function composeUrlIndexBody(title: string, url: string, text: string): string {
  const body = text.trim()
  return body.length === 0 ? url : `${title}\n${url}\n\n${body}`.trim()
}

export {
  extractHtmlDocument,
  fetchPageText,
  hostnameTitle,
  internetShortcut,
  normalizePageUrl,
  parseShortcutUrl,
} from './page.ts'
export type { FetchPage, FetchedPage } from './page.ts'

export default UrlProducer
