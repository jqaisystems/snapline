import { protocol } from 'electron'
import fs from 'fs'
import path from 'path'

// Custom protocol so renderer windows can display on-disk images regardless of their
// origin (dev server is http://localhost) without disabling webSecurity.
export const MEDIA_SCHEME = 'snapmedia'
const PREFIX = `${MEDIA_SCHEME}://f/`

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
      const filePath = decodeURIComponent(enc.split('?')[0])
      if (!filePath || !fs.existsSync(filePath)) return new Response('not found', { status: 404 })
      const contentType = mime(filePath)
      const size = (await fs.promises.stat(filePath)).size
      const rangeHeader = request.headers.get('range')

      // Serve HTTP Range requests so <video> can seek/scrub. Without 206 support the
      // element can play from the start but seeking fails.
      const m = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0
        let end = m[2] ? parseInt(m[2], 10) : size - 1
        if (Number.isNaN(start)) start = 0
        if (Number.isNaN(end) || end >= size) end = size - 1
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
