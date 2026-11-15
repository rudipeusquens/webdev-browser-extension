import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

// A local stand-in for OpenRouter's three endpoints (spec section 12): CI never calls the real
// API. The E2E harness points a copy of the build at it.

export interface SeenRequest {
  method: string
  path: string
  authorization: string | undefined
  body: unknown
}

interface Answer {
  status: number
  body: unknown
  /** Milliseconds before the answer, like a slow transcription. */
  delay?: number
}

export const FAKE_TEXT = 'Make the button wider.'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

async function read(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export async function startFakeOpenRouter() {
  const requests: SeenRequest[] = []
  const answers: Answer[] = []
  /** What the next corrections answer: a corrected text, or a failure. */
  const corrections: Answer[] = []
  /** Keys `GET /api/v1/key` calls valid. */
  const validKeys = new Set<string>()
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return void res.writeHead(204, CORS).end()
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const text = await read(req)
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      // Kept as text.
    }
    requests.push({
      method: req.method ?? '',
      path,
      authorization: req.headers.authorization,
      body,
    })
    const json = (status: number, payload: unknown) =>
      res
        .writeHead(status, { ...CORS, 'Content-Type': 'application/json' })
        .end(JSON.stringify(payload))
    if (path === '/api/v1/key') {
      const key = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
      return validKeys.has(key) ? json(200, { data: {} }) : json(401, { error: { message: 'No' } })
    }
    if (path === '/api/v1/audio/transcriptions' && req.method === 'POST') {
      const answer = answers.shift() ?? { status: 200, body: { text: FAKE_TEXT } }
      if (answer.delay) await new Promise((done) => setTimeout(done, answer.delay))
      if (!res.destroyed) json(answer.status, answer.body)
      return
    }
    if (path === '/api/v1/chat/completions' && req.method === 'POST') {
      const answer = corrections.shift()
      if (answer && answer.status !== 200) return json(answer.status, answer.body)
      // Without a queued answer, the transcript comes back as it is.
      const sent = (body as { messages?: { content?: string }[] }).messages?.at(-1)?.content ?? ''
      const content =
        (answer?.body as string | undefined) ??
        sent.replace(/^<transcript>\n/, '').replace(/\n<\/transcript>$/, '')
      return json(200, {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
      })
    }
    json(404, { error: { message: 'Not found' } })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    validKeys,
    transcriptions: () => requests.filter((r) => r.path === '/api/v1/audio/transcriptions'),
    /** The next transcription answers so. */
    reply: (status: number, body: unknown, delay?: number) => answers.push({ status, body, delay }),
    corrections: () => requests.filter((r) => r.path === '/api/v1/chat/completions'),
    /** The next correction answers with this text, or fails with this status. */
    correct: (text: string) => corrections.push({ status: 200, body: text }),
    failCorrection: (status: number) =>
      corrections.push({ status, body: { error: { message: 'No' } } }),
    reset() {
      requests.length = 0
      answers.length = 0
      corrections.length = 0
      validKeys.clear()
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}
