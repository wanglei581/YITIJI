/**
 * G6 法务文档版本管理验证脚本
 *
 * 检查项：
 *   1. schema.prisma 包含 model LegalDocVersion
 *   2. shared / legal.service.ts 包含合规 docType 枚举（含 operator_info）
 *   3. admin-legal-docs.controller.ts 使用 @UseGuards
 *   4. legal.controller.ts 中 GET /kiosk/legal/:type 路由存在
 *   5. activate 方法写入 auditLog
 *   6. LegalDocPage.tsx 有 API fetch 调用（不只是硬编码）
 *   7. SQLite 迁移文件存在
 *   8. PG 迁移文件存在
 *   … 12. Kiosk / Admin / Partner 三端法务全文均读「当前已激活版本」，无一端硬编码
 *
 * 运行: pnpm --filter @ai-job-print/api verify:legal-doc-version
 */

import 'reflect-metadata'
import * as fs from 'fs'
import * as path from 'path'
import { validate } from 'class-validator'
import { LegalController } from '../src/legal/legal.controller'
import { CreateLegalDocDto } from '../src/legal/dto/admin-legal-doc.dto'
import { LEGAL_DOC_TYPES, LegalService } from '../src/legal/legal.service'
import { LEGAL_DRAFT_FALLBACK_VERSION } from '../src/legal/legal-constants'
import { assertLegalDocsPublished } from '../src/member-auth/legal-docs-published-guard'
import { AdminLegalDocsController } from '../src/legal/admin-legal-docs.controller'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { ROLES_KEY } from '../src/common/decorators/roles.decorator'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'

const ROOT = path.resolve(__dirname, '../../..')

function pass(label: string): void {
  console.log(`  PASS  ${label}`)
}

function fail(label: string, detail?: string): never {
  console.error(`  FAIL  ${label}${detail ? `\n        → ${detail}` : ''}`)
  process.exit(1)
}

function readFile(rel: string): string {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) fail(`文件不存在: ${rel}`)
  return fs.readFileSync(abs, 'utf-8')
}

function dirExists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel))
}

