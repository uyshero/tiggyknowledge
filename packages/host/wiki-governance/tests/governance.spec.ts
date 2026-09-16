import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import WikiSqlite from '@tiggyknowledge/wiki-sqlite'
import WikiGovernance from '../src/index.ts'

describe('wiki-governance', () => {
  it('tracks personal issues and derives lint findings', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tiggyknowledge-governance-'))
    const ctx = new Context()
    try {
      const storage = await ctx.plugin(WikiSqlite, { dataDir })
      const governance = await ctx.plugin(WikiGovernance, { dataDir })
      ctx.wikiStorage.replaceWiki([{
        id: 'page-1',
        slug: 'concept/example',
        title: '示例',
        order: 0,
        sections: [{ id: 'section-1', title: '正文', body: '过短', order: 0, sources: [] }],
      }], [])

      const issue = ctx.wikiGovernance.createIssue({
        pageId: 'page-1',
        type: 'out-of-date',
        description: '需要核对最新资料',
      })
      expect(ctx.wikiGovernance.snapshot()).toMatchObject({ openIssues: 1, lintFindings: 2 })
      expect(ctx.wikiGovernance.updateIssue(issue.id, { status: 'resolved' })).toMatchObject({ status: 'resolved' })

      await governance.dispose()
      await storage.dispose()
    } finally {
      await ctx.fiber.dispose()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
