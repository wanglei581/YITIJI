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
  TOOLBOX_MICRO_APP_FORBIDDEN_CAPABILITIES,
} from '../../../packages/shared/src/types/toolboxMicroApp'

const repoRoot = join(__dirname, '../../..')

const productDocPath = join(repoRoot, 'docs/product/toolbox-micro-app-platform.md')
const planPath = join(repoRoot, 'docs/superpowers/plans/2026-07-01-toolbox-micro-app-platform.md')
const sharedTypesPath = join(repoRoot, 'packages/shared/src/types/toolboxMicroApp.ts')
const sharedIndexPath = join(repoRoot, 'packages/shared/src/index.ts')
const apiPackagePath = join(repoRoot, 'services/api/package.json')
const terminalToolboxServicePath = join(repoRoot, 'services/api/src/terminals/terminal-toolbox.service.ts')
const toolboxPolicyPath = join(repoRoot, 'services/api/src/terminals/toolbox-policy.ts')

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

function main(): void {
  console.log('\n=== 百宝箱微应用平台静态门禁 ===')

  const productDoc = mustExist(productDocPath, '产品方案存在')
  const plan = mustExist(planPath, '实施计划存在')
  const sharedTypes = mustExist(sharedTypesPath, '共享微应用类型存在')
  const sharedIndex = mustExist(sharedIndexPath, 'shared index 存在')
  const apiPackage = mustExist(apiPackagePath, 'API package.json 存在')
  const terminalToolboxService = mustExist(terminalToolboxServicePath, '终端百宝箱服务存在')
  const toolboxPolicy = mustExist(toolboxPolicyPath, '百宝箱安全策略存在')

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
