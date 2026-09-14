import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CreateKnowledgeLibraryInput,
  CreateKnowledgeNoteInput,
  DeleteKnowledgeLibraryResult,
  GenerateDshIntegrationAccessKeyResult,
  IngestionBatchResult,
  DeleteKnowledgeDocumentsResult,
  KnowledgeDocument,
  KnowledgeDocumentList,
  KnowledgeDocumentMetadata,
  KnowledgeDocumentPreview,
  KnowledgeDocumentWithMetadata,
  KnowledgeGraphQuery,
  KnowledgeGraphResponse,
  KnowledgeLibrary,
  KnowledgeLibraryList,
  KnowledgeOkfMapping,
  KnowledgeQuery,
  KnowledgeSearchResponse,
  KnowledgeTag,
  KnowledgeMetadataDocumentList,
  OpenDataDirectoryResult,
  KnowledgeTagList,
  SystemSnapshot,
  SettingsSnapshot,
  UpdateDshIntegrationSettingsInput,
  UpdateKnowledgeDocumentTitleInput,
  UpdateKnowledgeMarkdownNoteInput,
  UpdateKnowledgeLibraryInput,
  RenameKnowledgeTagInput,
} from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionService
  }
}

export class ConnectionService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  async system(signal?: AbortSignal): Promise<SystemSnapshot> {
    return await this.request<SystemSnapshot>('/api/system', signal === undefined ? {} : { signal })
  }

  async openDataDirectory(signal?: AbortSignal): Promise<OpenDataDirectoryResult> {
    return await this.request<OpenDataDirectoryResult>('/api/system/open-data-directory', {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async updateDshIntegrationSettings(input: UpdateDshIntegrationSettingsInput, signal?: AbortSignal): Promise<SettingsSnapshot> {
    return await this.request<SettingsSnapshot>('/api/settings/agent-integration', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async generateDshIntegrationAccessKey(signal?: AbortSignal): Promise<GenerateDshIntegrationAccessKeyResult> {
    return await this.request<GenerateDshIntegrationAccessKeyResult>('/api/settings/agent-integration/access-key', {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async libraries(signal?: AbortSignal): Promise<KnowledgeLibrary[]> {
    const result = await this.request<KnowledgeLibraryList>('/api/libraries', signal === undefined ? {} : { signal })
    return result.items
  }

  async createLibrary(input: CreateKnowledgeLibraryInput, signal?: AbortSignal): Promise<KnowledgeLibrary> {
    return await this.request<KnowledgeLibrary>('/api/libraries', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async updateLibrary(libraryId: string, input: UpdateKnowledgeLibraryInput, signal?: AbortSignal): Promise<KnowledgeLibrary> {
    return await this.request<KnowledgeLibrary>(`/api/libraries/${encodeURIComponent(libraryId)}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async deleteLibrary(libraryId: string, signal?: AbortSignal): Promise<DeleteKnowledgeLibraryResult> {
    return await this.request<DeleteKnowledgeLibraryResult>(`/api/libraries/${encodeURIComponent(libraryId)}`, {
      method: 'DELETE',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  libraryOkfExportUrl(libraryId: string): string {
    return `/api/libraries/${encodeURIComponent(libraryId)}/okf-bundle`
  }

  async createNote(libraryId: string, input: CreateKnowledgeNoteInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/libraries/${encodeURIComponent(libraryId)}/notes`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async ingestFiles(libraryId: string, files: File[], tagNames: string[] = [], signal?: AbortSignal): Promise<IngestionBatchResult> {
    const form = new FormData()
    for (const file of files) form.append('files', file, file.name)
    for (const tagName of tagNames) form.append('tags', tagName)
    return await this.request<IngestionBatchResult>(`/api/libraries/${encodeURIComponent(libraryId)}/imports`, {
      body: form,
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async search(input: KnowledgeQuery, signal?: AbortSignal): Promise<KnowledgeSearchResponse> {
    return await this.request<KnowledgeSearchResponse>('/api/search', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async documents(libraryId: string, signal?: AbortSignal): Promise<KnowledgeDocumentList> {
    return await this.request<KnowledgeDocumentList>(`/api/libraries/${encodeURIComponent(libraryId)}/documents`, signal === undefined ? {} : { signal })
  }

  async documentPreview(documentId: string, signal?: AbortSignal): Promise<KnowledgeDocumentPreview> {
    return await this.request<KnowledgeDocumentPreview>(`/api/documents/${encodeURIComponent(documentId)}/preview`, signal === undefined ? {} : { signal })
  }

  async documentOkf(documentId: string, signal?: AbortSignal): Promise<KnowledgeOkfMapping> {
    return await this.request<KnowledgeOkfMapping>(`/api/documents/${encodeURIComponent(documentId)}/okf`, signal === undefined ? {} : { signal })
  }

  async updateDocumentTitle(documentId: string, input: UpdateKnowledgeDocumentTitleInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/documents/${encodeURIComponent(documentId)}/title`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async updateMarkdownNote(documentId: string, input: UpdateKnowledgeMarkdownNoteInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/documents/${encodeURIComponent(documentId)}/markdown-note`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  documentContentUrl(documentId: string): string {
    return `/api/documents/${encodeURIComponent(documentId)}/content`
  }

  async deleteDocuments(ids: string[], signal?: AbortSignal): Promise<DeleteKnowledgeDocumentsResult> {
    return await this.request<DeleteKnowledgeDocumentsResult>('/api/documents/delete', {
      body: JSON.stringify({ ids }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async documentMetadata(documentId: string, signal?: AbortSignal): Promise<KnowledgeDocumentMetadata> {
    return await this.request<KnowledgeDocumentMetadata>(`/api/documents/${encodeURIComponent(documentId)}/metadata`, signal === undefined ? {} : { signal })
  }

  async setDocumentTags(documentId: string, names: string[], signal?: AbortSignal): Promise<KnowledgeDocumentMetadata> {
    return await this.request<KnowledgeDocumentMetadata>(`/api/documents/${encodeURIComponent(documentId)}/tags`, {
      body: JSON.stringify({ names }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async setDocumentFavorite(documentId: string, favorite: boolean, signal?: AbortSignal): Promise<KnowledgeDocumentMetadata> {
    return await this.request<KnowledgeDocumentMetadata>(`/api/documents/${encodeURIComponent(documentId)}/favorite`, {
      body: JSON.stringify({ favorite }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async tags(signal?: AbortSignal): Promise<KnowledgeTag[]> {
    const result = await this.request<KnowledgeTagList>('/api/tags', signal === undefined ? {} : { signal })
    return result.items
  }

  async renameTag(tagId: string, input: RenameKnowledgeTagInput, signal?: AbortSignal): Promise<KnowledgeTag> {
    return await this.request<KnowledgeTag>(`/api/tags/${encodeURIComponent(tagId)}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async taggedDocuments(tagId: string, signal?: AbortSignal): Promise<KnowledgeDocumentWithMetadata[]> {
    const result = await this.request<KnowledgeMetadataDocumentList>(`/api/tags/${encodeURIComponent(tagId)}/documents`, signal === undefined ? {} : { signal })
    return result.items
  }

  async favoriteDocuments(signal?: AbortSignal): Promise<KnowledgeDocumentWithMetadata[]> {
    const result = await this.request<KnowledgeMetadataDocumentList>('/api/favorites', signal === undefined ? {} : { signal })
    return result.items
  }

  async graph(query: KnowledgeGraphQuery = {}, signal?: AbortSignal): Promise<KnowledgeGraphResponse> {
    const params = new URLSearchParams()
    if (typeof query.libraryId === 'string' && query.libraryId.length > 0) params.set('libraryId', query.libraryId)
    if (typeof query.depth === 'number') params.set('depth', String(query.depth))
    if (query.includeMissing === false) params.set('includeMissing', 'false')
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return await this.request<KnowledgeGraphResponse>(`/api/graph${suffix}`, signal === undefined ? {} : { signal })
  }

  async documentGraph(documentId: string, query: Pick<KnowledgeGraphQuery, 'depth' | 'includeMissing' | 'libraryId'> = {}, signal?: AbortSignal): Promise<KnowledgeGraphResponse> {
    const params = new URLSearchParams()
    if (typeof query.libraryId === 'string' && query.libraryId.length > 0) params.set('libraryId', query.libraryId)
    if (typeof query.depth === 'number') params.set('depth', String(query.depth))
    if (query.includeMissing === false) params.set('includeMissing', 'false')
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return await this.request<KnowledgeGraphResponse>(`/api/documents/${encodeURIComponent(documentId)}/graph${suffix}`, signal === undefined ? {} : { signal })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(path, init)
    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { message?: string } | undefined
      throw new Error(body?.message ?? `connection: ${path} returned ${response.status}`)
    }
    return await response.json() as T
  }
}

export default ConnectionService
