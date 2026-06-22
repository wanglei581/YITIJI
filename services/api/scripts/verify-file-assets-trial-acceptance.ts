/**
 * 用户文件与简历资产生产/试运营验收证据包防回退验证。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
 *
 * 注意: 本脚本只做静态文档与门禁口径检查,不连接生产 PostgreSQL、Redis 或 COS。
 */
import { strict as assert } from 'assert'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(__dirname, '../../..')
const acceptancePath = join(repoRoot, 'docs/acceptance/user-file-assets-trial-acceptance.md')
const commercialClosureAuditPath = join(repoRoot, 'docs/acceptance/user-file-assets-commercial-closure-audit.md')
const gateEvidenceRunbookPath = join(repoRoot, 'docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md')
const preprodIntegrationPlanPath = join(repoRoot, 'docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md')
const gate2RefreshPlanPath = join(repoRoot, 'docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md')
const supersededPreprodExecutionPlanPath = join(repoRoot, 'docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md')
const gate2ApprovalPackagePath = join(repoRoot, 'docs/acceptance/user-file-assets-gate2-approval-package.md')
const gate2LocalArtifactCheckPath = join(repoRoot, 'docs/acceptance/user-file-assets-gate2-local-artifact-check.md')
const gate2RuntimeBuildCheckPath = join(repoRoot, 'docs/acceptance/user-file-assets-gate2-runtime-build-check.md')
const gate2ReadinessRecheckPath = join(repoRoot, 'docs/acceptance/user-file-assets-gate2-readiness-recheck.md')
const preprodExecutionRecordPath = join(repoRoot, 'docs/acceptance/user-file-assets-preprod-execution-record.md')
const preprodCosSwitchApprovalPath = join(repoRoot, 'docs/acceptance/user-file-assets-preprod-cos-switch-approval.md')
const checklistPath = join(repoRoot, 'docs/device/production-deployment-and-windows-host-checklist.md')
const progressPath = join(repoRoot, 'docs/progress/current-progress.md')
const nextTasksPath = join(repoRoot, 'docs/progress/next-tasks.md')
const apiPackagePath = join(repoRoot, 'services/api/package.json')
const filesServicePath = join(repoRoot, 'services/api/src/files/files.service.ts')
const filesControllerPath = join(repoRoot, 'services/api/src/files/files.controller.ts')
const filesCleanupTaskPath = join(repoRoot, 'services/api/src/files/files.cleanup.task.ts')
const filesModulePath = join(repoRoot, 'services/api/src/files/files.module.ts')
const appModulePath = join(repoRoot, 'services/api/src/app.module.ts')

assert.ok(existsSync(acceptancePath), 'must create docs/acceptance/user-file-assets-trial-acceptance.md')
assert.ok(existsSync(commercialClosureAuditPath), 'must create docs/acceptance/user-file-assets-commercial-closure-audit.md')
assert.ok(existsSync(gateEvidenceRunbookPath), 'must create docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md')
assert.ok(existsSync(preprodIntegrationPlanPath), 'must keep docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md')
assert.ok(existsSync(gate2RefreshPlanPath), 'must create docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md')
assert.ok(existsSync(supersededPreprodExecutionPlanPath), 'must keep superseded preprod execution plan with replacement notice')
assert.ok(existsSync(gate2ApprovalPackagePath), 'must create docs/acceptance/user-file-assets-gate2-approval-package.md')
assert.ok(existsSync(gate2LocalArtifactCheckPath), 'must create docs/acceptance/user-file-assets-gate2-local-artifact-check.md')
assert.ok(existsSync(gate2RuntimeBuildCheckPath), 'must create docs/acceptance/user-file-assets-gate2-runtime-build-check.md')
assert.ok(existsSync(gate2ReadinessRecheckPath), 'must create docs/acceptance/user-file-assets-gate2-readiness-recheck.md')
assert.ok(existsSync(preprodExecutionRecordPath), 'must create docs/acceptance/user-file-assets-preprod-execution-record.md')
assert.ok(existsSync(preprodCosSwitchApprovalPath), 'must create docs/acceptance/user-file-assets-preprod-cos-switch-approval.md')

