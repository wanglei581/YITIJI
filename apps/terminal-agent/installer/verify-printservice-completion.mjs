import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

if (process.platform !== 'win32') {
  throw new Error('PrintService completion verification must run on Windows')
}

const require = createRequire(import.meta.url)
const { buildPrintServiceCompletionEventScript } = require('../dist/agent/wmi.js')
const script = buildPrintServiceCompletionEventScript()

assert.match(
  script,
  /LogName='Microsoft-Windows-PrintService\/Operational'; Id=307; StartTime=\$since/,
  'completion evidence must be a PrintService 307 emitted after dispatch',
)
assert.match(
  script,
  /\$_\.ToXml\(\) -like "\*\$tId\*"/,
  'completion correlation must inspect locale-independent Event XML for the taskId',
)
assert.doesNotMatch(
  script,
  /\.Message|\$pName/,
  'localized messages and vendor-specific printer aliases must not gate completion',
)

const taskId = 'ptask_kiosk_0123456789abcdef'

function runFixture(xml) {
  const escapedXml = xml.replace(/'/g, "''")
  const fixtureScript =
    `function Get-WinEvent { [CmdletBinding()] param([hashtable]$FilterHashtable); ` +
    `if ($FilterHashtable.LogName -ne 'Microsoft-Windows-PrintService/Operational' -or ` +
    `$FilterHashtable.Id -ne 307 -or $null -eq $FilterHashtable.StartTime) { return }; ` +
    `$fixture = [pscustomobject]@{ Xml = '${escapedXml}' }; ` +
    `$fixture | Add-Member -MemberType ScriptMethod -Name ToXml -Value { $this.Xml }; ` +
    `$fixture }; ` +
    script
  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-Command', fixtureScript],
    { input: `${taskId}|${Date.now()}`, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `PowerShell completion fixture failed: ${result.stderr}`)
  return result.stdout.trim().toLowerCase()
}

assert.equal(
  runFixture(
    `<Event><EventData><Data Name="Param2">print_${taskId}_fixture.pdf</Data>` +
      `<Data Name="Param5">Pantum USB001</Data></EventData></Event>`,
  ),
  'true',
  'matching taskId must confirm even when Event 307 contains only a driver/port alias',
)
assert.equal(
  runFixture(
    '<Event><EventData><Data Name="Param2">print_other_task_fixture.pdf</Data></EventData></Event>',
  ),
  'false',
  'an unrelated Event 307 must not confirm the task',
)

console.log('PRINTSERVICE_COMPLETION_PASS alias=Pantum_USB001 unrelated=false')
