import type {} from '@deepseek-ai/cordis'

export type PluginFace = 'host' | 'client'

export type PluginPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disabled'

export type PluginOrigin = 'builtin' | 'third-party'

export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  face: PluginFace
  origin: PluginOrigin
  disableable: boolean
  enabled: boolean
  phase: PluginPhase
}

export interface ClientPluginDescriptor {
  id: string
  moduleName: string
  label: string
  description: string
  url?: string
}

export interface ExternalPluginRecord {
  id: string
  packageName: string
  directory: string
  hostEntry: string
  clientFile?: string
  config: Record<string, unknown>
}

export function hostPluginOrigin(entryId: string, builtinIds?: ReadonlySet<string>): PluginOrigin {
  return builtinIds === undefined || builtinIds.has(entryId) ? 'builtin' : 'third-party'
}

export function clientPluginOrigin(moduleName: string): PluginOrigin {
  return moduleName.startsWith('@tiggyknowledge/') ? 'builtin' : 'third-party'
}

export function pluginDisableable(origin: PluginOrigin): boolean {
  return origin === 'third-party'
}

export interface SetPluginEnabledInput {
  enabled: boolean
}

export interface SetPluginEnabledResult {
  plugin: PluginInventoryEntry
}

export interface ClientBootManifest {
  version: 1
  plugins: ClientPluginDescriptor[]
}

export interface CatalogSummary {
  dataDirectory: string
  databasePath: string
  schemaVersion: number
  libraries: number
  documents: number
}

export interface OpenDataDirectoryResult {
  path: string
}

export type KnowledgeLibraryKind = 'knowledge' | 'studio'