async function main() {
  console.log('\n=== G6 法务文档版本管理验证 ===\n')

  // ── 1. schema.prisma 包含 LegalDocVersion 模型 ──────────────────────────
  {
    const schema = readFile('services/api/prisma/schema.prisma')
    if (!schema.includes('model LegalDocVersion')) {
      fail('schema.prisma 缺少 model LegalDocVersion')
    }
    pass('schema.prisma 包含 model LegalDocVersion')
  }

  // ── 2. shared / service 包含合规 docType 枚举 ────────────────────────────────
  {
    const service = readFile('services/api/src/legal/legal.service.ts')
    const shared = readFile('packages/shared/src/types/legalDocs.ts')
    const required = [
      'privacy_policy',
      'terms_of_service',
      'ai_disclaimer',
      'contract_review_disclaimer',
      'operator_info',
    ]
    const missing = required.filter(
      (docType) => !service.includes(`'${docType}'`) || !shared.includes(`'${docType}'`)
    )
    if (missing.length > 0) {
      fail('shared / legal.service.ts 缺少合规 docType 枚举', missing.join(', '))
    }
    if (!LEGAL_DOC_TYPES.includes('operator_info')) {
      fail('运行中的 LEGAL_DOC_TYPES 未包含 operator_info（源码字符串出现在注释里不算）')
    }
    if (!service.includes('isActive: false')) {
      fail('legal.service.ts 创建法务文档时必须保持草稿未激活')
    }
    pass('shared / legal.service.ts 包含 operator_info，且新文档保持未激活')
  }

  // C4：生产环境没有正式发布的协议就拒绝登录；开发、测试、E2E 照旧回落；显式开关可覆盖。
  // 真调判定函数（不是搜源码字符串），把四种环境组合与三种「未发布」形态各跑一遍。
  {
    const published = { termsVersion: 'v1.0', privacyVersion: 'v1.0', termsDocVersionId: 'doc-t', privacyDocVersionId: 'doc-p', termsPublishedAt: new Date(), privacyPublishedAt: new Date() }
    const draft = { termsVersion: LEGAL_DRAFT_FALLBACK_VERSION, privacyVersion: LEGAL_DRAFT_FALLBACK_VERSION, termsDocVersionId: null, privacyDocVersionId: null, termsPublishedAt: null, privacyPublishedAt: null }
    const unpublishedPrivacy = { ...published, privacyPublishedAt: null }
    const missingTermsDoc = { ...published, termsDocVersionId: null }
    const saved = { nodeEnv: process.env['NODE_ENV'], flag: process.env['LEGAL_DOCS_REQUIRE_PUBLISHED'] }
    const setEnv = (nodeEnv: string | undefined, flag: string | undefined) => {
      if (nodeEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = nodeEnv
      if (flag === undefined) delete process.env['LEGAL_DOCS_REQUIRE_PUBLISHED']; else process.env['LEGAL_DOCS_REQUIRE_PUBLISHED'] = flag
    }
    const rejectCode = (resolved: typeof published | typeof draft): string | null => {
      try {
        assertLegalDocsPublished(resolved as never)
        return null
      } catch (error) {
        const body = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
        return body?.error?.code ?? 'UNKNOWN'
      }
    }
    try {
      setEnv(undefined, undefined)
      if (rejectCode(draft) !== null) fail('开发环境（NODE_ENV 未设）不应拒绝草稿回落版本')
      setEnv('production', undefined)
      if (rejectCode(draft) !== 'LEGAL_DOCS_NOT_PUBLISHED') fail('生产环境没有拒绝草稿回落版本')
      if (rejectCode(unpublishedPrivacy) !== 'LEGAL_DOCS_NOT_PUBLISHED') fail('生产环境没有拒绝「已激活但没有发布时间」的隐私政策')
      if (rejectCode(missingTermsDoc) !== 'LEGAL_DOCS_NOT_PUBLISHED') fail('生产环境没有拒绝缺少协议文档编号的版本')
      if (rejectCode(published) !== null) fail('生产环境拒绝了两份都已发布的正式协议')
      setEnv('production', 'false')
      if (rejectCode(draft) !== null) fail('LEGAL_DOCS_REQUIRE_PUBLISHED=false 没能在生产放开（应急口失效）')
      setEnv(undefined, 'true')
      if (rejectCode(draft) !== 'LEGAL_DOCS_NOT_PUBLISHED') fail('LEGAL_DOCS_REQUIRE_PUBLISHED=true 没能在非生产环境生效')
    } finally {
      setEnv(saved.nodeEnv, saved.flag)
    }
    const auth = readFile('services/api/src/member-auth/member-auth.service.ts')
    const resolverBody = auth.slice(auth.indexOf('async resolveActiveLegalVersions('), auth.indexOf('private assertConsentMatches('))
    if (!resolverBody.includes('assertLegalDocsPublished(resolved)')) fail('resolveActiveLegalVersions 没有调用协议发布闸门')
    if ((auth.match(/await this\.resolveActiveLegalVersions\(\)/g) ?? []).length < 3) fail('短信、扫码、微信三条登录路径没有全部经过 resolveActiveLegalVersions')
    // 判定只在服务端做一处：一体机保留回落，否则 LEGAL_DOCS_REQUIRE_PUBLISHED=false 的应急口对一体机无效。
    const kioskVersions = readFile('apps/kiosk/src/services/auth/legalConsentVersions.ts')
    if (!kioskVersions.includes('LEGAL_DRAFT_FALLBACK_VERSION')) fail('一体机取版本失败时的回落被删了，应急口会对一体机失效')
    pass('C4 协议发布闸门：生产默认拒绝草稿与未发布版本，开发照旧，显式开关两向可覆盖，三条登录路径都经过')
  }

  // ── 3. admin 控制器使用鉴权守卫 ──────────────────────────────────────────
  {
    const adminCtrl = readFile('services/api/src/legal/admin-legal-docs.controller.ts')
    if (!adminCtrl.includes('@UseGuards')) {
      fail('admin-legal-docs.controller.ts 缺少 @UseGuards 鉴权装饰器')
    }
    if (!adminCtrl.includes("Roles('admin')")) {
      fail("admin-legal-docs.controller.ts 缺少 @Roles('admin') 角色限制")
    }
    pass("admin-legal-docs.controller.ts 使用 @UseGuards + @Roles('admin')")
  }

  // ── 4. Kiosk 控制器注册 GET /kiosk/legal/:type ───────────────────────────
  {
    const kioskCtrl = readFile('services/api/src/legal/legal.controller.ts')
    if (!kioskCtrl.includes("@Controller('kiosk/legal')")) {
      fail('legal.controller.ts 未注册 kiosk/legal 路由')
    }
    if (!kioskCtrl.includes("@Get(':type')")) {
      fail('legal.controller.ts 缺少 GET :type 路由')
    }
    pass('legal.controller.ts 注册了 GET /kiosk/legal/:type')
  }

  // ── 5. activate 方法写入 auditLog ────────────────────────────────────────
  {
    const service = readFile('services/api/src/legal/legal.service.ts')
    if (!service.includes('auditLog')) {
      fail('legal.service.ts 的 activate 方法未写入 auditLog')
    }
    if (!service.includes("action: 'legal_doc.activate'")) {
      fail('legal.service.ts 审计日志缺少 action: legal_doc.activate')
    }
    pass('activate 方法写入 auditLog（action: legal_doc.activate）')
  }

  // ── 5a. 公开读取拒绝未知文档类型 ─────────────────────────────────────────
  {
    const controller = new LegalController({ getActive: async () => null } as never)
    try {
      await controller.getActive('unknown_legal_document')
      fail('未知法务文档类型必须返回 400')
    } catch (error) {
      const status = (error as { getStatus?: () => number }).getStatus?.()
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } } | undefined
      if (status !== 400 || response?.error?.code !== 'LEGAL_DOC_TYPE_INVALID') {
        fail('未知法务文档类型应返回 LEGAL_DOC_TYPE_INVALID / 400')
      }
    }
    pass('未知 kiosk legal type 返回 LEGAL_DOC_TYPE_INVALID / 400')
  }

  // ── 6. Kiosk LegalDocPage 有 API fetch 调用 ──────────────────────────────
  {
    const page = readFile('apps/kiosk/src/pages/legal/LegalDocPage.tsx')
    if (!page.includes('fetch(')) {
      fail('LegalDocPage.tsx 未添加 API fetch 调用')
    }
    if (!page.includes('kiosk/legal/')) {
      fail('LegalDocPage.tsx 的 fetch 调用未使用 /kiosk/legal/ 端点')
    }
    if (!page.includes('TERMS_SECTIONS') || !page.includes('PRIVACY_SECTIONS')) {
      fail('LegalDocPage.tsx 缺少硬编码兜底内容（TERMS_SECTIONS / PRIVACY_SECTIONS）')
    }
    pass('LegalDocPage.tsx 有 API fetch 调用，并保留硬编码兜底内容')
  }

  // ── 7. SQLite 迁移文件存在 ───────────────────────────────────────────────
  {
    const sqliteMigDir = 'services/api/prisma/migrations/20260719090000_add_legal_doc_version'
    if (!dirExists(sqliteMigDir)) {
      fail('SQLite 迁移目录不存在', sqliteMigDir)
    }
    const sql = readFile(`${sqliteMigDir}/migration.sql`)
    // SQLite 迁移为 ALTER TABLE（表已由 foundation_batch0 创建）
    if (!sql.includes('LegalDocVersion') || !sql.includes('ADD COLUMN')) {
      fail('SQLite migration.sql 未包含 LegalDocVersion ALTER TABLE 补列操作')
    }
    pass('SQLite 迁移文件存在（ALTER TABLE 补 title / publishedBy 列）')
  }

  // ── 8. PG 迁移文件存在 ───────────────────────────────────────────────────
  {
    const pgMigDir = 'services/api/prisma/postgres/migrations/20260719090000_add_legal_doc_version'
    if (!dirExists(pgMigDir)) {
      fail('PG 迁移目录不存在', pgMigDir)
    }
    const sql = readFile(`${pgMigDir}/migration.sql`)
    if (!sql.includes('CREATE TABLE "LegalDocVersion"')) {
      fail('PG migration.sql 缺少 CREATE TABLE LegalDocVersion')
    }
    pass('PG 迁移文件存在且包含 CREATE TABLE LegalDocVersion')
  }

  // ── 9. MemberLegalConsent 模型 + 双轨迁移 ────────────────────────────────
  {
    const schema = readFile('services/api/prisma/schema.prisma')
    const pgSchema = readFile('services/api/prisma/postgres/schema.prisma')
    if (
      !schema.includes('model MemberLegalConsent') ||
      !pgSchema.includes('model MemberLegalConsent')
    ) {
      fail('schema 缺少 model MemberLegalConsent（SQLite / PG 双轨）')
    }
    if (!schema.includes('legalConsents') || !pgSchema.includes('legalConsents')) {
      fail('EndUser 缺少 legalConsents 关系')
    }
    const sqliteMig = 'services/api/prisma/migrations/20260725120000_add_member_legal_consent'
    const pgMig = 'services/api/prisma/postgres/migrations/20260725120000_add_member_legal_consent'
    if (!dirExists(sqliteMig) || !dirExists(pgMig)) {
      fail('MemberLegalConsent 迁移目录缺失', `${sqliteMig} / ${pgMig}`)
    }
    const sqliteSql = readFile(`${sqliteMig}/migration.sql`)
    const pgSql = readFile(`${pgMig}/migration.sql`)
    if (
      !sqliteSql.includes('CREATE TABLE "MemberLegalConsent"') ||
      !pgSql.includes('CREATE TABLE "MemberLegalConsent"')
    ) {
      fail('MemberLegalConsent 迁移未 CREATE TABLE')
    }
    pass('MemberLegalConsent 模型 + SQLite/PG 迁移存在')
  }

  // ── 10. 登录 DTO / 服务落库同意版本 ──────────────────────────────────────
  {
    const dto = readFile('services/api/src/member-auth/dto/member-login.dto.ts')
    if (!dto.includes('termsVersion') || !dto.includes('privacyVersion')) {
      fail('MemberLoginDto 缺少 termsVersion / privacyVersion')
    }
    const service = readFile('services/api/src/member-auth/member-auth.service.ts')
    if (!service.includes('persistLegalConsent') || !service.includes('LEGAL_VERSION_STALE')) {
      fail('member-auth.service 缺少同意落库或 LEGAL_VERSION_STALE')
    }
    if (!service.includes("source: 'sms_login'")) {
      fail('member-auth.service 未以 sms_login 来源落库同意')
    }
    const qr = readFile('services/api/src/member-auth/member-qr-login.service.ts')
    if (!qr.includes('persistResolvedLegalConsent') || !qr.includes("'qr_login'")) {
      fail('QR claim 未调用 persistResolvedLegalConsent(qr_login)')
    }
    pass('登录 / QR claim 路径关联 LegalDocVersion 同意记录')
  }

  // ── 11. Kiosk 提交版本号 + Admin 侧栏 / 激活确认 ─────────────────────────
  {
    const api = readFile('apps/kiosk/src/services/auth/memberAuthApi.ts')
    if (!api.includes('termsVersion') || !api.includes('privacyVersion')) {
      fail('memberAuthApi.memberLogin 未提交协议版本号')
    }
    const hook = readFile('apps/kiosk/src/pages/auth/hooks/useMemberPhoneLogin.ts')
    if (!hook.includes('fetchLegalConsentVersions')) {
      fail('useMemberPhoneLogin 未拉取当前协议版本')
    }
    const fetchUtil = readFile('apps/kiosk/src/services/auth/legalConsentVersions.ts')
    if (
      !fetchUtil.includes('LEGAL_DRAFT_FALLBACK_VERSION') ||
      !fetchUtil.includes('kiosk/legal/')
    ) {
      fail('legalConsentVersions 未对接 kiosk/legal 或草拟哨兵')
    }
    const nav = readFile('apps/admin/src/layouts/AdminLayoutWrapper.tsx')
    if (!nav.includes("key: 'legal-docs'") || !nav.includes('法务文档版本')) {
      fail('Admin 侧栏缺少法务文档版本入口')
    }
    const page = readFile('apps/admin/src/routes/legal-docs/index.tsx')
    if (!page.includes('window.confirm') || !page.includes('激活')) {
      fail('Admin 法务文档激活缺少二次确认')
    }
    const shared = readFile('packages/shared/src/types/legalDocs.ts')
    const apiConst = readFile('services/api/src/legal/legal-constants.ts')
    if (
      !shared.includes('draft-pending-legal-review') ||
      !apiConst.includes('draft-pending-legal-review')
    ) {
      fail('shared / api 草拟哨兵版本号不一致或缺失')
    }
    pass('Kiosk 提交版本号 + Admin 侧栏入口与激活确认')
  }

  // ── 12. 三端法务全文一律来自「当前已激活版本」；本地文案必须被显式标注 ────
  //
  // 第 6 项早就为 Kiosk 定了「有 API fetch 调用，不只是硬编码」，但只钉了一个文件，
  // Admin / Partner 不在覆盖面内。2026-09-09 生产实测的代价：
  //   admin.zyidai.cn   → 3451 字，版本 2026.08.10-v1.0，载明运营主体
  //   partner.zyidai.cn →  454 字，无版本号、无运营主体，自称「v1 草拟版·
  //                        正式运营前以法务审定发布版本为准」，且**从不调接口**
  // 而 Partner 登录被「我已阅读并同意《用户服务协议》和《隐私政策》」拦着 ——
  // 用户同意的是一份自称不作数的文档。
  //
  // 断言的是**不变量**，不是「不许有本地文案」：
  //   ① 每个展示法务全文的面，都必须真的去读 kiosk/legal 的当前有效版本；
  //   ② 有本地兜底文案的面（Kiosk 断网仍要能读），必须**显式告诉用户这不是正式版本**；
  //   ③ 没有本地兜底文案的面，必须有「读不到就报错」的错误态，而不是空白。
  // ② 是关键：Kiosk 保留兜底是对的（公共终端断网也该能读到条款），
  //    错的是它此前和正式版长得一模一样、且底部免责声明无条件常亮。
  {
    const SURFACES: { rel: string; label: string }[] = [
      { rel: 'apps/kiosk/src/pages/legal/LegalDocPage.tsx', label: 'Kiosk 法务页' },
      { rel: 'apps/admin/src/routes/login/LegalDocsModal.tsx', label: 'Admin 登录页弹层' },
      { rel: 'apps/partner/src/routes/login/LegalDocsModal.tsx', label: 'Partner 登录页弹层' },
    ]
    for (const { rel, label } of SURFACES) {
      const src = readFile(rel)

      // ① 必须真的读当前有效版本（同 app 内的取数 service 也算）
      const sameAppService = rel.replace(/routes\/.*$|pages\/.*$/, 'services/api/legalDocs.ts')
      const viaService =
        fs.existsSync(path.join(ROOT, sameAppService)) &&
        readFile(sameAppService).includes('kiosk/legal')
      if (!src.includes('kiosk/legal') && !viaService) {
        fail(`${label} 未读当前有效版本端点 kiosk/legal`, rel)
      }

      // 判定本地兜底文案：整篇条款常量，或源码字符串字面量里出现条款体裁长句。
      // 只看字符串字面量，不看注释 —— 注释里解释这条规则是允许的。
      const literals = src.match(/'[^'\n]{60,}'|"[^"\n]{60,}"/g) ?? []
      const hasLocalProse =
        /\b[A-Z_]*(?:TERMS|PRIVACY)[A-Z_]*_SECTIONS\b/.test(src) ||
        literals.some((lit) => /本协议|本平台|本服务由|贵机构|不得转借/.test(lit))

      if (hasLocalProse) {
        // ② 有兜底就必须标注，且标注只能出现在兜底那一支
        if (!src.includes('不作为正式版本')) {
          fail(
            `${label} 有本地兜底条款文案，却没有「不作为正式版本」的显式提示`,
            `${rel} —— 兜底与正式版长得一样，用户无从分辨自己读到的是哪一份`,
          )
        }
      } else {
        // ③ 没兜底就必须有错误态，且那个错误态**真的渲染出可见文字**。
        //
        // 这里踩过一次：原先写的是 `src.includes("status: 'error'")`，
        // 而那串在 `type LoadState = ... | { status: 'error' }` 的**类型声明**里也存在 ——
        // 于是把错误文案整句删掉、把 setState 换成 void 0，断言照样绿。
        // 反向变异当场抓到（M3 exit=0）。类型声明不是行为。
        const errorBranches = [...src.matchAll(/status\s*===\s*'error'/g)]
        const rendersMessage = errorBranches.some((m) => {
          const tail = src.slice(m.index ?? 0, (m.index ?? 0) + 240)
          // 分支后面必须跟着一段中文可见文字（≥4 字），空串 / 只有标签不算
          return /[\u4e00-\u9fa5]{4,}/.test(tail)
        })
        if (errorBranches.length === 0 || !rendersMessage) {
          fail(
            `${label} 既无兜底文案，也没有「读不到就报错」并渲染出可见提示的分支`,
            `${rel} —— 只声明 error 类型不算，用户看到的必须是一句话而不是空白`,
          )
        }
      }
    }
    pass('Kiosk / Admin / Partner 三端法务全文均读已激活版本；本地兜底均已显式标注')
  }

  // ── 13. operator_info：发布、公开读取、未发布（走 DTO / Service / Controller，注释字符串不算）──
  await assertOperatorInfoRoundTrip()

  // ── 14. 管理员按 id 读取单个版本（含正文）：只给管理员、每次写访问审计、不存在 404 ──
  await assertAdminReadById()

  // ── 15. 后台「查看正文 / 新增预览」的分章规则必须与一体机逐字同一套 ──────────
  // 两个 app 不能互相 import，后台只能复制一份；这里比对两条标题正则与分段写法，防止两边漂移
  // （漂移的后果：后台预览里是一章，一体机上却拆成了几章或糊成全文）。
  {
    const kiosk = readFile('apps/kiosk/src/pages/legal/legalDocModel.ts')
    const admin = readFile('apps/admin/src/routes/legal-docs/legalDocRender.ts')
    const pick = (src: string, name: string) => src.match(new RegExp(`const ${name} = (.+)`))?.[1]?.trim() ?? null
    for (const name of ['MARKDOWN_HEADING', 'ORDINAL_HEADING']) {
      const k = pick(kiosk, name)
      const a = pick(admin, name)
      if (!k || k !== a) fail(`后台法务正文预览的 ${name} 与一体机不一致`, `一体机：${k}\n        后台：${a}`)
    }
    for (const token of ['.split(/\\n{2,}/)', 'trimmed.length <= 30', "!/[。；;，,]$/.test(trimmed)", "title: '全文'", "title: '开篇说明'"]) {
      if (!kiosk.includes(token) || !admin.includes(token)) fail(`后台法务正文预览与一体机分章写法不一致：${token}`)
    }
    const page = readFile('apps/admin/src/routes/legal-docs/LegalDocPreview.tsx')
    if (!page.includes("from './legalDocRender'") || !page.includes('splitLegalSections(content)')) {
      fail('后台法务正文预览没有用 legalDocRender 的分章函数')
    }
    pass('后台法务正文预览与一体机用同一套分章规则（标题正则与分段写法逐字一致）')
  }

  // ── 完成 ─────────────────────────────────────────────────────────────────
  console.log('\n=== G6 法务文档版本管理验证通过（15/15 项） ===\n')
}

