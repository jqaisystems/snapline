import { clipboard, nativeImage } from 'electron'
import { getStore } from './store'
import { getSearch } from './search'
import { captureFullscreen, captureRegion, captureWindow } from './capture'
import { saveCaptureBuffer, projectDir } from './storageFs'
import { queueEnrichment } from './pipeline'
import { broadcastSnapshot, toast } from './broadcast'
import { createEditorWindow, createPinWindow } from './windows'
import type { CaptureRequest, CaptureResult } from '../shared/types'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function performCapture(req: CaptureRequest): Promise<CaptureResult> {
  const store = getStore()
  const settings = store.getSettings()
  if (!settings.storageRoot) {
    return { ok: false, error: 'Choose a storage folder in Snapline before capturing.' }
  }

  if (req.delayMs && req.delayMs > 0) await sleep(req.delayMs)

  let buffer: Buffer | null = null
  try {
    if (req.mode === 'region') buffer = await captureRegion()
    else if (req.mode === 'window') buffer = await captureWindow()
    else buffer = await captureFullscreen()
  } catch (err) {
    console.error('[capture] failed:', err)
    return { ok: false, error: 'Capture failed.' }
  }

  if (!buffer) return { ok: false } // cancelled by the user

  // Resolve the active project at the moment the capture completes, so it always
  // reflects the latest selection (not whatever was active when the hotkey fired).
  const current = store.getSettings()
  const projectId = req.projectId !== undefined ? req.projectId : current.activeProjectId
  const project = store.getProject(projectId) ?? null

  const screenshot = saveCaptureBuffer(buffer, { mode: req.mode, project }, current)
  if (!screenshot) return { ok: false, error: 'Could not save the screenshot.' }

  store.addScreenshot(screenshot)
  getSearch().update(screenshot, store.getProjects(), store.getTags())

  if (settings.copyToClipboardOnCapture) {
    try {
      clipboard.writeImage(nativeImage.createFromBuffer(buffer))
    } catch { /* ignore */ }
  }

  broadcastSnapshot()
  queueEnrichment(screenshot.id)

  const dir = projectDir(project) ?? current.storageRoot ?? ''
  console.log(`[capture] filed into "${project ? project.name : 'Unfiled'}" -> ${screenshot.filePath}`)
  toast(`Saved to ${dir}`)

  if (current.afterCapture === 'editor') {
    createEditorWindow(screenshot.id)
  } else if (current.afterCapture === 'pin') {
    createPinWindow(screenshot.id, screenshot.width, screenshot.height)
  }

  return { ok: true, screenshot }
}
