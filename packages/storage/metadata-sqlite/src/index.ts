import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KnowledgeDocumentMetadata, KnowledgeTag } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeMetadataStore: MetadataSqlite
  }
}

export interface Config {
  dataDir: string
}

interface TagRow {
  id: string
  name: string
  document_count: number
  created_at: string
  updated_at: string
}

function normalizeTag(row: TagRow): KnowledgeTag {
  return {
    id: row.id,
    name: row.name,
    documentCount: row.document_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class MetadataSqlite extends Service {
  private database: DatabaseSync | undefined
  private readonly databasePath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'knowledgeMetadataStore')
    this.databasePath = resolve(config.dataDir, 'database.sqlite')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    mkdirSync(resolve(this.databasePath, '..'), { recursive: true })
    const database = this.database = new DatabaseSync(this.databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS document_tags (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY(document_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS document_favorites (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS document_tags_tag_id ON document_tags(tag_id, document_id);
      INSERT INTO metadata(key, value) VALUES ('metadata_schema_version', '1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `)
    yield () => {
      database.close()
      this.database = undefined
    }
  }

  schemaVersion(): number {
    const row = this.requireDatabase().prepare("SELECT value FROM metadata WHERE key = 'metadata_schema_version'").get() as { value: string } | undefined
    return Number(row?.value ?? 0)
  }

  metadata(documentId: string): KnowledgeDocumentMetadata {
    const database = this.requireDatabase()
    const rows = database.prepare(`
      SELECT tags.id, tags.name, count(document_tags_all.document_id) AS document_count,
        tags.created_at, tags.updated_at
      FROM document_tags
      JOIN tags ON tags.id = document_tags.tag_id
      LEFT JOIN document_tags AS document_tags_all ON document_tags_all.tag_id = tags.id
      WHERE document_tags.document_id = ?
      GROUP BY tags.id
      ORDER BY tags.name COLLATE NOCASE
    `).all(documentId) as unknown as TagRow[]
    const favorite = database.prepare('SELECT 1 AS value FROM document_favorites WHERE document_id = ?').get(documentId)
    return { documentId, tags: rows.map(normalizeTag), isFavorite: favorite !== undefined }
  }

  metadataMany(documentIds: string[]): Map<string, KnowledgeDocumentMetadata> {
    return new Map(documentIds.map(id => [id, this.metadata(id)]))
  }

  setTags(documentId: string, names: string[]): KnowledgeDocumentMetadata {
    const database = this.requireDatabase()
    const now = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM document_tags WHERE document_id = ?').run(documentId)
      const upsert = database.prepare(`
        INSERT INTO tags(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET updated_at = excluded.updated_at
      `)
      const find = database.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
      const link = database.prepare('INSERT INTO document_tags(document_id, tag_id, created_at) VALUES (?, ?, ?)')
      for (const name of names) {
        upsert.run(randomUUID(), name, now, now)
        const tag = find.get(name) as { id: string }
        link.run(documentId, tag.id, now)
      }
      database.exec('DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM document_tags WHERE document_tags.tag_id = tags.id)')
      database.exec('COMMIT')
      return this.metadata(documentId)
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  setFavorite(documentId: string, favorite: boolean): KnowledgeDocumentMetadata {
    const database = this.requireDatabase()
    if (favorite) {
      database.prepare('INSERT INTO document_favorites(document_id, created_at) VALUES (?, ?) ON CONFLICT(document_id) DO NOTHING').run(documentId, new Date().toISOString())
    } else {
      database.prepare('DELETE FROM document_favorites WHERE document_id = ?').run(documentId)
    }
    return this.metadata(documentId)
  }

  renameTag(tagId: string, name: string): KnowledgeTag {
    const database = this.requireDatabase()
    const current = database.prepare('SELECT id, name, 0 AS document_count, created_at, updated_at FROM tags WHERE id = ?').get(tagId) as TagRow | undefined
    if (current === undefined) throw new RangeError('标签不存在')
    const nextName = name.trim()
    if (nextName.length === 0 || nextName.length > 32) throw new RangeError('标签名称长度应为 1 到 32 个字符')

    const existing = database.prepare('SELECT id, name, 0 AS document_count, created_at, updated_at FROM tags WHERE name = ? COLLATE NOCASE').get(nextName) as TagRow | undefined
    const now = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      if (existing !== undefined && existing.id !== current.id) {
        database.prepare('DELETE FROM document_tags WHERE tag_id = ? AND document_id IN (SELECT document_id FROM document_tags WHERE tag_id = ?)').run(existing.id, current.id)
        database.prepare('UPDATE document_tags SET tag_id = ? WHERE tag_id = ?').run(existing.id, current.id)
        database.prepare('DELETE FROM tags WHERE id = ?').run(current.id)
        database.prepare('UPDATE tags SET updated_at = ? WHERE id = ?').run(now, existing.id)
      } else {
        database.prepare('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?').run(nextName, now, current.id)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    const row = database.prepare(`
      SELECT tags.id, tags.name, count(document_tags.document_id) AS document_count,
        tags.created_at, tags.updated_at
      FROM tags
      LEFT JOIN document_tags ON document_tags.tag_id = tags.id
      WHERE tags.id = ? OR tags.name = ? COLLATE NOCASE
      GROUP BY tags.id
      ORDER BY tags.name COLLATE NOCASE
      LIMIT 1
    `).get(current.id, nextName) as TagRow | undefined
    if (row === undefined) throw new Error('metadata-sqlite: tag rename failed')
    return normalizeTag(row)
  }

  listTags(): KnowledgeTag[] {
    const rows = this.requireDatabase().prepare(`
      SELECT tags.id, tags.name, count(document_tags.document_id) AS document_count,
        tags.created_at, tags.updated_at
      FROM tags
      LEFT JOIN document_tags ON document_tags.tag_id = tags.id
      GROUP BY tags.id
      HAVING document_count > 0
      ORDER BY document_count DESC, tags.name COLLATE NOCASE
    `).all() as unknown as TagRow[]
    return rows.map(normalizeTag)
  }

  taggedDocumentIds(tagId: string): string[] {
    const rows = this.requireDatabase().prepare('SELECT document_id FROM document_tags WHERE tag_id = ? ORDER BY created_at DESC').all(tagId) as { document_id: string }[]
    return rows.map(row => row.document_id)
  }

  favoriteDocumentIds(): string[] {
    const rows = this.requireDatabase().prepare('SELECT document_id FROM document_favorites ORDER BY created_at DESC').all() as { document_id: string }[]
    return rows.map(row => row.document_id)
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('metadata-sqlite: database is not initialized')
    return this.database
  }
}

export default MetadataSqlite
