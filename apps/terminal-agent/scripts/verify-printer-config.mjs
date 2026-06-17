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
  example: path.join(root, 'config/agent-config.example.json'),
}

const read = (file) => fs.readFileSync(file, 'utf8')
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}
const pass = (message) => console.log(`✓ ${message}`)

const config = read(files.config)
const index = read(files.index)
const taskRunner = read(files.taskRunner)
const configManager = read(files.configManager)
const example = read(files.example)

console.log('\n=== verify printerName config hardening ===')

if (!config.includes('DEFAULT_PRINTER') && !config.includes('Pantum CM2800ADN Series')) {
  pass('config.ts does not hard-code a real printer model')
} else {
  fail('config.ts must not export DEFAULT_PRINTER or hard-code Pantum CM2800ADN Series')
}

if (!index.includes('DEFAULT_PRINTER') && index.includes(".requiredOption('--printer <name>'")) {
  pass('CLI print command requires --printer instead of silently defaulting')
} else {
  fail('CLI print command must require --printer and must not import/use DEFAULT_PRINTER')
}

if (!taskRunner.includes('DEFAULT_PRINTER') && !taskRunner.includes('|| DEFAULT_PRINTER')) {
  pass('task runner never falls back to a hard-coded printer')
} else {
  fail('task runner must fail fast through config validation, not use printerName || DEFAULT_PRINTER')
}

if (
  configManager.includes('validateRequiredConfig') &&
  configManager.includes("requireNonEmpty(config.printerName, 'printerName'") &&
  configManager.includes('Windows 实际识别名')
) {
  pass('loadConfig validates printerName as a required deployment value')
} else {
  fail('loadConfig must validate printerName and explain that it must match the Windows printer name')
}

if (example.includes('"printerName": ""') && !example.includes('Pantum CM2800ADN Series')) {
  pass('example config forces operator to fill printerName')
} else {
  fail('example config must leave printerName empty and avoid hard-coded Pantum values')
}

if (process.exitCode) {
  console.error('\nPrinter config verification failed.')
  process.exit(process.exitCode)
}

console.log('ALL PASS: printerName config hardening')