type MemoryDoc = {
  id: string; docType: string; version: string; title: string; content: string
  isActive: boolean; publishedAt: Date | null; publishedBy: string | null; createdAt: Date
}

function projectRow(row: MemoryDoc, select?: Record<string, boolean>): Partial<MemoryDoc> {
  if (!select) return row
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = (row as unknown as Record<string, unknown>)[key]
  }
  return out as Partial<MemoryDoc>
}

function memoryLegalPrisma() {
  const docs: MemoryDoc[] = []
  const audits: Array<{ action: string }> = []
  let seq = 0
  const tx = {
    legalDocVersion: {
      async findFirst(args: { where: { docType: string; isActive: boolean }; select?: Record<string, boolean> }) {
        const row = docs.find((doc) => doc.docType === args.where.docType && doc.isActive === args.where.isActive) ?? null
        return row ? projectRow(row, args.select) : null
      },
      async findUnique(args: { where: { id: string }; select?: Record<string, boolean> }) {
        const row = docs.find((doc) => doc.id === args.where.id) ?? null
        return row ? projectRow(row, args.select) : null
      },
      async create(args: { data: Record<string, unknown>; select?: Record<string, boolean> }) {
        const row: MemoryDoc = {
          id: `doc-${++seq}`,
          docType: String(args.data.docType),
          version: String(args.data.version),
          title: String(args.data.title),
          content: String(args.data.content),
          isActive: Boolean(args.data.isActive),
          publishedAt: (args.data.publishedAt as Date | null | undefined) ?? null,
          publishedBy: (args.data.publishedBy as string | null | undefined) ?? null,
          createdAt: new Date(),
        }
        docs.push(row)
        return projectRow(row, args.select)
      },
      async updateMany(args: { where: { docType: string; isActive: boolean }; data: Partial<MemoryDoc> }) {
        let count = 0
        for (const row of docs) {
          if (row.docType === args.where.docType && row.isActive === args.where.isActive) {
            Object.assign(row, args.data)
            count += 1
          }
        }
        return { count }
      },
      async update(args: { where: { id: string }; data: Partial<MemoryDoc>; select?: Record<string, boolean> }) {
        const row = docs.find((doc) => doc.id === args.where.id)
        if (!row) throw new Error(`missing ${args.where.id}`)
        Object.assign(row, args.data)
        return projectRow(row, args.select)
      },
    },
    auditLog: {
      async create(args: { data: { action: string } }) {
        audits.push({ action: args.data.action })
        return { id: `audit-${++seq}` }
      },
    },
  }
  return { ...tx, $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx), audits }
}

