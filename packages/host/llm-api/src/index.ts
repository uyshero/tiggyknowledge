import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ConfirmWikiGenerationInput,
  LlmIntegrationSettings,
  RevertWikiPageInput,
  SetLlmApiKeyInput,
  StartWikiGenerationInput,
  TestLlmConnectionInput,
  UpdateLlmIntegrationSettingsInput,
  UpdateWikiPageInput,
} from '@tiggyknowledge/contracts'
import { resolveLlmProviderModel } from '@tiggyknowledge/contracts'
import { HttpError, type HttpRouteDefinition } from '@tiggyknowledge/http-router'
import type {} from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-credentials'
import type {} from '@tiggyknowledge/llm-wiki'
import type {} from '@tiggyknowledge/settings-file'

export class LlmApi extends Service {
  static inject = ['httpRouter', 'llmClient', 'llmCredentials', 'llmWiki', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'llmApi')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const disposers = ROUTES.map(route => this.ctx.httpRouter.register({
      ...route,
      handler: context => route.handler.call(this, context),
    }))
    disposers.push(this.ctx.httpRouter.registerSnapshotContributor('llm-api', () => ({
      llm: this.llmSettings(),
    })))
    yield () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }

  llmSettings(): LlmIntegrationSettings {
    return this.ctx.settings.llmIntegration(providerId => this.ctx.llmCredentials.status(providerId))
  }
}

type Route = Omit<HttpRouteDefinition, 'handler'> & {
  handler(this: LlmApi, context: Parameters<HttpRouteDefinition['handler']>[0]): void | Promise<void>
}

const ROUTES: Route[] = [
  {
    id: 'llm-settings:update',
    methods: ['PUT'],
    path: '/api/settings/llm',
    async handler({ request: _request, assertSameOrigin, json, readJson }) {
      assertSameOrigin()
      const input = await readJson<UpdateLlmIntegrationSettingsInput>()
      try {
        this.ctx.settings.updateLlmIntegration(input)
        json(this.llmSettings())
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'invalid_llm_settings', error.message)
        throw error
      }
    },
  },
  {
    id: 'llm-settings:set-api-key',
    methods: ['PUT'],
    path: '/api/settings/llm/api-key',
    async handler({ assertSameOrigin, json, readJson }) {
      assertSameOrigin()
      const input = await readJson<SetLlmApiKeyInput>()
      try {
        this.ctx.llmCredentials.setApiKey(input.providerId, input.apiKey)
        json(this.llmSettings())
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'invalid_llm_api_key', error.message)
        throw error
      }
    },
  },
  {
    id: 'llm-settings:test',
    methods: ['POST'],
    path: '/api/settings/llm/test',
    async handler({ assertSameOrigin, json, readJson }) {
      assertSameOrigin()
      const input = await readJson<TestLlmConnectionInput>()
      const endpoint = resolveLlmProviderModel(this.llmSettings(), input.providerId, input.modelId)
      if (endpoint === undefined) throw new HttpError(400, 'invalid_llm_test', '请先保存提供方和要测试的模型')
      try {
        json(await this.ctx.llmClient.testConnection(endpoint))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'invalid_llm_test', error.message)
        throw error
      }
    },
  },
  {
    id: 'wiki:status',
    methods: ['GET'],
    path: '/api/wiki/status',
    handler({ json }) {
      json(this.ctx.llmWiki.status())
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
        json(this.ctx.llmWiki.estimate(input.mode))
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
        json(this.ctx.llmWiki.start(input), 202)
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
        json(this.ctx.llmWiki.generation(decodeURIComponent(match?.[1] ?? '')))
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
        json(this.ctx.llmWiki.confirm(decodeURIComponent(match?.[1] ?? ''), input), 202)
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
        json(this.ctx.llmWiki.cancel(decodeURIComponent(match?.[1] ?? '')))
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(404, 'wiki_generation_not_found', error.message)
        throw error
      }
    },
  },
  {
    id: 'wiki:pages',
    methods: ['GET'],
    path: '/api/wiki/pages',
    handler({ json }) {
      json(this.ctx.llmWiki.pages())
    },
  },
  {
    id: 'wiki:folders',
    methods: ['GET'],
    path: '/api/wiki/folders',
    handler({ json }) {
      json(this.ctx.llmWiki.folders())
    },
  },
  {
    id: 'wiki:page-revisions',
    methods: ['GET'],
    path: /^\/api\/wiki\/pages\/([^/]+)\/revisions$/,
    handler({ json, match }) {
      try {
        json(this.ctx.llmWiki.revisions(decodeURIComponent(match?.[1] ?? '')))
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
        json(this.ctx.llmWiki.revertPage(
          decodeURIComponent(match?.[1] ?? ''),
          input.version,
          input.expectedVersion,
        ))
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
      const pageId = decodeURIComponent(match?.[1] ?? '')
      try {
        if (method === 'GET') {
          json(this.ctx.llmWiki.page(pageId))
          return
        }
        assertSameOrigin()
        const input = await readJson<UpdateWikiPageInput>()
        json(this.ctx.llmWiki.updatePage(pageId, input))
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

export default LlmApi
