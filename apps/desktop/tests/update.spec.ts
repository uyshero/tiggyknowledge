import { describe, expect, it } from 'vitest'
import { isNewerDesktopRelease, parseDesktopRelease } from '../src/update.ts'

describe('desktop release checks', () => {
  it('parses a trusted GitHub release', () => {
    expect(parseDesktopRelease({
      tag_name: 'v1.2.3',
      body: '  新增版本检查  ',
      html_url: 'https://github.com/uyshero/tiggyknowledge/releases/tag/v1.2.3',
    })).toEqual({
      version: '1.2.3',
      tagName: 'v1.2.3',
      releaseNotes: '新增版本检查',
      releaseUrl: 'https://github.com/uyshero/tiggyknowledge/releases/tag/v1.2.3',
    })
  })

  it('compares stable semantic versions', () => {
    const release = parseDesktopRelease({
      tag_name: 'v1.1.0',
      html_url: 'https://github.com/uyshero/tiggyknowledge/releases/tag/v1.1.0',
    })
    expect(isNewerDesktopRelease('1.0.9', release)).toBe(true)
    expect(isNewerDesktopRelease('1.1.0', release)).toBe(false)
    expect(isNewerDesktopRelease('2.0.0', release)).toBe(false)
  })

  it('rejects malformed versions and untrusted download pages', () => {
    expect(() => parseDesktopRelease({
      tag_name: 'latest',
      html_url: 'https://github.com/uyshero/tiggyknowledge/releases/latest',
    })).toThrow('版本号格式无效')
    expect(() => parseDesktopRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://example.com/TiggyKnowledge.exe',
    })).toThrow('下载地址无效')
  })
})
