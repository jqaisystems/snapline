import { getStore } from './store'
import { getSearch } from './search'
import { broadcastToAll } from './windows'

// Push the full library snapshot to every open window so all UIs stay in sync.
export function broadcastSnapshot(): void {
  const store = getStore()
  broadcastToAll('snapshot', store.snapshot())
}

// Rebuild the search index from current data (call after bulk changes).
export function reindexAll(): void {
  const store = getStore()
  getSearch().rebuild(store.getScreenshots(), store.getProjects(), store.getTags())
}

export function toast(message: string): void {
  broadcastToAll('toast', message)
}
