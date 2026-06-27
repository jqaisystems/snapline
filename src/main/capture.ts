import { desktopCapturer, screen, nativeImage } from 'electron'
import type { Display, NativeImage } from 'electron'
import type { OverlayData, OverlayResult, Rect } from '../shared/types'
import { createOverlayWindow, closeOverlayWindow } from './windows'

let pendingOverlay: { data: OverlayData; resolve: (r: OverlayResult) => void } | null = null

export function getOverlayData(): OverlayData | null {
  return pendingOverlay?.data ?? null
}

export function resolveOverlay(result: OverlayResult): void {
  const p = pendingOverlay
  pendingOverlay = null
  closeOverlayWindow()
  p?.resolve(result)
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

// Let the user select a region; returns the rect (CSS px within the display) + the display.
export async function selectRegion(): Promise<{ display: Display; rect: Rect } | null> {
  const display = displayUnderCursor()
  const img = await captureDisplayImage(display)
  if (img.isEmpty()) return null
  const data: OverlayData = {
    kind: 'region',
    dataUrl: img.toDataURL(),
    bounds: display.bounds,
    scaleFactor: display.scaleFactor || 1
  }
  const result = await openOverlay(data, display.bounds)
  if (result.kind !== 'region' || !result.rect) return null
  return { display, rect: result.rect }
}

function openOverlay(data: OverlayData, bounds: Rect): Promise<OverlayResult> {
  return new Promise((resolve) => {
    pendingOverlay = { data, resolve }
    createOverlayWindow(bounds)
    setTimeout(() => {
      if (pendingOverlay) {
        const p = pendingOverlay
        pendingOverlay = null
        closeOverlayWindow()
        p.resolve(data.kind === 'region' ? { kind: 'region', rect: null } : { kind: 'window', sourceId: null })
      }
    }, 90000)
  })
}

export async function captureFullscreen(): Promise<Buffer | null> {
  const img = await captureDisplayImage(displayUnderCursor())
  return img.isEmpty() ? null : img.toPNG()
}

export async function captureRegion(): Promise<Buffer | null> {
  const display = displayUnderCursor()
  const img = await captureDisplayImage(display)
  if (img.isEmpty()) return null
  const data: OverlayData = {
    kind: 'region',
    dataUrl: img.toDataURL(),
    bounds: display.bounds,
    scaleFactor: display.scaleFactor || 1
  }
  const result = await openOverlay(data, display.bounds)
  if (result.kind !== 'region' || !result.rect) return null
  const scale = display.scaleFactor || 1
  const crop = {
    x: Math.max(0, Math.round(result.rect.x * scale)),
    y: Math.max(0, Math.round(result.rect.y * scale)),
    width: Math.round(result.rect.width * scale),
    height: Math.round(result.rect.height * scale)
  }
  if (crop.width < 3 || crop.height < 3) return null
  const cropped = img.crop(crop)
  return cropped.isEmpty() ? null : cropped.toPNG()
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
  const result = await openOverlay({ kind: 'window', windows }, display.bounds)
  if (result.kind !== 'window' || !result.sourceId) return null
  const chosen = sources.find((s) => s.id === result.sourceId)
  if (!chosen || chosen.thumbnail.isEmpty()) return null
  return chosen.thumbnail.toPNG()
}