const acceptance = readFileSync(acceptancePath, 'utf8')
const commercialClosureAudit = readFileSync(commercialClosureAuditPath, 'utf8')
const gateEvidenceRunbook = readFileSync(gateEvidenceRunbookPath, 'utf8')
const preprodIntegrationPlan = readFileSync(preprodIntegrationPlanPath, 'utf8')
const gate2RefreshPlan = readFileSync(gate2RefreshPlanPath, 'utf8')
const supersededPreprodExecutionPlan = readFileSync(supersededPreprodExecutionPlanPath, 'utf8')
const gate2ApprovalPackage = readFileSync(gate2ApprovalPackagePath, 'utf8')
const gate2LocalArtifactCheck = readFileSync(gate2LocalArtifactCheckPath, 'utf8')
const gate2RuntimeBuildCheck = readFileSync(gate2RuntimeBuildCheckPath, 'utf8')
const preprodCosSwitchApproval = readFileSync(preprodCosSwitchApprovalPath, 'utf8')
const gate2ReadinessRecheck = readFileSync(gate2ReadinessRecheckPath, 'utf8')
const preprodExecutionRecord = readFileSync(preprodExecutionRecordPath, 'utf8')
const checklist = readFileSync(checklistPath, 'utf8')
const progress = readFileSync(progressPath, 'utf8')
const nextTasks = readFileSync(nextTasksPath, 'utf8')
const apiPackage = JSON.parse(readFileSync(apiPackagePath, 'utf8')) as { scripts?: Record<string, string> }
const filesService = readFileSync(filesServicePath, 'utf8')
const filesController = readFileSync(filesControllerPath, 'utf8')
const filesCleanupTask = readFileSync(filesCleanupTaskPath, 'utf8')
const filesModule = readFileSync(filesModulePath, 'utf8')
const appModule = readFileSync(appModulePath, 'utf8')

for (const marker of [
  'STATIC DOC CHECK ONLY',
  '本证据包就绪不等于生产/试运营已完成',
  '尚未执行生产验收',
  '不得声称生产已完成',
  '[ ] PENDING REAL-EVIDENCE',
  'PostgreSQL',
  'COS 私有桶',
  '会员账号',
  '上传原始文件',
  '上传优化后或修改后文件',
  '90 天',
  '180 天',
  '长期保存',
  'retentionConsentVersion',
  'retentionConsentAt',
  'expiresAt = null',
  '重登查看',
  '跨账号越权否定测试',
  '删除三态一致',
  'COS HEAD 404',
  'AuditLog',
  '过期清理',
  'long_term 防误删',
  '签名 URL TTL',
  'TTL <= 30min',
  '手机号脱敏',
  'token 脱敏',
  '签名 URL 脱敏',
  '腾讯云控制台生命周期规则截图',
  '禁止配置 Bucket 全局过期规则',
  'users/',
  'tmp/',
  '不得覆盖长期保存对象',
  'verify:production-runtime-gates',
  'verify:production-db-guard',
  'verify:cos-lifecycle-policy',
  'verify:cos:live',
  'verify:member-assets-c2d',
  'verify:audit-logs',
  '停止/回滚',
]) {
  assert.ok(acceptance.includes(marker), `acceptance evidence pack must mention: ${marker}`)
}

