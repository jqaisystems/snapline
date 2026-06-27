import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { BeautifyPreset, FrameStyle, Screenshot } from '@shared/types'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import { Modal } from '@ui/hooks'
import { t } from '@ui/i18n'

type BgKind = 'brand' | 'white' | 'dark' | 'gradient'
type Format = 'png' | 'pdf'
type Layout = 'sheet' | 'single' | 'separate'

const PAPERS = {
  letter: { name: 'Letter', pdf: 'Letter', ratio: 11 / 8.5 },
  a4: { name: 'A4', pdf: 'A4', ratio: 297 / 210 }
} as const
type Paper = keyof typeof PAPERS

// Fully resolved drawing options (background already reduced to concrete colors).
interface SheetOpts {
  cols: number
  bgBase: string
  bgGradTo: string | null // null = solid fill
  heading: string
  captions: boolean
  shadow: boolean
  tileRadius: number
  frame: FrameStyle
}

const FONT = '"Inter", "Segoe UI", system-ui, sans-serif'
const OUT_W = 1600
const pageHeight = (paper: Paper): number => Math.round(OUT_W * PAPERS[paper].ratio)
const PAD = 56
const GAP = 28

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0]
}
const isDark = (hex: string): boolean => {
  const [r, g, b] = hexToRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b < 140
}
const brandBase = (brandColors: string[]): string => brandColors[0] ?? '#6f72f1'

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

// Cell geometry for a given column count (shared by layout + pagination).
function cellMetrics(cols: number, captions: boolean): { cellW: number; cellH: number; tileH: number } {
  const innerW = OUT_W - PAD * 2
  const cellW = (innerW - GAP * (cols - 1)) / cols
  const cellH = cellW * 0.66
  const tileH = cellH + (captions ? 30 : 0)
  return { cellW, cellH, tileH }
}

// Draw a browser/dark window frame around the image, fitted (contained) inside (boxX,boxY,boxW,boxH).
// Matches the editor's frame: a title bar with traffic-light dots + an address bar, then the image.
function drawFramedWindow(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  o: SheetOpts
): void {
  const dark = o.frame === 'browser-dark'
  const barH = Math.round(Math.max(18, Math.min(44, boxW * 0.05)))
  const scale = Math.min(boxW / img.naturalWidth, (boxH - barH) / img.naturalHeight)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  const winW = w
  const winH = h + barH
  const wx = boxX + (boxW - winW) / 2
  const wy = boxY + (boxH - winH) / 2
  const radius = Math.max(6, o.tileRadius)

  // window background (also forms the title bar) + shadow
  ctx.save()
  if (o.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.3)'
    ctx.shadowBlur = Math.max(20, barH)
    ctx.shadowOffsetY = Math.max(10, barH * 0.4)
  }
  ctx.fillStyle = dark ? '#202632' : '#e9edf3'
  roundRectPath(ctx, wx, wy, winW, winH, radius)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRectPath(ctx, wx, wy, winW, winH, radius)
  ctx.clip()
  // traffic lights
  const r = Math.max(3, Math.round(barH * 0.13))
  const cy = wy + barH / 2
  ;['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(wx + barH * 0.7 + i * r * 3.2, cy, r, 0, Math.PI * 2)
    ctx.fill()
  })
  // address bar
  const abX = wx + barH * 0.7 + 3 * r * 3.2
  const abW = winW - (abX - wx) - barH * 0.7
  const abH = Math.round(barH * 0.5)
  if (abW > 16) {
    ctx.fillStyle = dark ? '#2a3240' : '#ffffff'
    roundRectPath(ctx, abX, cy - abH / 2, abW, abH, abH / 2)
    ctx.fill()
  }
  // the screenshot, below the bar
  ctx.drawImage(img, wx, wy + barH, w, h)
  ctx.restore()
}

