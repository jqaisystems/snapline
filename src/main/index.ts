import { app, BrowserWindow, session, desktopCapturer } from 'electron'
import { getStore } from './store'
import { registerIpc } from './ipc'
import { reindexAll } from './broadcast'
import { createTray, destroyTray } from './tray'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { startWatcher, stopWatcher } from './watcher'
import { showLibraryWindow } from './windows'
import { shutdownOcr } from './ocr'
import { registerMediaProtocol, registerMediaSchemePrivileges } from './media'
import { initUpdater } from './updater'
import { purgeExpiredTrash } from './trash'

let isQuitting = false

// Must run before app is ready.
registerMediaSchemePrivileges()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showLibraryWindow())

  app.whenReady().then(() => {
    app.setAppUserModelId('com.joaoqueiros.snapline')
    registerMediaProtocol()

    // Allow the recordctl window's getUserMedia (desktop capture + microphone) to proceed.
    // Chromium consults the synchronous check handler too; without it a media check can fail
    // before the async request handler runs, silently denying the microphone.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media')
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

    // Recording system ("background") audio needs getDisplayMedia with audio:'loopback' — the old
    // getUserMedia chromeMediaSource trick no longer captures Windows loopback. The recordctl window
    // calls getDisplayMedia purely to obtain this loopback audio track (it discards the video).
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}))
    })

    // Surface renderer-side errors in the main process log (useful during dev walkthroughs).
    app.on('web-contents-created', (_e, contents) => {
      contents.on('console-message', (_ev, level, message, line, sourceId) => {
        if (level >= 2) console.log(`[renderer] ${message}  (${sourceId}:${line})`)
      })
      contents.on('render-process-gone', (_ev, details) => console.error('[renderer-gone]', details))
      contents.on('preload-error', (_ev, _p, err) => console.error('[preload-error]', err))
    })

    const store = getStore()
    purgeExpiredTrash() // drop trashed items past their retention window
    reindexAll()
    registerIpc()
    createTray()

    const settings = store.getSettings()
    if (settings.onboarded && settings.storageRoot) {
      startWatcher()
    }
    registerHotkeys()

    if (settings.launchOnStartup) {
      app.setLoginItemSettings({ openAtLogin: true })
    }

    showLibraryWindow()

    // Check for updates in the background (no-op in dev / unpackaged).
    initUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showLibraryWindow()
    })
  })

  // Tray-resident app: closing the library window does not quit.
  app.on('window-all-closed', () => {
    // keep running in the tray; quit only via the tray menu
  })

  app.on('before-quit', () => {
    isQuitting = true
    unregisterHotkeys()
    stopWatcher()
    destroyTray()
    getStore().flush()
    void shutdownOcr()
  })
}

export { isQuitting }
