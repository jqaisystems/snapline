// Local, offline OCR via tesseract.js. Fully optional: any failure degrades to null
// so the rest of the app (capture, organize, search-by-name) keeps working.
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Worker, WorkerOptions } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

// Resolve a promise or reject after `ms`, so a wedged worker can't hang the pipeline.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`[ocr] ${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(id); resolve(v) },
      (e) => { clearTimeout(id); reject(e) }
    )
  })
}

// Path to the bundled, uncompressed eng.traineddata, or null if missing. Packaged:
// resources/tessdata (electron-builder.yml extraResources). Dev: the project root.
function bundledTessdata(): string | null {
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : app.getAppPath()
  const file = path.join(dir, 'eng.traineddata')
  return fs.existsSync(file) ? file : null
}

// Copy the bundled model into tesseract's cache dir and return that dir, or null if the
// model is unavailable. This is the crux of offline OCR inside Electron: tesseract.js
// detects Electron as a non-Node environment (is-electron), so when given a `langPath`
// it tries to fetch() the local file as a URL ("Only absolute URLs are supported") and
// throws inside its message callback, crashing the app. Seeding the cache makes the
// worker read the model from disk via fs.readFile instead, which is environment-neutral.
function seedTessdataCache(): string | null {
  const src = bundledTessdata()
  if (!src) return null
  const cacheDir = app.getPath('userData')
  const dest = path.join(cacheDir, 'eng.traineddata')
  try {
    const stale = !fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size
    if (stale) fs.copyFileSync(src, dest)
    return cacheDir
  } catch (err) {
    console.warn('[ocr] could not seed tessdata cache:', err)
    return null
  }
}

async function createOcrWorker(): Promise<Worker> {
  const { createWorker } = await import('tesseract.js')
  const cachePath = seedTessdataCache()
  // errorHandler is essential: without it tesseract.js does `throw Error(data)` inside
  // its worker-message callback on any load/recognize rejection, which surfaces as an
  // uncaught exception and crashes the whole app. With it, failures stay contained.
  const opts: Partial<WorkerOptions> = {
    logger: () => {},
    errorHandler: (e) => console.error('[ocr] worker error (contained):', e)
  }
  if (cachePath) {
    // Read eng.traineddata from this dir (we seeded it above). No langPath, so a cache
    // miss falls back to tesseract's CDN (a real URL) rather than an unfetchable path.
    opts.cachePath = cachePath
  } else {
    console.warn('[ocr] bundled eng.traineddata not found; will use CDN download if online')
  }
  return createWorker('eng', 1, opts)
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // createWorker never rejects on a loadLanguage failure (its internal chain swallows
    // it), so guard with a timeout. On any failure, clear the promise so the next
    // capture can retry instead of awaiting a dead worker forever.
    workerPromise = withTimeout(createOcrWorker(), 30000, 'worker init').catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

export async function runOcr(filePath: string): Promise<string | null> {
  try {
    const worker = await getWorker()
    const { data } = await withTimeout(worker.recognize(filePath), 60000, 'recognize')
    const text = (data.text || '').replace(/\s+\n/g, '\n').trim()
    return text.length > 0 ? text : null
  } catch (err) {
    console.error('[ocr] recognition failed (skipping):', err)
    // The worker may be wedged (timeout) or in a bad state. tesseract runs jobs serially
    // on one worker, so a stuck job would stall every later OCR. Recycle it: the next
    // runOcr builds a fresh worker instead of queueing behind the dead one.
    await shutdownOcr()
    return null
  }
}

export async function shutdownOcr(): Promise<void> {
  if (workerPromise) {
    try {
      const w = await workerPromise
      await w.terminate()
    } catch { /* ignore */ }
    workerPromise = null
  }
}
