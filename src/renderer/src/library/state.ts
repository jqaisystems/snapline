import type { SearchQuery } from '@shared/types'
import { t } from '@ui/i18n'

export type View =
  | { type: 'all' }
  | { type: 'screenshots' }
  | { type: 'videos' }
  | { type: 'unfiled' }
  | { type: 'favorites' }
  | { type: 'trash' }
  | { type: 'project'; id: string }
  | { type: 'tag'; id: string }

export type SortMode = 'newest' | 'oldest' | 'name'

export function viewToQuery(view: View, text: string, sort: SortMode): SearchQuery {
  const q: SearchQuery = { sort }
  if (text.trim()) q.text = text.trim()
  if (view.type === 'unfiled') q.projectId = null
  else if (view.type === 'project') q.projectId = view.id
  else if (view.type === 'favorites') q.favorite = true
  else if (view.type === 'tag') q.tagId = view.id
  else if (view.type === 'screenshots') q.media = 'image'
  else if (view.type === 'videos') q.media = 'video'
  return q
}

export function viewTitle(view: View, projectName?: string, tagName?: string): string {
  switch (view.type) {
    case 'all':
      return t('view.everything')
    case 'screenshots':
      return t('view.screenshots')
    case 'videos':
      return t('view.videos')
    case 'unfiled':
      return t('view.unfiled')
    case 'favorites':
      return t('view.favorites')
    case 'trash':
      return t('view.recentlyDeleted')
    case 'project':
      return projectName ?? t('view.project')
    case 'tag':
      return `#${tagName ?? t('view.tagFallback')}`
  }
}
