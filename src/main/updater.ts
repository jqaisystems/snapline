import { app, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import { toast } from './broadcast'

// Auto-update wiring (GitHub Releases provider, configured in electron-builder.yml).
//
// Behaviour chosen for Snapline: check on launch (and every few hours, since the
// app lives in the tray for long stretches), download in the background, tell the
// user it is ready, and install on the next quit. Nothing is forced; if the check
// or download fails the app keeps running exactly as before.

let wired = false
let manualCheck = false // true while a user-initiated check is in flight (so we can report "up to date")
const RECHECK_MS = 6 * 60 * 60 * 1000 // 6 hours

// Prefer a native OS notification (shows even when no window is open, e.g. tray-only),
// fall back to the in-app toast. Never let a notification failure bubble up.
function notify(body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: 'Snapline', body }).show()
      return
    }
  } catch {
    /* fall through to toast */
  }
  toast(body)
}

function wire(): void {
  if (wired) return
  wired = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Quiet, crash-proof logger (electron-updater calls these; default expects electron-log).
  autoUpdater.logger = {
    info: (m: unknown) => console.log('[updater]', m),
    warn: (m: unknown) => console.warn('[updater]', m),
    error: (m: unknown) => console.error('[updater]', m),
    debug: () => {}
  } as never

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version)
    if (manualCheck) notify(`Downloading update ${info.version}…`)
  })
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) notify('Snapline is up to date.')
    manualCheck = false
  })
  autoUpdater.on('update-downloaded', (info) => {
    manualCheck = false
    notify(`Update ${info.version} is ready. It installs when you quit Snapline.`)
  })
  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err)
    if (manualCheck) notify('Could not check for updates right now.')
    manualCheck = false
  })
}

function check(): void {
  void autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed:', e))
}

// True when running as an installed Microsoft Store (MSIX) app. The Store owns updates there,
// and electron-updater cannot update an MSIX, so we skip our GitHub updater entirely.
const isStoreBuild = (process as NodeJS.Process & { windowsStore?: boolean }).windowsStore === true

// Background check on startup + periodic re-check. No-op when running unpackaged (dev)
// or as a Microsoft Store build (the Store handles updates).
export function initUpdater(): void {
  if (!app.isPackaged || isStoreBuild) return
  wire()
  check()
  setInterval(check, RECHECK_MS)
}

// Tray "Check for updates" action. Gives the user explicit feedback either way.
export function checkForUpdatesManual(): void {
  if (isStoreBuild) {
    notify('Updates are managed by the Microsoft Store.')
    return
  }
  if (!app.isPackaged) {
    notify('Updates are only available in the installed app.')
    return
  }
  wire()
  manualCheck = true
  void autoUpdater.checkForUpdates().catch((e) => {
    console.error('[updater] manual check failed:', e)
    notify('Could not check for updates right now.')
    manualCheck = false
  })
}
