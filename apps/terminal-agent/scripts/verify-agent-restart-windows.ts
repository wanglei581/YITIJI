/** Windows CI only: isolated WinSW service and on-demand SYSTEM task; no printer. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import ts from 'typescript'
import { requestServiceRestart } from '../src/agent/service-restart'

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`
// The workflow step runs under pwsh 7, whose PSModulePath leaks into this process. Windows PowerShell 5.1
// started with that value resolves the PowerShell 7 copy of Microsoft.PowerShell.Utility and loses its own
// script-defined commands (first seen on CI: Get-FileHash "not recognized"). Drop it so 5.1 computes its default.
function windowsPowerShellEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'psmodulepath') delete env[key]
  }
  return env
}
function ps(script: string): string {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ErrorActionPreference='Stop'; ${script}`], { encoding: 'utf8', timeout: 60_000, env: windowsPowerShellEnv() })
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error))
  return result.stdout.trim()
}
async function until(test: () => boolean, ms = 45_000): Promise<void> {
  const deadline = performance.now() + ms
  while (!test()) {
    assert.ok(performance.now() < deadline, 'service restart exceeded deadline')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('verify-agent-restart-windows: SKIP (requires Windows services and Task Scheduler)')
    return
  }
  const nonce = randomBytes(6).toString('hex')
  const service = `AIJobRestartTest-${nonce}`
  const task = `AIJobRestartTaskTest-${nonce}`
  const programRoot = join(process.env['ProgramFiles']!, 'AIJobPrintAgent')
  const stateRoot = join(process.env['ProgramData']!, 'AIJobPrintAgent')
  const createdProgramRoot = !existsSync(programRoot)
  const createdStateRoot = !existsSync(stateRoot)
  const codeRoot = join(programRoot, `restart-test-${nonce}`)
  const stateDir = join(stateRoot, `restart-test-${nonce}`)
  const wrapper = join(codeRoot, 'test-service.exe')
  const registration = join(codeRoot, 'agent-restart-task.ps1')
  const controller = join(codeRoot, 'agent-restart.ps1')
  const marker = join(stateDir, 'agent-restart.state')
  const identity = join(stateDir, 'identity.json')
  const trigger = join(stateDir, 'trigger')
  const helper = join(codeRoot, 'service-restart.js')
  const fixture = join(codeRoot, 'fixture.js')
  const commands = `. ${quote(registration)};`
  const uninstallTask = `${commands} Uninstall-AgentRestartTask -TaskName ${quote(task)}`
  const installTask = `${commands} Install-AgentRestartTask -ScriptPath ${quote(controller)} -ServiceName ${quote(service)} -StateDir ${quote(stateDir)} -TaskName ${quote(task)}`
  let installed = false
  try {
    mkdirSync(codeRoot, { recursive: true }); mkdirSync(stateDir, { recursive: true })
    for (const filename of ['agent-restart.ps1', 'agent-restart-task.ps1']) {
      copyFileSync(join(__dirname, '../installer/provision', filename), join(codeRoot, filename))
    }
    // Same production function compiled into the service fixture, never a substitute restart implementation.
    const source = readFileSync(join(__dirname, '../src/agent/service-restart.ts'), 'utf8')
    writeFileSync(helper, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)
    writeFileSync(fixture, `
const fs = require('node:fs');
const {requestServiceRestart} = require(${JSON.stringify(helper)});
const identity = ${JSON.stringify(identity)};
const trigger = ${JSON.stringify(trigger)};
fs.writeFileSync(identity, JSON.stringify({pid:process.pid, startedAt:new Date().toISOString()}));
let requesting = false;
setInterval(async () => {
  if (!requesting && fs.existsSync(trigger)) {
    requesting = true; fs.unlinkSync(trigger);
    const ok = await requestServiceRestart({taskName:${JSON.stringify(task)}});
    if (!ok) fs.writeFileSync(identity+'.error', 'request-failed');
  }
}, 100);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
`)
    const inputs = JSON.parse(readFileSync(join(__dirname, '../installer/inputs.json'), 'utf8')) as { serviceWrapper: { url: string; sha256: string } }
    ps(`Invoke-WebRequest -UseBasicParsing -Uri ${quote(inputs.serviceWrapper.url)} -OutFile ${quote(wrapper)}`)
    // Hash in Node: no dependency on which PowerShell edition answers.
    assert.equal(
      createHash('sha256').update(readFileSync(wrapper)).digest('hex').toLowerCase(),
      inputs.serviceWrapper.sha256.toLowerCase(),
      'WinSW hash mismatch',
    )
    const xmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    writeFileSync(join(codeRoot, 'test-service.xml'), `<service><id>${service}</id><name>${service}</name><description>Isolated restart verification</description><executable>${xmlEscape(process.execPath)}</executable><arguments>&quot;${xmlEscape(fixture)}&quot;</arguments><stoptimeout>15 sec</stoptimeout><onfailure action="restart" delay="60 sec"/><log mode="roll"/></service>`)
    ps(`& ${quote(wrapper)} install; if ($LASTEXITCODE -ne 0) { throw 'WinSW install failed' }`)
    installed = true
    ps(installTask)
    const taskDefinition = JSON.parse(ps(`$t=Get-ScheduledTask -TaskName ${quote(task)};
      @{ user=[string]$t.Principal.UserId; level=[string]$t.Principal.RunLevel; triggers=@($t.Triggers | Where-Object { $null -ne $_ }).Count;
        multiple=[string]$t.Settings.MultipleInstances; limit=[string]$t.Settings.ExecutionTimeLimit;
        restarts=$t.Settings.RestartCount; interval=[string]$t.Settings.RestartInterval } | ConvertTo-Json -Compress`)) as Record<string, unknown>
    assert.ok(['SYSTEM', 'S-1-5-18'].includes(String(taskDefinition.user)))
    assert.equal(taskDefinition.level, 'Highest'); assert.equal(taskDefinition.triggers, 0)
    assert.equal(taskDefinition.multiple, 'IgnoreNew'); assert.equal(taskDefinition.limit, 'PT5M')
    assert.equal(taskDefinition.restarts, 3); assert.equal(taskDefinition.interval, 'PT1M')
    // Installation rollback/uninstallation is idempotent and leaves no task.
    ps(uninstallTask); ps(uninstallTask)
    assert.equal(ps(`@(Get-ScheduledTask -TaskName ${quote(task)} -ErrorAction SilentlyContinue).Count`), '0')
    ps(installTask)
    ps(`Start-Service -Name ${quote(service)}`)
    await until(() => existsSync(identity))
    const readIdentity = () => JSON.parse(readFileSync(identity, 'utf8')) as { pid: number; startedAt: string }
    const eventRecord = Number(ps(`(Get-WinEvent -LogName System -MaxEvents 1 -ErrorAction Stop).RecordId`))
    for (let iteration = 0; iteration < 3; iteration++) {
      const started = performance.now()
      const old = readIdentity()
      const beforeLog = existsSync(join(stateDir, 'logs/agent-restart.log')) ? readFileSync(join(stateDir, 'logs/agent-restart.log'), 'utf8').length : 0
      writeFileSync(trigger, 'restart')
      await until(() => {
        try { return readIdentity().pid !== old.pid } catch { return false }
      })
      const current = readIdentity()
      assert.notEqual(current.startedAt, old.startedAt)
      assert.equal(ps(`@(Get-Process -Id ${old.pid} -ErrorAction SilentlyContinue).Count`), '0')
      await until(() => !existsSync(marker))
      // The controller removes the marker first and writes the final line right after; wait for the line.
      await until(() => /stage=complete result=success/.test(readFileSync(join(stateDir, 'logs/agent-restart.log'), 'utf8').slice(beforeLog)), 10_000)
      assert.equal(existsSync(identity + '.error'), false)
      assert.ok(performance.now() - started < 45_000, 'complete normal restart must finish within 45 seconds')
      // Wait until controller has exited so the next on-demand run isn't ignored.
      await until(() => ps(`[string](Get-ScheduledTask -TaskName ${quote(task)}).State`) !== 'Running')
    }
    // Use XML event data, not localized message text; log access failures remain failures.
    const crashes = ps(`$events=@(Get-WinEvent -LogName System -ErrorAction Stop | Where-Object { $_.RecordId -gt ${eventRecord} -and ($_.Id -eq 7031 -or $_.Id -eq 7034) });
      $matches=@($events | Where-Object { $xml=[xml]$_.ToXml(); @($xml.Event.EventData.Data | Where-Object { $_.'#text' -eq ${quote(service)} }).Count -gt 0 }); $matches.Count`)
    assert.equal(crashes, '0', 'normal stop/start must not produce service failure events')
    ps(`Stop-Service -Name ${quote(service)}; (Get-Service -Name ${quote(service)}).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))`)
    writeFileSync(marker, 'stopping')
    assert.equal(await requestServiceRestart({ taskName: task }), true)
    await until(() => ps(`[string](Get-Service -Name ${quote(service)}).Status`) === 'Running')
    await until(() => !existsSync(marker))
    await until(() => ps(`[string](Get-ScheduledTask -TaskName ${quote(task)}).State`) !== 'Running')
    ps(uninstallTask)
    assert.equal(await requestServiceRestart({ taskName: task }), false)
  } finally {
    // No test task, service, nonce directory or newly-created product roots may survive.
    if (existsSync(registration)) {
      ps(`if (Get-ScheduledTask -TaskName ${quote(task)} -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName ${quote(task)} }; ${uninstallTask}`)
    }
    if (installed || ps(`@(Get-Service -Name ${quote(service)} -ErrorAction SilentlyContinue).Count`) !== '0') {
      ps(`Set-Service -Name ${quote(service)} -StartupType Disabled;
        $s=Get-Service -Name ${quote(service)};
        if ($s.Status -ne 'Stopped') { Stop-Service -Name ${quote(service)}; $s.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30)) };
        & ${quote(wrapper)} uninstall; if ($LASTEXITCODE -ne 0) { throw 'WinSW uninstall failed' }`)
      await until(() => ps(`@(Get-Service -Name ${quote(service)} -ErrorAction SilentlyContinue).Count`) === '0')
    }
    rmSync(codeRoot, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true })
    const removeCreatedRoot = (root: string, created: boolean) => { if (created) rmSync(root, { recursive: true, force: true }) }
    removeCreatedRoot(programRoot, createdProgramRoot); removeCreatedRoot(stateRoot, createdStateRoot)
    assert.equal(ps(`@(Get-ScheduledTask -TaskName ${quote(task)} -ErrorAction SilentlyContinue).Count`), '0')
  }
  console.log('verify-agent-restart-windows: all cases passed')
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
