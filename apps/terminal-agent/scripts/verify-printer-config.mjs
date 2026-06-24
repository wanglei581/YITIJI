import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const files = {
  config: path.join(root, 'src/config.ts'),
  index: path.join(root, 'src/index.ts'),
  taskRunner: path.join(root, 'src/agent/task-runner.ts'),
  configManager: path.join(root, 'src/agent/config-manager.ts'),
  print: path.join(root, 'src/printer/print.ts'),
  packageConfigExample: path.join(root, 'config/agent-config.example.json'),
  rootConfigExample: path.join(root, 'agent-config.example.json'),
}

const read = (file) => fs.readFileSync(file, 'utf8')
const readIfExists = (file) => (fs.existsSync(file) ? read(file) : '')
const fail = (message) => {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}
const pass = (message) => console.log(`PASS ${message}`)
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

function listFiles(dir, predicate) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(fullPath, predicate)
    return predicate(fullPath) ? [fullPath] : []
  })
}

const config = read(files.config)
const index = read(files.index)
const taskRunner = read(files.taskRunner)
const configManager = read(files.configManager)
const print = read(files.print)
const packageConfigExample = read(files.packageConfigExample)
const rootConfigExample = readIfExists(files.rootConfigExample)
const sourceFiles = listFiles(path.join(root, 'src'), (file) => file.endsWith('.ts'))
const sourceCode = sourceFiles
  .map((file) => stripComments(read(file)))
  .join('\n')

console.log('\n=== verify terminal-agent printerName config ===')

if (!stripComments(config).includes('DEFAULT_PRINTER') && !stripComments(config).includes('Pantum CM2800ADN Series')) {
  pass('src/config.ts does not export a default real printer model')
} else {
  fail('src/config.ts must not export DEFAULT_PRINTER or hard-code Pantum CM2800ADN Series')
}

if (
  !stripComments(index).includes('DEFAULT_PRINTER') &&
  /\.requiredOption\(\s*['"]--printer\s+<name>['"]/.test(index) &&
  /PRINTER_NAME_REQUIRED/.test(index)
) {
  pass('CLI print command requires --printer and does not import/use DEFAULT_PRINTER')
} else {
  fail('CLI print command must require non-empty --printer and must not import/use DEFAULT_PRINTER')
}

if (!stripComments(taskRunner).includes('DEFAULT_PRINTER') && !/\bprinterName\s*\|\|/.test(stripComments(taskRunner))) {
  pass('task runner does not fall back to a hard-coded printer')
} else {
  fail('task runner must use validated config.printerName without DEFAULT_PRINTER fallback')
}

if (!stripComments(print).includes('DEFAULT_PRINTER') && !/printerName\s*:\s*string\s*=/.test(stripComments(print))) {
  pass('print() requires an explicit printerName argument')
} else {
  fail('print() must not default printerName to DEFAULT_PRINTER')
}

if (
  configManager.includes('validateRequiredConfig') &&
  /requireNonEmpty\(\s*config\.printerName\s*,\s*['"]printerName['"]/.test(configManager)
) {
  pass('loadConfig validates printerName as a required deployment value')
} else {
  fail('loadConfig must validate printerName and explain it must match the Windows printer name')
}

for (const [label, content] of [
  ['config/agent-config.example.json', packageConfigExample],
  ['agent-config.example.json', rootConfigExample],
]) {
  if (!content) continue
  if (content.includes('"printerName": ""') && !content.includes('Pantum CM2800ADN Series')) {
    pass(`${label} forces the operator to fill printerName`)
  } else {
    fail(`${label} must leave printerName empty and avoid hard-coded Pantum values`)
  }
}

if (!sourceCode.includes('DEFAULT_PRINTER') && !sourceCode.includes('Pantum CM2800ADN Series') && !/\bprinterName\s*\|\|/.test(sourceCode)) {
  pass('src/**/*.ts has no executable default-printer fallback')
} else {
  fail('src/**/*.ts must not reintroduce DEFAULT_PRINTER, Pantum hard-coding, or printerName fallback')
}

if (process.exitCode) {
  console.error('\nPrinter config verification failed.')
  process.exit(process.exitCode)
}

console.log('ALL PASS: terminal-agent printerName config')
