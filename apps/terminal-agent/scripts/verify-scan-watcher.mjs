import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 本脚本只做静态/结构性检查（源码里必须存在的关键行为），
// 不直接 import TS 源码执行完整监听逻辑（chokidar 真实监听需要事件循环持续运行，
// 不适合一次性 verify 脚本）；真实监听行为交给 Windows 真机验收覆盖。

const source = readFileSync(new URL('../src/agent/scan-watcher.ts', import.meta.url), 'utf8')

async function main() {
  // --- 基础行为（沿用计划模板，逐条对照当前源码复核过） ---
  assert.match(source, /export function startScanWatcher/, 'must export startScanWatcher')
  assert.match(source, /scanWatchFolder\?\.trim\(\)/, 'must treat unconfigured scanWatchFolder as a no-op, not a crash')
  assert.match(source, /ignoreInitial:\s*true/, 'chokidar watch must ignore pre-existing files at boot (handled separately by sweepFolder)')
  assert.match(source, /NO_WAITING_SCAN_TASK/, 'must special-case the no-match error code')
  assert.match(source, /_unclaimed/, 'must quarantine unmatched files instead of silently dropping or misattributing them')
  assert.match(source, /unlinkSync\(filePath\)/, 'must delete the source file after successful delivery (privacy: no lingering scans in the shared folder)')
  assert.match(source, /setInterval\(\(\) => void sweepFolder/, 'must periodically re-sweep the folder, not rely solely on chokidar change events for retries')

  // --- 并发安全加固（Critical code-review 之后新增，本脚本随之补充覆盖） ---

  // 1. in-flight 去重守卫：必须存在 Set 类型的登记表，且在处理前检查、处理后清理，
  //    否则 chokidar 的实时 `add` 事件与周期性 `sweepFolder` 清点可能并发处理同一个
  //    文件，导致同一份扫描件被投递给两个不同的等待中任务（隐私/串件事故）。
  assert.match(source, /const inFlightPaths\s*=\s*new Set<string>\(\)/, 'must have an in-flight path tracking Set to prevent concurrent double-processing of the same file')
  assert.match(source, /if \(inFlightPaths\.has\(filePath\)\)/, 'must check the in-flight set before processing a candidate, and skip if already in progress')
  assert.match(source, /inFlightPaths\.add\(filePath\)/, 'must register the path as in-flight before doing any async work on it')
  assert.match(source, /inFlightPaths\.delete\(filePath\)/, 'must release the in-flight marker once processing settles (success or failure)')

  // 2. processCandidate 的整体必须被 try/catch/finally 包住：finally 释放
  //    inFlightPaths，catch 兜底任何未预料到的文件系统错误，避免这里抛出的异常
  //    逃逸成 unhandled rejection 把 Agent 进程的全局 process.exit(1) 兜底连累到
  //    心跳/领任务等其它功能。
  assert.match(source, /unexpected error processing candidate, leaving file in place for retry/, 'processCandidate must have an outer catch-all that logs and swallows unexpected errors instead of crashing the agent process')
  assert.match(source, /\}\s*finally\s*\{\s*inFlightPaths\.delete\(filePath\)/, 'the in-flight marker must be released in a finally block so it is cleared even when processing throws')

  // 3. 稳定性检查通过后、真正处理前的二次 existsSync 复查（应对锁定后又被删除、
  //    SMB 短暂断连等文件在处理窗口内消失的情况）。
  assert.match(source, /file disappeared before processing, skipping/, 'must re-check file existence right before reading it, in case it vanished between the stability check and the read')

  // 4. chokidar `add` 事件的调用点必须挂 `.catch(`，因为 processCandidate 是 async
  //    函数，事件回调本身是同步的，不加 .catch 会导致 rejection 逃逸为
  //    unhandled rejection。
  assert.match(source, /processCandidate\(filePath, filename, config\)\.catch\(/, 'the chokidar add-event call site must attach .catch() since the handler itself is not async')

  // 5. sweepFolder 循环内对每个文件的 processCandidate 调用也必须单独 try/catch，
  //    避免清点到一半因为某一个文件处理异常而中断，导致同批次剩余文件全部漏扫。
  assert.match(source, /sweep failed to process .*, continuing with remaining files/, 'sweepFolder must catch per-file errors so one bad file does not abort the rest of the sweep')

  // 6. _unclaimed 隔离目录必须被排除在「待处理」之外两次：
  //    - sweepFolder 周期性清点时按名称跳过，避免把已隔离的文件当成新文件重新处理；
  //    - chokidar 实时监听的 ignored 回调也要排除该目录，避免监听到隔离目录内部的文件变动。
  assert.match(source, /if \(name === UNCLAIMED_DIRNAME\) continue/, 'sweepFolder must skip the _unclaimed quarantine directory itself, not re-process quarantined files')
  assert.match(source, /ignored:\s*\(path: string\) => path\.includes\(UNCLAIMED_DIRNAME\)/, 'chokidar watch must also exclude the _unclaimed quarantine directory from live-watch events')

  // 以下只验证 Node fs API 本身的行为符合 sweepFolder 依赖的假设
  // （readdirSync 返回的 entries 里，普通文件名与子目录名可以用简单的字符串比较区分开），
  // 不是对 scan-watcher.ts 自身跳过逻辑的测试——跳过逻辑由上面两条新增的正则断言覆盖。
  const dir = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-'))
  try {
    writeFileSync(join(dir, 'sample.pdf'), '%PDF-1.4 test')
    const unclaimedDir = join(dir, '_unclaimed')
    mkdirSync(unclaimedDir)
    const entries = readdirSync(dir)
    assert.ok(entries.includes('sample.pdf'))
    assert.ok(entries.includes('_unclaimed'))
    assert.ok(existsSync(unclaimedDir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log('PASS scan-watcher verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
