// Minimal OpenAI-compatible /chat/completions client (plain fetch, no SDK, no Electron).
// Works with OpenAI, OpenRouter, Ollama and LM Studio. Kept dependency-free so it is
// unit-testable in plain Node.
export interface OpenAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export async function openaiChat(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  content: OpenAIContentPart[] | string,
  maxTokens = 1024
): Promise<string> {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] })
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${res.statusText} ${body.slice(0, 200)}`)
  }
  const data: any = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}
