import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../packages/refresh/src', import.meta.url))
const forbidden = [
  'useNavigate',
  'navigate(',
  'RouterProvider',
  'createBrowserRouter',
  'window.location',
  'history.pushState',
  'Drawer',
  'drawer',
  'modal',
  'Modal',
  'dialog',
  'Dialog',
]

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    const stat = statSync(path)
    return stat.isDirectory() ? files(path) : [path]
  })
}

let failed = false
for (const file of files(root)) {
  const text = readFileSync(file, 'utf8')
  for (const token of forbidden) {
    if (text.includes(token)) {
      console.error(`refresh package must not reference ${token}: ${file}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log('verify:refresh-safe passed')
