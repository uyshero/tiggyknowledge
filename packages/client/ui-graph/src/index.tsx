import type { Context } from '@deepseek-ai/cordis'
import { ArrowLeft, FileText, Network, RefreshCcw, Waypoints } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeGraphNode, KnowledgeGraphQuery, KnowledgeGraphResponse, KnowledgeLibrary } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

interface GraphPageState {
  libraryId?: string
  documentId?: string
  depth?: number
}

function routeState(value: unknown): GraphPageState {
  if (value === null || typeof value !== 'object') return {}
  const input = value as Record<string, unknown>
  return {
    ...(typeof input.libraryId === 'string' ? { libraryId: input.libraryId } : {}),
    ...(typeof input.documentId === 'string' ? { documentId: input.documentId } : {}),
    ...(typeof input.depth === 'number' ? { depth: input.depth } : {}),
  }
}

function clampDepth(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(4, Math.max(1, Math.round(value)))
}

function degree(node: KnowledgeGraphNode, edges: KnowledgeGraphResponse['edges']): number {
  return edges.filter(edge => edge.source === node.id || edge.target === node.id).length
}

function truncateLabel(label: string, maxLength = 18): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label
}

function buildPositions(snapshot: KnowledgeGraphResponse): Map<string, { x: number, y: number }> {
  const positions = new Map<string, { x: number, y: number }>()
  const center = { x: 600, y: 390 }
  const docs = snapshot.nodes.filter(node => !node.missing)
  const missing = snapshot.nodes.filter(node => node.missing)

  if (snapshot.scope === 'local' && snapshot.centerDocumentId !== undefined) {
    const centerNode = docs.find(node => node.documentId === snapshot.centerDocumentId)
    if (centerNode !== undefined) positions.set(centerNode.id, center)
    const linked = docs.filter(node => node.id !== centerNode?.id).sort((left, right) => degree(right, snapshot.edges) - degree(left, snapshot.edges) || left.label.localeCompare(right.label, 'zh-CN'))
    const rings = new Map<number, KnowledgeGraphNode[]>()
    for (const node of linked) {
      const depth = Math.min(snapshot.depth, Math.max(1, degree(node, snapshot.edges)))
      const list = rings.get(depth) ?? []
      list.push(node)
      rings.set(depth, list)
    }
    for (const [ring, nodes] of rings) {
      const radius = 170 + (ring - 1) * 165
      nodes.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2
        positions.set(node.id, {
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius,
        })
      })
    }
  } else {
    const libraryGroups = new Map<string, KnowledgeGraphNode[]>()
    for (const node of docs) {
      const groupKey = node.libraryId ?? 'unknown'
      const list = libraryGroups.get(groupKey) ?? []
      list.push(node)
      libraryGroups.set(groupKey, list)
    }
    const groups = [...libraryGroups.entries()].sort((left, right) => left[1].length - right[1].length)
    const groupRadius = groups.length > 1 ? 235 : 0
    groups.forEach(([libraryId, nodes], groupIndex) => {
      const groupCenter = groups.length > 1
        ? {
            x: center.x + Math.cos((Math.PI * 2 * groupIndex) / groups.length - Math.PI / 2) * groupRadius,
            y: center.y + Math.sin((Math.PI * 2 * groupIndex) / groups.length - Math.PI / 2) * 165,
          }
        : center
      const hub = nodes.toSorted((left, right) => degree(right, snapshot.edges) - degree(left, snapshot.edges) || left.label.localeCompare(right.label, 'zh-CN'))
      hub.forEach((node, index) => {
        const ring = index === 0 ? 0 : index <= 5 ? 1 : 2
        if (ring === 0) {
          positions.set(node.id, groupCenter)
          return
        }
        const listSize = hub.filter((_, itemIndex) => (itemIndex === 0 ? false : itemIndex <= 5 ? 1 : 2) === ring).length
        const ringIndex = ring === 1 ? index - 1 : index - 6
        const radius = ring === 1 ? 110 : 190
        const angle = listSize <= 1 ? 0 : (Math.PI * 2 * ringIndex) / listSize - Math.PI / 2
        positions.set(node.id, {
          x: groupCenter.x + Math.cos(angle) * radius,
          y: groupCenter.y + Math.sin(angle) * radius,
        })
      })
      void libraryId
    })
  }

  if (missing.length > 0) {
    const startX = 120
    const gap = 160
    missing.forEach((node, index) => {
      positions.set(node.id, {
        x: startX + (index % 6) * gap,
        y: 820 + Math.floor(index / 6) * 64,
      })
    })
  }

  return positions
}

function nodeRadius(node: KnowledgeGraphNode): number {
  return node.missing === true ? 28 : 20 + Math.min(node.linkCount * 1.4, 22)
}

