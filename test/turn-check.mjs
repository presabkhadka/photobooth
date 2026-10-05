/**
 * Verifies TURN credentials by actually allocating a relay address.
 *
 *   npm run turn:check
 *
 * Reads VITE_TURN_* from .env.local (or the environment) and performs the real
 * STUN long-term-credential handshake against the server: an unauthenticated
 * Allocate to collect REALM/NONCE, then an authenticated one signed with
 * MESSAGE-INTEGRITY. A success response carrying a relayed address proves the
 * credentials work — no browsers or second device required.
 */
import dgram from 'node:dgram'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAGIC = 0x2112a442

const TYPE = { ALLOCATE: 0x0003, REFRESH: 0x0004 }
const ATTR = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  LIFETIME: 0x000d,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
}

function loadEnv() {
  const env = { ...process.env }
  for (const file of ['.env.local', '.env']) {
    let raw
    try {
      raw = readFileSync(join(ROOT, file), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const value = match[2].trim().replace(/^["']|["']$/g, '')
      if (!(match[1] in process.env)) env[match[1]] = value
    }
  }
  return env
}

function buildAttr(type, value) {
  const padded = Math.ceil(value.length / 4) * 4
  const buf = Buffer.alloc(4 + padded)
  buf.writeUInt16BE(type, 0)
  buf.writeUInt16BE(value.length, 2)
  value.copy(buf, 4)
  return buf
}

function buildMessage(type, attrs, key, txid = crypto.randomBytes(12)) {
  const body = Buffer.concat(attrs)
  const header = Buffer.alloc(20)
  header.writeUInt16BE(type, 0)
  // The length must already account for MESSAGE-INTEGRITY (4 + 20) when signing.
  header.writeUInt16BE(body.length + (key ? 24 : 0), 2)
  header.writeUInt32BE(MAGIC, 4)
  txid.copy(header, 8)

  const partial = Buffer.concat([header, body])
  if (!key) return { message: partial, txid }

  const digest = crypto.createHmac('sha1', key).update(partial).digest()
  return { message: Buffer.concat([partial, buildAttr(ATTR.MESSAGE_INTEGRITY, digest)]), txid }
}

function parseMessage(buffer) {
  const type = buffer.readUInt16BE(0)
  const length = buffer.readUInt16BE(2)
  const attrs = {}
  let offset = 20
  while (offset + 4 <= 20 + length) {
    const attrType = buffer.readUInt16BE(offset)
    const attrLen = buffer.readUInt16BE(offset + 2)
    attrs[attrType] = buffer.subarray(offset + 4, offset + 4 + attrLen)
    offset += 4 + Math.ceil(attrLen / 4) * 4
  }
  return { type, attrs }
}

function readError(attrs) {
  const value = attrs[ATTR.ERROR_CODE]
  if (!value) return null
  return { code: value[2] * 100 + value[3], reason: value.subarray(4).toString('utf8') }
}

function readXorAddress(value) {
  if (!value) return null
  const port = value.readUInt16BE(2) ^ (MAGIC >>> 16)
  if (value[1] === 0x01) {
    const raw = value.readUInt32BE(4) ^ MAGIC
    return `${[(raw >>> 24) & 255, (raw >>> 16) & 255, (raw >>> 8) & 255, raw & 255].join('.')}:${port}`
  }
  return `[ipv6]:${port}`
}

function exchange(socket, host, port, message, txid, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`no response from ${host}:${port} within ${timeout}ms`))
    }, timeout)

    function onMessage(buffer) {
      if (buffer.length < 20 || !buffer.subarray(8, 20).equals(txid)) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(parseMessage(buffer))
    }

    socket.on('message', onMessage)
    socket.send(message, port, host, (err) => {
      if (err) {
        clearTimeout(timer)
        socket.off('message', onMessage)
        reject(err)
      }
    })
  })
}

/** Pulls a udp-capable host/port out of the configured TURN url list. */
function pickTarget(urls) {
  for (const raw of urls.split(',').map((url) => url.trim())) {
    // turns: is TLS-only, which this UDP probe cannot speak.
    const match = /^turn:([^:?]+)(?::(\d+))?/.exec(raw)
    if (match) return { host: match[1], port: Number(match[2] ?? 3478), url: raw }
  }
  return null
}

const env = loadEnv()
const urls = env.VITE_TURN_URLS
const username = env.VITE_TURN_USERNAME
const password = env.VITE_TURN_CREDENTIAL

