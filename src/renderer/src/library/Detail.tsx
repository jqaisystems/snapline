import React, { useState } from 'react'
import type { LibrarySnapshot, Screenshot } from '@shared/types'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import { Modal, showActionToast } from '@ui/hooks'
import { t } from '@ui/i18n'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  snap: LibrarySnapshot
  shot: Screenshot
  onClose: () => void
}

export default function Detail({ snap, shot, onClose }: Props): React.ReactElement {
  const [tagInput, setTagInput] = useState('')
  const [confirming, setConfirming] = useState(false)
  const project = snap.projects.find((p) => p.id === shot.projectId)
  const tags = shot.tagIds.map((id) => snap.tags.find((t) => t.id === id)).filter(Boolean)

  async function addTag(): Promise<void> {
    const name = tagInput.trim()
    if (!name) return
    const tag = await api.createTag({ name })
    if (!shot.tagIds.includes(tag.id)) {
      await api.setScreenshotTags(shot.id, [...shot.tagIds, tag.id])
    }
    setTagInput('')
  }
  function removeTag(tagId: string): void {
    api.setScreenshotTags(shot.id, shot.tagIds.filter((t) => t !== tagId))
  }

  return (
    <>
    <div className="detail">
      <div className="detail-head">
        <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {shot.aiName ?? shot.fileName}
        </strong>
        <button className="icon-btn" onClick={onClose} title={t('detail.close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="detail-scroll">
        <img className="detail-img" src={`${api.fileUrl(shot.filePath)}?v=${shot.bytes}`} alt="" />

        <div className="detail-actions">
          <button className="btn sm" onClick={() => api.openEditor(shot.id)}>
            <Icon name="edit" size={15} /> {t('detail.edit')}
          </button>
          <button
            className="btn sm"
            onClick={() => {
              api.copyScreenshotToClipboard(shot.id)
              api.toast(t('detail.copiedToClipboard'))
            }}
          >
            <Icon name="copy" size={15} /> {t('detail.copy')}
          </button>
          <button className="btn sm" onClick={() => api.pinScreenshot(shot.id)}>
            <Icon name="pin" size={15} /> {t('detail.pin')}
          </button>
          <button className="btn sm" onClick={() => api.revealScreenshot(shot.id)}>
            <Icon name="reveal" size={15} /> {t('detail.reveal')}
          </button>
          <button className={`btn sm ${shot.favorite ? 'primary' : ''}`} onClick={() => api.toggleFavorite(shot.id)}>
            <Icon name="star" size={15} /> {shot.favorite ? t('detail.favorited') : t('detail.favorite')}
          </button>
          <button className="btn sm danger" onClick={() => setConfirming(true)}>
            <Icon name="trash" size={15} /> {t('detail.delete')}
          </button>
        </div>

        <div className="section-title">{t('detail.project')}</div>
        <select
          className="select"
          value={shot.projectId ?? ''}
          onChange={(e) => api.moveScreenshot(shot.id, e.target.value || null)}
        >
          <option value="">{t('detail.unfiled')}</option>
          {snap.projects.filter((p) => !p.archived).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="section-title">{t('detail.tags')}</div>
        <div className="tag-row">
          {tags.map((t) => (
            <span className="tag-chip" key={t!.id}>
              <span className="proj-dot" style={{ background: t!.color, borderRadius: '50%', width: 8, height: 8 }} />
              {t!.name}
              <button onClick={() => removeTag(t!.id)}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
        <input
          className="input"
          style={{ marginTop: 8 }}
          placeholder={t('detail.addTagPlaceholder')}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addTag()
          }}
        />

        {shot.aiDescription && (
          <>
            <div className="section-title">{t('detail.whatsInThis')}</div>
            <div className="ai-desc">
              <span style={{ color: 'var(--accent)', flex: 'none' }}>
                <Icon name="sparkles" size={15} />
              </span>
              <span>{shot.aiDescription}</span>
            </div>
          </>
        )}

        {shot.ocrText && (
          <>
            <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('detail.extractedText')}</span>
              <button
                className="icon-btn"
                style={{ width: 24, height: 20 }}
                title={t('detail.copyText')}
                onClick={() => {
                  api.copyOcrText(shot.id)
                  api.toast(t('detail.textCopied'))
                }}
              >
                <Icon name="copy" size={13} />
              </button>
            </div>
            <div className="ocr-box">{shot.ocrText}</div>
          </>
        )}

        <div className="section-title">{t('detail.details')}</div>
        <div className="kv">
          <span className="k">{t('detail.project')}</span>
          <span>{project?.name ?? t('detail.unfiled')}</span>
        </div>
        <div className="kv">
          <span className="k">{t('detail.dimensions')}</span>
          <span>
            {shot.width} × {shot.height}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('detail.size')}</span>
          <span>{fmtBytes(shot.bytes)}</span>
        </div>
        <div className="kv">
          <span className="k">{t('detail.mode')}</span>
          <span style={{ textTransform: 'capitalize' }}>{shot.captureMode}</span>
        </div>
        <div className="kv">
          <span className="k">{t('detail.captured')}</span>
          <span>{new Date(shot.createdAt).toLocaleString()}</span>
        </div>

        <div className="section-title">{t('detail.fileLocation')}</div>
        <div className="ocr-box" style={{ maxHeight: 'none', fontFamily: 'ui-monospace, monospace' }}>{shot.filePath}</div>

        {snap.settings.aiEnabled && snap.settings.hasApiKey && (
          <button className="btn sm" style={{ width: '100%', marginTop: 14, justifyContent: 'center' }} onClick={() => api.enrichScreenshot(shot.id)}>
            <Icon name="sparkles" size={15} /> {t('detail.reanalyze')}
          </button>
        )}
      </div>
    </div>
    {confirming && (
      <Modal onClose={() => setConfirming(false)}>
        <h2>{t('detail.deleteTitle')}</h2>
        <p className="muted" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shot.aiName ?? shot.fileName}</p>
        <p className="small muted">{t('detail.deleteHelp')}</p>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn ghost" onClick={() => setConfirming(false)}>
            {t('detail.cancel')}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                api.deleteScreenshot(shot.id, { deleteFile: false })
                setConfirming(false)
                onClose()
              }}
            >
              {t('detail.removeFromSnapline')}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                api.deleteScreenshot(shot.id, { deleteFile: true })
                showActionToast(t('trash.movedOne'), t('trash.undo'), () => api.restoreTrashed(shot.id))
                setConfirming(false)
                onClose()
              }}
            >
              {t('trash.moveToTrash')}
            </button>
          </div>
        </div>
      </Modal>
    )}
    </>
  )
}
