import React, { Component, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Group, Rect, Image as KImage, Arrow, Line, Ellipse, Text, Circle, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { BeautifyBg, BeautifyPreset, FrameStyle, Screenshot } from '@shared/types'
import { api, applyTheme, windowParam } from '@ui/api'
import { Icon } from '@ui/icons'
import { t, setLocale } from '@ui/i18n'
import './editor.css'

type Tool = 'select' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text' | 'highlight' | 'number' | 'redact' | 'eraser' | 'pick' | 'measure'

interface Shape {
  id: string
  tool: Tool
  x?: number
  y?: number
  w?: number
  h?: number
  points?: number[]
  color?: string
  width?: number // stroke / body thickness
  arrowHead?: number
  text?: string
  fontSize?: number
  bold?: boolean
  opacity?: number // highlight
  numberSize?: number
  boxWidth?: number // text: fixed wrapping width (box mode); undefined = auto-width point text
  boxHeight?: number // text: locked fixed height; undefined = auto-grow
  n?: number
  rotation?: number
}

type Bg = BeautifyBg

const COLORS = ['#f25555', '#f59e0b', '#34d399', '#6f72f1', '#ec4899', '#22d3ee', '#0a0c11', '#f8fafc']
const GRADIENTS = [
  { from: '#6f72f1', to: '#a855f7' },
  { from: '#f59e0b', to: '#ef4444' },
  { from: '#10b981', to: '#3b82f6' },
  { from: '#fb7185', to: '#fdba74' },
  { from: '#1e293b', to: '#0a0c11' }
]
const ASPECTS: { label: string; r: number | null }[] = [
  { label: 'Auto', r: null },
  { label: '1:1', r: 1 },
  { label: '4:5', r: 4 / 5 },
  { label: '16:9', r: 16 / 9 },
  { label: '9:16', r: 9 / 16 }
]
const TRANSFORMABLE = new Set<Tool>(['rect', 'ellipse', 'redact', 'highlight', 'text', 'number'])
const LOUPE_MAG = 6 // magnifier zoom factor (raw screenshot pixels)
const LOUPE_D = 260 // loupe diameter in px
const uid = (): string => Math.random().toString(36).slice(2)
const finite = (n: number | undefined): boolean => typeof n === 'number' && Number.isFinite(n)
// Normalize a (possibly negative / in-progress) drag box to positive top-left + size.
const normBox = (sh: Shape): { x: number; y: number; w: number; h: number } => ({
  x: Math.min(sh.x ?? 0, (sh.x ?? 0) + (sh.w ?? 0)),
  y: Math.min(sh.y ?? 0, (sh.y ?? 0) + (sh.h ?? 0)),
  w: Math.abs(sh.w ?? 0),
  h: Math.abs(sh.h ?? 0)
})
// Corner radius can never exceed half the box (negative radius crashes the canvas).
const safeCorner = (base: number, w: number, h: number): number => Math.max(0, Math.min(base, w / 2, h / 2))
const rgbToHex = (r: number, g: number, b: number): string => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
// --- WCAG contrast helpers (pure math, no deps) ---
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}
const relLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// WCAG 2.x contrast ratio between two hex colors (1:1 .. 21:1).
const contrastRatio = (a: string, b: string): number => {
  const la = relLuminance(a)
  const lb = relLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
// Extract the dominant colors from an image (for "colors in this screenshot").
function extractPalette(img: HTMLImageElement): string[] {
  try {
    const c = document.createElement('canvas')
    const W = 48
    const H = 48
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')
    if (!ctx) return []
    ctx.drawImage(img, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const key = `${r >> 5}_${g >> 5}_${b >> 5}`
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      e.n++
      e.r += r
      e.g += g
      e.b += b
      buckets.set(key, e)
    }
    return [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map((e) => rgbToHex(Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)))
  } catch {
    return []
  }
}

// React error boundary so a render-time throw shows a recover panel instead of a blank window.
class CanvasBoundary extends Component<{ children: React.ReactNode; onRecover: () => void }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError(): { error: boolean } {
    return { error: true }
  }
  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="ed-recover">
          <Icon name="shield" size={28} />
          <div>{t('editor.canvasSnag')}</div>
          <button
            className="btn primary"
            onClick={() => {
              this.setState({ error: false })
              this.props.onRecover()
            }}
          >
            {t('editor.recover')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App(): React.ReactElement | null {
  const id = windowParam('id')
  const [shot, setShot] = useState<Screenshot | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [brandColors, setBrandColors] = useState<string[]>([])
  const [customColors, setCustomColors] = useState<string[]>([])

  const [tool, setTool] = useState<Tool>('select')
  // tool defaults (used for new shapes; mirror the selected shape when one is picked)
  const [color, setColor] = useState(COLORS[0])
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [arrowHead, setArrowHead] = useState(18)
  const [fontSize, setFontSize] = useState(28)
  const [bold, setBold] = useState(true)
  const [hlOpacity, setHlOpacity] = useState(0.35)
  const [numberSize, setNumberSize] = useState(18)
  const [stepCounter, setStepCounter] = useState(1)
  // pick tool: last two sampled colors, newest first, for a live WCAG contrast readout
  const [picks, setPicks] = useState<string[]>([])
  // measure tool: multiply on-screen pixel distance (e.g. 0.5 for a 2x retina capture)
  const [measureScale, setMeasureScale] = useState(1)

  const [shapes, setShapesRaw] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [boundaryKey, setBoundaryKey] = useState(0)

  // view: user zoom (on top of the auto-fit) + pan offset, plus a magnifier loupe
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [loupe, setLoupe] = useState(false)
  const [loupePos, setLoupePos] = useState<{ sx: number; sy: number; ipx: number; ipy: number } | null>(null)
  const [grab, setGrab] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  // Illustrator-style zoom tool: held Ctrl+Shift = zoom-in, +Alt = zoom-out
  const [zoomMode, setZoomMode] = useState<'in' | 'out' | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const zoomDrag = useRef<{ x: number; y: number; out: boolean } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const spaceDown = useRef(false)
  const ctrlDown = useRef(false)
  const lastMouse = useRef<{ x: number; y: number } | null>(null)

  const [bg, setBg] = useState<Bg>({ type: 'none' })
  const [padding, setPadding] = useState(0)
  const [radius, setRadius] = useState(0)
  const [shadow, setShadow] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)
  const [frame, setFrame] = useState<FrameStyle>('none')
  const [presets, setPresets] = useState<BeautifyPreset[]>([])
  const [palette, setPalette] = useState<string[]>([])
  const sampleRef = useRef<HTMLCanvasElement | null>(null)

  const [textEdit, setTextEdit] = useState<{ id: string; sx: number; sy: number; value: string } | null>(null)
  const textReady = useRef(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef(new Map<string, Konva.Node>())
  const isDrawing = useRef(false)
  const draftRef = useRef<Shape | null>(null)

  // ---- history ----
  const past = useRef<Shape[][]>([])
  const future = useRef<Shape[][]>([])
  function mutate(fn: (prev: Shape[]) => Shape[]): void {
    setShapesRaw((prev) => {
      past.current.push(prev)
      if (past.current.length > 100) past.current.shift()
      future.current = []
      return fn(prev)
    })
  }
  function undo(): void {
    setShapesRaw((prev) => {
      const p = past.current.pop()
      if (p === undefined) return prev
      future.current.push(prev)
      return p
    })
    setSelectedId(null)
  }
  function redo(): void {
    setShapesRaw((prev) => {
      const f = future.current.pop()
      if (f === undefined) return prev
      past.current.push(prev)
      return f
    })
  }

  useEffect(() => {
    api.getSnapshot().then((s) => {
      applyTheme(s.settings.theme)
      setLocale(s.settings.locale)
      const found = s.screenshots.find((x) => x.id === id) ?? null
      setShot(found)
      setBrandColors(s.settings.brandColors ?? [])
      setCustomColors(s.settings.customColors ?? [])
      setPresets(s.settings.beautifyPresets ?? [])
      if (found) {
        const im = new window.Image()
        im.onload = () => {
          setImg(im)
          try {
            const c = document.createElement('canvas')
            c.width = im.naturalWidth
            c.height = im.naturalHeight
            const ctx = c.getContext('2d')
            if (ctx) {
              ctx.drawImage(im, 0, 0)
              sampleRef.current = c
            }
          } catch { /* ignore */ }
          setPalette(extractPalette(im))
        }
        im.src = `${api.fileUrl(found.filePath)}?v=${found.bytes}`
      }
    })
  }, [id])

  // keyboard: delete / undo / redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (textEdit) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteSelected()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, textEdit])

  // finalize a draft even if the mouse is released outside the Stage (the freeze-bug fix)
  useEffect(() => {
    const onUpWin = (): void => finalizeDraft()
    window.addEventListener('mouseup', onUpWin)
    return () => window.removeEventListener('mouseup', onUpWin)
  })

  // focus the inline text editor reliably
  useEffect(() => {
    if (textEdit) {
      textReady.current = false
      const t = setTimeout(() => {
        textRef.current?.focus()
        textReady.current = true
      }, 30)
      return () => clearTimeout(t)
    }
  }, [textEdit?.id])

  const imgW = shot?.width ?? 0
  const imgH = shot?.height ?? 0
  const barH = frame === 'none' ? 0 : 40

  const layout = useMemo(() => {
    const contentW = imgW
    const contentH = imgH + barH
    let frameW = contentW + padding * 2
    let frameH = contentH + padding * 2
    if (aspect) {
      if (frameW / frameH < aspect) frameW = frameH * aspect
      else frameH = frameW / aspect
    }
    const stageW = Math.max(frameW, contentW)
    const stageH = Math.max(frameH, contentH)
    const offX = (stageW - contentW) / 2
    const offY = (stageH - contentH) / 2
    const fit = Math.min(820 / stageW, 560 / stageH, 1) || 1
    return { stageW, stageH, offX, offY, contentW, contentH, fit }
  }, [imgW, imgH, padding, aspect, barH])

  // attach transformer to the selected (transformable) node
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const sh = shapes.find((s) => s.id === selectedId)
    const node = selectedId ? nodeRefs.current.get(selectedId) : null
    if (tool === 'select' && node && sh && TRANSFORMABLE.has(sh.tool)) {
      tr.nodes([node])
    } else {
      tr.nodes([])
    }
    tr.getLayer()?.batchDraw()
  }, [selectedId, tool, shapes, boundaryKey])

  // Keep the latest view geometry in a ref so the once-attached native listeners read fresh values.
  const viewRef = useRef({ zoom, pan, layout, barH, imgW, imgH })
  viewRef.current = { zoom, pan, layout, barH, imgW, imgH }
  const zoomModeRef = useRef(zoomMode)
  zoomModeRef.current = zoomMode

  function resetView(): void {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // Zoom one step around an explicit client-space focal point (keeps that point fixed).
  function zoomAt(out: boolean, cx: number, cy: number): void {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const { zoom: z, pan: p } = viewRef.current
    const ux = (cx - rect.left) / z
    const uy = (cy - rect.top) / z
    const nz = Math.min(8, Math.max(0.25, z * (out ? 1 / 1.2 : 1.2)))
    setPan({ x: p.x + ux * (z - nz), y: p.y + uy * (z - nz) })
    setZoom(nz)
  }

  // Zoom one step around the cursor (or the canvas center if the cursor is off-canvas).
  function zoomStep(out: boolean): void {
    const cont = canvasRef.current
    if (!cont) return
    const crect = cont.getBoundingClientRect()
    const m = lastMouse.current
    const inside = m && m.x >= crect.left && m.x <= crect.right && m.y >= crect.top && m.y <= crect.bottom
    zoomAt(out, inside ? m!.x : crect.left + crect.width / 2, inside ? m!.y : crect.top + crect.height / 2)
  }

  // Zoom so a selected client-space rectangle fits and centers in the viewport.
  function zoomToRect(x1: number, y1: number, x2: number, y2: number): void {
    const wrap = wrapRef.current
    const cont = canvasRef.current
    if (!wrap || !cont) return
    const screenW = Math.abs(x2 - x1)
    const screenH = Math.abs(y2 - y1)
    if (screenW < 4 || screenH < 4) return
    const wrapRect = wrap.getBoundingClientRect()
    const crect = cont.getBoundingClientRect()
    const { zoom: z, pan: p } = viewRef.current
    const nz = Math.min(8, Math.max(0.25, Math.min((crect.width * z) / screenW, (crect.height * z) / screenH)))
    const mcx = (x1 + x2) / 2
    const mcy = (y1 + y2) / 2
    const uc = (mcx - wrapRect.left) / z
    const ucy = (mcy - wrapRect.top) / z
    const baseLeft = wrapRect.left - p.x
    const baseTop = wrapRect.top - p.y
    setPan({ x: crect.left + crect.width / 2 - baseLeft - uc * nz, y: crect.top + crect.height / 2 - baseTop - ucy * nz })
    setZoom(nz)
  }

  // wheel = zoom to cursor (non-passive so we can stop the canvas from scrolling)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!wrapRef.current) return
      e.preventDefault()
      const rect = wrapRef.current.getBoundingClientRect()
      const { zoom: z, pan: p } = viewRef.current
      const ux = (e.clientX - rect.left) / z
      const uy = (e.clientY - rect.top) / z
      const nz = Math.min(8, Math.max(0.25, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      setPan({ x: p.x + ux * (z - nz), y: p.y + uy * (z - nz) })
      setZoom(nz)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [img])

  // pan with Space+drag (or middle-mouse); keyboard zoom (Ctrl+Shift in, Ctrl+Shift+Alt out)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const isField = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }
    // current zoom-tool mode from held modifiers (Ctrl+Shift = in, +Alt = out)
    const computeMode = (e: KeyboardEvent): 'in' | 'out' | null => {
      if (textEdit || !e.ctrlKey || !e.shiftKey) return null
      return e.altKey ? 'out' : 'in'
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Control') ctrlDown.current = true
      if (e.code === 'Space' && !textEdit && !isField(e.target)) {
        e.preventDefault() // stop the canvas from scrolling / buttons from firing
        spaceDown.current = true
        setGrab(true)
      }
      setZoomMode(computeMode(e))
      // Ctrl+0 = reset zoom to fit
      if (!textEdit && !e.repeat && e.ctrlKey && e.key === '0') { e.preventDefault(); resetView() }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control') ctrlDown.current = false
      if (e.code === 'Space') { spaceDown.current = false; setGrab(false) }
      setZoomMode(computeMode(e))
    }
    const onBlur = (): void => {
      spaceDown.current = false; ctrlDown.current = false; panning.current = null; zoomDrag.current = null
      setGrab(false); setIsPanning(false); setZoomMode(null); setMarquee(null)
    }
    const onDownCapture = (e: MouseEvent): void => {
      // zoom tool wins over pan/drawing while a zoom mode is armed
      if (zoomModeRef.current && e.button === 0) {
        e.preventDefault()
        e.stopPropagation()
        zoomDrag.current = { x: e.clientX, y: e.clientY, out: zoomModeRef.current === 'out' }
        setMarquee(null)
        return
      }
      if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
        e.preventDefault()
        e.stopPropagation()
        const { pan: p } = viewRef.current
        panning.current = { x: p.x, y: p.y, px: e.clientX, py: e.clientY }
        setIsPanning(true)
      }
    }
    const onMoveWin = (e: MouseEvent): void => {
      lastMouse.current = { x: e.clientX, y: e.clientY }
      const zd = zoomDrag.current
      if (zd) {
        // marquee only for zoom-in
        if (!zd.out) setMarquee({ x: Math.min(zd.x, e.clientX), y: Math.min(zd.y, e.clientY), w: Math.abs(e.clientX - zd.x), h: Math.abs(e.clientY - zd.y) })
        return
      }
      if (!panning.current) return
      setPan({ x: panning.current.x + (e.clientX - panning.current.px), y: panning.current.y + (e.clientY - panning.current.py) })
    }
    const onUpWin = (e: MouseEvent): void => {
      const zd = zoomDrag.current
      if (zd) {
        zoomDrag.current = null
        setMarquee(null)
        const dist = Math.hypot(e.clientX - zd.x, e.clientY - zd.y)
        if (dist < 6 || zd.out) zoomAt(zd.out, zd.x, zd.y)
        else zoomToRect(zd.x, zd.y, e.clientX, e.clientY)
      }
      panning.current = null
      setIsPanning(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    el.addEventListener('mousedown', onDownCapture, true)
    window.addEventListener('mousemove', onMoveWin)
    window.addEventListener('mouseup', onUpWin)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      el.removeEventListener('mousedown', onDownCapture, true)
      window.removeEventListener('mousemove', onMoveWin)
      window.removeEventListener('mouseup', onUpWin)
    }
  }, [textEdit, img])

  // magnifier loupe: track the image pixel under the cursor while enabled
  useEffect(() => {
    if (!loupe) { setLoupePos(null); return }
    const onMove = (e: MouseEvent): void => {
      const wrap = wrapRef.current
      const { layout: L, barH: bH, imgW: iW, imgH: iH } = viewRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const ipx = ((e.clientX - rect.left) / rect.width) * L.stageW - L.offX
      const ipy = ((e.clientY - rect.top) / rect.height) * L.stageH - (L.offY + bH)
      if (ipx < 0 || ipy < 0 || ipx > iW || ipy > iH) { setLoupePos(null); return }
      setLoupePos({ sx: e.clientX, sy: e.clientY, ipx, ipy })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [loupe])

  // draw the loupe content (raw screenshot pixels, nearest-neighbour for crispness)
  useEffect(() => {
    if (!loupe || !loupePos || !img) return
    const cv = loupeCanvasRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const D = LOUPE_D
    const srcR = D / LOUPE_MAG
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, D, D)
    ctx.drawImage(img, loupePos.ipx - srcR / 2, loupePos.ipy - srcR / 2, srcR, srcR, 0, 0, D, D)
    ctx.strokeStyle = 'rgba(111,114,241,0.95)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(D / 2, 0); ctx.lineTo(D / 2, D)
    ctx.moveTo(0, D / 2); ctx.lineTo(D, D / 2)
    ctx.stroke()
  }, [loupe, loupePos, img])

  // Crisp zoom: the stage canvas is normally rendered at the fit-shrunk size, so CSS-zooming
  // it just magnifies a low-res bitmap (pixelated text). Raise the canvas backing resolution
  // with the zoom level, capped at the screenshot's true native pixels (dpr / fit).
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const dpr = window.devicePixelRatio || 1
    const f = Math.max(layout.fit, 0.01)
    const pr = Math.min(Math.max(zoom, 1) * dpr, dpr / f)
    stage.getLayers().forEach((layer) => {
      const c = layer.getCanvas()
      if (Math.abs(c.getPixelRatio() - pr) > 0.001) {
        c.setPixelRatio(pr)
        layer.batchDraw()
      }
    })
  }, [zoom, layout.fit, img, shapes, bg, padding, radius, shadow, aspect, frame])

  if (!shot || !img) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <Icon name="image" size={26} className="spin" />
      </div>
    )
  }

  const { stageW, stageH, offX, offY, contentW, contentH, fit } = layout
  const imgOffY = offY + barH
  const winRadius = Math.max(0, Math.min(barH > 0 ? Math.max(radius, 12) : radius, contentW / 2, contentH / 2))

  function toImgPoint(e: Konva.KonvaEventObject<MouseEvent>): { x: number; y: number } {
    const stage = e.target.getStage()!
    const p = stage.getPointerPosition()!
    return { x: p.x / fit - offX, y: p.y / fit - imgOffY }
  }

  function eraseAt(e: Konva.KonvaEventObject<MouseEvent>): void {
    const stage = e.target.getStage()
    if (!stage) return
    const pos = stage.getPointerPosition()
    if (!pos) return
    let node: Konva.Node | null = stage.getIntersection(pos)
    let hitId: string | undefined
    while (node && !hitId) {
      for (const [sid, n] of nodeRefs.current) {
        if (n === node) {
          hitId = sid
          break
        }
      }
      node = node.getParent() as Konva.Node | null
    }
    if (hitId) mutate((s) => s.filter((x) => x.id !== hitId))
  }

  function sampleColor(x: number, y: number): string {
    const c = sampleRef.current
    if (!c) return ''
    const ix = Math.max(0, Math.min(c.width - 1, Math.round(x)))
    const iy = Math.max(0, Math.min(c.height - 1, Math.round(y)))
    try {
      const d = c.getContext('2d')!.getImageData(ix, iy, 1, 1).data
      return rgbToHex(d[0], d[1], d[2])
    } catch {
      return ''
    }
  }

  function onDown(e: Konva.KonvaEventObject<MouseEvent>): void {
    if (tool === 'select') {
      if (e.target === e.target.getStage() || e.target.name() === 'bg') setSelectedId(null)
      return
    }
    if (tool === 'eraser') {
      isDrawing.current = true
      eraseAt(e)
      return
    }
    if (tool === 'pick') {
      const pt = toImgPoint(e)
      const hex = sampleColor(pt.x, pt.y)
      if (hex) {
        setColor(hex)
        if (sel) patchSel({ color: hex })
        addCustomColor(hex)
        setPicks((p) => [hex, ...p.filter((c) => c !== hex)].slice(0, 2))
        navigator.clipboard?.writeText(hex).catch(() => {})
        api.toast(t('editor.toastPicked', { hex }))
      }
      return
    }
    const { x, y } = toImgPoint(e)
    const nid = uid()
    if (tool === 'number') {
      mutate((s) => [...s, { id: nid, tool: 'number', x, y, n: stepCounter, color, numberSize }])
      setStepCounter((n) => n + 1)
      return
    }
    isDrawing.current = true
    let d: Shape
    if (tool === 'pen') {
      d = { id: nid, tool: 'pen', points: [x, y], color, width: strokeWidth }
    } else if (tool === 'arrow' || tool === 'line' || tool === 'measure') {
      d = { id: nid, tool, points: [x, y, x, y], color, width: strokeWidth, arrowHead }
    } else if (tool === 'text') {
      d = { id: nid, tool: 'text', x, y, w: 0, h: 0, color, fontSize, bold }
    } else {
      d = { id: nid, tool, x, y, w: 0, h: 0, color, width: strokeWidth, opacity: hlOpacity }
    }
    draftRef.current = d
    setDraft(d)
  }

  function onMove(e: Konva.KonvaEventObject<MouseEvent>): void {
    if (tool === 'eraser') {
      if (isDrawing.current) eraseAt(e)
      return
    }
    if (!isDrawing.current || !draftRef.current) return
    const base = draftRef.current
    const { x, y } = toImgPoint(e)
    let nd: Shape
    if (base.tool === 'pen') {
      nd = { ...base, points: [...(base.points ?? []), x, y] }
    } else if (base.tool === 'arrow' || base.tool === 'line' || base.tool === 'measure') {
      const p = base.points!
      nd = { ...base, points: [p[0], p[1], x, y] }
    } else {
      nd = { ...base, w: x - (base.x ?? 0), h: y - (base.y ?? 0) }
    }
    draftRef.current = nd
    setDraft(nd)
  }

  // Finalize the in-progress draft. No nested setState: read the ref, then commit once.
  function finalizeDraft(): void {
    if (!isDrawing.current) return
    isDrawing.current = false
    const d = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (!d) return

    if (d.tool === 'pen') {
      if ((d.points?.length ?? 0) >= 4) mutate((s) => [...s, d])
      return
    }
    if (d.tool === 'arrow' || d.tool === 'line' || d.tool === 'measure') {
      const p = d.points ?? []
      if (Math.hypot((p[2] ?? 0) - (p[0] ?? 0), (p[3] ?? 0) - (p[1] ?? 0)) >= 5) mutate((s) => [...s, d])
      return
    }
    // box-like: normalize negative drag
    if (d.w !== undefined && d.h !== undefined) {
      if (d.w < 0) { d.x = (d.x ?? 0) + d.w; d.w = Math.abs(d.w) }
      if (d.h < 0) { d.y = (d.y ?? 0) + d.h; d.h = Math.abs(d.h) }
    }
    if (d.tool === 'text') {
      // drag => fixed-width box (wraps + grows); quick click => auto-width point text
      const isBox = (d.w ?? 0) > 12
      const shape: Shape = { id: d.id, tool: 'text', x: d.x, y: d.y, text: '', color: d.color, fontSize: d.fontSize, bold: d.bold, boxWidth: isBox ? d.w : undefined }
      mutate((s) => [...s, shape])
      const cont = stageRef.current?.container().getBoundingClientRect()
      setTextEdit({ id: d.id, sx: (cont?.left ?? 0) + ((d.x ?? 0) + offX) * fit, sy: (cont?.top ?? 0) + ((d.y ?? 0) + imgOffY) * fit, value: '' })
      return
    }
    if (Math.abs(d.w ?? 0) >= 4 || Math.abs(d.h ?? 0) >= 4) mutate((s) => [...s, d])
  }

  function deleteSelected(): void {
    if (!selectedId) return
    const sid = selectedId
    setSelectedId(null)
    mutate((s) => s.filter((x) => x.id !== sid))
  }
  function clearAll(): void {
    setSelectedId(null)
    mutate(() => [])
  }

  // ---- property setters (edit defaults, and the selected shape if any) ----
  const sel = selectedId ? shapes.find((s) => s.id === selectedId) ?? null : null
  const editShape = textEdit ? shapes.find((s) => s.id === textEdit.id) ?? null : null
  const panelTool: Tool = sel?.tool ?? tool
  function patchSel(patch: Partial<Shape>): void {
    if (sel) mutate((s) => s.map((x) => (x.id === sel.id ? { ...x, ...patch } : x)))
  }
  const setColorBoth = (c: string): void => { setColor(c); patchSel({ color: c }) }
  const setWidthBoth = (w: number): void => { setStrokeWidth(w); patchSel({ width: w }) }
  const setHeadBoth = (a: number): void => { setArrowHead(a); patchSel({ arrowHead: a }) }
  const setFontBoth = (f: number): void => { setFontSize(f); patchSel({ fontSize: f }) }
  const setBoldBoth = (b: boolean): void => { setBold(b); patchSel({ bold: b }) }
  const setOpacityBoth = (o: number): void => { setHlOpacity(o); patchSel({ opacity: o }) }
  const setNumSizeBoth = (n: number): void => { setNumberSize(n); patchSel({ numberSize: n }) }

  function addCustomColor(c: string): void {
    if (COLORS.includes(c) || customColors.includes(c)) return
    const next = [...customColors, c].slice(-16)
    setCustomColors(next)
    api.updateSettings({ customColors: next })
  }
  function removeCustomColor(c: string): void {
    const next = customColors.filter((x) => x !== c)
    setCustomColors(next)
    api.updateSettings({ customColors: next })
  }

  function applyPreset(p: BeautifyPreset): void {
    setBg(p.bg)
    setPadding(p.padding)
    setRadius(p.radius)
    setShadow(p.shadow)
    setAspect(p.aspect)
    setFrame(p.frame)
  }
  function saveCurrentPreset(): void {
    const p: BeautifyPreset = { id: uid(), name: t('editor.presetDefaultName', { n: presets.length + 1 }), bg, padding, radius, shadow, aspect, frame }
    const next = [...presets, p].slice(-20)
    setPresets(next)
    api.updateSettings({ beautifyPresets: next })
  }
  function deletePreset(pid: string): void {
    const next = presets.filter((p) => p.id !== pid)
    setPresets(next)
    api.updateSettings({ beautifyPresets: next })
  }

  function toggleTextLock(): void {
    if (!sel || sel.tool !== 'text') return
    if (sel.boxHeight) {
      patchSel({ boxHeight: undefined })
    } else {
      const node = nodeRefs.current.get(sel.id)
      const w = sel.boxWidth ?? (node ? Math.max(80, node.width()) : 220)
      const h = node ? Math.max(40, node.height()) : 80
      patchSel({ boxWidth: w, boxHeight: h })
    }
  }

  function commitText(): void {
    if (!textEdit) return
    const val = textEdit.value.replace(/\s+$/, '')
    const tid = textEdit.id
    const ta = textRef.current
    const resize = ta?.style.resize
    const newW = ta && resize && resize !== 'none' ? Math.max(40, ta.offsetWidth / fit) : undefined
    const newH = ta && resize === 'both' ? Math.max(24, ta.offsetHeight / fit) : undefined
    setTextEdit(null)
    if (val.trim()) {
      mutate((s) => s.map((x) => (x.id === tid ? { ...x, text: val, ...(newW ? { boxWidth: newW } : {}), ...(newH ? { boxHeight: newH } : {}) } : x)))
    } else {
      mutate((s) => s.filter((x) => x.id !== tid))
    }
  }

  async function detectPii(): Promise<void> {
    setDetecting(true)
    const regions = await api.detectPii(shot!.id)
    setDetecting(false)
    if (regions.length === 0) {
      api.toast(t('editor.toastNoPii'))
      return
    }
    mutate((s) => [
      ...s,
      ...regions.map((r) => ({ id: uid(), tool: 'redact' as Tool, x: r.x * imgW, y: r.y * imgH, w: r.width * imgW, h: r.height * imgH }))
    ])
    api.toast(regions.length > 1 ? t('editor.toastRedactedPlural', { count: regions.length }) : t('editor.toastRedactedSingular'))
  }

  async function save(replace: boolean): Promise<void> {
    setSelectedId(null)
    await new Promise((r) => requestAnimationFrame(r))
    try {
      const url = stageRef.current?.toDataURL({ pixelRatio: 1 / fit, mimeType: 'image/png' })
      if (!url) return
      await api.saveEdited(shot!.id, url, { replace })
      api.toast(replace ? t('editor.toastSavedOriginal') : t('editor.toastSavedCopy'))
      window.close()
    } catch (err) {
      console.error('[editor] save failed', err)
      api.toast(t('editor.toastSaveFailed'))
    }
  }

  const gradientPoints = (angle: number): { start: { x: number; y: number }; end: { x: number; y: number } } => {
    const rad = (angle * Math.PI) / 180
    const cx = stageW / 2
    const cy = stageH / 2
    const len = Math.max(stageW, stageH) / 2
    return {
      start: { x: cx - Math.cos(rad) * len, y: cy - Math.sin(rad) * len },
      end: { x: cx + Math.cos(rad) * len, y: cy + Math.sin(rad) * len }
    }
  }

  const draggable = tool === 'select'
  const setRef = (sid: string) => (node: Konva.Node | null): void => {
    if (node) nodeRefs.current.set(sid, node)
    else nodeRefs.current.delete(sid)
  }
  const onSelect = (sid: string) => (): void => {
    if (tool === 'select') setSelectedId(sid)
  }

  function onShapeDragEnd(sh: Shape, e: Konva.KonvaEventObject<DragEvent>): void {
    const node = e.target
    if (sh.tool === 'arrow' || sh.tool === 'line' || sh.tool === 'pen' || sh.tool === 'measure') {
      const dx = node.x()
      const dy = node.y()
      node.position({ x: 0, y: 0 })
      mutate((s) => s.map((x) => (x.id === sh.id ? { ...x, points: (x.points ?? []).map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) } : x)))
    } else if (sh.tool === 'ellipse') {
      // node x/y is the ellipse center; store top-left
      mutate((s) => s.map((x) => (x.id === sh.id ? { ...x, x: node.x() - (x.w ?? 0) / 2, y: node.y() - (x.h ?? 0) / 2 } : x)))
    } else {
      mutate((s) => s.map((x) => (x.id === sh.id ? { ...x, x: node.x(), y: node.y() } : x)))
    }
  }

  function onShapeTransformEnd(sh: Shape, e: Konva.KonvaEventObject<Event>): void {
    const node = e.target
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const rotation = node.rotation()
    mutate((s) =>
      s.map((x) => {
        if (x.id !== sh.id) return x
        if (x.tool === 'text') {
          if (x.boxHeight) return { ...x, x: node.x(), y: node.y(), boxWidth: Math.max(40, (x.boxWidth ?? 200) * sx), boxHeight: Math.max(24, x.boxHeight * sy), rotation }
          if (x.boxWidth) return { ...x, x: node.x(), y: node.y(), boxWidth: Math.max(40, x.boxWidth * sx), rotation }
          return { ...x, x: node.x(), y: node.y(), fontSize: Math.max(8, (x.fontSize ?? 28) * sx), rotation }
        }
        if (x.tool === 'number') return { ...x, x: node.x(), y: node.y(), numberSize: Math.max(8, (x.numberSize ?? 18) * sx), rotation }
        if (x.tool === 'ellipse') {
          const w = Math.max(6, (x.w ?? 0) * sx)
          const h = Math.max(6, (x.h ?? 0) * sy)
          return { ...x, w, h, x: node.x() - w / 2, y: node.y() - h / 2, rotation }
        }
        // rect / redact / highlight
        return { ...x, x: node.x(), y: node.y(), w: Math.max(6, (x.w ?? 0) * sx), h: Math.max(6, (x.h ?? 0) * sy), rotation }
      })
    )
  }

  const renderShape = (sh: Shape): React.ReactNode => {
    if (sh.points && sh.points.some((n) => !Number.isFinite(n))) return null
    const common = {
      key: sh.id,
      ref: setRef(sh.id),
      draggable,
      onClick: onSelect(sh.id),
      onTap: onSelect(sh.id),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onShapeDragEnd(sh, e),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => onShapeTransformEnd(sh, e),
      rotation: sh.rotation
    }
    switch (sh.tool) {
      case 'arrow':
        return <Arrow {...common} points={sh.points!} stroke={sh.color} fill={sh.color} strokeWidth={sh.width} pointerLength={sh.arrowHead ?? 14} pointerWidth={sh.arrowHead ?? 14} lineCap="round" hitStrokeWidth={Math.max(12, sh.width ?? 4)} />
      case 'line':
        return <Line {...common} points={sh.points!} stroke={sh.color} strokeWidth={sh.width} lineCap="round" hitStrokeWidth={Math.max(12, sh.width ?? 4)} />
      case 'measure': {
        const p = sh.points!
        const [x1, y1, x2, y2] = p
        const dx = x2 - x1
        const dy = y2 - y1
        const dist = Math.hypot(dx, dy) * (measureScale || 1)
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2
        const ang = Math.atan2(dy, dx)
        const tick = Math.max(6, (sh.width ?? 2) * 3)
        const tx = Math.cos(ang + Math.PI / 2) * tick
        const ty = Math.sin(ang + Math.PI / 2) * tick
        const label = `${Math.round(dist)} px`
        const fs = 13
        const lw = label.length * fs * 0.62 + 12
        const lh = fs + 7
        const sw = sh.width ?? 2
        return (
          <Group {...common}>
            <Line points={p} stroke={sh.color} strokeWidth={sw} lineCap="round" hitStrokeWidth={Math.max(14, sw)} />
            <Line points={[x1 - tx, y1 - ty, x1 + tx, y1 + ty]} stroke={sh.color} strokeWidth={sw} lineCap="round" listening={false} />
            <Line points={[x2 - tx, y2 - ty, x2 + tx, y2 + ty]} stroke={sh.color} strokeWidth={sw} lineCap="round" listening={false} />
            <Rect x={mx - lw / 2} y={my - lh / 2} width={lw} height={lh} cornerRadius={4} fill="#0a0c11" opacity={0.82} listening={false} />
            <Text x={mx - lw / 2} y={my - lh / 2 + 4} width={lw} text={label} fontSize={fs} fontStyle="700" fill="#ffffff" align="center" listening={false} />
          </Group>
        )
      }
      case 'pen':
        return <Line {...common} points={sh.points!} stroke={sh.color} strokeWidth={sh.width} lineCap="round" lineJoin="round" tension={0.4} hitStrokeWidth={Math.max(12, sh.width ?? 4)} />
      case 'rect': {
        const n = normBox(sh)
        return <Rect {...common} x={n.x} y={n.y} width={n.w} height={n.h} stroke={sh.color} strokeWidth={sh.width} cornerRadius={safeCorner(4, n.w, n.h)} />
      }
      case 'ellipse': {
        const n = normBox(sh)
        return <Ellipse {...common} x={n.x + n.w / 2} y={n.y + n.h / 2} radiusX={n.w / 2} radiusY={n.h / 2} stroke={sh.color} strokeWidth={sh.width} />
      }
      case 'highlight': {
        const n = normBox(sh)
        return <Rect {...common} x={n.x} y={n.y} width={n.w} height={n.h} fill={sh.color} opacity={sh.opacity ?? 0.35} />
      }
      case 'redact': {
        const n = normBox(sh)
        return <Rect {...common} x={n.x} y={n.y} width={n.w} height={n.h} fill="#0a0c11" cornerRadius={safeCorner(2, n.w, n.h)} />
      }
      case 'text':
        return (
          <Text
            {...common}
            x={sh.x}
            y={sh.y}
            text={sh.text || ' '}
            fontSize={sh.fontSize ?? 28}
            fontStyle={sh.bold ? '700' : '400'}
            fill={sh.color}
            width={sh.boxWidth}
            height={sh.boxHeight}
            wrap={sh.boxWidth ? 'word' : 'none'}
            ellipsis={!!sh.boxHeight}
          />
        )
      case 'number': {
        const r = Math.max(8, sh.numberSize ?? 18)
        return (
          <Group {...common} x={sh.x} y={sh.y}>
            <Circle radius={r} fill={sh.color} />
            <Text text={String(sh.n ?? 1)} fontSize={r} fontStyle="700" fill="#fff" width={r * 2} height={r * 2} offsetX={r} offsetY={r} align="center" verticalAlign="middle" />
          </Group>
        )
      }
      default:
        return null
    }
  }

  const allShapes = (draft ? [...shapes, draft] : shapes).filter((s) => {
    if (s.x !== undefined && !finite(s.x)) return false
    if (s.y !== undefined && !finite(s.y)) return false
    return true
  })

  const tools: { t: Tool; icon: string; title: string }[] = [
    { t: 'select', icon: 'region', title: t('editor.toolSelect') },
    { t: 'arrow', icon: 'arrow', title: t('editor.toolArrow') },
    { t: 'rect', icon: 'square', title: t('editor.toolRectangle') },
    { t: 'ellipse', icon: 'eye', title: t('editor.toolEllipse') },
    { t: 'line', icon: 'pen', title: t('editor.toolLine') },
    { t: 'pen', icon: 'edit', title: t('editor.toolFreeDraw') },
    { t: 'highlight', icon: 'star', title: t('editor.toolHighlight') },
    { t: 'number', icon: 'plus', title: t('editor.toolStepNumber') },
    { t: 'text', icon: 'type', title: t('editor.toolText') },
    { t: 'redact', icon: 'shield', title: t('editor.toolRedact') },
    { t: 'measure', icon: 'ruler', title: t('editor.toolMeasure') },
    { t: 'eraser', icon: 'eraser', title: t('editor.toolEraser') },
    { t: 'pick', icon: 'pipette', title: t('editor.toolPick') }
  ]

  const curColor = sel?.color ?? color
  const showColor = panelTool !== 'redact'

  return (
    <div className="ed">
      <div className="ed-top">
        <button className="icon-btn" onClick={() => window.close()} title={t('editor.close')}>
          <Icon name="back" size={18} />
        </button>
        <span className="title">{shot.aiName ?? shot.fileName}</span>
        <div className="ed-history">
          <button className="icon-btn" title={t('editor.undo')} onClick={undo}>
            <Icon name="back" size={16} />
          </button>
          <button className="icon-btn" title={t('editor.redo')} onClick={redo} style={{ transform: 'scaleX(-1)' }}>
            <Icon name="back" size={16} />
          </button>
          <button className="icon-btn" title={t('editor.deleteSelected')} onClick={deleteSelected} disabled={!selectedId}>
            <Icon name="trash" size={16} />
          </button>
          <button className="icon-btn" title={t('editor.clearAll')} onClick={clearAll} disabled={shapes.length === 0}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="ed-zoom">
          <button className="icon-btn" title={t('editor.magnifierLoupe')} onClick={() => setLoupe((v) => !v)} style={loupe ? { color: '#8b8dff' } : undefined}>
            <Icon name="search" size={16} />
          </button>
          <button className="icon-btn" title={t('editor.zoomOut')} onClick={() => zoomStep(true)}>
            <Icon name="minus" size={16} />
          </button>
          <button className="zoom-pct" title={t('editor.zoomReset')} onClick={resetView}>{Math.round(zoom * 100)}%</button>
          <button className="icon-btn" title={t('editor.zoomIn')} onClick={() => zoomStep(false)}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => save(false)}>
          <Icon name="download" size={16} /> {t('editor.saveCopy')}
        </button>
        <button className="btn primary" onClick={() => save(true)}>
          <Icon name="check" size={16} /> {t('editor.saveOverOriginal')}
        </button>
      </div>

      <div className="ed-tools">
        {tools.map((tl) => (
          <button key={tl.t} className={`tool ${tool === tl.t ? 'active' : ''}`} title={tl.title} onClick={() => { setTool(tl.t); if (tl.t !== 'select') setSelectedId(null) }}>
            <Icon name={tl.icon} size={19} />
          </button>
        ))}
      </div>

      <div className="ed-canvas" ref={canvasRef} style={{ cursor: isPanning ? 'grabbing' : zoomMode === 'in' ? 'zoom-in' : zoomMode === 'out' ? 'zoom-out' : grab ? 'grab' : undefined }}>
        <div
          className="ed-stage-wrap"
          ref={wrapRef}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
        >
          <CanvasBoundary key={boundaryKey} onRecover={() => { clearAll(); setBoundaryKey((k) => k + 1) }}>
            <Stage
              ref={stageRef}
              width={stageW * fit}
              height={stageH * fit}
              scaleX={fit}
              scaleY={fit}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={finalizeDraft}
              style={{ cursor: isPanning ? 'grabbing' : zoomMode === 'in' ? 'zoom-in' : zoomMode === 'out' ? 'zoom-out' : grab ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}
            >
              <Layer>
                {bg.type !== 'none' && (
                  <Rect
                    name="bg"
                    x={0}
                    y={0}
                    width={stageW}
                    height={stageH}
                    fill={bg.type === 'solid' ? bg.color : undefined}
                    fillLinearGradientStartPoint={bg.type === 'gradient' ? gradientPoints(bg.angle).start : undefined}
                    fillLinearGradientEndPoint={bg.type === 'gradient' ? gradientPoints(bg.angle).end : undefined}
                    fillLinearGradientColorStops={bg.type === 'gradient' ? [0, bg.from, 1, bg.to] : undefined}
                  />
                )}
                {(shadow || winRadius > 0 || barH > 0) && (
                  <Rect x={offX} y={offY} width={contentW} height={contentH} cornerRadius={winRadius} fill="#0a0c11" shadowColor="#000" shadowBlur={shadow ? 44 : 0} shadowOpacity={shadow ? 0.5 : 0} shadowOffsetY={shadow ? 20 : 0} />
                )}
                <Group x={offX} y={offY} clipFunc={(ctx) => roundRect(ctx, 0, 0, contentW, contentH, winRadius)}>
                  {barH > 0 && (
                    <>
                      <Rect x={0} y={0} width={contentW} height={barH} fill={frame === 'browser-dark' ? '#202632' : '#e9edf3'} />
                      <Circle x={20} y={barH / 2} radius={6} fill="#ff5f57" />
                      <Circle x={40} y={barH / 2} radius={6} fill="#febc2e" />
                      <Circle x={60} y={barH / 2} radius={6} fill="#28c840" />
                      <Rect x={86} y={barH / 2 - 11} width={Math.max(40, contentW - 110)} height={22} cornerRadius={11} fill={frame === 'browser-dark' ? '#2a3240' : '#ffffff'} />
                    </>
                  )}
                  <Group x={0} y={barH}>
                    <KImage image={img} width={imgW} height={imgH} listening={false} />
                    {allShapes.map(renderShape)}
                    {draft?.tool === 'text' && Math.abs(draft.w ?? 0) > 4 && (
                      <Rect
                        x={Math.min(draft.x ?? 0, (draft.x ?? 0) + (draft.w ?? 0))}
                        y={Math.min(draft.y ?? 0, (draft.y ?? 0) + (draft.h ?? 0))}
                        width={Math.abs(draft.w ?? 0)}
                        height={Math.abs(draft.h ?? 0)}
                        stroke="#6f72f1"
                        dash={[6, 4]}
                        listening={false}
                      />
                    )}
                    <Transformer ref={trRef} rotateEnabled ignoreStroke keepRatio={false} boundBoxFunc={(_old, nb) => (nb.width < 8 || nb.height < 8 ? _old : nb)} />
                  </Group>
                </Group>
              </Layer>
            </Stage>
          </CanvasBoundary>
        </div>
      </div>

      <div className="ed-panel">
        <h3>{sel ? t('editor.selectedItem') : panelTool === 'select' ? t('editor.tools') : t('editor.panelOptions', { tool: panelTool })}</h3>

        {panelTool === 'select' && !sel && <div className="small muted">{t('editor.toolsHint')}</div>}

        {showColor && (panelTool !== 'select' || sel) && (
          <>
            <div className="lbl-row">{t('editor.color')}</div>
            <div className="swatches">
              {[...COLORS, ...customColors].filter((v, i, a) => a.indexOf(v) === i).map((c) => (
                <div
                  key={c}
                  className={`sw ${curColor === c ? 'active' : ''}`}
                  style={{ background: c }}
                  title={customColors.includes(c) ? t('editor.savedColorRemove') : c}
                  onClick={() => setColorBoth(c)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (customColors.includes(c)) removeCustomColor(c)
                  }}
                />
              ))}
              <label className="sw custom" title={t('editor.customColor')} style={{ background: curColor }}>
                <input type="color" value={curColor} onChange={(e) => setColorBoth(e.target.value)} />
              </label>
            </div>
            <button className="btn sm" style={{ marginTop: 6 }} onClick={() => addCustomColor(curColor)} disabled={COLORS.includes(curColor) || customColors.includes(curColor)}>
              <Icon name="plus" size={13} /> {t('editor.saveColorToPalette')}
            </button>
          </>
        )}

        {(panelTool === 'arrow' || panelTool === 'line' || panelTool === 'pen' || panelTool === 'rect' || panelTool === 'ellipse' || panelTool === 'measure') && (
          <Slider label={t('editor.thickness')} min={1} max={24} value={sel?.width ?? strokeWidth} onChange={setWidthBoth} />
        )}
        {panelTool === 'arrow' && <Slider label={t('editor.arrowheadSize')} min={6} max={60} value={sel?.arrowHead ?? arrowHead} onChange={setHeadBoth} />}
        {panelTool === 'highlight' && <Slider label={t('editor.opacity')} min={5} max={90} value={Math.round((sel?.opacity ?? hlOpacity) * 100)} onChange={(v) => setOpacityBoth(v / 100)} suffix="%" />}
        {panelTool === 'text' && (
          <>
            <Slider label={t('editor.fontSize')} min={10} max={120} value={sel?.fontSize ?? fontSize} onChange={setFontBoth} />
            <div className="set-row" style={{ marginTop: 8 }}>
              <span>{t('editor.bold')}</span>
              <div className={`switch ${(sel?.bold ?? bold) ? 'on' : ''}`} onClick={() => setBoldBoth(!(sel?.bold ?? bold))}>
                <div className="knob" />
              </div>
            </div>
            {sel && sel.tool === 'text' && (
              <div className="set-row" style={{ marginTop: 8 }}>
                <span>{t('editor.lockBoxSize')}</span>
                <div className={`switch ${sel.boxHeight ? 'on' : ''}`} onClick={toggleTextLock}>
                  <div className="knob" />
                </div>
              </div>
            )}
            <div className="small muted" style={{ marginTop: 6 }}>
              {sel?.tool === 'text'
                ? t('editor.textLockedHint')
                : t('editor.textHint')}
            </div>
          </>
        )}
        {panelTool === 'number' && (
          <>
            <Slider label={t('editor.size')} min={10} max={60} value={sel?.numberSize ?? numberSize} onChange={setNumSizeBoth} />
            {!sel && (
              <div style={{ marginTop: 8 }}>
                <div className="lbl-row">{t('editor.nextNumber')}</div>
                <input className="input" type="number" min={0} value={stepCounter} onChange={(e) => setStepCounter(Number(e.target.value) || 1)} />
              </div>
            )}
            {sel && sel.tool === 'number' && (
              <div style={{ marginTop: 8 }}>
                <div className="lbl-row">{t('editor.value')}</div>
                <input className="input" type="number" value={sel.n ?? 1} onChange={(e) => patchSel({ n: Number(e.target.value) || 0 })} />
              </div>
            )}
          </>
        )}

        {panelTool === 'measure' && (
          <>
            <div style={{ marginTop: 10 }}>
              <div className="lbl-row">{t('editor.scalePxMultiplier')}</div>
              <input
                className="input"
                type="number"
                min={0.05}
                step={0.05}
                value={measureScale}
                onChange={(e) => setMeasureScale(Math.max(0.01, Number(e.target.value) || 1))}
              />
            </div>
            <div className="seg" style={{ marginTop: 8 }}>
              {([['1x', 1], ['0.5x (retina)', 0.5], ['2x', 2]] as const).map(([label, v]) => (
                <button key={label} className={measureScale === v ? 'active' : ''} onClick={() => setMeasureScale(v)}>
                  {v === 0.5 ? t('editor.scaleRetina') : label}
                </button>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {t('editor.measureHint')}
            </div>
          </>
        )}

        {panelTool === 'pick' && (
          <>
            <div className="divider" />
            <h3>{t('editor.contrastWcag')}</h3>
            {picks.length < 2 ? (
              <div className="small muted">
                {t('editor.contrastPickHint')}
                {picks.length === 1 && <> {t('editor.firstColor')} <strong>{picks[0]}</strong>.</>}
              </div>
            ) : (
              <ContrastReadout fg={picks[0]} bg={picks[1]} />
            )}
          </>
        )}

        <div className="divider" />
        <h3>{t('editor.privacy')}</h3>
        <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={detectPii} disabled={detecting}>
          <Icon name="shield" size={16} className={detecting ? 'spin' : ''} /> {detecting ? t('editor.scanning') : t('editor.autoRedact')}
        </button>
        <div className="small muted" style={{ marginTop: 6 }}>{t('editor.privacyHint')}</div>

        {palette.length > 0 && (
          <>
            <div className="divider" />
            <h3>{t('editor.colorsInScreenshot')}</h3>
            <div className="small muted" style={{ marginBottom: 8 }}>{t('editor.colorsHint')}</div>
            <div className="swatches">
              {palette.map((c) => (
                <div
                  key={c}
                  className={`sw ${curColor === c ? 'active' : ''}`}
                  style={{ background: c }}
                  title={t('editor.swatchUseSave', { color: c })}
                  onClick={() => setColorBoth(c)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    addCustomColor(c)
                  }}
                />
              ))}
            </div>
          </>
        )}

        <div className="divider" />
        <h3>{t('editor.beautify')}</h3>
        <div style={{ marginBottom: 10 }}>
          <div className="lbl-row">{t('editor.savedStyles')}</div>
          <div className="preset-row">
            {presets.map((p) => (
              <span key={p.id} className="preset-chip" onClick={() => applyPreset(p)} title={t('editor.applyStyle')}>
                {p.name}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deletePreset(p.id)
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
            <button className="btn sm" onClick={saveCurrentPreset}>
              <Icon name="plus" size={13} /> {t('editor.saveCurrent')}
            </button>
          </div>
        </div>
        <div className="lbl-row">{t('editor.frame')}</div>
        <div className="seg" style={{ marginBottom: 10 }}>
          {(
            [
              ['none', t('editor.frameNone')],
              ['browser-light', t('editor.frameBrowser')],
              ['browser-dark', t('editor.frameDark')]
            ] as const
          ).map(([f, label]) => (
            <button key={f} className={frame === f ? 'active' : ''} onClick={() => setFrame(f)}>
              {label}
            </button>
          ))}
        </div>
        <div className="lbl-row">{t('editor.background')}</div>
        <div className="seg">
          {(['none', 'solid', 'gradient'] as const).map((bgType) => (
            <button
              key={bgType}
              className={bg.type === bgType ? 'active' : ''}
              onClick={() =>
                setBg(bgType === 'none' ? { type: 'none' } : bgType === 'solid' ? { type: 'solid', color: brandColors[0] ?? '#6f72f1' } : { type: 'gradient', from: GRADIENTS[0].from, to: GRADIENTS[0].to, angle: 135 })
              }
            >
              {bgType === 'none' ? t('editor.bgNone') : bgType === 'solid' ? t('editor.bgColor') : t('editor.bgGradient')}
            </button>
          ))}
        </div>

        {bg.type === 'solid' && (
          <>
            <div className="swatches" style={{ marginTop: 10 }}>
              {[...brandColors, ...customColors, ...COLORS].filter((v, i, a) => a.indexOf(v) === i).map((c) => (
                <div
                  key={c}
                  className={`sw ${bg.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  title={customColors.includes(c) ? t('editor.savedColorRemove') : c}
                  onClick={() => setBg({ type: 'solid', color: c })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (customColors.includes(c)) removeCustomColor(c)
                  }}
                />
              ))}
              <label className="sw custom" title={t('editor.customColor')} style={{ background: bg.color }}>
                <input type="color" value={bg.color} onChange={(e) => setBg({ type: 'solid', color: e.target.value })} />
              </label>
            </div>
            <button className="btn sm" style={{ marginTop: 6 }} onClick={() => addCustomColor(bg.color)} disabled={COLORS.includes(bg.color) || customColors.includes(bg.color) || brandColors.includes(bg.color)}>
              <Icon name="plus" size={13} /> {t('editor.saveColorToPalette')}
            </button>
          </>
        )}

        {bg.type === 'gradient' && (
          <>
            <div className="bg-grid" style={{ marginTop: 10 }}>
              {GRADIENTS.map((g, i) => (
                <div key={i} className={`bg-opt ${bg.from === g.from && bg.to === g.to ? 'active' : ''}`} style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }} onClick={() => setBg({ ...bg, from: g.from, to: g.to })} />
              ))}
            </div>
            <div className="grad-custom">
              <label className="sw custom" style={{ background: bg.from }} title={t('editor.gradFrom')}>
                <input type="color" value={bg.from} onChange={(e) => setBg({ ...bg, from: e.target.value })} />
              </label>
              <Icon name="arrow" size={16} />
              <label className="sw custom" style={{ background: bg.to }} title={t('editor.gradTo')}>
                <input type="color" value={bg.to} onChange={(e) => setBg({ ...bg, to: e.target.value })} />
              </label>
            </div>
            <Slider label={t('editor.angle')} min={0} max={360} value={bg.angle} onChange={(v) => setBg({ ...bg, angle: v })} suffix="°" />
          </>
        )}

        <Slider label={t('editor.padding')} min={0} max={Math.round(Math.max(imgW, imgH) * 0.25)} value={padding} onChange={setPadding} />
        <Slider label={t('editor.cornerRadius')} min={0} max={80} value={radius} onChange={setRadius} />
        <div className="set-row" style={{ marginTop: 8 }}>
          <span>{t('editor.shadow')}</span>
          <div className={`switch ${shadow ? 'on' : ''}`} onClick={() => setShadow((v) => !v)}>
            <div className="knob" />
          </div>
        </div>
        <div className="lbl-row" style={{ marginTop: 10 }}>{t('editor.aspectRatio')}</div>
        <div className="aspect-row">
          {ASPECTS.map((a) => (
            <button key={a.label} className={aspect === a.r ? 'active' : ''} onClick={() => setAspect(a.r)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {textEdit && (
        <textarea
          ref={textRef}
          className="text-overlay"
          value={textEdit.value}
          rows={1}
          placeholder={t('editor.typePlaceholder')}
          style={{
            left: textEdit.sx,
            top: textEdit.sy,
            width: editShape?.boxWidth ? editShape.boxWidth * fit : undefined,
            height: editShape?.boxHeight ? editShape.boxHeight * fit : undefined,
            minWidth: editShape?.boxWidth ? undefined : 120,
            fontSize: Math.max(14, (editShape?.fontSize ?? fontSize) * fit),
            fontWeight: (editShape?.bold ?? bold) ? 700 : 400,
            color: editShape?.color ?? curColor,
            overflow: editShape?.boxHeight ? 'auto' : 'hidden',
            resize: editShape?.boxHeight ? 'both' : editShape?.boxWidth ? 'horizontal' : 'none'
          }}
          onChange={(e) => {
            if (!editShape?.boxHeight) {
              e.currentTarget.style.height = 'auto'
              e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'
            }
            setTextEdit({ ...textEdit, value: e.target.value })
          }}
          onBlur={() => {
            if (textReady.current) commitText()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              const tid = textEdit.id
              setTextEdit(null)
              mutate((s) => s.filter((x) => x.id !== tid))
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              commitText()
            } else if (e.key === 'Enter' && !editShape?.boxWidth && !e.shiftKey) {
              e.preventDefault()
              commitText()
            }
          }}
        />
      )}

      {zoomMode === 'in' && marquee && (
        <div className="ed-zoom-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
      )}

      {loupe && loupePos && (
        <div
          className="ed-loupe"
          style={{
            width: LOUPE_D,
            height: LOUPE_D,
            left: loupePos.sx + 22 + LOUPE_D > window.innerWidth ? loupePos.sx - 22 - LOUPE_D : loupePos.sx + 22,
            top: loupePos.sy + 22 + LOUPE_D > window.innerHeight ? loupePos.sy - 22 - LOUPE_D : loupePos.sy + 22
          }}
        >
          <canvas ref={loupeCanvasRef} width={LOUPE_D} height={LOUPE_D} />
          <div className="ed-loupe-label">{Math.round(loupePos.ipx)}, {Math.round(loupePos.ipy)} · {LOUPE_MAG}×</div>
        </div>
      )}
    </div>
  )
}

function ContrastReadout({ fg, bg }: { fg: string; bg: string }): React.ReactElement {
  const ratio = contrastRatio(fg, bg)
  const r = Math.round(ratio * 10) / 10
  const checks: { label: string; pass: boolean }[] = [
    { label: t('editor.contrastNormalAA'), pass: ratio >= 4.5 },
    { label: t('editor.contrastNormalAAA'), pass: ratio >= 7 },
    { label: t('editor.contrastLargeAA'), pass: ratio >= 3 },
    { label: t('editor.contrastLargeAAA'), pass: ratio >= 4.5 },
    { label: t('editor.contrastUiGraphics'), pass: ratio >= 3 }
  ]
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line, #2a3240)' }}>
          <div style={{ background: bg, color: fg, fontWeight: 700, fontSize: 18, padding: '6px 10px' }}>Aa</div>
          <div style={{ background: fg, color: bg, fontWeight: 700, fontSize: 18, padding: '6px 10px' }}>Aa</div>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{r}:1</div>
          <div className="small muted" style={{ fontFamily: 'monospace' }}>{fg} / {bg}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {checks.map((c) => (
          <div key={c.label} className="small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted">{c.label}</span>
            <span style={{ color: c.pass ? '#34d399' : '#f25555', fontWeight: 700 }}>{c.pass ? t('editor.pass') : t('editor.fail')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Slider({ label, min, max, value, onChange, suffix }: { label: string; min: number; max: number; value: number; onChange: (v: number) => void; suffix?: string }): React.ReactElement {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="lbl-row">{label}</div>
      <div className="slider-row">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="small muted" style={{ width: 38, textAlign: 'right' }}>
          {value}
          {suffix ?? ''}
        </span>
      </div>
    </div>
  )
}

function roundRect(ctx: Konva.Context, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
