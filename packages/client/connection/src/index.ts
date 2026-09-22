import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ConfirmWikiGenerationInput,
  CreateKnowledgeLibraryInput,
  CreateKnowledgeNoteInput,
  CreateKnowledgeUrlInput,
  AttachStudioNoteImageInput,
  CreateStudioCategoryInput,
  CreateStudioNoteInput,
  DeleteStudioCategoryInput,
  CreateStudioRecordingInput,
  CreateWikiIssueInput,
  DeleteKnowledgeLibraryResult,
  GenerateDshIntegrationAccessKeyResult,
  IngestionBatchResult,
  DeleteKnowledgeDocumentsResult,
  KnowledgeDocument,
  KnowledgeDocumentList,
  KnowledgeDocumentMetadata,
  KnowledgeDocumentPreview,
  KnowledgeDocumentRevisionList,
  KnowledgeDocumentWithMetadata,
  KnowledgeLibrary,
  KnowledgeLibraryList,
  KnowledgeOkfMapping,
  KnowledgeQuery,
  SetPluginEnabledResult,
  KnowledgeSearchResponse,
  KnowledgeTag,
  KnowledgeMetadataDocumentList,
  OpenDataDirectoryResult,
  PluginInventoryEntry,
  RevertWikiPageInput,
  TransferStudioDocumentInput,
  UnlockWikiPageInput,
  PublishWikiPageInput,
  KnowledgeTagList,
  LibraryChatSnapshot,
  LibraryChatStreamEvent,
  CancelLibraryChatResult,
  LlmIntegrationSettings,
  SendLibraryChatMessageInput,
  SetLlmApiKeyInput,
  StartWikiGenerationInput,
  SystemSnapshot,
  SettingsSnapshot,
  RenameStudioCategoryInput,
  StudioNoteImageAttachment,
  StudioWorkspace,
  TestLlmConnectionInput,
  TestLlmConnectionResult,
  UpdateLlmIntegrationSettingsInput,
  UpdateWikiPageInput,
  UpdateWikiIssueInput,
  WikiEstimate,
  WikiGeneration,
  WikiInboxItem,
  WikiFolder,
  WikiPage,
  WikiPageRevision,
  WikiPageSummary,
  WikiGovernanceSnapshot,
  WikiIssue,
  WikiLintFinding,
  WikiStatus,
  UpdateDshIntegrationSettingsInput,
  UpdateKnowledgeDocumentTitleInput,
  UpdateKnowledgeMarkdownNoteInput,
  UpdateKnowledgeUrlExtractedContentInput,
  UpdateStudioRecordingInput,
  UpdateKnowledgeLibraryInput,
  RenameKnowledgeTagInput,
} from '@tiggyknowledge/contracts'

