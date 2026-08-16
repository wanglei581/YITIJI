/**
 * S3-1 · P06 打印参数 AI 预填 —— 后端合同验证
 *
 * 这条能力的价值全在「诚实」两个字上，所以本脚本验的不是「能返回东西」，
 * 而是下面这几条**反向**性质：
 *
 *   A. 建议不是决定：返回的是 suggested*，服务端建单/报价链路不引用本模块。
 *   B. 每项都能说出依据：suggested 必须带 basis（code + 证据等级 + 依据文字 + 实测字段）。
 *   C. 推不出来就说推不出来：份数无依据 → not_derivable，不返回一个「1 份」冒充建议。
 *   D. 不可用要明确、且不阻断打印：功能位关闭 / 体检未完成 / 结果读不出 / 文件不可打印
 *      四种情况全部 200 + available:false + 明确原因，不抛错。
 *   E. 不越出硬件与已验证能力边界：建议值必须能通过生产门禁 assertVerifiedPrintParameters；
 *      内容侧想要但门禁不放行的取值只能进 blockedPreference。
 *   F. 功能位独立且不假耦合：独立 feature key、不继承 resume_optimize、
 *      **不因缺少大模型 apiKey 而失效**（本能力不调模型）。
 *   G. 不调模型：全模块无 LLM 调用、无 AiLogService。
 *
 * 纯内存 + 临时 FILE_STORAGE_DIR，无 DB、不触网。
 * 运行：pnpm --filter @ai-job-print/api verify:print-param-suggestion
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-print-param-suggestion-secret-key-0123456789'
const DATA_DIR = mkdtempSync(join(tmpdir(), 'vpps-data-'))
process.env['FILE_STORAGE_DIR'] = DATA_DIR
delete process.env['AI_LLM_API_KEY']
delete process.env['TRTC_LLM_API_KEY']

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AI_MODEL_FEATURES, LlmConfigService } = require('../src/ai/llm/llm-config.service') as
  typeof import('../src/ai/llm/llm-config.service')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require('../src/materials/print-param-suggestion.rules') as
  typeof import('../src/materials/print-param-suggestion.rules')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrintParamSuggestionService } = require('../src/materials/print-param-suggestion.service') as
  typeof import('../src/materials/print-param-suggestion.service')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { assertVerifiedPrintParameters } = require('../src/print-jobs/verified-print-parameters') as
  typeof import('../src/print-jobs/verified-print-parameters')

type PrintParamSuggestionItem = import('../src/materials/print-param-suggestion.types').PrintParamSuggestionItem
type PrintParamSuggestionView = import('../src/materials/print-param-suggestion.types').PrintParamSuggestionView
type MaterialsRequester = import('../src/materials/materials.types').MaterialsRequester
type DocumentProcessTaskView = import('../src/materials/materials.types').DocumentProcessTaskView

const ROOT = join(__dirname, '..')
const FEATURE_KEY = 'print_param_prefill'
const REQUESTER: MaterialsRequester = { kind: 'anonymous', accessToken: 'tok' }

let passCount = 0
let failCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { ok ? pass(msg) : fail(msg) }

function read(rel: string): string {
  const path = join(ROOT, rel)
  if (!existsSync(path)) { fail(`文件不存在: ${rel}`); return '' }
  return readFileSync(path, 'utf8')
}

/** 在一个全新的空配置目录里跑一段断言（用于验证「从未配置过」时的默认行为）。 */
function withFreshConfigDir(fn: (llm: InstanceType<typeof LlmConfigService>) => void): void {
  const previous = process.env['FILE_STORAGE_DIR']
  const fresh = mkdtempSync(join(tmpdir(), 'vpps-fresh-'))
  process.env['FILE_STORAGE_DIR'] = fresh
  try {
    fn(new LlmConfigService())
  } finally {
    process.env['FILE_STORAGE_DIR'] = previous
    rmSync(fresh, { recursive: true, force: true })
  }
}

/** 去掉块注释与行注释，让静态检查只针对真实代码。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ── 体检任务夹具 ────────────────────────────────────────────────────────────
function inspectionResult(checks: Record<string, unknown>): Record<string, unknown> {
  return { mode: 'basic_inspection', checks }
}

/** 夹具里体检 messages 的原文，用于验证透出的提示未被改写。 */
function sourceMessageTexts(result: Record<string, unknown>): string[] {
  const messages = (result['checks'] as { messages?: Array<{ text?: unknown }> } | undefined)?.messages ?? []
  return messages.map((m) => String(m.text))
}

