/** Boots a throwaway signaling server, runs every test file, cleans up. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const PORT = process.env.SIGNAL_TEST_PORT ?? '8788'

const server = spawn('node', [join(root, 'server', 'index.js')], {
  env: { ...process.env, PORT },
  stdio: 'ignore',
})

const ready = async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://localhost:${PORT}/health`)
      if (response.ok) return true
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn('node', [join(here, file)], {
      env: { ...process.env, SIGNAL_TEST_PORT: PORT },
      stdio: 'inherit',
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })

let failures = 0

if (!(await ready())) {
  console.error('signaling server never came up')
  failures = 1
} else {
  failures += await run('protocol.test.mts')
  failures += await run('signal.test.mjs')
  failures += await run('relay.test.mts')
}

server.kill()
console.log(failures ? '\nFAILED' : '\nAll tests passed ✨')
process.exit(failures ? 1 : 0)
