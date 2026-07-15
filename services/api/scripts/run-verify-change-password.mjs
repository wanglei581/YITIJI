// 为登录态改密写库验证创建并销毁专用 SQLite 数据库。
// 不继承调用者的 DATABASE_URL，避免误写开发、预发或生产数据库。

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const apiRoot = resolve(scriptDir, '..')
const databasePath = resolve(apiRoot, 'prisma/verify-change-password.db')
const databaseUrl = 'file:./prisma/verify-change-password.db'
const artifacts = [databasePath, `${databasePath}-journal`, `${databasePath}-shm`, `${databasePath}-wal`]
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  RUST_BACKTRACE: '1',
  RUST_LOG: 'info',
  VERIFY_CHANGE_PASSWORD_DB_PATH: databasePath,
}
// 当前 Prisma schema engine 在显式 NODE_ENV 下初始化临时 SQLite 会失败；
// 包装器不继承它，安全边界由固定数据库 URL + 绝对路径标记共同保证。
delete env.NODE_ENV

function removeDatabaseArtifacts() {
  for (const artifact of artifacts) rmSync(artifact, { force: true })
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: apiRoot, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 执行失败（exit ${result.status ?? 'unknown'}）`)
}

try {
  removeDatabaseArtifacts()
  run('pnpm', ['exec', 'prisma', 'db', 'push', '--accept-data-loss'])
  run(process.execPath, ['-r', '@swc-node/register', 'scripts/verify-change-password.ts'])
} finally {
  removeDatabaseArtifacts()
}
