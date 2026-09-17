import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  LibraryChatMessage,
  LibraryChatMessageRole,
  LibraryChatMessageState,
  LibraryChatSnapshot,
  LibraryChatSource,
  LibraryChatSummary,
  LibraryChatTokenUsage,
} from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    chatStorage: ChatSqlite
  }
}

export interface Config {
  dataDir: string
}

interface MessageRow {
  id: string
  library_id: string
  role: LibraryChatMessageRole
  state: LibraryChatMessageState
  content: string
  model_id: string | null
  sources_json: string
  input_tokens: number
  output_tokens: number
  error: string | null
  created_at: string
  updated_at: string
}

interface SummaryRow {
  content: string
  cutoff_message_id: string
  updated_at: string
}

interface DocumentSummaryRow {
  summary: string
  updated_at: string
}

export interface DocumentSummaryCacheEntry {
  documentId: string
  contentHash: string
  modelId: string
  summary: string
  updatedAt: string
}

export interface CreateLibraryChatTurnInput {
  libraryId: string
  userMessage: LibraryChatMessage
  assistantMessage: LibraryChatMessage
}

export interface UpdateLibraryChatMessageInput {
  content?: string
  state?: LibraryChatMessageState
  sources?: LibraryChatSource[]
  tokenUsage?: LibraryChatTokenUsage
  error?: string | null
}

