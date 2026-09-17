import { AlertTriangle, Download, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  detectPlatform,
  fetchLatestDownloads,
  formatBytes,
  pickPrimary,
  RELEASES_FALLBACK_URL,
  type DetectedPlatform,
  type LatestDownloads,
} from '../github'

function useLatestDownloads(): { data?: LatestDownloads, error?: string, loading: boolean } {
  const [data, setData] = useState<LatestDownloads>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetchLatestDownloads(controller.signal)
      .then(release => {
        setData(release)
        setError(undefined)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : '无法读取最新版本')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  return {
    loading,
    ...(data === undefined ? {} : { data }),
    ...(error === undefined ? {} : { error }),
  }
}

export function DownloadPage(): JSX.Element {
  const { data, error, loading } = useLatestDownloads()
  const [platform, setPlatform] = useState<DetectedPlatform>('other')

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  const primary = data === undefined ? undefined : pickPrimary(data.options, platform)
  const published = data === undefined ? undefined : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(data.publishedAt))

  return (
    <div className="page-narrow">
      <p className="eyebrow">桌面客户端</p>
      <h1>下载 {data?.tag === undefined ? 'TiggyKnowledge' : `TiggyKnowledge ${data.tag}`}</h1>
      <p className="lede">安装包来自 GitHub Releases。当前构建尚未代码签名，系统可能会显示未知开发者或未知发布者提示。</p>

      {loading && <div className="panel muted" aria-live="polite">正在读取最新 Release…</div>}

      {!loading && error !== undefined && (
        <div className="panel warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>暂时无法自动列出安装包</strong>
            <p>{error}。请到 GitHub Releases 手动下载。</p>
            <a className="button-dark" href={RELEASES_FALLBACK_URL} rel="noreferrer" target="_blank">
              打开 Releases
              <ExternalLink size={15} />
            </a>
          </div>
        </div>
      )}

      {data !== undefined && (
        <>
          {primary !== undefined && (
            <a className="download-hero" href={primary.asset.browser_download_url}>
              <Download size={18} />
              <span>
                <strong>下载 {primary.label}</strong>
                <small>{primary.asset.name} · {formatBytes(primary.asset.size)}{published === undefined ? '' : ` · ${published}`}</small>
              </span>
            </a>
          )}

          <div className="download-list">
            {data.options.map(option => (
              <a className={option.kind === primary?.kind ? 'active' : ''} href={option.asset.browser_download_url} key={option.kind}>
                <strong>{option.label}</strong>
                <span>{option.asset.name}</span>
                <small>{formatBytes(option.asset.size)}</small>
              </a>
            ))}
            {data.checksums !== undefined && (
              <a href={data.checksums.browser_download_url}>
                <strong>SHA256 校验</strong>
                <span>{data.checksums.name}</span>
                <small>{formatBytes(data.checksums.size)}</small>
              </a>
            )}
            <a href={data.htmlUrl} rel="noreferrer" target="_blank">
              <strong>全部资源</strong>
              <span>GitHub Release {data.tag}</span>
              <small>打开页面</small>
            </a>
          </div>
        </>
      )}

      <aside className="note-card">
        <h2>安装注意</h2>
        <ul>
          <li>macOS 未配置 Developer ID 时，需要在「隐私与安全性」中允许打开。</li>
          <li>Windows 可能出现 SmartScreen「未知发布者」提示，请确认文件来自官方 Release。</li>
          <li>本机服务默认端口为 <code>3210</code>。详情见 <Link to="/docs/desktop">桌面客户端</Link>。</li>
        </ul>
      </aside>
    </div>
  )
}
