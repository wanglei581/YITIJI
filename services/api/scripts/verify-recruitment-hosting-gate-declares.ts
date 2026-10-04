/** 静态钉住门禁的招聘托管配置；不连接数据库、不监听端口。 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const apiRoot = resolve(__dirname, '..')
const sourceRoot = join(apiRoot, 'src')
const flag = 'RECRUITMENT_CONTENT_HOSTING_ENABLED'
const hostingSymbols = /\b(?:isRecruitmentContentHostingEnabled|assertRecruitmentContentHostingEnabled|recruitmentHostingDisabledException)\b/

// 只豁免不验证托管内容的直接引用；理由须指出实际受检能力。
const exemptions: Record<string, string> = {
  "scripts/verify-ai-access.ts": "只核对 AI 访问守卫与控制器元数据，不调用招聘控制器的内容读取或写入方法。",
  "scripts/verify-assistant-voice.ts": "验证小青语音产物 qaRecords 与本人隔离，不包含系统岗位匹配存档。",
  "scripts/verify-beijing-display-time.ts": "只调用日期格式化纯函数，不读取招聘列表或托管能力。",
  "scripts/verify-career-plan-degraded.ts": "验证本人职业规划降级导出与打印，夹具无系统岗位匹配存档。",
  "scripts/verify-console-screen-printed-visits.ts": "只断言出纸页数、匿名会话和设备时间线，不断言招聘指标。",
  "scripts/verify-derivation-kind.ts": "验证文件派生分类与材料检查，文档组合均有阳性存在断言，不含系统岗位匹配存档。",
  "scripts/verify-document-page-count.ts": "验证文档页数与响应字段白名单，列表强制包含全部指定夹具，不含系统岗位匹配存档。",
  "scripts/verify-field-mapping-rule.ts": "只调用字段映射规则的保存、读取与归属检查，不调用托管内容发布或公开列表。",
  "scripts/verify-job-fit-governance.ts": "只调用匿名匹配授权 grant/status/revoke 与静态路由检查，不创建或读取系统岗位匹配。",
  "scripts/verify-job-materials.ts": "验证用户自备材料生成与文档入列，明确断言生成文件存在，不涉及系统岗位报告。",
  "scripts/verify-kiosk-cashier-ui.ts": "终端管理服务仅用于打印夹具，断言对象是现金收银与打印 UI 合同。",
  "scripts/verify-legacy-pending-print-task-disposition.ts": "验证旧打印任务处置、审计与退款，终端管理调用不涉及招聘托管。",
  "scripts/verify-member-assets.ts": "验证本人资产归属与删除；AI 夹具 payload 为非系统岗位数据，列表有 7 条阳性计数。",
  "scripts/verify-offline-agencies-page.ts": "只调用 resolveOfflineListPage 分页参数纯函数，不调用机构列表。",
  "scripts/verify-order.ts": "验证打印订单价格、支付与履约，终端管理服务仅创建打印夹具。",
  "scripts/verify-org-type-enum-sync.ts": "只核对机构类型基础矩阵 getPartnerCapabilities，不调用托管投影 projectPartnerDataSourceCapabilities。",
  "scripts/verify-partner-smart-campus.ts": "终端管理仅用于学校迎新配置与凭证，不断言招聘托管配置。",
  "scripts/verify-payment-real-channels.ts": "验证支付渠道签名与回调，终端管理服务仅用于打印订单夹具。",
  "scripts/verify-policy-eligibility-authoring.ts": "验证普通政策申领条件编辑与预览，有条件条目阳性断言，不用 recruitment 政策。",
  "scripts/verify-policy-eligibility.ts": "核对非 recruitment 类政策的申领条件规则与隐私，不验证招聘托管内容。",
  "scripts/verify-policy-scope.ts": "验证政策机构范围、DI 元数据和缓存键；普通政策过滤不受招聘托管影响。",
  "scripts/verify-print-jobs.ts": "验证打印队列、领取与状态回传；终端管理服务只用于设备与打印夹具。",
  "scripts/verify-recruitment-integration-readiness.ts": "JobsService 仅作桩的类型标注，能力响应由桩固定提供，断言导入预检合同与零写入。",
  "scripts/verify-refund-idempotent.ts": "验证打印订单退款幂等，终端管理服务只用于打印夹具。",
  "scripts/verify-resume-draft-versions.ts": "验证本人简历草稿版本与合并元数据，不含系统岗位匹配存档。",
  "scripts/verify-resume-export-draft-source.ts": "验证本人原始填写简历的导出来源与留存，资产服务不读取系统岗位报告。",
  "scripts/verify-resume-export-formats.ts": "独立关闭复跑已通过，验证本人简历格式与导出对账，夹具不包含系统岗位匹配报告。",
  "scripts/verify-resume-report-export.ts": "验证本人简历诊断报告及导出文件入列，不生成系统岗位匹配报告。",
  "scripts/verify-scan-input-lockout-telemetry.ts": "只验证扫码锁定遥测 DTO、脱敏与接收路径，不调用招聘内容配置。",
  "scripts/verify-terminal-credentials.ts": "验证设备令牌签发、迁移和撤销，不调用招聘内容配置路径。",
  "scripts/verify-terminal-device-config.ts": "只断言终端凭证、停用后的学校与工具箱配置及敏感字段，不断言 recruitmentHosting 返回值。",
  "scripts/verify-terminal-provisioning.ts": "验证设备预配、激活与生命周期守卫，不调用招聘托管内容路径。",
  "scripts/verify-terminal-test-print-seed-guard.ts": "只验证测试打印种子创建守卫，不读取招聘配置。",
  "src/ai/resume/__tests__/self-assessment-consent-reconfirm.test.ts": "验证自我探索授权撤回后职业规划重新确认；夹具无系统岗位匹配上下文。",
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : []
  })
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}

function property(node: ts.Expression, name: string): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(node) && node.name.text === name) return node.expression
  if (ts.isElementAccessExpression(node) && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === name) return node.expression
  return undefined
}

function declaresFlag(source: ts.SourceFile): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const env = property(node.left, flag)
      const processObject = env && property(env, 'env')
      if (processObject && ts.isIdentifier(processObject) && processObject.text === 'process') found = true
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function imports(source: ts.SourceFile): string[] {
  const specifiers: string[] = []
  function add(node: ts.Node | undefined): void {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers.filter((specifier) => specifier.startsWith('.')).flatMap((specifier) => {
    const base = resolve(dirname(source.fileName), specifier)
    const candidates = [base, `${base}.ts`, join(base, 'index.ts')]
    const file = candidates.find((candidate) => existsSync(candidate) && candidate.endsWith('.ts'))
    return file ? [file] : []
  })
}

/** 门禁拆分后仍检查脚本模块的实际引用与声明；进入业务源码即停止递归。 */
function gateSources(file: string, seen = new Set<string>()): ts.SourceFile[] {
  if (seen.has(file)) return []
  seen.add(file)
  const source = parse(file)
  const children = imports(source).filter((dependency) => relative(apiRoot, dependency).startsWith('scripts/'))
  return [source, ...children.flatMap((child) => gateSources(child, seen))]
}

