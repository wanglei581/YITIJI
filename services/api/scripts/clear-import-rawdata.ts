/**
 * 一次性清理脚本：把现有 ImportRecord.rawDataJson 清空为 '{}'
 *
 * 背景：fix/w4-excel-import-integrity 修复前，previewExcelImport 会把
 * Excel 原始整行（含未映射字段）持久化到 rawDataJson，存在隐私风险。
 * 修复后新记录不再写入原始行，但历史记录需要手动清理。
 *
 * 用法（在 services/api 目录下执行）：
 *   npx ts-node --project tsconfig.json scripts/clear-import-rawdata.ts
 *
 * 或使用 Prisma Studio 手动执行等效 SQL：
 *   UPDATE "ImportRecord" SET "rawDataJson" = '{}';
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('清理 ImportRecord.rawDataJson...')
  const result = await prisma.importRecord.updateMany({
    data: { rawDataJson: '{}' },
  })
  console.log(`已清理 ${result.count} 条 ImportRecord 记录`)
}

main()
  .catch((e) => {
    console.error('清理失败:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
