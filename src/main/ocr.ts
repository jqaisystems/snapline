// Local, offline OCR via tesseract.js. Fully optional: any failure degrades to null
// so the rest of the app (capture, organize, search-by-name) keeps working.
import type { Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
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