// Draw one page (a slice of items) onto the canvas. fixedH=null => auto height (single tall PNG).
function renderPage(
  canvas: HTMLCanvasElement,
  items: Screenshot[],
  images: Map<string, HTMLImageElement>,
  o: SheetOpts,
  withHeading: boolean,
  fixedH: number | null
): void {
  const cols = Math.max(1, o.cols)
  const { cellW, cellH, tileH } = cellMetrics(cols, o.captions)
  const headH = withHeading && o.heading.trim() ? 84 : 0
  const rows = Math.ceil(items.length / cols) || 1
  const OUT_H = fixedH ?? Math.round(PAD * 2 + headH + rows * tileH + (rows - 1) * GAP)

  canvas.width = OUT_W
  canvas.height = OUT_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // background
  if (o.bgGradTo) {
    const grad = ctx.createLinearGradient(0, 0, OUT_W, OUT_H)
    grad.addColorStop(0, o.bgBase)
    grad.addColorStop(1, o.bgGradTo)
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = o.bgBase
  }
  ctx.fillRect(0, 0, OUT_W, OUT_H)

  const onLight = !isDark(o.bgBase)
  const textColor = onLight ? '#10131a' : '#f6f8fc'
  const subColor = onLight ? 'rgba(16,19,26,0.55)' : 'rgba(246,248,252,0.6)'

  if (headH) {
    ctx.textBaseline = 'top'
    ctx.fillStyle = textColor
    ctx.font = `700 38px ${FONT}`
    ctx.fillText(o.heading.trim(), PAD, PAD + 4)
    ctx.fillStyle = subColor
    ctx.font = `500 18px ${FONT}`
    ctx.fillText(`${items.length} ${items.length === 1 ? t('export.screenshotSingular') : t('export.screenshotPlural')}`, PAD, PAD + 50)
  }

  const imgRadius = Math.max(0, o.tileRadius * 0.5)
  items.forEach((it, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = PAD + c * (cellW + GAP)
    const y = PAD + headH + r * (tileH + GAP)

    const img = images.get(it.id)
    if (o.frame !== 'none' && img && img.naturalWidth > 0) {
      drawFramedWindow(ctx, img, x, y, cellW, cellH, o)
    } else {
      ctx.save()
      if (o.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.28)'
        ctx.shadowBlur = 28
        ctx.shadowOffsetY = 12
      }
      ctx.fillStyle = '#ffffff'
      roundRectPath(ctx, x, y, cellW, cellH, o.tileRadius)
      ctx.fill()
      ctx.restore()

      if (img && img.naturalWidth > 0) {
        const inset = 12
        const boxW = cellW - inset * 2
        const boxH = cellH - inset * 2
        const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight)
        const w = img.naturalWidth * scale
        const h = img.naturalHeight * scale
        const ix = x + (cellW - w) / 2
        const iy = y + (cellH - h) / 2
        ctx.save()
        roundRectPath(ctx, ix, iy, w, h, imgRadius)
        ctx.clip()
        ctx.drawImage(img, ix, iy, w, h)
        ctx.restore()
      }
    }

    if (o.captions) {
      ctx.textBaseline = 'top'
      ctx.fillStyle = onLight ? 'rgba(16,19,26,0.78)' : 'rgba(246,248,252,0.85)'
      ctx.font = `500 17px ${FONT}`
      ctx.fillText(ellipsize(ctx, it.aiName ?? it.fileName, cellW - 4), x + 2, y + cellH + 7)
    }
  })
}

// Draw one screenshot filling its own page (the "One per page" layout). Matches the sheet style:
// chosen background, white card + shadow + rounded corners, name as a caption, optional title header.
function renderFullPage(
  canvas: HTMLCanvasElement,
  item: Screenshot,
  images: Map<string, HTMLImageElement>,
  o: SheetOpts,
  paperH: number
): void {
  canvas.width = OUT_W
  canvas.height = paperH
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // background
  if (o.bgGradTo) {
    const grad = ctx.createLinearGradient(0, 0, OUT_W, paperH)
    grad.addColorStop(0, o.bgBase)
    grad.addColorStop(1, o.bgGradTo)
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = o.bgBase
  }
  ctx.fillRect(0, 0, OUT_W, paperH)

  const onLight = !isDark(o.bgBase)
  const textColor = onLight ? '#10131a' : '#f6f8fc'
  const pad = 90
  const headH = o.heading.trim() ? 60 : 0
  const capH = o.captions ? 48 : 0

  if (headH) {
    ctx.textBaseline = 'top'
    ctx.fillStyle = textColor
    ctx.font = `600 30px ${FONT}`
    ctx.fillText(ellipsize(ctx, o.heading.trim(), OUT_W - pad * 2), pad, pad - 30)
  }

  // content box for the image (between header and caption)
  const top = pad + headH
  const boxW = OUT_W - pad * 2
  const boxH = paperH - top - pad - capH
  const img = images.get(item.id)
  if (img && img.naturalWidth > 0 && boxW > 0 && boxH > 0) {
    if (o.frame !== 'none') {
      drawFramedWindow(ctx, img, pad, top, boxW, boxH, o)
    } else {
      const inset = 18
      const scale = Math.min((boxW - inset * 2) / img.naturalWidth, (boxH - inset * 2) / img.naturalHeight)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      const ix = (OUT_W - w) / 2
      const iy = top + (boxH - h) / 2

      // white card sized to the contained image
      ctx.save()
      if (o.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.3)'
        ctx.shadowBlur = 40
        ctx.shadowOffsetY = 18
      }
      ctx.fillStyle = '#ffffff'
      roundRectPath(ctx, ix - inset, iy - inset, w + inset * 2, h + inset * 2, o.tileRadius)
      ctx.fill()
      ctx.restore()

      ctx.save()
      roundRectPath(ctx, ix, iy, w, h, Math.max(0, o.tileRadius * 0.5))
      ctx.clip()
      ctx.drawImage(img, ix, iy, w, h)
      ctx.restore()
    }
  }

  if (o.captions) {
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'center'
    ctx.fillStyle = onLight ? 'rgba(16,19,26,0.8)' : 'rgba(246,248,252,0.86)'
    ctx.font = `500 22px ${FONT}`
    ctx.fillText(ellipsize(ctx, item.aiName ?? item.fileName, OUT_W - pad * 2), OUT_W / 2, paperH - pad + 14)
    ctx.textAlign = 'left'
  }
}

