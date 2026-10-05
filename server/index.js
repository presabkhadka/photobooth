/**
 * Signaling server for collaborative shots.
 *
 * It is deliberately dumb: it puts two browsers in a room and forwards the
 * WebRTC handshake between them. Once they are connected, video and photos flow
 * peer-to-peer and nothing else touches this process.
 *
 * When a direct connection is impossible — symmetric NAT, CGNAT, corporate wifi
 * — the browsers fall back to sending the session through here as `relay`
 * frames. Those are forwarded straight to the other peer and never stored.
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT ?? process.env.SIGNAL_PORT ?? 8787)
const PATH = '/rtc'
const MAX_PER_ROOM = 2
const HEARTBEAT_MS = 30_000
/** Comfortably above one photo chunk or preview frame, well below anything abusive. */
const MAX_RELAY_BYTES = 96 * 1024
/** Render's free tier sleeps after ~15 idle minutes; ping well inside that. */
const KEEPALIVE_MS = 10 * 60_000

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map()

const send = (socket, payload) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
}

const peersOf = (socket) => {
  const room = rooms.get(socket.roomCode)
  if (!room) return []
  return [...room].filter((peer) => peer !== socket)
}

function leaveRoom(socket) {
  const room = rooms.get(socket.roomCode)
  if (!room) return

  room.delete(socket)
  for (const peer of room) send(peer, { type: 'peer-left' })
  if (room.size === 0) rooms.delete(socket.roomCode)
  socket.roomCode = undefined
}

function joinRoom(socket, rawCode) {
  const code = String(rawCode ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)

  if (code.length < 4) {
    send(socket, { type: 'error', reason: 'bad-code', message: 'That booth code looks wrong.' })
    return
  }

  if (socket.roomCode) leaveRoom(socket)

  const room = rooms.get(code) ?? new Set()

  if (room.size >= MAX_PER_ROOM) {
    send(socket, { type: 'error', reason: 'full', message: 'That booth already has two people in it.' })
    return
  }

  room.add(socket)
  rooms.set(code, room)
  socket.roomCode = code

  const alone = room.size === 1
  send(socket, { type: 'joined', code, initiator: alone, peers: room.size })

  if (!alone) {
    // The peer who was already waiting drives the WebRTC offer.
    for (const peer of peersOf(socket)) send(peer, { type: 'peer-joined', initiator: true })
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json',
      // The app pings this from another origin to wake the server early.
      'access-control-allow-origin': '*',
    })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server: httpServer, path: PATH })

wss.on('connection', (socket) => {
  socket.isAlive = true
  socket.on('pong', () => {
    socket.isAlive = true
  })

  socket.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }

    switch (message.type) {
      case 'join':
        joinRoom(socket, message.code)
        break
      case 'signal':
        // Relay the SDP / ICE blob untouched.
        for (const peer of peersOf(socket)) send(peer, { type: 'signal', data: message.data })
        break
      case 'relay':
        // Fallback transport: when the two browsers cannot open a direct line,
        // the booth session itself rides this socket instead. Still just a
        // forward — nothing is inspected or kept.
        if (typeof message.payload === 'string' && message.payload.length <= MAX_RELAY_BYTES) {
          for (const peer of peersOf(socket)) send(peer, { type: 'relay', payload: message.payload })
        }
        break
      case 'leave':
        leaveRoom(socket)
        break
      default:
        break
    }
  })

  socket.on('close', () => leaveRoom(socket))
  socket.on('error', () => leaveRoom(socket))
})

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate()
      continue
    }
    socket.isAlive = false
    socket.ping()
  }
}, HEARTBEAT_MS)

wss.on('close', () => clearInterval(heartbeat))

httpServer.listen(PORT, () => {
  console.log(`📸 booth signaling on ws://localhost:${PORT}${PATH}`)
})

// On Render, keep the free instance awake by hitting our own public URL. The
// request goes through Render's edge, so it counts as inbound traffic. Render
// sets RENDER_EXTERNAL_URL itself; everywhere else this is a no-op.
const publicUrl = process.env.RENDER_EXTERNAL_URL
if (publicUrl) {
  const keepAlive = setInterval(() => {
    fetch(`${publicUrl}/health`).catch(() => {})
  }, KEEPALIVE_MS)
  wss.on('close', () => clearInterval(keepAlive))
}
