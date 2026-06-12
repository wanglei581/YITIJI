/**
 * 一次性清理脚本：把现有 ImportRecord.rawDataJson 清空为 '{}'
 *
 * 背景：fix/w4-excel-import-integrity 修复前，previewExcelImport 会把
 * Excel 原始整行（含未映射字段）持久化到 rawDataJson，存在隐私风险。
 * 修复后新记录不再写入原始行，但历史记录需要手动清理。
 *
 * 用法（在 services/api 目录下，先确保 DATABASE_URL 已设置）：
 *   DATABASE_URL=file:./prisma/dev.db npx ts-node scripts/clear-import-rawdata.ts
 *
 * 或使用等效 SQL（SQLite）：
 *   sqlite3 prisma/dev.db "UPDATE ImportRecord SET rawDataJson = '{}';"
 *
 * 或使用等效 SQL（PostgreSQL）：
 *   psql $DATABASE_URL -c "UPDATE \"ImportRecord\" SET \"rawDataJson\" = '{}';"
 */

import { createPrismaClient } from '../src/prisma/create-client'

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required')
  }
  const prisma = createPrismaClient(url).client

  await prisma.$connect()
  console.log('清理 ImportRecord.rawDataJson...')
  const result = await prisma.importRecord.updateMany({
    data: { rawDataJson: '{}' },
  })
  console.log(`已清理 ${result.count} 条 ImportRecord 记录`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('清理失败:', e)
  process.exit(1)
})
