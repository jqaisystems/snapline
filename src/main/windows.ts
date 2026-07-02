import { BrowserWindow, screen, shell } from 'electron'
import path from 'path'
import type { Rect } from '../shared/types'
import { isSafeExternalUrl } from './net'

const preloadPath = path.join(__dirname, '../preload/index.js')

type Page = 'library' | 'overlay' | 'editor' | 'pin' | 'scrollctl' | 'recordctl'

function loadPage(win: BrowserWindow, page: Page, params: Record<string, string> = {}): void {
  const query = new URLSearchParams({ window: page, ...params }).toString()
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(`${devUrl}/${page}.html?${query}`)
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${page}.html`), {
      search: query
    })
  }
}

let libraryWindow: BrowserWindow | null = null
// One overlay window per monitor (region capture dims every screen at once).
let overlayWindows: BrowserWindow[] = []
let editorWindow: BrowserWindow | null = null
const pinWindows = new Set<BrowserWindow>()

export function getLibraryWindow(): BrowserWindow | null {
  return libraryWindow && !libraryWindow.isDestroyed() ? libraryWindow : null
}

export function showLibraryWindow(): BrowserWindow {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    if (libraryWindow.isMinimized()) libraryWindow.restore()
    libraryWindow.show()
    libraryWindow.focus()
    return libraryWindow
  }
  libraryWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Snapline',
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath, sandbox: true }
  })
  libraryWindow.on('ready-to-show', () => libraryWindow?.show())
  libraryWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only hand safe web/mail schemes to the OS; never let renderer content launch
    // arbitrary protocols (e.g. file:, custom app handlers) via window.open.
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  libraryWindow.on('closed', () => {
    libraryWindow = null
  })
  loadPage(libraryWindow, 'library')
  return libraryWindow
}

// Create one overlay window. Region capture calls this once per monitor (each window is
// positioned on, and sized to, a single display so its DPI is unambiguous); window/scroll
// capture call it once. Windows are tracked together and torn down by closeOverlayWindow().
export function createOverlayWindow(bounds: Rect): BrowserWindow {
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    enableLargerThanScreen: true,
    webPreferences: { preload: preloadPath, sandbox: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)
  win.on('closed', () => {
    overlayWindows = overlayWindows.filter((w) => w !== win)
  })
  overlayWindows.push(win)
  loadPage(win, 'overlay')
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  return win
}

export function closeOverlayWindow(): void {
  for (const w of overlayWindows.slice()) {
    if (!w.isDestroyed()) w.close()
  }
  overlayWindows = []
}

export function createEditorWindow(screenshotId: string): BrowserWindow {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus()
    loadPage(editorWindow, 'editor', { id: screenshotId })
    return editorWindow
  }
  editorWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Snapline Editor',
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath, sandbox: true }
  })
  editorWindow.on('ready-to-show', () => editorWindow?.show())
  editorWindow.on('closed', () => {
    editorWindow = null
  })
  loadPage(editorWindow, 'editor', { id: screenshotId })
  return editorWindow
}

export function createPinWindow(screenshotId: string, width: number, height: number): BrowserWindow {
  const maxW = 520
  const scale = width > maxW ? maxW / width : 1
  const w = Math.max(120, Math.round(width * scale))
  const h = Math.max(90, Math.round(height * scale)) + 28 // toolbar strip
  const win = new BrowserWindow({
    width: w,
    height: h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: { preload: preloadPath, sandbox: true }
  })
  win.setAlwaysOnTop(true, 'floating')
  win.on('closed', () => pinWindows.delete(win))
  pinWindows.add(win)
  loadPage(win, 'pin', { id: screenshotId })
  return win
}

let scrollControlWindow: BrowserWindow | null = null

export function createScrollControlWindow(display: Electron.Display, rect: Rect): BrowserWindow {
  closeScrollControlWindow()
  const b = display.bounds
  const W = 380
  const H = 66
  const x = b.x + Math.round((b.width - W) / 2)
  const regionTop = b.y + rect.y
  const regionBottom = b.y + rect.y + rect.height
  let y: number
  if (regionBottom + 10 + H <= b.y + b.height) y = regionBottom + 10
  else if (regionTop - 10 - H >= b.y) y = regionTop - 10 - H
  else y = b.y + b.height - H - 10

  scrollControlWindow = new BrowserWindow({
    x,
    y,
    width: W,
    height: H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: { preload: preloadPath, sandbox: true }
  })
  scrollControlWindow.setAlwaysOnTop(true, 'screen-saver')
  scrollControlWindow.on('closed', () => {
    scrollControlWindow = null
  })
  loadPage(scrollControlWindow, 'scrollctl')
  scrollControlWindow.once('ready-to-show', () => scrollControlWindow?.show())
  return scrollControlWindow
}

export function closeScrollControlWindow(): void {
  if (scrollControlWindow && !scrollControlWindow.isDestroyed()) scrollControlWindow.close()
  scrollControlWindow = null
}

let recordControlWindow: BrowserWindow | null = null

// Floating control bar that also runs the MediaRecorder. backgroundThrottling is disabled so
// recording isn't throttled while the bar is unfocused.
export function createRecordControlWindow(): BrowserWindow {
  closeRecordControlWindow()
  const b = screen.getPrimaryDisplay().bounds
  const W = 320
  const H = 64
  const x = b.x + Math.round((b.width - W) / 2)
  const y = b.y + b.height - H - 24
  recordControlWindow = new BrowserWindow({
    x,
    y,
    width: W,
    height: H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: { preload: preloadPath, sandbox: true, backgroundThrottling: false }
  })
  recordControlWindow.setAlwaysOnTop(true, 'screen-saver')
  recordControlWindow.on('closed', () => {
    recordControlWindow = null
  })
  loadPage(recordControlWindow, 'recordctl')
  recordControlWindow.once('ready-to-show', () => recordControlWindow?.show())
  return recordControlWindow
}

export function closeRecordControlWindow(): void {
  if (recordControlWindow && !recordControlWindow.isDestroyed()) recordControlWindow.close()
  recordControlWindow = null
}

export function broadcastToAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
