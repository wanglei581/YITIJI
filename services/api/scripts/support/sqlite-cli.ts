/**
 * 门禁脚本调用 sqlite3 命令行的统一入口。
 *
 * 为什么有这个文件：2026-09-29 CI（run 36548694035，verify:scan-tasks）偶发
 * `Error: in prepare, database is locked (5)`。现场是 verify-scan-tasks.ts 的
 * assertSqliteRetryHardeningUpgrade：刚跑完一次「预期失败」的 `prisma migrate deploy`，
 * 紧接着用 sqlite3 读同一个 duplicate-*.db。prisma 命令行进程已经退出，但它拉起的
 * 迁移引擎还没完全放手这个库；sqlite3 默认 busy timeout 为 0，碰到锁立刻报错。
 *
 * 两层处理，都在这里：
 *   1. 每次 sqlite3 调用都带 `.timeout`（busy timeout），碰到短暂的锁就等，不立刻失败；
 *   2. `waitForSqliteRelease()`：prisma 子进程跑完后，先拿一次 EXCLUSIVE 锁再回滚 ——
 *      拿得到就说明别的连接都已经放手，再往下读结构。
 * 另有 `assertSqliteCliWaitsForTransientLock()` 自检：另起一个 sqlite3 进程真实持锁，
 * 先做阳性对照（不带 timeout 必报 locked），再确认本文件的调用能等到锁释放。
 *
 * 为什么不直接写进 verify-scan-tasks.ts：那个文件已 5000+ 行（>1000 只减不增），
 * 抽出来后它反而变短；以后别的门禁要用 sqlite3 命令行也从这里取，不再各写一份不带 timeout 的。
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const SQLITE_CLI_BUSY_TIMEOUT_MS = 5000

const BUSY_TIMEOUT_ARGS = ['-cmd', `.timeout ${SQLITE_CLI_BUSY_TIMEOUT_MS}`]

/** 执行一条（或几条）SQL，返回去掉首尾空白的输出；列之间用 `|` 分隔，无表头。 */
export function sqliteQuery(databasePath: string, sql: string): string {
  return execFileSync(
    'sqlite3',
    [...BUSY_TIMEOUT_ARGS, '-batch', '-noheader', '-separator', '|', databasePath, sql],
    { encoding: 'utf8' },
  ).trim()
}

/** 从标准输入执行一段 SQL 脚本，任一语句失败即中止（-bail）。 */
export function sqliteExecScript(databasePath: string, script: string): void {
  execFileSync('sqlite3', [...BUSY_TIMEOUT_ARGS, '-bail', databasePath], {
    input: script,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/**
 * 等所有别的连接放手这个库（典型是刚退出的 prisma migrate 子进程留下的迁移引擎）。
 * 做法是拿一次 EXCLUSIVE 锁并立即回滚：拿得到说明没有任何连接还持有锁。
 */
export function waitForSqliteRelease(databasePath: string): void {
  sqliteQuery(databasePath, 'BEGIN EXCLUSIVE; ROLLBACK;')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 自检：另起一个 sqlite3 进程持 EXCLUSIVE 锁约 1.5 秒。
 *   - 阳性对照：不带 busy timeout 的 sqlite3 此时必须报 `database is locked`，证明锁是真的；
 *   - 被测：sqliteQuery / waitForSqliteRelease 必须等到锁释放后成功。
 * `sourceFilesThatMustNotBypass` 里的门禁源码不许再直接 execFileSync('sqlite3', ...)，
 * 否则又会绕过 busy timeout。
 */
export async function assertSqliteCliWaitsForTransientLock(
  sourceFilesThatMustNotBypass: readonly string[] = [],
): Promise<void> {
  for (const file of sourceFilesThatMustNotBypass) {
    const source = readFileSync(file, 'utf8')
    assert.equal(
      /(?:execFileSync|spawnSync|execSync|spawn)\(\s*['"]sqlite3['"]/.test(source),
      false,
      `${path.basename(file)} must call sqlite3 through scripts/support/sqlite-cli.ts (busy timeout), not directly`,
    )
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'verify-sqlite-cli-lock-'))
  const databasePath = path.join(dir, 'lock.db')
  const holders: ReturnType<typeof spawn>[] = []

  /**
   * 另起 sqlite3 进程持 EXCLUSIVE 锁，拿到锁之后才返回。退出 Promise 必须包在对象里返回：
   * async 函数直接 return 一个 Promise 会被展开，调用方的 await 就会一直等到持锁进程退出。
   */
  const holdExclusiveLock = async (round: string): Promise<{ exited: Promise<number | null> }> => {
    const lockedMarker = path.join(dir, `locked-${round}`)
    const holder = spawn(
      'sqlite3',
      [...BUSY_TIMEOUT_ARGS, databasePath, 'BEGIN EXCLUSIVE;', `.shell touch '${lockedMarker}' && sleep 1.5`, 'COMMIT;'],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    holders.push(holder)
    const exited = new Promise<number | null>((resolve) => holder.once('exit', (code) => resolve(code)))
    const deadline = Date.now() + 5000
    while (!existsSync(lockedMarker)) {
      assert.ok(Date.now() < deadline, `sqlite lock holder (${round}) never acquired its EXCLUSIVE lock`)
      await sleep(20)
    }
    // 阳性对照：不带 busy timeout 的 sqlite3 此刻必须报 locked，证明锁是真的（否则下面的「等到了」不说明任何事）。
    const control = spawnSync('sqlite3', ['-batch', databasePath, 'SELECT COUNT(*) FROM t;'], { encoding: 'utf8' })
    assert.ok(
      control.status !== 0 && /database is locked/.test(control.stderr),
      `positive control (${round}): sqlite3 without busy timeout must fail while the lock is held (status=${control.status})`,
    )
    return { exited }
  }

  try {
    execFileSync('sqlite3', [...BUSY_TIMEOUT_ARGS, databasePath, 'CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);'])

    const queryRound = await holdExclusiveLock('query')
    let startedAt = Date.now()
    assert.equal(sqliteQuery(databasePath, 'SELECT COUNT(*) FROM t;'), '1', 'sqliteQuery must wait for a transient lock and then read')
    assert.ok(Date.now() - startedAt >= 200, 'sqliteQuery returned before the lock holder released')
    assert.equal(await queryRound.exited, 0, 'sqlite lock holder (query) must commit cleanly')

    const releaseRound = await holdExclusiveLock('release')
    startedAt = Date.now()
    waitForSqliteRelease(databasePath)
    assert.ok(Date.now() - startedAt >= 200, 'waitForSqliteRelease returned while another connection still held the lock')
    assert.equal(await releaseRound.exited, 0, 'sqlite lock holder (release) must commit cleanly')

    const execRound = await holdExclusiveLock('exec')
    startedAt = Date.now()
    sqliteExecScript(databasePath, 'INSERT INTO t VALUES (2);')
    assert.ok(Date.now() - startedAt >= 200, 'sqliteExecScript returned before the lock holder released')
    assert.equal(await execRound.exited, 0, 'sqlite lock holder (exec) must commit cleanly')
    assert.equal(sqliteQuery(databasePath, 'SELECT COUNT(*) FROM t;'), '2', 'sqliteExecScript must apply its script')
    console.log('PASS sqlite3 CLI waits out a transient lock held by another process (positive control: no-timeout call fails)')
  } finally {
    for (const holder of holders) if (holder.exitCode === null) holder.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
}
