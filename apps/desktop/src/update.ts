import semver from 'semver'

const RELEASE_PAGE_ORIGIN = 'https://github.com'
const RELEASE_PAGE_PREFIX = '/uyshero/tiggyknowledge/releases/'

export interface DesktopRelease {
  version: string
  tagName: string
  releaseNotes: string
  releaseUrl: string
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('更新服务返回了无效数据')
  }
  return value as Record<string, unknown>
}

export function parseDesktopRelease(value: unknown): DesktopRelease {
  const source = recordOf(value)
  const tagName = typeof source.tag_name === 'string' ? source.tag_name : ''
  const version = semver.valid(tagName.replace(/^v/, ''))
  if (version === null) throw new Error('最新版本号格式无效')

  const releaseUrl = typeof source.html_url === 'string' ? source.html_url : ''
  let parsedReleaseUrl: URL
  try {
    parsedReleaseUrl = new URL(releaseUrl)
  } catch {
    throw new Error('更新下载地址无效')
  }
  if (parsedReleaseUrl.origin !== RELEASE_PAGE_ORIGIN || !parsedReleaseUrl.pathname.startsWith(RELEASE_PAGE_PREFIX)) {
    throw new Error('更新下载地址无效')
  }

  return {
    version,
    tagName,
    releaseNotes: typeof source.body === 'string' ? source.body.trim() : '',
    releaseUrl,
  }
}

export function isNewerDesktopRelease(currentVersion: string, release: DesktopRelease): boolean {
  const current = semver.valid(currentVersion)
  if (current === null) throw new Error(`当前版本号格式无效：${currentVersion}`)
  return semver.gt(release.version, current)
}
