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

let pending: { project: Project | null; config: RecordConfig } | null = null
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
  if (pending) return { ok: false } // a recording is already in progress
  const store = getStore()
  const settings = store.getSettings()
  if (!settings.storageRoot) {
    toast('Choose a storage folder in Snapline before recording.')
    return { ok: false }
  }
  const sourceId = mode === 'window' ? await pickWindowSourceId() : await getDisplaySourceIdUnderCursor()
  if (!sourceId) return { ok: false } // cancelled or no source available
  const project = store.getProject(settings.activeProjectId) ?? null
  pending = {
    project,
    config: { sourceId, mic: true, micDeviceId: settings.recordingMicId || undefined, mode: 'record' }
  }
  // Preflight the OS mic permission while the library is still visible, so a blocked mic gets an
  // actionable message instead of a silently audio-less video. The recording still proceeds.
  if (pending.config.mic && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    toast('Microphone is blocked in Windows. Enable it in Settings > Privacy > Microphone > "Let desktop apps access your microphone".')
  }
  hideLibrary()
  createRecordControlWindow()
  return { ok: true }
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
}): void {
  const p = pending
  pending = null
  closeRecordControlWindow()
  restoreLibrary()
  if (!p) return
  try {
    const webm = Buffer.from(payload.webm)
    if (webm.length === 0) return
    const poster = payload.posterDataUrl
      ? Buffer.from(payload.posterDataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      : null
    const store = getStore()
    const shot = saveRecordedVideo(
      webm,
      poster,
      { width: payload.width, height: payload.height, durationMs: payload.durationMs },
      { mode: 'record', project: p.project },
      store.getSettings()
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
