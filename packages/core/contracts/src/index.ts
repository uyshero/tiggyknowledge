import type {} from '@deepseek-ai/cordis'

export type PluginFace = 'host' | 'client'

export type PluginPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | 'disabled'

export interface PluginInventoryEntry {
  entryId: string
  moduleName: string
  face: PluginFace
  enabled: boolean
  phase: PluginPhase
}

export interface ClientPluginDescriptor {
  id: string
  moduleName: string
  label: string
  description: string
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

export interface KnowledgeLibrary {
  id: string
  name: string
  description: string
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

export type KnowledgeDocumentSourceType = 'text' | 'markdown' | 'pdf'
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
  createdAt: string
  updatedAt: string
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
  tagNames: string[]
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

export interface LlmIntegrationSettings {
  enabled: boolean
  baseUrl: string
  model: string
  requestTimeoutMs: number
  maxInputTokens: number
  maxOutputTokens: number
  apiKeyConfigured: boolean
  apiKeyPreview?: string
}

export interface UpdateLlmIntegrationSettingsInput {
  enabled?: boolean
  baseUrl?: string
  model?: string
  requestTimeoutMs?: number
  maxInputTokens?: number
  maxOutputTokens?: number
}

export interface SetLlmApiKeyInput {
  apiKey: string
}

export interface TestLlmConnectionResult {
  ok: true
  model: string
  message: string
}

export type WikiGenerationMode = 'initial' | 'incremental' | 'rebuild'
export type WikiGenerationState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type WikiState = 'never-generated' | 'ready' | 'stale' | 'generating' | 'failed'
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

export interface WikiStatus {
  state: WikiState
  llmConfigured: boolean
  pageCount: number
  lastGeneratedAt?: string
  activeGenerationId?: string
  lastGeneration?: WikiGeneration
  changes: WikiChangeSummary
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
  createdAt: string
  completedAt?: string
  error?: string
}

export interface StartWikiGenerationInput {
  mode: WikiGenerationMode
}

export interface UpdateWikiPageInput {
  title: string
  summary?: string
  pageType?: WikiPageType
  status?: WikiPageStatus
  aliases?: string[]
  purpose?: string
  questions?: string[]
  expectedVersion: number
  sections: Array<Pick<WikiSection, 'id' | 'title' | 'body'>>
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
    okf: true
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

export interface SystemSnapshot {
  product: 'tiggyknowledge'
  version: string
  catalog: CatalogSummary
  settings: SettingsSnapshot
  llm?: LlmIntegrationSettings
  semanticSearch: SemanticCapabilitySnapshot
  hostPlugins: PluginInventoryEntry[]
  clientBoot: ClientBootManifest
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'knowledge/graph/invalidate'(): void
    'knowledge/document/changed'(documentIds: string[]): void
    'knowledge/document/deleted'(documentIds: string[]): void
  }
}
