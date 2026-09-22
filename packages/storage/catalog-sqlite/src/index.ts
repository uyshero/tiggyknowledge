import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CatalogSummary,
  CreateKnowledgeLibraryInput,
  IngestionBatchResult,
  KnowledgeDocument,
  KnowledgeDocumentIndexStatus,
  KnowledgeDocumentRevision,
  KnowledgeDocumentSourceType,
  KnowledgeLibrary,
  KnowledgeNoteImage,
  KnowledgeLibraryKind,
  KnowledgeLibraryList,
  UpdateKnowledgeLibraryInput,
} from '@tiggyknowledge/contracts'
import { contributeSurface, httpFromRange, pathSegment } from '@tiggyknowledge/plugin-surface'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeCatalog: CatalogSqlite
  }
}

export interface Config {
  dataDir: string
}

const SCHEMA_VERSION = 5
const STUDIO_LIBRARY_KEY = 'studio_library_id'
const STUDIO_CATEGORIES_KEY = 'studio_categories'
const DOCUMENT_COLUMNS = `id, library_id, title, original_name, source_type, source_asset_id,
        content_hash, size_bytes, index_status, extra_json, created_at, updated_at`

interface LibraryRow {
  id: string
  name: string
  description: string
  kind: KnowledgeLibraryKind
  document_count: number
  created_at: string
  updated_at: string
}

interface DocumentRow {
  id: string
  library_id: string
  title: string
  original_name: string
  source_type: KnowledgeDocumentSourceType
  source_asset_id: string
  content_hash: string
  size_bytes: number
  index_status: KnowledgeDocumentIndexStatus
  extra_json: string
  created_at: string
  updated_at: string
}

interface DocumentExtra {
  transcript?: string
  mimeType?: string
  category?: string
  images?: KnowledgeNoteImage[]
}

function normalizeKind(value: string | null | undefined): KnowledgeLibraryKind {
  return value === 'studio' ? 'studio' : 'knowledge'
}

function normalizeLibrary(row: LibraryRow): KnowledgeLibrary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: normalizeKind(row.kind),
    documentCount: row.document_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseExtra(raw: string | null | undefined): DocumentExtra {
  if (raw === undefined || raw === null || raw.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    const images = parseNoteImages(record.images)
    return {
      ...(typeof record.transcript === 'string' ? { transcript: record.transcript } : {}),
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
      ...(typeof record.category === 'string' ? { category: record.category } : {}),
      ...(images === undefined ? {} : { images }),
    }
  } catch {
    return {}
  }
}

function serializeExtra(extra: DocumentExtra): string {
  return JSON.stringify({
    ...(extra.transcript === undefined ? {} : { transcript: extra.transcript }),
    ...(extra.mimeType === undefined ? {} : { mimeType: extra.mimeType }),
    ...(extra.category === undefined ? {} : { category: extra.category }),
    ...(extra.images === undefined ? {} : { images: extra.images }),
  })
}

function extraFields(extra: DocumentExtra): Pick<KnowledgeDocument, 'transcript' | 'audioMimeType' | 'category' | 'images'> {
  return {
    ...(extra.transcript === undefined || extra.transcript.length === 0 ? {} : { transcript: extra.transcript }),
    ...(extra.mimeType === undefined || extra.mimeType.length === 0 ? {} : { audioMimeType: extra.mimeType }),
    ...(extra.category === undefined || extra.category.length === 0 ? {} : { category: extra.category }),
    ...(extra.images === undefined || extra.images.length === 0 ? {} : { images: extra.images }),
  }
}

function extraFromDocument(document: KnowledgeDocument): DocumentExtra {
  return {
    ...(document.transcript === undefined ? {} : { transcript: document.transcript }),
    ...(document.audioMimeType === undefined ? {} : { mimeType: document.audioMimeType }),
    ...(document.category === undefined ? {} : { category: document.category }),
    ...(document.images === undefined ? {} : { images: document.images }),
  }
}

function mergeExtra(current: KnowledgeDocument, patch?: DocumentExtra): DocumentExtra {
  const base = extraFromDocument(current)
  if (patch === undefined) return base
  return {
    ...base,
    ...(patch.transcript === undefined ? {} : { transcript: patch.transcript }),
    ...(patch.mimeType === undefined ? {} : { mimeType: patch.mimeType }),
    ...(patch.category === undefined ? {} : { category: patch.category }),
    ...(patch.images === undefined ? {} : { images: patch.images }),
  }
}

