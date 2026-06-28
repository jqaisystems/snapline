import { app, ipcMain, dialog, shell, clipboard, nativeImage, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { getStore } from './store'
import { getSearch } from './search'
import {
  ensureRoot,
  importFiles as fsImportFiles,
  indexFile,
  makeThumbnail,
  moveScreenshotFile,
  deleteScreenshotFiles,
  projectDir,
  sanitize,
  uniqueFolderName,
  writeEditedImage
} from './storageFs'
import { trashById, restoreById, deletePermanentlyById, emptyTrash } from './trash'
import { performCapture } from './captureFlow'
import { getProjectPalette } from './palette'
import { startScrollCapture, finishScrollCapture, cancelScrollCapture } from './scrollCapture'
import { enrichOne, queueEnrichment } from './pipeline'
import { detectPii as aiDetectPii, testApiKey as aiTestKey } from './ai'
import { broadcastSnapshot, reindexAll, toast } from './broadcast'
import { startWatcher } from './watcher'
import { registerHotkeys } from './hotkeys'
import { buildTrayMenu } from './tray'
import { createEditorWindow, createPinWindow, showLibraryWindow } from './windows'
import { getOverlayData, resolveOverlay } from './capture'
import type { CaptureRequest, OverlayResult, Project, Screenshot, SearchQuery, Settings, Tag } from '../shared/types'

function refreshFileMeta(s: Screenshot): Partial<Screenshot> {
  let width = s.width
  let height = s.height
  let bytes = s.bytes
  try {
    bytes = fs.statSync(s.filePath).size
    const img = nativeImage.createFromPath(s.filePath)
    const size = img.getSize()
    width = size.width
    height = size.height
  } catch { /* ignore */ }
  const thumbPath = makeThumbnail(s.filePath, s.id)
  return { width, height, bytes, thumbPath }
}

function runSearch(q: SearchQuery): string[] {
  const store = getStore()
  let list = store.getScreenshots() // already newest-first

  if (q.text && q.text.trim()) {
    const ids = new Set(getSearch().search(q.text.trim()))
    list = list.filter((s) => ids.has(s.id))
  }
  if (q.projectId !== undefined) list = list.filter((s) => s.projectId === q.projectId)
  if (q.tagId) list = list.filter((s) => s.tagIds.includes(q.tagId!))
  if (q.favorite) list = list.filter((s) => s.favorite)
  if (q.mode) list = list.filter((s) => s.captureMode === q.mode)
  if (q.fromDate) list = list.filter((s) => s.createdAt >= q.fromDate!)
  if (q.toDate) list = list.filter((s) => s.createdAt <= q.toDate!)

  if (q.sort === 'oldest') list = list.slice().sort((a, b) => a.createdAt - b.createdAt)
  else if (q.sort === 'name')
    list = list.slice().sort((a, b) => (a.aiName ?? a.fileName).localeCompare(b.aiName ?? b.fileName))
  // 'newest' is the default order

  return list.map((s) => s.id)
}

// Build the print HTML: each page image goes in a fixed paper-sized box with overflow hidden, so a
// sub-pixel aspect mismatch can never push an image onto a blank second page. object-fit:cover fills
// the page (the crop is well under a pixel since images are composed at the page aspect).
function buildPagesHtml(pageUrls: string[], pageSize: 'A4' | 'Letter'): string {
  const dim = pageSize === 'A4' ? { w: '21cm', h: '29.7cm' } : { w: '8.5in', h: '11in' }
  const pgs = pageUrls.map((u) => `<div class="pg"><img src="${u}"/></div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${pageSize};margin:0}
html,body{margin:0;padding:0}
.pg{width:${dim.w};height:${dim.h};overflow:hidden;page-break-after:always}
.pg:last-child{page-break-after:auto}
.pg img{width:100%;height:100%;object-fit:cover;display:block}
</style></head><body>${pgs}</body></html>`
}

// Render HTML to a PDF buffer via an offscreen window. We load from a temp FILE (not a data: URL)
// because base64-embedded page images easily exceed Chromium's navigation URL limit (ERR_INVALID_URL).
async function htmlToPdf(win: BrowserWindow, html: string, pageSize: 'A4' | 'Letter'): Promise<Buffer> {
  const tmp = path.join(app.getPath('temp'), `snapline-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmp, html)
  try {
    await win.loadFile(tmp)
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

export function registerIpc(): void {
  const store = getStore()

  // ---- data ----
  ipcMain.handle('getSnapshot', () => store.snapshot())

  // ---- settings ----
  ipcMain.handle('updateSettings', (_e, patch: Partial<Settings>) => {
    const next = store.updateSettings(patch)
    if (patch.hotkeys) registerHotkeys()
    buildTrayMenu()
    broadcastSnapshot()
    return next
  })
  ipcMain.handle('setApiKey', (_e, key: string) => {
    store.setApiKey(key)
    broadcastSnapshot()
    return { ok: true }
  })
  ipcMain.handle('clearApiKey', () => {
    store.clearApiKey()
    broadcastSnapshot()
    return { ok: true }
  })
  ipcMain.handle('testApiKey', () => aiTestKey())
  ipcMain.handle('chooseStorageRoot', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a folder to store your screenshots',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
  ipcMain.handle('completeOnboarding', (_e, payload: { storageRoot: string }) => {
    store.updateSettings({ storageRoot: payload.storageRoot, onboarded: true })
    ensureRoot()
    startWatcher()
    buildTrayMenu()
    broadcastSnapshot()
    return store.getSettings()
  })

  // ---- projects ----
  ipcMain.handle('createProject', (_e, input: { name: string; color?: string; icon?: string }) => {
    const root = ensureRoot()
    const folderName = root ? uniqueFolderName(root, input.name) : input.name
    const project = store.createProject({ ...input, folderName })
    projectDir(project) // create folder on disk
    buildTrayMenu()
    broadcastSnapshot()
    return project
  })
  ipcMain.handle('updateProject', (_e, id: string, patch: Partial<Project>) => {
    const updated = store.updateProject(id, patch)
    buildTrayMenu()
    reindexAll()
    broadcastSnapshot()
    return updated
  })
  ipcMain.handle('deleteProject', (_e, id: string, opts: { deleteFiles: boolean }) => {
    const project = store.getProject(id)
    const shots = store.getScreenshots().filter((s) => s.projectId === id)
    if (opts.deleteFiles) {
      for (const s of shots) {
        deleteScreenshotFiles(s)
        store.removeScreenshot(s.id)
        getSearch().remove(s.id)
      }
      const root = store.getSettings().storageRoot
      if (project && root) {
        const target = path.resolve(root, project.folderName)
        const rootResolved = path.resolve(root)
        // Defense in depth: only ever recursively delete a folder that resolves to a
        // direct child of the storage root. Never let a stray folderName escape it.
        if (target.startsWith(rootResolved + path.sep) && path.dirname(target) === rootResolved) {
          try {
            fs.rmSync(target, { recursive: true, force: true })
          } catch (err) {
            console.error('[ipc] delete project folder failed:', err)
          }
        } else {
          console.error('[ipc] refused to delete folder outside storage root:', target)
        }
      }
    }
    store.deleteProject(id)
    store.flush() // project folder/files removed on disk: persist now
    buildTrayMenu()
    reindexAll()
    broadcastSnapshot()
    return { ok: true }
  })
  ipcMain.handle('setActiveProject', (_e, id: string | null) => {
    const next = store.updateSettings({ activeProjectId: id })
    buildTrayMenu()
    broadcastSnapshot()
    return next
  })
  ipcMain.handle('openProjectFolder', (_e, id: string) => {
    const dir = projectDir(store.getProject(id) ?? null)
    if (dir) shell.openPath(dir)
  })
  ipcMain.handle('getProjectPalette', (_e, projectId: string) => getProjectPalette(projectId))

  // ---- export (client deliverables) ----
  ipcMain.handle('exportImage', async (_e, dataUrl: string, suggestedName: string) => {
    try {
      const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(b64, 'base64')
      const root = store.getSettings().storageRoot
      const defaultPath = root ? path.join(root, suggestedName) : suggestedName
      const res = await dialog.showSaveDialog({
        title: 'Export sheet',
        defaultPath,
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false }
      fs.writeFileSync(res.filePath, buffer)
      shell.showItemInFolder(res.filePath)
      return { ok: true, path: res.filePath }
    } catch (err) {
      console.error('[ipc] exportImage failed:', err)
      return { ok: false }
    }
  })
  // Compose a multi-page PDF from page images (each already sized to the page aspect)
  // via an offscreen window + printToPDF — keeps us dependency-free.
  ipcMain.handle('exportPdf', async (_e, pages: string[], suggestedName: string, paperSize: string) => {
    if (!Array.isArray(pages) || pages.length === 0) return { ok: false }
    const size = paperSize === 'A4' ? 'A4' : 'Letter'
    const root = store.getSettings().storageRoot
    const defaultPath = root ? path.join(root, suggestedName) : suggestedName
    const res = await dialog.showSaveDialog({
      title: 'Export PDF',
      defaultPath,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false }
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    try {
      const pdf = await htmlToPdf(win, buildPagesHtml(pages, size), size)
      fs.writeFileSync(res.filePath, pdf)
      shell.showItemInFolder(res.filePath)
      return { ok: true, path: res.filePath }
    } catch (err) {
      console.error('[ipc] exportPdf failed:', err)
      return { ok: false }
    } finally {
      win.destroy()
    }
  })
  // Export each screenshot as its own one-page PDF into a chosen folder.
  ipcMain.handle('exportPdfBatch', async (_e, files: { dataUrl: string; name: string }[], paperSize: string) => {
    if (!Array.isArray(files) || files.length === 0) return { ok: false }
    const size = paperSize === 'A4' ? 'A4' : 'Letter'
    const dirRes = await dialog.showOpenDialog({
      title: 'Choose a folder for the PDFs',
      properties: ['openDirectory', 'createDirectory']
    })
    if (dirRes.canceled || dirRes.filePaths.length === 0) return { ok: false }
    const dir = dirRes.filePaths[0]
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    const used = new Set<string>()
    let count = 0
    try {
      for (const f of files) {
        const pdf = await htmlToPdf(win, buildPagesHtml([f.dataUrl], size), size)
        const base = sanitize(f.name || 'screenshot')
        let out = `${base}.pdf`
        let n = 2
        while (used.has(out) || fs.existsSync(path.join(dir, out))) out = `${base}-${n++}.pdf`
        used.add(out)
        fs.writeFileSync(path.join(dir, out), pdf)
        count++
      }
      shell.openPath(dir)
      return { ok: true, count, dir }
    } catch (err) {
      console.error('[ipc] exportPdfBatch failed:', err)
      return { ok: false, count }
    } finally {
      win.destroy()
    }
  })

  // ---- tags ----
  ipcMain.handle('createTag', (_e, input: { name: string; color?: string }) => {
    const tag = store.createTag(input)
    broadcastSnapshot()
    return tag
  })
  ipcMain.handle('deleteTag', (_e, id: string) => {
    store.deleteTag(id)
    reindexAll()
    broadcastSnapshot()
    return { ok: true }
  })

  // ---- capture ----
  ipcMain.handle('capture', (_e, req: CaptureRequest) => performCapture(req))
  ipcMain.handle('startScrollCapture', () => startScrollCapture())
  ipcMain.handle('scrollDone', () => finishScrollCapture())
  ipcMain.handle('scrollCancel', () => cancelScrollCapture())

  // ---- screenshots ----
  ipcMain.handle('moveScreenshot', (_e, id: string, projectId: string | null) => {
    const s = store.getScreenshot(id)
    if (!s) return null
    const project = store.getProject(projectId) ?? null
    const newPath = moveScreenshotFile(s, project)
    const updated = store.updateScreenshot(id, {
      projectId,
      filePath: newPath,
      fileName: path.basename(newPath)
    })
    store.flush() // file already moved on disk: persist the new path now
    if (updated) getSearch().update(updated, store.getProjects(), store.getTags())
    broadcastSnapshot()
    return updated
  })
  ipcMain.handle('setScreenshotTags', (_e, id: string, tagIds: string[]) => {
    const updated = store.updateScreenshot(id, { tagIds })
    if (updated) getSearch().update(updated, store.getProjects(), store.getTags())
    broadcastSnapshot()
    return updated
  })
  ipcMain.handle('toggleFavorite', (_e, id: string) => {
    const s = store.getScreenshot(id)
    if (!s) return null
    const updated = store.updateScreenshot(id, { favorite: !s.favorite })
    broadcastSnapshot()
    return updated
  })
  ipcMain.handle('deleteScreenshot', (_e, id: string, opts: { deleteFile: boolean }) => {
    const s = store.getScreenshot(id)
    if (s) {
      if (opts?.deleteFile) {
        // Move to the recoverable trash (removes from index + search inside trashById).
        trashById(id)
      } else {
        // keep the file on disk, just hide it from the library (watcher must skip it)
        const settings = store.getSettings()
        if (!settings.hiddenPaths.includes(s.filePath)) {
          store.updateSettings({ hiddenPaths: [...settings.hiddenPaths, s.filePath] })
        }
        try {
          if (s.thumbPath && fs.existsSync(s.thumbPath)) fs.unlinkSync(s.thumbPath)
        } catch { /* ignore */ }
        store.removeScreenshot(id)
        store.flush() // thumbnail removed + hiddenPaths updated: persist now
        getSearch().remove(id)
      }
      broadcastSnapshot()
    }
    return { ok: true }
  })
  ipcMain.handle('restoreTrashed', (_e, id: string) => {
    const ok = restoreById(id)
    if (ok) broadcastSnapshot()
    return { ok }
  })
  ipcMain.handle('deleteTrashedPermanently', (_e, id: string) => {
    const ok = deletePermanentlyById(id)
    if (ok) broadcastSnapshot()
    return { ok }
  })
  ipcMain.handle('emptyTrash', () => {
    emptyTrash()
    broadcastSnapshot()
    return { ok: true }
  })
  ipcMain.handle('copyScreenshotToClipboard', (_e, id: string) => {
    const s = store.getScreenshot(id)
    if (!s || !fs.existsSync(s.filePath)) return { ok: false }
    clipboard.writeImage(nativeImage.createFromPath(s.filePath))
    return { ok: true }
  })
  ipcMain.handle('copyOcrText', (_e, id: string) => {
    const s = store.getScreenshot(id)
    const text = s?.ocrText ?? ''
    if (text) clipboard.writeText(text)
    return { ok: text.length > 0, text }
  })
  ipcMain.handle('revealScreenshot', (_e, id: string) => {
    const s = store.getScreenshot(id)
    if (s) shell.showItemInFolder(s.filePath)
  })
  ipcMain.handle('importFiles', (_e, paths: string[], projectId: string | null) => {
    const imported = fsImportFiles(paths, projectId)
    for (const s of imported) {
      getSearch().update(s, store.getProjects(), store.getTags())
      queueEnrichment(s.id)
    }
    if (imported.length) store.flush() // files already copied in: persist now
    broadcastSnapshot()
    return imported
  })
  ipcMain.handle('enrichScreenshot', (_e, id: string) => enrichOne(id))
  ipcMain.handle('search', (_e, q: SearchQuery) => runSearch(q))

  // ---- editor ----
  ipcMain.handle('openEditor', (_e, id: string) => {
    createEditorWindow(id)
  })
  ipcMain.handle('saveEdited', (_e, id: string, dataUrl: string, opts: { replace: boolean }) => {
    const s = store.getScreenshot(id)
    if (!s) return null
    const { filePath, isNew } = writeEditedImage(s, dataUrl, opts.replace)
    if (isNew) {
      const created = indexFile(filePath, s.projectId, 'import')
      created.tagIds = [...s.tagIds]
      store.addScreenshot(created)
      store.flush() // new edited file written to disk: persist now
      getSearch().update(created, store.getProjects(), store.getTags())
      broadcastSnapshot()
      return created
    }
    const updated = store.updateScreenshot(id, refreshFileMeta(store.getScreenshot(id)!))
    store.flush() // original file overwritten on disk: persist refreshed metadata now
    if (updated) getSearch().update(updated, store.getProjects(), store.getTags())
    broadcastSnapshot()
    return updated
  })
  ipcMain.handle('detectPii', (_e, id: string) => {
    const s = store.getScreenshot(id)
    return s ? aiDetectPii(s) : []
  })

  // ---- pins ----
  ipcMain.handle('pinScreenshot', (_e, id: string) => {
    const s = store.getScreenshot(id)
    if (s) createPinWindow(s.id, s.width, s.height)
  })
  ipcMain.handle('closePin', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win?.close()
  })

  // ---- overlay ----
  ipcMain.handle('getOverlayData', () => getOverlayData())
  ipcMain.handle('submitOverlay', (_e, result: OverlayResult) => {
    resolveOverlay(result)
  })

  // ---- misc ----
  ipcMain.handle('toast', (_e, msg: string) => toast(msg))
  ipcMain.handle('showLibrary', () => showLibraryWindow())
}
