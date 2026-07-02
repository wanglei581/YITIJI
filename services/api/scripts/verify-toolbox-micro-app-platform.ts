/**
 * 百宝箱微应用平台方案与清单防回退门禁。
 *
 * 运行: pnpm --filter @ai-job-print/api verify:toolbox-micro-app-platform
 *
 * 本脚本只做静态检查,不连接数据库、不执行 migration、不调用外部服务。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUILTIN_TOOLBOX_MICRO_APPS,
  TOOLBOX_ALLOWED_HOST_STATUSES,
  TOOLBOX_MICRO_APP_FORBIDDEN_CAPABILITIES,
  TOOLBOX_MICRO_APP_STATUSES,
} from '../../../packages/shared/src/types/toolboxMicroApp'
import {
  assertDistinctToolboxReviewers,
  canTransitionToolboxAppStatus,
  evaluateToolboxHost,
  evaluateToolboxPublishGate,
  TOOLBOX_GOVERNANCE_FORBIDDEN_PERMISSIONS,
} from '../src/terminals/toolbox-governance'

const repoRoot = join(__dirname, '../../..')

const productDocPath = join(repoRoot, 'docs/product/toolbox-micro-app-platform.md')
const planPath = join(repoRoot, 'docs/superpowers/plans/2026-07-01-toolbox-micro-app-platform.md')
const sharedTypesPath = join(repoRoot, 'packages/shared/src/types/toolboxMicroApp.ts')
const sharedIndexPath = join(repoRoot, 'packages/shared/src/index.ts')
const apiPackagePath = join(repoRoot, 'services/api/package.json')
const terminalToolboxServicePath = join(repoRoot, 'services/api/src/terminals/terminal-toolbox.service.ts')
const toolboxPolicyPath = join(repoRoot, 'services/api/src/terminals/toolbox-policy.ts')
const toolboxGovernancePath = join(repoRoot, 'services/api/src/terminals/toolbox-governance.ts')

let failed = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failed += 1
  console.error(`  FAIL ${message}`)
}

function mustExist(path: string, label: string): string {
  if (!existsSync(path)) {
    fail(`${label} — 文件缺失: ${path.replace(`${repoRoot}/`, '')}`)
    return ''
  }
  pass(label)
  return readFileSync(path, 'utf8')
}

function mustContain(source: string, markers: string[], label: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) fail(`${label} — 缺少: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(source: string, markers: string[], label: string): void {
  const found = markers.filter((marker) => source.includes(marker))
  if (found.length > 0) fail(`${label} — 不应包含: ${found.join(' | ')}`)
  else pass(label)
}

function mustMatch(source: string, pattern: RegExp, label: string): void {
  if (!pattern.test(source)) fail(`${label} — 未匹配: ${pattern}`)
  else pass(label)
}

function assertBuiltinCatalog(source: string): void {
  const requiredIds = [
    'exam-paper-print',
    'english-mock-practice',
    'contract-review',
    'offer-compare',
    'legal-risk-check',
    'salary-negotiation',
    'hr-qa',
  ]
  mustContain(source, requiredIds.map((id) => `id: '${id}'`), '首批 7 个内置候选微应用均已登记')

  mustContain(source, [
    "'internal_route'",
    "'web_app'",
    "entryType: 'qr_code'",
    "entryType: 'mini_program_qr'",
    "entryType: 'ai_skill'",
    'productionEnabledByDefault: false',
    'requiresHumanReview: true',
    'thirdPartyDataSharing',
    'requiresExplicitConsent',
  ], '微应用清单覆盖入口形态、人工审核、默认不开生产和数据策略')

  mustContain(source, [
    '仅作风险提示，不构成正式法律意见',
    '不构成正式法律意见；合同原文不得进入第三方百宝箱应用',
    '不得暗示官方考试授权',
    '请仅上传本人有权使用或已获授权的试卷材料',
    '不构成入职、涨薪或录用承诺',
  ], '高风险微应用包含法律、合同、考试、版权和薪资免责声明')

  mustContain(source, [
    'platform_resume_delivery',
    'employer_receives_resume',
    'candidate_screening',
    'interview_invitation',
    'offer_management',
    'candidate_recommendation_to_employer',
    'third_party_code_execution',
    'third_party_device_bridge',
  ], '共享类型声明招聘闭环和第三方代码 / 设备 bridge 禁止能力')
}

function assertBuiltinCatalogRuntime(): void {
  const failedBeforeRuntimeChecks = failed
  const requiredIds = new Set([
    'exam-paper-print',
    'english-mock-practice',
    'contract-review',
    'offer-compare',
    'legal-risk-check',
    'salary-negotiation',
    'hr-qa',
  ])
  const actualIds = new Set(BUILTIN_TOOLBOX_MICRO_APPS.map((app) => app.id))

  for (const id of requiredIds) {
    if (!actualIds.has(id)) fail(`内置微应用缺失: ${id}`)
  }
  if (actualIds.size !== requiredIds.size) {
    fail(`内置微应用数量应为 ${requiredIds.size}, 实际为 ${actualIds.size}`)
  }

  const forbiddenCapabilities = new Set<string>(TOOLBOX_MICRO_APP_FORBIDDEN_CAPABILITIES)
  for (const app of BUILTIN_TOOLBOX_MICRO_APPS) {
    if (!app.launch.requiresHumanReview) fail(`${app.id} 必须 requiresHumanReview=true`)
    if (app.launch.productionEnabledByDefault) fail(`${app.id} 第一阶段不得默认开启生产`)
    if (app.disclaimers.length === 0) fail(`${app.id} 必须配置免责声明`)
    if (app.acceptanceGates.length === 0) fail(`${app.id} 必须配置上线验收门槛`)

    const illegalPermissions = app.permissions.filter((permission) => forbiddenCapabilities.has(permission))
    if (illegalPermissions.length > 0) fail(`${app.id} permissions 不得包含禁止能力: ${illegalPermissions.join(', ')}`)

    if ((app.riskLevel === 'high' || app.riskLevel === 'restricted') && !app.dataPolicy.requiresExplicitConsent) {
      fail(`${app.id} 高风险应用必须 requiresExplicitConsent=true`)
    }

    if (app.launch.entryType === 'ai_skill' && !app.launch.assistantIntent) {
      fail(`${app.id} ai_skill 必须配置 assistantIntent`)
    }

    if (/ielts/i.test(`${app.id} ${app.title}`) || app.title.includes('雅思')) {
      fail(`${app.id} 不得在内置 id/title 中使用 IELTS 注册商标`)
    }

    const launchText = JSON.stringify(app.launch)
    if (app.launch.productionEnabledByDefault && /example\.com|weapp:\/\/english-practice-authorized-entry/.test(launchText)) {
      fail(`${app.id} 含占位目标时不得 productionEnabledByDefault=true`)
    }
  }

  if (failed === failedBeforeRuntimeChecks) pass('运行时逐项校验内置微应用默认不开生产、需审核、需免责声明、无禁止能力')
}

function assertGovernanceRuntime(): void {
  const failedBeforeRuntimeChecks = failed
  const now = new Date('2026-07-01T00:00:00.000Z')
  const activeHost = {
    host: 'trusted.example.com',
    purpose: 'web_app' as const,
    status: 'active' as const,
    owner: '就业中心',
    reason: '合作方 H5 入口',
    reviewedBy: 'reviewer-a',
    reviewedAt: '2026-06-30T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
  }
  const approvedWebApp = {
    id: 'salary-web',
    title: '薪资谈判话术',
    shortDescription: '候选人自用话术练习',
    category: 'career' as const,
    priority: 'high' as const,
    status: 'approved' as const,
    riskLevel: 'low' as const,
    permissions: ['external_open'] as const,
    launch: {
      entryType: 'web_app' as const,
      externalUrl: 'https://trusted.example.com/salary',
      requiresHostAllowlist: true,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'none' as const,
      thirdPartyDataSharing: 'external_site' as const,
      sensitiveDataAllowed: false,
      requiresExplicitConsent: true,
    },
    disclaimers: ['第三方页面由服务方负责，平台不注入会员信息。'],
    commercialValue: '合作方服务入口',
    acceptanceGates: ['host 白名单', '人工审核'],
    submittedBy: 'submitter-a',
    approvedBy: 'reviewer-a',
  }

  if (!TOOLBOX_MICRO_APP_STATUSES.includes('planned') || !TOOLBOX_MICRO_APP_STATUSES.includes('published')) {
    fail('共享状态常量必须覆盖 planned 和 published')
  }
  if (!TOOLBOX_ALLOWED_HOST_STATUSES.includes('active') || !TOOLBOX_ALLOWED_HOST_STATUSES.includes('suspended')) {
    fail('共享 host 状态常量必须覆盖 active 和 suspended')
  }
  if (JSON.stringify([...TOOLBOX_GOVERNANCE_FORBIDDEN_PERMISSIONS].sort()) !== JSON.stringify([...TOOLBOX_MICRO_APP_FORBIDDEN_CAPABILITIES].sort())) {
    fail('治理规则禁止能力清单必须与 shared 禁止能力清单保持一致')
  }
  if (!canTransitionToolboxAppStatus('planned', 'draft')) fail('planned 应允许进入 draft')
  if (canTransitionToolboxAppStatus('draft', 'published')) fail('draft 不得跳过审核直接 published')
  if (canTransitionToolboxAppStatus('archived', 'published')) fail('archived 不得恢复 published')

  try {
    assertDistinctToolboxReviewers('reviewer-a', 'reviewer-a')
    fail('提交人与审核人相同必须被拒绝')
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (!code.includes('TOOLBOX_SELF_REVIEW_FORBIDDEN')) fail(`自审批错误码异常: ${code}`)
  }
  try {
    assertDistinctToolboxReviewers('reviewer-a', null)
    fail('审核人缺失必须被拒绝')
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (!code.includes('TOOLBOX_SELF_REVIEW_FORBIDDEN')) fail(`缺审核人错误码异常: ${code}`)
  }

  const activeHostGate = evaluateToolboxHost(activeHost, now)
  if (!activeHostGate.allowed) fail(`active host 应可用: ${JSON.stringify(activeHostGate)}`)
  const expiredHostGate = evaluateToolboxHost({ ...activeHost, expiresAt: '2026-01-01T00:00:00.000Z' }, now)
  if (expiredHostGate.reason !== 'host_expired') fail(`过期 host 必须给出 host_expired: ${JSON.stringify(expiredHostGate)}`)
  const invalidDateHostGate = evaluateToolboxHost({ ...activeHost, expiresAt: 'not-a-date' }, now)
  if (invalidDateHostGate.reason !== 'host_expired') fail(`非法日期 host 必须 fail-closed 为 host_expired: ${JSON.stringify(invalidDateHostGate)}`)
  const suspendedHostGate = evaluateToolboxHost({ ...activeHost, status: 'suspended' }, now)
  if (suspendedHostGate.reason !== 'host_suspended') fail(`熔断 host 必须给出 host_suspended: ${JSON.stringify(suspendedHostGate)}`)
  const pendingHostGate = evaluateToolboxHost({ ...activeHost, status: 'pending_review' }, now)
  if (pendingHostGate.reason !== 'host_not_active') fail(`待审核 host 必须给出 host_not_active: ${JSON.stringify(pendingHostGate)}`)
  const ipv6HostGate = evaluateToolboxHost({ ...activeHost, host: '[::1]' }, now)
  if (ipv6HostGate.reason !== 'host_local_or_private') fail(`IPv6 本机 host 必须被拒绝: ${JSON.stringify(ipv6HostGate)}`)
  const integerIpHostGate = evaluateToolboxHost({ ...activeHost, host: '2130706433' }, now)
  if (integerIpHostGate.reason !== 'host_local_or_private') fail(`整数 IP host 必须被拒绝: ${JSON.stringify(integerIpHostGate)}`)
  const shortIpHostGate = evaluateToolboxHost({ ...activeHost, host: '127.1' }, now)
  if (shortIpHostGate.reason !== 'host_local_or_private') fail(`简写 IP host 必须被拒绝: ${JSON.stringify(shortIpHostGate)}`)
  const octalIpHostGate = evaluateToolboxHost({ ...activeHost, host: '0177.0.0.1' }, now)
  if (octalIpHostGate.reason !== 'host_local_or_private') fail(`八进制 IP host 必须被拒绝: ${JSON.stringify(octalIpHostGate)}`)

  const allowedGate = evaluateToolboxPublishGate(approvedWebApp, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (!allowedGate.allowed) fail(`已审核且 host 可用应用应允许发布: ${JSON.stringify(allowedGate)}`)
  const selfReviewGate = evaluateToolboxPublishGate({ ...approvedWebApp, approvedBy: 'submitter-a' }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (selfReviewGate.reason !== 'self_review') fail(`自审批发布必须被拦截: ${JSON.stringify(selfReviewGate)}`)
  const missingReviewerGate = evaluateToolboxPublishGate({ ...approvedWebApp, approvedBy: null }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (missingReviewerGate.reason !== 'self_review') fail(`缺审核人发布必须被拦截: ${JSON.stringify(missingReviewerGate)}`)
  const draftGate = evaluateToolboxPublishGate({ ...approvedWebApp, status: 'draft' }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (draftGate.reason !== 'app_not_approved') fail(`未审核应用必须被拦截: ${JSON.stringify(draftGate)}`)
  const expiredHostPublishGate = evaluateToolboxPublishGate(approvedWebApp, { allowedHosts: [{ ...activeHost, expiresAt: '2026-01-01T00:00:00.000Z' }], now, externalUrlAllowed: true })
  if (expiredHostPublishGate.reason !== 'host_expired') fail(`过期 host 不得发布: ${JSON.stringify(expiredHostPublishGate)}`)
  const hostNotAllowedGate = evaluateToolboxPublishGate(approvedWebApp, { allowedHosts: [], now, externalUrlAllowed: true })
  if (hostNotAllowedGate.reason !== 'host_not_allowed') fail(`未登记 host 不得发布: ${JSON.stringify(hostNotAllowedGate)}`)
  const invalidTargetGate = evaluateToolboxPublishGate({ ...approvedWebApp, launch: { ...approvedWebApp.launch, externalUrl: 'http://trusted.example.com/salary' } }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (invalidTargetGate.reason !== 'invalid_target_url') fail(`非 HTTPS 目标不得发布: ${JSON.stringify(invalidTargetGate)}`)
  const missingTargetGate = evaluateToolboxPublishGate({ ...approvedWebApp, launch: { ...approvedWebApp.launch, externalUrl: null } }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (missingTargetGate.reason !== 'host_required') fail(`缺少需白名单目标时必须 host_required: ${JSON.stringify(missingTargetGate)}`)
  const inactiveHostPublishGate = evaluateToolboxPublishGate(approvedWebApp, { allowedHosts: [{ ...activeHost, status: 'pending_review' }], now, externalUrlAllowed: true })
  if (inactiveHostPublishGate.reason !== 'host_not_active') fail(`待审核 host 不得发布: ${JSON.stringify(inactiveHostPublishGate)}`)
  const redLineGate = evaluateToolboxPublishGate({ ...approvedWebApp, title: '平台内一键投递' }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (redLineGate.reason !== 'content_blocked') fail(`红线文案不得发布: ${JSON.stringify(redLineGate)}`)
  const missingDisclaimerGate = evaluateToolboxPublishGate({ ...approvedWebApp, riskLevel: 'high', disclaimers: [] }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (missingDisclaimerGate.reason !== 'missing_disclaimer') fail(`高风险应用缺免责声明不得发布: ${JSON.stringify(missingDisclaimerGate)}`)
  const blankDisclaimerGate = evaluateToolboxPublishGate({ ...approvedWebApp, riskLevel: 'high', disclaimers: [' ', ''] }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (blankDisclaimerGate.reason !== 'missing_disclaimer') fail(`高风险应用空白免责声明不得发布: ${JSON.stringify(blankDisclaimerGate)}`)
  const forbiddenCapabilityGate = evaluateToolboxPublishGate({ ...approvedWebApp, permissions: ['offer_management'] }, { allowedHosts: [activeHost], now, externalUrlAllowed: true })
  if (forbiddenCapabilityGate.reason !== 'forbidden_capability') fail(`禁止能力不得发布: ${JSON.stringify(forbiddenCapabilityGate)}`)
  const localHostGate = evaluateToolboxPublishGate({ ...approvedWebApp, launch: { ...approvedWebApp.launch, externalUrl: 'https://127.0.0.1/admin' } }, { allowedHosts: [{ ...activeHost, host: '127.0.0.1' }], now, externalUrlAllowed: true })
  if (localHostGate.reason !== 'host_local_or_private') fail(`本机/私网 host 不得发布: ${JSON.stringify(localHostGate)}`)
  const ipv6LocalHostGate = evaluateToolboxPublishGate({ ...approvedWebApp, launch: { ...approvedWebApp.launch, externalUrl: 'https://[::1]/admin' } }, { allowedHosts: [{ ...activeHost, host: '[::1]' }], now, externalUrlAllowed: true })
  if (ipv6LocalHostGate.reason !== 'host_local_or_private') fail(`IPv6 本机 host 不得发布: ${JSON.stringify(ipv6LocalHostGate)}`)
  const externalSwitchGate = evaluateToolboxPublishGate(approvedWebApp, { allowedHosts: [activeHost], now, externalUrlAllowed: false })
  if (externalSwitchGate.reason !== 'external_url_disabled') fail(`外部 H5 开关关闭时不得发布: ${JSON.stringify(externalSwitchGate)}`)

  if (failed === failedBeforeRuntimeChecks) pass('运行时校验 Phase 2 状态机、自审批、host 过期/熔断、红线和发布 gate')
}

function main(): void {
  console.log('\n=== 百宝箱微应用平台静态门禁 ===')

  const productDoc = mustExist(productDocPath, '产品方案存在')
  const plan = mustExist(planPath, '实施计划存在')
  const sharedTypes = mustExist(sharedTypesPath, '共享微应用类型存在')
  const sharedIndex = mustExist(sharedIndexPath, 'shared index 存在')
  const apiPackage = mustExist(apiPackagePath, 'API package.json 存在')
  const terminalToolboxService = mustExist(terminalToolboxServicePath, '终端百宝箱服务存在')
  const toolboxPolicy = mustExist(toolboxPolicyPath, '百宝箱安全策略存在')
  const toolboxGovernance = mustExist(toolboxGovernancePath, '百宝箱治理规则存在')

  mustContain(productDoc, [
    '百宝箱 = 受控微应用中心 + 场景化服务入口编排 + 首方 AI 技能入口',
    '不能做成“第三方代码运行市场”',
    '第一阶段不能允许第三方上传 JS、WASM、插件包或任意 skill 代码',
    '站内微应用',
    '网页微应用',
    '二维码 / 小程序码',
    'AI 技能包',
    'TOOLBOX_ALLOW_EXTERNAL_URL=false',
    'ToolboxApp',
    'ToolboxAppVersion',
    'ToolboxAllowedHost',
    'draft -> submitted -> approved -> published',
    '提交人不能审批自己的应用',
    '大模型只能返回已审核的 `appKey` 或受控 intent',
    '平台内一键投递',
    '第三方代码执行',
    '为什么要分阶段',
  ], '产品方案覆盖定位、格式、后端管理端、AI 边界、合规红线和阶段原因')

  mustContain(plan, [
    'Non-Goals And Red Lines',
    'Phase 0: 文档、共享类型和静态门禁',
    'Phase 1: 现有百宝箱安全补强',
    'Phase 2: 最小治理模型和审核发布',
    'Phase 3: Kiosk 微应用启动体验',
    'Phase 4: 首方 AI 技能包',
    'Phase 5: 首批微应用逐个上线',
    'Phase 6: 第三方声明式 Skill 网关',
    'TOOLBOX_ALLOW_EXTERNAL_URL',
    '服务端根据 `qrTargetUrl` 生成二维码',
    'AI 工具出参必须是已发布 `appKey` 或受控 intent',
  ], '实施计划覆盖阶段、验收和双模型审查指出的高风险缺口')

  assertBuiltinCatalog(sharedTypes)
  assertBuiltinCatalogRuntime()
  assertGovernanceRuntime()

  mustMatch(
    sharedIndex,
    /export\s+\*\s+from\s+['"]\.\/types\/toolboxMicroApp['"];?/,
    'shared index 导出 toolboxMicroApp',
  )
  mustContain(apiPackage, ['"verify:toolbox-micro-app-platform"'], 'API package 注册微应用平台门禁脚本')
  mustContain(terminalToolboxService, [
    'TOOLBOX_ALLOW_EXTERNAL_URL',
    'TOOLBOX_EXTERNAL_URL_DISABLED',
    'TOOLBOX_CONTENT_BLOCKED',
    'INVALID_TOOLBOX_QR_TARGET_URL',
    'findToolboxComplianceViolation',
  ], '终端百宝箱服务包含外部 H5 开关、合规拦截和二维码目标校验')
  mustContain(toolboxPolicy, [
    '平台内一键投递',
    '平台(?:内)?',
    '企业收简历',
    '.{0,6}简历',
    '候选人筛选',
    '候选人推荐给企业',
    '.{0,6}推荐.{0,8}',
    '面试邀约',
    'offer管理',
  ], '百宝箱安全策略覆盖招聘闭环红线')
  mustContain(toolboxGovernance, [
    'TOOLBOX_GOVERNANCE_TRANSITIONS',
    'assertDistinctToolboxReviewers',
    'evaluateToolboxPublishGate',
    'TOOLBOX_GOVERNANCE_FORBIDDEN_PERMISSIONS',
    'findToolboxComplianceViolation',
    'host_local_or_private',
    'missing_disclaimer',
  ], '百宝箱治理规则覆盖状态机、自审批、host 风险和合规复用')

  mustNotContain(`${productDoc}\n${plan}\n${sharedTypes}`, [
    '支持一键投递',
    '开放一键投递',
    '立即投递按钮',
    '允许企业直收简历',
    '支持候选人推荐给企业',
    '方案允许第三方上传 JS',
    '方案允许第三方上传 WASM',
    '开放任意代码上传',
    'IELTS 官方',
    '官方雅思',
  ], '方案与清单不引入招聘闭环或第三方任意代码执行')

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败 — 百宝箱微应用平台门禁未通过\n`)
    process.exit(1)
  }

  console.log('✅ ALL PASS — 百宝箱微应用平台方案与第一阶段底座一致\n')
}

main()
