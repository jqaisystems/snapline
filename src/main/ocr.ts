// Local, offline OCR via tesseract.js. Fully optional: any failure degrades to null
// so the rest of the app (capture, organize, search-by-name) keeps working.
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

// Directory holding the bundled, uncompressed eng.traineddata, or null if it is not
// found (then we fall back to tesseract.js's CDN download). Packaged: resources/tessdata
// (see electron-builder.yml extraResources). Dev: the project root, where the file lives.
function localTessdataDir(): string | null {
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : app.getAppPath()
  return fs.existsSync(path.join(dir, 'eng.traineddata')) ? dir : null
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      const langPath = localTessdataDir()
      if (langPath) {
        // Offline: read the bundled model from disk. gzip:false because the bundled file
        // is uncompressed; cacheMethod:'none' so nothing is written to the working dir.
        return createWorker('eng', 1, {
          langPath,
          cachePath: app.getPath('userData'),
          cacheMethod: 'none',
          gzip: false
        })
      }
      // No bundled model found: fall back to the default (downloads + caches from CDN).
      console.warn('[ocr] bundled eng.traineddata not found; falling back to CDN download')
      return createWorker('eng')
    })()
  }
  return workerPromise
}

export async function runOcr(filePath: string): Promise<string | null> {
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(filePath)
    const text = (data.text || '').replace(/\s+\n/g, '\n').trim()
    return text.length > 0 ? text : null
  } catch (err) {
    console.error('[ocr] recognition failed (skipping):', err)
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
