/**
 * Integration checks for the signaling server. Expects one running on
 * SIGNAL_TEST_PORT — `npm test` starts it for you.
 *
 * Uses Node's built-in WebSocket client, so there is nothing to install.
 */
const PORT = process.env.SIGNAL_TEST_PORT ?? '8788'
const WS_URL = `ws://localhost:${PORT}/rtc`

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function client() {
  const socket = new WebSocket(WS_URL)
  socket.inbox = []
  socket.addEventListener('message', (event) => socket.inbox.push(JSON.parse(String(event.data))))
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket))
    socket.addEventListener('error', reject)
  })
}

const send = (socket, message) => socket.send(JSON.stringify(message))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const next = async (socket, type, timeout = 1500) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = socket.inbox.find((message) => message.type === type)
    if (found) {
      socket.inbox.splice(socket.inbox.indexOf(found), 1)
      return found
    }
    await wait(25)
  }
  return null
}

console.log('\npairing')
const host = await client()
const guest = await client()

send(host, { type: 'join', code: 'TEST12' })
const hostJoined = await next(host, 'joined')
check('first to join is alone and initiates', hostJoined?.initiator === true && hostJoined?.peers === 1)

send(guest, { type: 'join', code: 'test12' })
const guestJoined = await next(guest, 'joined')
const hostNotified = await next(host, 'peer-joined')
check('second joiner pairs up, code normalised', guestJoined?.peers === 2 && guestJoined?.code === 'TEST12')
check('host is told to make the offer', hostNotified?.initiator === true)

console.log('\nrelay')
send(host, { type: 'signal', data: { sdp: { type: 'offer', sdp: 'v=0-fake' } } })
check('offer reaches the guest', (await next(guest, 'signal'))?.data?.sdp?.sdp === 'v=0-fake')

send(guest, { type: 'signal', data: { candidate: { candidate: 'candidate:fake' } } })
check('candidate reaches the host', (await next(host, 'signal'))?.data?.candidate?.candidate === 'candidate:fake')
check('a signal never echoes back to its sender', (await next(guest, 'signal', 300)) === null)

console.log('\nguard rails')
const third = await client()
send(third, { type: 'join', code: 'TEST12' })
check('a third person cannot join a full booth', (await next(third, 'error'))?.reason === 'full')

send(third, { type: 'join', code: 'x!' })
check('a malformed code is rejected', (await next(third, 'error'))?.reason === 'bad-code')

third.send('not json at all')
await wait(150)
check('a malformed frame does not kill the server', third.readyState === WebSocket.OPEN)

console.log('\nleaving')
guest.close()
check('the survivor is told their partner left', (await next(host, 'peer-left')) !== null)

const replacement = await client()
send(replacement, { type: 'join', code: 'TEST12' })
check('the freed slot can be reused', (await next(replacement, 'joined'))?.peers === 2)

const health = await fetch(`http://localhost:${PORT}/health`).then((response) => response.json())
check('health endpoint responds', health.ok === true)

for (const socket of [host, third, replacement]) socket.close()

const failed = results.filter((result) => !result.pass)
console.log(`\nsignaling: ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
