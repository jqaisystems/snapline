import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, ProjectPalette as ProjectPaletteData } from '@shared/types'
import { api, applyTheme } from '@ui/api'
import { Icon } from '@ui/icons'
import { t, setLocale } from '@ui/i18n'
import { ToastHost, useSnapshot, Modal, showActionToast } from '@ui/hooks'
import Sidebar from './Sidebar'
import Grid from './Grid'
import Detail from './Detail'
import Settings from './Settings'
import Onboarding from './Onboarding'
import TrashView from './TrashView'
import { ExportSheetModal } from './ExportSheet'
import { type SortMode, type View, viewToQuery, viewTitle } from './state'
import './library.css'

const PALETTE = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6']

function useDebounce<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function App(): React.ReactElement {
  const snap = useSnapshot()
  const [view, setView] = useState<View>({ type: 'all' })
  const [text, setText] = useState('')
  const [sort, setSort] = useState<SortMode>('newest')
  const [ids, setIds] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [bulkDelete, setBulkDelete] = useState(false)
  const [bulkTag, setBulkTag] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectModal, setProjectModal] = useState<{ mode: 'create' | 'rename'; project?: Project } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [moveTarget, setMoveTarget] = useState<Project | null>(null)
  const [exportItems, setExportItems] = useState<string[] | null>(null)
  const [activeMenu, setActiveMenu] = useState(false)
  const [recordMenu, setRecordMenu] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const anchorRef = useRef<string | null>(null)
  const colsRef = useRef(1)

  const debounced = useDebounce(text, 160)

  useEffect(() => {
    if (!snap) return
    if (view.type === 'trash') {
      setIds([]) // trash is rendered from snapshot.trash, not the search index
      return
    }
    api.search(viewToQuery(view, debounced, sort)).then(setIds)
  }, [snap, view, debounced, sort])

  // Keep the UI theme in sync with settings. Skip while the snapshot is still loading:
  // initThemeFromCache() already applied the cached theme before first paint, so calling
  // applyTheme(undefined) here would flash dark over a cached light theme.
  useEffect(() => {
    if (snap) applyTheme(snap.settings.theme)
  }, [snap?.settings.theme])

  // Keyboard: arrows to move focus, Ctrl+A select all, Delete, Enter to edit, Esc to clear.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (ids.length === 0) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(ids))
        return
      }
      if (e.key === 'Escape') {
        setSelectedIds(new Set())
        setFocusedId(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          e.preventDefault()
          setBulkDelete(true)
        }
        return
      }
      if (e.key === 'Enter' && focusedId) {
        api.openEditor(focusedId)
        return
      }
      const delta: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: colsRef.current, ArrowUp: -colsRef.current }
      if (e.key in delta) {
        e.preventDefault()
        const cur = focusedId ? ids.indexOf(focusedId) : -1
        const next = Math.max(0, Math.min(ids.length - 1, (cur < 0 ? 0 : cur) + delta[e.key]))
        const nid = ids[next]
        setFocusedId(nid)
        if (e.shiftKey) setSelectedIds((prev) => new Set(prev).add(nid))
        else {
          setSelectedIds(new Set([nid]))
          anchorRef.current = nid
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids, selectedIds, focusedId])

  const byId = useMemo(() => {
    const m = new Map<string, NonNullable<typeof snap>['screenshots'][number]>()
    snap?.screenshots.forEach((s) => m.set(s.id, s))
    return m
  }, [snap])

  // Signature that changes when the project's screenshot set changes, so the palette refetches.
  // Must run before the early returns below to keep hook order stable.
  const projectSig = useMemo(() => {
    if (view.type !== 'project' || !snap) return ''
    const shots = snap.screenshots.filter((s) => s.projectId === view.id)
    return `${shots.length}:${shots.reduce((m, s) => Math.max(m, s.createdAt), 0)}:${shots.reduce((m, s) => m + s.bytes, 0)}`
  }, [snap, view])

  if (!snap) {
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <Icon name="region" size={26} className="spin" />
      </div>
    )
  }
  setLocale(snap.settings.locale)
  if (!snap.settings.onboarded) return <Onboarding />

  const items = ids.map((id) => byId.get(id)!).filter(Boolean)
  const detailId = selectedIds.size === 1 ? [...selectedIds][0] : null
  const selected = detailId ? byId.get(detailId) ?? null : null
  const activeProject = snap.projects.find((p) => p.id === snap.settings.activeProjectId)
  const activeDir = snap.settings.storageRoot
    ? `${snap.settings.storageRoot}\\${activeProject ? activeProject.folderName : '_Unfiled'}`
    : 'No storage folder set'
  const projectName = view.type === 'project' ? snap.projects.find((p) => p.id === view.id)?.name : undefined
  const tagName = view.type === 'tag' ? snap.tags.find((t) => t.id === view.id)?.name : undefined

  function importDropped(e: React.DragEvent): void {
    e.preventDefault()
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as unknown as { path: string }).path)
      .filter(Boolean)
    if (paths.length === 0) return
    const target = view.type === 'project' ? view.id : null
    api.importFiles(paths, target)
    api.toast(t('app.importing', { n: paths.length }))
  }

  function handleCardClick(e: React.MouseEvent, id: string): void {
    setFocusedId(id)
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const n = new Set(prev)
        n.has(id) ? n.delete(id) : n.add(id)
        return n
      })
      anchorRef.current = id
    } else if (e.shiftKey && anchorRef.current) {
      const a = ids.indexOf(anchorRef.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelectedIds(new Set(ids.slice(lo, hi + 1)))
      }
    } else {
      setSelectedIds(new Set([id]))
      anchorRef.current = id
    }
  }

  function handleCardContext(e: React.MouseEvent, id: string): void {
    e.preventDefault()
    // Don't disturb an existing multi-selection that already includes this card.
    if (!selectedIds.has(id)) {
      setSelectedIds(new Set([id]))
      setFocusedId(id)
      anchorRef.current = id
    }
    // Clamp so the menu stays on-screen near the right/bottom edge.
    const MENU_W = 220
    const MENU_H = 280
    const x = Math.min(e.clientX, window.innerWidth - MENU_W)
    const y = Math.min(e.clientY, window.innerHeight - MENU_H)
    setCtxMenu({ x: Math.max(8, x), y: Math.max(8, y), id })
  }

  function bulkMove(projectId: string | null): void {
    selectedIds.forEach((id) => api.moveScreenshot(id, projectId))
    api.toast(t('app.moved', { n: selectedIds.size }))
  }
  function bulkFavorite(): void {
    selectedIds.forEach((id) => {
      const s = byId.get(id)
      if (s && !s.favorite) api.toggleFavorite(id)
    })
  }
  async function bulkAddTag(): Promise<void> {
    const name = bulkTag.trim()
    if (!name) return
    const tag = await api.createTag({ name })
    for (const id of selectedIds) {
      const s = byId.get(id)
      if (s && !s.tagIds.includes(tag.id)) await api.setScreenshotTags(id, [...s.tagIds, tag.id])
    }
    setBulkTag('')
  }
  // Export a contact sheet. Uses the current multi-selection if there is one, else the whole
  // view. Videos can't go in an image sheet, so they're excluded.
  function openExport(): void {
    const base = selectedIds.size >= 2 ? ids.filter((id) => selectedIds.has(id)) : ids
    const list = base.filter((id) => !byId.get(id)?.isVideo)
    if (list.length === 0) return
    setExportItems(list)
  }
  function bulkDeleteDo(deleteFile: boolean): void {
    const ids = [...selectedIds]
    const n = ids.length
    ids.forEach((id) => api.deleteScreenshot(id, { deleteFile }))
    setSelectedIds(new Set())
    setBulkDelete(false)
    if (deleteFile) {
      // Trashed: offer a one-tap undo that restores the whole batch.
      showActionToast(t('trash.movedMany', { n }), t('trash.undo'), () => ids.forEach((id) => api.restoreTrashed(id)))
    } else {
      api.toast(t('app.deleted', { n }))
    }
  }

  return (
    <div className={`app ${selected ? 'with-detail' : ''}`}>
      <Sidebar
        snap={snap}
        view={view}
        onView={(v) => {
          setView(v)
          setSelectedIds(new Set())
          setFocusedId(null)
          // Selecting a project (or Unfiled) also makes it the capture target, so the user
          // doesn't have to set it active separately. Other views aren't capture targets,
          // so browsing them leaves the active project unchanged.
          if (v.type === 'project' && snap.settings.activeProjectId !== v.id) {
            api.setActiveProject(v.id)
          } else if (v.type === 'unfiled' && snap.settings.activeProjectId !== null) {
            api.setActiveProject(null)
          }
        }}
        onNewProject={() => setProjectModal({ mode: 'create' })}
        onRenameProject={(p) => setProjectModal({ mode: 'rename', project: p })}
        onDeleteProject={(p) => setDeleteTarget(p)}
        onMoveProject={(p) => setMoveTarget(p)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {view.type === 'trash' ? (
        <TrashView trash={snap.trash} retentionDays={snap.settings.trashRetentionDays} />
      ) : (
      <div className="main">
        <div className="topbar">
          <div className="capture-group">
            <button className="icon-btn" title={t('app.captureRegion')} onClick={() => api.capture({ mode: 'region' })}>
              <Icon name="region" size={18} />
            </button>
            <button className="icon-btn" title={t('app.captureWindow')} onClick={() => api.capture({ mode: 'window' })}>
              <Icon name="window" size={18} />
            </button>
            <button className="icon-btn" title={t('app.captureFullScreen')} onClick={() => api.capture({ mode: 'fullscreen' })}>
              <Icon name="fullscreen" size={18} />
            </button>
            <button className="icon-btn" title={t('app.scrollingCapture')} onClick={() => api.startScrollCapture()}>
              <Icon name="scroll" size={18} />
            </button>
            <div style={{ position: 'relative' }}>
              <button className="icon-btn" title={t('app.record')} onClick={() => setRecordMenu((v) => !v)}>
                <Icon name="record" size={18} />
              </button>
              {recordMenu && (
                <div className="menu" style={{ left: 0, top: 40 }} onMouseLeave={() => setRecordMenu(false)}>
                  <div className="menu-item" onClick={() => { setRecordMenu(false); api.startRecording('screen') }}>
                    <Icon name="fullscreen" size={15} /> {t('app.recordScreen')}
                  </div>
                  <div className="menu-item" onClick={() => { setRecordMenu(false); api.startRecording('window') }}>
                    <Icon name="window" size={15} /> {t('app.recordWindow')}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="search-wrap">
            <span className="icn">
              <Icon name="search" size={16} />
            </span>
            <input
              className="input"
              placeholder={t('app.searchPlaceholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <div style={{ position: 'relative', marginLeft: 'auto' }}>
            <div className="active-proj" title={t('app.capturesSaveTo', { dir: activeDir })} onClick={() => setActiveMenu((v) => !v)}>
              <span className="proj-dot" style={{ background: activeProject?.color ?? '#5d6678' }} />
              <span>
                <span className="lbl" style={{ display: 'block' }}>
                  {t('app.activeProject')}
                </span>
                {activeProject?.name ?? t('app.unfiled')}
              </span>
              <Icon name="back" size={14} className="" />
            </div>
            {activeMenu && (
              <div className="menu" style={{ right: 0, top: 46 }} onMouseLeave={() => setActiveMenu(false)}>
                <div
                  className="menu-item"
                  onClick={() => {
                    api.setActiveProject(null)
                    setActiveMenu(false)
                  }}
                >
                  <Icon name="inbox" size={15} /> {t('app.unfiled')}
                </div>
                {snap.projects.filter((p) => !p.archived).map((p) => (
                  <div
                    key={p.id}
                    className="menu-item"
                    onClick={() => {
                      api.setActiveProject(p.id)
                      setActiveMenu(false)
                    }}
                  >
                    <span className="proj-dot" style={{ background: p.color }} /> {p.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="toolbar2">
          <strong style={{ color: 'var(--text)' }}>{viewTitle(view, projectName, tagName)}</strong>
          <span>· {items.length}</span>
          <div className="spacer" />
          <span
            className="small"
            title={activeDir}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 380, overflow: 'hidden', color: 'var(--muted-2)' }}
          >
            <Icon name="folder" size={13} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('app.savingTo', { dir: activeDir })}</span>
          </span>
          <span className="small">{t('app.sort')}</span>
          <select className="select" style={{ width: 130 }} value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="newest">{t('app.sortNewest')}</option>
            <option value="oldest">{t('app.sortOldest')}</option>
            <option value="name">{t('app.sortName')}</option>
          </select>
          <button
            className="btn sm"
            disabled={items.length === 0}
            onClick={openExport}
            title={selectedIds.size >= 2 ? t('app.exportSelectedTitle', { n: selectedIds.size }) : t('app.exportViewTitle')}
          >
            <Icon name="layers" size={14} /> {t('app.exportSheet')}
          </button>
        </div>

        {view.type === 'project' && <ProjectPalette projectId={view.id} sig={projectSig} />}

        {selectedIds.size > 1 && (
          <div className="bulk-bar">
            <span>
              <strong>{selectedIds.size}</strong> {t('app.selected')}
            </span>
            <div className="spacer" />
            <select
              className="select"
              style={{ width: 150 }}
              value=""
              onChange={(e) => {
                if (e.target.value) bulkMove(e.target.value === '__unfiled' ? null : e.target.value)
              }}
            >
              <option value="">{t('app.moveTo')}</option>
              <option value="__unfiled">{t('app.unfiled')}</option>
              {snap.projects.filter((p) => !p.archived).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input className="input" style={{ width: 150 }} placeholder={t('app.addTagEnter')} value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && bulkAddTag()} />
            <button className="btn sm" onClick={bulkFavorite}>
              <Icon name="star" size={14} /> {t('app.favorite')}
            </button>
            <button className="btn sm" onClick={openExport}>
              <Icon name="layers" size={14} /> {t('app.exportSheet')}
            </button>
            <button className="btn sm danger" onClick={() => setBulkDelete(true)}>
              <Icon name="trash" size={14} /> {t('app.delete')}
            </button>
            <button className="btn sm ghost" onClick={() => setSelectedIds(new Set())}>
              {t('app.clear')}
            </button>
          </div>
        )}

        <Grid
          items={items}
          selectedIds={selectedIds}
          focusedId={focusedId}
          onCardClick={handleCardClick}
          onCardDouble={(id) => {
            // Videos aren't editable: double-click selects (opens Detail with a player).
            if (byId.get(id)?.isVideo) setSelectedIds(new Set([id]))
            else api.openEditor(id)
          }}
          onCardContext={handleCardContext}
          onCols={(c) => {
            colsRef.current = c
          }}
          onDropFiles={importDropped}
          emptyHint={text ? t('app.noMatches') : t('app.emptyImport')}
        />
      </div>
      )}

      {selected && (
        <Detail
          snap={snap}
          shot={selected}
          onClose={() => {
            setSelectedIds(new Set())
            setFocusedId(null)
          }}
        />
      )}

      {bulkDelete && (
        <Modal onClose={() => setBulkDelete(false)}>
          <h2>{t('app.deleteNScreenshots', { n: selectedIds.size })}</h2>
          <p className="small muted">{t('app.bulkDeleteHelp')}</p>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn ghost" onClick={() => setBulkDelete(false)}>
              {t('app.cancel')}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => bulkDeleteDo(false)}>
                {t('app.removeFromSnapline')}
              </button>
              <button className="btn danger" onClick={() => bulkDeleteDo(true)}>
                {t('trash.moveToTrash')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {settingsOpen && <Settings settings={snap.settings} onClose={() => setSettingsOpen(false)} />}

      {projectModal && (
        <ProjectModal
          mode={projectModal.mode}
          project={projectModal.project}
          onClose={() => setProjectModal(null)}
        />
      )}

      {deleteTarget && (
        <DeleteProjectModal project={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}

      {moveTarget && (
        <MoveProjectModal
          project={moveTarget}
          count={snap.screenshots.filter((s) => s.projectId === moveTarget.id).length}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {exportItems && (
        <ExportSheetModal
          items={exportItems.map((id) => byId.get(id)!).filter(Boolean)}
          brandColors={snap.settings.brandColors ?? []}
          presets={snap.settings.beautifyPresets ?? []}
          title={projectName ?? viewTitle(view, projectName, tagName)}
          onClose={() => setExportItems(null)}
        />
      )}

      {ctxMenu && (() => {
        const shot = byId.get(ctxMenu.id)
        if (!shot) return null
        const close = (): void => setCtxMenu(null)
        return (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 49 }}
              onClick={close}
              onContextMenu={(e) => {
                e.preventDefault()
                close()
              }}
            />
            <div className="menu" style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 50 }}>
              <div className="menu-item" onClick={() => { api.revealScreenshot(shot.id); close() }}>
                <Icon name="reveal" size={15} /> {t('ctx.openLocation')}
              </div>
              {!shot.isVideo && (
                <div className="menu-item" onClick={() => { api.openEditor(shot.id); close() }}>
                  <Icon name="edit" size={15} /> {t('ctx.openInEditor')}
                </div>
              )}
              {!shot.isVideo && (
                <div className="menu-item" onClick={() => { api.copyScreenshotToClipboard(shot.id); api.toast(t('detail.copiedToClipboard')); close() }}>
                  <Icon name="copy" size={15} /> {t('ctx.copyImage')}
                </div>
              )}
              <div className="menu-item" onClick={() => { api.pinScreenshot(shot.id); close() }}>
                <Icon name="pin" size={15} /> {t('ctx.pin')}
              </div>
              <div className="menu-item" onClick={() => { api.toggleFavorite(shot.id); close() }}>
                <Icon name="star" size={15} /> {shot.favorite ? t('ctx.unfavorite') : t('ctx.favorite')}
              </div>
              <div className="menu-sep" />
              <div
                className="menu-item danger"
                onClick={() => {
                  api.deleteScreenshot(shot.id, { deleteFile: true })
                  showActionToast(t('trash.movedOne'), t('trash.undo'), () => api.restoreTrashed(shot.id))
                  close()
                }}
              >
                <Icon name="trash" size={15} /> {t('ctx.moveToTrash')}
              </div>
            </div>
          </>
        )
      })()}

      <ToastHost />
    </div>
  )
}

// Brand palette: dominant colors aggregated across the project's screenshots.
function ProjectPalette({ projectId, sig }: { projectId: string; sig: string }): React.ReactElement | null {
  const [data, setData] = useState<ProjectPaletteData | null>(null)
  useEffect(() => {
    let alive = true
    setData(null)
    api.getProjectPalette(projectId).then((d) => {
      if (alive) setData(d)
    })
    return () => {
      alive = false
    }
  }, [projectId, sig])

  if (!data || data.colors.length === 0) return null

  function copy(text: string, label: string): void {
    navigator.clipboard?.writeText(text).catch(() => {})
    api.toast(label)
  }

  return (
    <div className="proj-palette">
      <Icon name="sparkles" size={14} />
      <span className="pal-label">{t('app.brandPalette')}</span>
      <div className="pal-swatches">
        {data.colors.map((c) => (
          <button
            key={c.hex}
            className="pal-sw"
            style={{ background: c.hex }}
            title={t('app.swatchTitle', { hex: c.hex, pct: Math.round(c.weight * 100) })}
            onClick={() => copy(c.hex, t('app.copiedHex', { hex: c.hex }))}
          />
        ))}
      </div>
      <button className="btn sm ghost" onClick={() => copy(data.colors.map((c) => c.hex).join(', '), t('app.copiedAllHex'))} title={t('app.copyAllHexTitle')}>
        <Icon name="copy" size={13} /> {t('app.copyAll')}
      </button>
      <span className="small pal-meta">{data.sampled < data.total ? t('app.sampledOf', { sampled: data.sampled, total: data.total }) : `${data.total} ${data.total === 1 ? t('app.screenshotSingular') : t('app.screenshotPlural')}`}</span>
    </div>
  )
}

function ProjectModal({ mode, project, onClose }: { mode: 'create' | 'rename'; project?: Project; onClose: () => void }): React.ReactElement {
  const [name, setName] = useState(project?.name ?? '')
  const [color, setColor] = useState(project?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)])
  const [location, setLocation] = useState<string | null>(null)

  async function submit(): Promise<void> {
    if (!name.trim()) return
    if (mode === 'create') await api.createProject({ name: name.trim(), color, location: location ?? undefined })
    else if (project) await api.updateProject(project.id, { name: name.trim(), color })
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <h2>{mode === 'create' ? t('app.newProjectTitle') : t('app.renameProjectTitle')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        {mode === 'create' ? t('app.createProjectHelp') : t('app.renameProjectHelp')}
      </p>
      <label className="field-label">{t('app.name')}</label>
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={t('app.projectNamePlaceholder')} />
      <label className="field-label" style={{ marginTop: 14 }}>
        {t('app.color')}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        {PALETTE.map((c) => (
          <div
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: c,
              cursor: 'pointer',
              outline: color === c ? '2px solid #fff' : 'none',
              outlineOffset: 2
            }}
          />
        ))}
      </div>
      {mode === 'create' && (
        <>
          <label className="field-label" style={{ marginTop: 14 }}>
            {t('app.location')}
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              readOnly
              value={location ?? t('app.locationDefault')}
              title={location ?? t('app.locationDefault')}
              style={{ flex: 1, color: location ? 'var(--text)' : 'var(--muted-2)' }}
            />
            <button
              className="btn sm"
              onClick={async () => {
                const dir = await api.chooseDirectory()
                if (dir) setLocation(dir)
              }}
            >
              {t('app.chooseLocation')}
            </button>
            {location && (
              <button className="btn sm ghost" onClick={() => setLocation(null)} title={t('app.locationDefault')}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>
            {t('app.createLocationHelp')}
          </p>
        </>
      )}
      <div className="row">
        <button className="btn ghost" onClick={onClose}>
          {t('app.cancel')}
        </button>
        <button className="btn primary" onClick={submit}>
          {mode === 'create' ? t('app.create') : t('app.save')}
        </button>
      </div>
    </Modal>
  )
}

function DeleteProjectModal({ project, onClose }: { project: Project; onClose: () => void }): React.ReactElement {
  const [deleteFiles, setDeleteFiles] = useState(false)
  return (
    <Modal onClose={onClose}>
      <h2>{t('app.deleteProjectTitle', { name: project.name })}</h2>
      <p className="muted" style={{ marginTop: 4 }}>
        {deleteFiles ? t('app.deleteProjectHelpFiles') : t('app.deleteProjectHelpKeep')}
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={deleteFiles} onChange={(e) => setDeleteFiles(e.target.checked)} />
        {t('app.alsoDeleteFiles')}
      </label>
      <div className="row">
        <button className="btn ghost" onClick={onClose}>
          {t('app.cancel')}
        </button>
        <button
          className="btn danger"
          onClick={() => {
            api.deleteProject(project.id, { deleteFiles })
            onClose()
          }}
        >
          {t('app.delete')}
        </button>
      </div>
    </Modal>
  )
}

function MoveProjectModal({ project, count, onClose }: { project: Project; count: number; onClose: () => void }): React.ReactElement {
  const [dir, setDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose(): Promise<void> {
    const picked = await api.chooseDirectory()
    if (picked) setDir(picked)
  }
  async function move(): Promise<void> {
    if (!dir || busy) return
    setBusy(true)
    const res = await api.moveProjectLocation(project.id, dir)
    setBusy(false)
    if (res.ok) api.toast(t('app.locationMoved', { n: res.moved }))
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <h2>{t('app.moveLocationTitle', { name: project.name })}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{t('app.moveLocationHelp', { n: count })}</p>
      <label className="field-label">{t('app.location')}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input"
          readOnly
          value={dir ?? ''}
          placeholder={t('app.chooseLocation')}
          title={dir ?? ''}
          style={{ flex: 1 }}
        />
        <button className="btn sm" onClick={choose}>{t('app.chooseLocation')}</button>
      </div>
      <div className="row">
        <button className="btn ghost" onClick={onClose}>{t('app.cancel')}</button>
        <button className="btn primary" disabled={!dir || busy} onClick={move}>{t('app.moveLocationConfirm')}</button>
      </div>
    </Modal>
  )
}