const PDF_3_PAGES = inspectionResult({
  filePresent: true,
  mimeType: 'application/pdf',
  sizeBytes: 204_800,
  purpose: 'print_upload',
  pageCount: 3,
  pageCountSource: 'pdf_lightweight_scan',
  canPrint: true,
  warnings: [],
  messages: [{ code: 'PDF_PAGE_COUNT_DETECTED', severity: 'info', text: 'PDF 页数已完成基础识别' }],
})

const IMAGE_1_PAGE_LOW_DPI = inspectionResult({
  filePresent: true,
  mimeType: 'image/jpeg',
  sizeBytes: 51_200,
  purpose: 'print_upload',
  pageCount: 1,
  pageCountSource: 'image_single_page',
  canPrint: true,
  imageQuality: { widthPx: 600, heightPx: 800, estimatedDpiForA4: 72, minRecommendedDpi: 150, quality: 'low' },
  warnings: ['IMAGE_RESOLUTION_LOW_FOR_A4'],
  messages: [
    { code: 'IMAGE_SINGLE_PAGE', severity: 'info', text: '图片将按 1 页参与打印设置' },
    { code: 'IMAGE_RESOLUTION_LOW_FOR_A4', severity: 'warning', text: '图片像素 600×800，按 A4 打印估算约 72 DPI，清晰度可能不足' },
  ],
})

const PDF_PAGE_COUNT_UNKNOWN = inspectionResult({
  filePresent: true,
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  purpose: 'print_upload',
  pageCount: null,
  pageCountSource: 'pdf_lightweight_scan',
  canPrint: true,
  warnings: ['PDF_PAGE_COUNT_NOT_DETECTED'],
  messages: [{ code: 'PDF_PAGE_COUNT_NOT_DETECTED', severity: 'warning', text: '暂未识别 PDF 页数，以实际打印为准' }],
})

const NOT_PRINTABLE = inspectionResult({
  filePresent: true,
  mimeType: 'application/zip',
  sizeBytes: 100,
  purpose: 'print_upload',
  pageCount: null,
  pageCountSource: 'unsupported',
  canPrint: false,
  warnings: ['PRINT_MIME_UNSUPPORTED'],
  messages: [{ code: 'PRINT_MIME_UNSUPPORTED', severity: 'warning', text: '当前文件格式暂不支持打印前体检' }],
})

/** 只桩掉 getTask（访问控制已由 materials.service 自己的用例覆盖）。 */
function stubMaterials(task: Partial<DocumentProcessTaskView>) {
  return {
    async getTask(id: string): Promise<DocumentProcessTaskView> {
      return {
        id,
        kind: 'inspection',
        status: 'completed',
        requesterMode: 'anonymous',
        sourceFileId: 'file-1',
        resultFileId: null,
        endUserId: null,
        params: {},
        result: null,
        errorCode: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...task,
      } as DocumentProcessTaskView
    },
  } as unknown as import('../src/materials/materials.service').MaterialsService
}

function makeService(
  task: Partial<DocumentProcessTaskView>,
  configure?: (svc: InstanceType<typeof LlmConfigService>) => void,
) {
  const llm = new LlmConfigService()
  // 默认打开功能位；注意刻意**不配 apiKey**，用来证明本能力不依赖大模型凭证。
  llm.update({ enabled: true }, FEATURE_KEY)
  configure?.(llm)
  return new PrintParamSuggestionService(stubMaterials(task), llm)
}

function item(view: PrintParamSuggestionView, field: string): PrintParamSuggestionItem | undefined {
  return view.items.find((entry) => entry.field === field)
}

