// Provider-agnostic enrichment. Supports two providers:
//   - 'anthropic': Claude via the official SDK (API key)
//   - 'openai':    any OpenAI-compatible /chat/completions endpoint
//                  (OpenAI, OpenRouter, Ollama, LM Studio). Key optional for local servers.
// Always opt-in and degrades to a safe no-op on error. The API key lives only in the
// main process (encrypted via safeStorage) and never reaches a renderer.
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import type { PiiRegion, Project, Screenshot, Settings } from '../shared/types'
import { getStore } from './store'
import { openaiChat, type OpenAIContentPart } from './openaiClient'

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8'

function mediaType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

// Returns { mediaType, base64, dataUrl } for the screenshot's thumbnail (preferred) or full file.
function imageData(screenshot: Screenshot): { media: string; b64: string; dataUrl: string } | null {
  const src = screenshot.thumbPath && fs.existsSync(screenshot.thumbPath) ? screenshot.thumbPath : screenshot.filePath
  if (!fs.existsSync(src)) return null
  const media = mediaType(src)
  const b64 = fs.readFileSync(src).toString('base64')
  return { media, b64, dataUrl: `data:${media};base64,${b64}` }
}

function extractJson<T>(text: string): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

// ---- shared helpers ----
function settings(): Settings {
  return getStore().getSettings()
}

export function aiReady(): boolean {
  const s = settings()
  if (s.aiProvider === 'openai') return !!s.aiBaseUrl.trim()
  return getStore().getApiKey() != null
}

// Run a vision+text prompt through the active provider, return raw text.
async function visionPrompt(screenshot: Screenshot, prompt: string): Promise<string> {
  const s = settings()
  const img = imageData(screenshot)
  if (!img) return ''

  if (s.aiProvider === 'openai') {
    if (!s.aiBaseUrl.trim()) return ''
    return openaiChat(s.aiBaseUrl, getStore().getApiKey(), s.aiModel, [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: img.dataUrl } }
    ])
  }

  // anthropic
  const key = getStore().getApiKey()
  if (!key) return ''
  const client = new Anthropic({ apiKey: key })
  const message = await client.messages.create({
    model: s.aiModel || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: img.media as any, data: img.b64 } },
          { type: 'text', text: prompt }
        ]
      }
    ]
  })
  if ((message.stop_reason as string) === 'refusal') return ''
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

export interface EnrichmentResult {
  name: string | null
  tags: string[]
  description: string | null
  suggestedProjectId: string | null
}

export async function enrich(
  screenshot: Screenshot,
  projects: Project[],
  flags: { name: boolean; tags: boolean; describe: boolean; suggestProject: boolean }
): Promise<EnrichmentResult | null> {
  const projectList = projects
    .filter((p) => !p.archived)
    .map((p) => `- ${p.name} (id: ${p.id})`)
    .join('\n')

  const asks: string[] = []
  if (flags.name) asks.push('"name": a short, human-readable file name (no extension, max 8 words) describing the content')
  if (flags.describe) asks.push('"description": one concise sentence describing what is shown, optimized so it can be found later by searching for the things visible in it')
  if (flags.tags) asks.push('"tags": 2-5 short lowercase topical tags (single or two words each)')
  if (flags.suggestProject && projectList)
    asks.push('"suggestedProjectId": the id of the single best-matching project from the list below, or null if none clearly fits')

  if (asks.length === 0) return { name: null, tags: [], description: null, suggestedProjectId: null }

  const prompt = `You are tagging a screenshot for a designer's organized library. Look at the image and respond with ONLY a JSON object containing:
${asks.join('\n')}
${flags.suggestProject && projectList ? `\nProjects:\n${projectList}\n` : ''}
Respond with the JSON object and nothing else.`

  try {
    const text = await visionPrompt(screenshot, prompt)
    const parsed = extractJson<Partial<EnrichmentResult>>(text)
    if (!parsed) return null
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 80) : null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
      description: typeof parsed.description === 'string' ? parsed.description.slice(0, 500) : null,
      suggestedProjectId:
        typeof parsed.suggestedProjectId === 'string' && projects.some((p) => p.id === parsed.suggestedProjectId)
          ? parsed.suggestedProjectId
          : null
    }
  } catch (err) {
    console.error('[ai] enrich failed:', err)
    return null
  }
}

export async function detectPii(screenshot: Screenshot): Promise<PiiRegion[]> {
  const prompt = `You are a privacy assistant. Find regions in this screenshot that contain sensitive personal or secret information that a designer would want to redact before sharing: emails, phone numbers, API keys/tokens, passwords, credit-card numbers, home addresses, full personal names, and human faces.
Respond with ONLY a JSON object: {"regions": [{"x": <0..1>, "y": <0..1>, "width": <0..1>, "height": <0..1>, "label": "<what it is>"}]}.
Coordinates are fractions of the image dimensions (0 = left/top, 1 = right/bottom). If nothing sensitive is visible, return {"regions": []}.`

  try {
    const text = await visionPrompt(screenshot, prompt)
    const parsed = extractJson<{ regions: PiiRegion[] }>(text)
    if (!parsed || !Array.isArray(parsed.regions)) return []
    return parsed.regions
      .filter(
        (r) =>
          typeof r.x === 'number' && typeof r.y === 'number' && typeof r.width === 'number' && typeof r.height === 'number'
      )
      .map((r) => ({
        x: Math.max(0, Math.min(1, r.x)),
        y: Math.max(0, Math.min(1, r.y)),
        width: Math.max(0, Math.min(1, r.width)),
        height: Math.max(0, Math.min(1, r.height)),
        label: typeof r.label === 'string' ? r.label : 'sensitive'
      }))
  } catch (err) {
    console.error('[ai] detectPii failed:', err)
    return []
  }
}

export async function testApiKey(): Promise<{ ok: boolean; error?: string }> {
  const s = settings()
  try {
    if (s.aiProvider === 'openai') {
      if (!s.aiBaseUrl.trim()) return { ok: false, error: 'Set a base URL first.' }
      const out = await openaiChat(s.aiBaseUrl, getStore().getApiKey(), s.aiModel, 'Reply with the single word: ok', 16)
      return { ok: typeof out === 'string', error: out ? undefined : 'Empty response.' }
    }
    const key = getStore().getApiKey()
    if (!key) return { ok: false, error: 'No API key set.' }
    const client = new Anthropic({ apiKey: key })
    await client.messages.create({
      model: s.aiModel || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }]
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Request failed.' }
  }
}
