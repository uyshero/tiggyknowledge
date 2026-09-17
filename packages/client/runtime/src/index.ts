import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { ComponentType, ElementType } from 'react'
import type { KnowledgeDocument, KnowledgeDocumentMetadata, KnowledgeDocumentPreview, KnowledgeDocumentSourceType, KnowledgeLibrary, PluginInventoryEntry, PluginPhase, SystemSnapshot } from '@tiggyknowledge/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    clientApp: ClientAppService
  }
}

export interface PageDefinition {
  id: string
  label: string
  icon: ElementType
  component: ComponentType
  order: number
  section: 'primary' | 'secondary' | 'hidden'
}

export interface DocumentPreviewRendererProps {
  contentUrl: string
  preview: KnowledgeDocumentPreview
  targetLocation?: string
  targetQuery?: string
}

export interface DocumentPreviewRendererDefinition {
  component: ComponentType<DocumentPreviewRendererProps>
  format: KnowledgeDocumentSourceType
}

export interface DocumentInspectorProps {
  documentId: string
  document?: KnowledgeDocument
  metadata?: KnowledgeDocumentMetadata
  preview?: KnowledgeDocumentPreview
}

export interface DocumentInspectorDefinition {
  id: string
  label: string
  icon: ElementType
  component: ComponentType<DocumentInspectorProps>
  order: number
}

export interface LibraryActionProps {
  library: KnowledgeLibrary
}

export interface LibraryActionDefinition {
  id: string
  component: ComponentType<LibraryActionProps>
  order: number
}

export interface SettingsPanelProps {
  error?: string
  onSystemChange?: (system: SystemSnapshot) => void
  system?: SystemSnapshot
}

export interface SettingsPanelDefinition {
  component: ComponentType<SettingsPanelProps>
  default?: boolean
  id: string
  label: string
  order: number
}

export interface AppOverlayDefinition {
  component: ComponentType
  id: string
  order: number
}

export interface ClientAppSnapshot {
  pages: PageDefinition[]
  appOverlays: AppOverlayDefinition[]
  documentInspectors: DocumentInspectorDefinition[]
  libraryActions: LibraryActionDefinition[]
  settingsPanels: SettingsPanelDefinition[]
  selectedPageId: string | undefined
  pageState: unknown
  revision: number
}

const PHASES: Record<FiberState, Exclude<PluginPhase, 'disabled'>> = {
  [FiberState.PENDING]: 'pending',
  [FiberState.LOADING]: 'loading',
  [FiberState.ACTIVE]: 'active',
  [FiberState.FAILED]: 'failed',
  [FiberState.DISPOSED]: 'failed',
  [FiberState.UNLOADING]: 'unloading',
}

export class ClientAppService extends Service {
  static inject = ['loader']

  private readonly pages = new Map<string, PageDefinition>()
  private readonly documentPreviewRenderers = new Map<KnowledgeDocumentSourceType, DocumentPreviewRendererDefinition>()
  private readonly documentInspectorDefinitions = new Map<string, DocumentInspectorDefinition>()
  private readonly libraryActionDefinitions = new Map<string, LibraryActionDefinition>()
  private readonly settingsPanelDefinitions = new Map<string, SettingsPanelDefinition>()
  private readonly appOverlayDefinitions = new Map<string, AppOverlayDefinition>()
  private readonly listeners = new Set<() => void>()
  private snapshotValue: ClientAppSnapshot = { pages: [], appOverlays: [], documentInspectors: [], libraryActions: [], settingsPanels: [], selectedPageId: undefined, pageState: undefined, revision: 0 }

  constructor(ctx: Context) {
    super(ctx, 'clientApp')
    ctx.on('internal/status', () => this.publish())
  }

  registerPage(page: PageDefinition): () => void {
    if (this.pages.has(page.id)) throw new Error(`client-runtime: duplicate page ${page.id}`)
    this.pages.set(page.id, page)
    this.publish(this.snapshotValue.selectedPageId ?? page.id, this.snapshotValue.pageState)
    return () => {
      this.pages.delete(page.id)
      const selected = this.snapshotValue.selectedPageId === page.id ? undefined : this.snapshotValue.selectedPageId
      this.publish(selected, selected === undefined ? undefined : this.snapshotValue.pageState)
    }
  }

