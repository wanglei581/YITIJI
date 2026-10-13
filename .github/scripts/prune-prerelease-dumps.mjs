#!/usr/bin/env node
// 发布与每日备份共用。调用方负责 flock；本文件只处理发布前导出与清理状态。
import { readdirSync, statSync, existsSync, writeFileSync, renameSync, unlinkSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const value = (flag) => {
  const i = args.indexOf(flag)
  return i < 0 ? undefined : args[i + 1]
}
const root = value('--root')
if (!root || args.filter((arg) => arg === '--root').length !== 1) {
  console.error('用法：prune-prerelease-dumps.mjs --root <备份目录> [--dry-run|--event skipped]')
  process.exit(2)
}
const dryRun = args.includes('--dry-run')
const event = value('--event')
const now = new Date()
const today = now.toISOString().slice(0, 10)
const statePath = join(root, '.prune-last-success')
const alertEnvFile = value('--alert-env-file')
const alertUrl = (() => {
  if (process.env.PRERELEASE_ALERT_WEBHOOK_URL) return process.env.PRERELEASE_ALERT_WEBHOOK_URL
  if (!alertEnvFile || !existsSync(alertEnvFile)) return ''
  const line = readFileSync(alertEnvFile, 'utf8').split('\n').find((entry) => /^ALERT_WEBHOOK_URL=/.test(entry))
  return line ? line.slice('ALERT_WEBHOOK_URL='.length).trim().replace(/^"|"$/g, '') : ''
})()
function alert(message) {
  console.error(`PRERELEASE_WARN: ${message}`)
  if (!alertUrl) return
  const payload = JSON.stringify({ msgtype: 'text', text: { content: `【职易达告警】${message}（${today}）` } })
  const sent = spawnSync('curl', ['--silent', '--show-error', '--max-time', '10', '-X', 'POST', '-H', 'Content-Type: application/json', '--data-raw', payload, alertUrl], { stdio: 'ignore' })
  if (sent.status !== 0) console.error('PRERELEASE_ALERT_ERROR: webhook notification failed')
}
function readState() {
  if (!existsSync(statePath)) return null
  const data = readFileSync(statePath, 'utf8').trim()
  if (!/^first_seen=\d{4}-\d{2}-\d{2}(\nlast_success=\d{4}-\d{2}-\d{2})?$/.test(data)) throw new Error('清理状态文件格式错误')
  return Object.fromEntries(data.split('\n').map((line) => line.split('=')))
}
function writeState(state) {
  const temp = `${statePath}.${process.pid}.partial`
  writeFileSync(temp, `first_seen=${state.first_seen}\n${state.last_success ? `last_success=${state.last_success}\n` : ''}`, { mode: 0o644 })
  chmodSync(temp, 0o644)
  renameSync(temp, statePath)
}
function missedTwoDays(state) {
  if (!state) return false // 上线第一天没有状态文件，不推连续失败告警。
  const base = state.last_success ?? state.first_seen
  const elapsed = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86400000
  return elapsed >= (state.last_success ? 2 : 1)
}
function failure(reason) {
  const prior = readState()
  if (!prior) {
    // 跳过事件没有锁；排他创建避免覆盖刚刚由发布写入的成功日期。
    try { writeFileSync(statePath, `first_seen=${today}\n`, { flag: 'wx', mode: 0o644 }); chmodSync(statePath, 0o644) }
    catch (error) { if (error?.code !== 'EEXIST') throw error }
  }
  console.log(`PRERELEASE_SKIP: ${reason}`)
  if (missedTwoDays(prior)) alert(`发布前导出连续两天未清成：${reason}`)
}
function stampOf(stem) {
  const match = /^pre-.+-(\d{8}T\d{6}Z)$/.exec(stem)
  if (!match) return null
  const raw = match[1]
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) && new Date(ms).toISOString() === iso.replace('Z', '.000Z') ? ms : null
}
function containsStorageFiles(stem) {
  const storage = join(root, `${stem}.runtime`, 'services/api/storage')
  if (!existsSync(storage)) return false
  const visit = (path) => readdirSync(path, { withFileTypes: true }).some((entry) => entry.isFile() || (entry.isDirectory() && visit(join(path, entry.name))))
  return visit(storage)
}
function listStems(names) {
  return [...new Set(names.filter((name) => /\.(dump|dump\.expired|runtime|ok|migrations\.log|dump\.partial|runtime\.partial)$/.test(name))
    .map((name) => name.replace(/\.(dump\.partial|runtime\.partial|migrations\.log|dump\.expired|dump|runtime|ok)$/, '')))].filter(Boolean)
}
function run() {
  if (event === 'skipped') { failure('发布锁占用，本日跳过'); return }
  if (event) throw new Error(`未知事件：${event}`)
  const names = readdirSync(root)
  const stems = listStems(names)
  if (args.includes('--list-stems')) {
    const groupTime = (stem) => stampOf(stem) ?? Math.max(...names.filter((name) => name.startsWith(`${stem}.`)).map((name) => statSync(join(root, name)).mtimeMs))
    stems.sort((a, b) => groupTime(b) - groupTime(a) || b.localeCompare(a))
    for (const stem of stems) console.log(stem)
    return
  }
  if (!dryRun) readState() // 状态损坏时先失败告警，不做半次删除。
  const cutoff = now.getTime() - 30 * 86400000
  for (const stem of stems) {
    if (!stem.startsWith('pre-')) continue
    const dump = join(root, `${stem}.dump`)
    const dumpPartial = join(root, `${stem}.dump.partial`)
    const partial = names.some((name) => name === `${stem}.dump.partial` || name === `${stem}.runtime.partial`)
    if (dryRun) console.log(`PRERELEASE_DRY_STORAGE: ${stem} storage_has_files=${containsStorageFiles(stem)}`)
    if (existsSync(dumpPartial) && statSync(dumpPartial).mtimeMs <= cutoff) {
      if (dryRun) console.log(`PRERELEASE_DRY_DELETE: ${stem}.dump.partial source=partial-mtime`)
      else {
        writeFileSync(join(root, `${stem}.dump.expired`), `${new Date().toISOString()}\n`, { mode: 0o600 })
        unlinkSync(dumpPartial)
        alert(`发布前半截导出满 30 天已删除：${stem}.dump.partial`)
      }
    }
    if (partial || !existsSync(dump)) continue
    const namedTime = stampOf(stem)
    const ageTime = namedTime ?? statSync(dump).mtimeMs
    if (ageTime > cutoff) continue
    if (dryRun) { console.log(`PRERELEASE_DRY_DELETE: ${stem}.dump source=${namedTime === null ? 'dump-mtime' : 'name-utc'}`); continue }
    if (namedTime === null) alert(`发布前导出组名无法解析 UTC，按 dump 修改时间删除：${stem}`)
    const marker = join(root, `${stem}.dump.expired`)
    // 先留下标记再删除，避免进程在两步之间被杀时把运行目录误判成不完整组。
    writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 })
    unlinkSync(dump)
    console.log(`PRERELEASE_DELETED: ${stem}.dump`)
  }
  if (!dryRun) {
    const prior = readState()
    const successDay = new Date().toISOString().slice(0, 10)
    writeState({ first_seen: prior?.first_seen ?? successDay, last_success: successDay })
    console.log(`PRERELEASE_OK: ${successDay}`)
  }
}
try { run() } catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  if (dryRun || args.includes('--list-stems')) console.error(`PRERELEASE_ERROR: ${reason}`)
  else {
    alert(`发布前导出清理失败：${reason}`)
    try { failure('清理本身失败') } catch (stateError) { console.error(`PRERELEASE_WARN: 状态记录失败：${stateError}`) }
  }
  process.exitCode = 20 // 已由共用脚本告警；shell 只为其他异常退出兜底。
}
