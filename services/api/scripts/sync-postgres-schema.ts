/**
 * PostgreSQL schema 同步（第四阶段）。
 *
 * prisma/schema.prisma（SQLite，开发）是唯一模型真相源；本脚本机械转换出
 * prisma/postgres/schema.prisma（仅改 datasource provider 与 generator output），
 * 模型部分逐字一致 → 两套生成 client 的 TS 形状一致。
 *
 * 用法：
 *   pnpm db:pg:sync          重新生成 postgres schema
 *   pnpm db:pg:sync --check  CI 漂移校验（不一致退出码 1）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'prisma', 'schema.prisma')
const OUT_DIR = join(ROOT, 'prisma', 'postgres')
const OUT = join(OUT_DIR, 'schema.prisma')

const HEADER = `// ⚠️ 自动生成文件 — 请勿手改。
// 由 scripts/sync-postgres-schema.ts 从 prisma/schema.prisma（唯一真相源）转换：
// 仅替换 datasource provider 与 generator output，模型部分逐字一致。
// 重新生成：pnpm --filter @ai-job-print/api db:pg:sync

`

function transform(src: string): string {
  let out = src
  // generator output：src/generated/prisma → src/generated/prisma-pg（路径相对本 schema 文件多一层）
  out = out.replace(
    /generator client \{[^}]*\}/,
    'generator client {\n  provider = "prisma-client"\n  output   = "../../src/generated/prisma-pg"\n}',
  )
  // datasource provider：sqlite → postgresql
  out = out.replace(
    /datasource db \{[^}]*\}/,
    'datasource db {\n  provider = "postgresql"\n}',
  )
  return HEADER + out
}

const expected = transform(readFileSync(SRC, 'utf-8'))
const checkMode = process.argv.includes('--check')

if (checkMode) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf-8') !== expected) {
    console.error('postgres schema 与主 schema 漂移：请运行 pnpm --filter @ai-job-print/api db:pg:sync 并提交')
    process.exit(1)
  }
  console.log('postgres schema 同步校验通过')
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT, expected, 'utf-8')
  console.log(`postgres schema written: ${OUT}`)
}
