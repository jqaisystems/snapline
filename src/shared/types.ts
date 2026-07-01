// Shared data + IPC contract types used by main, preload, and renderer.

export type CaptureMode = 'region' | 'window' | 'fullscreen' | 'import' | 'scroll' | 'record'

// Config handed to the recordctl window when a recording session starts.
export interface RecordConfig {
  sourceId: string // desktopCapturer source id (screen or window)
  mic: boolean // capture the microphone alongside video
  micDeviceId?: string // chosen input device; empty/undefined = system default
  mode: CaptureMode // 'record'
}

export interface ScrollStatus {
  frames: number
  height: number // stitched pixel height so far
}

export type BeautifyBg =
  | { type: 'none' }
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }

export type FrameStyle = 'none' | 'browser-light' | 'browser-dark'

export interface BeautifyPreset {
  id: string
  name: string
  bg: BeautifyBg
  padding: number
  radius: number
  shadow: boolean
  aspect: number | null
  frame: FrameStyle
}

export type AiStatus = 'none' | 'pending' | 'done' | 'error' | 'skipped'

export interface Project {
  id: string
  name: string
  color: string
  icon: string
  folderName: string // folder under the storage root
  customPath?: string | null // absolute path to the project's own folder; overrides storageRoot/folderName when set
  createdAt: number
  archived: boolean
  sortOrder: number
}

export interface Tag {
  id: string
  name: string
  color: string
}

export interface Screenshot {
  id: string
  projectId: string | null // null = Unfiled
  fileName: string
  filePath: string // absolute path on disk
  thumbPath: string | null // absolute path to cached thumbnail
  width: number
  height: number
  bytes: number
  createdAt: number
  captureMode: CaptureMode
  isVideo?: boolean // true for screen recordings (WebM); absent/false = still image
  durationMs?: number // video duration in milliseconds (videos only)
  sourceApp: string | null
  sourceWindowTitle: string | null
  sourceUrl: string | null
  favorite: boolean
  pinned: boolean
  tagIds: string[]
  ocrText: string | null
  aiName: string | null
  aiDescription: string | null
  aiStatus: AiStatus
}

// A screenshot that was deleted into the recoverable trash. screenshot.filePath
// points into the trash folder; screenshot.projectId is preserved so it can be
// restored to where it came from.
export interface TrashedScreenshot {
  screenshot: Screenshot
  deletedAt: number
}

export interface Settings {
  storageRoot: string | null
  activeProjectId: string | null
  onboarded: boolean
  theme: 'dark' | 'light'
  locale: string // UI language code, e.g. 'en'. Falls back to English for unknown codes.
  trashRetentionDays: number // recoverable-trash retention before auto-purge
  launchOnStartup: boolean
  // capture behaviour
  afterCapture: 'editor' | 'save' | 'pin' // open editor / quick-save / pin floating
  copyToClipboardOnCapture: boolean
  playSound: boolean
  namingPattern: string // e.g. "{project}-{date}-{time}"
  // AI
  aiEnabled: boolean
  aiProvider: 'anthropic' | 'openai' // openai = any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, LM Studio)
  aiBaseUrl: string // base URL for the openai-compatible provider, e.g. http://localhost:11434/v1
  aiModel: string // model id used for enrichment
  hasApiKey: boolean // never expose the key itself to the renderer
  aiAutoName: boolean
  aiAutoTag: boolean
  aiAutoDescribe: boolean
  aiSuggestProject: boolean
  ocrEnabled: boolean
  // recording microphone deviceId ('' = system default)
  recordingMicId: string
  // hotkeys (Electron accelerator strings)
  hotkeys: {
    region: string
    window: string
    fullscreen: string
    delayed: string
    record: string
  }
  // brand palette for beautify
  brandColors: string[]
  // user-saved custom colors (shared by editor tools + beautify)
  customColors: string[]
  // saved beautify styles (background, frame, padding, etc.) for reuse
  beautifyPresets: BeautifyPreset[]
  // files removed from the library but kept on disk (watcher skips these)
  hiddenPaths: string[]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Data sent to the overlay window so it can render the capture surface.
export type OverlayData =
  | { kind: 'region'; dataUrl: string; bounds: Rect; scaleFactor: number }
  | { kind: 'window'; windows: { id: string; name: string; dataUrl: string }[] }

// Result the overlay sends back to main.
export type OverlayResult =
  | { kind: 'region'; rect: Rect | null } // rect in CSS px within the overlay; null = cancelled
  | { kind: 'window'; sourceId: string | null }

export interface CaptureRequest {
  mode: CaptureMode
  delayMs?: number
  projectId?: string | null // override active project
}

export interface CaptureResult {
  ok: boolean
  screenshot?: Screenshot
  error?: string
}

// What the editor window receives
export interface EditorPayload {
  screenshotId: string
  filePath: string
  width: number
  height: number
  projectId: string | null
  brandColors: string[]
  projects: Project[]
}

export interface PinPayload {
  screenshotId: string
  filePath: string
  width: number
  height: number
}

export interface LibrarySnapshot {
  settings: Settings
  projects: Project[]
  tags: Tag[]
  screenshots: Screenshot[]
  trash: TrashedScreenshot[]
}

export interface SearchQuery {
  text?: string
  projectId?: string | null // undefined = all, null = unfiled
  tagId?: string
  favorite?: boolean
  mode?: CaptureMode
  media?: 'image' | 'video' // undefined = both; 'video' = recordings only, 'image' = stills only
  fromDate?: number
  toDate?: number
  sort?: 'newest' | 'oldest' | 'name'
}

// Aggregated dominant colors across a project's screenshots (brand audit / color report).
export interface ProjectPalette {
  colors: { hex: string; weight: number }[] // weight = share of sampled pixels, 0..1
  sampled: number // how many screenshots were sampled
  total: number // total screenshots in the project
}

export interface PiiRegion {
  // normalized 0..1 coordinates relative to image
  x: number
  y: number
  width: number
  height: number
  label: string
}

// The API surface exposed on window.snapline via the preload bridge.
export interface SnaplineApi {
  // window identity
  getWindowParams: () => Promise<Record<string, string>>

