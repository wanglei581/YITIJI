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

  // ── 完成 ─────────────────────────────────────────────────────────────────
  console.log('\n=== G6 法务文档版本管理验证通过（8/8 项） ===\n')
}

main().catch((e: unknown) => {
  console.error('验证脚本异常：', e)
  process.exit(1)
})