if (!urls || !username || !password) {
  console.error('\n✗ No TURN credentials found.\n')
  console.error('  Create .env.local in the project root with:\n')
  console.error('    VITE_TURN_URLS=turn:global.relay.metered.ca:80,...')
  console.error('    VITE_TURN_USERNAME=...')
  console.error('    VITE_TURN_CREDENTIAL=...\n')
  console.error('  See .env.example. Credentials come from your TURN provider dashboard.\n')
  process.exit(1)
}

const target = pickTarget(urls)
if (!target) {
  console.error(`\n✗ No plain turn: url to probe in VITE_TURN_URLS (found: ${urls})\n`)
  process.exit(1)
}

console.log(`\nTURN check → ${target.host}:${target.port} (from ${target.url})`)
console.log(`  username: ${username.slice(0, 4)}…${username.slice(-2)}\n`)

const socket = dgram.createSocket('udp4')
let failed = false

try {
  const transport = buildAttr(ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]))

  // 1. Unauthenticated Allocate — the server must challenge us.
  const probe = buildMessage(TYPE.ALLOCATE, [transport])
  const challenge = await exchange(socket, target.host, target.port, probe.message, probe.txid)
  const challengeError = readError(challenge.attrs)
  const realm = challenge.attrs[ATTR.REALM]?.toString('utf8')
  const nonce = challenge.attrs[ATTR.NONCE]

  if (challengeError?.code !== 401 || !realm || !nonce) {
    console.error(`✗ Unexpected challenge: ${JSON.stringify(challengeError)} realm=${realm}`)
    failed = true
  } else {
    console.log(`  ✓ server reachable, challenged with realm "${realm}"`)

    // 2. Authenticated Allocate, signed with the long-term credential key.
    const key = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest()

    const allocate = async (currentNonce) => {
      const authed = buildMessage(
        TYPE.ALLOCATE,
        [
          transport,
          buildAttr(ATTR.USERNAME, Buffer.from(username, 'utf8')),
          buildAttr(ATTR.REALM, Buffer.from(realm, 'utf8')),
          buildAttr(ATTR.NONCE, currentNonce),
        ],
        key,
      )
      return exchange(socket, target.host, target.port, authed.message, authed.txid)
    }

    let result = await allocate(nonce)
    let resultError = readError(result.attrs)

    // Servers rotate nonces; a 438 just means "use this newer one".
    if (resultError?.code === 438 && result.attrs[ATTR.NONCE]) {
      console.log('  · nonce was stale, retrying with the fresh one')
      result = await allocate(result.attrs[ATTR.NONCE])
      resultError = readError(result.attrs)
    }

    if (result.type === 0x0103) {
      const relayed = readXorAddress(result.attrs[ATTR.XOR_RELAYED_ADDRESS])
      const lifetime = result.attrs[ATTR.LIFETIME]?.readUInt32BE(0)
      console.log(`  ✓ credentials accepted`)
      console.log(`  ✓ relay allocated at ${relayed} (lifetime ${lifetime}s)`)
      console.log('\n✓ TURN is working. Collaborative shots can cross strict networks.\n')

      // Hand the allocation straight back rather than leaving it to time out.
      const release = buildMessage(
        TYPE.REFRESH,
        [
          buildAttr(ATTR.LIFETIME, Buffer.from([0, 0, 0, 0])),
          buildAttr(ATTR.USERNAME, Buffer.from(username, 'utf8')),
          buildAttr(ATTR.REALM, Buffer.from(realm, 'utf8')),
          buildAttr(ATTR.NONCE, nonce),
        ],
        key,
      )
      await exchange(socket, target.host, target.port, release.message, release.txid, 2000).catch(
        () => undefined,
      )
    } else {
      console.error(`  ✗ rejected: ${resultError?.code ?? '?'} ${resultError?.reason ?? ''}`.trim())
      console.error(
        resultError?.code === 401
          ? '\n✗ Wrong username or credential. Re-copy both from the TURN Server page.\n'
          : resultError?.code === 400
            ? '\n✗ The server refused the request. Usually the username is not one it\n' +
              '  recognises — copy it verbatim from the TURN Server page (no quotes,\n' +
              '  no trailing spaces).\n'
            : resultError?.code === 486 || resultError?.code === 508
              ? '\n✗ The account is out of quota or has no allocations left.\n'
              : '\n✗ Allocation failed. Check the account is active and within quota.\n',
      )
      failed = true
    }
  }
} catch (error) {
  console.error(`  ✗ ${error.message}`)
  console.error('\n✗ Could not reach the TURN server over UDP from this machine.\n')
  failed = true
} finally {
  socket.close()
}

process.exit(failed ? 1 : 0)
