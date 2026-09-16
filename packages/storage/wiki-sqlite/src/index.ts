import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  WikiGeneration,
  WikiGenerationMode,
  WikiGenerationState,
  WikiEditSource,
  WikiFolder,
  WikiPage,
  WikiPageRevision,
  WikiPageSummary,
  WikiPageStatus,
  WikiPageType,
  WikiSectionState,
  WikiSource,
} from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    wikiStorage: WikiSqlite
  }
}

export interface Config {
  dataDir: string
}

export interface WikiDocumentSnapshot {
  documentId: string
  libraryId: string
  title: string
  contentHash: string
  summary?: string
  summarizedAt?: string
}

export interface WikiSectionWrite {
  id: string
  title: string
  body: string
  order: number
  state?: WikiSectionState
  sources: WikiSource[]
}

export interface WikiPageWrite {
  id: string
  slug: string
  title: string
  summary?: string
  pageType?: WikiPageType
  status?: WikiPageStatus
  aliases?: string[]
  purpose?: string
  questions?: string[]
  folderId?: string
  parentId?: string
  order: number
  state?: WikiSectionState
  sections: WikiSectionWrite[]
}

export interface WikiFolderWrite extends WikiFolder {}

interface PageRow {
  id: string
  slug: string
  title: string
  summary: string
  page_type: WikiPageType
  publication_status: WikiPageStatus
  aliases_json: string
  purpose: string
  questions_json: string
  folder_id: string | null
  parent_id: string | null
  order_index: number
  state: WikiSectionState
  version: number
  last_edit_source: WikiEditSource
  updated_at: string
}

interface FolderRow {
  id: string
  name: string
  path: string
  parent_id: string | null
  depth: number
  order_index: number
}

interface SectionRow {
  id: string
  title: string
  body: string
  order_index: number
  state: WikiSectionState
}

interface SourceRow {
  document_id: string
  library_id: string
  title: string
  reference_uri: `tk://local/${string}`
  content_hash: string
}

interface GenerationRow {
  id: string
  mode: WikiGenerationMode
  state: WikiGenerationState
  phase: string
  total_steps: number
  completed_steps: number
  estimated_input_tokens: number
  input_tokens: number
  output_tokens: number
  candidate_count: number | null
  accepted_candidate_count: number | null
  plan_json: string | null
  created_at: string
  completed_at: string | null
  error: string | null
}

interface RevisionRow {
  page_id: string
  version: number
  title: string
  summary: string
  page_type: WikiPageType
  publication_status: WikiPageStatus
  aliases_json: string
  purpose: string
  questions_json: string
  sections_json: string
  edit_source: WikiEditSource
  edited_at: string
}

const SCHEMA_VERSION = 8

