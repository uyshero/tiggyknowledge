import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CreateWikiIssueInput,
  UpdateWikiIssueInput,
  WikiGovernanceSnapshot,
  WikiIssue,
  WikiIssueStatus,
  WikiIssueType,
  WikiLintFinding,
  WikiPage,
  WikiPageSummary,
} from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/wiki-sqlite'

declare module '@deepseek-ai/cordis' {
  interface Context {
    wikiGovernance: WikiGovernance
  }
}

export interface Config {
  dataDir: string
}

interface IssueRow {
  id: string
  page_id: string
  issue_type: WikiIssueType
  description: string
  status: WikiIssueStatus
  created_at: string
  updated_at: string
}

export class WikiGovernance extends Service {
  static inject = ['wikiStorage']

  private database: DatabaseSync | undefined
  private readonly databasePath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'wikiGovernance')
    this.databasePath = resolve(config.dataDir, 'wiki-governance.sqlite')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    mkdirSync(resolve(this.databasePath, '..'), { recursive: true })
    const database = this.database = new DatabaseSync(this.databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS wiki_issues (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS wiki_issues_status_updated
      ON wiki_issues(status, updated_at DESC);
    `)
    yield () => {
      database.close()
      this.database = undefined
    }
  }

  snapshot(): WikiGovernanceSnapshot {
    return {
      openIssues: this.issues('open').length,
      lintFindings: this.lint().length,
      archivedPages: this.ctx.wikiStorage.listArchivedPages().length,
    }
  }

  issues(status?: WikiIssueStatus): WikiIssue[] {
    const rows = (status === undefined
      ? this.requireDatabase().prepare('SELECT * FROM wiki_issues ORDER BY updated_at DESC').all()
      : this.requireDatabase().prepare('SELECT * FROM wiki_issues WHERE status = ? ORDER BY updated_at DESC').all(status)
    ) as unknown as IssueRow[]
    return rows.map(row => this.normalizeIssue(row))
  }

  createIssue(input: CreateWikiIssueInput): WikiIssue {
    const page = this.ctx.wikiStorage.getPage(input.pageId)
    if (page === undefined) throw new RangeError('Wiki 页面不存在')
    const type = issueType(input.type)
    const description = normalizedText(input.description, '问题说明', 1, 2_000)
    const now = new Date().toISOString()
    const row: IssueRow = {
      id: randomUUID(),
      page_id: page.id,
      issue_type: type,
      description,
      status: 'open',
      created_at: now,
      updated_at: now,
    }
    this.requireDatabase().prepare(`
      INSERT INTO wiki_issues(id, page_id, issue_type, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.page_id, row.issue_type, row.description, row.status, row.created_at, row.updated_at)
    return this.normalizeIssue(row)
  }

  updateIssue(id: string, input: UpdateWikiIssueInput): WikiIssue {
    const status = issueStatus(input.status)
    const now = new Date().toISOString()
    const result = this.requireDatabase().prepare(
      'UPDATE wiki_issues SET status = ?, updated_at = ? WHERE id = ?',
    ).run(status, now, id)
    if (result.changes !== 1) throw new RangeError('Wiki 问题不存在')
    const row = this.requireDatabase().prepare('SELECT * FROM wiki_issues WHERE id = ?').get(id) as unknown as IssueRow
    return this.normalizeIssue(row)
  }

  lint(): WikiLintFinding[] {
    const findings: WikiLintFinding[] = []
    const summaries = this.ctx.wikiStorage.listPages()
    const validSlugs = new Set(summaries.map(page => page.slug))
    for (const summary of summaries) {
      const page = this.ctx.wikiStorage.getPage(summary.id)
      if (page === undefined) continue
      if (page.state === 'source-missing' || page.sections.some(section => section.state === 'source-missing')) {
        findings.push(finding(page, 'source-missing', 'warning', '页面引用的部分源文档已被删除。'))
      }
      const bodyLength = page.sections.reduce((total, section) => total + section.body.trim().length, 0)
      if (bodyLength < 80) findings.push(finding(page, 'content-too-short', 'warning', '页面正文少于 80 个字符，可能缺少有效内容。'))
      if (page.summary.trim() === '') findings.push(finding(page, 'empty-summary', 'info', '页面缺少用于目录和检索的摘要。'))
      for (const slug of page.outLinks) {
        if (!validSlugs.has(slug)) {
          findings.push({
            id: `dead-link:${page.id}:${slug}`,
            pageId: page.id,
            pageTitle: page.title,
            type: 'dead-link',
            severity: 'warning',
            message: `页面链接指向不存在或已归档的词条：${slug}`,
          })
        }
      }
    }
    return findings
  }

  archivedPages(): WikiPageSummary[] {
    return this.ctx.wikiStorage.listArchivedPages()
  }

  restorePage(pageId: string, expectedVersion: number): WikiPage {
    return this.ctx.wikiStorage.restorePage(pageId, expectedVersion)
  }

  purgePage(pageId: string): void {
    this.ctx.wikiStorage.purgeArchivedPage(pageId)
    this.requireDatabase().prepare('DELETE FROM wiki_issues WHERE page_id = ?').run(pageId)
  }

  private normalizeIssue(row: IssueRow): WikiIssue {
    const page = this.ctx.wikiStorage.getPage(row.page_id)
    return {
      id: row.id,
      pageId: row.page_id,
      pageTitle: page?.title ?? '已删除页面',
      type: row.issue_type,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('wiki-governance: database is not initialized')
    return this.database
  }
}

function finding(
  page: WikiPage,
  type: WikiLintFinding['type'],
  severity: WikiLintFinding['severity'],
  message: string,
): WikiLintFinding {
  return { id: `${type}:${page.id}`, pageId: page.id, pageTitle: page.title, type, severity, message }
}

function issueType(value: WikiIssueType): WikiIssueType {
  if (value === 'contradictory-facts' || value === 'out-of-date' || value === 'mixed-entities'
    || value === 'source-missing' || value === 'other') return value
  throw new RangeError('Wiki 问题类型无效')
}

function issueStatus(value: WikiIssueStatus): WikiIssueStatus {
  if (value === 'open' || value === 'resolved') return value
  throw new RangeError('Wiki 问题状态无效')
}

function normalizedText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') throw new RangeError(`${label}必须是文本`)
  const result = value.trim()
  if (result.length < minimum || result.length > maximum) throw new RangeError(`${label}长度无效`)
  return result
}

export default WikiGovernance
