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

export interface DshKnowledgeSearchInput {
  query: string
  knowledgeBaseIds?: string[]
  topK?: number
  favoriteOnly?: boolean
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
}

export interface SystemSnapshot {
  product: 'tiggyknowledge'
  version: string
  catalog: CatalogSummary
  settings: SettingsSnapshot
  semanticSearch: SemanticCapabilitySnapshot
  hostPlugins: PluginInventoryEntry[]
  clientBoot: ClientBootManifest
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'knowledge/graph/invalidate'(): void
  }
}