export class WikiSqlite extends Service {
  private database: DatabaseSync | undefined
  private readonly databasePath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'wikiStorage')
    this.databasePath = resolve(config.dataDir, 'database.sqlite')
  }

  async *[Service.init](): AsyncGenerator<() => void> {
    mkdirSync(resolve(this.databasePath, '..'), { recursive: true })
    const database = this.database = new DatabaseSync(this.databasePath)
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS wiki_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wiki_document_snapshots (
        document_id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        summary TEXT,
        summarized_at TEXT
      );
      CREATE TABLE IF NOT EXISTS wiki_document_summary_cache (
        document_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        summary TEXT NOT NULL,
        summarized_at TEXT NOT NULL,
        PRIMARY KEY(document_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS wiki_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        parent_id TEXT,
        depth INTEGER NOT NULL,
        order_index INTEGER NOT NULL,
        FOREIGN KEY(parent_id) REFERENCES wiki_folders(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        page_type TEXT NOT NULL DEFAULT 'concept',
        publication_status TEXT NOT NULL DEFAULT 'published',
        aliases_json TEXT NOT NULL DEFAULT '[]',
        purpose TEXT NOT NULL DEFAULT '',
        questions_json TEXT NOT NULL DEFAULT '[]',
        folder_id TEXT,
        parent_id TEXT,
        order_index INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'ready',
        version INTEGER NOT NULL DEFAULT 1,
        last_edit_source TEXT NOT NULL DEFAULT 'pipeline',
        updated_at TEXT NOT NULL,
        FOREIGN KEY(folder_id) REFERENCES wiki_folders(id) ON DELETE SET NULL,
        FOREIGN KEY(parent_id) REFERENCES wiki_pages(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS wiki_sections (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'ready'
      );
      CREATE TABLE IF NOT EXISTS wiki_sources (
        section_id TEXT NOT NULL REFERENCES wiki_sections(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL,
        library_id TEXT NOT NULL,
        title TEXT NOT NULL,
        reference_uri TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        PRIMARY KEY(section_id, document_id)
      );
      CREATE TABLE IF NOT EXISTS wiki_links (
        source_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        target_slug TEXT NOT NULL,
        PRIMARY KEY(source_page_id, target_slug)
      );
      CREATE TABLE IF NOT EXISTS wiki_generations (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        state TEXT NOT NULL,
        phase TEXT NOT NULL,
        total_steps INTEGER NOT NULL,
        completed_steps INTEGER NOT NULL,
        estimated_input_tokens INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        candidate_count INTEGER,
        accepted_candidate_count INTEGER,
        plan_json TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS wiki_page_revisions (
        page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        page_type TEXT NOT NULL,
        publication_status TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT '',
        questions_json TEXT NOT NULL DEFAULT '[]',
        sections_json TEXT NOT NULL,
        edit_source TEXT NOT NULL,
        edited_at TEXT NOT NULL,
        PRIMARY KEY(page_id, version)
      );
      CREATE INDEX IF NOT EXISTS wiki_sections_page_order ON wiki_sections(page_id, order_index);
      CREATE INDEX IF NOT EXISTS wiki_sources_document ON wiki_sources(document_id, section_id);
      CREATE INDEX IF NOT EXISTS wiki_links_target ON wiki_links(target_slug, source_page_id);
      CREATE INDEX IF NOT EXISTS wiki_folders_parent_order ON wiki_folders(parent_id, order_index);
      INSERT INTO wiki_metadata(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `)
    const pageColumns = new Set((database.prepare('PRAGMA table_info(wiki_pages)').all() as { name: string }[]).map(column => column.name))
    if (!pageColumns.has('summary')) database.exec("ALTER TABLE wiki_pages ADD COLUMN summary TEXT NOT NULL DEFAULT ''")
    if (!pageColumns.has('page_type')) database.exec("ALTER TABLE wiki_pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'concept'")
    if (!pageColumns.has('publication_status')) database.exec("ALTER TABLE wiki_pages ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'published'")
    if (!pageColumns.has('aliases_json')) database.exec("ALTER TABLE wiki_pages ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]'")
    if (!pageColumns.has('purpose')) database.exec("ALTER TABLE wiki_pages ADD COLUMN purpose TEXT NOT NULL DEFAULT ''")
    if (!pageColumns.has('questions_json')) database.exec("ALTER TABLE wiki_pages ADD COLUMN questions_json TEXT NOT NULL DEFAULT '[]'")
    if (!pageColumns.has('folder_id')) database.exec('ALTER TABLE wiki_pages ADD COLUMN folder_id TEXT')
    if (!pageColumns.has('version')) database.exec('ALTER TABLE wiki_pages ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
    if (!pageColumns.has('last_edit_source')) database.exec("ALTER TABLE wiki_pages ADD COLUMN last_edit_source TEXT NOT NULL DEFAULT 'pipeline'")
    const generationColumns = new Set((database.prepare('PRAGMA table_info(wiki_generations)').all() as { name: string }[]).map(column => column.name))
    if (!generationColumns.has('candidate_count')) database.exec('ALTER TABLE wiki_generations ADD COLUMN candidate_count INTEGER')
    if (!generationColumns.has('accepted_candidate_count')) database.exec('ALTER TABLE wiki_generations ADD COLUMN accepted_candidate_count INTEGER')
    if (!generationColumns.has('plan_json')) database.exec('ALTER TABLE wiki_generations ADD COLUMN plan_json TEXT')
    const revisionColumns = new Set((database.prepare('PRAGMA table_info(wiki_page_revisions)').all() as { name: string }[]).map(column => column.name))
    if (!revisionColumns.has('purpose')) database.exec("ALTER TABLE wiki_page_revisions ADD COLUMN purpose TEXT NOT NULL DEFAULT ''")
    if (!revisionColumns.has('questions_json')) database.exec("ALTER TABLE wiki_page_revisions ADD COLUMN questions_json TEXT NOT NULL DEFAULT '[]'")
    database.prepare(`
      UPDATE wiki_generations SET state = 'failed', phase = 'interrupted',
        completed_at = ?, error = '应用退出导致生成任务中断'
      WHERE state IN ('pending', 'running')
    `).run(new Date().toISOString())
    yield () => {
      database.close()
      this.database = undefined
    }
  }

  schemaVersion(): number {
    return SCHEMA_VERSION
  }

  lastGeneratedAt(): string | undefined {
    const row = this.requireDatabase().prepare("SELECT value FROM wiki_metadata WHERE key = 'last_generated_at'").get() as { value: string } | undefined
    return row?.value
  }

  listDocumentSnapshots(): WikiDocumentSnapshot[] {
    const rows = this.requireDatabase().prepare(`
      SELECT document_id, library_id, title, content_hash, summary, summarized_at
      FROM wiki_document_snapshots ORDER BY document_id
    `).all() as Array<{
      document_id: string
      library_id: string
      title: string
      content_hash: string
      summary: string | null
      summarized_at: string | null
    }>
    return rows.map(row => ({
      documentId: row.document_id,
      libraryId: row.library_id,
      title: row.title,
      contentHash: row.content_hash,
      ...(row.summary === null ? {} : { summary: row.summary }),
      ...(row.summarized_at === null ? {} : { summarizedAt: row.summarized_at }),
    }))
  }

  cachedSummary(documentId: string, contentHash: string): string | undefined {
    const database = this.requireDatabase()
    const cached = database.prepare(`
      SELECT summary FROM wiki_document_summary_cache
      WHERE document_id = ? AND content_hash = ?
    `).get(documentId, contentHash) as { summary: string } | undefined
    if (cached !== undefined) return cached.summary
    const row = database.prepare(`
      SELECT summary FROM wiki_document_snapshots
      WHERE document_id = ? AND content_hash = ? AND summary IS NOT NULL
    `).get(documentId, contentHash) as { summary: string } | undefined
    return row?.summary
  }

  saveDocumentSummary(snapshot: WikiDocumentSnapshot, summary: string): void {
    this.requireDatabase().prepare(`
      INSERT INTO wiki_document_summary_cache(document_id, content_hash, summary, summarized_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(document_id, content_hash) DO UPDATE SET
        summary = excluded.summary, summarized_at = excluded.summarized_at
    `).run(snapshot.documentId, snapshot.contentHash, summary, new Date().toISOString())
  }

  syncDocumentSnapshots(snapshots: WikiDocumentSnapshot[]): void {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const ids = new Set(snapshots.map(item => item.documentId))
      const remove = database.prepare('DELETE FROM wiki_document_snapshots WHERE document_id = ?')
      for (const previous of this.listDocumentSnapshots()) {
        if (!ids.has(previous.documentId)) remove.run(previous.documentId)
      }
      const upsert = database.prepare(`
        INSERT INTO wiki_document_snapshots(document_id, library_id, title, content_hash, summary, summarized_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          library_id = excluded.library_id, title = excluded.title, content_hash = excluded.content_hash,
          summary = CASE WHEN wiki_document_snapshots.content_hash = excluded.content_hash
            THEN wiki_document_snapshots.summary ELSE excluded.summary END,
          summarized_at = CASE WHEN wiki_document_snapshots.content_hash = excluded.content_hash
            THEN wiki_document_snapshots.summarized_at ELSE excluded.summarized_at END
      `)
      for (const item of snapshots) {
        upsert.run(item.documentId, item.libraryId, item.title, item.contentHash, item.summary ?? null, item.summarizedAt ?? null)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  listPages(): WikiPageSummary[] {
    const rows = this.requireDatabase().prepare(`
      SELECT id, slug, title, summary, page_type, publication_status, aliases_json, purpose, questions_json,
        folder_id, parent_id, order_index, state, version, last_edit_source, updated_at
      FROM wiki_pages WHERE publication_status != 'archived'
      ORDER BY order_index, title COLLATE NOCASE
    `).all() as unknown as PageRow[]
    return rows.map(normalizePage)
  }

  listFolders(): WikiFolder[] {
    const rows = this.requireDatabase().prepare(`
      SELECT id, name, path, parent_id, depth, order_index
      FROM wiki_folders ORDER BY depth, order_index, name COLLATE NOCASE
    `).all() as unknown as FolderRow[]
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
      depth: row.depth,
      order: row.order_index,
    }))
  }

  listArchivedPages(): WikiPageSummary[] {
    const rows = this.requireDatabase().prepare(`
      SELECT id, slug, title, summary, page_type, publication_status, aliases_json, purpose, questions_json,
        folder_id, parent_id, order_index, state, version, last_edit_source, updated_at
      FROM wiki_pages WHERE publication_status = 'archived'
      ORDER BY updated_at DESC, title COLLATE NOCASE
    `).all() as unknown as PageRow[]
    return rows.map(normalizePage)
  }

  getPage(idOrSlug: string): WikiPage | undefined {
    const database = this.requireDatabase()
    const row = database.prepare(`
      SELECT id, slug, title, summary, page_type, publication_status, aliases_json, purpose, questions_json,
        folder_id, parent_id, order_index, state, version, last_edit_source, updated_at
      FROM wiki_pages WHERE id = ? OR slug = ? LIMIT 1
    `).get(idOrSlug, idOrSlug) as unknown as PageRow | undefined
    if (row === undefined) return undefined
    const sections = database.prepare(`
      SELECT id, title, body, order_index, state
      FROM wiki_sections WHERE page_id = ? ORDER BY order_index
    `).all(row.id) as unknown as SectionRow[]
    const sourceQuery = database.prepare(`
      SELECT document_id, library_id, title, reference_uri, content_hash
      FROM wiki_sources WHERE section_id = ? ORDER BY title COLLATE NOCASE
    `)
    const outLinks = (database.prepare(`
      SELECT target_slug FROM wiki_links WHERE source_page_id = ? ORDER BY target_slug
    `).all(row.id) as { target_slug: string }[]).map(item => item.target_slug)
    const inLinks = (database.prepare(`
      SELECT source.slug
      FROM wiki_links link
      JOIN wiki_pages source ON source.id = link.source_page_id
      WHERE link.target_slug = ? AND source.publication_status != 'archived'
      ORDER BY source.slug
    `).all(row.slug) as { slug: string }[]).map(item => item.slug)
    return {
      ...normalizePage(row),
      sections: sections.map(section => ({
        id: section.id,
        title: section.title,
        body: section.body,
        order: section.order_index,
        state: section.state,
        sources: (sourceQuery.all(section.id) as unknown as SourceRow[]).map(normalizeSource),
      })),
      outLinks,
      inLinks,
    }
  }

  replaceWiki(
    pages: WikiPageWrite[],
    snapshots: WikiDocumentSnapshot[],
    generatedAt = new Date().toISOString(),
    folders: WikiFolderWrite[] = [],
  ): void {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const upsertFolder = database.prepare(`
        INSERT INTO wiki_folders(id, name, path, parent_id, depth, order_index)
        VALUES (?, ?, ?, NULL, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          name = excluded.name, depth = excluded.depth, order_index = excluded.order_index
      `)
      for (const folder of folders) upsertFolder.run(folder.id, folder.name, folder.path, folder.depth, folder.order)
      const setFolderParent = database.prepare('UPDATE wiki_folders SET parent_id = ? WHERE id = ?')
      for (const folder of folders) {
        setFolderParent.run(folder.parentId ?? null, folder.id)
      }
      const existingRows = database.prepare(`
        SELECT id, slug, title, summary, page_type, publication_status, aliases_json, purpose, questions_json,
          folder_id, parent_id, order_index, state, version, last_edit_source, updated_at
        FROM wiki_pages
      `).all() as unknown as PageRow[]
      const existingBySlug = new Map(existingRows.map(row => [row.slug, row]))
      const finalIdByInputId = new Map(pages.map(page => [page.id, existingBySlug.get(page.slug)?.id ?? page.id]))
      const activeIds = new Set(finalIdByInputId.values())
      const insertPage = database.prepare(`
        INSERT INTO wiki_pages(
          id, slug, title, summary, page_type, publication_status, aliases_json,
          purpose, questions_json, folder_id, parent_id, order_index, state, version, last_edit_source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 'pipeline', ?)
      `)
      const updatePage = database.prepare(`
        UPDATE wiki_pages SET title = ?, summary = ?, page_type = ?, publication_status = ?,
          aliases_json = ?, purpose = ?, questions_json = ?, folder_id = ?, parent_id = NULL, order_index = ?, state = ?,
          version = version + ?, last_edit_source = CASE WHEN ? = 1 THEN 'pipeline' ELSE last_edit_source END,
          updated_at = CASE WHEN ? = 1 THEN ? ELSE updated_at END
        WHERE id = ?
      `)
      for (const page of pages) {
        const existing = existingBySlug.get(page.slug)
        const finalId = finalIdByInputId.get(page.id) ?? page.id
        const metadata = pageMetadata(page)
        if (existing === undefined) {
          insertPage.run(
            finalId, page.slug, page.title, metadata.summary, metadata.pageType,
            metadata.status, JSON.stringify(metadata.aliases), metadata.purpose,
            JSON.stringify(metadata.questions), page.folderId ?? null, page.order,
            page.state ?? 'ready', generatedAt,
          )
          continue
        }
        const current = this.getPage(existing.id)
        if (current === undefined) throw new Error('wiki-sqlite: existing page disappeared')
        const contentChanged = !samePageContent(current, page)
        if (contentChanged) this.insertRevision(database, current)
        updatePage.run(
          page.title, metadata.summary, metadata.pageType, metadata.status,
          JSON.stringify(metadata.aliases), metadata.purpose, JSON.stringify(metadata.questions),
          page.folderId ?? null, page.order, page.state ?? 'ready',
          contentChanged ? 1 : 0, contentChanged ? 1 : 0,
          contentChanged ? 1 : 0, generatedAt, existing.id,
        )
      }
      for (const row of existingRows) {
        if (activeIds.has(row.id) || row.publication_status === 'archived') continue
        const current = this.getPage(row.id)
        if (current !== undefined) this.insertRevision(database, current)
        database.prepare(`
          UPDATE wiki_pages SET publication_status = 'archived', version = version + 1,
            last_edit_source = 'pipeline', updated_at = ? WHERE id = ?
        `).run(generatedAt, row.id)
      }
      database.prepare('DELETE FROM wiki_sections WHERE page_id IN (SELECT id FROM wiki_pages WHERE publication_status != ?)').run('archived')
      const setParent = database.prepare('UPDATE wiki_pages SET parent_id = ? WHERE id = ?')
      for (const page of pages) {
        const pageId = finalIdByInputId.get(page.id) ?? page.id
        const parentId = page.parentId === undefined ? undefined : finalIdByInputId.get(page.parentId)
        if (parentId !== undefined && parentId !== pageId) setParent.run(parentId, pageId)
      }
      for (const page of pages) {
        this.insertSections(database, finalIdByInputId.get(page.id) ?? page.id, page.sections)
      }
      database.exec('DELETE FROM wiki_links')
      for (const page of pages) {
        this.insertLinks(database, finalIdByInputId.get(page.id) ?? page.id, page.sections)
      }
      if (folders.length === 0) {
        database.exec('DELETE FROM wiki_folders WHERE id NOT IN (SELECT folder_id FROM wiki_pages WHERE folder_id IS NOT NULL)')
      } else {
        const placeholders = folders.map(() => '?').join(', ')
        database.prepare(`
          DELETE FROM wiki_folders
          WHERE id NOT IN (${placeholders})
            AND id NOT IN (SELECT folder_id FROM wiki_pages WHERE folder_id IS NOT NULL)
        `).run(...folders.map(folder => folder.id))
      }
      this.syncSnapshotsInTransaction(database, snapshots)
      database.prepare(`
        INSERT INTO wiki_metadata(key, value) VALUES ('last_generated_at', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(generatedAt)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  updatePage(page: WikiPageWrite, expectedVersion: number, editSource: WikiEditSource = 'user'): WikiPage {
    const database = this.requireDatabase()
    const now = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.getPage(page.id)
      if (current === undefined) throw new RangeError('Wiki 页面不存在')
      if (current.version !== expectedVersion) throw new RangeError('Wiki 页面已被其他操作更新，请刷新后重试')
      this.insertRevision(database, current)
      const metadata = pageMetadata(page)
      const result = database.prepare(`
        UPDATE wiki_pages SET title = ?, summary = ?, page_type = ?, publication_status = ?,
          aliases_json = ?, purpose = ?, questions_json = ?, state = 'locked', version = version + 1,
          last_edit_source = ?, updated_at = ? WHERE id = ? AND version = ?
      `).run(
        page.title, metadata.summary, metadata.pageType, metadata.status,
        JSON.stringify(metadata.aliases), metadata.purpose, JSON.stringify(metadata.questions),
        editSource, now, page.id, expectedVersion,
      )
      if (result.changes !== 1) throw new RangeError('Wiki 页面已被其他操作更新，请刷新后重试')
      database.prepare('DELETE FROM wiki_sections WHERE page_id = ?').run(page.id)
      this.insertSections(database, page.id, page.sections)
      database.prepare('DELETE FROM wiki_links WHERE source_page_id = ?').run(page.id)
      this.insertLinks(database, page.id, page.sections)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    const updated = this.getPage(page.id)
    if (updated === undefined) throw new Error('wiki-sqlite: page update failed')
    return updated
  }

  listRevisions(pageId: string): WikiPageRevision[] {
    if (this.getPage(pageId) === undefined) throw new RangeError('Wiki 页面不存在')
    const rows = this.requireDatabase().prepare(`
      SELECT page_id, version, title, summary, page_type, publication_status,
        aliases_json, purpose, questions_json, sections_json, edit_source, edited_at
      FROM wiki_page_revisions WHERE page_id = ? ORDER BY version DESC
    `).all(pageId) as unknown as RevisionRow[]
    return rows.map(normalizeRevision)
  }

  revertPage(pageId: string, version: number, expectedVersion: number): WikiPage {
    const row = this.requireDatabase().prepare(`
      SELECT page_id, version, title, summary, page_type, publication_status,
        aliases_json, purpose, questions_json, sections_json, edit_source, edited_at
      FROM wiki_page_revisions WHERE page_id = ? AND version = ?
    `).get(pageId, version) as unknown as RevisionRow | undefined
    if (row === undefined) throw new RangeError('Wiki 历史版本不存在')
    const revision = normalizeRevision(row)
    const current = this.getPage(pageId)
    if (current === undefined) throw new RangeError('Wiki 页面不存在')
    return this.updatePage({
      id: current.id,
      slug: current.slug,
      title: revision.title,
      summary: revision.summary,
      pageType: revision.pageType,
      status: revision.status,
      aliases: revision.aliases,
      purpose: revision.purpose,
      questions: revision.questions,
      ...(current.parentId === undefined ? {} : { parentId: current.parentId }),
      order: current.order,
      state: 'locked',
      sections: revision.sections,
    }, expectedVersion, 'revert')
  }

  restorePage(pageId: string, expectedVersion: number): WikiPage {
    const current = this.getPage(pageId)
    if (current === undefined || current.status !== 'archived') throw new RangeError('回收站页面不存在')
    return this.updatePage({
      id: current.id,
      slug: current.slug,
      title: current.title,
      summary: current.summary,
      pageType: current.pageType,
      status: 'draft',
      aliases: current.aliases,
      purpose: current.purpose,
      questions: current.questions,
      ...(current.parentId === undefined ? {} : { parentId: current.parentId }),
      order: current.order,
      state: 'locked',
      sections: current.sections,
    }, expectedVersion)
  }

  purgeArchivedPage(pageId: string): void {
    const current = this.getPage(pageId)
    if (current === undefined || current.status !== 'archived') throw new RangeError('回收站页面不存在')
    this.requireDatabase().prepare('DELETE FROM wiki_pages WHERE id = ? AND publication_status = ?').run(pageId, 'archived')
  }

  markSourcesMissing(documentIds: string[]): void {
    if (documentIds.length === 0) return
    const database = this.requireDatabase()
    const placeholders = documentIds.map(() => '?').join(', ')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`
        UPDATE wiki_sections SET state = 'source-missing'
        WHERE id IN (SELECT section_id FROM wiki_sources WHERE document_id IN (${placeholders}))
          AND state != 'locked'
      `).run(...documentIds)
      database.exec(`
        UPDATE wiki_pages SET state = 'source-missing'
        WHERE id IN (SELECT page_id FROM wiki_sections WHERE state = 'source-missing')
          AND state != 'locked'
      `)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  pagesForDocument(documentId: string): WikiPageSummary[] {
    const rows = this.requireDatabase().prepare(`
      SELECT DISTINCT p.id, p.slug, p.title, p.summary, p.page_type, p.publication_status,
        p.aliases_json, p.purpose, p.questions_json, p.folder_id, p.parent_id, p.order_index, p.state, p.version,
        p.last_edit_source, p.updated_at
      FROM wiki_pages p
      JOIN wiki_sections s ON s.page_id = p.id
      JOIN wiki_sources src ON src.section_id = s.id
      WHERE src.document_id = ?
      ORDER BY p.order_index
    `).all(documentId) as unknown as PageRow[]
    return rows.map(normalizePage)
  }

  createGeneration(generation: WikiGeneration): void {
    this.requireDatabase().prepare(`
      INSERT INTO wiki_generations(
        id, mode, state, phase, total_steps, completed_steps, estimated_input_tokens,
        input_tokens, output_tokens, candidate_count, accepted_candidate_count, plan_json, created_at, completed_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      generation.id, generation.mode, generation.state, generation.phase,
      generation.totalSteps, generation.completedSteps, generation.estimatedInputTokens,
      generation.inputTokens, generation.outputTokens, generation.candidateCount ?? null,
      generation.acceptedCandidateCount ?? null, generation.plan === undefined ? null : JSON.stringify(generation.plan),
      generation.createdAt,
      generation.completedAt ?? null, generation.error ?? null,
    )
  }

  updateGeneration(id: string, input: Partial<Omit<WikiGeneration, 'id' | 'mode' | 'createdAt'>>): WikiGeneration {
    const current = this.getGeneration(id)
    if (current === undefined) throw new RangeError('Wiki 生成任务不存在')
    const next: WikiGeneration = { ...current, ...input }
    this.requireDatabase().prepare(`
      UPDATE wiki_generations SET state = ?, phase = ?, total_steps = ?, completed_steps = ?,
        estimated_input_tokens = ?, input_tokens = ?, output_tokens = ?, candidate_count = ?,
        accepted_candidate_count = ?, plan_json = ?, completed_at = ?, error = ?
      WHERE id = ?
    `).run(
      next.state, next.phase, next.totalSteps, next.completedSteps, next.estimatedInputTokens,
      next.inputTokens, next.outputTokens, next.candidateCount ?? null,
      next.acceptedCandidateCount ?? null, next.plan === undefined ? null : JSON.stringify(next.plan),
      next.completedAt ?? null, next.error ?? null, id,
    )
    return next
  }

  getGeneration(id: string): WikiGeneration | undefined {
    const row = this.requireDatabase().prepare('SELECT * FROM wiki_generations WHERE id = ?').get(id) as unknown as GenerationRow | undefined
    return row === undefined ? undefined : normalizeGeneration(row)
  }

  latestGeneration(): WikiGeneration | undefined {
    const row = this.requireDatabase().prepare(`
      SELECT * FROM wiki_generations ORDER BY created_at DESC LIMIT 1
    `).get() as unknown as GenerationRow | undefined
    return row === undefined ? undefined : normalizeGeneration(row)
  }

  activeGeneration(): WikiGeneration | undefined {
    const row = this.requireDatabase().prepare(`
      SELECT * FROM wiki_generations WHERE state IN ('pending', 'running', 'planned')
      ORDER BY created_at DESC LIMIT 1
    `).get() as unknown as GenerationRow | undefined
    return row === undefined ? undefined : normalizeGeneration(row)
  }

  private insertRevision(database: DatabaseSync, page: WikiPage): void {
    database.prepare(`
      INSERT OR IGNORE INTO wiki_page_revisions(
        page_id, version, title, summary, page_type, publication_status,
        aliases_json, purpose, questions_json, sections_json, edit_source, edited_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      page.id, page.version, page.title, page.summary, page.pageType, page.status,
      JSON.stringify(page.aliases), page.purpose, JSON.stringify(page.questions), JSON.stringify(page.sections),
      page.lastEditSource, page.updatedAt,
    )
    database.prepare(`
      DELETE FROM wiki_page_revisions
      WHERE page_id = ? AND edit_source = 'pipeline' AND version IN (
        SELECT version FROM wiki_page_revisions
        WHERE page_id = ? ORDER BY version DESC LIMIT -1 OFFSET 50
      )
    `).run(page.id, page.id)
    database.prepare(`
      DELETE FROM wiki_page_revisions
      WHERE page_id = ? AND version IN (
        SELECT version FROM wiki_page_revisions
        WHERE page_id = ? ORDER BY version DESC LIMIT -1 OFFSET 200
      )
    `).run(page.id, page.id)
  }

  private insertSections(database: DatabaseSync, pageId: string, sections: WikiPageWrite['sections']): void {
    const insertSection = database.prepare(`
      INSERT INTO wiki_sections(id, page_id, title, body, order_index, state)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertSource = database.prepare(`
      INSERT INTO wiki_sources(section_id, document_id, library_id, title, reference_uri, content_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const section of sections) {
      insertSection.run(section.id, pageId, section.title, section.body, section.order, section.state ?? 'ready')
      for (const source of section.sources) {
        insertSource.run(section.id, source.documentId, source.libraryId, source.title, source.referenceUri, source.contentHash)
      }
    }
  }

  private insertLinks(database: DatabaseSync, pageId: string, sections: WikiPageWrite['sections']): void {
    const insert = database.prepare(`
      INSERT OR IGNORE INTO wiki_links(source_page_id, target_slug) VALUES (?, ?)
    `)
    const slugs = new Set<string>()
    for (const section of sections) {
      for (const match of section.body.matchAll(/\[\[([^|\]\n]+)(?:\|[^\]\n]+)?\]\]/g)) {
        const slug = match[1]?.trim()
        if (slug !== undefined && slug.length > 0) slugs.add(slug)
      }
    }
    for (const slug of slugs) insert.run(pageId, slug)
  }

  private syncSnapshotsInTransaction(database: DatabaseSync, snapshots: WikiDocumentSnapshot[]): void {
    database.exec('DELETE FROM wiki_document_snapshots')
    const insert = database.prepare(`
      INSERT INTO wiki_document_snapshots(document_id, library_id, title, content_hash, summary, summarized_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const item of snapshots) {
      insert.run(item.documentId, item.libraryId, item.title, item.contentHash, item.summary ?? null, item.summarizedAt ?? null)
    }
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === undefined) throw new Error('wiki-sqlite: database is not initialized')
    return this.database
  }
}

function normalizePage(row: PageRow): WikiPageSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    pageType: row.page_type,
    status: row.publication_status,
    aliases: parseStringArray(row.aliases_json),
    purpose: row.purpose,
    questions: parseStringArray(row.questions_json),
    ...(row.folder_id === null ? {} : { folderId: row.folder_id }),
    ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
    order: row.order_index,
    state: row.state,
    version: row.version,
    lastEditSource: row.last_edit_source,
    updatedAt: row.updated_at,
  }
}

function normalizeRevision(row: RevisionRow): WikiPageRevision {
  return {
    pageId: row.page_id,
    version: row.version,
    title: row.title,
    summary: row.summary,
    pageType: row.page_type,
    status: row.publication_status,
    aliases: parseStringArray(row.aliases_json),
    purpose: row.purpose,
    questions: parseStringArray(row.questions_json),
    sections: JSON.parse(row.sections_json) as WikiPageRevision['sections'],
    editSource: row.edit_source,
    editedAt: row.edited_at,
  }
}

function pageMetadata(page: WikiPageWrite): {
  summary: string
  pageType: WikiPageType
  status: WikiPageStatus
  aliases: string[]
  purpose: string
  questions: string[]
} {
  return {
    summary: page.summary ?? '',
    pageType: page.pageType ?? 'concept',
    status: page.status ?? 'published',
    aliases: page.aliases ?? [],
    purpose: page.purpose ?? '',
    questions: page.questions ?? [],
  }
}

function samePageContent(current: WikiPage, next: WikiPageWrite): boolean {
  const metadata = pageMetadata(next)
  return current.title === next.title
    && current.summary === metadata.summary
    && current.pageType === metadata.pageType
    && current.status === metadata.status
    && JSON.stringify(current.aliases) === JSON.stringify(metadata.aliases)
    && current.purpose === metadata.purpose
    && JSON.stringify(current.questions) === JSON.stringify(metadata.questions)
    && JSON.stringify(current.sections.map(section => ({ title: section.title, body: section.body })))
      === JSON.stringify(next.sections.map(section => ({ title: section.title, body: section.body })))
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function normalizeSource(row: SourceRow): WikiSource {
  return {
    documentId: row.document_id,
    libraryId: row.library_id,
    title: row.title,
    referenceUri: row.reference_uri,
    contentHash: row.content_hash,
  }
}

function normalizeGeneration(row: GenerationRow): WikiGeneration {
  return {
    id: row.id,
    mode: row.mode,
    state: row.state,
    phase: row.phase,
    totalSteps: row.total_steps,
    completedSteps: row.completed_steps,
    estimatedInputTokens: row.estimated_input_tokens,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    ...(row.candidate_count === null ? {} : { candidateCount: row.candidate_count }),
    ...(row.accepted_candidate_count === null ? {} : { acceptedCandidateCount: row.accepted_candidate_count }),
    ...(row.plan_json === null ? {} : { plan: JSON.parse(row.plan_json) as NonNullable<WikiGeneration['plan']> }),
    createdAt: row.created_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.error === null ? {} : { error: row.error }),
  }
}

export default WikiSqlite
