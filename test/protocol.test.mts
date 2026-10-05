/**
 * Wire-format checks for collaborative shots. Run with `npm test`.
 *
 * These cover the parts that are easy to get subtly wrong and impossible to
 * eyeball: photo chunking, invite-code parsing, and which strip slot each
 * person owns.
 */
import {
  CHUNK_SIZE,
  CODE_LENGTH,
  createBoothCode,
  parseBoothCode,
  planChunks,
  slotFor,
} from '../src/lib/duo-protocol.ts'

const results: { name: string; pass: boolean }[] = []
const check = (name: string, pass: boolean, detail = '') => {
  results.push({ name, pass })
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('\nchunking')
const fakePhoto = 'data:image/jpeg;base64,' + 'Zm9vYmFy'.repeat(40_000) // ~320KB, bigger than one message
const parts = planChunks(fakePhoto)
check('splits a photo into several chunks', parts.length === Math.ceil(fakePhoto.length / CHUNK_SIZE), `${parts.length} chunks`)
check('every chunk fits in one datachannel message', parts.every((part) => part.length <= CHUNK_SIZE))
check('rejoining is lossless', parts.join('') === fakePhoto)

const tiny = planChunks('data:image/jpeg;base64,AAAA')
check('a small photo stays one chunk', tiny.length === 1 && tiny[0] === 'data:image/jpeg;base64,AAAA')
check('empty input yields no chunks', planChunks('').length === 0)

const received = new Array<string>(parts.length).fill('')
for (const index of [...parts.keys()].reverse()) received[index] = parts[index]
check('reassembly is order-independent', received.join('') === fakePhoto)

console.log('\nbooth codes')
const code = createBoothCode()
check('generated codes are the right length', code.length === CODE_LENGTH, code)
check('generated codes avoid lookalike characters', !/[OI01]/.test(code), code)
check('parses a bare code', parseBoothCode('abc123') === 'ABC123')
check('parses an invite url', parseBoothCode('http://localhost:5173/?booth=XY7K9Q') === 'XY7K9Q')
check(
  'parses a url carrying other params',
  parseBoothCode('https://booth.example.com/?utm=x&booth=abc123&z=1') === 'ABC123',
)
check('trims and upcases', parseBoothCode('  xy7k9q  ') === 'XY7K9Q')
check('rejects empty input', parseBoothCode('') === null)
check('rejects a too-short code', parseBoothCode('ab') === null)
check('rejects a url with no booth param', parseBoothCode('https://example.com/') === null)

console.log('\nstrip slots')
check('host takes the left column', slotFor(0, true) === 0 && slotFor(3, true) === 6)
check('guest takes the right column', slotFor(0, false) === 1 && slotFor(3, false) === 7)

const claimed = new Set<number>()
for (let round = 0; round < 4; round++) {
  claimed.add(slotFor(round, true))
  claimed.add(slotFor(round, false))
}
check('a 4-shot duo session fills all 8 slots exactly once', claimed.size === 8)

const failed = results.filter((result) => !result.pass)
console.log(`\nprotocol: ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