async function dtoAccepts(docType: string): Promise<boolean> {
  const dto = new CreateLegalDocDto()
  dto.docType = docType as CreateLegalDocDto['docType']
  dto.version = '2026.09.26-v1'
  dto.title = '经营者信息'
  dto.content = '营业执照信息见本页。'
  const errors = await validate(dto)
  return !errors.some((error) => error.property === 'docType')
}

async function assertOperatorInfoRoundTrip(): Promise<void> {
  if (!(await dtoAccepts('operator_info'))) {
    fail('CreateLegalDocDto 拒绝 operator_info')
  }
  if (await dtoAccepts('not_a_legal_doc')) {
    fail('CreateLegalDocDto 放行了未知 docType（校验元数据可能没生效）')
  }

  const db = memoryLegalPrisma()
  const audit = {
    writeRequired: async (
      client: { auditLog: { create: (args: { data: { action: string; payloadJson: string } }) => Promise<{ id: string }> } },
      args: { action: string; payload?: unknown },
    ) => {
      const row = await client.auditLog.create({
        data: { action: args.action, payloadJson: JSON.stringify(args.payload ?? {}) },
      })
      return row.id
    },
  }
  const service = new LegalService(db as never, audit as never)
  const controller = new LegalController(service)

  const unpublishedOperator = await controller.getActive('operator_info')
  const unpublishedPrivacy = await controller.getActive('privacy_policy')
  if (JSON.stringify(unpublishedOperator) !== JSON.stringify(unpublishedPrivacy)) {
    fail('operator_info 未发布时的响应与 privacy_policy 不一致', JSON.stringify({ unpublishedOperator, unpublishedPrivacy }))
  }
  if (unpublishedOperator.success !== true || unpublishedOperator.data !== null) {
    fail('未发布应返回 { success: true, data: null }')
  }

  const draft = await service.create({
    docType: 'operator_info',
    version: '2026.09.26-v1',
    title: '经营者信息',
    content: '营业执照：示例主体',
    adminId: 'admin-operator-info',
  })
  if (draft.isActive !== false) fail('新建 operator_info 必须是未激活草稿')
  const draftRead = await controller.getActive('operator_info')
  if (draftRead.success !== true || draftRead.data !== null) {
    fail('只有草稿时公开读取仍应是未发布（data: null）')
  }

  const activated = await service.activate(draft.id, 'admin-operator-info')
  if (!activated.isActive || activated.docType !== 'operator_info' || activated.version !== '2026.09.26-v1') {
    fail('激活 operator_info 后未成为该类型的现行版本')
  }
  if (!db.audits.some((row) => row.action === 'legal_doc.activate')) {
    fail('发布 operator_info 未写入 legal_doc.activate 审计')
  }

  const live = await controller.getActive('operator_info')
  if (
    live.success !== true ||
    live.data?.docType !== 'operator_info' ||
    live.data.version !== '2026.09.26-v1' ||
    live.data.title !== '经营者信息' ||
    !live.data.content.includes('营业执照') ||
    !(live.data.publishedAt instanceof Date)
  ) {
    fail('公开读取未返回现行 operator_info', JSON.stringify(live))
  }
  const privacyAfter = await controller.getActive('privacy_policy')
  if (JSON.stringify(privacyAfter) !== JSON.stringify(unpublishedPrivacy)) {
    fail('发布 operator_info 改变了其它类型的未发布语义')
  }
  pass('operator_info 可发布、可公开读取现行版本；未发布与其它类型同为 data: null')
}