// Split items across pages (first page reserves room for the heading).
function paginate(items: Screenshot[], o: SheetOpts, paperH: number): Screenshot[][] {
  const cols = Math.max(1, o.cols)
  const { tileH } = cellMetrics(cols, o.captions)
  const headH = o.heading.trim() ? 84 : 0
  const rowsFor = (top: number): number => Math.max(1, Math.floor((paperH - PAD * 2 - top + GAP) / (tileH + GAP)))
  const per1 = rowsFor(headH) * cols
  const perN = rowsFor(0) * cols
  const out: Screenshot[][] = [items.slice(0, per1)]
  let idx = per1
  while (idx < items.length) {
    out.push(items.slice(idx, idx + perN))
    idx += perN
  }
  return out.filter((s) => s.length > 0)
}

const sanitize = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || 'snapline-sheet'

export function ExportSheetModal({
  items,
  brandColors,
  presets,
  title,
  onClose
}: {
  items: Screenshot[]
  brandColors: string[]
  presets: BeautifyPreset[]
  title: string
  onClose: () => void
}): React.ReactElement {
  const [layout, setLayout] = useState<Layout>('sheet')
  const [format, setFormat] = useState<Format>('png')
  const [paper, setPaper] = useState<Paper>('letter')
  const [cols, setCols] = useState(items.length <= 2 ? Math.max(1, items.length) : 3)
  const [bgKind, setBgKind] = useState<BgKind>(brandColors.length ? 'brand' : 'dark')
  const [presetId, setPresetId] = useState<string | null>(null)
  const [heading, setHeading] = useState(title)
  const [captions, setCaptions] = useState(true)
  const [shadow, setShadow] = useState(true)
  const [tileRadius, setTileRadius] = useState(14)
  const [frame, setFrame] = useState<FrameStyle>('none')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map())

  // Resolve the high-level background choice into concrete colors.
  const resolved: SheetOpts = useMemo(() => {
    let bgBase = brandBase(brandColors)
    let bgGradTo: string | null = null
    const preset = presetId ? presets.find((p) => p.id === presetId) : null
    if (preset) {
      if (preset.bg.type === 'solid') bgBase = preset.bg.color
      else if (preset.bg.type === 'gradient') {
        bgBase = preset.bg.from
        bgGradTo = preset.bg.to
      } else bgBase = '#ffffff'
    } else if (bgKind === 'white') bgBase = '#ffffff'
    else if (bgKind === 'dark') bgBase = '#0f1115'
    else if (bgKind === 'gradient') bgGradTo = brandColors[1] ?? '#a855f7'
    return { cols, bgBase, bgGradTo, heading, captions, shadow, tileRadius, frame }
  }, [brandColors, presetId, presets, bgKind, cols, heading, captions, shadow, tileRadius, frame])

  // "One per page" and "Separate files" are inherently PDF; PNG only applies to the contact sheet.
  const effFormat: Format = layout === 'sheet' ? format : 'pdf'
  const perItem = layout === 'single' || layout === 'separate'
  const paperH = pageHeight(paper)
  const pages = useMemo(() => {
    if (perItem) return items.map((it) => [it])
    return effFormat === 'pdf' ? paginate(items, resolved, paperH) : [items]
  }, [perItem, effFormat, items, resolved, paperH])
  const pageCount = pages.length

  // load all source images once
  useEffect(() => {
    let alive = true
    const map = new Map<string, HTMLImageElement>()
    Promise.all(
      items.map(
        (it) =>
          new Promise<void>((res) => {
            const im = new window.Image()
            im.onload = () => {
              map.set(it.id, im)
              res()
            }
            im.onerror = () => res()
            im.src = `${api.fileUrl(it.filePath)}?v=${it.bytes}`
          })
      )
    ).then(() => {
      if (alive) {
        imagesRef.current = map
        setReady(true)
      }
    })
    return () => {
      alive = false
    }
  }, [items])

  // redraw the preview (page 1) whenever options change
  useEffect(() => {
    if (!ready || !canvasRef.current) return
    if (perItem) {
      const first = pages[0]?.[0]
      if (first) renderFullPage(canvasRef.current, first, imagesRef.current, resolved, paperH)
    } else {
      renderPage(canvasRef.current, pages[0] ?? [], imagesRef.current, resolved, true, effFormat === 'pdf' ? paperH : null)
    }
  }, [ready, pages, resolved, perItem, effFormat, paperH])

  function applyPreset(id: string): void {
    setPresetId(id || null)
    const p = presets.find((x) => x.id === id)
    if (p) {
      setShadow(p.shadow)
      setTileRadius(p.radius || 14)
      setFrame(p.frame)
    }
  }

  async function save(): Promise<void> {
    if (saving || !ready || items.length === 0) return
    setSaving(true)
    try {
      const name = sanitize(heading || 'snapline-sheet')
      if (layout === 'separate') {
        const files = items.map((it) => {
          const c = document.createElement('canvas')
          renderFullPage(c, it, imagesRef.current, resolved, paperH)
          return { dataUrl: c.toDataURL('image/png'), name: it.aiName ?? it.fileName }
        })
        const r = await api.exportPdfBatch(files, PAPERS[paper].pdf)
        if (r.ok) {
          const n = r.count ?? files.length
          api.toast(n === 1 ? t('export.exportedPdf') : t('export.exportedPdfs', { n }))
          onClose()
        }
      } else if (effFormat === 'pdf') {
        const urls = pages.map((slice, i) => {
          const c = document.createElement('canvas')
          if (layout === 'single') renderFullPage(c, slice[0], imagesRef.current, resolved, paperH)
          else renderPage(c, slice, imagesRef.current, resolved, i === 0, paperH)
          return c.toDataURL('image/png')
        })
        const r = await api.exportPdf(urls, name + '.pdf', PAPERS[paper].pdf)
        if (r.ok) {
          api.toast(t('export.pdfExported'))
          onClose()
        }
      } else {
        const c = canvasRef.current
        if (!c) return
        const r = await api.exportImage(c.toDataURL('image/png'), name + '.png')
        if (r.ok) {
          api.toast(t('export.sheetExported'))
          onClose()
        }
      }
    } catch {
      api.toast(t('export.exportFailed'))
    } finally {
      setSaving(false)
    }
  }

  const bgOpts: { k: BgKind; label: string }[] = [
    { k: 'brand', label: t('export.bgBrand') },
    { k: 'white', label: t('export.bgWhite') },
    { k: 'dark', label: t('export.bgDark') },
    { k: 'gradient', label: t('export.bgGradient') }
  ]

  return (
    <Modal onClose={onClose} className="wide">
      <h2>{t('export.title')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        {layout === 'separate'
          ? t('export.descSeparate')
          : layout === 'single'
            ? t('export.descSingle')
            : effFormat === 'pdf'
              ? t('export.descSheetPdf')
              : t('export.descSheet')}{' '}
        {t('export.ofScreenshotsReady', { n: items.length })}
      </p>
      <div className="export-body">
        <div className="export-preview">
          {ready ? (
            <canvas ref={canvasRef} className="export-canvas" />
          ) : (
            <div className="empty" style={{ height: 280 }}>
              <Icon name="image" size={24} className="spin" />
            </div>
          )}
        </div>
        <div className="export-opts">
          <label className="field-label">{t('export.layout')}</label>
          <div className="seg">
            {([['sheet', t('export.layoutSheet')], ['single', t('export.layoutSingle')], ['separate', t('export.layoutSeparate')]] as [Layout, string][]).map(([l, label]) => (
              <button key={l} className={layout === l ? 'active' : ''} onClick={() => setLayout(l)}>
                {label}
              </button>
            ))}
          </div>
          {layout === 'single' && <div className="small muted" style={{ marginTop: 6 }}>{t('export.singleHint')}</div>}
          {layout === 'separate' && <div className="small muted" style={{ marginTop: 6 }}>{t('export.separateHint')}</div>}

          <label className="field-label" style={{ marginTop: 14 }}>{t('export.format')}</label>
          <div className="seg">
            {(['png', 'pdf'] as Format[]).map((f) => (
              <button
                key={f}
                className={effFormat === f ? 'active' : ''}
                disabled={layout !== 'sheet' && f === 'png'}
                onClick={() => setFormat(f)}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {layout !== 'sheet' && <div className="small muted" style={{ marginTop: 6 }}>{layout === 'separate' ? t('export.separateAlwaysPdf') : t('export.singleAlwaysPdf')}</div>}

          {effFormat === 'pdf' && (
            <>
              <label className="field-label" style={{ marginTop: 14 }}>{t('export.paper')}</label>
              <div className="seg">
                {(Object.keys(PAPERS) as Paper[]).map((p) => (
                  <button key={p} className={paper === p ? 'active' : ''} onClick={() => setPaper(p)}>
                    {PAPERS[p].name}
                  </button>
                ))}
              </div>
              <div className="small muted" style={{ marginTop: 6 }}>
                {layout === 'separate'
                  ? `${items.length} ${items.length === 1 ? t('export.pdfFileSingular') : t('export.pdfFilePlural')} · ${PAPERS[paper].name}`
                  : `${pageCount} ${PAPERS[paper].name} ${pageCount === 1 ? t('export.pageSingular') : t('export.pagePlural')}`}
              </div>
            </>
          )}

          <label className="field-label" style={{ marginTop: 14 }}>{t('export.titleLabel')}</label>
          <input className="input" value={heading} onChange={(e) => setHeading(e.target.value)} placeholder={t('export.sheetTitlePlaceholder')} />

          {layout === 'sheet' && (
            <>
              <label className="field-label" style={{ marginTop: 14 }}>{t('export.columns')}</label>
              <div className="seg">
                {[2, 3, 4].map((n) => (
                  <button key={n} className={cols === n ? 'active' : ''} onClick={() => setCols(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}

          {presets.length > 0 && (
            <>
              <label className="field-label" style={{ marginTop: 14 }}>{t('export.matchSavedStyle')}</label>
              <select className="select" style={{ width: '100%' }} value={presetId ?? ''} onChange={(e) => applyPreset(e.target.value)}>
                <option value="">{t('export.presetNone')}</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="field-label" style={{ marginTop: 14 }}>{t('export.background')}</label>
          <div className="seg">
            {bgOpts.map((b) => (
              <button
                key={b.k}
                className={!presetId && bgKind === b.k ? 'active' : ''}
                onClick={() => {
                  setPresetId(null)
                  setBgKind(b.k)
                }}
              >
                {b.label}
              </button>
            ))}
          </div>

          <label className="field-label" style={{ marginTop: 14 }}>{t('export.frame')}</label>
          <div className="seg">
            {([['none', t('export.frameNone')], ['browser-light', t('export.frameBrowser')], ['browser-dark', t('export.frameDark')]] as [FrameStyle, string][]).map(([f, label]) => (
              <button key={f} className={frame === f ? 'active' : ''} onClick={() => setFrame(f)}>
                {label}
              </button>
            ))}
          </div>

          <label className="export-check" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> {t('export.showCaptions')}
          </label>
          <label className="export-check">
            <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} /> {t('export.cardShadows')}
          </label>
        </div>
      </div>
      <div className="row">
        <button className="btn ghost" onClick={onClose}>
          {t('export.cancel')}
        </button>
        <button className="btn primary" onClick={save} disabled={!ready || saving || items.length === 0}>
          <Icon name="download" size={15} /> {saving ? t('export.saving') : layout === 'separate' ? t('export.savePdfs') : effFormat === 'pdf' ? t('export.savePdf') : t('export.savePng')}
        </button>
      </div>
    </Modal>
  )
}