for (const marker of ['G3-09', 'verify:audit-logs', 'AuditLog']) {
  assert.ok(gateEvidenceRunbook.includes(marker), `gate evidence runbook must mention AuditLog evidence: ${marker}`)
}
assert.ok(
  commercialClosureAudit.includes('Gate 0 本地静态门禁') &&
    commercialClosureAudit.includes('不在 Gate 3 远端执行'),
  'commercial closure audit must classify verify:file-assets-trial-acceptance as a Gate 0 local docs-only gate',
)
assert.doesNotMatch(
  commercialClosureAudit,
  /重点确认 `verify:file-assets-trial-acceptance`/,
  'commercial closure audit must not list verify:file-assets-trial-acceptance as a Gate 3 remote focus command',
)
assert.ok(
  preprodIntegrationPlan.includes('Gate 0 本地静态文档门禁') &&
    preprodIntegrationPlan.includes('完整仓库 `docs/`') &&
    preprodIntegrationPlan.includes('不属于 Gate 3 远端裁剪运行时包命令清单'),
  'preprod integration plan must classify verify:file-assets-trial-acceptance as a Gate 0 local docs-only gate',
)
assert.doesNotMatch(
  preprodIntegrationPlan,
  /在 Gate 3 远端裁剪运行时包执行 `?verify:file-assets-trial-acceptance`?|(?<!不)属于 Gate 3 远端裁剪运行时包命令清单/,
  'preprod integration plan must not present verify:file-assets-trial-acceptance as a remote trimmed-runtime command',
)
const integrationApiGatesStart = preprodIntegrationPlan.indexOf('Run API runtime file asset gates')
const integrationKioskGatesStart = preprodIntegrationPlan.indexOf('Run Kiosk/Admin gates')
assert.ok(
  integrationApiGatesStart >= 0 && integrationKioskGatesStart > integrationApiGatesStart,
  'preprod integration plan must keep API runtime gates before Kiosk/Admin gates',
)
const integrationApiGatesSection = preprodIntegrationPlan.slice(integrationApiGatesStart, integrationKioskGatesStart)
assert.ok(
  !integrationApiGatesSection.includes('verify:file-assets-trial-acceptance'),
  'preprod integration plan must not list local docs-only verify:file-assets-trial-acceptance under API runtime gates',
)

const gate3SectionStart = gateEvidenceRunbook.indexOf('## 四、Gate 3 自动命令门禁')
const gate4SectionStart = gateEvidenceRunbook.indexOf('## 五、Gate 4 浏览器和账号验收')
assert.ok(
  gate3SectionStart >= 0 && gate4SectionStart > gate3SectionStart,
  'gate evidence runbook must keep Gate 3 before Gate 4 sections',
)
const gate3Section = gateEvidenceRunbook.slice(gate3SectionStart, gate4SectionStart)

// Deliberately mirrors the runbook sequence so Gate 3 command changes must be reviewed.
const expectedGate3LocalCommands = ['verify:cos-lifecycle-policy']
const expectedGate3RuntimeCommands = [
  'verify:production-runtime-gates',
  'verify:production-db-guard',
  'verify:file-retention',
  'verify:file-lifecycle-summary',
  'verify:cos:live',
  'verify:member-assets-c2d',
  'verify:audit-logs',
]
const gate3Commands = Array.from(gate3Section.matchAll(/pnpm --filter @ai-job-print\/api (verify:[\w:-]+)/g), (match) => match[1])
assert.deepEqual(
  gate3Commands.slice(0, expectedGate3LocalCommands.length),
  expectedGate3LocalCommands,
  'Gate 3 runbook must list local full-repository verify commands first',
)
assert.deepEqual(
  gate3Commands.slice(expectedGate3LocalCommands.length),
  expectedGate3RuntimeCommands,
  'Gate 3 runbook must list the expected trimmed-runtime verify commands in execution order',
)
for (const command of gate3Commands) {
  assert.ok(apiPackage.scripts?.[command], `Gate 3 verify command must exist in services/api/package.json: ${command}`)
}
assert.ok(
  gate3Section.includes('verify:cos-lifecycle-policy') &&
    gate3Section.includes('完整仓库') &&
    gate3Section.includes('不得为了远端执行把 `docs/` 或 `.ccg/` 加回裁剪运行时包'),
  'Gate 3 runbook must keep verify:cos-lifecycle-policy as a local full-repository docs gate',
)
assert.ok(
  gate3Section.includes('禁止设置 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true`') &&
    gate3Section.includes('prod_label=true') &&
    gate3Section.includes('历史生产私有桶指纹一致'),
  'Gate 3 runbook must forbid enabling COS live when the bucket looks like the historical production bucket',
)
assert.ok(
  !gate3Commands.includes('verify:file-assets-trial-acceptance'),
  'Gate 3 remote runtime command list must not include local docs-only verify:file-assets-trial-acceptance',
)

