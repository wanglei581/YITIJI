import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(packageRoot, '.tmp', 'runtime-verify')

rmSync(outDir, { force: true, recursive: true })
execFileSync(
  'pnpm',
  [
    'exec',
    'tsc',
    '--target',
    'ES2020',
    '--module',
    'ES2020',
    '--moduleResolution',
    'Bundler',
    '--skipLibCheck',
    '--strict',
    '--outDir',
    outDir,
    '--rootDir',
    join(packageRoot, 'src'),
    join(packageRoot, 'src', 'merge.ts'),
    join(packageRoot, 'src', 'store.ts'),
  ],
  { cwd: packageRoot, stdio: 'inherit' },
)

const { mergeById, replaceIfChanged } = await import(pathToFileURL(join(outDir, 'merge.js')))
const { RefreshStore } = await import(pathToFileURL(join(outDir, 'store.js')))

const unchangedRows = [
  { id: 'a', label: 'Terminal A' },
  { id: 'b', label: 'Terminal B' },
]
const sameRows = [
  { id: 'a', label: 'Terminal A' },
  { id: 'b', label: 'Terminal B' },
]
const sameMerge = mergeById((item) => item.id)(unchangedRows, sameRows)
assert.strictEqual(sameMerge, unchangedRows, 'mergeById keeps the current array when rows are unchanged')

const changedMerge = mergeById((item) => item.id)(unchangedRows, [
  { id: 'a', label: 'Terminal A' },
  { id: 'b', label: 'Terminal B2' },
])
assert.notStrictEqual(changedMerge, unchangedRows, 'mergeById returns a new array when one row changes')
assert.strictEqual(changedMerge[0], unchangedRows[0], 'mergeById preserves unchanged row references')
assert.notStrictEqual(changedMerge[1], unchangedRows[1], 'mergeById replaces changed row references')

const idleStore = new RefreshStore()
let idleFetchCount = 0
idleStore.setIdleMs(15_000)
idleStore.markUserActivity(1_000)
idleStore.register({
  key: 'admin:terminals',
  fetcher: async () => ({ value: ++idleFetchCount }),
  intervalMs: 1_000,
  merge: replaceIfChanged,
  failPolicy: 'keep-last',
})

idleStore.tick(15_999)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(idleFetchCount, 0, 'automatic refresh is blocked before 15 seconds of user inactivity')

idleStore.tick(16_000)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(idleFetchCount, 1, 'automatic refresh starts after 15 seconds of user inactivity')

const snapshotStore = new RefreshStore()
let snapshotFetchCount = 0
snapshotStore.register({
  key: 'admin:snapshot',
  fetcher: async () => ({ value: ++snapshotFetchCount }),
  intervalMs: 1_000,
  merge: replaceIfChanged,
  failPolicy: 'keep-last',
})
const snapshotBeforeRefresh = snapshotStore.getSnapshot('admin:snapshot')
await snapshotStore.refresh('admin:snapshot')
const snapshotAfterRefresh = snapshotStore.getSnapshot('admin:snapshot')
assert.notStrictEqual(snapshotAfterRefresh, snapshotBeforeRefresh, 'store publishes a new snapshot object after data changes')
assert.deepEqual(snapshotAfterRefresh?.data, { value: 1 }, 'new snapshot contains refreshed data')

const lockStore = new RefreshStore()
let lockFetchCount = 0
lockStore.register({
  key: 'admin:orders',
  fetcher: async () => ({ value: ++lockFetchCount }),
  intervalMs: 1_000,
  merge: replaceIfChanged,
  failPolicy: 'keep-last',
})
await lockStore.refresh('admin:orders')
const initialSnapshot = lockStore.getSnapshot('admin:orders')
assert.deepEqual(initialSnapshot?.data, { value: 1 })

let hardLockEmits = 0
lockStore.subscribe('admin:orders', () => {
  hardLockEmits += 1
})
const releaseHardLock = lockStore.lock('admin:orders', 'hard')
await lockStore.refresh('admin:orders')
const lockedSnapshot = lockStore.getSnapshot('admin:orders')
assert.deepEqual(lockedSnapshot?.data, { value: 1 }, 'hard lock keeps current data visible')
assert.deepEqual(lockedSnapshot?.pending, { value: 2 }, 'hard lock stores incoming data in pending buffer')
assert.equal(hardLockEmits, 0, 'hard lock does not notify subscribers while buffering incoming data')

releaseHardLock()
const releasedSnapshot = lockStore.getSnapshot('admin:orders')
assert.deepEqual(releasedSnapshot?.data, { value: 2 }, 'releasing hard lock applies pending data')
assert.equal(releasedSnapshot?.pending, undefined, 'releasing hard lock clears pending data')
assert.equal(hardLockEmits, 1, 'releasing hard lock notifies subscribers once')

const cleanupStore = new RefreshStore()
const unregisterCleanup = cleanupStore.register({
  key: 'admin:orders:page:stale',
  fetcher: async () => ({ value: 'stale' }),
  intervalMs: 1_000,
  merge: replaceIfChanged,
  failPolicy: 'keep-last',
})
const unsubscribeCleanup = cleanupStore.subscribe('admin:orders:page:stale', () => {})
assert.ok(cleanupStore.getSnapshot('admin:orders:page:stale'), 'registered resource creates an entry')
unregisterCleanup()
assert.ok(cleanupStore.getSnapshot('admin:orders:page:stale'), 'entry remains while a subscriber is active')
unsubscribeCleanup()
assert.equal(cleanupStore.getSnapshot('admin:orders:page:stale'), undefined, 'orphan entry is removed after unregister and unsubscribe')

const focusStore = new RefreshStore()
focusStore.setIdleMs(0)
let focusFetchCount = 0
focusStore.register({
  key: 'admin:printers',
  fetcher: async () => ({ value: ++focusFetchCount }),
  intervalMs: 10_000,
  merge: replaceIfChanged,
  failPolicy: 'keep-last',
})
await focusStore.refresh('admin:printers')
focusStore.refreshOnFocus()
await new Promise((resolve) => setTimeout(resolve, 10))
assert.equal(focusFetchCount, 1, 'focus refresh skips resources fetched before nextFetchAt')

console.log('verify:refresh-runtime passed')
