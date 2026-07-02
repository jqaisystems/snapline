// Regression tests for the security guards added in the pre-launch hardening pass.
// Pure helpers only (src/main/net.ts) — no Electron, no network, runnable in plain Node.
import path from 'path'
import { isAllowedAiBaseUrl, isSafeExternalUrl, isPathInside } from '../src/main/net'

let failures = 0
function check(name: string, got: boolean, want: boolean): void {
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}  (got ${got}, want ${want})`)
}

// --- aiBaseUrl SSRF guard: https anywhere; http only for localhost/loopback ---
check('ai https public', isAllowedAiBaseUrl('https://api.openai.com/v1'), true)
check('ai https openrouter', isAllowedAiBaseUrl('https://openrouter.ai/api/v1'), true)
check('ai http localhost', isAllowedAiBaseUrl('http://localhost:11434/v1'), true)
check('ai http 127.0.0.1', isAllowedAiBaseUrl('http://127.0.0.1:1234/v1'), true)
check('ai http public host DENIED', isAllowedAiBaseUrl('http://evil.example.com/v1'), false)
check('ai http LAN host DENIED', isAllowedAiBaseUrl('http://192.168.1.50/v1'), false)
check('ai file scheme DENIED', isAllowedAiBaseUrl('file:///etc/passwd'), false)
check('ai garbage DENIED', isAllowedAiBaseUrl('not a url'), false)
check('ai empty DENIED', isAllowedAiBaseUrl(''), false)

// --- openExternal allowlist: web + mail only ---
check('ext https', isSafeExternalUrl('https://example.com'), true)
check('ext http', isSafeExternalUrl('http://example.com'), true)
check('ext mailto', isSafeExternalUrl('mailto:hi@example.com'), true)
check('ext file DENIED', isSafeExternalUrl('file:///C:/Windows/System32/calc.exe'), false)
check('ext custom proto DENIED', isSafeExternalUrl('ms-settings:privacy'), false)
check('ext javascript DENIED', isSafeExternalUrl('javascript:alert(1)'), false)
check('ext garbage DENIED', isSafeExternalUrl('nope'), false)

// --- snapmedia:// path confinement helper ---
const root = path.resolve(path.sep === '\\' ? 'C:\\snap\\root' : '/snap/root')
check('inside self', isPathInside(root, root), true)
check('inside file', isPathInside(root, path.join(root, 'ProjectA', 'shot.png')), true)
check('inside nested', isPathInside(root, path.join(root, 'a', 'b', 'c.webm')), true)
check('traversal escape DENIED', isPathInside(root, path.join(root, '..', 'secret.txt')), false)
check('sibling DENIED', isPathInside(path.join(root, 'x'), path.join(root, 'y', 'f.png')), false)

console.log('--- SECURITY GUARDS TEST ---')
console.log('RESULT:', failures === 0 ? 'PASS ✓' : `FAIL ✗ (${failures})`)
process.exit(failures === 0 ? 0 : 1)
