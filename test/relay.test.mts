/**
 * End-to-end test of the relay transport — the fallback used when two browsers
 * cannot open a direct connection.
 *
 * Drives two real WebSocket clients through a whole duo session against the
 * running signaling server, using the same `planChunks` / `PhotoInbox` the app
 * uses, and asserts the photo that comes out the far end is byte-identical to
 * the one that went in.
 */
import { PhotoInbox, planChunks, slotFor, type WireMessage } from '../src/lib/duo-protocol.ts'

const PORT = process.env.SIGNAL_TEST_PORT ?? '8788'
const WS_URL = `ws://localhost:${PORT}/rtc`

const results: { name: string; pass: boolean }[] = []
const check = (name: string, pass: boolean, detail = '') => {
  results.push({ name, pass })
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

interface Client extends WebSocket {
  inbox: Record<string, unknown>[]
  /** Wire messages unwrapped from relay frames. */
  wire: WireMessage[]
}

function client(): Promise<Client> {
  const socket = new WebSocket(WS_URL) as Client
  socket.inbox = []
  socket.wire = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    socket.inbox.push(message)
    if (message.type === 'relay') socket.wire.push(JSON.parse(message.payload) as WireMessage)
  })
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket))
    socket.addEventListener('error', reject)
  })
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Exactly what useDuo's sendWire does on the relay path. */
const relay = (socket: Client, message: WireMessage) =>
  socket.send(JSON.stringify({ type: 'relay', payload: JSON.stringify(message) }))

const until = async (predicate: () => boolean, timeout = 5000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(20)
  }
  return false
}

console.log('\nrelay transport')

const host = await client()
const guest = await client()
host.send(JSON.stringify({ type: 'join', code: 'RELAY1' }))
await wait(120)
guest.send(JSON.stringify({ type: 'join', code: 'RELAY1' }))
await until(() => guest.inbox.some((m) => m.type === 'joined'))

// The session's control messages ride the relay.
relay(host, { t: 'go', shots: 4, timer: 3 })
await until(() => guest.wire.some((m) => m.t === 'go'))
const go = guest.wire.find((m) => m.t === 'go')
check('countdown start reaches the partner', go?.t === 'go' && go.shots === 4 && go.timer === 3)

check('relay frames never echo to the sender', host.wire.length === 0)

// A photo, chunked exactly as the app chunks it.
const photo = 'data:image/jpeg;base64,' + 'QUJDREVGR0g='.repeat(30_000) // ~330KB
const parts = planChunks(photo)
const id = 'shot-0'

relay(host, { t: 'photo-start', id, round: 0, chunks: parts.length })
for (let index = 0; index < parts.length; index++) {
  relay(host, { t: 'photo-chunk', id, index, body: parts[index] })
}
relay(host, { t: 'photo-end', id })

const arrived = await until(() => guest.wire.some((m) => m.t === 'photo-end'), 15_000)
check('every chunk crossed the relay', arrived, `${parts.length} chunks`)

// Reassemble with the app's own inbox.
const inbox = new PhotoInbox()
let rebuilt: { round: number; dataUrl: string } | null = null
for (const message of guest.wire) {
  if (message.t === 'photo-start') inbox.start(message.id, message.round, message.chunks)
  if (message.t === 'photo-chunk') inbox.chunk(message.id, message.index, message.body)
  if (message.t === 'photo-end') rebuilt = inbox.end(message.id)
}

check('photo rebuilt byte-for-byte', rebuilt?.dataUrl === photo, `${rebuilt?.dataUrl.length ?? 0} chars`)
check('photo lands in the host column', rebuilt !== null && slotFor(rebuilt.round, true) === 0)

// Guest replies, proving the relay is bidirectional.
relay(guest, { t: 'preview', frame: 'data:image/jpeg;base64,AAAA' })
await until(() => host.wire.some((m) => m.t === 'preview'))
check(
  'preview frames flow back the other way',
  host.wire.some((m) => m.t === 'preview'),
)

// Oversized payloads are dropped, not forwarded, and do not kill the server.
const before = guest.wire.length
host.send(JSON.stringify({ type: 'relay', payload: 'x'.repeat(200_000) }))
await wait(400)
check('oversized payload is dropped', guest.wire.length === before)
check('server survives an oversized payload', host.readyState === WebSocket.OPEN)

const health = await fetch(`http://localhost:${PORT}/health`).then((response) => response.json())
check('server still healthy afterwards', health.ok === true)

host.close()
guest.close()

const failed = results.filter((result) => !result.pass)
console.log(`\nrelay: ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
