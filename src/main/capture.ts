import { desktopCapturer, screen, nativeImage } from 'electron'
import type { Display, NativeImage, WebContents } from 'electron'
import type { OverlayData, OverlayResult, Rect } from '../shared/types'
import { createOverlayWindow, closeOverlayWindow } from './windows'
import { getStore } from './store'

// Encode a captured image using the user's chosen screenshot format (PNG default; JPEG for
// smaller files). The matching file extension is chosen from the same setting in saveCaptureBuffer.
function encodeCapture(img: NativeImage): Buffer {
  const s = getStore().getSettings()
  if (s.screenshotFormat === 'jpeg') {
    const q = Math.min(100, Math.max(1, Math.round(s.jpegQuality || 90)))
    return img.toJPEG(q)
  }
  return img.toPNG()
}

// One entry per open overlay window. Region capture opens one window per monitor; window
// capture opens a single window on the cursor's display. Each window is matched to its
// entry by the submitting window's webContents id.
interface OverlayEntry {
  wcId: number
  data: OverlayData
  display: Display
  img: NativeImage | null // the captured display image (region only); used for cropping
}
type Resolved =
  | { kind: 'region'; display: Display; img: NativeImage; rect: Rect }
  | { kind: 'window'; sourceId: string }
  | null

let pending: { entries: OverlayEntry[]; resolve: (r: Resolved) => void; done: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null

// Tear down the pending overlay session exactly once and hand the result back.
function settle(resolved: Resolved): void {
  if (!pending || pending.done) return
  pending.done = true
  if (pending.timer) clearTimeout(pending.timer)
  const resolve = pending.resolve
  pending = null
  closeOverlayWindow()
  resolve(resolved)
}

// Each overlay window asks for its own data, identified by its webContents.
export function getOverlayData(sender: WebContents): OverlayData | null {
  if (!pending) return null
  return pending.entries.find((e) => e.wcId === sender.id)?.data ?? null
}

// A submit from any overlay window ends the whole session. A region rect crops that
// window's display; a null/empty submit (Esc, or a click with no drag) cancels.
export function resolveOverlay(sender: WebContents, result: OverlayResult): void {
  if (!pending || pending.done) return
  const entry = pending.entries.find((e) => e.wcId === sender.id)
  let resolved: Resolved = null
  if (result.kind === 'region' && result.rect && entry?.img) {
    resolved = { kind: 'region', display: entry.display, img: entry.img, rect: result.rect }
  } else if (result.kind === 'window' && result.sourceId) {
    resolved = { kind: 'window', sourceId: result.sourceId }
  }
  settle(resolved)
}

async function captureDisplayImage(display: Display): Promise<NativeImage> {
  const scale = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale)
    }
  })
  const src =
    sources.find((s) => s.display_id === String(display.id)) ??
    sources.find((s) => s.id.includes(String(display.id))) ??
    sources[0]
  return src ? src.thumbnail : nativeImage.createEmpty()
}

function displayUnderCursor(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

// Largest native (physical-pixel) resolution across all displays. Used as the
// thumbnail bound for window capture so a window is never downscaled (the old
// fixed 3000x2000 box blurred any window on a 4K display).
function maxNativeSize(): { width: number; height: number } {
  let w = 1920
  let h = 1080
  for (const d of screen.getAllDisplays()) {
    const s = d.scaleFactor || 1
    w = Math.max(w, Math.round(d.size.width * s))
    h = Math.max(h, Math.round(d.size.height * s))
  }
  return { width: w, height: h }
}

// Grab a full-resolution image of a display (used by scrolling capture for each frame).
export async function grabDisplay(display: Display): Promise<NativeImage> {
  return captureDisplayImage(display)
}

// The desktopCapturer screen source id for the display under the cursor, for MediaRecorder
// (chromeMediaSourceId). Returns null if no screen source is available.
export async function getDisplaySourceIdUnderCursor(): Promise<string | null> {
  const display = displayUnderCursor()
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
  const src =
    sources.find((s) => s.display_id === String(display.id)) ??
    sources.find((s) => s.id.includes(String(display.id))) ??
    sources[0]
  return src ? src.id : null
}

// Show the window picker overlay and return the chosen window's source id (or null).
export async function pickWindowSourceId(): Promise<string | null> {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: maxNativeSize() })
  const windows = sources
    .filter((s) => s.name && !/snapline/i.test(s.name) && !s.thumbnail.isEmpty())
    .map((s) => ({ id: s.id, name: s.name, dataUrl: s.thumbnail.toDataURL() }))
  if (windows.length === 0) return null
  const display = displayUnderCursor()
  const result = await openWindowOverlay({ kind: 'window', windows }, display)
  if (!result || result.kind !== 'window') return null
  return result.sourceId
}

