import FlexSearch from 'flexsearch'
import type { Project, Screenshot, Tag } from '../shared/types'

// Pure-JS full-text index over each screenshot's searchable text:
// AI name + OCR text + AI description + tag names + project name + window title + filename.
class SearchIndex {
  private index: FlexSearch.Document<{ id: string; text: string }, false>

  constructor() {
    this.index = new FlexSearch.Document({
      tokenize: 'forward',
      cache: 100,
      document: { id: 'id', index: ['text'] }
    })
  }

  private buildText(s: Screenshot, projects: Project[], tags: Tag[]): string {
    const project = projects.find((p) => p.id === s.projectId)
    const tagNames = s.tagIds
      .map((id) => tags.find((t) => t.id === id)?.name)
      .filter(Boolean)
      .join(' ')
    return [
      s.aiName ?? '',
      s.fileName,
      s.ocrText ?? '',
      s.aiDescription ?? '',
      tagNames,
      project?.name ?? '',
      s.sourceWindowTitle ?? '',
      s.sourceApp ?? '',
      s.sourceUrl ?? ''
    ]
      .join(' \n ')
      .slice(0, 8000)
  }

  rebuild(screenshots: Screenshot[], projects: Project[], tags: Tag[]): void {
    this.index = new FlexSearch.Document({
      tokenize: 'forward',
      cache: 100,
      document: { id: 'id', index: ['text'] }
    })
    for (const s of screenshots) {
      this.index.add({ id: s.id, text: this.buildText(s, projects, tags) })
    }
  }

  update(s: Screenshot, projects: Project[], tags: Tag[]): void {
    this.index.update({ id: s.id, text: this.buildText(s, projects, tags) })
  }

  remove(id: string): void {
    try {
      this.index.remove(id)
    } catch { /* ignore */ }
  }

  search(query: string, limit = 500): string[] {
    if (!query.trim()) return []
    // No `suggest` mode: a multi-word query must match all words (prefix matching is
    // still on via forward tokenization), so gibberish returns nothing instead of a guess.
    const results = this.index.search(query, { limit })
    const ids: string[] = []
    const seen = new Set<string>()
    for (const group of results) {
      for (const id of group.result as string[]) {
        if (!seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }
    }
    return ids
  }
}

let _search: SearchIndex | null = null
export function getSearch(): SearchIndex {
  if (!_search) _search = new SearchIndex()
  return _search
}
