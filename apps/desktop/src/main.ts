import { app, BrowserWindow, dialog, Menu, net, shell } from 'electron'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@tiggyknowledge/webserver'
import { isNewerDesktopRelease, parseDesktopRelease } from './update.ts'

type CliModule = typeof import('@tiggyknowledge/cli')

let host: Context | undefined
let window: BrowserWindow | undefined
let stopping = false
let updateCheck: Promise<void> | undefined
let promptedVersion: string | undefined

const LATEST_RELEASE_API = 'https://api.github.com/repos/uyshero/tiggyknowledge/releases/latest'

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function projectRoot(): string {
  if (app.isPackaged) return resolve(process.resourcesPath, 'project')
  return resolve(import.meta.dirname, '../../..')
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

async function loadCli(): Promise<CliModule> {
  if (!app.isPackaged) return await import('@tiggyknowledge/cli')
  return await import(pathToFileURL(resolve(projectRoot(), 'lib/index.js')).href)
}

async function createWindow(): Promise<void> {
  if (host === undefined) throw new Error('desktop: host is not running')

  if (window !== undefined) {
    if (window.isMinimized()) window.restore()
    window.focus()
    return
  }

  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'TiggyKnowledge',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const localOrigin = new URL(host.webServer.url).origin
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, localOrigin)) event.preventDefault()
  })
  window.on('closed', () => {
    window = undefined
  })
  await window.loadURL(host.webServer.url)
  window.once('ready-to-show', () => window?.show())
}

function installApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'TiggyKnowledge',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [
        { label: '新建窗口', accelerator: 'CmdOrCtrl+N', click: () => void createWindow().catch(handleStartupError) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新...', click: () => void checkForUpdates(true) },
        { type: 'separator' },
        { label: '项目主页', click: () => void shell.openExternal('https://github.com/uyshero/tiggyknowledge') },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function showMessage(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return window === undefined ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options)
}

async function runUpdateCheck(interactive: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (interactive) await showMessage({ type: 'info', message: '开发模式不检查更新', detail: `当前版本：${app.getVersion()}` })
    return
  }

  try {
    const response = await net.fetch(LATEST_RELEASE_API, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `TiggyKnowledge/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}`)
    const release = parseDesktopRelease(await response.json())
    if (!isNewerDesktopRelease(app.getVersion(), release)) {
      if (interactive) await showMessage({ type: 'info', message: '已经是最新版本', detail: `当前版本：${app.getVersion()}` })
      return
    }
    if (!interactive && promptedVersion === release.version) return
    promptedVersion = release.version
    const releaseNotes = release.releaseNotes.length > 0 ? release.releaseNotes.slice(0, 1_500) : '请前往下载页面查看更新内容。'
    const result = await showMessage({
      type: 'info',
      title: 'TiggyKnowledge 更新',
      message: `发现新版本 ${release.version}`,
      detail: `当前版本：${app.getVersion()}\n\n${releaseNotes}`,
      buttons: ['前往下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0) await shell.openExternal(release.releaseUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`desktop update check failed: ${message}`)
    if (interactive) await showMessage({ type: 'warning', message: '暂时无法检查更新', detail: message })
  }
}

async function checkForUpdates(interactive: boolean): Promise<void> {
  if (updateCheck !== undefined) return await updateCheck
  updateCheck = runUpdateCheck(interactive).finally(() => {
    updateCheck = undefined
  })
  return await updateCheck
}

async function stopHost(): Promise<void> {
  if (host === undefined) return
  const current = host
  host = undefined
  await current.fiber.dispose()
}

async function start(): Promise<void> {
  if (!hasSingleInstanceLock) return
  await app.whenReady()
  app.setName('TiggyKnowledge')
  installApplicationMenu()

  app.on('second-instance', () => {
    void createWindow().catch(handleStartupError)
  })

  const root = projectRoot()
  const dataRoot = app.getPath('userData')
  const configuredPort = Number(process.env.TIGGYKNOWLEDGE_DESKTOP_PORT ?? 3210)
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new Error(`desktop: invalid TIGGYKNOWLEDGE_DESKTOP_PORT: ${String(configuredPort)}`)
  }

  const { boot } = await loadCli()
  host = await boot([], {
    projectRoot: root,
    dataRoot,
    distRoot: resolve(root, 'apps/web/dist'),
    port: configuredPort,
  })
  try {
    await createWindow()
    setTimeout(() => void checkForUpdates(false), 5_000).unref()
  } catch (error) {
    await stopHost()
    throw error
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  void createWindow().catch(handleStartupError)
})

app.on('before-quit', event => {
  if (stopping || host === undefined) return
  event.preventDefault()
  stopping = true
  void stopHost().finally(() => app.exit(0))
})

function handleStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  dialog.showErrorBox('TiggyKnowledge 启动失败', message)
  app.quit()
}

void start().catch(handleStartupError)
