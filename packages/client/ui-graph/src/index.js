import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowLeft, FileText, Network, RefreshCcw, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
export const inject = ['clientApp', 'connection'];
function routeState(value) {
    if (value === null || typeof value !== 'object')
        return {};
    const input = value;
    return {
        ...(typeof input.libraryId === 'string' ? { libraryId: input.libraryId } : {}),
        ...(typeof input.documentId === 'string' ? { documentId: input.documentId } : {}),
        ...(typeof input.depth === 'number' ? { depth: input.depth } : {}),
    };
}
function clampDepth(value) {
    if (!Number.isFinite(value))
        return 1;
    return Math.min(4, Math.max(1, Math.round(value)));
}
function degree(node, edges) {
    return edges.filter(edge => edge.source === node.id || edge.target === node.id).length;
}
function truncateLabel(label, maxLength = 18) {
    return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}
function buildPositions(snapshot) {
    const positions = new Map();
    const center = { x: 600, y: 390 };
    const docs = snapshot.nodes.filter(node => !node.missing);
    const missing = snapshot.nodes.filter(node => node.missing);
    if (snapshot.scope === 'local' && snapshot.centerDocumentId !== undefined) {
        const centerNode = docs.find(node => node.documentId === snapshot.centerDocumentId);
        if (centerNode !== undefined)
            positions.set(centerNode.id, center);
        const linked = docs.filter(node => node.id !== centerNode?.id).sort((left, right) => degree(right, snapshot.edges) - degree(left, snapshot.edges) || left.label.localeCompare(right.label, 'zh-CN'));
        const rings = new Map();
        for (const node of linked) {
            const depth = Math.min(snapshot.depth, Math.max(1, degree(node, snapshot.edges)));
            const list = rings.get(depth) ?? [];
            list.push(node);
            rings.set(depth, list);
        }
        for (const [ring, nodes] of rings) {
            const radius = 170 + (ring - 1) * 165;
            nodes.forEach((node, index) => {
                const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
                positions.set(node.id, {
                    x: center.x + Math.cos(angle) * radius,
                    y: center.y + Math.sin(angle) * radius,
                });
            });
        }
    }
    else {
        const libraryGroups = new Map();
        for (const node of docs) {
            const groupKey = node.libraryId ?? 'unknown';
            const list = libraryGroups.get(groupKey) ?? [];
            list.push(node);
            libraryGroups.set(groupKey, list);
        }
        const groups = [...libraryGroups.entries()].sort((left, right) => left[1].length - right[1].length);
        const groupRadius = groups.length > 1 ? 235 : 0;
        groups.forEach(([libraryId, nodes], groupIndex) => {
            const groupCenter = groups.length > 1
                ? {
                    x: center.x + Math.cos((Math.PI * 2 * groupIndex) / groups.length - Math.PI / 2) * groupRadius,
                    y: center.y + Math.sin((Math.PI * 2 * groupIndex) / groups.length - Math.PI / 2) * 165,
                }
                : center;
            const hub = nodes.toSorted((left, right) => degree(right, snapshot.edges) - degree(left, snapshot.edges) || left.label.localeCompare(right.label, 'zh-CN'));
            hub.forEach((node, index) => {
                const ring = index === 0 ? 0 : index <= 5 ? 1 : 2;
                if (ring === 0) {
                    positions.set(node.id, groupCenter);
                    return;
                }
                const listSize = hub.filter((_, itemIndex) => (itemIndex === 0 ? false : itemIndex <= 5 ? 1 : 2) === ring).length;
                const ringIndex = ring === 1 ? index - 1 : index - 6;
                const radius = ring === 1 ? 110 : 190;
                const angle = listSize <= 1 ? 0 : (Math.PI * 2 * ringIndex) / listSize - Math.PI / 2;
                positions.set(node.id, {
                    x: groupCenter.x + Math.cos(angle) * radius,
                    y: groupCenter.y + Math.sin(angle) * radius,
                });
            });
            void libraryId;
        });
    }
    if (missing.length > 0) {
        const startX = 120;
        const gap = 160;
        missing.forEach((node, index) => {
            positions.set(node.id, {
                x: startX + (index % 6) * gap,
                y: 820 + Math.floor(index / 6) * 64,
            });
        });
    }
    return positions;
}
function nodeRadius(node) {
    return node.missing === true ? 28 : 20 + Math.min(node.linkCount * 1.4, 22);
}
export function apply(ctx) {
    function GraphPage() {
        const app = useSyncExternalStore(ctx.clientApp.subscribe, ctx.clientApp.getSnapshot);
        const initial = routeState(app.pageState);
        const canvasRef = useRef(null);
        const [libraries, setLibraries] = useState([]);
        const [libraryId, setLibraryId] = useState(initial.libraryId ?? '');
        const [documentId, setDocumentId] = useState(initial.documentId);
        const [depth, setDepth] = useState(clampDepth(initial.depth ?? 1));
        const [scope, setScope] = useState(initial.documentId === undefined ? 'global' : 'local');
        const [snapshot, setSnapshot] = useState();
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState();
        const [activeNodeId, setActiveNodeId] = useState();
        useEffect(() => {
            const controller = new AbortController();
            void ctx.connection.libraries(controller.signal).then(items => {
                setLibraries(items);
                setLibraryId(value => value || items[0]?.id || '');
            }).catch((reason) => {
                if (!controller.signal.aborted)
                    setError(reason instanceof Error ? reason.message : '知识库加载失败');
            });
            return () => controller.abort();
        }, []);
        useEffect(() => {
            const next = routeState(app.pageState);
            if (next.libraryId !== undefined)
                setLibraryId(next.libraryId);
            if (next.documentId !== undefined) {
                setDocumentId(next.documentId);
                setScope('local');
            }
            if (typeof next.depth === 'number')
                setDepth(clampDepth(next.depth));
        }, [app.pageState]);
        useEffect(() => {
            const controller = new AbortController();
            setLoading(true);
            setError(undefined);
            const localQuery = () => {
                const next = { depth };
                if (libraryId.length > 0)
                    next.libraryId = libraryId;
                return next;
            };
            const globalQuery = () => {
                const next = {};
                if (libraryId.length > 0)
                    next.libraryId = libraryId;
                return next;
            };
            const request = scope === 'local' && documentId !== undefined
                ? ctx.connection.documentGraph(documentId, localQuery(), controller.signal)
                : ctx.connection.graph(globalQuery(), controller.signal);
            void request.then(result => {
                setSnapshot(result);
                setActiveNodeId(result.centerDocumentId ?? result.nodes[0]?.id);
            }).catch((reason) => {
                if (!controller.signal.aborted)
                    setError(reason instanceof Error ? reason.message : '图谱加载失败');
            }).finally(() => {
                if (!controller.signal.aborted)
                    setLoading(false);
            });
            return () => controller.abort();
        }, [scope, libraryId, documentId, depth]);
        const positions = useMemo(() => snapshot === undefined ? new Map() : buildPositions(snapshot), [snapshot]);
        const activeNode = snapshot?.nodes.find(node => node.id === activeNodeId);
        const selectedLibrary = libraries.find(library => library.id === libraryId);
        const includeEdges = snapshot?.edges ?? [];
        const openNode = (node) => {
            setActiveNodeId(node.id);
            if (node.documentId !== undefined && !node.missing) {
                setDocumentId(node.documentId);
            }
        };
        const openDocument = () => {
            if (activeNode?.documentId === undefined || activeNode.missing === true)
                return;
            ctx.clientApp.selectPage('documents', { libraryId: activeNode.libraryId, documentId: activeNode.documentId });
        };
        return (_jsxs("div", { className: "page graph-page", children: [_jsxs("header", { className: "page-header compact-header graph-header", children: [_jsxs("div", { className: "documents-title", children: [_jsx("button", { className: "icon-button", type: "button", title: "\u8FD4\u56DE\u77E5\u8BC6\u6761\u76EE", onClick: () => ctx.clientApp.selectPage('documents'), children: _jsx(ArrowLeft, { size: 18 }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u5173\u7CFB\u56FE\u8C31" }), _jsx("h1", { children: scope === 'local' && activeNode?.label !== undefined ? `局部图谱 · ${activeNode.label}` : '全局图谱' })] })] }), _jsxs("div", { className: "header-actions", children: [_jsx("button", { className: `secondary-button ${scope === 'global' ? 'active' : ''}`, type: "button", onClick: () => setScope('global'), children: "\u5168\u5C40" }), _jsx("button", { className: `secondary-button ${scope === 'local' ? 'active' : ''}`, type: "button", disabled: documentId === undefined, onClick: () => setScope('local'), children: "\u5F53\u524D\u6761\u76EE" }), _jsxs("label", { className: "graph-depth-control", children: [_jsx("span", { children: "\u6DF1\u5EA6" }), _jsxs("select", { value: depth, onChange: event => setDepth(clampDepth(Number(event.target.value))), children: [_jsx("option", { value: 1, children: "1" }), _jsx("option", { value: 2, children: "2" }), _jsx("option", { value: 3, children: "3" }), _jsx("option", { value: 4, children: "4" })] })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => {
                                        setLibraryId(value => value);
                                        setDocumentId(value => value);
                                    }, children: [_jsx(RefreshCcw, { size: 15 }), "\u5237\u65B0"] })] })] }), _jsxs("div", { className: "graph-toolbar", children: [_jsxs("label", { children: [_jsx("span", { children: "\u77E5\u8BC6\u5E93" }), _jsxs("select", { value: libraryId, onChange: event => setLibraryId(event.target.value), children: [_jsx("option", { value: "", children: "\u5168\u90E8\u77E5\u8BC6\u5E93" }), libraries.map(library => _jsx("option", { value: library.id, children: library.name }, library.id))] })] }), _jsxs("div", { className: "graph-toolbar-stats", children: [_jsx("strong", { children: snapshot?.nodes.length ?? 0 }), _jsx("span", { children: "\u8282\u70B9" }), _jsx("strong", { children: snapshot?.edges.length ?? 0 }), _jsx("span", { children: "\u8FDE\u7EBF" }), _jsx("strong", { children: snapshot?.nodes.filter(node => !node.missing).length ?? 0 }), _jsx("span", { children: "\u6587\u6863" })] }), _jsx("div", { className: "graph-toolbar-hint", children: selectedLibrary?.name ?? '全部知识库' })] }), loading ? (_jsx("div", { className: "graph-empty", children: "\u6B63\u5728\u8BFB\u53D6\u56FE\u8C31\u2026" })) : error !== undefined ? (_jsxs("div", { className: "graph-empty error-state", children: [_jsx("strong", { children: "\u65E0\u6CD5\u8BFB\u53D6\u56FE\u8C31" }), _jsx("span", { children: error })] })) : snapshot === undefined || snapshot.nodes.length === 0 ? (_jsxs("div", { className: "graph-empty", children: [_jsx(Network, { size: 28 }), _jsx("strong", { children: "\u8FD8\u6CA1\u6709\u53EF\u4EE5\u5C55\u793A\u7684\u5173\u7CFB" }), _jsx("span", { children: "\u5BFC\u5165 Markdown \u7B14\u8BB0\u5E76\u4F7F\u7528\u94FE\u63A5\u540E\uFF0C\u8FD9\u91CC\u4F1A\u81EA\u52A8\u957F\u51FA\u5173\u7CFB\u7F51\u3002" })] })) : (_jsxs("div", { className: "graph-workbench", children: [_jsx("section", { className: "graph-canvas-pane", children: _jsx("div", { className: "graph-canvas", ref: canvasRef, children: _jsxs("svg", { className: "graph-svg", viewBox: "0 0 1200 980", preserveAspectRatio: "xMidYMid meet", children: [_jsx("g", { className: "graph-edges", children: includeEdges.map(edge => {
                                                const source = positions.get(edge.source);
                                                const target = positions.get(edge.target);
                                                if (source === undefined || target === undefined)
                                                    return null;
                                                return _jsx("line", { x1: source.x, y1: source.y, x2: target.x, y2: target.y, className: edge.target.startsWith('missing:') ? 'graph-edge missing' : 'graph-edge' }, edge.id);
                                            }) }), _jsx("g", { className: "graph-nodes", children: snapshot.nodes.map(node => {
                                                const position = positions.get(node.id);
                                                if (position === undefined)
                                                    return null;
                                                const selected = activeNodeId === node.id;
                                                const radius = nodeRadius(node);
                                                return (_jsxs("g", { className: `graph-node ${node.missing ? 'missing' : ''} ${selected ? 'active' : ''}`, transform: `translate(${position.x}, ${position.y})`, onClick: () => openNode(node), children: [_jsxs("title", { children: [node.label, node.missing ? '（未解析）' : ''] }), _jsx("circle", { r: radius }), _jsx("text", { y: radius + 18, children: truncateLabel(node.label) }), _jsx("text", { className: "graph-node-meta", y: radius + 34, children: node.missing ? '缺失链接' : (node.libraryName ?? '知识条目') })] }, node.id));
                                            }) })] }) }) }), _jsx("aside", { className: "graph-sidebar", children: activeNode === undefined ? (_jsxs("div", { className: "graph-details-empty", children: [_jsx(Waypoints, { size: 24 }), _jsx("strong", { children: "\u70B9\u4E00\u4E2A\u8282\u70B9\u770B\u770B" }), _jsx("span", { children: "\u53F3\u4FA7\u4F1A\u663E\u793A\u8FD9\u4E2A\u6761\u76EE\u7684\u6765\u6E90\u3001\u6807\u7B7E\u548C\u94FE\u63A5\u6570\u3002" })] })) : (_jsxs("section", { className: "graph-details", children: [_jsxs("div", { className: "graph-details-title", children: [_jsx("h2", { children: activeNode.label }), _jsx("span", { children: activeNode.missing ? '缺失链接' : activeNode.libraryName })] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u7C7B\u578B" }), _jsx("dd", { children: activeNode.missing ? '缺失' : activeNode.sourceType ?? '文档' })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u6807\u7B7E" }), _jsx("dd", { children: activeNode.tags.length > 0 ? activeNode.tags.map(tag => tag.name).join('、') : '暂无标签' })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u51FA\u94FE" }), _jsx("dd", { children: activeNode.outgoingCount })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u5165\u94FE" }), _jsx("dd", { children: activeNode.incomingCount })] })] }), _jsxs("div", { className: "graph-actions", children: [_jsxs("button", { className: "primary-button", type: "button", disabled: activeNode.documentId === undefined || activeNode.missing === true, onClick: openDocument, children: [_jsx(FileText, { size: 15 }), "\u6253\u5F00\u6761\u76EE"] }), activeNode.documentId !== undefined && activeNode.missing !== true && _jsx("button", { className: "secondary-button", type: "button", onClick: () => setScope('local'), children: "\u770B\u5C40\u90E8\u56FE\u8C31" })] })] })) })] }))] }));
    }
    ctx.effect(() => ctx.clientApp.registerPage({
        id: 'graph',
        label: '图谱',
        icon: Network,
        component: GraphPage,
        order: 13,
        section: 'primary',
    }), 'ui-graph: page');
}
//# sourceMappingURL=index.js.map