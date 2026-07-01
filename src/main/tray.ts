import { Tray, Menu, nativeImage, app } from 'electron'
import { getStore } from './store'
import { performCapture } from './captureFlow'
import { startScrollCapture } from './scrollCapture'
import { showLibraryWindow } from './windows'
import { broadcastSnapshot } from './broadcast'
import { checkForUpdatesManual } from './updater'
import { TRAY_ICON_DATA_URL } from './icons.generated'

let tray: Tray | null = null

// In a Microsoft Store (MSIX) build the Store handles updates, so the manual "Check for
// updates…" item is meaningless and is omitted from the tray menu.
const isStoreBuild = (process as NodeJS.Process & { windowsStore?: boolean }).windowsStore === true

export function buildTrayMenu(): void {
  if (!tray) return
  const store = getStore()
  const settings = store.getSettings()
  const projects = store.getProjects().filter((p) => !p.archived)
  const active = settings.activeProjectId

  const projectItems: Electron.MenuItemConstructorOptions[] = projects.map((p) => ({
    label: p.name,
    type: 'radio',
    checked: active === p.id,
    click: () => {
      store.updateSettings({ activeProjectId: p.id })
      broadcastSnapshot()
      buildTrayMenu()
    }
  }))

  const menu = Menu.buildFromTemplate([
    { label: 'Capture region', accelerator: settings.hotkeys.region, click: () => void performCapture({ mode: 'region' }) },
    { label: 'Capture window', accelerator: settings.hotkeys.window, click: () => void performCapture({ mode: 'window' }) },
    { label: 'Capture full screen', accelerator: settings.hotkeys.fullscreen, click: () => void performCapture({ mode: 'fullscreen' }) },
    { label: 'Scrolling capture', click: () => void startScrollCapture() },
    { type: 'separator' },
    {
      label: 'Active project',
      submenu: [
        {
          label: 'Unfiled',
          type: 'radio',
          checked: active == null,
          click: () => {
            store.updateSettings({ activeProjectId: null })
            broadcastSnapshot()
            buildTrayMenu()
          }
        },
        ...(projectItems.length ? [{ type: 'separator' } as Electron.MenuItemConstructorOptions, ...projectItems] : [])
      ]
    },
    { type: 'separator' },
    { label: 'Open Snapline', click: () => showLibraryWindow() },
    ...(isStoreBuild
      ? []
      : [{ label: 'Check for updates…', click: () => checkForUpdatesManual() } as Electron.MenuItemConstructorOptions]),
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)

  const activeName = active ? projects.find((p) => p.id === active)?.name ?? 'Unfiled' : 'Unfiled'
  tray.setToolTip(`Snapline — active: ${activeName}`)
}

export function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  tray = new Tray(icon)
  tray.on('double-click', () => showLibraryWindow())
  buildTrayMenu()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
