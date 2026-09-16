import { Context, Service } from '@deepseek-ai/cordis'
import type { CreateWikiIssueInput, UpdateWikiIssueInput } from '@tiggyknowledge/contracts'
import { HttpError, type HttpRouteDefinition } from '@tiggyknowledge/http-router'
import type {} from '@tiggyknowledge/wiki-governance'

export class WikiGovernanceApi extends Service {
  static inject = ['httpRouter', 'wikiGovernance']

  constructor(ctx: Context) {
    super(ctx, 'wikiGovernanceApi')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const disposers = ROUTES.map(route => this.ctx.httpRouter.register({
      ...route,
      handler: context => route.handler.call(this, context),
    }))
    yield () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }
}

type Route = Omit<HttpRouteDefinition, 'handler'> & {
  handler(this: WikiGovernanceApi, context: Parameters<HttpRouteDefinition['handler']>[0]): void | Promise<void>
}

const ROUTES: Route[] = [
  {
    id: 'wiki-governance:snapshot',
    methods: ['GET'],
    path: '/api/wiki/governance',
    handler({ json }) {
      json(this.ctx.wikiGovernance.snapshot())
    },
  },
  {
    id: 'wiki-governance:lint',
    methods: ['GET'],
    path: '/api/wiki/governance/lint',
    handler({ json }) {
      json(this.ctx.wikiGovernance.lint())
    },
  },
  {
    id: 'wiki-governance:issues',
    methods: ['GET', 'POST'],
    path: '/api/wiki/governance/issues',
    async handler({ method, assertSameOrigin, json, readJson, url }) {
      if (method === 'GET') {
        const status = url.searchParams.get('status')
        json(this.ctx.wikiGovernance.issues(status === 'open' || status === 'resolved' ? status : undefined))
        return
      }
      assertSameOrigin()
      try {
        json(this.ctx.wikiGovernance.createIssue(await readJson<CreateWikiIssueInput>()), 201)
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
        json(this.ctx.wikiGovernance.updateIssue(
          decodeURIComponent(match?.[1] ?? ''),
          await readJson<UpdateWikiIssueInput>(),
        ))
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
      json(this.ctx.wikiGovernance.archivedPages())
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
        json(this.ctx.wikiGovernance.restorePage(decodeURIComponent(match?.[1] ?? ''), input.expectedVersion))
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
        this.ctx.wikiGovernance.purgePage(decodeURIComponent(match?.[1] ?? ''))
        json({ ok: true })
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'wiki_trash_not_found', error.message)
        throw error
      }
    },
  },
]

export default WikiGovernanceApi