export interface KnowledgeLibrary {
  id: string
  name: string
  description: string
  kind: KnowledgeLibraryKind
  documentCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateKnowledgeLibraryInput {
  name: string
  description?: string
}

export interface UpdateKnowledgeLibraryInput {
  name: string
  description?: string
}

export interface KnowledgeLibraryList {
  items: KnowledgeLibrary[]
}

export interface DeleteKnowledgeLibraryResult {
  deletedLibraryId: string
  deletedDocumentIds: string[]
}

export type KnowledgeDocumentSourceType = 'text' | 'markdown' | 'pdf' | 'url' | 'audio'
export type KnowledgeDocumentIndexStatus = 'pending' | 'ready' | 'failed'

export interface KnowledgeDocument {
  id: string
  libraryId: string
  title: string
  originalName: string
  sourceType: KnowledgeDocumentSourceType
  sourceAssetId: string
  contentHash: string
  sizeBytes: number
  indexStatus: KnowledgeDocumentIndexStatus
  transcript?: string
  audioMimeType?: string
  category?: string
  images?: KnowledgeNoteImage[]
  createdAt: string
  updatedAt: string
}

export interface KnowledgeNoteImage {
  id: string
  mimeType: string
  name: string
}

export interface KnowledgeDocumentList {
  library: KnowledgeLibrary
  items: KnowledgeDocument[]
}

export interface KnowledgeDocumentPreview {
  document: KnowledgeDocument
  content: string
  format: KnowledgeDocumentSourceType
  truncated: boolean
  pageCount?: number
  sourceUrl?: string
}

export interface KnowledgeOkfSource {
  id: string
  resource: string
  title: string
  contentHash: string
  sizeBytes: number
}

export interface KnowledgeOkfMapping {
  documentId: string
  concept: {
    id: string
    type: 'Concept'
    path: string
    title: string
    description: string
    tags: KnowledgeTag[]
    body: string
    generatedBy: string
    generatedAt: string
    sources: KnowledgeOkfSource[]
  }
  storage: {
    bundleState: 'runtime-mapped'
    originalAssetId: string
    indexStatus: KnowledgeDocumentIndexStatus
  }
  validation: {
    status: 'not-run'
    message: string
  }
}

export interface DeleteKnowledgeDocumentsInput {
  ids: string[]
}

export interface DeleteKnowledgeDocumentsResult {
  deletedIds: string[]
}

export interface KnowledgeTag {
  id: string
  name: string
  documentCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocumentMetadata {
  documentId: string
  tags: KnowledgeTag[]
  isFavorite: boolean
}

export interface KnowledgeDocumentWithMetadata {
  document: KnowledgeDocument
  libraryName: string
  metadata: KnowledgeDocumentMetadata
}

export interface KnowledgeTagList {
  items: KnowledgeTag[]
}

export interface KnowledgeMetadataDocumentList {
  items: KnowledgeDocumentWithMetadata[]
}

export interface SetKnowledgeDocumentTagsInput {
  names: string[]
}

export interface SetKnowledgeDocumentFavoriteInput {
  favorite: boolean
}

export interface UpdateKnowledgeDocumentTitleInput {
  title: string
}

export interface UpdateKnowledgeMarkdownNoteInput {
  title: string
  body: string
  tagNames?: string[]
}

export interface UpdateKnowledgeUrlExtractedContentInput {
  title?: string
  text: string
}

export interface UpdateKnowledgePdfOcrInput {
  pages: string[]
}

export interface KnowledgeDocumentRevision {
  documentId: string
  version: number
  title: string
  body: string
  createdAt: string
}

export interface KnowledgeDocumentRevisionList {
  documentId: string
  currentVersion: number
  items: KnowledgeDocumentRevision[]
}

export interface RenameKnowledgeTagInput {
  name: string
}

export type IngestionFileStatus = 'imported' | 'duplicate' | 'failed'

export interface IngestionFileResult {
  fileName: string
  status: IngestionFileStatus
  document?: KnowledgeDocument
  message?: string
}

export interface IngestionBatchResult {
  jobId: string
  libraryId: string
  totalFiles: number
  importedFiles: number
  duplicateFiles: number
  failedFiles: number
  results: IngestionFileResult[]
}

export interface CreateKnowledgeNoteInput {
  title: string
  body: string
  tagNames: string[]
}

export interface StudioWorkspace {
  library: KnowledgeLibrary
  items: KnowledgeDocument[]
  categories: string[]
  transcriptionReady: boolean
}

export interface CreateStudioCategoryInput {
  name: string
}

export interface RenameStudioCategoryInput {
  from: string
  name: string
}

export interface DeleteStudioCategoryInput {
  name: string
}

export interface CreateStudioNoteInput {
  title: string
  body: string
  category?: string
}

export interface CreateStudioRecordingInput {
  title: string
  mimeType: string
  audioBase64: string
  transcript?: string
  category?: string
}

export interface UpdateStudioRecordingInput {
  title?: string
  transcript?: string
  category?: string
}

export interface TransferStudioDocumentInput {
  libraryId: string
}

export interface AttachStudioNoteImageInput {
  mimeType: string
  imageBase64: string
  name?: string
}

export interface StudioNoteImageAttachment {
  document: KnowledgeDocument
  image: KnowledgeNoteImage
  url: string
  markdown: string
}

export interface CreateKnowledgeUrlInput {
  url: string
  title?: string
  tagNames: string[]
}

export type KnowledgeSearchMode = 'auto' | 'keyword' | 'semantic' | 'hybrid'

export interface SemanticCapabilityProvider {
  id: string
  label: string
  description?: string
  model?: string
  dimensions?: number
  modes: Exclude<KnowledgeSearchMode, 'auto' | 'keyword'>[]
  status: 'active' | 'disabled' | 'failed'
}

export interface SemanticCapabilitySnapshot {
  keyword: {
    provider: string
    status: 'active'
    modes: ['keyword']
  }
  semantic: {
    status: 'available' | 'not-configured'
    modes: Exclude<KnowledgeSearchMode, 'auto' | 'keyword'>[]
    providers: SemanticCapabilityProvider[]
    message: string
  }
  enabledModes: KnowledgeSearchMode[]
}

export interface KnowledgeQuery {
  text: string
  knowledgeBaseIds: string[]
  mode?: KnowledgeSearchMode
  topK?: number
  favoriteOnly?: boolean
}

export interface KnowledgeSearchResult {
  chunkId: string
  knowledgeBaseId: string
  documentId: string
  title: string
  originalName: string
  sourceType: KnowledgeDocumentSourceType
  location: string
  snippet: string
  score: number
  tags: KnowledgeTag[]
  isFavorite: boolean
}

export interface KnowledgeSearchResponse {
  query: string
  mode: 'keyword'
  total: number
  results: KnowledgeSearchResult[]
}

export type KnowledgeGraphScope = 'global' | 'local'
export type KnowledgeGraphNodeKind = 'document' | 'missing'

export interface KnowledgeGraphNode {
  id: string
  label: string
  kind: KnowledgeGraphNodeKind
  libraryId?: string
  libraryName?: string
  documentId?: string
  originalName?: string
  sourceType?: KnowledgeDocumentSourceType
  tags: KnowledgeTag[]
  linkCount: number
  incomingCount: number
  outgoingCount: number
  missing?: boolean
}

export interface KnowledgeGraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface KnowledgeGraphQuery {
  libraryId?: string
  documentId?: string
  depth?: number
  includeMissing?: boolean
}

export interface KnowledgeGraphResponse {
  scope: KnowledgeGraphScope
  generatedAt: string
  depth: number
  libraryId?: string
  centerDocumentId?: string
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
}

export interface SettingsSnapshot {
  path: string
  values: Record<string, unknown>
}

export interface DshIntegrationAccessKeyMetadata {
  preview: string
  createdAt: string
}

export interface DshIntegrationSettings {
  enabled: boolean
  endpoint: string
  tokenEnvName: string
  defaultKnowledgeBaseIds: string[]
  accessKey?: DshIntegrationAccessKeyMetadata
}

export type MineruModelVersion = 'pipeline' | 'vlm'

export interface MineruSettings {
  enabled: boolean
  baseUrl: string
  modelVersion: MineruModelVersion
  language: string
  enableTable: boolean
  enableFormula: boolean
  apiKeyConfigured: boolean
  apiKeyPreview?: string
}

export interface UpdateMineruSettingsInput {
  enabled?: boolean
  baseUrl?: string
  modelVersion?: MineruModelVersion
  language?: string
  enableTable?: boolean
  enableFormula?: boolean
}

export interface SetMineruApiKeyInput {
  apiKey: string
}

export interface MineruPdfOcrResult {
  document: KnowledgeDocument
  taskId: string
  pageCount: number
  truncated: boolean
}

export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 120_000
export const DEFAULT_LLM_MAX_INPUT_TOKENS = 32_000
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 4_096
export const LEGACY_LLM_PROVIDER_ID = 'legacy-provider'
export const LEGACY_LLM_MODEL_ID = 'legacy-model'

export interface LlmProviderModel {
  id: string
  name: string
  model: string
}

export interface LlmProviderSettings {
  id: string
  name: string
  baseUrl: string
  requestTimeoutMs: number
  maxInputTokens: number
  maxOutputTokens: number
  models: LlmProviderModel[]
  apiKeyConfigured: boolean
  apiKeyPreview?: string
}

export interface LlmIntegrationSettings {
  providers: LlmProviderSettings[]
  preferredModelId?: string
  wikiModelId?: string
  transcriptionModelId?: string
}

export interface LlmResolvedEndpoint {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  baseUrl: string
  model: string
  requestTimeoutMs: number
  maxInputTokens: number
  maxOutputTokens: number
  apiKeyConfigured: boolean
}

export interface LlmModelChoice {
  id: string
  providerId: string
  providerName: string
  model: string
  name: string
  label: string
  apiKeyConfigured: boolean
}

export interface UpdateLlmProviderModelInput {
  id?: string
  name?: string
  model: string
}

export interface UpdateLlmProviderInput {
  id?: string
  name: string
  baseUrl: string
  requestTimeoutMs?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  models: UpdateLlmProviderModelInput[]
}

export interface UpdateLlmIntegrationSettingsInput {
  providers?: UpdateLlmProviderInput[]
  preferredModelId?: string | null
  wikiModelId?: string | null
  transcriptionModelId?: string | null
}

export interface SetLlmApiKeyInput {
  providerId: string
  apiKey: string
}

export interface TestLlmConnectionInput {
  providerId: string
  modelId?: string
}

export interface TestLlmConnectionResult {
  ok: true
  providerId: string
  model: string
  message: string
}

export function llmModelChoices(settings: LlmIntegrationSettings): LlmModelChoice[] {
  const choices: LlmModelChoice[] = []
  for (const provider of settings.providers) {
    for (const model of provider.models) {
      const name = model.name.trim() || model.model
      choices.push({
        id: model.id,
        providerId: provider.id,
        providerName: provider.name,
        model: model.model,
        name,
        label: `${provider.name} / ${name}`,
        apiKeyConfigured: provider.apiKeyConfigured,
      })
    }
  }
  return choices
}

export function resolveLlmModel(settings: LlmIntegrationSettings, modelId: string | undefined): LlmResolvedEndpoint | undefined {
  if (modelId === undefined || modelId.trim() === '') return undefined
  for (const provider of settings.providers) {
    const model = provider.models.find(item => item.id === modelId)
    if (model === undefined) continue
    const modelName = model.name.trim() || model.model
    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      modelName,
      baseUrl: provider.baseUrl,
      model: model.model,
      requestTimeoutMs: provider.requestTimeoutMs,
      maxInputTokens: provider.maxInputTokens,
      maxOutputTokens: provider.maxOutputTokens,
      apiKeyConfigured: provider.apiKeyConfigured,
    }
  }
  return undefined
}

export function resolvePreferredLlmModel(settings: LlmIntegrationSettings): LlmResolvedEndpoint | undefined {
  return resolveLlmModel(settings, settings.preferredModelId)
    ?? resolveLlmModel(settings, settings.providers.find(provider => provider.models[0] !== undefined)?.models[0]?.id)
}

export function resolveWikiLlmModel(settings: LlmIntegrationSettings): LlmResolvedEndpoint | undefined {
  return resolveLlmModel(settings, settings.wikiModelId) ?? resolvePreferredLlmModel(settings)
}

export function resolveTranscriptionLlmModel(settings: LlmIntegrationSettings): LlmResolvedEndpoint | undefined {
  return resolveLlmModel(settings, settings.transcriptionModelId)
}

export function resolveLlmProviderModel(
  settings: LlmIntegrationSettings,
  providerId: string,
  modelId?: string,
): LlmResolvedEndpoint | undefined {
  const provider = settings.providers.find(item => item.id === providerId)
  if (provider === undefined) return undefined
  const model = modelId === undefined || modelId.trim() === ''
    ? provider.models[0]
    : provider.models.find(item => item.id === modelId)
  if (model === undefined) return undefined
  return resolveLlmModel(settings, model.id)
}

export function isLlmReady(settings: LlmIntegrationSettings): boolean {
  const endpoint = resolveWikiLlmModel(settings)
  return endpoint !== undefined && endpoint.apiKeyConfigured && endpoint.model.trim().length > 0
}

export function isTranscriptionReady(settings: LlmIntegrationSettings): boolean {
  const endpoint = resolveTranscriptionLlmModel(settings)
  return endpoint !== undefined && endpoint.apiKeyConfigured && endpoint.model.trim().length > 0
}

export type WikiGenerationMode = 'initial' | 'incremental' | 'rebuild' | 'document'
export type WikiGenerationState = 'pending' | 'running' | 'planned' | 'completed' | 'failed' | 'cancelled'
export type WikiState = 'never-generated' | 'ready' | 'stale' | 'generating' | 'awaiting-confirmation' | 'failed'
export type WikiSectionState = 'ready' | 'stale' | 'source-missing' | 'locked'
export type WikiPageType =
  | 'summary'
  | 'entity'
  | 'concept'
  | 'glossary'
  | 'project'
  | 'policy'
  | 'procedure'
  | 'decision'
  | 'event'
  | 'topic'
  | 'index'
  | 'synthesis'
  | 'comparison'
export type WikiPageStatus = 'draft' | 'published' | 'archived'
export type WikiEditSource = 'pipeline' | 'user' | 'revert'

export interface WikiChangeSummary {
  totalDocuments: number
  added: number
  updated: number
  deleted: number
}

export interface WikiSource {
  documentId: string
  libraryId: string
  title: string
  referenceUri: `tk://local/${string}`
  contentHash: string
}

export interface WikiSection {
  id: string
  title: string
  body: string
  order: number
  state: WikiSectionState
  sources: WikiSource[]
}

export interface WikiPageSummary {
  id: string
  slug: string
  title: string
  summary: string
  pageType: WikiPageType
  status: WikiPageStatus
  aliases: string[]
  purpose: string
  questions: string[]
  folderId?: string
  parentId?: string
  order: number
  state: WikiSectionState
  version: number
  lastEditSource: WikiEditSource
  updatedAt: string
}

export interface WikiPage extends WikiPageSummary {
  sections: WikiSection[]
  outLinks: string[]
  inLinks: string[]
}

export interface WikiFolder {
  id: string
  name: string
  path: string
  parentId?: string
  depth: number
  order: number
}

export type WikiInboxChange = 'added' | 'updated'

export interface WikiInboxItem {
  documentId: string
  libraryId: string
  libraryName: string
  title: string
  contentHash: string
  change: WikiInboxChange
  locked: boolean
}

export interface WikiSkippedItem extends WikiInboxItem {
  skippedAt: string
}

export interface WikiStatus {
  state: WikiState
  llmConfigured: boolean
  pageCount: number
  lastGeneratedAt?: string
  activeGenerationId?: string
  lastGeneration?: WikiGeneration
  changes: WikiChangeSummary
  inbox: WikiInboxItem[]
  reviews: WikiPageSummary[]
  skipped: WikiSkippedItem[]
  queuedDocumentIds: string[]
}

export interface WikiEstimate {
  mode: WikiGenerationMode
  documentsToProcess: number
  estimatedInputTokens: number
  changes: WikiChangeSummary
}

export interface WikiGeneration {
  id: string
  mode: WikiGenerationMode
  state: WikiGenerationState
  phase: string
  totalSteps: number
  completedSteps: number
  estimatedInputTokens: number
  inputTokens: number
  outputTokens: number
  candidateCount?: number
  acceptedCandidateCount?: number
  plan?: WikiGenerationPlan
  createdAt: string
  completedAt?: string
  error?: string
}

export type WikiCandidateAction = 'create' | 'update' | 'restore'

export interface WikiGenerationCandidate {
  title: string
  slug: string
  pageType: WikiPageType
  aliases: string[]
  purpose: string
  questions: string[]
  folderPath: string[]
  sourceDocumentIds: string[]
  sourceTitles: string[]
  factCount: number
  referencePotential: number
  stableIdentity: boolean
  transient: boolean
  estimatedCharacters: number
  score: number
  reasons: string[]
  action: WikiCandidateAction
}

export interface WikiGenerationPlan {
  documentFingerprint: string
  documentId?: string
  candidates: WikiGenerationCandidate[]
  archivePages: Array<Pick<WikiPageSummary, 'id' | 'slug' | 'title' | 'pageType' | 'purpose'>>
  preservedPageCount: number
}

export interface StartWikiGenerationInput {
  mode?: WikiGenerationMode
  documentId?: string
  force?: boolean
}

export interface ConfirmWikiGenerationInput {
  candidateSlugs: string[]
  archiveSlugs?: string[]
}

export interface UpdateWikiPageInput {
  title: string
  summary?: string
  pageType?: WikiPageType
  status?: WikiPageStatus
  folderId?: string | null
  aliases?: string[]
  purpose?: string
  questions?: string[]
  expectedVersion: number
  sections: Array<Pick<WikiSection, 'id' | 'title' | 'body'>>
}

export interface CreateWikiPageInput {
  title: string
  summary?: string
  pageType?: WikiPageType
  folderId?: string
  aliases?: string[]
  purpose?: string
  questions?: string[]
  sectionTitle?: string
  body: string
}

export interface AssistWikiPageInput {
  title: string
  pageType?: WikiPageType
  notes?: string
}

export interface AssistWikiPageResult {
  summary: string
  purpose: string
  questions: string[]
  sectionTitle: string
  body: string
}

export interface CreateWikiFolderInput {
  name: string
  parentId?: string
}

export interface UpdateWikiFolderInput {
  name: string
}

export interface WikiPageRevision {
  pageId: string
  version: number
  title: string
  summary: string
  pageType: WikiPageType
  status: WikiPageStatus
  aliases: string[]
  purpose: string
  questions: string[]
  sections: WikiSection[]
  editSource: WikiEditSource
  editedAt: string
}

export interface UnlockWikiPageInput {
  expectedVersion: number
}

export interface PublishWikiPageInput {
  expectedVersion: number
}

export interface RevertWikiPageInput {
  version: number
  expectedVersion: number
}

export type WikiIssueType = 'contradictory-facts' | 'out-of-date' | 'mixed-entities' | 'source-missing' | 'other'
export type WikiIssueStatus = 'open' | 'resolved'

export interface WikiIssue {
  id: string
  pageId: string
  pageTitle: string
  type: WikiIssueType
  description: string
  status: WikiIssueStatus
  createdAt: string
  updatedAt: string
}

export interface CreateWikiIssueInput {
  pageId: string
  type: WikiIssueType
  description: string
}

export interface UpdateWikiIssueInput {
  status: WikiIssueStatus
}

export type WikiLintType = 'source-missing' | 'content-too-short' | 'empty-summary' | 'orphan-page' | 'dead-link'
export type WikiLintSeverity = 'warning' | 'info'

export interface WikiLintFinding {
  id: string
  pageId: string
  pageTitle: string
  type: WikiLintType
  severity: WikiLintSeverity
  message: string
}

export interface WikiGovernanceSnapshot {
  openIssues: number
  lintFindings: number
  archivedPages: number
}

export interface UpdateDshIntegrationSettingsInput {
  enabled?: boolean
  endpoint?: string
  tokenEnvName?: string
  defaultKnowledgeBaseIds?: string[]
}

export interface GenerateDshIntegrationAccessKeyResult {
  accessKey: string
  settings: SettingsSnapshot
}

export interface DshKnowledgeStatus {
  product: 'tiggyknowledge'
  version: string
  dataDirectory: string
  libraries: number
  documents: number
  capabilities: {
    search: true
    read: true
    okf: boolean
    write: false
  }
}

export type KnowledgeCapabilityOperationId = 'status' | 'libraries' | 'search' | 'read' | 'okf'

export interface KnowledgeCapabilityOperation {
  id: KnowledgeCapabilityOperationId
  method: 'GET' | 'POST'
  path: string
  readOnly: true
}

export interface KnowledgeCapabilities {
  protocolVersion: 1
  basePath: '/api/tiggyknowledge'
  authentication: 'bearer'
  operations: KnowledgeCapabilityOperation[]
  searchModes: KnowledgeSearchMode[]
  referenceSchemes: ['tk://local']
  write: false
}

export interface CapabilitiesSnapshot {
  product: 'tiggyknowledge'
  version: string
  capabilities: KnowledgeCapabilities
  hostPlugins: PluginInventoryEntry[]
}

export interface DshKnowledgeLibraryList {
  items: KnowledgeLibrary[]
}

export interface KnowledgeSourceReference {
  uri: `tk://local/${string}`
  knowledgeBaseId: string
  documentId: string
  title: string
  sourceType: KnowledgeDocumentSourceType
}

export interface DshKnowledgeSearchInput {
  query: string
  knowledgeBaseIds?: string[]
  topK?: number
  favoriteOnly?: boolean
}

export interface DshKnowledgeSearchResult extends KnowledgeSearchResult {
  reference: KnowledgeSourceReference
}

export interface DshKnowledgeSearchResponse {
  query: string
  mode: 'keyword'
  total: number
  results: DshKnowledgeSearchResult[]
}

export interface DshKnowledgeReadResponse {
  documentId: string
  knowledgeBaseId: string
  title: string
  originalName: string
  sourceType: KnowledgeDocumentSourceType
  content: string
  offset: number
  returnedCharacters: number
  totalCharacters: number
  hasMore: boolean
  nextOffset?: number
  sourceTruncated: boolean
  truncated: boolean
  available?: boolean
  pageCount?: number
  reference?: KnowledgeSourceReference
}

export interface DshKnowledgeOkfResponse extends KnowledgeOkfMapping {
  reference?: KnowledgeSourceReference
}

export type LibraryChatMessageRole = 'user' | 'assistant'
export type LibraryChatMessageState = 'generating' | 'completed' | 'cancelled' | 'failed'

export interface LibraryChatTokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface LibraryChatSource {
  citationNumber?: number
  documentId: string
  libraryId: string
  title: string
  referenceUri: `tk://local/${string}`
  location: string
  snippet: string
  score: number
}

export interface LibraryChatMessage {
  id: string
  libraryId: string
  role: LibraryChatMessageRole
  state: LibraryChatMessageState
  content: string
  modelId?: string
  sources: LibraryChatSource[]
  tokenUsage: LibraryChatTokenUsage
  createdAt: string
  updatedAt: string
  error?: string
}

export interface LibraryChatSummary {
  content: string
  cutoffMessageId: string
  updatedAt: string
}

export interface LibraryChatSnapshot {
  libraryId: string
  messages: LibraryChatMessage[]
  summary?: LibraryChatSummary
  activeMessageId?: string
}

export type LibraryChatTask =
  | 'retrieval'
  | 'summarize-current-document'
  | 'summarize-named-document'
  | 'summarize-library'

export interface SendLibraryChatMessageInput {
  content: string
  modelId?: string
  contextDocumentId?: string
  taskOverride?: LibraryChatTask
}

export type LibraryChatStreamEvent =
  | { type: 'started'; userMessage: LibraryChatMessage; assistantMessage: LibraryChatMessage }
  | { type: 'routed'; messageId: string; task: LibraryChatTask }
  | { type: 'progress'; messageId: string; completed: number; total: number; phase?: string; message?: string }
  | { type: 'sources'; messageId: string; sources: LibraryChatSource[] }
  | { type: 'delta'; messageId: string; delta: string }
  | { type: 'usage'; messageId: string; usage: LibraryChatTokenUsage }
  | { type: 'completed'; message: LibraryChatMessage }
  | { type: 'cancelled'; message: LibraryChatMessage }
  | { type: 'error'; messageId: string; error: string }

export interface CancelLibraryChatResult {
  libraryId: string
  cancelled: boolean
  message?: LibraryChatMessage
}

export interface SystemSnapshot {
  product: 'tiggyknowledge'
  version: string
  catalog: CatalogSummary
  settings: SettingsSnapshot
  llm?: LlmIntegrationSettings
  mineru?: MineruSettings
  semanticSearch: SemanticCapabilitySnapshot
  hostPlugins: PluginInventoryEntry[]
  clientBoot: ClientBootManifest
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'knowledge/graph/invalidate'(): void
    'knowledge/library/deleted'(libraryId: string): void
    'knowledge/document/changed'(documentIds: string[]): void
    'knowledge/document/deleted'(documentIds: string[]): void
  }
}
