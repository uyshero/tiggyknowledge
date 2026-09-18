import { Context } from '@deepseek-ai/cordis'
import TextProducer from '@tiggyknowledge/producer-text'
import { describe, expect, it } from 'vitest'
import UrlProducer, { extractHtmlDocument, normalizePageUrl, parseShortcutUrl } from '../src/index.ts'

describe('url producer plugin', () => {
  it('normalizes and parses saved website shortcuts', () => {
    expect(normalizePageUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(normalizePageUrl('example.com/a')).toBe('https://example.com/a')
    expect(() => normalizePageUrl('file:///etc/passwd')).toThrow('只支持')
    expect(parseShortcutUrl('page.url', new TextEncoder().encode('[InternetShortcut]\nURL=https://example.com/kb\n'))).toBe('https://example.com/kb')
    expect(parseShortcutUrl('page.webloc', new TextEncoder().encode('<plist><dict><key>URL</key><string>https://example.com/wiki</string></dict></plist>'))).toBe('https://example.com/wiki')
    expect(parseShortcutUrl('link.url', new TextEncoder().encode('https://example.com/only'))).toBe('https://example.com/only')
  })

  it('extracts visible text from a live HTML page', () => {
    const extracted = extractHtmlDocument('<html><head><title>产品手册</title><script>secret()</script></head><body><h1>安装</h1><p>把知识库放在本机。</p></body></html>', 'fallback')
    expect(extracted.title).toBe('产品手册')
    expect(extracted.text).toContain('安装')
    expect(extracted.text).toContain('把知识库放在本机。')
    expect(extracted.text).not.toContain('secret')
  })

  it('prefers WeChat article title over the generic platform title', () => {
    const extracted = extractHtmlDocument(
      '<html><head><title>微信公众平台</title><meta property="og:title" content="年度业绩解读"></head><body><h1 id="activity-name">年度业绩解读</h1><div id="js_content"><p>营收增长。</p></div><script>secret()</script></body></html>',
      'mp.weixin.qq.com',
    )
    expect(extracted.title).toBe('年度业绩解读')
    expect(extracted.text).toContain('营收增长')
    expect(extracted.text).not.toContain('secret')
  })

  it('falls back to the page heading when the title tag is missing', () => {
    const extracted = extractHtmlDocument(
      '<html><body><h1>如何用 vLLM 部署推理服务</h1><p>安装步骤。</p></body></html>',
      'blog.51cto.com',
    )
    expect(extracted.title).toBe('如何用 vLLM 部署推理服务')
    expect(extracted.text).toContain('安装步骤')
  })

  it('registers URL extraction without changing the text producer API', async () => {
    const ctx = new Context()
    await ctx.plugin(TextProducer)
    await ctx.plugin(UrlProducer, {
      fetchPage: async (url: string) => {
        if (url.includes('offline')) throw new Error('down')
        return {
          url,
          title: '实时页面',
          text: '页面正文',
          truncated: false,
        }
      },
    })
    try {
      await expect(ctx.textProducer.produce('guide.url', new TextEncoder().encode('[InternetShortcut]\nURL=https://example.com/guide\n'))).resolves.toEqual({
        title: '实时页面',
        body: '实时页面\nhttps://example.com/guide\n\n页面正文',
        sourceType: 'url',
      })
      await expect(ctx.urlProducer.extract('down.url', new TextEncoder().encode('https://example.com/offline'))).resolves.toMatchObject({
        url: 'https://example.com/offline',
        body: 'https://example.com/offline',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
