import { Context, Service } from '@deepseek-ai/cordis'
import type {
  LlmIntegrationSettings,
  SetLlmApiKeyInput,
  TestLlmConnectionInput,
  UpdateLlmIntegrationSettingsInput,
} from '@tiggyknowledge/contracts'
import { resolveLlmProviderModel } from '@tiggyknowledge/contracts'
import type {} from '@tiggyknowledge/llm-client'
import type {} from '@tiggyknowledge/llm-credentials'
import { contributeSurface, HttpError } from '@tiggyknowledge/plugin-surface'
import type {} from '@tiggyknowledge/settings-file'

export class LlmApi extends Service {
  static inject = ['llmClient', 'llmCredentials', 'settings']

  constructor(ctx: Context) {
    super(ctx, 'llmApi')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-settings-llm',
        moduleName: '@tiggyknowledge/client-settings-llm',
        label: 'AI 模型',
        description: 'OpenAI 兼容模型配置',
      }],
      snapshot: { id: 'llm-api', contribute: () => ({ llm: this.llmSettings() }) },
      routes: [
        {
          id: 'llm-settings:update',
          methods: ['PUT'],
          path: '/api/settings/llm',
          handler: async ({ assertSameOrigin, json, readJson }) => {
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
          handler: async ({ assertSameOrigin, json, readJson }) => {
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
          handler: async ({ assertSameOrigin, json, readJson }) => {
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
      ],
    })
  }

  llmSettings(): LlmIntegrationSettings {
    return this.ctx.settings.llmIntegration(providerId => this.ctx.llmCredentials.status(providerId))
  }
}

export default LlmApi
