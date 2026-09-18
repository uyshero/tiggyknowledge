import type {
  CreateWikiIssueInput,
  UpdateWikiIssueInput,
  WikiGovernanceSnapshot,
  WikiIssue,
  WikiIssueStatus,
  WikiLintFinding,
  WikiPage,
  WikiPageSummary,
} from '@tiggyknowledge/contracts'
import { HttpError, pathSegment, type HttpRouteDefinition } from '@tiggyknowledge/plugin-surface'

export interface WikiGovernanceHttpHost {
  snapshot(): WikiGovernanceSnapshot
  lint(): WikiLintFinding[]
  issues(status?: WikiIssueStatus): WikiIssue[]
  createIssue(input: CreateWikiIssueInput): WikiIssue
  updateIssue(id: string, input: UpdateWikiIssueInput): WikiIssue
  archivedPages(): WikiPageSummary[]
  restorePage(pageId: string, expectedVersion: number): WikiPage
  purgePage(pageId: string): void
}

export function wikiGovernanceHttpRoutes(governance: WikiGovernanceHttpHost): HttpRouteDefinition[] {
  return [
    {
      id: 'wiki-governance:snapshot',
      methods: ['GET'],
      path: '/api/wiki/governance',
      handler({ json }) {
        json(governance.snapshot())
      },
    },
    {
      id: 'wiki-governance:lint',
      methods: ['GET'],
      path: '/api/wiki/governance/lint',
      handler({ json }) {
        json(governance.lint())
      },
    },
    {
      id: 'wiki-governance:issues',
      methods: ['GET', 'POST'],
      path: '/api/wiki/governance/issues',
      async handler({ method, assertSameOrigin, json, readJson, url }) {
        if (method === 'GET') {
          const status = url.searchParams.get('status')
          json(governance.issues(status === 'open' || status === 'resolved' ? status : undefined))
          return
        }
        assertSameOrigin()
        try {
          json(governance.createIssue(await readJson<CreateWikiIssueInput>()), 201)
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(400, 'invalid_wiki_issue', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki-governance:update-issue',
      methods: ['PUT'],
      path: /^\/api\/wiki\/governance\/issues\/([^/]+)$/,
      async handler({ assertSameOrigin, json, match, readJson }) {
        assertSameOrigin()
        try {
          json(governance.updateIssue(pathSegment(match), await readJson<UpdateWikiIssueInput>()))
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(404, 'wiki_issue_not_found', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki-governance:trash',
      methods: ['GET'],
      path: '/api/wiki/governance/trash',
      handler({ json }) {
        json(governance.archivedPages())
      },
    },
    {
      id: 'wiki-governance:restore',
      methods: ['POST'],
      path: /^\/api\/wiki\/governance\/trash\/([^/]+)\/restore$/,
      async handler({ assertSameOrigin, json, match, readJson }) {
        assertSameOrigin()
        const input = await readJson<{ expectedVersion: number }>()
        try {
          json(governance.restorePage(pathSegment(match), input.expectedVersion))
        } catch (error) {
          if (error instanceof RangeError) {
            const conflict = error.message.includes('已被其他操作更新')
            throw new HttpError(conflict ? 409 : 404, conflict ? 'wiki_page_conflict' : 'wiki_trash_not_found', error.message)
          }
          throw error
        }
      },
    },
    {
      id: 'wiki-governance:purge',
      methods: ['DELETE'],
      path: /^\/api\/wiki\/governance\/trash\/([^/]+)$/,
      handler({ assertSameOrigin, json, match }) {
        assertSameOrigin()
        try {
          governance.purgePage(pathSegment(match))
          json({ ok: true })
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(404, 'wiki_trash_not_found', error.message)
          throw error
        }
      },
    },
  ]
}
