import type {
  ConfirmWikiGenerationInput,
  RevertWikiPageInput,
  StartWikiGenerationInput,
  UnlockWikiPageInput,
  PublishWikiPageInput,
  UpdateWikiPageInput,
  WikiEstimate,
  WikiFolder,
  WikiGeneration,
  WikiInboxItem,
  WikiPage,
  WikiPageRevision,
  WikiPageSummary,
  WikiStatus,
} from '@tiggyknowledge/contracts'
import { HttpError, pathSegment, type HttpRouteDefinition } from '@tiggyknowledge/plugin-surface'

export interface WikiHttpHost {
  status(): WikiStatus
  estimate(mode: StartWikiGenerationInput['mode']): WikiEstimate
  start(input: StartWikiGenerationInput): WikiGeneration
  generation(id: string): WikiGeneration
  confirm(id: string, input: ConfirmWikiGenerationInput): WikiGeneration
  cancel(id: string): WikiGeneration
  skipDocument(documentId: string): WikiInboxItem[]
  unlockPage(id: string, expectedVersion: number): WikiPage
  publishPage(id: string, expectedVersion: number): WikiPage
  pages(): WikiPageSummary[]
  folders(): WikiFolder[]
  page(id: string): WikiPage
  updatePage(id: string, input: UpdateWikiPageInput): WikiPage
  revisions(id: string): WikiPageRevision[]
  revertPage(id: string, version: number, expectedVersion: number): WikiPage
}

