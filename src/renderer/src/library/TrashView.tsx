import React, { useState } from 'react'
import type { TrashedScreenshot } from '@shared/types'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import { Modal } from '@ui/hooks'
import { t } from '@ui/i18n'

function deletedAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return t('grid.justNow')
  if (m < 60) return t('grid.minutesAgo', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('grid.hoursAgo', { h })
  const days = Math.floor(h / 24)
  if (days < 30) return t('grid.daysAgo', { d: days })
  return new Date(ts).toLocaleDateString()
}

interface Props {
  trash: TrashedScreenshot[]
  retentionDays: number
}

// Recoverable trash. Files live in .snapline-trash on disk until restored,
// permanently deleted, or auto-purged after the retention window.
export default function TrashView({ trash, retentionDays }: Props): React.ReactElement {
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  return (
    <div className="main">
      <div className="toolbar2">
        <Icon name="trash" size={15} />
        <span>{t('view.recentlyDeleted')}</span>
        <span className="muted">
          {retentionDays > 0 ? t('trash.retentionNote', { days: retentionDays }) : t('trash.retentionForever')}
        </span>
        <div className="spacer" />
        {trash.length > 0 && (
          <button className="btn sm danger" onClick={() => setConfirmEmpty(true)}>
            <Icon name="trash" size={14} /> {t('trash.emptyTrash')}
          </button>
        )}
      </div>

      <div className="grid-scroll">
        {trash.length === 0 ? (
          <div className="empty">
            <div className="ic">
              <Icon name="trash" size={28} />
            </div>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{t('trash.empty')}</div>
              <div className="small">{t('trash.emptyHint')}</div>
            </div>
          </div>
        ) : (
          <div className="grid" style={{ padding: 16 }}>
            {trash.map(({ screenshot: s, deletedAt }) => (
              <div key={s.id} className="card" style={{ cursor: 'default' }}>
                <div className="thumb">
                  <img src={`${api.fileUrl(s.thumbPath ?? s.filePath)}?v=${s.bytes}`} loading="lazy" alt="" />
                </div>
                <div className="meta">
                  <div className="ttl">{s.aiName ?? s.fileName}</div>
                  <div className="sub">{t('trash.deletedAgo', { ago: deletedAgo(deletedAt) })}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className="btn sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => api.restoreTrashed(s.id)}>
                      <Icon name="reveal" size={13} /> {t('trash.restore')}
                    </button>
                    <button className="icon-btn" title={t('trash.deleteForever')} onClick={() => api.deleteTrashedPermanently(s.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmEmpty && (
        <Modal onClose={() => setConfirmEmpty(false)}>
          <h2>{t('trash.emptyConfirmTitle')}</h2>
          <p className="small muted">{t('trash.emptyConfirmHelp', { n: trash.length })}</p>
          <div className="row">
            <button className="btn ghost" onClick={() => setConfirmEmpty(false)}>
              {t('trash.cancel')}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                api.emptyTrash()
                setConfirmEmpty(false)
              }}
            >
              {t('trash.emptyTrash')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
