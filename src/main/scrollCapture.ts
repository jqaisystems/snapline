import { nativeImage } from 'electron'
import type { Display } from 'electron'
import type { Rect } from '../shared/types'
import { grabDisplay, selectRegion } from './capture'
import { getStore } from './store'
import { getSearch } from './search'
import { saveCaptureBuffer } from './storageFs'
import { broadcastSnapshot, toast } from './broadcast'
import { queueEnrichment } from './pipeline'
import { createScrollControlWindow, closeScrollControlWindow, createEditorWindow, broadcastToAll, getLibraryWindow } from './windows'

// User-driven scrolling capture: the user scrolls the selected area while we grab frames and
// stitch them by detecting vertical overlap (1D row-luminance signatures + SAD alignment).
const MAX_HEIGHT = 24000
const TICK_MS = 280
const MATCH_THRESHOLD = 16 // average per-row luminance diff (0..255); above this = no good match

let active = false
let capturing = false
let timer: NodeJS.Timeout | null = null
let region: { display: Display; rect: Rect } | null = null

let rw = 0
let rh = 0
let cropX = 0
let cropY = 0
let frameCount = 0

let acc: Buffer | null = null
let accRows = 0
let capRows = 0
let lastSig: Float64Array | null = null
let libWasVisible = false
let starting = false // guards the async region-picker window against a double-trigger

function restoreLibrary(): void {
  if (libWasVisible) getLibraryWindow()?.show()
  libWasVisible = false
}

export function isScrollActive(): boolean {
  return active
}

function stopTimer(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function reset(): void {
  active = false
  capturing = false
  stopTimer()
  region = null
  acc = null
  lastSig = null
  accRows = 0
  capRows = 0
  frameCount = 0
}

export async function startScrollCapture(): Promise<void> {
  if (active || starting) return
  starting = true
  // Get Snapline's own window out of the way so you can see and scroll the target.
  const lib = getLibraryWindow()
  libWasVisible = !!(lib && lib.isVisible())
  if (libWasVisible) lib!.hide()

  const sel = await selectRegion()
  if (!sel) {
    starting = false
    restoreLibrary()
    return
  }
  region = sel
  const scale = sel.display.scaleFactor || 1
  rw = Math.max(2, Math.round(sel.rect.width * scale))
  rh = Math.max(2, Math.round(sel.rect.height * scale))
  cropX = Math.round(sel.rect.x * scale)
  cropY = Math.round(sel.rect.y * scale)
  acc = null
  lastSig = null
  accRows = 0
  capRows = 0
  frameCount = 0
  active = true
  starting = false
  createScrollControlWindow(sel.display, sel.rect)
  pushStatus()
  timer = setInterval(() => void tick(), TICK_MS)
}

function pushStatus(): void {
  broadcastToAll('scrollStatus', { frames: frameCount, height: accRows })
}

async function tick(): Promise<void> {
  if (!active || capturing || !region) return
  capturing = true
  try {
    const img = await grabDisplay(region.display)
    if (!img.isEmpty()) {
      const cropped = img.crop({ x: cropX, y: cropY, width: rw, height: rh })
      if (!cropped.isEmpty()) {
        stitch(cropped.toBitmap()) // BGRA, length rw*rh*4
        frameCount++
        pushStatus()
      }
    }
  } catch (err) {
    console.error('[scroll] tick failed:', err)
  } finally {
    capturing = false
  }
}

function rowSignature(buf: Buffer): Float64Array {
  const sig = new Float64Array(rh)
  const stepX = Math.max(1, Math.floor(rw / 64))
  for (let y = 0; y < rh; y++) {
    const base = y * rw * 4
    let sum = 0
    let count = 0
    for (let x = 0; x < rw; x += stepX) {
      const i = base + x * 4
      sum += buf[i] + buf[i + 1] + buf[i + 2]
      count++
    }
    sig[y] = sum / (count * 3)
  }
  return sig
}

function ensureCapacity(rowsNeeded: number): boolean {
  if (rowsNeeded <= capRows) return true
  if (rowsNeeded > MAX_HEIGHT) return false
  let cap = Math.max(capRows, rh)
  while (cap < rowsNeeded) cap = Math.min(MAX_HEIGHT, cap * 2)
  const next = Buffer.alloc(rw * cap * 4)
  if (acc) acc.copy(next, 0, 0, accRows * rw * 4)
  acc = next
  capRows = cap
  return true
}

function stitch(bmp: Buffer): void {
  const sig = rowSignature(bmp)
  if (!acc || accRows === 0) {
    ensureCapacity(rh)
    bmp.copy(acc!, 0, 0, rw * rh * 4)
    accRows = rh
    lastSig = sig
    return
  }
  // Find vertical scroll delta d: new frame ≈ last frame shifted up by d.
  const minD = 3
  const maxD = Math.floor(rh * 0.92)
  let bestD = -1
  let bestCost = Infinity
  for (let d = minD; d <= maxD; d++) {
    const n = rh - d
    let cost = 0
    let cnt = 0
    for (let y = 0; y < n; y += 2) {
      cost += Math.abs(sig[y] - lastSig![y + d])
      cnt++
    }
    cost /= cnt || 1
    if (cost < bestCost) {
      bestCost = cost
      bestD = d
    }
  }
  lastSig = sig
  if (bestD < minD || bestCost > MATCH_THRESHOLD) return // no confident match (skip frame)
  const d = bestD
  if (!ensureCapacity(accRows + d)) {
    stopTimer()
    return
  }
  // append the bottom d rows of the new frame (newly revealed content)
  const srcStart = (rh - d) * rw * 4
  bmp.copy(acc!, accRows * rw * 4, srcStart, srcStart + d * rw * 4)
  accRows += d
}

export async function finishScrollCapture(): Promise<void> {
  if (!active) return
  stopTimer()
  closeScrollControlWindow()
  restoreLibrary()
  const r = region
  const buf = acc
  const rows = accRows
  const width = rw
  reset()
  if (!r || !buf || rows < 2) {
    toast('Scrolling capture cancelled (nothing captured)')
    return
  }
  try {
    const finalBuf = buf.subarray(0, width * rows * 4)
    const img = nativeImage.createFromBitmap(finalBuf, { width, height: rows, scaleFactor: 1 })
    const png = img.toPNG()
    const store = getStore()
    const settings = store.getSettings()
    const project = store.getProject(settings.activeProjectId) ?? null
    const shot = saveCaptureBuffer(png, { mode: 'scroll', project }, settings)
    if (shot) {
      store.addScreenshot(shot)
      getSearch().update(shot, store.getProjects(), store.getTags())
      broadcastSnapshot()
      queueEnrichment(shot.id)
      toast(`Scrolling capture saved (${width}×${rows})`)
      if (settings.afterCapture === 'editor') createEditorWindow(shot.id)
    }
  } catch (err) {
    console.error('[scroll] finish failed:', err)
    toast('Scrolling capture failed to save')
  }
}

export function cancelScrollCapture(): void {
  if (!active) return
  closeScrollControlWindow()
  restoreLibrary()
  reset()
  toast('Scrolling capture cancelled')
}