  registerDocumentPreviewRenderer(renderer: DocumentPreviewRendererDefinition): () => void {
    if (this.documentPreviewRenderers.has(renderer.format)) throw new Error(`client-runtime: duplicate document preview renderer ${renderer.format}`)
    this.documentPreviewRenderers.set(renderer.format, renderer)
    this.publish()
    return () => {
      this.documentPreviewRenderers.delete(renderer.format)
      this.publish()
    }
  }

  documentPreviewRenderer(format: KnowledgeDocumentSourceType): DocumentPreviewRendererDefinition | undefined {
    return this.documentPreviewRenderers.get(format)
  }

  registerDocumentInspector(inspector: DocumentInspectorDefinition): () => void {
    if (this.documentInspectorDefinitions.has(inspector.id)) throw new Error(`client-runtime: duplicate document inspector ${inspector.id}`)
    this.documentInspectorDefinitions.set(inspector.id, inspector)
    this.publish()
    return () => {
      this.documentInspectorDefinitions.delete(inspector.id)
      this.publish()
    }
  }

  registerLibraryAction(action: LibraryActionDefinition): () => void {
    if (this.libraryActionDefinitions.has(action.id)) throw new Error(`client-runtime: duplicate library action ${action.id}`)
    this.libraryActionDefinitions.set(action.id, action)
    this.publish()
    return () => {
      this.libraryActionDefinitions.delete(action.id)
      this.publish()
    }
  }

  registerSettingsPanel(panel: SettingsPanelDefinition): () => void {
    if (this.settingsPanelDefinitions.has(panel.id)) throw new Error(`client-runtime: duplicate settings panel ${panel.id}`)
    this.settingsPanelDefinitions.set(panel.id, panel)
    this.publish()
    return () => {
      this.settingsPanelDefinitions.delete(panel.id)
      this.publish()
    }
  }

  registerAppOverlay(overlay: AppOverlayDefinition): () => void {
    if (this.appOverlayDefinitions.has(overlay.id)) throw new Error(`client-runtime: duplicate app overlay ${overlay.id}`)
    this.appOverlayDefinitions.set(overlay.id, overlay)
    this.publish()
    return () => {
      this.appOverlayDefinitions.delete(overlay.id)
      this.publish()
    }
  }

  selectPage(id: string, pageState?: unknown): void {
    if (!this.pages.has(id)) return
    this.publish(id, pageState)
  }

  updatePageState(pageState: unknown): void {
    if (Object.is(pageState, this.snapshotValue.pageState)) return
    this.publish(this.snapshotValue.selectedPageId, pageState)
  }

  getSnapshot = (): ClientAppSnapshot => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clientPlugins(): PluginInventoryEntry[] {
    return [...this.ctx.loader.entries()]
      .filter(entry => !entry.options.group)
      .map(entry => ({
        entryId: entry.id,
        moduleName: entry.options.name.replace(/^cordis:/, ''),
        face: 'client',
        enabled: !entry.disabled,
        phase: entry.disabled ? 'disabled' : entry.fiber === undefined ? 'failed' : PHASES[entry.fiber.state],
      }))
  }

  private publish(selectedPageId: string | undefined = this.snapshotValue.selectedPageId, pageState: unknown = this.snapshotValue.pageState): void {
    const pages = [...this.pages.values()].sort((left, right) => left.order - right.order)
    const selected = selectedPageId !== undefined && this.pages.has(selectedPageId)
      ? selectedPageId
      : pages[0]?.id
    this.snapshotValue = {
      pages,
      appOverlays: [...this.appOverlayDefinitions.values()].sort((left, right) => left.order - right.order),
      documentInspectors: [...this.documentInspectorDefinitions.values()].sort((left, right) => left.order - right.order),
      libraryActions: [...this.libraryActionDefinitions.values()].sort((left, right) => left.order - right.order),
      settingsPanels: [...this.settingsPanelDefinitions.values()].sort((left, right) => left.order - right.order),
      selectedPageId: selected,
      pageState: selected === selectedPageId ? pageState : undefined,
      revision: this.snapshotValue.revision + 1,
    }
    for (const listener of this.listeners) listener()
  }
}

export default ClientAppService
