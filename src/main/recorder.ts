// Screen-recording lifecycle, mirroring scrollCapture.ts: pick a source, hide the library
// window, open the recordctl control window (which runs MediaRecorder), then on stop save the
// WebM + poster and index it as a video. The actual recording runs in the renderer because
// MediaRecorder/getUserMedia are browser APIs.
import { systemPreferences } from 'electron'
import { getStore } from './store'
import { getSearch } from './search'
import { getDisplaySourceIdUnderCursor, pickWindowSourceId } from './capture'
import { saveRecordedVideo } from './storageFs'
import { broadcastSnapshot, toast } from './broadcast'
import { createRecordControlWindow, closeRecordControlWindow, getLibraryWindow } from './windows'
import type { Project, RecordConfig } from '../shared/types'

// Sanity bounds on renderer-supplied recording data before it is written to disk.
const MAX_WEBM_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
const MAX_POSTER_CHARS = 8 * 1024 * 1024 // ~8 MB of base64

let pending: { project: Project | null; config: RecordConfig } | null = null
let starting = false // set across the async source-picker so a second trigger can't double-start
let libWasVisible = false

function hideLibrary(): void {
  const lib = getLibraryWindow()
  libWasVisible = !!(lib && lib.isVisible())
  if (libWasVisible) lib!.hide()
}
function restoreLibrary(): void {
  if (libWasVisible) getLibraryWindow()?.show()
  libWasVisible = false
}

export async function startRecording(mode: 'screen' | 'window'): Promise<{ ok: boolean }> {
  if (pending || starting) return { ok: false } // already recording, or a start is in flight
  const store = getStore()
  const settings = store.getSettings()
  if (!settings.storageRoot) {
    toast('Choose a storage folder in Snapline before recording.')
    return { ok: false }
  }
  starting = true
  try {
    const sourceId =
      mode === 'window' ? await pickWindowSourceId() : await getDisplaySourceIdUnderCursor()
    if (!sourceId) return { ok: false } // cancelled or no source available
    const project = store.getProject(settings.activeProjectId) ?? null
    pending = {
      project,
      config: {
        sourceId,
        mic: true,
        micDeviceId: settings.recordingMicId || undefined,
        format: settings.recordingFormat,
        mode: 'record'
      }
    }
    // Preflight the OS mic permission while the library is still visible, so a blocked mic gets an
    // actionable message instead of a silently audio-less video. The recording still proceeds.
    if (pending.config.mic && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      toast('Microphone is blocked in Windows. Enable it in Settings > Privacy > Microphone > "Let desktop apps access your microphone".')
    }
    hideLibrary()
    createRecordControlWindow()
    return { ok: true }
  } finally {
    starting = false
  }
}

export function getRecordConfig(): RecordConfig | null {
  return pending?.config ?? null
}

export function finishRecording(payload: {
  webm: ArrayBuffer
  posterDataUrl: string | null
  width: number
  height: number
  durationMs: number
  ext?: 'mp4' | 'webm' // actual container the renderer produced (default webm)
}): void {
  const p = pending
  pending = null
  closeRecordControlWindow()
  restoreLibrary()
  if (!p) return
  try {
    const webm = Buffer.from(payload.webm)
    // Sanity caps on renderer-supplied data before writing it to disk.
    if (webm.length === 0 || webm.length > MAX_WEBM_BYTES) {
      if (webm.length > MAX_WEBM_BYTES) toast('Recording too large to save.')
      return
    }
    const posterOk =
      typeof payload.posterDataUrl === 'string' &&
      /^data:image\/[a-z0-9.+-]+;base64,/i.test(payload.posterDataUrl) &&
      payload.posterDataUrl.length <= MAX_POSTER_CHARS
    const poster = posterOk
      ? Buffer.from(payload.posterDataUrl!.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''), 'base64')
      : null
    const store = getStore()
    const shot = saveRecordedVideo(
      webm,
      poster,
      { width: payload.width, height: payload.height, durationMs: payload.durationMs },
      { mode: 'record', project: p.project },
      store.getSettings(),
      payload.ext === 'mp4' ? '.mp4' : '.webm'
    )
    if (!shot) return
    store.addScreenshot(shot)
    store.flush() // file already on disk: persist now so a crash can't orphan it
    getSearch().update(shot, store.getProjects(), store.getTags())
    broadcastSnapshot()
    console.log(`[recorder] saved -> ${shot.filePath}`)
    toast('Recording saved')
  } catch (err) {
    console.error('[recorder] save failed:', err)
  }
}

export function cancelRecording(): void {
  pending = null
  closeRecordControlWindow()
  restoreLibrary()
}
