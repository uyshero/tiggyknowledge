import { GITHUB_LATEST_RELEASE_API, GITHUB_RELEASES_URL } from './constants'

export interface GithubAsset {
  name: string
  size: number
  browser_download_url: string
}

export interface GithubRelease {
  tag_name: string
  html_url: string
  published_at: string
  assets: GithubAsset[]
}

export type DownloadKind = 'mac-arm64' | 'mac-x64' | 'mac-universal' | 'windows'

export interface DownloadOption {
  kind: DownloadKind
  label: string
  asset: GithubAsset
}

export interface LatestDownloads {
  tag: string
  htmlUrl: string
  publishedAt: string
  options: DownloadOption[]
  checksums?: GithubAsset
}

export type DetectedPlatform = 'mac' | 'windows' | 'other'

export function detectPlatform(): DetectedPlatform {
  const source = `${navigator.userAgent} ${navigator.platform}`
  if (/Windows|Win32|Win64/i.test(source)) return 'windows'
  if (/Mac OS X|Macintosh/i.test(source)) return 'mac'
  return 'other'
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function option(kind: DownloadKind, label: string, asset: GithubAsset | undefined): DownloadOption | undefined {
  if (asset === undefined) return undefined
  return { kind, label, asset }
}

export function parseDownloads(release: GithubRelease): LatestDownloads {
  const assets = release.assets
  const checksums = assets.find(asset => /SHA256SUMS/i.test(asset.name))
  const options = [
    option('mac-universal', 'macOS Universal', assets.find(asset => /mac-universal\.dmg$/i.test(asset.name))),
    option('mac-arm64', 'macOS Apple Silicon', assets.find(asset => /mac-arm64\.dmg$/i.test(asset.name))),
    option('mac-x64', 'macOS Intel', assets.find(asset => /mac-x64\.dmg$/i.test(asset.name))),
    option('windows', 'Windows x64', assets.find(asset => /\.exe$/i.test(asset.name))),
  ].filter((item): item is DownloadOption => item !== undefined)

  return {
    tag: release.tag_name.replace(/^v/, ''),
    htmlUrl: release.html_url,
    publishedAt: release.published_at,
    options,
    ...(checksums === undefined ? {} : { checksums }),
  }
}

export function pickPrimary(options: DownloadOption[], platform: DetectedPlatform): DownloadOption | undefined {
  if (platform === 'windows') return options.find(item => item.kind === 'windows') ?? options[0]
  if (platform === 'mac') {
    return options.find(item => item.kind === 'mac-universal')
      ?? options.find(item => item.kind === 'mac-arm64')
      ?? options.find(item => item.kind === 'mac-x64')
      ?? options[0]
  }
  return options[0]
}

export async function fetchLatestDownloads(signal?: AbortSignal): Promise<LatestDownloads> {
  const response = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`无法读取 GitHub Release（${response.status}）`)
  const release = await response.json() as GithubRelease
  if (!Array.isArray(release.assets)) throw new Error('Release 数据格式不正确')
  return parseDownloads(release)
}

export const RELEASES_FALLBACK_URL = GITHUB_RELEASES_URL
