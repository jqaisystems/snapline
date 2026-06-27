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

export function ToastHost(): React.ReactElement {
  const [items, setItems] = useState<{ id: string; msg: string }[]>([])
  useEffect(() => {
    return api.onToast((msg) => {
      const id = Math.random().toString(36).slice(2)
      setItems((s) => [...s, { id, msg }])
      setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 2800)
    })
  }, [])
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          {t.msg}
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
