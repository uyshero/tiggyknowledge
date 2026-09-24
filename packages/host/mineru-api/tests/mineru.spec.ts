import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { __private } from '../src/index.ts'

describe('MinerU result parser', () => {
  it('maps provider page progress into the extraction stage', () => {
    expect(__private.mineruExtractionProgress(0, 20)).toBe(15)
    expect(__private.mineruExtractionProgress(10, 20)).toBe(50)
    expect(__private.mineruExtractionProgress(20, 20)).toBe(85)
  })

  it('groups content-list text by PDF page', () => {
    const pages = __private.pagesFromContentList(JSON.stringify([
      { page_idx: 0, type: 'text', text: '第一页正文' },
      { page_idx: 0, type: 'table', table_body: '| A | B |' },
      { page_idx: 1, type: 'equation', equation: 'E = mc^2' },
    ]))
    expect(pages).toEqual(['第一页正文\n\n| A | B |', 'E = mc^2'])
  })

  it('falls back to full Markdown when content-list is absent', () => {
    const bytes = zipSync({
      'result/full.md': strToU8('# 扫描结果\n\n正文'),
      'result/images/ignored.png': new Uint8Array([1, 2, 3]),
    })
    expect(__private.pagesFromZip(bytes)).toEqual(['# 扫描结果\n\n正文'])
  })
})
