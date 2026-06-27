import type { SnaplineApi } from '@shared/types'

// The preload bridge. Typed for the renderer.
export const api: SnaplineApi = window.snapline

export function windowParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key)
}

// Apply the chosen UI theme by toggling the data-theme attribute on <html>.
// Dark is the default (matches :root), so only light needs an explicit attribute.
// The value is cached so the next window launch can apply it before first paint
// (settings arrive async over IPC, which would otherwise flash dark first).
export function applyTheme(theme: 'dark' | 'light' | undefined): void {
  const t = theme === 'light' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', t)
  try {
    localStorage.setItem('snapline-theme', t)
  } catch {
    /* private mode / storage disabled: not worth failing over */
  }
}

// Apply the last-known theme synchronously at module load, before React mounts.
export function initThemeFromCache(): void {
  let cached: string | null = null
  try {
    cached = localStorage.getItem('snapline-theme')
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-theme', cached === 'light' ? 'light' : 'dark')
}
