import React, { useState } from 'react'
import type { LibrarySnapshot, Project } from '@shared/types'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import { t } from '@ui/i18n'
import type { View } from './state'

interface Props {
  snap: LibrarySnapshot
  view: View
  onView: (v: View) => void
  onNewProject: () => void
  onRenameProject: (p: Project) => void
  onDeleteProject: (p: Project) => void
  onOpenSettings: () => void
}

export default function Sidebar({ snap, view, onView, onNewProject, onRenameProject, onDeleteProject, onOpenSettings }: Props): React.ReactElement {
  const [menu, setMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const [dropId, setDropId] = useState<string | 'unfiled' | null>(null)

  const shots = snap.screenshots
  const countFor = (pid: string | null): number => shots.filter((s) => s.projectId === pid).length
  const activeProjectId = snap.settings.activeProjectId

  const isActiveView = (v: View): boolean => {
    if (v.type !== view.type) return false
    if (v.type === 'project' && view.type === 'project') return v.id === view.id
    if (v.type === 'tag' && view.type === 'tag') return v.id === view.id
    return v.type === view.type
  }

  function handleDrop(projectId: string | null): void {
    const sel = dragId
    if (sel) api.moveScreenshot(sel, projectId)
    setDropId(null)
  }

  return (
    <aside className="sidebar" onClick={() => setMenu(null)}>
      <div className="brand">
        <div className="logo">
          <Icon name="region" size={16} />
        </div>
        <div className="name">Snapline</div>
      </div>

      <div className="sidebar-scroll">
        <div
          className={`nav-item ${isActiveView({ type: 'all' }) ? 'active' : ''}`}
          onClick={() => onView({ type: 'all' })}
        >
          <Icon name="layers" size={17} />
          <span>{t('nav.allScreenshots')}</span>
          <span className="count">{shots.length}</span>
        </div>
        <div
          className={`nav-item ${isActiveView({ type: 'unfiled' }) ? 'active' : ''} ${dropId === 'unfiled' ? 'drop-target' : ''}`}
          onClick={() => onView({ type: 'unfiled' })}
          onDragOver={(e) => {
            e.preventDefault()
            setDropId('unfiled')
          }}
          onDragLeave={() => setDropId((d) => (d === 'unfiled' ? null : d))}
          onDrop={() => handleDrop(null)}
        >
          <Icon name="inbox" size={17} />
          <span>{t('nav.unfiled')}</span>
          <span className="count">{countFor(null)}</span>
        </div>
        <div
          className={`nav-item ${isActiveView({ type: 'favorites' }) ? 'active' : ''}`}
          onClick={() => onView({ type: 'favorites' })}
        >
          <Icon name="star" size={17} />
          <span>{t('nav.favorites')}</span>
          <span className="count">{shots.filter((s) => s.favorite).length}</span>
        </div>

        <div className="side-section">
          <div className="side-head">
            <span>{t('nav.projects')}</span>
            <button title={t('nav.newProject')} onClick={onNewProject}>
              <Icon name="plus" size={15} />
            </button>
          </div>
          {snap.projects.filter((p) => !p.archived).map((p) => (
            <div
              key={p.id}
              className={`nav-item ${view.type === 'project' && view.id === p.id ? 'active' : ''} ${dropId === p.id ? 'drop-target' : ''}`}
              onClick={() => onView({ type: 'project', id: p.id })}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, project: p })
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDropId(p.id)
              }}
              onDragLeave={() => setDropId((d) => (d === p.id ? null : d))}
              onDrop={() => handleDrop(p.id)}
            >
              <span className="proj-dot" style={{ background: p.color }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
                {activeProjectId === p.id && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>●</span>}
              </span>
              <span className="count">{countFor(p.id)}</span>
            </div>
          ))}
          {snap.projects.filter((p) => !p.archived).length === 0 && (
            <div className="small muted" style={{ padding: '6px 9px' }}>
              {t('nav.noProjects')}
            </div>
          )}
        </div>

        {snap.tags.length > 0 && (
          <div className="side-section">
            <div className="side-head">
              <span>{t('nav.tags')}</span>
            </div>
            {snap.tags.map((t) => (
              <div
                key={t.id}
                className={`nav-item ${view.type === 'tag' && view.id === t.id ? 'active' : ''}`}
                onClick={() => onView({ type: 'tag', id: t.id })}
              >
                <span className="proj-dot" style={{ background: t.color, borderRadius: '50%' }} />
                <span>{t.name}</span>
                <span className="count">{shots.filter((s) => s.tagIds.includes(t.id)).length}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: 10, borderTop: '1px solid var(--border-soft)' }}>
        <div className="nav-item" onClick={onOpenSettings}>
          <Icon name="settings" size={17} />
          <span>{t('nav.settings')}</span>
        </div>
      </div>

      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div
            className="menu-item"
            onClick={() => {
              api.setActiveProject(menu.project.id)
              setMenu(null)
            }}
          >
            <Icon name="check" size={15} /> {t('nav.setActive')}
          </div>
          <div
            className="menu-item"
            onClick={() => {
              api.openProjectFolder(menu.project.id)
              setMenu(null)
            }}
          >
            <Icon name="reveal" size={15} /> {t('nav.openFolder')}
          </div>
          <div
            className="menu-item"
            onClick={() => {
              onRenameProject(menu.project)
              setMenu(null)
            }}
          >
            <Icon name="edit" size={15} /> {t('nav.rename')}
          </div>
          <div
            className="menu-item danger"
            onClick={() => {
              onDeleteProject(menu.project)
              setMenu(null)
            }}
          >
            <Icon name="trash" size={15} /> {t('nav.delete')}
          </div>
        </div>
      )}
    </aside>
  )
}

// Track the screenshot id currently being dragged (set by Grid cards).
export let dragId: string | null = null
export function setDragId(id: string | null): void {
  dragId = id
}
