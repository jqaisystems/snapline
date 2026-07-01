import React, { useEffect, useRef, useState } from 'react'
import type { Screenshot } from '@shared/types'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import { t } from '@ui/i18n'
import { setDragId } from './Sidebar'

const MIN_CARD = 190
const GAP = 14
const PAD = 16
const CARD_H = 178 // thumb (132) + meta (46)
const ROW_H = CARD_H + GAP

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return t('grid.justNow')
  if (m < 60) return t('grid.minutesAgo', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('grid.hoursAgo', { h })
  const days = Math.floor(h / 24)
  if (days < 30) return t('grid.daysAgo', { d: days })
  return new Date(ts).toLocaleDateString()
}

interface Props {
  items: Screenshot[]
  selectedIds: Set<string>
  focusedId: string | null
  onCardClick: (e: React.MouseEvent, id: string) => void
  onCardDouble: (id: string) => void
  onCardContext: (e: React.MouseEvent, id: string) => void
  onCols: (cols: number) => void
  onDropFiles: (e: React.DragEvent) => void
  emptyHint: string
}

// Virtualized, multi-select thumbnail grid. Only rows in view are rendered, so very large
// libraries stay smooth.
export default function Grid({ items, selectedIds, focusedId, onCardClick, onCardDouble, onCardContext, onCols, onDropFiles, emptyHint }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setSize({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => ro.disconnect()
  }, [])

  const cols = Math.max(1, Math.floor((size.w - PAD * 2 + GAP) / (MIN_CARD + GAP)))
  useEffect(() => onCols(cols), [cols, onCols])

  const cardW = cols > 0 && size.w > 0 ? (size.w - PAD * 2 - GAP * (cols - 1)) / cols : MIN_CARD
  const rows = Math.ceil(items.length / cols)
  const totalH = rows * ROW_H + PAD * 2
  const overscan = 2
  const startRow = Math.max(0, Math.floor((scrollTop - PAD) / ROW_H) - overscan)
  const endRow = Math.min(rows, Math.ceil((scrollTop - PAD + size.h) / ROW_H) + overscan)

  const visible: { s: Screenshot; top: number; left: number }[] = []
  for (let r = startRow; r < endRow; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (idx >= items.length) break
      visible.push({ s: items[idx], top: PAD + r * ROW_H, left: PAD + c * (cardW + GAP) })
    }
  }

  return (
    <div
      className="grid-scroll"
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropFiles}
    >
      {items.length === 0 ? (
        <div className="empty">
          <div className="ic">
            <Icon name="image" size={28} />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{t('grid.nothingHere')}</div>
            <div className="small">{emptyHint}</div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', height: totalH }}>
          {visible.map(({ s, top, left }) => (
            <div
              key={s.id}
              className={`card ${selectedIds.has(s.id) ? 'selected' : ''} ${focusedId === s.id ? 'focused' : ''}`}
              style={{ position: 'absolute', top, left, width: cardW, height: CARD_H }}
              onClick={(e) => onCardClick(e, s.id)}
              onDoubleClick={() => onCardDouble(s.id)}
              onContextMenu={(e) => onCardContext(e, s.id)}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragEnd={() => setDragId(null)}
            >
              <div className="thumb">
                {/* Video has a poster (thumbPath); an <img> can't render the .webm itself. */}
                <img src={`${api.fileUrl(s.isVideo ? (s.thumbPath ?? '') : (s.thumbPath ?? s.filePath))}?v=${s.bytes}`} loading="lazy" alt="" />
                {s.isVideo && (
                  <div className="video-play" title={t('grid.video')}>
                    <Icon name="play" size={26} />
                  </div>
                )}
                <div className="badge">
                  {selectedIds.has(s.id) && (
                    <span title={t('grid.selected')} style={{ background: 'var(--accent)' }}>
                      <Icon name="check" size={13} />
                    </span>
                  )}
                  {s.favorite && (
                    <span title={t('grid.favorite')}>
                      <Icon name="star" size={13} />
                    </span>
                  )}
                  {s.aiStatus === 'pending' && (
                    <span title={t('grid.analyzing')}>
                      <Icon name="sparkles" size={13} className="spin" />
                    </span>
                  )}
                </div>
              </div>
              <div className="meta">
                <div className="ttl">{s.aiName ?? s.fileName}</div>
                <div className="sub">{timeAgo(s.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
