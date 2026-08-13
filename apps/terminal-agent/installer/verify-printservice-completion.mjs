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
  /\$raw -like "\*\$tId\*"/,
  'completion correlation must inspect locale-independent Event XML for the taskId',
)
assert.match(script, /Param5/, 'generic-document fallback must read the target queue')
assert.match(script, /S-1-5-18/, 'generic-document fallback must require LocalSystem')
assert.doesNotMatch(script, /\.Message/, 'localized formatted messages must not gate completion')

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
    {
      input: JSON.stringify({
        taskId,
        printerName: 'Configured Printer',
        dispatchedAtMs: Date.now(),
      }),
      encoding: 'utf8',
    },
  )
  assert.equal(result.status, 0, `PowerShell completion fixture failed: ${result.stderr}`)
  return result.stdout.trim().toLowerCase()
}

assert.equal(
  runFixture(
    `<Event><System><Security UserID="S-1-5-18" /></System>` +
      `<EventData><Data Name="Param2">print_${taskId}_fixture.pdf</Data>` +
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

const genericPantumEvent =
  `<Event><System><Security UserID="S-1-5-18" /></System><UserData>` +
  `<DocumentPrinted><Param1>2</Param1><Param2>打印文档</Param2><Param3>SYSTEM</Param3>` +
  `<Param4>\\DESKTOP-FIXTURE</Param4><Param5>Configured Printer</Param5>` +
  `<Param6>USB001</Param6><Param7>129994520</Param7><Param8>1</Param8>` +
  `</DocumentPrinted></UserData></Event>`
assert.equal(
  runFixture(genericPantumEvent),
  'true',
  'Pantum generic document names must confirm for the exact queue and LocalSystem',
)
assert.equal(
  runFixture(genericPantumEvent.replace('Configured Printer', 'Other Printer')),
  'false',
  'generic document events from another queue must not confirm',
)
assert.equal(
  runFixture(genericPantumEvent.replace('S-1-5-18', 'S-1-5-21-1234')),
  'false',
  'generic document events from another user must not confirm',
)

console.log('PRINTSERVICE_COMPLETION_PASS taskId=true genericPantum=true unrelated=false')