function parseNoteImages(value: unknown): KnowledgeNoteImage[] | undefined {
  if (!Array.isArray(value)) return undefined
  const images: KnowledgeNoteImage[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : ''
    const rawName = typeof record.name === 'string' ? record.name.trim() : ''
    if (!/^[a-f0-9]{64}$/.test(id) || seen.has(id) || !mimeType.startsWith('image/')) continue
    seen.add(id)
    images.push({ id, mimeType, name: (rawName.length === 0 ? '图片' : rawName).slice(0, 80) })
  }
  return images.length === 0 ? undefined : images
}

function normalizeDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    libraryId: row.library_id,
    title: row.title,
    originalName: row.original_name,
    sourceType: row.source_type,
    sourceAssetId: row.source_asset_id,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    indexStatus: row.index_status,
    ...extraFields(parseExtra(row.extra_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class CatalogSqlite extends Service {
  private database: DatabaseSync | undefined
  private readonly databasePath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'knowledgeCatalog')
    this.databasePath = resolve(config.dataDir, 'database.sqlite')
    contributeSurface(ctx, {
      snapshot: { id: 'catalog', contribute: () => ({ catalog: this.summary() }) },
      clients: [{
        id: 'client-ui-knowledge',
        moduleName: '@tiggyknowledge/client-ui-knowledge',
        label: 'Knowledge',
        description: 'Knowledge library workbench',
      }],
      routes: [
        {
          id: 'catalog:libraries',
          methods: ['GET', 'POST'],
          path: '/api/libraries',
          handler: async ({ method, assertSameOrigin, json, readJson }) => {
            if (method === 'GET') {
              const result: KnowledgeLibraryList = { items: this.listLibraries() }
              json(result)
              return
            }
            assertSameOrigin()
            try {
              json(this.createLibrary(await readJson<CreateKnowledgeLibraryInput>()), 201)
            } catch (error) {
              throw httpFromRange(error, 'invalid_library')
            }
          },
        },
        {
          id: 'catalog:update-library',
          methods: ['PUT'],
          path: /^\/api\/libraries\/([^/]+)$/,
          handler: async ({ assertSameOrigin, json, match, readJson }) => {
            assertSameOrigin()
            try {
              json(this.updateLibrary(pathSegment(match), await readJson<UpdateKnowledgeLibraryInput>()))
            } catch (error) {
              throw httpFromRange(error, 'invalid_library')
            }
          },
        },
      ],
    })
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    mkdirSync(resolve(this.databasePath, '..'), { recursive: true })
    const database = this.database = new DatabaseSync(this.databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'local',
        principal_id TEXT NOT NULL DEFAULT 'local-user',
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        original_name TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL,
        source_asset_id TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        index_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_assets (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL UNIQUE,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ingestion_jobs (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        total_files INTEGER NOT NULL,
        imported_files INTEGER NOT NULL DEFAULT 0,
        duplicate_files INTEGER NOT NULL DEFAULT 0,
        failed_files INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
        document_id UNINDEXED,
        title,
        body,
        tokenize = 'unicode61'
      );
    `)
    const columns = new Set((database.prepare('PRAGMA table_info(libraries)').all() as { name: string }[]).map(column => column.name))
    if (!columns.has('tenant_id')) database.exec("ALTER TABLE libraries ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'local'")
    if (!columns.has('principal_id')) database.exec("ALTER TABLE libraries ADD COLUMN principal_id TEXT NOT NULL DEFAULT 'local-user'")
    if (!columns.has('description')) database.exec("ALTER TABLE libraries ADD COLUMN description TEXT NOT NULL DEFAULT ''")
    if (!columns.has('kind')) database.exec("ALTER TABLE libraries ADD COLUMN kind TEXT NOT NULL DEFAULT 'knowledge'")
    const documentColumns = new Set((database.prepare('PRAGMA table_info(documents)').all() as { name: string }[]).map(column => column.name))
    if (!documentColumns.has('original_name')) database.exec("ALTER TABLE documents ADD COLUMN original_name TEXT NOT NULL DEFAULT ''")
    if (!documentColumns.has('source_asset_id')) database.exec("ALTER TABLE documents ADD COLUMN source_asset_id TEXT NOT NULL DEFAULT ''")
    if (!documentColumns.has('content_hash')) database.exec("ALTER TABLE documents ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''")
    if (!documentColumns.has('size_bytes')) database.exec('ALTER TABLE documents ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0')
    if (!documentColumns.has('index_status')) database.exec("ALTER TABLE documents ADD COLUMN index_status TEXT NOT NULL DEFAULT 'pending'")
    if (!documentColumns.has('extra_json')) database.exec("ALTER TABLE documents ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}'")
    database.exec(`
      CREATE TABLE IF NOT EXISTS document_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_asset_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(document_id, version)
      );
      CREATE INDEX IF NOT EXISTS document_revisions_document ON document_revisions(document_id, version DESC);
    `)
    database.exec('CREATE INDEX IF NOT EXISTS documents_library_hash ON documents(library_id, content_hash)')
    database.prepare(`
      INSERT INTO metadata(key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(SCHEMA_VERSION))
    this.ensureStudioLibrary()
    yield () => {
      database.close()
      this.database = undefined
    }
  }

  summary(): CatalogSummary {
    const database = this.database
    if (database === undefined) throw new Error('catalog-sqlite: database is not initialized')
    const libraries = database.prepare("SELECT count(*) AS count FROM libraries WHERE kind = 'knowledge'").get() as { count: number }
    const documents = database.prepare(`
      SELECT count(*) AS count
      FROM documents
      INNER JOIN libraries ON libraries.id = documents.library_id
      WHERE libraries.kind = 'knowledge'
    `).get() as { count: number }
    return {
      dataDirectory: dirname(this.databasePath),
      databasePath: this.databasePath,
      schemaVersion: SCHEMA_VERSION,
      libraries: libraries.count,
      documents: documents.count,
    }
  }

  listLibraries(): KnowledgeLibrary[] {
    return this.queryLibraries("libraries.tenant_id = 'local' AND libraries.principal_id = 'local-user' AND libraries.kind = 'knowledge'")
  }

  createLibrary(input: CreateKnowledgeLibraryInput): KnowledgeLibrary {
    const database = this.requireDatabase()
    const name = input.name.trim()
    const description = input.description?.trim() ?? ''
    if (name.length === 0 || name.length > 80) throw new RangeError('知识库名称长度应为 1 到 80 个字符')
    if (description.length > 500) throw new RangeError('知识库简介不能超过 500 个字符')

    const id = randomUUID()
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO libraries(id, tenant_id, principal_id, name, description, kind, created_at, updated_at)
      VALUES (?, 'local', 'local-user', ?, ?, 'knowledge', ?, ?)
    `).run(id, name, description, now, now)
    return {
      id,
      name,
      description,
      kind: 'knowledge',
      documentCount: 0,
      createdAt: now,
      updatedAt: now,
    }
  }

  getLibrary(id: string): KnowledgeLibrary | undefined {
    return this.queryLibraries('libraries.id = ?', [id])[0]
  }

  ensureStudioLibrary(): KnowledgeLibrary {
    const database = this.requireDatabase()
    const stored = database.prepare('SELECT value FROM metadata WHERE key = ?').get(STUDIO_LIBRARY_KEY) as { value: string } | undefined
    const storedLibrary = stored === undefined ? undefined : this.getLibrary(stored.value)
    if (storedLibrary?.kind === 'studio') return storedLibrary
    const existing = this.queryLibraries("libraries.kind = 'studio'")[0]
    if (existing !== undefined) {
      this.setMetadata(STUDIO_LIBRARY_KEY, existing.id)
      return existing
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO libraries(id, tenant_id, principal_id, name, description, kind, created_at, updated_at)
      VALUES (?, 'local', 'local-user', ?, ?, 'studio', ?, ?)
    `).run(id, '创作草稿', '不属于知识库的草稿与录音，转存后才会进入 Wiki 与检索。', now, now)
    this.setMetadata(STUDIO_LIBRARY_KEY, id)
    return this.getLibrary(id) ?? {
      id,
      name: '创作草稿',
      description: '不属于知识库的草稿与录音，转存后才会进入 Wiki 与检索。',
      kind: 'studio',
      documentCount: 0,
      createdAt: now,
      updatedAt: now,
    }
  }

  listStudioCategories(): string[] {
    const row = this.requireDatabase().prepare('SELECT value FROM metadata WHERE key = ?').get(STUDIO_CATEGORIES_KEY) as { value: string } | undefined
    if (row === undefined) return []
    try {
      const parsed = JSON.parse(row.value) as unknown
      if (!Array.isArray(parsed)) return []
      const names: string[] = []
      const seen = new Set<string>()
      for (const value of parsed) {
        if (typeof value !== 'string') continue
        const name = value.trim()
        if (name.length === 0 || name.length > 40 || seen.has(name)) continue
        seen.add(name)
        names.push(name)
      }
      return names
    } catch {
      return []
    }
  }

  saveStudioCategories(names: string[]): string[] {
    const unique: string[] = []
    const seen = new Set<string>()
    for (const value of names) {
      const name = value.trim()
      if (name.length === 0 || name.length > 40 || seen.has(name)) continue
      seen.add(name)
      unique.push(name)
    }
    this.setMetadata(STUDIO_CATEGORIES_KEY, JSON.stringify(unique))
    return unique
  }

  updateLibrary(id: string, input: UpdateKnowledgeLibraryInput): KnowledgeLibrary {
    const database = this.requireDatabase()
    const current = this.getLibrary(id)
    if (current === undefined) throw new RangeError('知识库不存在')
    if (current.kind === 'studio') throw new RangeError('创作空间不能修改')
    const name = input.name.trim()
    const description = input.description?.trim() ?? ''
    if (name.length === 0 || name.length > 80) throw new RangeError('知识库名称长度应为 1 到 80 个字符')
    if (description.length > 500) throw new RangeError('知识库简介不能超过 500 个字符')
    const updatedAt = new Date().toISOString()
    database.prepare(`
      UPDATE libraries SET name = ?, description = ?, updated_at = ?
      WHERE id = ? AND tenant_id = 'local' AND principal_id = 'local-user'
    `).run(name, description, updatedAt, id)
    return { ...current, name, description, updatedAt }
  }

  deleteLibrary(id: string): KnowledgeDocument[] {
    const database = this.requireDatabase()
    const current = this.getLibrary(id)
    if (current === undefined) throw new RangeError('知识库不存在')
    if (current.kind === 'studio') throw new RangeError('创作空间不能删除')
    const documents = this.listDocuments(id)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare("DELETE FROM libraries WHERE id = ? AND tenant_id = 'local' AND principal_id = 'local-user'").run(id)
      database.exec('COMMIT')
      return documents
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  findDocumentByHash(libraryId: string, contentHash: string): KnowledgeDocument | undefined {
    const row = this.requireDatabase().prepare(`
      SELECT ${DOCUMENT_COLUMNS}
      FROM documents WHERE library_id = ? AND content_hash = ? LIMIT 1
    `).get(libraryId, contentHash) as unknown as DocumentRow | undefined
    return row === undefined ? undefined : normalizeDocument(row)
  }

  getDocuments(ids: string[]): KnowledgeDocument[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.requireDatabase().prepare(`
      SELECT ${DOCUMENT_COLUMNS}
      FROM documents WHERE id IN (${placeholders})
    `).all(...ids) as unknown as DocumentRow[]
    return rows.map(normalizeDocument)
  }

  listDocuments(libraryId: string): KnowledgeDocument[] {
    const rows = this.requireDatabase().prepare(`
      SELECT ${DOCUMENT_COLUMNS}
      FROM documents WHERE library_id = ?
      ORDER BY updated_at DESC, title COLLATE NOCASE
    `).all(libraryId) as unknown as DocumentRow[]
    return rows.map(normalizeDocument)
  }

  updateDocument(id: string, input: {
    title?: string
    originalName?: string
    sourceAssetId?: string
    contentHash?: string
    sizeBytes?: number
    indexStatus?: KnowledgeDocumentIndexStatus
    extra?: DocumentExtra
  }): KnowledgeDocument {
    const database = this.requireDatabase()
    const current = this.getDocuments([id])[0]
    if (current === undefined) throw new RangeError('知识条目不存在')

    const title = input.title === undefined ? current.title : input.title.trim()
    if (title.length === 0 || title.length > 200) throw new RangeError('知识条目标题长度应为 1 到 200 个字符')
    const originalName = input.originalName === undefined ? current.originalName : input.originalName.trim()
    if (input.originalName !== undefined && originalName.length === 0) throw new RangeError('原始文件名不能为空')
    const sourceAssetId = input.sourceAssetId === undefined ? current.sourceAssetId : input.sourceAssetId
    const contentHash = input.contentHash === undefined ? current.contentHash : input.contentHash
    const sizeBytes = input.sizeBytes === undefined ? current.sizeBytes : input.sizeBytes
    if (!Number.isInteger(sizeBytes) || sizeBytes < 0) throw new RangeError('文件大小必须是非负整数')
    const indexStatus = input.indexStatus === undefined ? current.indexStatus : input.indexStatus
    const extra = mergeExtra(current, input.extra)
    const updatedAt = new Date().toISOString()

    database.prepare(`
      UPDATE documents SET title = ?, original_name = ?, source_asset_id = ?, content_hash = ?,
        size_bytes = ?, index_status = ?, extra_json = ?, updated_at = ?
      WHERE id = ?
    `).run(title, originalName, sourceAssetId, contentHash, sizeBytes, indexStatus, serializeExtra(extra), updatedAt, id)
    database.prepare('UPDATE libraries SET updated_at = ? WHERE id = ?').run(updatedAt, current.libraryId)
    return this.requireDocument(id)
  }

  moveDocument(documentId: string, libraryId: string): KnowledgeDocument {
    const database = this.requireDatabase()
    const document = this.getDocuments([documentId])[0]
    if (document === undefined) throw new RangeError('知识条目不存在')
    const source = this.getLibrary(document.libraryId)
    if (source?.kind !== 'studio') throw new RangeError('只有创作文档可以转存到知识库')
    const target = this.getLibrary(libraryId)
    if (target === undefined) throw new RangeError('知识库不存在')
    if (target.kind !== 'knowledge') throw new RangeError('只能转存到知识库')
    if (document.libraryId === libraryId) return document
    const updatedAt = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        UPDATE documents SET library_id = ?, index_status = 'pending', updated_at = ?
        WHERE id = ?
      `).run(libraryId, updatedAt, documentId)
      database.prepare('UPDATE libraries SET updated_at = ? WHERE id = ?').run(updatedAt, document.libraryId)
      database.prepare('UPDATE libraries SET updated_at = ? WHERE id = ?').run(updatedAt, libraryId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.requireDocument(documentId)
  }

  deleteDocuments(ids: string[]): KnowledgeDocument[] {
    if (ids.length === 0) return []
    const database = this.requireDatabase()
    const documents = this.getDocuments(ids)
    const placeholders = ids.map(() => '?').join(', ')
    const libraryIds = [...new Set(documents.map(document => document.libraryId))]
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`DELETE FROM documents WHERE id IN (${placeholders})`).run(...ids)
      const updatedAt = new Date().toISOString()
      const updateLibrary = database.prepare('UPDATE libraries SET updated_at = ? WHERE id = ?')
      for (const libraryId of libraryIds) updateLibrary.run(updatedAt, libraryId)
      database.exec('COMMIT')
      return documents
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  registerAsset(asset: { id: string, contentHash: string, sizeBytes: number }): void {
    this.requireDatabase().prepare(`
      INSERT INTO source_assets(id, content_hash, size_bytes, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(asset.id, asset.contentHash, asset.sizeBytes, new Date().toISOString())
  }

  createDocument(input: {
    libraryId: string
    title: string
    originalName: string
    sourceType: KnowledgeDocumentSourceType
    sourceAssetId: string
    contentHash: string
    sizeBytes: number
    extra?: DocumentExtra
  }): KnowledgeDocument {
    const database = this.requireDatabase()
    const id = randomUUID()
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO documents(
        id, library_id, title, original_name, source_type, source_asset_id,
        content_hash, size_bytes, index_status, extra_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      id,
      input.libraryId,
      input.title,
      input.originalName,
      input.sourceType,
      input.sourceAssetId,
      input.contentHash,
      input.sizeBytes,
      serializeExtra(input.extra ?? {}),
      now,
      now,
    )
    database.prepare('UPDATE libraries SET updated_at = ? WHERE id = ?').run(now, input.libraryId)
    return this.requireDocument(id)
  }

  setDocumentIndexStatus(id: string, status: KnowledgeDocumentIndexStatus): KnowledgeDocument {
    return this.updateDocument(id, { indexStatus: status })
  }

  addDocumentRevision(input: { documentId: string, title: string, body: string, sourceAssetId: string }): KnowledgeDocumentRevision {
    const database = this.requireDatabase()
    if (this.getDocuments([input.documentId])[0] === undefined) throw new RangeError('知识条目不存在')
    const current = database.prepare('SELECT max(version) AS version FROM document_revisions WHERE document_id = ?').get(input.documentId) as { version: number | null }
    const version = (current.version ?? 0) + 1
    const createdAt = new Date().toISOString()
    database.prepare(`
      INSERT INTO document_revisions(id, document_id, version, title, body, source_asset_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.documentId, version, input.title, input.body, input.sourceAssetId, createdAt)
    return {
      documentId: input.documentId,
      version,
      title: input.title,
      body: input.body,
      createdAt,
    }
  }

  listDocumentRevisions(documentId: string): KnowledgeDocumentRevision[] {
    if (this.getDocuments([documentId])[0] === undefined) throw new RangeError('知识条目不存在')
    const rows = this.requireDatabase().prepare(`
      SELECT document_id, version, title, body, created_at
      FROM document_revisions
      WHERE document_id = ?
      ORDER BY version DESC
    `).all(documentId) as { document_id: string, version: number, title: string, body: string, created_at: string }[]
    return rows.map(row => ({
      documentId: row.document_id,
      version: row.version,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
    }))
  }

  getDocumentRevision(documentId: string, version: number): KnowledgeDocumentRevision {
    const row = this.requireDatabase().prepare(`
      SELECT document_id, version, title, body, created_at
      FROM document_revisions
      WHERE document_id = ? AND version = ?
    `).get(documentId, version) as { document_id: string, version: number, title: string, body: string, created_at: string } | undefined
    if (row === undefined) throw new RangeError('笔记版本不存在')
    return {
      documentId: row.document_id,
      version: row.version,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
    }
  }

  createIngestionJob(libraryId: string, totalFiles: number): string {
    const id = randomUUID()
    this.requireDatabase().prepare(`
      INSERT INTO ingestion_jobs(id, library_id, state, total_files, created_at)
      VALUES (?, ?, 'running', ?, ?)
    `).run(id, libraryId, totalFiles, new Date().toISOString())
    return id
  }

  finishIngestionJob(result: IngestionBatchResult): void {
    this.requireDatabase().prepare(`
      UPDATE ingestion_jobs SET state = 'completed', imported_files = ?, duplicate_files = ?,
        failed_files = ?, completed_at = ? WHERE id = ?
    `).run(result.importedFiles, result.duplicateFiles, result.failedFiles, new Date().toISOString(), result.jobId)
  }

  private queryLibraries(where: string, parameters: string[] = []): KnowledgeLibrary[] {
    const rows = this.requireDatabase().prepare(`
      SELECT
        libraries.id,
        libraries.name,
        libraries.description,
        libraries.kind,
        libraries.created_at,
        libraries.updated_at,
        count(documents.id) AS document_count
      FROM libraries
      LEFT JOIN documents ON documents.library_id = libraries.id
      WHERE ${where}
      GROUP BY libraries.id
      ORDER BY libraries.updated_at DESC, libraries.name COLLATE NOCASE
    `).all(...parameters) as unknown as LibraryRow[]
    return rows.map(normalizeLibrary)
  }

  private requireDocument(id: string): KnowledgeDocument {
    const document = this.getDocuments([id])[0]
    if (document === undefined) throw new Error(`catalog-sqlite: document not found: ${id}`)
    return document
  }

  private setMetadata(key: string, value: string): void {
    this.requireDatabase().prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('catalog-sqlite: database is not initialized')
    return this.database
  }
}

export default CatalogSqlite
