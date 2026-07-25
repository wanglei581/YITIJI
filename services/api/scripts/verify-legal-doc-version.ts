/**
 * G6 法务文档版本管理验证脚本
 *
 * 检查项：
 *   1. schema.prisma 包含 model LegalDocVersion
 *   2. legal.service.ts 包含三个合规 docType 枚举
 *   3. admin-legal-docs.controller.ts 使用 @UseGuards
 *   4. legal.controller.ts 中 GET /kiosk/legal/:type 路由存在
 *   5. activate 方法写入 auditLog
 *   6. LegalDocPage.tsx 有 API fetch 调用（不只是硬编码）
 *   7. SQLite 迁移文件存在
 *   8. PG 迁移文件存在
 *
 * 运行: pnpm --filter @ai-job-print/api verify:legal-doc-version
 */

import * as fs from 'fs'
import * as path from 'path'

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

  // ── 2. service 包含三个合规 docType 枚举 ─────────────────────────────────
  {
    const service = readFile('services/api/src/legal/legal.service.ts')
    const required = ['privacy_policy', 'terms_of_service', 'ai_disclaimer']
    const missing = required.filter((t) => !service.includes(`'${t}'`))
    if (missing.length > 0) {
      fail('legal.service.ts 缺少合规 docType 枚举', missing.join(', '))
    }
    pass('legal.service.ts 包含三个合规 docType 枚举（privacy_policy / terms_of_service / ai_disclaimer）')
  }

  // ── 3. admin 控制器使用鉴权守卫 ──────────────────────────────────────────
  {
    const adminCtrl = readFile('services/api/src/legal/admin-legal-docs.controller.ts')
    if (!adminCtrl.includes('@UseGuards')) {
      fail('admin-legal-docs.controller.ts 缺少 @UseGuards 鉴权装饰器')
    }
    if (!adminCtrl.includes("Roles('admin')")) {
      fail('admin-legal-docs.controller.ts 缺少 @Roles(\'admin\') 角色限制')
    }
    pass('admin-legal-docs.controller.ts 使用 @UseGuards + @Roles(\'admin\')')
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
    if (!schema.includes('model MemberLegalConsent') || !pgSchema.includes('model MemberLegalConsent')) {
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
    if (!sqliteSql.includes('CREATE TABLE "MemberLegalConsent"') || !pgSql.includes('CREATE TABLE "MemberLegalConsent"')) {
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
    if (!fetchUtil.includes('LEGAL_DRAFT_FALLBACK_VERSION') || !fetchUtil.includes('kiosk/legal/')) {
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
    if (!shared.includes("draft-pending-legal-review") || !apiConst.includes("draft-pending-legal-review")) {
      fail('shared / api 草拟哨兵版本号不一致或缺失')
    }
    pass('Kiosk 提交版本号 + Admin 侧栏入口与激活确认')
  }

  // ── 完成 ─────────────────────────────────────────────────────────────────
  console.log('\n=== G6 法务文档版本管理验证通过（11/11 项） ===\n')
}

main().catch((e: unknown) => {
  console.error('验证脚本异常：', e)
  process.exit(1)
})
