import { app, nativeImage } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { CaptureMode, Project, Screenshot, Settings } from '../shared/types'
import { getStore } from './store'

const UNFILED_FOLDER = '_Unfiled'
// Dot-prefixed so the chokidar watcher (which ignores dotfiles) never indexes it.
const TRASH_FOLDER = '.snapline-trash'
export const SUPPORTED_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']

function thumbsDir(): string {
  const dir = path.join(app.getPath('userData'), 'thumbnails')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || 'untitled'
}

export function ensureRoot(): string | null {
  const root = getStore().getSettings().storageRoot
  if (!root) return null
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  const unfiled = path.join(root, UNFILED_FOLDER)
  if (!fs.existsSync(unfiled)) fs.mkdirSync(unfiled, { recursive: true })
  return root
}

export function projectDir(project: Project | null): string | null {
  // A project may live at a custom absolute location, outside the storage root.
  if (project?.customPath) {
    if (!fs.existsSync(project.customPath)) fs.mkdirSync(project.customPath, { recursive: true })
    return project.customPath
  }
  const root = ensureRoot()
  if (!root) return null
  const dir = project ? path.join(root, project.folderName) : path.join(root, UNFILED_FOLDER)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function uniqueFolderName(root: string, name: string): string {
  let base = sanitize(name)
  let candidate = base
  let n = 2
  while (fs.existsSync(path.join(root, candidate))) {
    candidate = `${base} ${n++}`
  }
  return candidate
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatName(pattern: string, projectName: string, mode: CaptureMode): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  return sanitize(
    pattern
      .replace(/{project}/g, projectName || 'capture')
      .replace(/{date}/g, date)
      .replace(/{time}/g, time)
      .replace(/{mode}/g, mode)
  )
}

function uniqueFilePath(dir: string, base: string, ext: string): string {
  let candidate = path.join(dir, base + ext)
  let n = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${n++}${ext}`)
    if (n > 9999) break
  }
  return candidate
}

export function makeThumbnail(filePath: string, id: string): string | null {
  try {
    let img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return null
    const size = img.getSize()
    const maxW = 480
    if (size.width > maxW) {
      img = img.resize({ width: maxW, quality: 'good' })
    }
    const out = path.join(thumbsDir(), `${id}.png`)
    fs.writeFileSync(out, img.toPNG())
    return out
  } catch (err) {
    console.error('[storageFs] thumbnail failed:', err)
    return null
  }
}

function dimsAndBytes(filePath: string): { width: number; height: number; bytes: number } {
  let width = 0
  let height = 0
  let bytes = 0
  try {
    bytes = fs.statSync(filePath).size
    const img = nativeImage.createFromPath(filePath)
    const s = img.getSize()
    width = s.width
    height = s.height
  } catch { /* ignore */ }
  return { width, height, bytes }
}

interface SaveContext {
  mode: CaptureMode
  project: Project | null
  sourceApp?: string | null
  sourceWindowTitle?: string | null
  sourceUrl?: string | null
}

// Save a freshly captured PNG buffer into the right project folder, return an indexed Screenshot.
export function saveCaptureBuffer(buffer: Buffer, ctx: SaveContext, settings: Settings): Screenshot | null {
  const dir = projectDir(ctx.project)
  if (!dir) return null
  const base = formatName(settings.namingPattern, ctx.project?.name ?? '', ctx.mode)
  const filePath = uniqueFilePath(dir, base, '.png')
  fs.writeFileSync(filePath, buffer)
  return indexFile(filePath, ctx.project ? ctx.project.id : null, ctx.mode, {
    sourceApp: ctx.sourceApp ?? null,
    sourceWindowTitle: ctx.sourceWindowTitle ?? null,
    sourceUrl: ctx.sourceUrl ?? null
  })
}

// Create a Screenshot record for a file that already exists on disk.
export function indexFile(
  filePath: string,
  projectId: string | null,
  mode: CaptureMode,
  extra?: { sourceApp?: string | null; sourceWindowTitle?: string | null; sourceUrl?: string | null }
): Screenshot {
  const id = randomUUID()
  const { width, height, bytes } = dimsAndBytes(filePath)
  const thumbPath = makeThumbnail(filePath, id)
  let createdAt = Date.now()
  try {
    createdAt = fs.statSync(filePath).birthtimeMs || fs.statSync(filePath).mtimeMs || Date.now()
  } catch { /* ignore */ }
  const screenshot: Screenshot = {
    id,
    projectId,
    fileName: path.basename(filePath),
    filePath,
    thumbPath,
    width,
    height,
    bytes,
    createdAt,
    captureMode: mode,
    sourceApp: extra?.sourceApp ?? null,
    sourceWindowTitle: extra?.sourceWindowTitle ?? null,
    sourceUrl: extra?.sourceUrl ?? null,
    favorite: false,
    pinned: false,
    tagIds: [],
    ocrText: null,
    aiName: null,
    aiDescription: null,
    aiStatus: 'none'
  }
  return screenshot
}

// Save a recorded WebM video + its poster frame, and build a video Screenshot. The poster
// and dimensions are computed in the renderer (nativeImage can't read WebM) and passed in.
export function saveRecordedVideo(
  webm: Buffer,
  poster: Buffer | null,
  meta: { width: number; height: number; durationMs: number },
  ctx: SaveContext,
  settings: Settings
): Screenshot | null {
  const dir = projectDir(ctx.project)
  if (!dir) return null
  const base = formatName(settings.namingPattern, ctx.project?.name ?? '', ctx.mode)
  const filePath = uniqueFilePath(dir, base, '.webm')
  fs.writeFileSync(filePath, webm)
  const id = randomUUID()
  let thumbPath: string | null = null
  if (poster && poster.length > 0) {
    try {
      const out = path.join(thumbsDir(), `${id}.png`)
      fs.writeFileSync(out, poster)
      thumbPath = out
    } catch (err) {
      console.error('[storageFs] video poster write failed:', err)
    }
  }
  let bytes = 0
  try {
    bytes = fs.statSync(filePath).size
  } catch { /* ignore */ }
  return {
    id,
    projectId: ctx.project ? ctx.project.id : null,
    fileName: path.basename(filePath),
    filePath,
    thumbPath,
    width: meta.width,
    height: meta.height,
    bytes,
    createdAt: Date.now(),
    captureMode: ctx.mode,
    isVideo: true,
    durationMs: meta.durationMs,
    sourceApp: ctx.sourceApp ?? null,
    sourceWindowTitle: ctx.sourceWindowTitle ?? null,
    sourceUrl: ctx.sourceUrl ?? null,
    favorite: false,
    pinned: false,
    tagIds: [],
    ocrText: null,
    aiName: null,
    aiDescription: null,
    aiStatus: 'none'
  }
}

// Copy external files into a project folder and index them.
export function importFiles(srcPaths: string[], projectId: string | null): Screenshot[] {
  const store = getStore()
  const project = store.getProject(projectId)
  const dir = projectDir(project ?? null)
  if (!dir) return []
  const out: Screenshot[] = []
  for (const src of srcPaths.slice(0, 1000)) {
    // Renderer supplies these paths; validate before copying: real file + supported type.
    const ext = path.extname(src).toLowerCase()
    if (!SUPPORTED_EXT.includes(ext)) continue
    const st = fs.statSync(src, { throwIfNoEntry: false })
    if (!st || !st.isFile()) continue
    try {
      const base = sanitize(path.basename(src, ext))
      const dest = uniqueFilePath(dir, base, ext)
      fs.copyFileSync(src, dest)
      const s = indexFile(dest, projectId, 'import')
      store.addScreenshot(s)
      out.push(s)
    } catch (err) {
      console.error('[storageFs] import failed for', src, err)
    }
  }
  return out
}

// Move a screenshot file to a different project folder; returns new path.
export function moveScreenshotFile(screenshot: Screenshot, newProject: Project | null): string {
  const dir = projectDir(newProject)
  if (!dir) return screenshot.filePath
  const ext = path.extname(screenshot.filePath)
  const base = sanitize(path.basename(screenshot.filePath, ext))
  const dest = uniqueFilePath(dir, base, ext)
  try {
    fs.renameSync(screenshot.filePath, dest)
    return dest
  } catch {
    try {
      fs.copyFileSync(screenshot.filePath, dest)
      fs.unlinkSync(screenshot.filePath)
      return dest
    } catch (err) {
      console.error('[storageFs] move failed:', err)
      return screenshot.filePath
    }
  }
}

export function deleteScreenshotFiles(screenshot: Screenshot): void {
  try {
    if (fs.existsSync(screenshot.filePath)) fs.unlinkSync(screenshot.filePath)
  } catch (err) {
    console.error('[storageFs] delete file failed:', err)
  }
  try {
    if (screenshot.thumbPath && fs.existsSync(screenshot.thumbPath)) fs.unlinkSync(screenshot.thumbPath)
  } catch { /* ignore */ }
}

function trashDir(): string | null {
  const root = ensureRoot()
  if (!root) return null
  const dir = path.join(root, TRASH_FOLDER)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Move a screenshot's file into the trash folder (recoverable). Thumbnail is kept
// untouched so the trash view can still show a preview. Returns the new path, or
// null if the trash folder is unavailable (caller should fall back to hard delete).
export function moveFileToTrash(screenshot: Screenshot): string | null {
  const dir = trashDir()
  if (!dir) return null
  // Prefix with the id to guarantee uniqueness inside the flat trash folder.
  const dest = path.join(dir, `${screenshot.id}__${path.basename(screenshot.filePath)}`)
  try {
    fs.renameSync(screenshot.filePath, dest)
    return dest
  } catch {
    try {
      fs.copyFileSync(screenshot.filePath, dest)
      fs.unlinkSync(screenshot.filePath)
      return dest
    } catch (err) {
      console.error('[storageFs] move to trash failed:', err)
      return null
    }
  }
}

// Move a trashed file back out to a project folder. Returns the restored path
// (its thumbnail never moved, so it stays valid).
export function restoreFileFromTrash(screenshot: Screenshot, project: Project | null): string | null {
  const dir = projectDir(project)
  if (!dir) return null
  // Strip the "<id>__" trash prefix to recover the original base name.
  const trashedBase = path.basename(screenshot.filePath).replace(/^[^_]+__/, '')
  const ext = path.extname(trashedBase)
  const base = sanitize(path.basename(trashedBase, ext))
  const dest = uniqueFilePath(dir, base, ext)
  try {
    fs.renameSync(screenshot.filePath, dest)
    return dest
  } catch {
    try {
      fs.copyFileSync(screenshot.filePath, dest)
      fs.unlinkSync(screenshot.filePath)
      return dest
    } catch (err) {
      console.error('[storageFs] restore from trash failed:', err)
      return null
    }
  }
}

// Write edited image (data URL) back to disk. replace=true overwrites; else creates "<name>-edited".
export function writeEditedImage(screenshot: Screenshot, dataUrl: string, replace: boolean): { filePath: string; isNew: boolean } {
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(b64, 'base64')
  if (replace) {
    fs.writeFileSync(screenshot.filePath, buffer)
    return { filePath: screenshot.filePath, isNew: false }
  }
  const dir = path.dirname(screenshot.filePath)
  const ext = path.extname(screenshot.filePath)
  const base = sanitize(path.basename(screenshot.filePath, ext) + '-edited')
  const dest = uniqueFilePath(dir, base, ext)
  fs.writeFileSync(dest, buffer)
  return { filePath: dest, isNew: true }
}