const gate2Candidate = '2187f6a7'
const oldGate2Candidate = '9a702981'
const governanceCommitNotGate2Candidate = '39914fca'
const currentGate2Artifact = `yitiji-preprod-${gate2Candidate}.tar.gz`
const currentGate2Checksum = `yitiji-preprod-${gate2Candidate}.sha256`
const currentGate2CandidateDir = `ai-job-print-candidate-${gate2Candidate}`
const currentGate2ApiHashSidecar = `yitiji-api-main-${gate2Candidate}.sha256`
const forbiddenOldGate2OperationalMarkers = [
  `yitiji-preprod-${oldGate2Candidate}.tar.gz`,
  `yitiji-preprod-${oldGate2Candidate}.sha256`,
  `ai-job-print-candidate-${oldGate2Candidate}`,
  `yitiji-api-main-${oldGate2Candidate}.sha256`,
  `commit=${oldGate2Candidate}`,
  `checkout --detach ${oldGate2Candidate}`,
]
const forbiddenGovernanceCommitOperationalMarkers = [
  `yitiji-preprod-${governanceCommitNotGate2Candidate}.tar.gz`,
  `yitiji-preprod-${governanceCommitNotGate2Candidate}.sha256`,
  `ai-job-print-candidate-${governanceCommitNotGate2Candidate}`,
  `yitiji-api-main-${governanceCommitNotGate2Candidate}.sha256`,
  `commit=${governanceCommitNotGate2Candidate}`,
  `checkout --detach ${governanceCommitNotGate2Candidate}`,
]

function assertIncludesAll(source: string, label: string, markers: string[]) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `${label} must mention current Gate 2 candidate marker: ${marker}`)
  }
}

function assertNoOldOperationalMarkers(source: string, label: string) {
  for (const marker of forbiddenOldGate2OperationalMarkers) {
    assert.ok(!source.includes(marker), `${label} must not contain old Gate 2 operational marker: ${marker}`)
  }
}

function assertNoGovernanceCommitOperationalMarkers(source: string, label: string) {
  for (const marker of forbiddenGovernanceCommitOperationalMarkers) {
    assert.ok(!source.includes(marker), `${label} must not contain governance-only commit as Gate 2 operational marker: ${marker}`)
  }
}

function extractRequiredBlock(source: string, label: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start >= 0, `${label} must include guard start marker: ${startMarker}`)
  assert.ok(end > start, `${label} must include guard end marker after start marker: ${endMarker}`)
  return source.slice(start + startMarker.length, end)
}

function findRequiredLine(source: string, label: string, prefix: string) {
  const line = source.split('\n').find((candidate) => candidate.trim().startsWith(prefix))
  assert.ok(line, `${label} must include a line that starts with: ${prefix}`)
  return line
}

function readRequiredGitOutput(command: string, failureMessage: string) {
  try {
    return execSync(command, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '').trim()
        : ''
    assert.fail(stderr ? `${failureMessage}: ${stderr.split('\n')[0]}` : failureMessage)
  }
}

assertIncludesAll(gate2RefreshPlan, 'Gate 2 refresh plan', [
  gate2Candidate,
  `/tmp/${currentGate2Artifact}`,
  `/srv/${currentGate2Artifact}`,
  `/tmp/${currentGate2Checksum}`,
  `/srv/${currentGate2Checksum}`,
  `/srv/${currentGate2CandidateDir}`,
  `/srv/${currentGate2ApiHashSidecar}`,
  `commit=${gate2Candidate}`,
  `git cat-file -e ${gate2Candidate}^{commit}`,
])
assert.doesNotMatch(gate2RefreshPlan, new RegExp(oldGate2Candidate), 'Gate 2 refresh plan must not reference the old candidate')
assertNoGovernanceCommitOperationalMarkers(gate2RefreshPlan, 'Gate 2 refresh plan')

