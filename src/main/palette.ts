import { nativeImage } from 'electron'
import fs from 'fs'
import { getStore } from './store'
import type { ProjectPalette } from '../shared/types'

// Cap how many screenshots we sample per project so a large project stays fast.
// Screenshots are newest-first, so this favours the project's most recent work.
const SAMPLE_CAP = 60
// Each image is downsized to this many pixels per side before sampling.
const SAMPLE_SIZE = 48
// Number of swatches returned in the report.
const SWATCH_COUNT = 12

type Bucket = { n: number; r: number; g: number; b: number }

const cache = new Map<string, { sig: string; result: ProjectPalette }>()

const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')

// Read one image, downsample, and fold its colors into the shared bucket map.
// nativeImage.toBitmap() returns a BGRA buffer on Windows (same as scrollCapture.ts).
function accumulate(filePath: string, buckets: Map<string, Bucket>): void {
  try {
    let img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return
    img = img.resize({ width: SAMPLE_SIZE, height: SAMPLE_SIZE, quality: 'good' })
    const buf = img.toBitmap()
    for (let i = 0; i + 3 < buf.length; i += 4) {
      const b = buf[i]
      const g = buf[i + 1]
      const r = buf[i + 2]
      const a = buf[i + 3]
      if (a < 200) continue // skip transparent pixels
      const key = `${r >> 5}_${g >> 5}_${b >> 5}` // 32-level buckets merge near-identical colors
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      e.n++
      e.r += r
      e.g += g
      e.b += b
      buckets.set(key, e)
    }
  } catch {
    /* unreadable file: skip */
  }
}

// Aggregate the dominant colors across all (capped) screenshots in a project.
// Cached per project; invalidated when the project's screenshot set changes.
export function getProjectPalette(projectId: string): ProjectPalette {
  const store = getStore()
  const shots = store.getScreenshots().filter((s) => s.projectId === projectId)
  const total = shots.length
  const sample = shots.slice(0, SAMPLE_CAP)
  const sig = `${total}:${sample.reduce((m, s) => Math.max(m, s.createdAt), 0)}:${sample.reduce((m, s) => m + s.bytes, 0)}`

  const cached = cache.get(projectId)
  if (cached && cached.sig === sig) return cached.result

  const buckets = new Map<string, Bucket>()
  for (const s of sample) {
    const src = s.thumbPath && fs.existsSync(s.thumbPath) ? s.thumbPath : s.filePath
    accumulate(src, buckets)
  }

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n)
  const totalN = sorted.reduce((m, e) => m + e.n, 0) || 1
  const colors = sorted.slice(0, SWATCH_COUNT).map((e) => ({
    hex: toHex(Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)),
    weight: e.n / totalN
  }))

  const result: ProjectPalette = { colors, sampled: sample.length, total }
  cache.set(projectId, { sig, result })
  return result
}
