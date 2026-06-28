import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { LibrarySnapshot, Project, Screenshot, Settings, Tag, TrashedScreenshot } from '../shared/types'

const PALETTE = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16'
]

export function randomColor(seed = 0): string {
  return PALETTE[Math.abs(seed) % PALETTE.length]
}

function defaultSettings(): Settings {
  return {
    storageRoot: null,
    activeProjectId: null,
    onboarded: false,
    theme: 'dark',
    locale: 'en',
    trashRetentionDays: 30,
    launchOnStartup: false,
    afterCapture: 'editor',
    copyToClipboardOnCapture: true,
    playSound: false,
    namingPattern: '{project}-{date}-{time}',
    aiEnabled: false,
    aiProvider: 'anthropic',
    aiBaseUrl: '',
    aiModel: 'claude-opus-4-8',
    hasApiKey: false,
    aiAutoName: true,
    aiAutoTag: true,
    aiAutoDescribe: true,
    aiSuggestProject: true,
    ocrEnabled: true,
    hotkeys: {
      region: 'Control+Shift+1',
      window: 'Control+Shift+2',
      fullscreen: 'Control+Shift+3',
      delayed: 'Control+Shift+4'
    },
    brandColors: ['#0f172a', '#6366f1', '#f8fafc'],
    customColors: [],
    beautifyPresets: [],
    hiddenPaths: []
  }
}

interface DbShape {
  settings: Settings
  projects: Project[]
  tags: Tag[]
  screenshots: Screenshot[]
  trash: TrashedScreenshot[]
}

class Store {
  private dataPath: string
  private keyPath: string
  private db: DbShape
  private saveTimer: NodeJS.Timeout | null = null
  private cachedApiKey: string | null = null

  constructor() {
    const dir = app.getPath('userData')
    this.dataPath = path.join(dir, 'snapline-data.json')
    this.keyPath = path.join(dir, 'snapline-key.bin')
    this.db = this.load()
    this.loadApiKey()
  }

  // Parse a data file into a DbShape, or null if missing/corrupt.
  private readFrom(p: string): DbShape | null {
    try {
      if (!fs.existsSync(p)) return null
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return {
        settings: { ...defaultSettings(), ...raw.settings, hasApiKey: false },
        projects: raw.projects ?? [],
        tags: raw.tags ?? [],
        screenshots: raw.screenshots ?? [],
        trash: raw.trash ?? []
      }
    } catch (err) {
      console.error(`[store] could not parse ${p}:`, err)
      return null
    }
  }

  private load(): DbShape {
    const main = this.readFrom(this.dataPath)
    if (main) return main
    // Main file missing or corrupt: try the last-known-good backup before giving up,
    // so a crash mid-write can never silently wipe the whole library.
    const bak = this.readFrom(this.dataPath + '.bak')
    if (bak) {
      console.warn('[store] main data file unreadable; recovered from .bak')
      return bak
    }
    return { settings: defaultSettings(), projects: [], tags: [], screenshots: [], trash: [] }
  }

  // Atomic write: serialize to a temp file, snapshot the previous good file to .bak,
  // then rename temp over the live file (atomic on the same volume). A crash can leave
  // a stray .tmp but never a half-written data file.
  private writeDb(): void {
    try {
      const toSave = { ...this.db, settings: { ...this.db.settings, hasApiKey: false } }
      const json = JSON.stringify(toSave, null, 2)
      const tmp = this.dataPath + '.tmp'
      fs.writeFileSync(tmp, json, 'utf-8')
      try {
        if (fs.existsSync(this.dataPath)) fs.copyFileSync(this.dataPath, this.dataPath + '.bak')
      } catch {
        /* backup is best-effort */
      }
      fs.renameSync(tmp, this.dataPath)
    } catch (err) {
      console.error('[store] write failed:', err)
    }
  }

