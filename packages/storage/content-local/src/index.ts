import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeContent: ContentLocal
  }
}

export interface Config {
  dataDir: string
}

export interface StoredAsset {
  id: string
  contentHash: string
  sizeBytes: number
}

export class ContentLocal extends Service {
  private readonly assetRoot: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'knowledgeContent')
    this.assetRoot = resolve(config.dataDir, 'assets')
    mkdirSync(this.assetRoot, { recursive: true })
  }

  save(bytes: Uint8Array): StoredAsset {
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const directory = resolve(this.assetRoot, contentHash.slice(0, 2))
    const target = resolve(directory, contentHash)
    mkdirSync(directory, { recursive: true })
    if (!existsSync(target)) {
      const temporary = resolve(directory, `.${contentHash}.${randomUUID()}.tmp`)
      try {
        writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
        renameSync(temporary, target)
      } catch (error) {
        if (existsSync(temporary)) unlinkSync(temporary)
        throw error
      }
    }
    return { id: contentHash, contentHash, sizeBytes: bytes.byteLength }
  }

  read(id: string): Uint8Array {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('content-local: invalid asset id')
    const target = resolve(this.assetRoot, id.slice(0, 2), id)
    if (!existsSync(target)) throw new Error(`content-local: asset not found: ${id}`)
    return readFileSync(target)
  }
}

export default ContentLocal