assert.equal(gate2Candidate, '2187f6a7', 'Gate 2 deployment candidate must stay frozen at 2187f6a7 until runtime-impacting inputs change')
assert.equal(oldGate2Candidate, '9a702981', 'previous Gate 2 candidate marker must remain 9a702981 for operational rollback guards')
for (const marker of [
  '部署候选冻结',
  '治理提交不刷新部署候选',
  '运行时代码',
  '数据库 schema',
  '构建输入',
  '归档范围',
  '生产构建变量',
  'Gate 2 执行命令',
]) {
  assert.ok(gate2RefreshPlan.includes(marker), `Gate 2 refresh plan must define candidate-freeze marker: ${marker}`)
}
assert.ok(
  gate2RefreshPlan.includes('"TENCENT_COS_BUCKET"') &&
    gate2RefreshPlan.includes('"TENCENT_COS_REGION"') &&
    !/"COS_BUCKET"|"COS_REGION"/.test(gate2RefreshPlan),
  'Gate 2 refresh plan must fingerprint runtime Tencent COS keys, not generic COS_BUCKET/COS_REGION keys',
)
for (const [label, source] of [
  ['Gate 2 approval package', gate2ApprovalPackage],
  ['Gate 2 runtime build check', gate2RuntimeBuildCheck],
  ['current-progress', progress],
  ['next-tasks', nextTasks],
] as const) {
  assert.ok(
    source.includes('治理提交不刷新部署候选') && source.includes(gate2Candidate),
    `${label} must explain that governance commits do not refresh the frozen Gate 2 deployment candidate`,
  )
  assertNoGovernanceCommitOperationalMarkers(source, label)
}
readRequiredGitOutput(
  `git cat-file -e ${gate2Candidate}^{commit}`,
  `frozen Gate 2 candidate ${gate2Candidate} must be reachable; fetch full history before running this gate`,
)
const changedSinceFrozenCandidate = readRequiredGitOutput(
  `git diff --name-only ${gate2Candidate}`,
  `failed to inspect changes since frozen Gate 2 candidate ${gate2Candidate}`,
)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
const untrackedFiles = readRequiredGitOutput(
  'git ls-files --others --exclude-standard',
  'failed to inspect untracked files for Gate 2 candidate freeze',
)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
const allowedGovernanceChange = (file: string) =>
  file.startsWith('docs/') ||
  file.startsWith('.ccg/') ||
  file === 'services/api/scripts/verify-file-assets-trial-acceptance.ts'
const runtimeImpactingChanges = changedSinceFrozenCandidate.filter((file) => !allowedGovernanceChange(file))
const runtimeImpactingUntrackedFiles = untrackedFiles.filter((file) => !allowedGovernanceChange(file))
assert.deepEqual(
  runtimeImpactingChanges,
  [],
  `changes after frozen Gate 2 candidate ${gate2Candidate} must be governance-only unless the deployment candidate is refreshed`,
)
assert.deepEqual(
  runtimeImpactingUntrackedFiles,
  [],
  `untracked files during frozen Gate 2 candidate ${gate2Candidate} must be governance-only unless the deployment candidate is refreshed`,
)

