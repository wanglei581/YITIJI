/**
 * G6 法务文档版本管理验证脚本
 *
 * 检查项：
 *   1. schema.prisma 包含 model LegalDocVersion
 *   2. shared / legal.service.ts 包含四个合规 docType 枚举
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

import * as fs from 'fs'
import * as path from 'path'
import { LegalController } from '../src/legal/legal.controller'

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

  // ── 2. shared / service 包含四个合规 docType 枚举 ────────────────────────────────
  {
    const service = readFile('services/api/src/legal/legal.service.ts')
    const shared = readFile('packages/shared/src/types/legalDocs.ts')
    const required = [
      'privacy_policy',
      'terms_of_service',
      'ai_disclaimer',
      'contract_review_disclaimer',
    ]
    const missing = required.filter(
      (docType) => !service.includes(`'${docType}'`) || !shared.includes(`'${docType}'`)
    )
    if (missing.length > 0) {
      fail('shared / legal.service.ts 缺少合规 docType 枚举', missing.join(', '))
    }
    if (!service.includes('isActive: false')) {
      fail('legal.service.ts 创建法务文档时必须保持草稿未激活')
    }
    pass('shared / legal.service.ts 包含 contract_review_disclaimer，且新文档保持未激活')
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

  // ── 完成 ─────────────────────────────────────────────────────────────────
  console.log('\n=== G6 法务文档版本管理验证通过（12/12 项） ===\n')
}

main().catch((e: unknown) => {
  console.error('验证脚本异常：', e)
  process.exit(1)
})
