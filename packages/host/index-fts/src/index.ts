import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KnowledgeChunk } from '@tiggyknowledge/chunker-basic'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeIndex: FtsIndex
  }
}

export interface Config {
  dataDir: string
}

export interface FtsSearchInput {
  text: string
  libraryIds: string[]
  limit: number
}

export interface FtsSearchHit {
  chunkId: string
  documentId: string
  libraryId: string
  location: string
  title: string
  snippet: string
  score: number
}

interface SearchRow {
  chunk_id: string
  document_id: string
  library_id: string
  location: string
  title: string
  snippet: string
  rank: number
}

interface ContainsRow extends Omit<SearchRow, 'snippet'> {
  body: string
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function containsSnippet(body: string, terms: string[]): string {
  const normalized = body.toLocaleLowerCase()
  const match = terms
    .map(term => ({ term, index: normalized.indexOf(term.toLocaleLowerCase()) }))
    .filter(item => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0]
  if (match === undefined) return body.slice(0, 96)
  const start = Math.max(0, match.index - 32)
  const end = Math.min(body.length, match.index + match.term.length + 64)
  return `${start > 0 ? '…' : ''}${body.slice(start, match.index)}<mark>${body.slice(match.index, match.index + match.term.length)}</mark>${body.slice(match.index + match.term.length, end)}${end < body.length ? '…' : ''}`
}

export class FtsIndex extends Service {
  private database: DatabaseSync | undefined
  private readonly databasePath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'knowledgeIndex')
    this.databasePath = resolve(config.dataDir, 'database.sqlite')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    const database = this.database = new DatabaseSync(this.databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
        document_id UNINDEXED,
        title,
        body,
        tokenize = 'unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        library_id UNINDEXED,
        location UNINDEXED,
        title,
        body,
        tokenize = 'unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts_v2 USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        library_id UNINDEXED,
        location UNINDEXED,
        title,
        body,
        tokenize = 'trigram'
      );
      INSERT INTO knowledge_fts_v2(chunk_id, document_id, library_id, location, title, body)
      SELECT chunk_id, document_id, library_id, location, title, body
      FROM knowledge_fts
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_fts_v2 WHERE knowledge_fts_v2.document_id = knowledge_fts.document_id
      );
      INSERT INTO knowledge_fts_v2(chunk_id, document_id, library_id, location, title, body)
      SELECT 'legacy-' || documents.id, documents.id, documents.library_id, '全文', document_fts.title, document_fts.body
      FROM document_fts
      JOIN documents ON documents.id = document_fts.document_id
      WHERE NOT EXISTS (
        SELECT 1 FROM knowledge_fts_v2 WHERE knowledge_fts_v2.document_id = documents.id
      );
    `)
    yield () => {
      database.close()
      this.database = undefined
    }
  }

  index(document: { id: string, libraryId: string, title: string }, chunks: KnowledgeChunk[]): void {
    if (chunks.length === 0) throw new Error('index-fts: no chunks to index')
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM knowledge_fts_v2 WHERE document_id = ?').run(document.id)
      const insert = database.prepare(`
        INSERT INTO knowledge_fts_v2(chunk_id, document_id, library_id, location, title, body)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const chunk of chunks) insert.run(chunk.id, document.id, document.libraryId, chunk.location, document.title, chunk.body)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  updateTitle(documentId: string, title: string): void {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const table of ['document_fts', 'knowledge_fts', 'knowledge_fts_v2'] as const) {
        database.prepare(`UPDATE ${table} SET title = ? WHERE document_id = ?`).run(title, documentId)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  removeDocuments(ids: string[]): void {
    if (ids.length === 0) return
    const database = this.requireDatabase()
    const placeholders = ids.map(() => '?').join(', ')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`DELETE FROM knowledge_fts_v2 WHERE document_id IN (${placeholders})`).run(...ids)
      database.prepare(`DELETE FROM knowledge_fts WHERE document_id IN (${placeholders})`).run(...ids)
      database.prepare(`DELETE FROM document_fts WHERE document_id IN (${placeholders})`).run(...ids)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  search(input: FtsSearchInput): FtsSearchHit[] {
    const rawTerms = input.text.match(/\S+/g) ?? []
    if (rawTerms.some(term => [...term].length < 3)) return this.searchContains(input, rawTerms)
    const terms = rawTerms.map(term => `"${term.replaceAll('"', '""')}"`)
    if (terms.length === 0) return []
    const libraryFilter = input.libraryIds.length === 0
      ? ''
      : ` AND library_id IN (${input.libraryIds.map(() => '?').join(', ')})`
    const rows = this.requireDatabase().prepare(`
      SELECT chunk_id, document_id, library_id, location, title,
        snippet(knowledge_fts_v2, 5, '<mark>', '</mark>', '…', 32) AS snippet,
        bm25(knowledge_fts_v2, 5.0, 1.0) AS rank
      FROM knowledge_fts_v2
      WHERE knowledge_fts_v2 MATCH ?${libraryFilter}
      ORDER BY rank
      LIMIT ?
    `).all(terms.join(' AND '), ...input.libraryIds, input.limit) as unknown as SearchRow[]
    return rows.map(row => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      libraryId: row.library_id,
      location: row.location,
      title: row.title,
      snippet: row.snippet,
      score: -row.rank,
    }))
  }

  private searchContains(input: FtsSearchInput, terms: string[]): FtsSearchHit[] {
    if (terms.length === 0) return []
    const termFilter = terms.map(() => "(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')").join(' AND ')
    const libraryFilter = input.libraryIds.length === 0
      ? ''
      : ` AND library_id IN (${input.libraryIds.map(() => '?').join(', ')})`
    const patterns = terms.flatMap(term => {
      const pattern = `%${escapeLike(term)}%`
      return [pattern, pattern]
    })
    const rows = this.requireDatabase().prepare(`
      SELECT chunk_id, document_id, library_id, location, title, body, 0 AS rank
      FROM knowledge_fts_v2
      WHERE ${termFilter}${libraryFilter}
      ORDER BY rowid DESC
      LIMIT ?
    `).all(...patterns, ...input.libraryIds, input.limit) as unknown as ContainsRow[]
    return rows.map(row => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      libraryId: row.library_id,
      location: row.location,
      title: row.title,
      snippet: containsSnippet(row.body, terms),
      score: 0,
    }))
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('index-fts: database is not initialized')
    return this.database
  }
}

export default FtsIndex
