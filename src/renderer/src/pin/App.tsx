import React, { useEffect, useRef, useState } from 'react'
import type { Screenshot } from '@shared/types'
import { api, windowParam } from '@ui/api'
import { Icon } from '@ui/icons'
import './pin.css'

export default function App(): React.ReactElement | null {
  const id = windowParam('id')
  const [shot, setShot] = useState<Screenshot | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const view = useRef({ zoom, pan })
  view.current = { zoom, pan }

  useEffect(() => {
    api.getSnapshot().then((s) => {
      setShot(s.screenshots.find((x) => x.id === id) ?? null)
    })
  }, [id])

  // wheel = zoom to cursor
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!imgRef.current) return
      e.preventDefault()
      const rect = imgRef.current.getBoundingClientRect()
      const { zoom: z, pan: p } = view.current
      const ux = (e.clientX - rect.left) / z
      const uy = (e.clientY - rect.top) / z
      const nz = Math.min(12, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      if (nz === 1) { setZoom(1); setPan({ x: 0, y: 0 }); return }
      setPan({ x: p.x + ux * (z - nz), y: p.y + uy * (z - nz) })
      setZoom(nz)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [shot])

  // pan by dragging once zoomed in
  function onDown(e: React.MouseEvent): void {
    if (view.current.zoom <= 1 || e.button !== 0) return
    e.preventDefault()
    drag.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY }
    const onMove = (ev: MouseEvent): void => {
      if (!drag.current) return
      setPan({ x: drag.current.x + (ev.clientX - drag.current.px), y: drag.current.y + (ev.clientY - drag.current.py) })
    }
    const onUp = (): void => {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function resetZoom(): void {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  if (!shot) return null
  const zoomed = zoom > 1
  return (
    <div className="pin-root">
      <div
        className={`pin-view ${zoomed ? 'zoomed' : ''}`}
        ref={viewRef}
        onMouseDown={onDown}
        onDoubleClick={resetZoom}
        style={{ WebkitAppRegion: zoomed ? 'no-drag' : 'drag' } as React.CSSProperties}
      >
        {shot.isVideo ? (
          <video
            className="pin-img"
            controls
            src={api.fileUrl(shot.filePath)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          />
        ) : (
          <img
            className="pin-img"
            ref={imgRef}
            src={api.fileUrl(shot.filePath)}
            alt=""
            draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
          />
        )}
      </div>
      <div className="pin-bar">
        <span className="pin-name">{shot.aiName ?? shot.fileName}</span>
        <div className="pin-actions">
          {zoomed && (
            <button className="pin-btn" title="Reset zoom (double-click image)" onClick={resetZoom}>
              <span className="pin-zoom">{Math.round(zoom * 100)}%</span>
            </button>
          )}
          <button className="pin-btn" title="Copy" onClick={() => api.copyScreenshotToClipboard(shot.id)}>
            <Icon name="copy" size={15} />
          </button>
          <button className="pin-btn" title="Edit" onClick={() => api.openEditor(shot.id)}>
            <Icon name="edit" size={15} />
          </button>
          <button className="pin-btn" title="Close" onClick={() => api.closePin()}>
            <Icon name="x" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