function decodeSseEvent(block: string): LibraryChatStreamEvent | undefined {
  let eventName: string | undefined
  const data: string[] = []
  for (const rawLine of block.split(/\r\n|\r|\n/)) {
    const line = rawLine.startsWith('\uFEFF') ? rawLine.slice(1) : rawLine
    if (line.length === 0 || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    if (field === 'data') data.push(value)
  }
  if (data.length === 0) return undefined
  const parsed = JSON.parse(data.join('\n')) as LibraryChatStreamEvent
  if (eventName !== undefined && eventName.length > 0 && parsed.type !== eventName) {
    throw new Error(`connection: SSE event type mismatch (${eventName})`)
  }
  return parsed
}

export async function *parseLibraryChatSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<LibraryChatStreamEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let reachedEof = false
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        reachedEof = true
        break
      }
      buffer += decoder.decode(result.value, { stream: true })
      while (true) {
        const separator = buffer.match(/\r\n\r\n|\r\n\n|\n\r\n|\n\n|\r\r/)
        if (separator?.index === undefined) break
        const event = decodeSseEvent(buffer.slice(0, separator.index))
        buffer = buffer.slice(separator.index + separator[0].length)
        if (event !== undefined) yield event
      }
    }
    buffer += decoder.decode()
    if (buffer.trim().length > 0) {
      const event = decodeSseEvent(buffer)
      if (event !== undefined) yield event
    }
  } finally {
    if (!reachedEof) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

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

  async setPluginEnabled(entryId: string, enabled: boolean, signal?: AbortSignal): Promise<PluginInventoryEntry> {
    const result = await this.request<SetPluginEnabledResult>(`/api/plugins/${encodeURIComponent(entryId)}`, {
      body: JSON.stringify({ enabled }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
    return result.plugin
  }

  async libraryChatSnapshot(libraryId: string, signal?: AbortSignal): Promise<LibraryChatSnapshot> {
    return await this.request<LibraryChatSnapshot>(`/api/libraries/${encodeURIComponent(libraryId)}/chat`, signal === undefined ? {} : { signal })
  }

  async clearLibraryChat(libraryId: string, signal?: AbortSignal): Promise<LibraryChatSnapshot> {
    return await this.request<LibraryChatSnapshot>(`/api/libraries/${encodeURIComponent(libraryId)}/chat`, {
      method: 'DELETE',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async cancelLibraryChat(libraryId: string, signal?: AbortSignal): Promise<CancelLibraryChatResult> {
    return await this.request<CancelLibraryChatResult>(`/api/libraries/${encodeURIComponent(libraryId)}/chat/cancel`, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async *sendLibraryChatMessage(libraryId: string, input: SendLibraryChatMessageInput, signal?: AbortSignal): AsyncGenerator<LibraryChatStreamEvent> {
    const path = `/api/libraries/${encodeURIComponent(libraryId)}/chat/messages`
    const response = await fetch(path, {
      body: JSON.stringify(input),
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { message?: string } | undefined
      throw new Error(body?.message ?? `connection: ${path} returned ${response.status}`)
    }
    if (response.body === null) throw new Error('connection: chat stream response has no body')
    for await (const event of parseLibraryChatSse(response.body)) {
      yield event
      if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'error') return
    }
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

  async updateLlmSettings(input: UpdateLlmIntegrationSettingsInput, signal?: AbortSignal): Promise<LlmIntegrationSettings> {
    return await this.request<LlmIntegrationSettings>('/api/settings/llm', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async setLlmApiKey(input: SetLlmApiKeyInput, signal?: AbortSignal): Promise<LlmIntegrationSettings> {
    return await this.request<LlmIntegrationSettings>('/api/settings/llm/api-key', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async testLlmConnection(input: TestLlmConnectionInput, signal?: AbortSignal): Promise<TestLlmConnectionResult> {
    return await this.request<TestLlmConnectionResult>('/api/settings/llm/test', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async wikiStatus(signal?: AbortSignal): Promise<WikiStatus> {
    return await this.request<WikiStatus>('/api/wiki/status', signal === undefined ? {} : { signal })
  }

  async wikiEstimate(mode: StartWikiGenerationInput['mode'], signal?: AbortSignal): Promise<WikiEstimate> {
    return await this.request<WikiEstimate>('/api/wiki/estimate', {
      body: JSON.stringify({ mode }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async startWikiGeneration(input: StartWikiGenerationInput, signal?: AbortSignal): Promise<WikiGeneration> {
    return await this.request<WikiGeneration>('/api/wiki/generations', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async wikiGeneration(id: string, signal?: AbortSignal): Promise<WikiGeneration> {
    return await this.request<WikiGeneration>(`/api/wiki/generations/${encodeURIComponent(id)}`, signal === undefined ? {} : { signal })
  }

  async confirmWikiGeneration(id: string, input: ConfirmWikiGenerationInput, signal?: AbortSignal): Promise<WikiGeneration> {
    return await this.request<WikiGeneration>(`/api/wiki/generations/${encodeURIComponent(id)}/confirm`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async cancelWikiGeneration(id: string, signal?: AbortSignal): Promise<WikiGeneration> {
    return await this.request<WikiGeneration>(`/api/wiki/generations/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async skipWikiInbox(documentId: string, signal?: AbortSignal): Promise<WikiInboxItem[]> {
    return await this.request<WikiInboxItem[]>(`/api/wiki/inbox/${encodeURIComponent(documentId)}/skip`, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async unlockWikiPage(id: string, input: UnlockWikiPageInput, signal?: AbortSignal): Promise<WikiPage> {
    return await this.request<WikiPage>(`/api/wiki/pages/${encodeURIComponent(id)}/unlock`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async publishWikiPage(id: string, input: PublishWikiPageInput, signal?: AbortSignal): Promise<WikiPage> {
    return await this.request<WikiPage>(`/api/wiki/pages/${encodeURIComponent(id)}/publish`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async wikiPages(signal?: AbortSignal): Promise<WikiPageSummary[]> {
    return await this.request<WikiPageSummary[]>('/api/wiki/pages', signal === undefined ? {} : { signal })
  }

  async wikiFolders(signal?: AbortSignal): Promise<WikiFolder[]> {
    return await this.request<WikiFolder[]>('/api/wiki/folders', signal === undefined ? {} : { signal })
  }

  async wikiPage(id: string, signal?: AbortSignal): Promise<WikiPage> {
    return await this.request<WikiPage>(`/api/wiki/pages/${encodeURIComponent(id)}`, signal === undefined ? {} : { signal })
  }

  async updateWikiPage(id: string, input: UpdateWikiPageInput, signal?: AbortSignal): Promise<WikiPage> {
    return await this.request<WikiPage>(`/api/wiki/pages/${encodeURIComponent(id)}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async wikiPageRevisions(id: string, signal?: AbortSignal): Promise<WikiPageRevision[]> {
    return await this.request<WikiPageRevision[]>(
      `/api/wiki/pages/${encodeURIComponent(id)}/revisions`,
      signal === undefined ? {} : { signal },
    )
  }

  async revertWikiPage(id: string, input: RevertWikiPageInput, signal?: AbortSignal): Promise<WikiPage> {
    return await this.request<WikiPage>(`/api/wiki/pages/${encodeURIComponent(id)}/revert`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async wikiGovernance(signal?: AbortSignal): Promise<WikiGovernanceSnapshot> {
    return await this.request<WikiGovernanceSnapshot>('/api/wiki/governance', signal === undefined ? {} : { signal })
  }

  async wikiLint(signal?: AbortSignal): Promise<WikiLintFinding[]> {
    return await this.request<WikiLintFinding[]>('/api/wiki/governance/lint', signal === undefined ? {} : { signal })
  }

  async wikiIssues(signal?: AbortSignal): Promise<WikiIssue[]> {
    return await this.request<WikiIssue[]>('/api/wiki/governance/issues', signal === undefined ? {} : { signal })
  }

  async createWikiIssue(input: CreateWikiIssueInput, signal?: AbortSignal): Promise<WikiIssue> {
    return await this.request<WikiIssue>('/api/wiki/governance/issues', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async updateWikiIssue(id: string, input: UpdateWikiIssueInput, signal?: AbortSignal): Promise<WikiIssue> {
    return await this.request<WikiIssue>(`/api/wiki/governance/issues/${encodeURIComponent(id)}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async wikiTrash(signal?: AbortSignal): Promise<WikiPageSummary[]> {
    return await this.request<WikiPageSummary[]>('/api/wiki/governance/trash', signal === undefined ? {} : { signal })
  }

  async restoreWikiPage(id: string, expectedVersion: number, signal?: AbortSignal): Promise<WikiPage> {
    return await this.request<WikiPage>(`/api/wiki/governance/trash/${encodeURIComponent(id)}/restore`, {
      body: JSON.stringify({ expectedVersion }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async purgeWikiPage(id: string, signal?: AbortSignal): Promise<{ ok: true }> {
    return await this.request<{ ok: true }>(`/api/wiki/governance/trash/${encodeURIComponent(id)}`, {
      method: 'DELETE',
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

  async studio(signal?: AbortSignal): Promise<StudioWorkspace> {
    return await this.request<StudioWorkspace>('/api/studio', signal === undefined ? {} : { signal })
  }

  async createStudioNote(input: CreateStudioNoteInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>('/api/studio/notes', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async updateStudioNote(documentId: string, input: CreateStudioNoteInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/studio/notes/${encodeURIComponent(documentId)}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async attachStudioNoteImage(documentId: string, input: AttachStudioNoteImageInput, signal?: AbortSignal): Promise<StudioNoteImageAttachment> {
    return await this.request<StudioNoteImageAttachment>(`/api/studio/notes/${encodeURIComponent(documentId)}/images`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async createStudioRecording(input: CreateStudioRecordingInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>('/api/studio/recordings', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async updateStudioRecording(documentId: string, input: UpdateStudioRecordingInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/studio/recordings/${encodeURIComponent(documentId)}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async transcribeStudioRecording(documentId: string, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/studio/recordings/${encodeURIComponent(documentId)}/transcribe`, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async transferStudioDocument(documentId: string, input: TransferStudioDocumentInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/studio/documents/${encodeURIComponent(documentId)}/transfer`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async createStudioCategory(input: CreateStudioCategoryInput, signal?: AbortSignal): Promise<StudioWorkspace> {
    return await this.request<StudioWorkspace>('/api/studio/categories', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async renameStudioCategory(input: RenameStudioCategoryInput, signal?: AbortSignal): Promise<StudioWorkspace> {
    return await this.request<StudioWorkspace>('/api/studio/categories/rename', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async deleteStudioCategory(input: DeleteStudioCategoryInput, signal?: AbortSignal): Promise<StudioWorkspace> {
    return await this.request<StudioWorkspace>('/api/studio/categories/delete', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async createUrl(libraryId: string, input: CreateKnowledgeUrlInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/libraries/${encodeURIComponent(libraryId)}/urls`, {
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

  async updateUrlExtractedContent(documentId: string, input: UpdateKnowledgeUrlExtractedContentInput, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/documents/${encodeURIComponent(documentId)}/url-content`, {
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

  async documentRevisions(documentId: string, signal?: AbortSignal): Promise<KnowledgeDocumentRevisionList> {
    return await this.request<KnowledgeDocumentRevisionList>(`/api/documents/${encodeURIComponent(documentId)}/revisions`, signal === undefined ? {} : { signal })
  }

  async revertDocumentRevision(documentId: string, version: number, signal?: AbortSignal): Promise<KnowledgeDocument> {
    return await this.request<KnowledgeDocument>(`/api/documents/${encodeURIComponent(documentId)}/revisions/${version}/revert`, {
      method: 'POST',
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
