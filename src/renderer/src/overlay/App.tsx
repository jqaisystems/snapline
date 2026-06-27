import React, { useEffect, useRef, useState } from 'react'
import type { OverlayData } from '@shared/types'
import { api } from '@ui/api'

interface Pt {
  x: number
  y: number
}

export default function App(): React.ReactElement | null {
  const [data, setData] = useState<OverlayData | null>(null)

  useEffect(() => {
    api.getOverlayData().then(setData)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function cancel(): void {
    api.submitOverlay({ kind: 'region', rect: null })
  }

  if (!data) return null
  if (data.kind === 'window') return <WindowPicker data={data} />
  return <RegionPicker dataUrl={data.dataUrl} />
}

const LOUPE_D = 220 // loupe diameter (px)
const LOUPE_MAG = 8 // magnification of the raw capture pixels

function RegionPicker({ dataUrl }: { dataUrl: string }): React.ReactElement {
  const [start, setStart] = useState<Pt | null>(null)
  const [cur, setCur] = useState<Pt | null>(null)
  const [hover, setHover] = useState<Pt | null>(null)
  const dragging = useRef(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)

  const rect =
    start && cur
      ? {
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          width: Math.abs(cur.x - start.x),
          height: Math.abs(cur.y - start.y)
        }
      : null

  function down(e: React.MouseEvent): void {
    dragging.current = true
    setStart({ x: e.clientX, y: e.clientY })
    setCur({ x: e.clientX, y: e.clientY })
  }
  function move(e: React.MouseEvent): void {
    setHover({ x: e.clientX, y: e.clientY })
    if (dragging.current) setCur({ x: e.clientX, y: e.clientY })
  }
  function up(): void {
    dragging.current = false
    if (rect && rect.width > 4 && rect.height > 4) {
      api.submitOverlay({ kind: 'region', rect })
    } else {
      api.submitOverlay({ kind: 'region', rect: null })
    }
  }

  // map a client point to source-capture pixels (the image is stretched to fill the viewport)
  const toSrc = (p: Pt): Pt => {
    const im = imgRef.current
    const nw = im?.naturalWidth || window.innerWidth
    const nh = im?.naturalHeight || window.innerHeight
    return { x: (p.x / window.innerWidth) * nw, y: (p.y / window.innerHeight) * nh }
  }

  // draw the magnifier loupe under the cursor
  useEffect(() => {
    const im = imgRef.current
    const cv = loupeRef.current
    const ctx = cv?.getContext('2d')
    if (!hover || !im || !cv || !ctx || !im.complete) return
    const s = toSrc(hover)
    const srcR = LOUPE_D / LOUPE_MAG
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, LOUPE_D, LOUPE_D)
    try {
      ctx.drawImage(im, s.x - srcR / 2, s.y - srcR / 2, srcR, srcR, 0, 0, LOUPE_D, LOUPE_D)
    } catch { /* ignore */ }
    ctx.strokeStyle = 'rgba(139,141,255,0.95)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(LOUPE_D / 2, 0); ctx.lineTo(LOUPE_D / 2, LOUPE_D)
    ctx.moveTo(0, LOUPE_D / 2); ctx.lineTo(LOUPE_D, LOUPE_D / 2)
    ctx.stroke()
  }, [hover])

  // keep the loupe near the cursor but flip away from screen edges
  const lx = hover ? (hover.x + 20 + LOUPE_D > window.innerWidth ? hover.x - 20 - LOUPE_D : hover.x + 20) : 0
  const ly = hover ? (hover.y + 20 + LOUPE_D + 22 > window.innerHeight ? hover.y - 20 - LOUPE_D - 22 : hover.y + 20) : 0
  const src = hover ? toSrc(hover) : null

  return (
    <div className="region-root" onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={() => setHover(null)}>
      <img className="region-img" ref={imgRef} src={dataUrl} draggable={false} alt="" />
      {!rect && <div className="region-dim" />}
      {rect && (
        <div
          className="region-sel"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <div className="region-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </div>
      )}
      {hover && (
        <div className="region-loupe" style={{ left: lx, top: ly }}>
          <canvas ref={loupeRef} width={LOUPE_D} height={LOUPE_D} />
          {src && <div className="region-loupe-label">{Math.round(src.x)}, {Math.round(src.y)}</div>}
        </div>
      )}
      {!rect && <div className="region-hint">Drag to select an area · Esc to cancel</div>}
    </div>
  )
}

function WindowPicker({ data }: { data: Extract<OverlayData, { kind: 'window' }> }): React.ReactElement {
  return (
    <div className="win-root">
      <div className="win-title">Pick a window to capture</div>
      <div className="win-grid">
        {data.windows.map((w) => (
          <div
            key={w.id}
            className="win-card"
            onClick={() => api.submitOverlay({ kind: 'window', sourceId: w.id })}
          >
            <img src={w.dataUrl} alt={w.name} />
            <div className="name">{w.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