export function apply(ctx: Context): void {
  function GraphPage(): JSX.Element {
    const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot)
    const initial = routeState(app.pageState)
    const canvasRef = useRef<HTMLDivElement>(null)
    const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([])
    const [libraryId, setLibraryId] = useState(initial.libraryId ?? '')
    const [documentId, setDocumentId] = useState(initial.documentId)
    const [depth, setDepth] = useState(clampDepth(initial.depth ?? 1))
    const [scope, setScope] = useState<'global' | 'local'>(initial.documentId === undefined ? 'global' : 'local')
    const [snapshot, setSnapshot] = useState<KnowledgeGraphResponse>()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>()
    const [activeNodeId, setActiveNodeId] = useState<string>()
    const [reloadToken, setReloadToken] = useState(0)

    useEffect(() => {
      const controller = new AbortController()
      void ctx.connection.libraries(controller.signal).then(items => {
        setLibraries(items)
        setLibraryId(value => value || items[0]?.id || '')
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '知识库加载失败')
      })
      return () => controller.abort()
    }, [])

    useEffect(() => {
      const next = routeState(app.pageState)
      if (next.libraryId !== undefined) setLibraryId(next.libraryId)
      else setLibraryId('')
      if (next.documentId !== undefined) {
        setDocumentId(next.documentId)
        setScope('local')
      } else {
        setDocumentId(undefined)
        setScope('global')
      }
      if (typeof next.depth === 'number') setDepth(clampDepth(next.depth))
    }, [app.pageState])

    useEffect(() => {
      const controller = new AbortController()
      setLoading(true)
      setError(undefined)
      const localQuery = (): KnowledgeGraphQuery => {
        const next: KnowledgeGraphQuery = { depth }
        if (libraryId.length > 0) next.libraryId = libraryId
        return next
      }
      const globalQuery = (): KnowledgeGraphQuery => {
        const next: KnowledgeGraphQuery = {}
        if (libraryId.length > 0) next.libraryId = libraryId
        return next
      }
      const request = scope === 'local' && documentId !== undefined
        ? ctx.connection.documentGraph(documentId, localQuery(), controller.signal)
        : ctx.connection.graph(globalQuery(), controller.signal)
      void request.then(result => {
        setSnapshot(result)
        setActiveNodeId(current => {
          if (result.centerDocumentId !== undefined) return result.centerDocumentId
          if (current !== undefined && result.nodes.some(node => node.id === current)) return current
          return result.nodes[0]?.id
        })
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '图谱加载失败')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
      return () => controller.abort()
    }, [scope, libraryId, documentId, depth, reloadToken])

    const positions = useMemo(() => snapshot === undefined ? new Map<string, { x: number, y: number }>() : buildPositions(snapshot), [snapshot])
    const activeNode = snapshot?.nodes.find(node => node.id === activeNodeId)
    const selectedLibrary = libraries.find(library => library.id === libraryId)
    const includeEdges = snapshot?.edges ?? []
    const focusState = useMemo(() => {
      if (snapshot === undefined || activeNodeId === undefined) {
        return { nodes: undefined as Set<string> | undefined, edges: undefined as Set<string> | undefined }
      }
      const nodes = new Set<string>([activeNodeId])
      const edges = new Set<string>()
      for (const edge of snapshot.edges) {
        if (edge.source !== activeNodeId && edge.target !== activeNodeId) continue
        edges.add(edge.id)
        nodes.add(edge.source)
        nodes.add(edge.target)
      }
      return { nodes, edges }
    }, [snapshot, activeNodeId])

    const openNode = (node: KnowledgeGraphNode): void => {
      setActiveNodeId(node.id)
    }

    const goBack = (): void => {
      if (scope === 'local') {
        setScope('global')
        return
      }
      ctx.clientApp.selectPage('documents')
    }

    const openDocument = (): void => {
      if (activeNode?.documentId === undefined || activeNode.missing === true) return
      ctx.clientApp.selectPage('documents', { libraryId: activeNode.libraryId, documentId: activeNode.documentId })
    }

    const openLocalGraph = (): void => {
      if (activeNode?.documentId === undefined || activeNode.missing === true) return
      setDocumentId(activeNode.documentId)
      setScope('local')
    }

    return (
      <div className="page graph-page">
        <header className="page-header compact-header graph-header">
          <div className="documents-title">
            <button className="icon-button" type="button" title={scope === 'local' ? '返回全局图谱' : '返回知识条目'} onClick={goBack}><ArrowLeft size={18} /></button>
            <div>
              <p className="eyebrow">关系图谱</p>
              <h1>{scope === 'local' && activeNode?.label !== undefined ? `局部图谱 · ${activeNode.label}` : '全局图谱'}</h1>
            </div>
          </div>
          <div className="header-actions">
            <button className={`secondary-button ${scope === 'global' ? 'active' : ''}`} type="button" onClick={() => setScope('global')}>全局</button>
            <button className={`secondary-button ${scope === 'local' ? 'active' : ''}`} type="button" disabled={activeNode?.documentId === undefined || activeNode.missing === true} onClick={openLocalGraph}>当前条目</button>
            <label className="graph-depth-control"><span>深度</span><select value={depth} onChange={event => setDepth(clampDepth(Number(event.target.value)))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
            <button className="secondary-button" type="button" onClick={() => {
              setReloadToken(value => value + 1)
            }}><RefreshCcw size={15} />刷新</button>
          </div>
        </header>

        <div className="graph-toolbar">
          <label><span>知识库</span><select value={libraryId} onChange={event => setLibraryId(event.target.value)}><option value="">全部知识库</option>{libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
          <div className="graph-toolbar-stats">
            <strong>{snapshot?.nodes.length ?? 0}</strong><span>节点</span>
            <strong>{snapshot?.edges.length ?? 0}</strong><span>连线</span>
            <strong>{snapshot?.nodes.filter(node => !node.missing).length ?? 0}</strong><span>文档</span>
          </div>
          <div className="graph-toolbar-hint">{selectedLibrary?.name ?? '全部知识库'}</div>
        </div>

        {loading ? (
          <div className="graph-empty">正在读取图谱…</div>
        ) : error !== undefined ? (
          <div className="graph-empty error-state"><strong>无法读取图谱</strong><span>{error}</span></div>
        ) : snapshot === undefined || snapshot.nodes.length === 0 ? (
          <div className="graph-empty"><Network size={28} /><strong>还没有可以展示的关系</strong><span>导入 Markdown 笔记并使用链接后，这里会自动长出关系网。</span></div>
        ) : (
          <div className="graph-workbench">
            <section className="graph-canvas-pane">
              <div className="graph-canvas" ref={canvasRef}>
                <svg className="graph-svg" viewBox="0 0 1200 980" preserveAspectRatio="xMidYMid meet">
                  <g className="graph-edges">
                    {includeEdges.map(edge => {
                      const source = positions.get(edge.source)
                      const target = positions.get(edge.target)
                      if (source === undefined || target === undefined) return null
                      const muted = focusState.edges !== undefined && !focusState.edges.has(edge.id)
                      return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`${edge.target.startsWith('missing:') ? 'graph-edge missing' : 'graph-edge'}${muted ? ' muted' : ''}`} />
                    })}
                  </g>
                  <g className="graph-nodes">
                    {snapshot.nodes.map(node => {
                      const position = positions.get(node.id)
                      if (position === undefined) return null
                      const selected = activeNodeId === node.id
                      const muted = focusState.nodes !== undefined && !focusState.nodes.has(node.id)
                      const radius = nodeRadius(node)
                      return (
                        <g key={node.id} className={`graph-node ${node.missing ? 'missing' : ''} ${selected ? 'active' : ''}${muted ? ' muted' : ''}`} transform={`translate(${position.x}, ${position.y})`} onClick={() => openNode(node)}>
                          <title>{node.label}{node.missing ? '（未解析）' : ''}</title>
                          <circle r={radius} />
                          <text y={radius + 18}>{truncateLabel(node.label)}</text>
                          <text className="graph-node-meta" y={radius + 34}>{node.missing ? '缺失链接' : (node.libraryName ?? '知识条目')}</text>
                        </g>
                      )
                    })}
                  </g>
                </svg>
              </div>
            </section>
            <aside className="graph-sidebar">
              {activeNode === undefined ? (
                <div className="graph-details-empty"><Waypoints size={24} /><strong>点一个节点看看</strong><span>右侧会显示这个条目的来源、标签和链接数。</span></div>
              ) : (
                <section className="graph-details">
                  <div className="graph-details-title">
                    <h2>{activeNode.label}</h2>
                    <span>{activeNode.missing ? '缺失链接' : activeNode.libraryName}</span>
                  </div>
                  <dl>
                    <div><dt>类型</dt><dd>{activeNode.missing ? '缺失' : activeNode.sourceType ?? '文档'}</dd></div>
                    <div><dt>标签</dt><dd>{activeNode.tags.length > 0 ? activeNode.tags.map(tag => tag.name).join('、') : '暂无标签'}</dd></div>
                    <div><dt>出链</dt><dd>{activeNode.outgoingCount}</dd></div>
                    <div><dt>入链</dt><dd>{activeNode.incomingCount}</dd></div>
                  </dl>
                  <div className="graph-actions">
                    <button className="primary-button" type="button" disabled={activeNode.documentId === undefined || activeNode.missing === true} onClick={openDocument}><FileText size={15} />打开条目</button>
                    {activeNode.documentId !== undefined && activeNode.missing !== true && <button className="secondary-button" type="button" onClick={openLocalGraph}>看局部图谱</button>}
                  </div>
                </section>
              )}
            </aside>
          </div>
        )}
      </div>
    )
  }

  ctx.effect(() => ctx.clientApp.registerPage({
    id: 'graph',
    label: '图谱',
    icon: Network,
    component: GraphPage,
    order: 13,
    section: 'primary',
  }), 'ui-graph: page')
}
