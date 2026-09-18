import { app, BrowserWindow, dialog, Menu, net, safeStorage, shell } from 'electron'
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

function formatError(error: unknown, indent = ''): string {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map(item => formatError(item, `${indent}  `))]
      .map((line, index) => index === 0 ? `${indent}${line}` : line)
      .join('\n')
  }
  return `${indent}${error instanceof Error ? error.message : String(error)}`
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

function canOpenGuestWindow(url: string): boolean {
  return url.length === 0 || url === 'about:blank' || url.startsWith('https:') || url.startsWith('http:')
}

function guestPopupOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: 520,
    height: 760,
    minWidth: 360,
    minHeight: 480,
    autoHideMenuBar: true,
    title: '安全验证',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

function allowGuestPopup(): Electron.WindowOpenHandlerResponse {
  return { action: 'allow', overrideBrowserWindowOptions: guestPopupOptions() }
}

function installGuestWindowHandling(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => canOpenGuestWindow(url) ? allowGuestPopup() : { action: 'deny' })
    contents.on('did-create-window', popup => {
      popup.setMenu(null)
      if (!popup.isVisible()) popup.show()
      popup.focus()
      popup.webContents.setWindowOpenHandler(({ url }) => canOpenGuestWindow(url) ? allowGuestPopup() : { action: 'deny' })
    })
  })
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
    icon: resolve(import.meta.dirname, '../build/icon.png'),
    show: false,
    title: '小虎AI知识库',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
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
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const commandModifier = process.platform === 'darwin' ? input.meta : input.control
    if (!commandModifier || input.alt) return
    const key = input.key.toLowerCase()
    if (key === 'v') window?.webContents.paste()
    else if (key === 'c') window?.webContents.copy()
    else if (key === 'x') window?.webContents.cut()
    else if (key === 'a') window?.webContents.selectAll()
    else if (key === 'z' && input.shift) window?.webContents.redo()
    else if (key === 'z') window?.webContents.undo()
    else return
    event.preventDefault()
  })
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && params.selectionText.length === 0) return
    const menu = Menu.buildFromTemplate([
      ...(params.selectionText.length === 0 ? [] : [
        { role: 'copy' as const, enabled: params.editFlags.canCopy },
        { type: 'separator' as const },
      ]),
      ...(params.isEditable ? [
        { role: 'cut' as const, enabled: params.editFlags.canCut },
        { role: 'paste' as const },
        { role: 'pasteAndMatchStyle' as const },
        { role: 'delete' as const, enabled: params.editFlags.canDelete },
        { type: 'separator' as const },
      ] : []),
      { role: 'selectAll' as const, enabled: params.editFlags.canSelectAll },
    ])
    if (window === undefined) return
    menu.popup({ window })
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
      label: '小虎AI知识库',
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
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
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
  app.setName('小虎AI知识库')
  installGuestWindowHandling()
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
    secretCodec: {
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用')
        return safeStorage.encryptString(value).toString('base64')
      },
      decrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用')
        return safeStorage.decryptString(Buffer.from(value, 'base64'))
      },
    },
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
  const message = formatError(error)
  console.error(error)
  dialog.showErrorBox('TiggyKnowledge 启动失败', message)
  app.quit()
}

void start().catch(handleStartupError)
