// Lightweight, dependency-free i18n for the renderer.
//
// Design notes:
// - Strings live in flat dictionaries (key -> text) under this folder, one per locale.
// - Adding a language = add a `<code>.ts` dictionary and register it in LOCALES below.
//   Nothing else needs to change; the Settings picker reads LOCALES automatically.
// - English is the source of truth and the fallback for any missing key or unknown locale.
// - The active dictionary is module-level state. Window roots call setLocale() during
//   render from settings.locale, so every t() in that render uses the right language.
//   initLocaleFromCache() applies the last choice synchronously before first paint.

import { en } from './en'
import { pt } from './pt'

export type Dict = Record<string, string>

export const LOCALES: Record<string, { label: string; dict: Dict }> = {
  en: { label: 'English', dict: en },
  pt: { label: 'Português', dict: pt }
}

const FALLBACK = en
let active: Dict = en
let activeCode = 'en'

// Safe to call on every render: it no-ops unless the locale actually changed.
export function setLocale(code: string | undefined): void {
  const next = code ?? 'en'
  if (next === activeCode) return
  activeCode = next
  active = LOCALES[next]?.dict ?? FALLBACK
  try {
    localStorage.setItem('snapline-locale', next)
  } catch {
    /* storage disabled: not worth failing over */
  }
}

// Apply the last-known locale synchronously at module load, before React mounts.
export function initLocaleFromCache(): void {
  let cached: string | null = null
  try {
    cached = localStorage.getItem('snapline-locale')
  } catch {
    /* ignore */
  }
  activeCode = cached && LOCALES[cached] ? cached : 'en'
  active = LOCALES[activeCode]?.dict ?? FALLBACK
}

// Translate a key. Unknown keys fall back to English, then to the key itself,
// so a missing translation is always visible rather than blank.
// Supports {name} placeholders: t('greet', { name: 'João' }).
export function t(key: string, params?: Record<string, string | number>): string {
  let s = active[key] ?? FALLBACK[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}
