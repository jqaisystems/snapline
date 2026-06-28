import { contextBridge, ipcRenderer } from 'electron'
import type {
  CaptureRequest,
  LibrarySnapshot,
  OverlayResult,
  Project,
  Screenshot,
  ScrollStatus,
  SearchQuery,
  Settings,
  SnaplineApi,
  Tag
} from '../shared/types'

const MEDIA_PREFIX = 'snapmedia://f/'

const api: SnaplineApi = {
  getWindowParams: async () => {
    const params = new URLSearchParams(window.location.search)
    const out: Record<string, string> = {}
    params.forEach((v, k) => (out[k] = v))
    return out
  },

  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  onSnapshot: (cb) => {
    const handler = (_e: unknown, snap: LibrarySnapshot): void => cb(snap)
    ipcRenderer.on('snapshot', handler)
    return () => ipcRenderer.removeListener('snapshot', handler)
  },

  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('updateSettings', patch),
  setApiKey: (key: string) => ipcRenderer.invoke('setApiKey', key),
  clearApiKey: () => ipcRenderer.invoke('clearApiKey'),
  testApiKey: () => ipcRenderer.invoke('testApiKey'),
  chooseStorageRoot: () => ipcRenderer.invoke('chooseStorageRoot'),
  completeOnboarding: (payload) => ipcRenderer.invoke('completeOnboarding', payload),

  createProject: (input) => ipcRenderer.invoke('createProject', input),
  updateProject: (id, patch: Partial<Project>) => ipcRenderer.invoke('updateProject', id, patch),
  deleteProject: (id, opts) => ipcRenderer.invoke('deleteProject', id, opts),
  setActiveProject: (id) => ipcRenderer.invoke('setActiveProject', id),
  openProjectFolder: (id) => ipcRenderer.invoke('openProjectFolder', id),
  getProjectPalette: (projectId) => ipcRenderer.invoke('getProjectPalette', projectId),

  createTag: (input) => ipcRenderer.invoke('createTag', input),
  deleteTag: (id) => ipcRenderer.invoke('deleteTag', id),

  capture: (req: CaptureRequest) => ipcRenderer.invoke('capture', req),

  startScrollCapture: () => ipcRenderer.invoke('startScrollCapture'),
  scrollDone: () => ipcRenderer.invoke('scrollDone'),
  scrollCancel: () => ipcRenderer.invoke('scrollCancel'),
  onScrollStatus: (cb) => {
    const handler = (_e: unknown, status: ScrollStatus): void => cb(status)
    ipcRenderer.on('scrollStatus', handler)
    return () => ipcRenderer.removeListener('scrollStatus', handler)
  },

  moveScreenshot: (id, projectId) => ipcRenderer.invoke('moveScreenshot', id, projectId),
  setScreenshotTags: (id, tagIds: string[]) => ipcRenderer.invoke('setScreenshotTags', id, tagIds),
  toggleFavorite: (id) => ipcRenderer.invoke('toggleFavorite', id),
  deleteScreenshot: (id, opts) => ipcRenderer.invoke('deleteScreenshot', id, opts),
  restoreTrashed: (id) => ipcRenderer.invoke('restoreTrashed', id),
  deleteTrashedPermanently: (id) => ipcRenderer.invoke('deleteTrashedPermanently', id),
  emptyTrash: () => ipcRenderer.invoke('emptyTrash'),
  copyScreenshotToClipboard: (id) => ipcRenderer.invoke('copyScreenshotToClipboard', id),
  copyOcrText: (id) => ipcRenderer.invoke('copyOcrText', id),
  revealScreenshot: (id) => ipcRenderer.invoke('revealScreenshot', id),
  importFiles: (paths: string[], projectId) => ipcRenderer.invoke('importFiles', paths, projectId),
  enrichScreenshot: (id) => ipcRenderer.invoke('enrichScreenshot', id),
  search: (q: SearchQuery) => ipcRenderer.invoke('search', q),

  exportImage: (dataUrl, suggestedName) => ipcRenderer.invoke('exportImage', dataUrl, suggestedName),
  exportPdf: (pages, suggestedName, paperSize) => ipcRenderer.invoke('exportPdf', pages, suggestedName, paperSize),
  exportPdfBatch: (files, paperSize) => ipcRenderer.invoke('exportPdfBatch', files, paperSize),

  openEditor: (id) => ipcRenderer.invoke('openEditor', id),
  saveEdited: (id, dataUrl, opts) => ipcRenderer.invoke('saveEdited', id, dataUrl, opts),
  detectPii: (id) => ipcRenderer.invoke('detectPii', id),

  pinScreenshot: (id) => ipcRenderer.invoke('pinScreenshot', id),
  closePin: () => ipcRenderer.invoke('closePin'),

  getOverlayData: () => ipcRenderer.invoke('getOverlayData'),
  submitOverlay: (result: OverlayResult) => ipcRenderer.invoke('submitOverlay', result),

  fileUrl: (absPath: string) => MEDIA_PREFIX + encodeURIComponent(absPath),
  toast: (msg: string) => void ipcRenderer.invoke('toast', msg),
  onToast: (cb) => {
    const handler = (_e: unknown, msg: string): void => cb(msg)
    ipcRenderer.on('toast', handler)
    return () => ipcRenderer.removeListener('toast', handler)
  }
}

contextBridge.exposeInMainWorld('snapline', api)