assertIncludesAll(gate2ApprovalPackage, 'Gate 2 approval package', [
  `适用候选：\`${gate2Candidate}\``,
  `/srv/${currentGate2Artifact}`,
  `/srv/${currentGate2Checksum}`,
  `/srv/${currentGate2CandidateDir}`,
  `commit=${gate2Candidate}`,
  `git cat-file -e ${gate2Candidate}^{commit}`,
])
assertNoOldOperationalMarkers(gate2ApprovalPackage, 'Gate 2 approval package')
assert.ok(
  gate2ApprovalPackage.includes('> 状态：PREPRODUCTION GATE 2 PASSED，Gate 3/Gate 4 尚未执行。'),
  'Gate 2 approval package must record preproduction Gate 2 passed while keeping Gate 3/Gate 4 unexecuted',
)
const gate2ApprovalConsentBlock = extractRequiredBlock(
  gate2ApprovalPackage,
  'Gate 2 approval package consent block',
  '<!-- GATE2_APPROVAL_STATEMENT_START -->',
  '<!-- GATE2_APPROVAL_STATEMENT_END -->',
)
assertIncludesAll(gate2ApprovalConsentBlock, 'Gate 2 approval package consent block', [
  '只有用户明确确认以下内容后，才能执行 Gate 2 远端操作',
  '确认执行用户文件与简历资产预生产 Gate 2',
  `目标：仅刷新预生产 \`/srv/ai-job-print\` 到候选 \`${gate2Candidate}\``,
])
const gate2ApprovalAgreeLine = findRequiredLine(gate2ApprovalConsentBlock, 'Gate 2 approval package consent block', '同意：')
const gate2ApprovalDisagreeLine = findRequiredLine(gate2ApprovalConsentBlock, 'Gate 2 approval package consent block', '不同意：')
const gate2ApprovalKnownLine = findRequiredLine(gate2ApprovalConsentBlock, 'Gate 2 approval package consent block', '已知：')
assertIncludesAll(gate2ApprovalAgreeLine, 'Gate 2 approval package agree line', [
  '上传候选包',
  '展开候选目录',
  '复制既有 env 文件',
  '安装依赖',
  '构建 API/Kiosk/Admin',
  '备份 PostgreSQL',
  '执行候选 additive migrations',
  '原子切换应用目录',
  '重启既有 PM2',
  '复验 health',
])
assertIncludesAll(gate2ApprovalDisagreeLine, 'Gate 2 approval package disagree line', [
  '修改正式生产',
  '域名/证书/nginx',
  '云密钥',
  '短信/OCR/TRTC/ASR/TTS',
  'COS 生命周期',
  '业务数据',
  '测试账号文件',
  'Windows 真机',
  '打印扫描配置',
])
assertIncludesAll(gate2ApprovalKnownLine, 'Gate 2 approval package known line', [
  'Gate 2 通过后仍需另行确认 Gate 3/Gate 4',
  'Gate 2 通过不等于试运营或商用闭环完成',
])
for (const line of gate2ApprovalPackage.split('\n')) {
  const completionClaim = /(?:生产验收已完成|试运营已完成|已正式上线|商用闭环完成)/.test(line)
  const negativeContext = /(?:尚未|不得|禁止|不宣布|不等于|不能|不可|没有证据|不代表)/.test(line)
  assert.ok(!completionClaim || negativeContext, `Gate 2 approval package must not claim completion without negative context: ${line}`)
}

assertIncludesAll(preprodExecutionRecord, 'preprod execution record', [
  `/ \`${gate2Candidate}\``,
  `/tmp/${currentGate2Artifact}`,
  `Gate 2 执行候选 ${gate2Candidate}`,
  'PREPRODUCTION GATE 2 PASSED',
  'Gate 3 安全子集部分通过',
  'Gate 4 尚未执行',
  '| `pnpm --filter @ai-job-print/api verify:cos:live` | BLOCKED |',
  '未执行：G3-06 COS live',
  'fp=7637995480',
  'prod_label=true',
  'strict_nonprod=false',
])
assertNoOldOperationalMarkers(preprodExecutionRecord, 'preprod execution record')
assert.doesNotMatch(
  preprodExecutionRecord,
  /(?:PREPRODUCTION\s+)?GATE 3 (?:FULL )?(?:PASSED|已执行通过|完整通过)/,
  'preprod execution record must not claim full Gate 3 pass while G3-06 is blocked',
)
assertIncludesAll(preprodCosSwitchApproval, 'preprod COS switch approval package', [
  'APPROVAL / INPUT REQUIRED，尚未切换',
  'COS_BUCKET_PROOF fp=7637995480 strict_nonprod=false prod_label=true project_label=true',
  '不得设置 `COS_BUCKET_PREPROD_PROOF_CONFIRMED=true`',
  '预生产 bucket 名',
  '私有读写',
  'CAM 权限',
  '生命周期规则',
  'CORS / 直传',
  'TENCENT_COS_BUCKET',
  'TENCENT_COS_REGION',
  'TENCENT_COS_SECRET_ID',
  'TENCENT_COS_SECRET_KEY',
  'verify:cos:live',
  'PREPRODUCTION COS SWITCH NOT EXECUTED',
])
for (const line of preprodCosSwitchApproval.split('\n')) {
  const completionClaim = /(?:切换|COS\s*live|Gate\s*4|试运营|生产验收|Gate\s*3)[^。\n]{0,10}(?:已?通过|已?完成|已执行|已切换|完整通过)/i.test(line)
  const negativeContext = /(?:尚未|不得|不代表|不能|未执行|NOT EXECUTED|缺少|暂停|安全子集|PARTIAL)/.test(line)
  assert.ok(!completionClaim || negativeContext, `preprod COS switch approval must not claim execution completion: ${line}`)
}