function main(): void {
  const hostedModules = new Set(walk(sourceRoot).filter((file) => file.endsWith('.ts')
    && !relative(sourceRoot, file).startsWith('recruitment-hosting/')
    && hostingSymbols.test(readFileSync(file, 'utf8'))))
  const gates = [
    ...readdirSync(join(apiRoot, 'scripts')).filter((name) => /^verify-.*\.ts$/.test(name)).map((name) => join(apiRoot, 'scripts', name)),
    ...walk(sourceRoot).filter((file) => /\/__tests__\/[^/]+\.test\.ts$/.test(file)),
  ].sort()
  const importers = new Set<string>()
  const violations: string[] = []
  let declared = 0
  let exempted = 0
  for (const file of gates) {
    const sources = gateSources(file)
    const dependencies = sources.flatMap(imports).filter((dependency) => hostedModules.has(dependency))
    if (!dependencies.length) continue
    const name = relative(apiRoot, file).replace(/\\/g, '/')
    importers.add(name)
    if (sources.some(declaresFlag)) declared += 1
    else if (Object.hasOwn(exemptions, name) && exemptions[name].trim()) exempted += 1
    else violations.push(`${name}: 未显式赋值 ${flag}，引用 ${dependencies.map((dependency) => relative(apiRoot, dependency)).join(', ')}`)
  }
  for (const [name, reason] of Object.entries(exemptions)) {
    if (!reason.trim()) violations.push(`${name}: 豁免理由为空`)
    if (!importers.has(name)) violations.push(`${name}: 豁免过期，已不引用托管模块`)
  }
  console.log(`声明 ${declared} 个、豁免 ${exempted} 个、违规 ${violations.length} 个`)
  for (const violation of violations) console.error(`违规 ${violation}`)
  if (violations.length) process.exitCode = 1
  else console.log('verify:recruitment-hosting-gate-declares PASS')
}

main()
