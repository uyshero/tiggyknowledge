import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/catalog-sqlite'
import type { OpenDataDirectoryResult } from '@tiggyknowledge/contracts'
import { contributeSurface, HttpError } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    storageManager: StorageManager
  }
}

const execFileAsync = promisify(execFile)

export class StorageManager extends Service {
  static inject = ['knowledgeCatalog']

  constructor(ctx: Context) {
    super(ctx, 'storageManager')
    contributeSurface(ctx, {
      clients: [{
        id: 'client-settings-storage',
        moduleName: '@tiggyknowledge/client-settings-storage',
        label: 'Storage Settings',
        description: 'Local storage settings panel',
      }],
      routes: [{
        id: 'storage:open-data-directory',
        methods: ['POST'],
        path: '/api/system/open-data-directory',
        handler: async ({ assertSameOrigin, json }) => {
          assertSameOrigin()
          try {
            json(await this.openDataDirectory())
          } catch (error) {
            if (error instanceof RangeError) throw new HttpError(404, 'data_directory_not_found', error.message)
            throw new HttpError(500, 'open_data_directory_failed', error instanceof Error ? error.message : '无法打开本地数据目录')
          }
        },
      }],
    })
  }

  async openDataDirectory(): Promise<OpenDataDirectoryResult> {
    const path = this.ctx.knowledgeCatalog.summary().dataDirectory
    if (!existsSync(path)) throw new RangeError('本地数据目录不存在')
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
    try {
      await execFileAsync(command, [path], { timeout: 5_000 })
    } catch {
      throw new Error('无法使用系统文件管理器打开数据目录')
    }
    return { path }
  }
}

export default StorageManager
