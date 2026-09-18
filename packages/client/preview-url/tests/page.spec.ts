import { describe, expect, it } from 'vitest'
import { documentTitleLooksLikeAddress, pageTextLooksUseful, pageTitleLooksUseful, shouldReplaceExtractedText } from '../src/index.tsx'

const article = 'https://blog.example.com/posts/vllm'

describe('generic webpage title and text adoption', () => {
  it('treats hostnames, urls, and challenge titles as placeholders', () => {
    expect(documentTitleLooksLikeAddress('blog.example.com', article)).toBe(true)
    expect(documentTitleLooksLikeAddress(article, article)).toBe(true)
    expect(documentTitleLooksLikeAddress('Security Verification', article)).toBe(true)
    expect(documentTitleLooksLikeAddress('微信公众平台', article)).toBe(true)
    expect(documentTitleLooksLikeAddress('如何部署推理服务', article)).toBe(false)
  })

  it('accepts real article titles from any site', () => {
    expect(pageTitleLooksUseful('如何用 vLLM 部署推理服务', article)).toBe(true)
    expect(pageTitleLooksUseful('AgentLoop 发布说明', 'https://mp.weixin.qq.com/s/abc')).toBe(true)
    expect(pageTitleLooksUseful('Just a moment...', article)).toBe(false)
    expect(pageTitleLooksUseful('blog.example.com', article)).toBe(false)
  })

  it('keeps challenge pages out of the knowledge index', () => {
    expect(pageTextLooksUseful('https://blog.example.com/posts/vllm', article)).toBe(false)
    expect(pageTextLooksUseful('请完成安全验证后继续访问', article)).toBe(false)
    expect(pageTextLooksUseful('vLLM 用 PagedAttention 提高吞吐，并说明安装步骤与参数调优。'.repeat(2), article)).toBe(true)
  })

  it('replaces a short first extract when the page later finishes loading', () => {
    const shell = '导航 登录 首页 关于'
    const body = '文章正文会在脚本执行后出现，这里有足够长度用于问答检索与摘要。'.repeat(3)
    expect(shouldReplaceExtractedText('', body)).toBe(true)
    expect(shouldReplaceExtractedText(shell, body)).toBe(true)
    expect(shouldReplaceExtractedText(body, body)).toBe(false)
  })
})
