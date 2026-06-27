import { BrowserWindow, shell } from 'electron'
import path from 'path'
import type { Rect } from '../shared/types'

const preloadPath = path.join(__dirname, '../preload/index.js')

type Page = 'library' | 'overlay' | 'editor' | 'pin' | 'scrollctl'

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
let overlayWindow: BrowserWindow | null = null
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
    webPreferences: { preload: preloadPath, sandbox: false }
  })
  libraryWindow.on('ready-to-show', () => libraryWindow?.show())
  libraryWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  libraryWindow.on('closed', () => {
    libraryWindow = null
  })
  loadPage(libraryWindow, 'library')
  return libraryWindow
}

export function createOverlayWindow(bounds: Rect): BrowserWindow {
  closeOverlayWindow()
  overlayWindow = new BrowserWindow({
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
    webPreferences: { preload: preloadPath, sandbox: false }
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true)
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  loadPage(overlayWindow, 'overlay')
  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show()
    overlayWindow?.focus()
  })
  return overlayWindow
}

export function closeOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  overlayWindow = null
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
    webPreferences: { preload: preloadPath, sandbox: false }
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
    webPreferences: { preload: preloadPath, sandbox: false }
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
    webPreferences: { preload: preloadPath, sandbox: false }
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

export function broadcastToAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