  private persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.writeDb(), 250)
  }

  // Force an immediate synchronous write. Call after any operation that has already
  // changed the filesystem (capture/move/trash/restore/delete/import/edit) so a crash
  // cannot strand a file with the index pointing at the wrong place.
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.writeDb()
  }

  // ---- settings ----
  getSettings(): Settings {
    return { ...this.db.settings, hasApiKey: this.cachedApiKey != null }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.db.settings = { ...this.db.settings, ...patch }
    this.persist()
    return this.getSettings()
  }

  // ---- api key (encrypted at rest) ----
  private loadApiKey(): void {
    try {
      if (fs.existsSync(this.keyPath) && safeStorage.isEncryptionAvailable()) {
        const buf = fs.readFileSync(this.keyPath)
        this.cachedApiKey = safeStorage.decryptString(buf)
      } else if (fs.existsSync(this.keyPath)) {
        // encryption not available on this OS profile; stored as plain (best effort)
        this.cachedApiKey = fs.readFileSync(this.keyPath, 'utf-8')
      }
    } catch (err) {
      console.error('[store] could not read api key:', err)
      this.cachedApiKey = null
    }
  }

  setApiKey(key: string): void {
    const trimmed = key.trim()
    if (!trimmed) return this.clearApiKey()
    try {
      if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(this.keyPath, safeStorage.encryptString(trimmed))
      } else {
        fs.writeFileSync(this.keyPath, trimmed, 'utf-8')
      }
      this.cachedApiKey = trimmed
    } catch (err) {
      console.error('[store] could not save api key:', err)
    }
  }

  clearApiKey(): void {
    try {
      if (fs.existsSync(this.keyPath)) fs.unlinkSync(this.keyPath)
    } catch { /* ignore */ }
    this.cachedApiKey = null
  }

  getApiKey(): string | null {
    return this.cachedApiKey
  }

  // ---- projects ----
  getProjects(): Project[] {
    return this.db.projects.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  }

  getProject(id: string | null): Project | undefined {
    if (!id) return undefined
    return this.db.projects.find((p) => p.id === id)
  }

  createProject(input: { name: string; color?: string; icon?: string; folderName: string }): Project {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      color: input.color ?? randomColor(this.db.projects.length),
      icon: input.icon ?? 'folder',
      folderName: input.folderName,
      createdAt: Date.now(),
      archived: false,
      sortOrder: this.db.projects.length
    }
    this.db.projects.push(project)
    this.persist()
    return project
  }

  updateProject(id: string, patch: Partial<Project>): Project | undefined {
    const p = this.db.projects.find((x) => x.id === id)
    if (!p) return undefined
    // Whitelist user-editable fields. Never accept id/folderName/createdAt from a patch:
    // folderName feeds filesystem paths (incl. recursive project-folder deletion), so a
    // tampered value could escape the storage root.
    const ALLOWED: (keyof Project)[] = ['name', 'color', 'icon', 'archived', 'sortOrder']
    for (const k of ALLOWED) {
      if (k in patch && patch[k] !== undefined) (p[k] as Project[typeof k]) = patch[k]!
    }
    this.persist()
    return p
  }

  deleteProject(id: string): void {
    this.db.projects = this.db.projects.filter((p) => p.id !== id)
    // orphan its screenshots to Unfiled
    for (const s of this.db.screenshots) {
      if (s.projectId === id) s.projectId = null
    }
    if (this.db.settings.activeProjectId === id) this.db.settings.activeProjectId = null
    this.persist()
  }

  // ---- tags ----
  getTags(): Tag[] {
    return this.db.tags.slice()
  }

  createTag(input: { name: string; color?: string }): Tag {
    const existing = this.db.tags.find((t) => t.name.toLowerCase() === input.name.toLowerCase())
    if (existing) return existing
    const tag: Tag = {
      id: randomUUID(),
      name: input.name,
      color: input.color ?? randomColor(this.db.tags.length)
    }
    this.db.tags.push(tag)
    this.persist()
    return tag
  }

  deleteTag(id: string): void {
    this.db.tags = this.db.tags.filter((t) => t.id !== id)
    for (const s of this.db.screenshots) {
      s.tagIds = s.tagIds.filter((t) => t !== id)
    }
    this.persist()
  }

  ensureTagByName(name: string): Tag {
    return this.createTag({ name })
  }

  // ---- screenshots ----
  getScreenshots(): Screenshot[] {
    return this.db.screenshots.slice().sort((a, b) => b.createdAt - a.createdAt)
  }

  getScreenshot(id: string): Screenshot | undefined {
    return this.db.screenshots.find((s) => s.id === id)
  }

  getScreenshotByPath(filePath: string): Screenshot | undefined {
    const norm = path.normalize(filePath).toLowerCase()
    return this.db.screenshots.find((s) => path.normalize(s.filePath).toLowerCase() === norm)
  }

  addScreenshot(s: Screenshot): Screenshot {
    this.db.screenshots.push(s)
    this.persist()
    return s
  }

  updateScreenshot(id: string, patch: Partial<Screenshot>): Screenshot | undefined {
    const s = this.db.screenshots.find((x) => x.id === id)
    if (!s) return undefined
    Object.assign(s, patch)
    this.persist()
    return s
  }

  removeScreenshot(id: string): Screenshot | undefined {
    const s = this.db.screenshots.find((x) => x.id === id)
    this.db.screenshots = this.db.screenshots.filter((x) => x.id !== id)
    this.persist()
    return s
  }

  // ---- trash (recoverable deletes) ----
  getTrash(): TrashedScreenshot[] {
    return this.db.trash.slice().sort((a, b) => b.deletedAt - a.deletedAt)
  }

  getTrashItem(id: string): TrashedScreenshot | undefined {
    return this.db.trash.find((t) => t.screenshot.id === id)
  }

  addToTrash(item: TrashedScreenshot): void {
    this.db.trash.push(item)
    this.persist()
  }

  removeFromTrash(id: string): TrashedScreenshot | undefined {
    const item = this.db.trash.find((t) => t.screenshot.id === id)
    this.db.trash = this.db.trash.filter((t) => t.screenshot.id !== id)
    this.persist()
    return item
  }

  clearTrash(): TrashedScreenshot[] {
    const items = this.db.trash.slice()
    this.db.trash = []
    this.persist()
    return items
  }

  snapshot(): LibrarySnapshot {
    return {
      settings: this.getSettings(),
      projects: this.getProjects(),
      tags: this.getTags(),
      screenshots: this.getScreenshots(),
      trash: this.getTrash()
    }
  }
}

let _store: Store | null = null
export function getStore(): Store {
  if (!_store) _store = new Store()
  return _store
}
export type { Store }
