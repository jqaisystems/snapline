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
      const data = await fs.promises.readFile(filePath)
      return new Response(new Uint8Array(data), { headers: { 'content-type': mime(filePath) } })
    } catch (err) {
      console.error('[media] failed:', err)
      return new Response('error', { status: 500 })
    }
  })
}