assertIncludesAll(gateEvidenceRunbook, 'Gate 3/Gate 4 evidence runbook', [`部署候选 \`${gate2Candidate}\``])
assert.doesNotMatch(gateEvidenceRunbook, new RegExp(oldGate2Candidate), 'Gate 3/Gate 4 evidence runbook must not reference the old Gate 2 candidate')

assertIncludesAll(gate2RuntimeBuildCheck, 'Gate 2 runtime build check', [
  `候选 commit：\`${gate2Candidate}\``,
  `/tmp/${currentGate2Artifact}`,
  `历史对照：\`${oldGate2Candidate}\``,
])
assert.ok(
  gate2LocalArtifactCheck.includes('历史记录：本文中的 `9146fa1c` 归档命令仅保留为旧候选本地预检证据，后续 Gate 2 不得执行') &&
    gate2LocalArtifactCheck.includes('以下命令仅为 `9146fa1c` 历史预检命令，已废弃，勿执行') &&
    gate2LocalArtifactCheck.includes(`后续 Gate 2 建议候选已刷新为 \`${gate2Candidate}\``) &&
    gate2LocalArtifactCheck.includes(`/srv/${currentGate2Artifact}`),
  'Gate 2 local artifact check must mark its old 9146fa1c data as historical and point execution to the current Gate 2 candidate',
)
assertIncludesAll(gate2ReadinessRecheck, 'Gate 2 readiness recheck', [
  'READ-ONLY RECHECK ONLY',
  'Gate 2 尚未执行',
  gate2Candidate,
  '6b055d6b',
  'STATIC DOC CHECK ONLY',
  'db=postgres',
  'FILE_STORAGE_DRIVER',
  'TENCENT_COS_BUCKET',
  'TENCENT_COS_REGION',
  'NODE_ENV',
  'staging',
  '未上传',
  '未写入 `/srv`',
  '未迁移数据库',
  '未重启 PM2',
])
assertNoOldOperationalMarkers(gate2ReadinessRecheck, 'Gate 2 readiness recheck')
assertNoGovernanceCommitOperationalMarkers(gate2ReadinessRecheck, 'Gate 2 readiness recheck')
assert.ok(
  preprodExecutionRecord.includes('Gate 2 执行前只读就绪复核') &&
    preprodExecutionRecord.includes('user-file-assets-gate2-readiness-recheck.md') &&
    preprodExecutionRecord.includes('未上传包、未写 `/srv`、未迁移数据库、未重启 PM2'),
  'preprod execution record must link the Gate 2 readiness recheck without implying execution',
)
assert.ok(
  supersededPreprodExecutionPlan.includes(`已被`) &&
    supersededPreprodExecutionPlan.includes(`2026-06-22-file-assets-preprod-gate2-refresh.md`) &&
    supersededPreprodExecutionPlan.includes(gate2Candidate) &&
    supersededPreprodExecutionPlan.includes('以下旧命令仅保留为 `9146fa1c` 历史执行准备记录，已废弃，勿执行'),
  'superseded preprod execution plan must clearly point operators to the current Gate 2 refresh plan',
)

for (const marker of [
  'user-file-assets-trial-acceptance.md',
  '用户文件与简历资产证据包',
  '不得以本地 SQLite/local storage verify 代替 PostgreSQL + COS + 会员账号真实验收',
]) {
  assert.ok(checklist.includes(marker), `production checklist must reference file assets acceptance: ${marker}`)
}