// Dim every monitor at once and let the user drag a selection on whichever one they are
// working on. One overlay window per display (each matched to its own DPI), so the region
// renderer and crop math stay per-display. Resolves with the chosen display + local rect.
async function openRegionOverlays(): Promise<Resolved> {
  if (pending) return null // an overlay session is already open; ignore re-triggers
  const displays = screen.getAllDisplays()
  const captured = await Promise.all(
    displays.map(async (display) => ({ display, img: await captureDisplayImage(display) }))
  )
  const usable = captured.filter((c) => !c.img.isEmpty())
  if (usable.length === 0) return null
  return new Promise<Resolved>((resolve) => {
    const entries: OverlayEntry[] = []
    pending = { entries, resolve, done: false, timer: null }
    for (const { display, img } of usable) {
      const data: OverlayData = {
        kind: 'region',
        dataUrl: img.toDataURL(),
        bounds: display.bounds,
        scaleFactor: display.scaleFactor || 1
      }
      const win = createOverlayWindow(display.bounds)
      entries.push({ wcId: win.webContents.id, data, display, img })
    }
    pending.timer = setTimeout(() => settle(null), 90000)
  })
}

// Single overlay (on the cursor's display) for the window picker.
function openWindowOverlay(data: OverlayData, display: Display): Promise<Resolved> {
  if (pending) return Promise.resolve(null) // an overlay session is already open
  return new Promise<Resolved>((resolve) => {
    const win = createOverlayWindow(display.bounds)
    pending = {
      entries: [{ wcId: win.webContents.id, data, display, img: null }],
      resolve,
      done: false,
      timer: null
    }
    pending.timer = setTimeout(() => settle(null), 90000)
  })
}

// Let the user select a region on any monitor; returns the rect (CSS px within the chosen
// display) + that display. Used by scrolling capture.
export async function selectRegion(): Promise<{ display: Display; rect: Rect } | null> {
  const r = await openRegionOverlays()
  if (!r || r.kind !== 'region') return null
  return { display: r.display, rect: r.rect }
}

export async function captureFullscreen(): Promise<Buffer | null> {
  const img = await captureDisplayImage(displayUnderCursor())
  return img.isEmpty() ? null : encodeCapture(img)
}

export async function captureRegion(): Promise<Buffer | null> {
  const r = await openRegionOverlays()
  if (!r || r.kind !== 'region') return null
  const scale = r.display.scaleFactor || 1
  const crop = {
    x: Math.max(0, Math.round(r.rect.x * scale)),
    y: Math.max(0, Math.round(r.rect.y * scale)),
    width: Math.round(r.rect.width * scale),
    height: Math.round(r.rect.height * scale)
  }
  if (crop.width < 3 || crop.height < 3) return null
  const cropped = r.img.crop(crop)
  return cropped.isEmpty() ? null : encodeCapture(cropped)
}

export async function captureWindow(): Promise<Buffer | null> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: maxNativeSize()
  })
  const windows = sources
    .filter((s) => s.name && !/snapline/i.test(s.name) && !s.thumbnail.isEmpty())
    .map((s) => ({ id: s.id, name: s.name, dataUrl: s.thumbnail.toDataURL() }))
  if (windows.length === 0) return null
  const display = displayUnderCursor()
  const result = await openWindowOverlay({ kind: 'window', windows }, display)
  if (!result || result.kind !== 'window') return null
  const chosen = sources.find((s) => s.id === result.sourceId)
  if (!chosen || chosen.thumbnail.isEmpty()) return null
  return encodeCapture(chosen.thumbnail)
}