  // data
  getSnapshot: () => Promise<LibrarySnapshot>
  onSnapshot: (cb: (snap: LibrarySnapshot) => void) => () => void

  // settings
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  setApiKey: (key: string) => Promise<{ ok: boolean }>
  clearApiKey: () => Promise<{ ok: boolean }>
  testApiKey: () => Promise<{ ok: boolean; error?: string }>
  chooseStorageRoot: () => Promise<string | null>
  chooseDirectory: () => Promise<string | null>
  completeOnboarding: (payload: { storageRoot: string }) => Promise<Settings>

  // projects
  createProject: (input: { name: string; color?: string; icon?: string; location?: string }) => Promise<Project>
  updateProject: (id: string, patch: Partial<Project>) => Promise<Project>
  deleteProject: (id: string, opts: { deleteFiles: boolean }) => Promise<{ ok: boolean }>
  moveProjectLocation: (id: string, newParentDir: string) => Promise<{ ok: boolean; moved: number }>
  setActiveProject: (id: string | null) => Promise<Settings>
  openProjectFolder: (id: string) => Promise<void>
  getProjectPalette: (projectId: string) => Promise<ProjectPalette>

  // tags
  createTag: (input: { name: string; color?: string }) => Promise<Tag>
  deleteTag: (id: string) => Promise<{ ok: boolean }>

  // capture
  capture: (req: CaptureRequest) => Promise<CaptureResult>

  // scrolling capture
  startScrollCapture: () => Promise<void>
  scrollDone: () => Promise<void>
  scrollCancel: () => Promise<void>
  onScrollStatus: (cb: (status: ScrollStatus) => void) => () => void

  // screen recording (video)
  startRecording: (mode: 'screen' | 'window') => Promise<{ ok: boolean }>
  getRecordConfig: () => Promise<RecordConfig | null>
  finishRecording: (payload: { webm: ArrayBuffer; posterDataUrl: string | null; width: number; height: number; durationMs: number }) => Promise<void>
  cancelRecording: () => Promise<void>

  // screenshots
  moveScreenshot: (id: string, projectId: string | null) => Promise<Screenshot>
  setScreenshotTags: (id: string, tagIds: string[]) => Promise<Screenshot>
  toggleFavorite: (id: string) => Promise<Screenshot>
  deleteScreenshot: (id: string, opts: { deleteFile: boolean }) => Promise<{ ok: boolean }>
  // recoverable trash
  restoreTrashed: (id: string) => Promise<{ ok: boolean }>
  deleteTrashedPermanently: (id: string) => Promise<{ ok: boolean }>
  emptyTrash: () => Promise<{ ok: boolean }>
  copyScreenshotToClipboard: (id: string) => Promise<{ ok: boolean }>
  copyOcrText: (id: string) => Promise<{ ok: boolean; text: string }>
  revealScreenshot: (id: string) => Promise<void>
  importFiles: (paths: string[], projectId: string | null) => Promise<Screenshot[]>
  enrichScreenshot: (id: string) => Promise<Screenshot>
  search: (q: SearchQuery) => Promise<string[]> // returns ordered screenshot ids

  // export (client deliverables): write a composed PNG to a user-chosen path
  exportImage: (dataUrl: string, suggestedName: string) => Promise<{ ok: boolean; path?: string }>
  // export a multi-page PDF from page images (each pre-sized to the page aspect)
  exportPdf: (pages: string[], suggestedName: string, paperSize: string) => Promise<{ ok: boolean; path?: string }>
  // export each image as its own one-page PDF into a chosen folder
  exportPdfBatch: (files: { dataUrl: string; name: string }[], paperSize: string) => Promise<{ ok: boolean; count?: number; dir?: string }>

  // editor
  openEditor: (id: string) => Promise<void>
  saveEdited: (id: string, dataUrl: string, opts: { replace: boolean }) => Promise<Screenshot>
  detectPii: (id: string) => Promise<PiiRegion[]>

  // pins
  pinScreenshot: (id: string) => Promise<void>
  closePin: () => Promise<void>

  // overlay (used by overlay window)
  getOverlayData: () => Promise<OverlayData | null>
  submitOverlay: (result: OverlayResult) => Promise<void>

  // misc
  fileUrl: (absPath: string) => string
  toast: (msg: string) => void
  onToast: (cb: (msg: string) => void) => () => void
}

declare global {
  interface Window {
    snapline: SnaplineApi
  }
}
