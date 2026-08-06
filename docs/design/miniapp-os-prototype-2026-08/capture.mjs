import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const outputDir = join(here, 'captures')
const ids = [
  'G00',
  'T01',
  'T02',
  ...Array.from({ length: 15 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 7 }, (_, i) => `U${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`),
]

mkdirSync(outputDir, { recursive: true })

for (const id of ids) {
  const target = `${pathToFileURL(join(here, 'index.html')).href}?capture=1#screen=${id}`
  const output = join(outputDir, `${id}.png`)
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=390,844',
      '--virtual-time-budget=800',
      `--screenshot=${output}`,
      target,
    ],
    { encoding: 'utf8' }
  )

  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Failed to capture ${id}\n`)
    process.exit(result.status || 1)
  }
  process.stdout.write(`captured ${id}\n`)
}
