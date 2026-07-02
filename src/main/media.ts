import { app, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { getStore } from './store'
import { isPathInside } from './net'

// Custom protocol so renderer windows can display on-disk images regardless of their
// origin (dev server is http://localhost) without disabling webSecurity.
export const MEDIA_SCHEME = 'snapmedia'
const PREFIX = `${MEDIA_SCHEME}://f/`

// The scheme is registered privileged with bypassCSP, so it must never be usable as a
// general file reader. Only serve files that live inside a directory Snapline manages:
// the thumbnail cache, the storage root (project folders + trash), or a project's custom
// location. Paths are realpath-resolved so `..` / symlink tricks can't escape a root.
function allowedRoots(): string[] {
  const roots = [path.join(app.getPath('userData'), 'thumbnails')]
  try {
    const store = getStore()
    const root = store.getSettings().storageRoot
    if (root) roots.push(root)
    for (const p of store.getProjects()) if (p.customPath) roots.push(p.customPath)
  } catch {
    /* store not ready yet: only the thumbnail cache is allowed */
  }
  return roots
}

// Returns the realpath to serve if the request is confined to an allowed root, else null.
function resolveConfined(filePath: string): string | null {
  let real: string
  try {
    real = fs.realpathSync.native(filePath)
  } catch {
    return null // missing / unreadable
  }
  for (const root of allowedRoots()) {
    let realRoot: string
    try {
      realRoot = fs.realpathSync.native(root)
    } catch {
      continue
    }
    if (isPathInside(realRoot, real)) return real
  }
  return null
}

export function mediaUrl(absPath: string): string {
  return PREFIX + encodeURIComponent(absPath)
}

function mime(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    case '.webm':
      return 'video/webm'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    default:
      return 'image/png'
  }
}

export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const enc = request.url.startsWith(PREFIX) ? request.url.slice(PREFIX.length) : ''
      const requested = decodeURIComponent(enc.split('?')[0])
      const filePath = requested ? resolveConfined(requested) : null
      if (!filePath) return new Response('not found', { status: 404 })
      const contentType = mime(filePath)
      const size = (await fs.promises.stat(filePath)).size
      const rangeHeader = request.headers.get('range')

      // Serve HTTP Range requests so <video> can seek/scrub. Without 206 support the
      // element can play from the start but seeking fails.
      const m = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (m) {
        let start: number
        let end: number
        if (m[1] === '' && m[2] !== '') {
          // Suffix range `bytes=-N` = the last N bytes, not the first N.
          const n = parseInt(m[2], 10)
          start = Number.isNaN(n) ? 0 : Math.max(0, size - n)
          end = size - 1
        } else {
          start = m[1] ? parseInt(m[1], 10) : 0
          end = m[2] ? parseInt(m[2], 10) : size - 1
          if (Number.isNaN(start)) start = 0
          if (Number.isNaN(end) || end >= size) end = size - 1
        }
        if (start > end || start >= size) {
          return new Response('range not satisfiable', { status: 416, headers: { 'content-range': `bytes */${size}` } })
        }
        const buf = await fs.promises.readFile(filePath)
        return new Response(new Uint8Array(buf.subarray(start, end + 1)), {
          status: 206,
          headers: {
            'content-type': contentType,
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${size}`,
            'content-length': String(end - start + 1)
          }
        })
      }

      const data = await fs.promises.readFile(filePath)
      return new Response(new Uint8Array(data), {
        headers: { 'content-type': contentType, 'accept-ranges': 'bytes', 'content-length': String(size) }
      })
    } catch (err) {
      console.error('[media] failed:', err)
      return new Response('error', { status: 500 })
    }
  })
}
