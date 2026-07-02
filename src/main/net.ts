import path from 'path'

// True when `target` is `root` itself or lives inside it. Pure (path-only) so it is unit-
// testable and reusable by the snapmedia:// confinement check. Callers should pass already
// realpath-resolved absolute paths so `..`/symlink tricks can't escape.
export function isPathInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Guard for the user-supplied OpenAI-compatible base URL. It is fetched with the user's API
// key attached, so an unvalidated value is an SSRF / key-exfiltration risk: a typo or hostile
// value could send the key to an internal or attacker-controlled host. Policy: https to any
// host is allowed; plain http is allowed only for localhost/loopback (Ollama, LM Studio).
// Kept dependency-free (no electron) so it is unit-testable in plain Node.
export function isAllowedAiBaseUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:') {
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
  }
  return false
}

// Whether a URL from renderer content is safe to hand to the OS shell (window.open / links).
// Restricts to web + mail; blocks file:, custom app protocols, etc.
export function isSafeExternalUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:'
}
