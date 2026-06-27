import chokidar, { FSWatcher } from 'chokidar'
import fs from 'fs'
import path from 'path'
import { getStore } from './store'
import { getSearch } from './search'
import { indexFile, SUPPORTED_EXT } from './storageFs'
import { broadcastSnapshot } from './broadcast'
import { queueEnrichment } from './pipeline'

let watcher: FSWatcher | null = null

// Map a file's on-disk location to a project id (folder name == project.folderName), or null (Unfiled).
function projectIdForPath(root: string, filePath: string): string | null {
  const rel = path.relative(root, filePath)
  const segments = rel.split(path.sep)
  if (segments.length < 2) return null // file directly in root → Unfiled
  const folder = segments[0]
  if (folder === '_Unfiled') return null
  const project = getStore().getProjects().find((p) => p.folderName === folder)
  return project ? project.id : null
}

function onAdd(root: string, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase()
  if (!SUPPORTED_EXT.includes(ext)) return
  const store = getStore()
  // Already tracked (e.g. created by the app itself) → ignore.
  if (store.getScreenshotByPath(filePath)) return
  // Hidden from the library on purpose (kept on disk) → do not re-index.
  const norm = path.normalize(filePath).toLowerCase()
  if (store.getSettings().hiddenPaths.some((p) => path.normalize(p).toLowerCase() === norm)) return
  const projectId = projectIdForPath(root, filePath)
  const screenshot = indexFile(filePath, projectId, 'import')
  store.addScreenshot(screenshot)
  getSearch().update(screenshot, store.getProjects(), store.getTags())
  broadcastSnapshot()
  queueEnrichment(screenshot.id)
}

function onUnlink(filePath: string): void {
  // Debounce: an in-app move is rename(old → new); by the time this fires the store row
  // already points at the new path, so getScreenshotByPath(old) is undefined and we skip.
  setTimeout(() => {
    const store = getStore()
    const existing = store.getScreenshotByPath(filePath)
    if (existing && !fs.existsSync(filePath)) {
      store.removeScreenshot(existing.id)
      getSearch().remove(existing.id)
      broadcastSnapshot()
    }
  }, 800)
}

export function startWatcher(): void {
  stopWatcher()
  const root = getStore().getSettings().storageRoot
  if (!root || !fs.existsSync(root)) return
  watcher = chokidar.watch(root, {
    ignoreInitial: false,
    depth: 4,
    ignored: /(^|[\\/])\../, // dotfiles
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })
  watcher.on('add', (p) => onAdd(root, p))
  watcher.on('unlink', (p) => onUnlink(p))
  watcher.on('error', (err) => console.error('[watcher] error:', err))
}

export function stopWatcher(): void {
  if (watcher) {
    void watcher.close()
    watcher = null
  }
}