/**
 * 后台「查看正文」读的是 GET /admin/legal-doc-versions/:id。真走 Controller + Service + RolesGuard：
 *   - 管理员读到正文（草稿也能读，发布前核对用）；
 *   - 机构账号（partner）被 RolesGuard 拒绝 —— 方法级 @Roles('admin')，不只靠类级；
 *   - 每次读取写一条 legal_doc.view 审计，载明版本号；
 *   - 版本不存在返回 404 LEGAL_DOC_NOT_FOUND，且不写审计。
 */
async function assertAdminReadById(): Promise<void> {
  const db = memoryLegalPrisma()
  const auditRows: Array<{ action: string; payload: unknown; actorId: string | null }> = []
  const audit = {
    writeRequired: async (
      client: { auditLog: { create: (args: { data: { action: string; payloadJson: string } }) => Promise<{ id: string }> } },
      args: { action: string; actorId?: string | null; payload?: unknown },
    ) => {
      auditRows.push({ action: args.action, payload: args.payload ?? null, actorId: args.actorId ?? null })
      const row = await client.auditLog.create({ data: { action: args.action, payloadJson: JSON.stringify(args.payload ?? {}) } })
      return row.id
    },
  }
  const service = new LegalService(db as never, audit as never)
  const controller = new AdminLegalDocsController(service)
  const admin = { userId: 'admin-reader', role: 'admin' } as AuthedUser
  const partner = { userId: 'partner-reader', role: 'partner', orgId: 'org-1' } as unknown as AuthedUser

  const draft = await service.create({
    docType: 'terms_of_service',
    version: '2026.10.01-试运行v1',
    title: '用户服务协议',
    content: '第一条 总则\n本协议正文用于后台查看验证。',
    adminId: 'admin-author',
  })
  const auditBefore = auditRows.length

  const read = await controller.getOne(draft.id, admin)
  if (read.success !== true || !read.data.content.includes('本协议正文用于后台查看验证') || read.data.version !== '2026.10.01-试运行v1') {
    fail('管理员按 id 读取没有拿到该版本正文', JSON.stringify(read))
  }
  const viewRows = auditRows.slice(auditBefore).filter((row) => row.action === 'legal_doc.view')
  if (viewRows.length !== 1 || viewRows[0].actorId !== 'admin-reader' || !JSON.stringify(viewRows[0].payload).includes('2026.10.01-试运行v1')) {
    fail('查看正文没有写 legal_doc.view 审计（或审计里没有操作人 / 版本号）', JSON.stringify(auditRows))
  }

  const roles = new RolesGuard(new Reflector())
  const roleContext = (user: AuthedUser): ExecutionContext => ({
    getHandler: () => AdminLegalDocsController.prototype.getOne,
    getClass: () => AdminLegalDocsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext
  const methodRoles = Reflect.getMetadata(ROLES_KEY, AdminLegalDocsController.prototype.getOne) as string[] | undefined
  if (!methodRoles || methodRoles.length !== 1 || methodRoles[0] !== 'admin') {
    fail("GET /admin/legal-doc-versions/:id 方法上没有单独声明 @Roles('admin')")
  }
  if (roles.canActivate(roleContext(admin)) !== true) fail('RolesGuard 拒绝了管理员读取法务正文')
  try {
    roles.canActivate(roleContext(partner))
    fail('机构账号（partner）居然能读取管理员法务正文接口')
  } catch (error) {
    const code = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()?.error?.code
    if (code !== 'AUTH_ROLE_FORBIDDEN') fail(`机构账号被拒的错误码应为 AUTH_ROLE_FORBIDDEN，实际 ${String(code)}`)
  }

  const auditBeforeMissing = auditRows.length
  try {
    await controller.getOne('doc-does-not-exist', admin)
    fail('读取不存在的版本没有报错')
  } catch (error) {
    const status = (error as { getStatus?: () => number }).getStatus?.()
    const code = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()?.error?.code
    if (status !== 404 || code !== 'LEGAL_DOC_NOT_FOUND') fail(`读取不存在的版本应为 404 LEGAL_DOC_NOT_FOUND，实际 ${String(status)} ${String(code)}`)
  }
  if (auditRows.length !== auditBeforeMissing) fail('读取不存在的版本也写了审计')

  pass('管理员按 id 读取含正文；机构账号被拒；每次读取写 legal_doc.view 审计；不存在返回 404 且不写审计')
}

main().catch((e: unknown) => {
  console.error('验证脚本异常：', e)
  process.exit(1)
})
