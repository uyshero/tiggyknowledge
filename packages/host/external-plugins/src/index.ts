import { readFileSync } from 'node:fs'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ExternalPluginRecord } from '@tiggyknowledge/contracts'
import { contributeSurface, HttpError } from '@tiggyknowledge/plugin-surface'
import { isPathInside } from './discover.ts'
import { sharedModuleSource } from './shims.ts'

export {
  assertNoBuiltinCollision,
  discoverExternalPlugins,
  externalPluginInsertPatch,
  pluginsRoot,
} from './discover.ts'
export { SHARED_MODULES } from './shims.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    builtinPluginIds?: ReadonlySet<string>
    externalPluginRegistry?: readonly ExternalPluginRecord[]
    externalPlugins: ExternalPlugins
  }
}

export class ExternalPlugins extends Service {
  constructor(ctx: Context) {
    super(ctx, 'externalPlugins')
    contributeSurface(ctx, {
      routes: [{
        id: 'external-plugins:shared',
        methods: ['GET'],
        path: /^\/ext\/shared\/([^/]+\.js)$/,
        handler: ({ match, response }) => {
          const filename = match?.[1] ?? ''
          const source = sharedModuleSource(filename)
          if (source === undefined) throw new HttpError(404, 'shared_module_not_found', '共享模块不存在')
          response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'text/javascript; charset=utf-8',
          })
          response.end(source)
        },
      }, {
        id: 'external-plugins:client',
        methods: ['GET'],
        path: /^\/ext\/plugins\/([^/]+)\/client\.js$/,
        handler: ({ match, response }) => {
          const id = match?.[1] ?? ''
          const plugin = (this.ctx.externalPluginRegistry ?? []).find(item => item.id === id)
          if (plugin?.clientFile === undefined) throw new HttpError(404, 'plugin_client_not_found', '第三方 Client 模块不存在')
          if (!isPathInside(plugin.directory, plugin.clientFile)) {
            throw new HttpError(404, 'plugin_client_not_found', '第三方 Client 模块不存在')
          }
          response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'text/javascript; charset=utf-8',
          })
          response.end(readFileSync(plugin.clientFile))
        },
      }],
    })
  }
}

export default ExternalPlugins