async function main(): Promise<void> {
  console.log('\n=== S3-1 打印参数预填 后端合同 ===')

  // ── F. 功能位：独立、active、不继承共用键 ────────────────────────────────
  console.log('\n[F] 功能位注册与独立性')
  const meta = AI_MODEL_FEATURES.find((f) => f.key === FEATURE_KEY)
  check(Boolean(meta), `注册表已注册 ${FEATURE_KEY}`)
  check(meta?.status === 'active', '功能位 status=active')
  check(meta?.inheritsFrom === undefined, '功能位不继承 resume_optimize（不重演风险 R3 的连坐）')
  check(meta?.allowCustomSystemPrompt === false, '功能位不开放自定义 System Prompt（本能力不用 prompt）')
  check(
    (meta?.runtimeNote ?? '').includes('不调用大模型'),
    'runtimeNote 如实声明「不调用大模型」（Admin 不会误以为配了模型才生效）',
  )

  // ── E. 能力边界 ──────────────────────────────────────────────────────────
  console.log('\n[E] 已验证能力边界由生产门禁探测，不写死')
  const profile = rules.readCapabilityProfile()
  check(profile.paperSize === 'A4', '幅面锁死 A4（CM2800/CM2820 不支持 A3）')
  check(
    profile.verifiedColorModes.every((v) => { try { assertVerifiedPrintParameters({ colorMode: v }); return true } catch { return false } }),
    'verifiedColorModes 全部能通过生产门禁',
  )
  check(
    profile.verifiedDuplexModes.every((v) => { try { assertVerifiedPrintParameters({ duplex: v }); return true } catch { return false } }),
    'verifiedDuplexModes 全部能通过生产门禁',
  )
  check(
    profile.verifiedPagesPerSheet.every((v) => { try { assertVerifiedPrintParameters({ pagesPerSheet: v }); return true } catch { return false } }),
    'verifiedPagesPerSheet 全部能通过生产门禁',
  )

  // ── B/C/E. 三页 PDF：主用例 ──────────────────────────────────────────────
  console.log('\n[B/C] 三页 PDF：四项各自的推导与依据')
  const multi = await makeService({ result: PDF_3_PAGES }).suggestForInspectionTask('t-1', REQUESTER)
  check(multi.available, '体检完成且可打印 → available=true')
  check(multi.items.length === 4, '恒定返回四项（份数/黑白彩色/单双面/每页张数）')
  check(multi.advisory === true && multi.derivation === 'deterministic_rules', '标注 advisory + 确定性推导（不冒充 AI 生成内容）')
  check(multi.items.every((i) => i.editable === true), '四项全部标注可改')

  const copies = item(multi, 'copies')
  check(copies?.status === 'not_derivable', 'C: 份数无依据 → not_derivable（不返回「1 份」冒充建议）')
  check(copies?.suggestedValue === null, 'C: 份数 suggestedValue 为 null')
  check(copies?.reason?.code === 'COPIES_NOT_DERIVABLE_FROM_INSPECTION', 'C: 份数带机读不可推导原因码')

  const duplex = item(multi, 'duplex')
  check(duplex?.status === 'suggested', '单/双面给出建议')
  check(duplex?.suggestedValue === 'simplex', 'E: 双面未验收 → 建议值压回 simplex（不建议一个建单会被 400 的值）')
  check(duplex?.blockedPreference?.value === 'duplex_long_edge', 'E: 内容侧偏好双面如实登记在 blockedPreference')
  check(duplex?.blockedPreference?.code === 'PRINT_DUPLEX_NOT_VERIFIED', 'E: blockedPreference 带机读原因码')
  check(
    typeof duplex?.basis?.text === 'string' && duplex.basis.text.includes('3 页'),
    'B: 单/双面依据引用了体检实测页数（「为什么这么建议」可展示）',
  )
  check(duplex?.basis?.facts?.['pageCount'] === 3, 'B: 依据附带实测字段快照 pageCount=3')

  const color = item(multi, 'colorMode')
  check(color?.status === 'suggested' && color.suggestedValue === 'black_white', '黑白/彩色建议黑白')
  check(color?.basis?.evidenceLevel === 'E2', 'B: 黑白建议标 E2（系统能力事实，不是内容事实）')
  check(color?.basis?.facts?.['colorContentAnalyzed'] === false, 'B: 如实标注体检未做色彩检测')

  const nup = item(multi, 'pagesPerSheet')
  check(nup?.status === 'suggested' && nup.suggestedValue === 1, '每页张数建议 1')

  check(multi.items.every((i) => i.status !== 'suggested' || i.basis !== null), 'B: 每一条 suggested 都带 basis')
  check(
    multi.items.every((i) => i.status !== 'suggested' || ['E1', 'E2'].includes(i.basis!.evidenceLevel)),
    'B: 证据等级只用 E1/E2 —— 确定性逻辑不标 E3',
  )
  check(multi.items.every((i) => i.status !== 'not_derivable' || i.reason !== null), 'C: 每一条 not_derivable 都带原因')

  // ── B. 单页图片：E1 内容依据 + 体检提示原样透出 ──────────────────────────
  console.log('\n[B] 单页图片：E1 内容依据 + 体检提示透出')
  const single = await makeService({ result: IMAGE_1_PAGE_LOW_DPI }).suggestForInspectionTask('t-2', REQUESTER)
  const singleDuplex = item(single, 'duplex')
  check(singleDuplex?.basis?.code === 'SINGLE_PAGE_SIMPLEX', '1 页 → 单面，依据码 SINGLE_PAGE_SIMPLEX')
  check(singleDuplex?.basis?.evidenceLevel === 'E1', '1 页单面标 E1（页数是体检数出来的用户材料事实）')
  check(singleDuplex?.blockedPreference === null, '1 页不产生被拦截的双面偏好')
  check(item(single, 'pagesPerSheet')?.basis?.code === 'SINGLE_PAGE_NO_NUP', '1 页 → 每张 1 页，依据码 SINGLE_PAGE_NO_NUP')
  check(single.notices.some((n) => n.code === 'IMAGE_RESOLUTION_LOW_FOR_A4'), '低分辨率体检提示原样透出')
  const sourceTexts = sourceMessageTexts(IMAGE_1_PAGE_LOW_DPI)
  check(
    single.notices.length > 0 && single.notices.every((n) => sourceTexts.includes(n.text)),
    '提示文案逐字来自体检结果，未改写、未新造',
  )
  check(single.notices.every((n) => n.severity === 'warning'), '只透出 warning 级提示')

  // ── C. 页数未识别 → 不硬猜 ───────────────────────────────────────────────
  console.log('\n[C] 页数未识别时不硬猜')
  const unknown = await makeService({ result: PDF_PAGE_COUNT_UNKNOWN }).suggestForInspectionTask('t-3', REQUESTER)
  const unknownDuplex = item(unknown, 'duplex')
  check(
    unknownDuplex?.basis?.code === 'DUPLEX_LOCKED_TO_VERIFIED_SIMPLEX' && unknownDuplex.basis.evidenceLevel === 'E2',
    '页数未识别时不编造页数依据，改用 E2 能力边界依据',
  )
  check(
    !(unknownDuplex?.basis?.text ?? '').includes('识别到'),
    '页数未识别时依据文案不声称「识别到 N 页」',
  )

  // ── D. 四种不可用：明确信号 + 不抛错 ─────────────────────────────────────
  console.log('\n[D] 不可用信号明确且不阻断打印流程')
  const disabled = await makeService({ result: PDF_3_PAGES }, (llm) => llm.update({ enabled: false }, FEATURE_KEY))
    .suggestForInspectionTask('t-4', REQUESTER)
  check(!disabled.available && disabled.unavailableReason?.code === 'AI_FEATURE_DISABLED', '功能位关闭 → AI_FEATURE_DISABLED')
  check(disabled.items.length === 0 && disabled.evidence === null, '不可用时不返回任何建议项与依据')
  check(
    (disabled.unavailableReason?.text ?? '').includes('四项都需要你自己设'),
    '不可用文案与 V6 原型 ai-down 口径一致',
  )
  check(
    (disabled.unavailableReason?.text ?? '').includes('打印流程不受影响'),
    'D: 不可用文案明确「打印流程不受影响」（AI 是加速器不是前置条件）',
  )

  const pending = await makeService({ status: 'processing', result: null }).suggestForInspectionTask('t-5', REQUESTER)
  check(!pending.available && pending.unavailableReason?.code === 'INSPECTION_NOT_COMPLETED', '体检未完成 → INSPECTION_NOT_COMPLETED')

  const unreadable = await makeService({ result: { mode: 'skeleton', queued: false } }).suggestForInspectionTask('t-6', REQUESTER)
  check(!unreadable.available && unreadable.unavailableReason?.code === 'INSPECTION_RESULT_UNREADABLE', '体检结果读不出 → INSPECTION_RESULT_UNREADABLE')

  const notPrintable = await makeService({ result: NOT_PRINTABLE }).suggestForInspectionTask('t-7', REQUESTER)
  check(!notPrintable.available && notPrintable.unavailableReason?.code === 'INSPECTION_FILE_NOT_PRINTABLE', '文件不可打印 → INSPECTION_FILE_NOT_PRINTABLE')

  // 任务类型不对属于调用方错误，必须抛（这是唯一会抛的业务分支）
  let threwKind = false
  try {
    await makeService({ kind: 'pii_scan', result: PDF_3_PAGES }).suggestForInspectionTask('t-8', REQUESTER)
  } catch (error) {
    const code = (error as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } } | undefined
    threwKind = code?.error?.code === 'MATERIAL_TASK_KIND_MISMATCH'
  }
  check(threwKind, '非 inspection 任务 → 400 MATERIAL_TASK_KIND_MISMATCH（调用方错误照常抛）')

  // ── F. 反假耦合 / 反连坐 ────────────────────────────────────────────────
  console.log('\n[F] 反假耦合：不因缺少大模型凭证或其它键停用而失效')
  const noKey = makeService({ result: PDF_3_PAGES })
  check(new LlmConfigService().getApiKey(FEATURE_KEY) === null, '前置：本功能位全程未配置 apiKey')
  const noKeyView = await noKey.suggestForInspectionTask('t-9', REQUESTER)
  check(noKeyView.available, 'F: 未配置任何大模型 apiKey，预填仍可用（本能力不调模型）')

  const cascaded = await makeService({ result: PDF_3_PAGES }, (llm) => {
    llm.update({ enabled: false, apiKey: '' }, 'resume_optimize')
    llm.update({ enabled: false, apiKey: '' }, 'assistant_chat')
  }).suggestForInspectionTask('t-10', REQUESTER)
  check(cascaded.available, 'F: 停用 resume_optimize / assistant_chat 不影响预填（不连坐）')

  // 反向再验一次：在**从未单独配置过**本键的干净配置目录里打开 resume_optimize，
  // 本键不得因此被悄悄带开。这条才真正证明两个键之间没有继承关系
  // （上面那条里本键已被 update 固化为独立配置，证不到继承方向）。
  withFreshConfigDir((llm) => {
    llm.update({ apiKey: 'sk-parent', enabled: true }, 'resume_optimize')
    check(
      llm.getConfig('resume_optimize').enabled && !llm.getConfig(FEATURE_KEY).enabled,
      'F: 打开 resume_optimize 不会连带打开预填（两键无继承关系，开关互不传导）',
    )
  })

  // ── A/G. 静态：不建单、不调模型 ─────────────────────────────────────────
  console.log('\n[A/G] 静态检查：不建单、不报价、不调模型')
  const printJobs = read('src/print-jobs/print-jobs.service.ts')
  const quote = read('src/payment/order-quote.service.ts')
  check(!printJobs.includes('print-param-suggestion'), 'A: 建单链路不引用预填模块')
  check(!quote.includes('print-param-suggestion'), 'A: 报价链路不引用预填模块')

  const svcSrc = read('src/materials/print-param-suggestion.service.ts')
  const rulesSrc = read('src/materials/print-param-suggestion.rules.ts')
  for (const [label, src] of [['service', svcSrc], ['rules', rulesSrc]] as const) {
    check(!/AiLogService|LlmProvider|chatCompletion|openai/i.test(src), `G: ${label} 无模型调用 / 无 AiServiceLog 写入`)
  }
  check(svcSrc.includes('getConfig(PRINT_PARAM_PREFILL_FEATURE_KEY).enabled'), 'F: 开关只读 enabled')
  // 只看真实调用点，注释里提到 isReady() 不算（本文件正是靠注释解释「为什么不用它」）
  check(!stripComments(svcSrc).includes('.isReady('), 'F: 开关不走 isReady（不与 apiKey 假耦合）')
  check(rulesSrc.includes('assertVerifiedPrintParameters'), 'E: 规则层直接复用生产门禁探测能力边界，不写死常量')

  console.log(`\n${failCount === 0 ? 'ALL PASS' : 'FAILED'}  pass=${passCount} fail=${failCount}`)
  if (failCount > 0) process.exitCode = 1
}

void main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    rmSync(DATA_DIR, { recursive: true, force: true })
  })
