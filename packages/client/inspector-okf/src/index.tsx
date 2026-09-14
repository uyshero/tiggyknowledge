import type { Context } from '@deepseek-ai/cordis'
import { Braces, CheckCircle2, CircleDashed, Database, FileCode2, FileInput } from 'lucide-react'
import { useEffect, useState, type JSX } from 'react'
import type {} from '@tiggyknowledge/client-connection'
import type { DocumentInspectorProps } from '@tiggyknowledge/client-runtime'
import type {} from '@tiggyknowledge/client-runtime'
import type { KnowledgeOkfMapping } from '@tiggyknowledge/contracts'

export const inject = ['clientApp', 'connection']

function shortHash(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 12)}...${value.slice(-8)}`
}

function formatBytes(size: number): string {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function apply(ctx: Context): void {
  function OkfInspector({ documentId }: DocumentInspectorProps): JSX.Element {
    const [mapping, setMapping] = useState<KnowledgeOkfMapping>()
    const [error, setError] = useState<string>()

    useEffect(() => {
      const controller = new AbortController()
      setMapping(undefined)
      setError(undefined)
      void ctx.connection.documentOkf(documentId, controller.signal).then(setMapping).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'OKF 映射加载失败')
      })
      return () => controller.abort()
    }, [documentId])

    if (error !== undefined) return <div className="okf-inspector-state error-state"><strong>无法读取 OKF 映射</strong><span>{error}</span></div>
    if (mapping === undefined) return <div className="okf-inspector-state">正在生成 OKF 映射...</div>
    const source = mapping.concept.sources[0]
    return (
      <section className="okf-inspector" aria-label="OKF 映射">
        <div className="okf-status-banner"><CircleDashed size={17} /><div><strong>OKF v0.2 运行时映射</strong><span>尚未物化为可交换 Bundle</span></div></div>
        <div className="okf-flow" aria-label="OKF 数据流">
          <div><FileInput size={18} /><span>Source Asset</span><strong>{source?.title}</strong></div>
          <i aria-hidden="true">→</i>
          <div><Braces size={18} /><span>Producer</span><strong>{mapping.concept.generatedBy}</strong></div>
          <i aria-hidden="true">→</i>
          <div><FileCode2 size={18} /><span>Concept</span><strong>{mapping.concept.path}</strong></div>
          <i aria-hidden="true">→</i>
          <div><Database size={18} /><span>Projection</span><strong>{mapping.storage.indexStatus === 'ready' ? 'FTS5 已就绪' : mapping.storage.indexStatus}</strong></div>
        </div>
        <div className="okf-detail-grid">
          <section><h3>Concept</h3><dl><div><dt>稳定 ID</dt><dd>{mapping.concept.id}</dd></div><div><dt>类型</dt><dd>{mapping.concept.type}</dd></div><div><dt>标题</dt><dd>{mapping.concept.title}</dd></div><div><dt>Bundle 路径</dt><dd>{mapping.concept.path}</dd></div><div><dt>标签</dt><dd>{mapping.concept.tags.length === 0 ? '暂无' : mapping.concept.tags.map(tag => tag.name).join('、')}</dd></div></dl></section>
          <section><h3>Source</h3><dl><div><dt>原始文件</dt><dd>{source?.title}</dd></div><div><dt>资源 URI</dt><dd title={source?.resource}>{source === undefined ? '-' : shortHash(source.resource)}</dd></div><div><dt>内容哈希</dt><dd title={source?.contentHash}>{source === undefined ? '-' : shortHash(source.contentHash)}</dd></div><div><dt>文件大小</dt><dd>{source === undefined ? '-' : formatBytes(source.sizeBytes)}</dd></div></dl></section>
          <section><h3>Generated</h3><dl><div><dt>生成者</dt><dd>{mapping.concept.generatedBy}</dd></div><div><dt>生成时间</dt><dd>{new Date(mapping.concept.generatedAt).toLocaleString('zh-CN')}</dd></div><div><dt>原始资产</dt><dd title={mapping.storage.originalAssetId}>{shortHash(mapping.storage.originalAssetId)}</dd></div></dl></section>
          <section><h3>Validation</h3><div className="okf-validation"><CheckCircle2 size={17} /><div><strong>映射字段完整</strong><span>{mapping.validation.message}</span></div></div></section>
        </div>
        <section className="okf-concept-preview"><header><strong>{mapping.concept.path}</strong><span>派生 Concept 内容预览</span></header><pre>{mapping.concept.body.slice(0, 4000)}</pre>{mapping.concept.body.length > 4000 && <footer>仅展示前 4,000 个字符</footer>}</section>
      </section>
    )
  }

  ctx.effect(() => ctx.clientApp.registerDocumentInspector({
    id: 'okf',
    label: 'OKF 映射',
    icon: Braces,
    component: OkfInspector,
    order: 20,
  }), 'client-inspector-okf: register inspector')
}
