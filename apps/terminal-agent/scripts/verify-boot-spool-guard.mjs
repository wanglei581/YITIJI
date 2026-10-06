/**
 * 开机打印防护、服务恢复、每日维护重启的静态合同。
 * 不执行 PowerShell，不碰本机打印服务。六个反向变异各自让本脚本非 0 退出。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const agentRoot = join(scriptDir, '..')
const repoRoot = join(agentRoot, '../..')

const guard = readFileSync(join(agentRoot, 'installer/provision/boot-spool-guard.ps1'), 'utf8')
const guardTask = readFileSync(join(agentRoot, 'installer/provision/boot-spool-guard-task.ps1'), 'utf8')
const daily = readFileSync(join(agentRoot, 'installer/provision/daily-reboot.ps1'), 'utf8')
const dailyTask = readFileSync(join(agentRoot, 'installer/provision/daily-reboot-task.ps1'), 'utf8')
const installer = readFileSync(join(agentRoot, 'scripts/install-production-agent.ps1'), 'utf8')
const serviceXml = readFileSync(join(agentRoot, 'installer/bootstrap/aijobprintagent.xml'), 'utf8')
const controlCenter = readFileSync(join(agentRoot, 'installer/provision/terminal-control-center.ps1'), 'utf8')
const evidence = readFileSync(join(agentRoot, 'scripts/collect-field-evidence.ps1'), 'utf8')
const pkg = readFileSync(join(agentRoot, 'package.json'), 'utf8')
const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const windowsCi = readFileSync(join(repoRoot, '.github/workflows/windows-agent-installer.yml'), 'utf8')

function sliceBetween(text, start, end, label) {
  const from = text.indexOf(start)
  assert.notEqual(from, -1, `${label}: missing ${start}`)
  const to = text.indexOf(end, from + start.length)
  assert.notEqual(to, -1, `${label}: missing ${end}`)
  return text.slice(from, to)
}

function functionBody(text, name) {
  const signature = `function ${name}`
  const start = text.indexOf(signature)
  assert.notEqual(start, -1, `missing function ${name}`)
  const brace = text.indexOf('{', start)
  assert.notEqual(brace, -1, `missing body for ${name}`)
  let depth = 0
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(brace + 1, i)
    }
  }
  assert.fail(`unclosed function ${name}`)
}

function splitElse(block, label) {
  const marker = '} else {'
  const at = block.indexOf(marker)
  assert.notEqual(at, -1, `${label}: missing else`)
  assert.equal(block.indexOf(marker, at + marker.length), -1, `${label}: more than one else`)
  return { when: block.slice(0, at), otherwise: block.slice(at + marker.length) }
}

const logBody = functionBody(guard, 'Write-BootSpoolGuardLog')
assert.doesNotMatch(logBody, /FullName|\$child|Extension|\.spl|\.shd|\.tmp|Get-ChildItem|File\]::Delete/i, '日志不写文件名')
assert.match(logBody, /boot-spool-guard: spooler already running, skipped/)
assert.match(logBody, /boot-spool-guard result=\$Result removed=\$RemovedCount/)

assert.doesNotMatch(guard, /-Recurse\b/, '不清递归')
assert.doesNotMatch(guard, /\bRemove-Item\b/, '不删目录本身')
assert.equal((guard.match(/File\]::Delete/g) || []).length, 1, '只删一次，且只删文件')
assert.match(guard, /Get-ChildItem -LiteralPath \$printersDir -Force -File/)
assert.match(guard, /OrdinalIgnoreCase/)
assert.match(guard, /\$allowedExtensions = @\("\.spl", "\.shd", "\.tmp"\)/)
assert.match(guard, /\[System\.IO\.FileAttributes\]::ReparsePoint/)

const skippedAt = guard.indexOf('Write-Output "boot-spool-guard: spooler already running, skipped"')
const runningExitAt = guard.indexOf('exit 0', skippedAt)
const deleteAt = guard.indexOf('[System.IO.File]::Delete')
const childAt = guard.indexOf('Get-ChildItem')
assert.ok(skippedAt >= 0 && runningExitAt > skippedAt, 'Spooler 已在运行时必须先退出')
assert.ok(runningExitAt < childAt && runningExitAt < deleteAt, '退出必须写在列举和删除之前')
const runningBranch = guard.slice(skippedAt, runningExitAt)
assert.doesNotMatch(runningBranch, /File\]::Delete|Get-ChildItem/, 'Spooler 已在运行时的分支里不能删')

const failedAt = guard.indexOf('if ($deleteFailed)')
const startAt = guard.indexOf('Start-Service -Name "Spooler"')
assert.ok(failedAt >= 0 && startAt > failedAt, '删除失败的出口必须在启动 Spooler 之前')
const failedBranch = guard.slice(failedAt, startAt)
assert.match(failedBranch, /exit 1/, '删除失败必须退出')
assert.doesNotMatch(failedBranch, /Start-Service/, '删除失败时不启动 Spooler')
assert.equal((guard.match(/Start-Service -Name "Spooler"/g) || []).length, 1)

const bootInstall = sliceBetween(installer, '# boot-spool-guard-install-begin', '# boot-spool-guard-install-end', 'boot install')
const bootBranches = splitElse(bootInstall, 'boot install')
assert.match(bootBranches.when, /\$KeepPrinterQueueUnpaused/)
assert.match(bootBranches.when, /Uninstall-BootSpoolGuard/)
assert.doesNotMatch(bootBranches.when, /Install-BootSpoolGuard/, '工作电脑模式必须回退，不能安装防护')
assert.match(bootBranches.otherwise, /Install-BootSpoolGuard/)
assert.doesNotMatch(bootBranches.otherwise, /Uninstall-BootSpoolGuard/)

const dailyInstall = sliceBetween(installer, '# daily-reboot-install-begin', '# daily-reboot-install-end', 'daily install')
const dailyBranches = splitElse(dailyInstall, 'daily install')
assert.match(dailyBranches.when, /\$dailyRebootMode -eq "off"/)
assert.match(dailyBranches.when, /Uninstall-DailyRebootTask/)
assert.doesNotMatch(dailyBranches.when, /Install-DailyRebootTask/, '-DailyRebootAt off 不注册任务')
assert.match(dailyBranches.otherwise, /Install-DailyRebootTask/)
assert.match(installer, /\[string\]\$DailyRebootAt = "04:30"/)
assert.equal((installer.match(/"04:30"/g) || []).length, 1, '时间格式不对时不能悄悄改回默认')
assert.match(installer, /Fail "DailyRebootAt must be HH:mm between 00:00 and 23:59, or off"/)

assert.match(installer, /restart\/60000\/restart\/300000\/restart\/1800000/)
assert.match(serviceXml, /<onfailure action="restart" delay="1800 sec" \/>/)
assert.doesNotMatch(serviceXml, /action="none"/, '第三次及以后仍要重启，不能停在 none')
assert.match(installer, /failureflag/)

assert.match(guardTask, /New-ScheduledTaskTrigger -AtStartup/)
assert.match(guardTask, /UserId "SYSTEM"/)
assert.match(guardTask, /-ExecutionTimeLimit \(New-TimeSpan -Minutes 3\)/)
assert.match(guardTask, /-RestartCount 0/)
assert.match(guardTask, /start=", "demand"/)
assert.match(guardTask, /start=", "auto"/)
assert.match(dailyTask, /-ExecutionTimeLimit \(New-TimeSpan -Minutes 45\)/)
assert.match(dailyTask, /-RestartCount 0/)
assert.match(dailyTask, /New-ScheduledTaskTrigger -Daily -At \$At/)

const rebootOut = daily.indexOf('Write-Output "reboot"')
const shutdownAt = daily.indexOf('shutdown.exe')
assert.ok(rebootOut >= 0 && shutdownAt > rebootOut)
assert.match(daily.slice(rebootOut, shutdownAt), /exit 0/, '-DryRun 打印 reboot 后必须退出，不能关机')
assert.match(daily, /\[switch\]\$DryRun/)
assert.match(daily, /Write-Output "postpone"/)
assert.match(daily, /Start-Sleep -Seconds 600/)
assert.match(daily, /\$attempt -ge 3 -or \$DryRun/)
assert.match(daily, /daily-reboot result=\$Result/)
assert.doesNotMatch(functionBody(daily, 'Write-DailyRebootLog'), /FullName|\$printerName|printerName/)

assert.match(controlCenter, /开机打印防护：已开启/)
assert.match(controlCenter, /开机打印防护：未开启/)
assert.match(controlCenter, /每日维护重启：/)
assert.match(controlCenter, /AIJobPrintBootSpoolGuard/)
assert.match(controlCenter, /\[string\]\$spoolerService\.StartType -eq "Manual"/)

assert.match(evidence, /5\.6-22/)
assert.match(evidence, /5\.6-23/)
assert.match(evidence, /5\.6-24/)
assert.match(evidence, /qtriggerinfo Spooler/)
assert.match(evidence, /LastTaskResult/)
assert.doesNotMatch(evidence, /\bRemove-Item\b/)

assert.match(pkg, /"verify:boot-spool-guard":/)
assert.match(pkg, /"verify:boot-spool-guard-windows":/)
assert.match(ci, /pnpm run verify:boot-spool-guard/)
assert.match(windowsCi, /verify:boot-spool-guard-windows/)

console.log('ALL PASS: boot spool guard static contract')