export function wikiHttpRoutes(wiki: WikiHttpHost): HttpRouteDefinition[] {
  return [
    {
      id: 'wiki:status',
      methods: ['GET'],
      path: '/api/wiki/status',
      handler({ json }) {
        json(wiki.status())
      },
    },
    {
      id: 'wiki:estimate',
      methods: ['POST'],
      path: '/api/wiki/estimate',
      async handler({ assertSameOrigin, json, readJson }) {
        assertSameOrigin()
        const input = await readJson<StartWikiGenerationInput>()
        try {
          json(wiki.estimate(input.mode))
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(400, 'invalid_wiki_estimate', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki:start-generation',
      methods: ['POST'],
      path: '/api/wiki/generations',
      async handler({ assertSameOrigin, json, readJson }) {
        assertSameOrigin()
        const input = await readJson<StartWikiGenerationInput>()
        try {
          json(wiki.start(input), 202)
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(409, 'wiki_generation_rejected', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki:generation',
      methods: ['GET'],
      path: /^\/api\/wiki\/generations\/([^/]+)$/,
      handler({ json, match }) {
        try {
          json(wiki.generation(pathSegment(match)))
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(404, 'wiki_generation_not_found', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki:confirm-generation',
      methods: ['POST'],
      path: /^\/api\/wiki\/generations\/([^/]+)\/confirm$/,
      async handler({ assertSameOrigin, json, match, readJson }) {
        assertSameOrigin()
        const input = await readJson<ConfirmWikiGenerationInput>()
        try {
          json(wiki.confirm(pathSegment(match), input), 202)
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(409, 'wiki_generation_confirmation_rejected', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki:cancel-generation',
      methods: ['POST'],
      path: /^\/api\/wiki\/generations\/([^/]+)\/cancel$/,
      handler({ assertSameOrigin, json, match }) {
        assertSameOrigin()
        try {
          json(wiki.cancel(pathSegment(match)))
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(404, 'wiki_generation_not_found', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki:skip-inbox',
      methods: ['POST'],
      path: /^\/api\/wiki\/inbox\/([^/]+)\/skip$/,
      handler({ assertSameOrigin, json, match }) {
        assertSameOrigin()
        try {
          json(wiki.skipDocument(pathSegment(match)))
        } catch (error) {
          if (error instanceof RangeError) {
            throw new HttpError(error.message === '知识文档不存在' ? 404 : 400, 'wiki_inbox_rejected', error.message)
          }
          throw error
        }
      },
    },
    {
      id: 'wiki:unlock-page',
      methods: ['POST'],
      path: /^\/api\/wiki\/pages\/([^/]+)\/unlock$/,
      async handler({ assertSameOrigin, json, match, readJson }) {
        assertSameOrigin()
        const input = await readJson<UnlockWikiPageInput>()
        try {
          json(wiki.unlockPage(pathSegment(match), input.expectedVersion))
        } catch (error) {
          if (error instanceof RangeError) {
            const status = error.message === 'Wiki 页面不存在'
              ? 404
              : error.message.includes('已被其他操作更新') ? 409 : 400
            const code = status === 404 ? 'wiki_page_not_found' : status === 409 ? 'wiki_page_conflict' : 'invalid_wiki_page'
            throw new HttpError(status, code, error.message)
          }
          throw error
        }
      },
    },
    {
      id: 'wiki:publish-page',
      methods: ['POST'],
      path: /^\/api\/wiki\/pages\/([^/]+)\/publish$/,
      async handler({ assertSameOrigin, json, match, readJson }) {
        assertSameOrigin()
        const input = await readJson<PublishWikiPageInput>()
        try {
          json(wiki.publishPage(pathSegment(match), input.expectedVersion))
        } catch (error) {
          if (error instanceof RangeError) {
            const status = error.message === 'Wiki 页面不存在'
              ? 404
              : error.message.includes('已被其他操作更新') ? 409 : 400
            const code = status === 404 ? 'wiki_page_not_found' : status === 409 ? 'wiki_page_conflict' : 'invalid_wiki_page'
            throw new HttpError(status, code, error.message)
          }
          throw error
        }
      },
    },
    {
      id: 'wiki:pages',
      methods: ['GET'],
      path: '/api/wiki/pages',
      handler({ json }) {
        json(wiki.pages())
      },
    },
    {
      id: 'wiki:folders',
      methods: ['GET'],
      path: '/api/wiki/folders',
      handler({ json }) {
        json(wiki.folders())
      },
    },
    {
      id: 'wiki:page-revisions',
      methods: ['GET'],
      path: /^\/api\/wiki\/pages\/([^/]+)\/revisions$/,
      handler({ json, match }) {
        try {
          json(wiki.revisions(pathSegment(match)))
        } catch (error) {
          if (error instanceof RangeError) throw new HttpError(404, 'wiki_page_not_found', error.message)
          throw error
        }
      },
    },
    {
      id: 'wiki:page-revert',
      methods: ['POST'],
      path: /^\/api\/wiki\/pages\/([^/]+)\/revert$/,
      async handler({ assertSameOrigin, json, match, readJson }) {
        assertSameOrigin()
        const input = await readJson<RevertWikiPageInput>()
        try {
          json(wiki.revertPage(pathSegment(match), input.version, input.expectedVersion))
        } catch (error) {
          if (error instanceof RangeError) {
            const conflict = error.message.includes('已被其他操作更新')
            throw new HttpError(conflict ? 409 : 400, conflict ? 'wiki_page_conflict' : 'invalid_wiki_revision', error.message)
          }
          throw error
        }
      },
    },
    {
      id: 'wiki:page',
      methods: ['GET', 'PUT'],
      path: /^\/api\/wiki\/pages\/([^/]+)$/,
      async handler({ method, assertSameOrigin, json, match, readJson }) {
        const pageId = pathSegment(match)
        try {
          if (method === 'GET') {
            json(wiki.page(pageId))
            return
          }
          assertSameOrigin()
          const input = await readJson<UpdateWikiPageInput>()
          json(wiki.updatePage(pageId, input))
        } catch (error) {
          if (error instanceof RangeError) {
            const status = error.message === 'Wiki 页面不存在'
              ? 404
              : error.message.includes('已被其他操作更新') ? 409 : 400
            const code = status === 404 ? 'wiki_page_not_found' : status === 409 ? 'wiki_page_conflict' : 'invalid_wiki_page'
            throw new HttpError(status, code, error.message)
          }
          throw error
        }
      },
    },
  ]
}
