import { getStore } from './store'
import { getSearch } from './search'
import { runOcr } from './ocr'
import { aiReady, enrich } from './ai'
import { moveScreenshotFile } from './storageFs'
import { broadcastSnapshot, toast } from './broadcast'
import type { Screenshot } from '../shared/types'

const queue = new Set<string>()
let running = false

// Enqueue a screenshot for local OCR + (optional) Claude enrichment, processed one at a time.
export function queueEnrichment(id: string): void {
  queue.add(id)
  void drain()
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    for (const id of Array.from(queue)) {
      queue.delete(id)
      await enrichOne(id)
    }
  } finally {
    running = false
    if (queue.size > 0) void drain()
  }
}

export async function enrichOne(id: string): Promise<Screenshot | undefined> {
  const store = getStore()
  let s = store.getScreenshot(id)
  if (!s) return undefined
  if (s.isVideo) return s // OCR/AI enrichment doesn't apply to video recordings
  const settings = store.getSettings()
  const willUseAi = settings.aiEnabled && aiReady()

  store.updateScreenshot(id, { aiStatus: willUseAi ? 'pending' : 'none' })
  broadcastSnapshot()

  // 1) Local OCR (offline, free)
  if (settings.ocrEnabled && (!s.ocrText || s.ocrText.length === 0)) {
    const text = await runOcr(s.filePath)
    if (text) {
      store.updateScreenshot(id, { ocrText: text })
    }
  }

  // 2) Claude enrichment (opt-in)
  if (willUseAi) {
    s = store.getScreenshot(id)!
    const projects = store.getProjects()
    const res = await enrich(s, projects, {
      name: settings.aiAutoName,
      tags: settings.aiAutoTag,
      describe: settings.aiAutoDescribe,
      suggestProject: settings.aiSuggestProject
    })
    if (res) {
      const patch: Partial<Screenshot> = {}
      if (res.name) patch.aiName = res.name
      if (res.description) patch.aiDescription = res.description
      if (res.tags.length) {
        const tagIds = res.tags.map((t) => store.ensureTagByName(t).id)
        patch.tagIds = Array.from(new Set([...s.tagIds, ...tagIds]))
      }
      store.updateScreenshot(id, patch)

      // AI auto-filing: only when the shot is currently Unfiled (never override a chosen project).
      if (res.suggestedProjectId && !s.projectId) {
        const project = store.getProject(res.suggestedProjectId)
        if (project) {
          const moved = store.getScreenshot(id)!
          const newPath = moveScreenshotFile(moved, project)
          store.updateScreenshot(id, {
            projectId: project.id,
            filePath: newPath,
            fileName: newPath.split(/[\\/]/).pop() ?? moved.fileName
          })
          toast(`AI filed a screenshot into "${project.name}"`)
        }
      }
      store.updateScreenshot(id, { aiStatus: 'done' })
    } else {
      store.updateScreenshot(id, { aiStatus: 'error' })
    }
  }

  const final = store.getScreenshot(id)
  if (final) getSearch().update(final, store.getProjects(), store.getTags())
  broadcastSnapshot()
  return final
}
