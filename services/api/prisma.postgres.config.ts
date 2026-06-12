// PostgreSQL 专用 Prisma 配置（第四阶段）。
// 用法：npx prisma <cmd> --config prisma.postgres.config.ts
//   - migrate deploy / migrate diff 等针对 PG 的命令走本配置
//   - schema/migrations 与 SQLite（prisma.config.ts）完全隔离
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/postgres/schema.prisma",
  migrations: {
    path: "prisma/postgres/migrations",
  },
  datasource: {
    // PG 操作显式用 POSTGRES_URL（避免误连开发 SQLite 的 DATABASE_URL）
    url: process.env["POSTGRES_URL"] ?? process.env["DATABASE_URL"],
  },
});