assert.ok(
  progress.includes('codex/file-assets-trial-acceptance') && progress.includes('非生产/试运营验收完成'),
  'current-progress must record this branch as evidence-pack only, not production completion',
)
assert.ok(
  nextTasks.includes('用户文件与简历资产证据包') && nextTasks.includes('真实生产/试运营执行'),
  'next-tasks must keep real production/trial execution pending',
)
assert.ok(
  progress.includes('codex/file-assets-gate2-execution') &&
    progress.includes('PREPRODUCTION GATE 2 PASSED') &&
    progress.includes('Gate 3/Gate 4 尚未执行'),
  'current-progress must record preproduction Gate 2 passed without implying Gate 3/Gate 4 completion',
)
assert.ok(
  nextTasks.includes('预生产 Gate 2 候选部署或刷新') &&
    nextTasks.includes('已完成') &&
    nextTasks.includes('预生产 COS bucket 切换') &&
    nextTasks.includes('user-file-assets-preprod-cos-switch-approval.md') &&
    nextTasks.includes('Gate 3 安全子集已部分通过') &&
    nextTasks.includes('G3-06 `verify:cos:live` 和 Gate 4 浏览器账号验收暂停') &&
    nextTasks.includes('prod_label=true') &&
    nextTasks.includes('明确隔离的预生产 bucket'),
  'next-tasks must record Gate 2 passed, Gate 3 partial state, and Gate 4/COS blocker',
)
assert.ok(checklist.includes('AuditLog'), 'production checklist must use AuditLog for file lifecycle audit evidence')
assert.ok(nextTasks.includes('AuditLog'), 'next-tasks must use AuditLog for file lifecycle audit evidence')
assert.doesNotMatch(checklist, /ActivityLog/, 'production checklist must not confuse file lifecycle AuditLog with ActivityLog')
assert.doesNotMatch(nextTasks, /ActivityLog/, 'next-tasks must not confuse file lifecycle AuditLog with ActivityLog')

for (const line of acceptance.split('\n')) {
  const completionClaim = /(?:生产验收已完成|试运营已完成|已正式上线|生产就绪已通过)/.test(line)
  const negativeContext = /(?:不得|禁止|不等于|不能|不可|没有证据)/.test(line)
  assert.ok(!completionClaim || negativeContext, `acceptance doc must not claim production/trial completion: ${line}`)
}
assert.doesNotMatch(
  acceptance,
  /- \[x\].*(?:PENDING REAL-EVIDENCE|生产|COS|PostgreSQL|重登|过期清理|删除三态)/,
  'manual production evidence rows must remain unchecked in the template',
)

assert.match(filesService, /where:\s*\{\s*deletedAt:\s*null,\s*expiresAt:\s*\{\s*lt:\s*now\s*\}/, 'cleanupExpired must select only expired non-deleted rows')
assert.match(filesService, /await this\.storage\.deleteObject\(f\.storageKey,\s*f\.bucket\)/, 'cleanupExpired must delete storage object before marking the row deleted')
assert.match(filesService, /action:\s*'file\.cleanup_expired'/, 'cleanupExpired cron path must write audit log')
assert.match(filesController, /action:\s*'file\.retention_update'/, 'updateRetention controller path must write audit log')
assert.match(filesController, /action:\s*'file\.delete'/, 'ownerDelete controller path must write audit log')
assert.match(filesController, /action:\s*'file\.cleanup_expired'/, 'manual cleanup controller path must write audit log')
assert.match(filesCleanupTask, /@Cron\(CronExpression\.EVERY_HOUR\)/, 'FilesCleanupTask must remain hourly cron based')
assert.match(filesModule, /providers:\s*\[\s*FilesService,\s*FilesCleanupTask\s*\]/, 'FilesCleanupTask must remain registered in FilesModule')
assert.match(appModule, /ScheduleModule\.forRoot\(\)/, 'ScheduleModule must remain enabled in AppModule')

console.warn('[STATIC DOC CHECK ONLY] This verification does NOT prove production/trial acceptance.')
console.warn('[静态文档检查] 本脚本通过不代表生产/试运营验收已完成；仍需人工执行生产清单并留存截图、日志和审计查询。')
console.log('verify:file-assets-trial-acceptance passed')