export class ChatSqlite extends Service {
  private database: DatabaseSync | undefined
  private readonly databasePath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'chatStorage')
    this.databasePath = resolve(config.dataDir, 'database.sqlite')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    mkdirSync(resolve(this.databasePath, '..'), { recursive: true })
    const database = this.database = new DatabaseSync(this.databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS library_chat_messages (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        state TEXT NOT NULL CHECK(state IN ('generating', 'completed', 'cancelled', 'failed')),
        content TEXT NOT NULL,
        model_id TEXT,
        sources_json TEXT NOT NULL DEFAULT '[]',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS library_chat_messages_timeline
        ON library_chat_messages(library_id, created_at, id);
      CREATE UNIQUE INDEX IF NOT EXISTS library_chat_one_generation
        ON library_chat_messages(library_id)
        WHERE role = 'assistant' AND state = 'generating';
      CREATE TABLE IF NOT EXISTS library_chat_summaries (
        library_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        cutoff_message_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_chat_document_summary_cache (
        document_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(document_id, content_hash, model_id)
      );
      CREATE INDEX IF NOT EXISTS library_chat_document_summary_by_document
        ON library_chat_document_summary_cache(document_id);
    `)
    database.prepare(`
      UPDATE library_chat_messages
      SET state = 'failed', error = '应用已重启，先前的回答生成被中断', updated_at = ?
      WHERE state = 'generating'
    `).run(new Date().toISOString())
    yield () => {
      database.close()
      this.database = undefined
    }
  }

  snapshot(libraryId: string): LibraryChatSnapshot {
    const messages = this.listMessages(libraryId)
    const summary = this.getSummary(libraryId)
    const active = messages.find(message => message.role === 'assistant' && message.state === 'generating')
    return {
      libraryId,
      messages,
      ...(summary === undefined ? {} : { summary }),
      ...(active === undefined ? {} : { activeMessageId: active.id }),
    }
  }

  listMessages(libraryId: string): LibraryChatMessage[] {
    return (this.requireDatabase().prepare(`
      SELECT * FROM library_chat_messages
      WHERE library_id = ? ORDER BY rowid
    `).all(libraryId) as unknown as MessageRow[]).map(normalizeMessage)
  }

  getMessage(id: string): LibraryChatMessage | undefined {
    const row = this.requireDatabase().prepare(
      'SELECT * FROM library_chat_messages WHERE id = ?',
    ).get(id) as unknown as MessageRow | undefined
    return row === undefined ? undefined : normalizeMessage(row)
  }

  createTurn(input: CreateLibraryChatTurnInput): void {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      this.insertMessage(database, input.userMessage)
      this.insertMessage(database, input.assistantMessage)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new RangeError('该知识库已有回答正在生成')
      }
      throw error
    }
  }

  updateMessage(id: string, input: UpdateLibraryChatMessageInput): LibraryChatMessage {
    const current = this.getMessage(id)
    if (current === undefined) throw new RangeError('聊天消息不存在')
    const nextSources = input.sources ?? current.sources
    const nextUsage = input.tokenUsage ?? current.tokenUsage
    const nextError = input.error === undefined ? current.error : input.error ?? undefined
    this.requireDatabase().prepare(`
      UPDATE library_chat_messages
      SET content = ?, state = ?, sources_json = ?, input_tokens = ?, output_tokens = ?,
        error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.content ?? current.content,
      input.state ?? current.state,
      JSON.stringify(nextSources),
      nextUsage.inputTokens,
      nextUsage.outputTokens,
      nextError ?? null,
      new Date().toISOString(),
      id,
    )
    const updated = this.getMessage(id)
    if (updated === undefined) throw new Error('chat-sqlite: message update failed')
    return updated
  }

  saveSummary(libraryId: string, summary: LibraryChatSummary): void {
    this.requireDatabase().prepare(`
      INSERT INTO library_chat_summaries(library_id, content, cutoff_message_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(library_id) DO UPDATE SET
        content = excluded.content,
        cutoff_message_id = excluded.cutoff_message_id,
        updated_at = excluded.updated_at
    `).run(libraryId, summary.content, summary.cutoffMessageId, summary.updatedAt)
  }

  getSummary(libraryId: string): LibraryChatSummary | undefined {
    const row = this.requireDatabase().prepare(`
      SELECT content, cutoff_message_id, updated_at
      FROM library_chat_summaries WHERE library_id = ?
    `).get(libraryId) as unknown as SummaryRow | undefined
    return row === undefined ? undefined : {
      content: row.content,
      cutoffMessageId: row.cutoff_message_id,
      updatedAt: row.updated_at,
    }
  }

  getDocumentSummary(documentId: string, contentHash: string, modelId: string): DocumentSummaryCacheEntry | undefined {
    const row = this.requireDatabase().prepare(`
      SELECT summary, updated_at
      FROM library_chat_document_summary_cache
      WHERE document_id = ? AND content_hash = ? AND model_id = ?
    `).get(documentId, contentHash, modelId) as unknown as DocumentSummaryRow | undefined
    return row === undefined ? undefined : {
      documentId,
      contentHash,
      modelId,
      summary: row.summary,
      updatedAt: row.updated_at,
    }
  }

  saveDocumentSummary(input: Omit<DocumentSummaryCacheEntry, 'updatedAt'> & { updatedAt?: string }): DocumentSummaryCacheEntry {
    const updatedAt = input.updatedAt ?? new Date().toISOString()
    this.requireDatabase().prepare(`
      INSERT INTO library_chat_document_summary_cache(
        document_id, content_hash, model_id, summary, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(document_id, content_hash, model_id) DO UPDATE SET
        summary = excluded.summary,
        updated_at = excluded.updated_at
    `).run(input.documentId, input.contentHash, input.modelId, input.summary, updatedAt)
    return { ...input, updatedAt }
  }

  deleteDocumentSummaries(documentId: string): void {
    this.requireDatabase().prepare(
      'DELETE FROM library_chat_document_summary_cache WHERE document_id = ?',
    ).run(documentId)
  }

  clear(libraryId: string): void {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('DELETE FROM library_chat_messages WHERE library_id = ?').run(libraryId)
      database.prepare('DELETE FROM library_chat_summaries WHERE library_id = ?').run(libraryId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private insertMessage(database: DatabaseSync, message: LibraryChatMessage): void {
    database.prepare(`
      INSERT INTO library_chat_messages(
        id, library_id, role, state, content, model_id, sources_json,
        input_tokens, output_tokens, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.libraryId,
      message.role,
      message.state,
      message.content,
      message.modelId ?? null,
      JSON.stringify(message.sources),
      message.tokenUsage.inputTokens,
      message.tokenUsage.outputTokens,
      message.error ?? null,
      message.createdAt,
      message.updatedAt,
    )
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('chat-sqlite: database is not initialized')
    return this.database
  }
}

function normalizeMessage(row: MessageRow): LibraryChatMessage {
  return {
    id: row.id,
    libraryId: row.library_id,
    role: row.role,
    state: row.state,
    content: row.content,
    ...(row.model_id === null ? {} : { modelId: row.model_id }),
    sources: parseSources(row.sources_json),
    tokenUsage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.error === null ? {} : { error: row.error }),
  }
}

function parseSources(value: string): LibraryChatSource[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed as LibraryChatSource[] : []
  } catch {
    return []
  }
}

export default ChatSqlite
