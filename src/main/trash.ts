import path from 'path'
import type { Screenshot } from '../shared/types'
import { getStore } from './store'
import { getSearch } from './search'
import { moveFileToTrash, restoreFileFromTrash, deleteScreenshotFiles } from './storageFs'

// Recoverable trash. "Deleting" a screenshot moves its file into a hidden
// .snapline-trash folder and records a trash entry; it can be restored to its
// original project for `trashRetentionDays`, after which it auto-purges.
// None of these functions broadcast: callers do, so a single update is sent.

// Move a screenshot to the trash. Returns true if a recoverable entry was made,
// false if the file could not be moved (then it is hard-deleted as a fallback).
export function trashById(id: string): { ok: boolean; recoverable: boolean } {
  const store = getStore()
  const s = store.getScreenshot(id)
  if (!s) return { ok: false, recoverable: false }
  const trashPath = moveFileToTrash(s)
  store.removeScreenshot(id)
  getSearch().remove(id)
  if (trashPath) {
    store.addToTrash({ screenshot: { ...s, filePath: trashPath }, deletedAt: Date.now() })
    store.flush() // file already moved to trash on disk: persist now
    return { ok: true, recoverable: true }
  }
  // No storage root or move failed: behave like a hard delete so the row is gone cleanly.
  deleteScreenshotFiles(s)
  store.flush()
  return { ok: true, recoverable: false }
}

// Restore a trashed screenshot back into its original project (or Unfiled if that
// project no longer exists). Returns true on success.
export function restoreById(id: string): boolean {
  const store = getStore()
  const item = store.getTrashItem(id)
  if (!item) return false
  const s = item.screenshot
  // If the original project was deleted while this sat in the trash, restore to Unfiled.
  const projectId = store.getProject(s.projectId) ? s.projectId : null
  const project = store.getProject(projectId) ?? null
  const restoredPath = restoreFileFromTrash(s, project)
  store.removeFromTrash(id)
  if (!restoredPath) {
    store.flush() // entry removed; persist even though the file was already gone
    return false
  }
  const restored: Screenshot = { ...s, projectId, filePath: restoredPath, fileName: path.basename(restoredPath) }
  store.addScreenshot(restored)
  store.flush() // file already moved back to its project folder: persist now
  getSearch().update(restored, store.getProjects(), store.getTags())
  return true
}

// Permanently delete a single trashed item (file + thumbnail).
export function deletePermanentlyById(id: string): boolean {
  const store = getStore()
  const item = store.removeFromTrash(id)
  if (!item) return false
  deleteScreenshotFiles(item.screenshot)
  store.flush()
  return true
}

// Permanently delete everything in the trash. Returns how many were removed.
export function emptyTrash(): number {
  const store = getStore()
  const items = store.clearTrash()
  for (const it of items) deleteScreenshotFiles(it.screenshot)
  if (items.length) store.flush()
  return items.length
}

// Drop trash entries older than the retention window. retentionDays <= 0 keeps forever.
export function purgeExpiredTrash(): number {
  const store = getStore()
  const days = store.getSettings().trashRetentionDays
  if (!days || days <= 0) return 0
  const cutoff = Date.now() - days * 86_400_000
  const expired = store.getTrash().filter((t) => t.deletedAt < cutoff)
  for (const it of expired) {
    store.removeFromTrash(it.screenshot.id)
    deleteScreenshotFiles(it.screenshot)
  }
  if (expired.length) store.flush()
  return expired.length
}
