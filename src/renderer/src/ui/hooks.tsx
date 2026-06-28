import React, { useEffect, useState } from 'react'
import type { LibrarySnapshot } from '@shared/types'
import { api } from './api'

export function useSnapshot(): LibrarySnapshot | null {
  const [snap, setSnap] = useState<LibrarySnapshot | null>(null)
  useEffect(() => {
    let alive = true
    api.getSnapshot().then((s) => alive && setSnap(s))
    const off = api.onSnapshot((s) => setSnap(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return snap
}

// Renderer-local actionable toasts (e.g. "Moved to trash. Undo"). Window-scoped:
// a delete and its undo button live in the same window, so a module-level emitter
// is enough. Distinct from api.onToast, which carries plain strings from main.
interface ActionToast {
  message: string
  actionLabel: string
  onAction: () => void
}
const actionListeners = new Set<(t: ActionToast) => void>()
export function showActionToast(message: string, actionLabel: string, onAction: () => void): void {
  actionListeners.forEach((l) => l({ message, actionLabel, onAction }))
}

interface ToastItem {
  id: string
  msg: string
  actionLabel?: string
  onAction?: () => void
}

export function ToastHost(): React.ReactElement {
  const [items, setItems] = useState<ToastItem[]>([])
  const add = (item: Omit<ToastItem, 'id'>, ttl: number): void => {
    const id = Math.random().toString(36).slice(2)
    setItems((s) => [...s, { ...item, id }])
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), ttl)
  }
  useEffect(() => {
    const offToast = api.onToast((msg) => add({ msg }, 2800))
    const onAction = (t: ActionToast): void => add({ msg: t.message, actionLabel: t.actionLabel, onAction: t.onAction }, 6000)
    actionListeners.add(onAction)
    return () => {
      offToast()
      actionListeners.delete(onAction)
    }
  }, [])
  const dismiss = (id: string): void => setItems((s) => s.filter((t) => t.id !== id))
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          {t.msg}
          {t.actionLabel && (
            <button
              className="toast-action"
              onClick={() => {
                t.onAction?.()
                dismiss(t.id)
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function Modal({
  children,
  onClose,
  className
}: {
  children: React.ReactNode
  onClose: () => void
  className?: string
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal${className ? ' ' + className : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
