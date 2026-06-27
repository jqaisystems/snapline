// Proves the OpenAI-compatible client (src/main/openaiClient.ts) against a local stub
// server that mimics POST /v1/chat/completions. No real LLM, no key, no network.
import http from 'http'
import { openaiChat } from '../src/main/openaiClient'

async function main(): Promise<void> {
  let received: any = null
  let gotAuth: string | undefined

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      gotAuth = req.headers['authorization'] as string | undefined
      try {
        received = JSON.parse(body)
      } catch {
        received = null
      }
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n{"name":"reddit google ads thread","tags":["reddit","ads"],"description":"A Reddit post asking if learning Google Ads is worth it."}\n```'
              }
            }
          ]
        })
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const base = `http://127.0.0.1:${port}/v1`

  // 1) with image + key (OpenAI / OpenRouter style)
  const content = [
    { type: 'text', text: 'describe this' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
  ]
  const out = await openaiChat(base, 'sk-test-123', 'gpt-4o-mini', content as any)
  const authOk = gotAuth === 'Bearer sk-test-123'
  const hasImage = !!received?.messages?.[0]?.content?.some((p: any) => p.type === 'image_url')
  const modelOk = received?.model === 'gpt-4o-mini'

  // 2) without key (local server style: Ollama / LM Studio)
  await openaiChat(base, null, 'llava', 'ping')
  const noAuth = gotAuth === undefined

  server.close()

  console.log('--- OPENAI-COMPATIBLE CLIENT TEST ---')
  console.log('endpoint called:          ', `${base}/chat/completions`)
  console.log('auth header sent with key:', authOk)
  console.log('image part forwarded:     ', hasImage)
  console.log('model forwarded:          ', modelOk)
  console.log('no auth header without key:', noAuth)
  console.log('content parsed:           ', out.replace(/\s+/g, ' ').slice(0, 70))

  const pass = authOk && hasImage && modelOk && noAuth && out.includes('Google Ads')
  console.log('RESULT:', pass ? 'PASS ✓' : 'FAIL ✗')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
