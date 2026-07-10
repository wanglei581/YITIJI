# 首期真实扫描（纸质转电子）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通"Kiosk 发起扫描 → 打印机扫描到 SMB 共享目录 → Terminal Agent 监听并投递 → 后端建档 → Kiosk 结果页可打印/存档/AI 识别"这条真实链路，替换掉 `apps/kiosk/src/pages/scan/*` 现有的纯前端演示流程。

**Architecture:** 新增 Prisma 模型 `ScanTask` 承载"等待中的扫描会话"；Kiosk 建会话后轮询状态；Terminal Agent 用 chokidar 持续监听 SMB 共享目录，文件出现后做稳定性检测，投递给新端点 `POST /terminals/:id/scan-sessions/deliver`，后端按"该终端最早一条 waiting 任务"完成匹配、建 `FileObject`、标记任务完成；未匹配的文件被隔离到 `_unclaimed` 子目录，绝不误发。

**Tech Stack:** NestJS + Prisma（SQLite/PostgreSQL 双迁移）、chokidar（Node 文件监听）、React + react-router（Kiosk）。

**依据的设计文档：** `docs/superpowers/specs/2026-07-10-real-scan-design.md`（已经用户审阅确认）。

---

## 文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `services/api/prisma/schema.prisma` | 修改 | 新增 `ScanTask` 模型 + `Terminal.scanTasks`/`EndUser.scanTasks` 反向关系 |
| `services/api/prisma/migrations/20260710120000_add_scan_task/migration.sql` | 新建 | SQLite 迁移 |
| `services/api/prisma/postgres/migrations/20260710120000_add_scan_task/migration.sql` | 新建 | PostgreSQL 迁移 |
| `services/api/src/terminals/terminals.service.ts` | 修改 | 新增公开方法 `assertAgentAuthorized`，复用既有私有 `findAndValidate` |
| `services/api/src/scan-tasks/dto/create-scan-task.dto.ts` | 新建 | 建会话请求体 |
| `services/api/src/scan-tasks/scan-tasks.service.ts` | 新建 | 核心业务逻辑 |
| `services/api/src/scan-tasks/scan-tasks.controller.ts` | 新建 | 路由 |
| `services/api/src/scan-tasks/scan-tasks.module.ts` | 新建 | 模块装配 |
| `services/api/src/app.module.ts` | 修改 | 注册 `ScanTasksModule` |
| `services/api/scripts/verify-scan-tasks.ts` | 新建 | 后端验证脚本 |
| `services/api/package.json` | 修改 | 新增 `verify:scan-tasks` script |
| `packages/shared/src/types/scanTask.ts` | 新建 | 前后端共享类型 |
| `packages/shared/src/index.ts` | 修改 | 导出新类型 |
| `apps/terminal-agent/package.json` | 修改 | 新增 `chokidar`、`form-data` 依赖 |
| `apps/terminal-agent/src/agent/types.ts` | 修改 | `AgentConfig.scanWatchFolder` |
| `apps/terminal-agent/src/agent/scan-watcher.ts` | 新建 | 文件监听 + 投递 + 隔离 + 周期清点 |
| `apps/terminal-agent/src/index.ts` | 修改 | 装配 scan-watcher |
| `apps/terminal-agent/scripts/verify-scan-watcher.mjs` | 新建 | Agent 侧验证脚本 |
| `apps/kiosk/src/services/api/scanTasks.ts` | 新建 | Kiosk API 客户端 |
| `apps/kiosk/src/pages/scan/ScanStartPage.tsx` | 修改 | 去掉整体禁用 |
| `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx` | 重写 | 参数开关 → 操作指引 + 真实建会话 |
| `apps/kiosk/src/pages/scan/ScanProgressPage.tsx` | 重写 | 假进度 → 真实轮询 |
| `apps/kiosk/src/pages/scan/ScanResultPage.tsx` | 修改 | 假文件 → 真实 `fileId`/`fileUrl` |
| `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx` | 修改 | 删除"流程演示"提示 |

---

### Task 1: Prisma schema 新增 ScanTask（SQLite）

**Files:**
- Modify: `services/api/prisma/schema.prisma`

- [ ] **Step 1: 在 `PrintTask` 模型之后插入 `ScanTask` 模型**

在 `model PrintTask { ... }` 块（约第 70-95 行）结束的 `}` 之后，插入：

```prisma
// ── ScanTask ──────────────────────────────────────────────────────────────────
// 首期真实扫描：Kiosk 发起一个"等待中"的扫描会话，Terminal Agent 监听打印机
// 扫描到 SMB 共享目录产生的文件，按"该终端最早一条 waiting 任务"完成匹配。
// 不支持多终端共享同一打印机并发扫描（当前部署为单终端单打印机）。
model ScanTask {
  id               String    @id @default(cuid())
  terminalId       String
  terminal         Terminal  @relation(fields: [terminalId], references: [id], onDelete: Cascade)
  scanType         String    // 'resume' | 'id' | 'document'
  status           String    @default("waiting")
  // waiting -> matched -> completed
  //         -> expired（超时未匹配，惰性转换）
  //         -> cancelled（用户主动取消）
  //         -> failed（匹配后建档失败）
  endUserId        String?
  endUser          EndUser?  @relation(fields: [endUserId], references: [id], onDelete: SetNull)
  fileId           String?
  matchedFileMtime DateTime?
  errorCode        String?
  errorMessage     String?
  expiresAt        DateTime
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([terminalId, status, createdAt])
  @@index([endUserId])
}
```

- [ ] **Step 2: 给 `Terminal` 模型加反向关系**

找到 `model Terminal { ... }` 里的：

```prisma
  heartbeats TerminalHeartbeat[]
  printTasks PrintTask[]
  bindCodes  TerminalBindCode[]
```

改为：

```prisma
  heartbeats TerminalHeartbeat[]
  printTasks PrintTask[]
  bindCodes  TerminalBindCode[]
  scanTasks  ScanTask[]
```

- [ ] **Step 3: 给 `EndUser` 模型加反向关系**

找到 `model EndUser { ... }` 里的：

```prisma
  jobAiSessions   JobAiSession[]
  aiServiceLogs   AiServiceLog[]
  aiConsents      UserAiConsent[]
  dataRequests    UserDataRequest[]
}
```

改为：

```prisma
  jobAiSessions   JobAiSession[]
  aiServiceLogs   AiServiceLog[]
  aiConsents      UserAiConsent[]
  dataRequests    UserDataRequest[]
  scanTasks       ScanTask[]
}
```

- [ ] **Step 4: 生成 Prisma client 并确认 schema 语法正确**

```bash
cd services/api
npx prisma generate
```

Expected: `✔ Generated Prisma Client` 无报错（若沙箱环境 Prisma engine 异常，至少确认无 schema 语法错误提示）。

---

### Task 2: 新建 SQLite 迁移文件

**Files:**
- Create: `services/api/prisma/migrations/20260710120000_add_scan_task/migration.sql`

- [ ] **Step 1: 创建迁移目录与文件**

```bash
mkdir -p services/api/prisma/migrations/20260710120000_add_scan_task
```

写入 `services/api/prisma/migrations/20260710120000_add_scan_task/migration.sql`：

```sql
-- 首期真实扫描：新增 ScanTask 表。
-- 全部 additive：仅 create table / create index；不 drop / 不 rename / 不改既有列。

-- CreateTable
CREATE TABLE "ScanTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "terminalId" TEXT NOT NULL,
  "scanType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'waiting',
  "endUserId" TEXT,
  "fileId" TEXT,
  "matchedFileMtime" DATETIME,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScanTask_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScanTask_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ScanTask_terminalId_status_createdAt_idx" ON "ScanTask"("terminalId", "status", "createdAt");
CREATE INDEX "ScanTask_endUserId_idx" ON "ScanTask"("endUserId");
```

- [ ] **Step 2: 尝试应用迁移（本地环境若 Prisma engine 异常可跳过，留给有可用环境时执行）**

```bash
cd services/api
npx prisma migrate deploy 2>&1 | tee /tmp/scan-task-migrate.log
```

Expected: `Applying migration '20260710120000_add_scan_task'` 成功；若本地沙箱环境报 `Schema engine error`（已知的、与本迁移无关的环境问题），记录日志后继续，待有可用 SQLite/PostgreSQL 环境时补跑。

---

### Task 3: 生成并新建 PostgreSQL 迁移文件

**Files:**
- Modify（自动生成）: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/postgres/migrations/20260710120000_add_scan_task/migration.sql`

- [ ] **Step 1: 同步 Postgres schema（纯文件转换脚本，不依赖 Prisma engine）**

```bash
cd services/api
pnpm run db:pg:sync
```

Expected: `postgres schema written: .../prisma/postgres/schema.prisma`，确认输出文件里出现新的 `model ScanTask`（内容与 SQLite schema 逐字一致，只是 datasource/generator 头部不同）。

- [ ] **Step 2: 创建 Postgres 迁移目录与文件**

```bash
mkdir -p services/api/prisma/postgres/migrations/20260710120000_add_scan_task
```

写入 `services/api/prisma/postgres/migrations/20260710120000_add_scan_task/migration.sql`：

```sql
-- 首期真实扫描：新增 ScanTask 表（PostgreSQL）。
-- 全部 additive：仅 create table / create index；不 drop / 不 rename / 不改既有列。

-- CreateTable
CREATE TABLE "ScanTask" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "scanType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "endUserId" TEXT,
    "fileId" TEXT,
    "matchedFileMtime" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanTask_terminalId_status_createdAt_idx" ON "ScanTask"("terminalId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ScanTask_endUserId_idx" ON "ScanTask"("endUserId");

-- AddForeignKey
ALTER TABLE "ScanTask" ADD CONSTRAINT "ScanTask_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanTask" ADD CONSTRAINT "ScanTask_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: 校验漂移检查**

```bash
cd services/api
pnpm run db:pg:sync:check
```

Expected: `postgres schema 同步校验通过`。

---

### Task 4: TerminalsService 新增公开鉴权方法

**Files:**
- Modify: `services/api/src/terminals/terminals.service.ts`

- [ ] **Step 1: 在 `findAndValidate` 私有方法附近新增一个公开包装方法**

找到（约第 861 行）：

```ts
  private async findAndValidate(
    terminalId: string,
    authHeader: string | undefined,
    options: { allowDisabled?: boolean } = {},
  ): Promise<void> {
```

在这个方法**之前**插入一个新的公开方法：

```ts
  /**
   * 供其它模块（如 ScanTasksService）复用的 Agent 鉴权校验，
   * 委托给既有的 findAndValidate，避免重复实现 token 校验逻辑。
   */
  async assertAgentAuthorized(
    terminalId: string,
    authHeader: string | undefined,
    options: { allowDisabled?: boolean } = {},
  ): Promise<void> {
    await this.findAndValidate(terminalId, authHeader, options)
  }

```

- [ ] **Step 2: typecheck 确认**

```bash
cd services/api
pnpm run typecheck
```

Expected: 无报错。

---

### Task 5: 共享类型 ScanTask

**Files:**
- Create: `packages/shared/src/types/scanTask.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 写入 `packages/shared/src/types/scanTask.ts`**

```ts
export type ScanType = 'resume' | 'id' | 'document'
export type ScanTaskStatus = 'waiting' | 'matched' | 'completed' | 'failed' | 'expired' | 'cancelled'

export interface ScanSessionCreateRequest {
  scanType: ScanType
  terminalId: string
}

export interface ScanSessionCreateResponse {
  scanTaskId: string
  expiresAt: string
  /** 按 scanType 定制的操作指引（去打印机面板怎么操作），后端下发，前端不再硬编码。 */
  instructions: string[]
}

export interface ScanSessionFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  /** 本系统 HMAC 签名内容 URL，供后续打印/AI 识别流程使用。 */
  fileUrl: string
}

export interface ScanSessionStatusResponse {
  scanTaskId: string
  status: ScanTaskStatus
  scanType: ScanType
  file: ScanSessionFileView | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
}

export interface ScanSessionCancelResponse {
  scanTaskId: string
  status: 'cancelled'
}
```

- [ ] **Step 2: 导出新类型**

在 `packages/shared/src/index.ts` 里，找到：

```ts
export * from './types/uploadSession'
```

在其后加一行：

```ts
export * from './types/scanTask'
```

- [ ] **Step 3: typecheck 确认**

```bash
cd packages/shared
pnpm run typecheck
pnpm run lint
```

Expected: 均无报错。

---

### Task 6: 后端 scan-tasks 模块 — DTO

**Files:**
- Create: `services/api/src/scan-tasks/dto/create-scan-task.dto.ts`

- [ ] **Step 1: 写入文件**

```ts
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateScanTaskDto {
  @IsIn(['resume', 'id', 'document'])
  scanType!: 'resume' | 'id' | 'document'

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  terminalId!: string
}
```

---

### Task 7: 后端 scan-tasks 模块 — Service

**Files:**
- Create: `services/api/src/scan-tasks/scan-tasks.service.ts`

- [ ] **Step 1: 写入完整 service**

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { ScanTaskStatus, ScanType } from '@ai-job-print/shared'
import { PrismaService } from '../prisma/prisma.service'
import { FilesService } from '../files/files.service'
import { signFileUrl } from '../files/signing'
import type { FilePurpose } from '../files/file.types'
import type { CreateScanTaskDto } from './dto/create-scan-task.dto'

const SCAN_TASK_TTL_MS = 10 * 60 * 1000
/** 建档后签发的内容 URL 有效期，与打印/上传会话链路同一惯例（30 分钟）。 */
const SCAN_FILE_URL_TTL_MS = 30 * 60 * 1000

const SCAN_TYPE_TO_PURPOSE: Record<ScanType, FilePurpose> = {
  resume: 'resume_scan',
  id: 'id_scan',
  document: 'print_doc',
}

const SCAN_TYPE_INSTRUCTIONS: Record<ScanType, string[]> = {
  resume: [
    '将简历原件正面朝上放入打印机自动进纸器（或正面朝下放上玻璃板）',
    '在打印机操作面板选择"扫描"功能',
    '选择黑白或彩色（简历建议黑白，文字更清晰）',
    '按下开始扫描；完成后回到一体机等待识别',
  ],
  id: [
    '将证件正面朝下放在打印机玻璃板中央',
    '在打印机操作面板选择"扫描"功能，分辨率建议 300 DPI',
    '按下开始扫描；如需正反面，扫完一面后翻面重复',
    '完成后回到一体机等待识别',
  ],
  document: [
    '将文件放入打印机自动进纸器（多页）或玻璃板（单页）',
    '在打印机操作面板选择"扫描"功能',
    '按下开始扫描；完成后回到一体机等待识别',
  ],
}

export interface ScanTaskFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileUrl: string
}

export interface ScanTaskStatusResult {
  scanTaskId: string
  status: ScanTaskStatus
  scanType: ScanType
  file: ScanTaskFileView | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
}

@Injectable()
export class ScanTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async create(
    dto: CreateScanTaskDto,
    endUserId: string | null,
  ): Promise<{ scanTaskId: string; expiresAt: string; instructions: string[] }> {
    const terminalRef = dto.terminalId.trim()
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true, enabled: true },
    })
    if (!terminal) {
      throw new BadRequestException({ error: { code: 'SCAN_TERMINAL_NOT_FOUND', message: '目标终端不存在' } })
    }
    if (!terminal.enabled) {
      throw new BadRequestException({ error: { code: 'SCAN_TERMINAL_DISABLED', message: '目标终端已停用' } })
    }

    const expiresAt = new Date(Date.now() + SCAN_TASK_TTL_MS)
    const task = await this.prisma.scanTask.create({
      data: {
        terminalId: terminal.id,
        scanType: dto.scanType,
        endUserId,
        expiresAt,
      },
      select: { id: true },
    })

    return {
      scanTaskId: task.id,
      expiresAt: expiresAt.toISOString(),
      instructions: SCAN_TYPE_INSTRUCTIONS[dto.scanType],
    }
  }

  async getStatus(scanTaskId: string, endUserId: string | null): Promise<ScanTaskStatusResult> {
    const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
    if (!task) {
      throw new NotFoundException({ error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' } })
    }
    if (task.endUserId && task.endUserId !== endUserId) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权查看该扫描任务' } })
    }

    const effectiveStatus = this.effectiveStatus(task.status, task.expiresAt)
    if (effectiveStatus === 'expired' && task.status === 'waiting') {
      await this.prisma.scanTask.update({ where: { id: scanTaskId }, data: { status: 'expired' } })
    }

    let file: ScanTaskFileView | null = null
    if (effectiveStatus === 'completed' && task.fileId) {
      const fileObject = await this.prisma.fileObject.findUnique({ where: { id: task.fileId } })
      if (fileObject && !fileObject.deletedAt) {
        const signed = signFileUrl(fileObject.id, SCAN_FILE_URL_TTL_MS)
        file = {
          fileId: fileObject.id,
          filename: fileObject.filename,
          sizeBytes: fileObject.sizeBytes,
          mimeType: fileObject.mimeType,
          sha256: fileObject.sha256,
          fileUrl: signed.url,
        }
      }
    }

    return {
      scanTaskId: task.id,
      status: effectiveStatus as ScanTaskStatus,
      scanType: task.scanType as ScanType,
      file,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      expiresAt: task.expiresAt.toISOString(),
    }
  }

  async cancel(scanTaskId: string, endUserId: string | null): Promise<{ scanTaskId: string; status: 'cancelled' }> {
    const task = await this.prisma.scanTask.findUnique({ where: { id: scanTaskId } })
    if (!task) {
      throw new NotFoundException({ error: { code: 'SCAN_TASK_NOT_FOUND', message: '扫描任务不存在' } })
    }
    if (task.endUserId && task.endUserId !== endUserId) {
      throw new ForbiddenException({ error: { code: 'SCAN_TASK_FORBIDDEN', message: '无权取消该扫描任务' } })
    }
    if (task.status === 'completed') {
      throw new BadRequestException({ error: { code: 'SCAN_TASK_ALREADY_COMPLETED', message: '任务已完成，无法取消' } })
    }
    await this.prisma.scanTask.update({ where: { id: scanTaskId }, data: { status: 'cancelled' } })
    return { scanTaskId, status: 'cancelled' }
  }

  /**
   * Agent 投递入口：找该终端最早一条仍在 waiting 且未过期的任务，建 FileObject，
   * 标记任务完成。找不到匹配任务时抛 409，调用方（Agent）据此把文件移入隔离目录，
   * 绝不猜测归属。
   */
  async deliverScanFile(args: {
    terminalId: string
    buffer: Buffer
    filename: string
    mimeType: string
  }): Promise<{ scanTaskId: string; fileId: string }> {
    const now = new Date()
    const task = await this.prisma.scanTask.findFirst({
      where: { terminalId: args.terminalId, status: 'waiting', expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
    })
    if (!task) {
      throw new BadRequestException({ error: { code: 'NO_WAITING_SCAN_TASK', message: '没有匹配的等待中扫描任务' } })
    }

    // CAS：先把任务标记为 matched，防止同一文件的重复投递请求并发匹配到同一任务。
    const claimed = await this.prisma.scanTask.updateMany({
      where: { id: task.id, status: 'waiting' },
      data: { status: 'matched', matchedFileMtime: now },
    })
    if (claimed.count === 0) {
      throw new BadRequestException({ error: { code: 'NO_WAITING_SCAN_TASK', message: '没有匹配的等待中扫描任务' } })
    }

    try {
      const purpose = SCAN_TYPE_TO_PURPOSE[task.scanType as ScanType]
      const uploaded = await this.files.upload({
        buffer: args.buffer,
        filename: args.filename,
        mimeType: args.mimeType,
        purpose,
        uploaderId: null,
        endUserId: task.endUserId,
      })
      await this.prisma.scanTask.update({
        where: { id: task.id },
        data: { status: 'completed', fileId: uploaded.fileId },
      })
      return { scanTaskId: task.id, fileId: uploaded.fileId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.prisma.scanTask.update({
        where: { id: task.id },
        data: { status: 'failed', errorCode: 'SCAN_UPLOAD_FAILED', errorMessage: message },
      })
      throw error
    }
  }

  private effectiveStatus(status: string, expiresAt: Date): string {
    if (status === 'waiting' && expiresAt.getTime() <= Date.now()) return 'expired'
    return status
  }
}
```

- [ ] **Step 2: 确认 `FilePurpose` 类型可从 `../files/file.types` 导入**

```bash
cd services/api
grep -n "export type FilePurpose" src/files/file.types.ts
```

Expected: 能找到该类型定义（已在现状调研中确认存在）。

---

### Task 8: 后端 scan-tasks 模块 — Controller

**Files:**
- Create: `services/api/src/scan-tasks/scan-tasks.controller.ts`

- [ ] **Step 1: 写入完整 controller**

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { ApiResponse } from '../common/dto/api-response.dto'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { TerminalsService } from '../terminals/terminals.service'
import { CreateScanTaskDto } from './dto/create-scan-task.dto'
import { ScanTasksService } from './scan-tasks.service'

@Controller()
export class ScanTasksController {
  constructor(
    private readonly scanTasks: ScanTasksService,
    private readonly terminals: TerminalsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  @Post('scan/sessions')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  async create(@Body() dto: CreateScanTaskDto, @Req() req: Request) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.scanTasks.create(dto, endUser?.endUserId ?? null)
    return ApiResponse.ok(result)
  }

  @Get('scan/sessions/:id')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async status(@Param('id') id: string, @Req() req: Request) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.scanTasks.getStatus(id, endUser?.endUserId ?? null)
    return ApiResponse.ok(result)
  }

  @Delete('scan/sessions/:id')
  async cancel(@Param('id') id: string, @Req() req: Request) {
    const endUser = await resolveOptionalEndUser(extractAuth(req), this.jwt, this.redis)
    const result = await this.scanTasks.cancel(id, endUser?.endUserId ?? null)
    return ApiResponse.ok(result)
  }

  /** 仅 Terminal Agent 调用：投递扫描到共享目录后产生的文件。 */
  @Post('terminals/:terminalId/scan-sessions/deliver')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(FileInterceptor('file'))
  async deliver(
    @Param('terminalId') terminalId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    await this.terminals.assertAgentAuthorized(terminalId, authHeader)
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少上传文件字段(field name: file)' } })
    }
    const result = await this.scanTasks.deliverScanFile({
      terminalId,
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    })
    return ApiResponse.ok(result)
  }
}

function extractAuth(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const auth = req.headers.authorization
  if (typeof auth === 'string') return auth
  if (Array.isArray(auth)) return auth[0]
  return undefined
}
```

---

### Task 9: 后端 scan-tasks 模块 — Module 装配

**Files:**
- Create: `services/api/src/scan-tasks/scan-tasks.module.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: 写入 `scan-tasks.module.ts`**

```ts
import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { FilesModule } from '../files/files.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { ScanTasksController } from './scan-tasks.controller'
import { ScanTasksService } from './scan-tasks.service'

@Module({
  imports: [FilesModule, JwtVerifierModule, TerminalsModule],
  controllers: [ScanTasksController],
  providers: [ScanTasksService],
  exports: [ScanTasksService],
})
export class ScanTasksModule {}
```

- [ ] **Step 2: 在 `app.module.ts` 注册**

找到：

```ts
import { UploadSessionsModule } from './upload-sessions/upload-sessions.module'
```

在其后加一行：

```ts
import { ScanTasksModule } from './scan-tasks/scan-tasks.module'
```

找到 `imports:` 数组里的：

```ts
    UploadSessionsModule,
```

在其后加一行：

```ts
    ScanTasksModule,
```

- [ ] **Step 3: typecheck 确认**

```bash
cd services/api
pnpm run typecheck
```

Expected: 无报错（若报 `TerminalsModule` 循环依赖，检查 `TerminalsModule` 是否也反过来 import 了 `ScanTasksModule`——不应该，`TerminalsModule` 保持不变，只有 `ScanTasksModule` 单向依赖它）。

---

### Task 10: 后端验证脚本

**Files:**
- Create: `services/api/scripts/verify-scan-tasks.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: 写入验证脚本**

参照 `scripts/verify-upload-sessions.ts` 的 Fake 基础设施风格，但 `ScanTasksService` 直接用 Prisma（非 Redis），所以用一个内存版 FakePrisma 模拟 `scanTask`/`fileObject`/`terminal` 三张表的最小子集。

```ts
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-tasks-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import type { CreateScanTaskDto } from '../src/scan-tasks/dto/create-scan-task.dto'

interface StoredScanTask {
  id: string
  terminalId: string
  scanType: string
  status: string
  endUserId: string | null
  fileId: string | null
  matchedFileMtime: Date | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

interface StoredFileObject {
  id: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  purpose: string
  endUserId: string | null
  deletedAt: Date | null
}

class FakePrisma {
  private seq = 1
  readonly scanTasksById = new Map<string, StoredScanTask>()
  readonly filesById = new Map<string, StoredFileObject>()
  readonly terminals = new Map<string, { id: string; enabled: boolean; terminalCode: string }>()

  constructor() {
    this.terminals.set('t_1', { id: 't_1', enabled: true, terminalCode: 'T-001' })
    this.terminals.set('t_disabled', { id: 't_disabled', enabled: false, terminalCode: 'T-002' })
  }

  readonly terminal = {
    findFirst: async ({ where }: { where: { OR: Array<{ id?: string; terminalCode?: string }> } }) => {
      const ref = where.OR[0]?.id ?? where.OR[1]?.terminalCode
      for (const t of this.terminals.values()) {
        if (t.id === ref || t.terminalCode === ref) return t
      }
      return null
    },
  }

  readonly scanTask = {
    create: async ({ data }: { data: Partial<StoredScanTask> }) => {
      const id = `scan_${this.seq++}`
      const now = new Date()
      const record: StoredScanTask = {
        id,
        terminalId: data.terminalId!,
        scanType: data.scanType!,
        status: 'waiting',
        endUserId: data.endUserId ?? null,
        fileId: null,
        matchedFileMtime: null,
        errorCode: null,
        errorMessage: null,
        expiresAt: data.expiresAt!,
        createdAt: now,
        updatedAt: now,
      }
      this.scanTasksById.set(id, record)
      return { id }
    },
    findUnique: async ({ where }: { where: { id: string } }) => this.scanTasksById.get(where.id) ?? null,
    findFirst: async ({ where }: { where: { terminalId: string; status: string; expiresAt: { gt: Date } } }) => {
      const candidates = Array.from(this.scanTasksById.values())
        .filter((t) => t.terminalId === where.terminalId && t.status === where.status && t.expiresAt.getTime() > where.expiresAt.gt.getTime())
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      return candidates[0] ?? null
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<StoredScanTask> }) => {
      const current = this.scanTasksById.get(where.id)
      if (!current) throw new Error(`scan task not found: ${where.id}`)
      const next = { ...current, ...data, updatedAt: new Date() }
      this.scanTasksById.set(where.id, next)
      return next
    },
    updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<StoredScanTask> }) => {
      const current = this.scanTasksById.get(where.id)
      if (!current || current.status !== where.status) return { count: 0 }
      this.scanTasksById.set(where.id, { ...current, ...data, updatedAt: new Date() })
      return { count: 1 }
    },
  }

  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.filesById.get(where.id) ?? null,
  }
}

class FakeFilesService {
  private seq = 1
  constructor(private readonly prisma: FakePrisma) {}

  async upload(args: { buffer: Buffer; filename: string; mimeType: string; purpose: string; endUserId?: string | null }) {
    const id = `file_${this.seq++}`
    const record: StoredFileObject = {
      id,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mimeType: args.mimeType,
      sha256: `sha_${id}`,
      purpose: args.purpose,
      endUserId: args.endUserId ?? null,
      deletedAt: null,
    }
    this.prisma.filesById.set(id, record)
    return {
      fileId: id,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: `https://files.local/${id}`,
      signedUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      fileExpiresAt: null,
    }
  }
}

function makeService(): { service: ScanTasksService; prisma: FakePrisma } {
  const prisma = new FakePrisma()
  const files = new FakeFilesService(prisma)
  return { service: new ScanTasksService(prisma as never, files as never), prisma }
}

async function expectRejects<T extends Error>(
  action: () => Promise<unknown>,
  errorType: new (...args: never[]) => T,
  label: string,
): Promise<void> {
  let rejected = false
  try {
    await action()
  } catch (error) {
    rejected = true
    assert.ok(error instanceof errorType, `${label}: expected ${errorType.name}, got ${(error as Error).constructor.name}`)
  }
  assert.equal(rejected, true, `${label}: expected rejection`)
}

async function main(): Promise<void> {
  const dto: CreateScanTaskDto = { scanType: 'document', terminalId: 't_1' }

  {
    // 正常建会话 + 匹配投递 + 状态查询全链路
    const { service } = makeService()
    const created = await service.create(dto, null)
    assert.ok(created.scanTaskId)
    assert.equal(created.instructions.length > 0, true, 'instructions must be non-empty')

    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: Buffer.from('%PDF-1.4 scan'),
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
    })
    assert.equal(delivered.scanTaskId, created.scanTaskId)

    const status = await service.getStatus(created.scanTaskId, null)
    assert.equal(status.status, 'completed')
    assert.equal(status.file?.fileId, delivered.fileId)
    assert.match(status.file?.fileUrl ?? '', /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/)
  }

  {
    // 禁用终端不能建会话
    const { service } = makeService()
    await expectRejects(() => service.create({ scanType: 'document', terminalId: 't_disabled' }, null), BadRequestException, 'disabled terminal rejected')
  }

  {
    // 不存在的终端不能建会话
    const { service } = makeService()
    await expectRejects(() => service.create({ scanType: 'document', terminalId: 't_missing' }, null), BadRequestException, 'unknown terminal rejected')
  }

  {
    // 没有等待中任务时投递必须 409（用 BadRequestException 承载），不得误建档
    const { service } = makeService()
    await expectRejects(
      () => service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'stray.pdf', mimeType: 'application/pdf' }),
      BadRequestException,
      'no waiting task rejected',
    )
  }

  {
    // 最早一条 waiting 任务优先匹配（而不是最新一条）
    const { service } = makeService()
    const first = await service.create(dto, null)
    await new Promise((r) => setTimeout(r, 5))
    const second = await service.create(dto, null)
    const delivered = await service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'a.pdf', mimeType: 'application/pdf' })
    assert.equal(delivered.scanTaskId, first.scanTaskId, 'must match the oldest waiting task, not the newest')
    void second
  }

  {
    // 过期任务在查询时惰性转 expired，且不能再被投递匹配
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, { ...task, expiresAt: new Date(Date.now() - 1000) })
    const status = await service.getStatus(created.scanTaskId, null)
    assert.equal(status.status, 'expired')
    await expectRejects(
      () => service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'late.pdf', mimeType: 'application/pdf' }),
      BadRequestException,
      'expired task must not be matched',
    )
  }

  {
    // 他人不能查看 / 取消绑定了 endUserId 的任务
    const { service } = makeService()
    const created = await service.create(dto, 'member_1')
    await expectRejects(() => service.getStatus(created.scanTaskId, 'member_2'), ForbiddenException, 'status forbidden for non-owner')
    await expectRejects(() => service.cancel(created.scanTaskId, 'member_2'), ForbiddenException, 'cancel forbidden for non-owner')
    const cancelled = await service.cancel(created.scanTaskId, 'member_1')
    assert.equal(cancelled.status, 'cancelled')
  }

  {
    // 已完成任务不能取消
    const { service } = makeService()
    const created = await service.create(dto, null)
    await service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'a.pdf', mimeType: 'application/pdf' })
    await expectRejects(() => service.cancel(created.scanTaskId, null), BadRequestException, 'completed task cannot be cancelled')
  }

  {
    // 不存在的任务查询 / 取消都应 404
    const { service } = makeService()
    await expectRejects(() => service.getStatus('missing', null), NotFoundException, 'status not found')
    await expectRejects(() => service.cancel('missing', null), NotFoundException, 'cancel not found')
  }

  {
    // scanType -> FilePurpose 映射正确（id 扫描必须落 id_scan，不能落成通用 print_doc）
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'id', terminalId: 't_1' }, null)
    const delivered = await service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'id.pdf', mimeType: 'application/pdf' })
    const file = prisma.filesById.get(delivered.fileId)
    assert.equal(file?.purpose, 'id_scan')
    void created
  }

  console.log('PASS scan tasks verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: 在 `services/api/package.json` 新增 script**

找到 `"verify:upload-sessions":` 那一行附近，新增：

```json
    "verify:scan-tasks": "node -r @swc-node/register scripts/verify-scan-tasks.ts",
```

- [ ] **Step 3: 运行验证**

```bash
cd services/api
pnpm run verify:scan-tasks
```

Expected: `PASS scan tasks verification`。若失败，逐条比对断言信息定位（常见问题：`FakePrisma.scanTask.findFirst` 的排序/过滤条件、`ScanTasksService` 里 `effectiveStatus` 的过期判断边界）。

- [ ] **Step 4: 全量 typecheck + lint**

```bash
cd services/api
pnpm run typecheck
npx eslint src/scan-tasks/ scripts/verify-scan-tasks.ts src/terminals/terminals.service.ts src/app.module.ts
```

Expected: 均无报错。

---

### Task 11: Terminal Agent — 依赖与配置

**Files:**
- Modify: `apps/terminal-agent/package.json`
- Modify: `apps/terminal-agent/src/agent/types.ts`

- [ ] **Step 1: 新增依赖**

在 `apps/terminal-agent/package.json` 的 `"dependencies"` 里新增（保持字母序，插入到 `axios` 之后）：

```json
    "chokidar": "^4.0.0",
    "form-data": "^4.0.0",
```

（`chokidar` 用于监听 SMB 共享目录；`form-data` 用于 multipart 投递，二者在仓库 lockfile 里都已作为间接依赖存在，这里显式声明为 terminal-agent 的直接依赖。）

```bash
cd apps/terminal-agent
pnpm install
```

- [ ] **Step 2: `AgentConfig` 新增可选字段**

在 `apps/terminal-agent/src/agent/types.ts` 的 `AgentConfig` 接口里，找到：

```ts
  /**
   * Printer name. Must be configurable and match the Windows printer name.
   * Do not rely on a code default; deployment must fill this value explicitly.
   */
  printerName: string
```

在其后加：

```ts
  /**
   * 打印机"扫描到 SMB/FTP 共享目录"对应的本地可访问路径（映射盘符或 UNC 路径）。
   * 显式配置，不给默认值；未配置时扫描监听整体不启动，不影响其余 Agent 功能。
   */
  scanWatchFolder?: string
```

- [ ] **Step 3: typecheck**

```bash
cd apps/terminal-agent
pnpm run typecheck
```

Expected: 无报错。

---

### Task 12: Terminal Agent — scan-watcher 模块

**Files:**
- Create: `apps/terminal-agent/src/agent/scan-watcher.ts`

- [ ] **Step 1: 写入完整模块**

```ts
/**
 * agent/scan-watcher.ts — 首期真实扫描
 *
 * 监听打印机"扫描到 SMB 共享目录"产生的文件：
 *   1. 新文件出现 → 等待文件大小稳定（避免读到还没写完的文件）
 *   2. 整体读取 → POST /terminals/:id/scan-sessions/deliver
 *   3. 投递成功 → 删除源文件
 *   4. 投递失败因为没有匹配的等待中任务（409/NO_WAITING_SCAN_TASK）→ 移入 _unclaimed 子目录，不重试
 *   5. 其它网络/5xx 错误 → 文件保留原地，交给下一轮周期性清点重试
 *
 * 启动时 + 之后每 5 分钟做一次目录清点，处理 Agent 重启期间到达、
 * 或此前投递失败但文件本身未再变化的文件（不会有新的 chokidar change 事件）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import chokidar, { FSWatcher } from 'chokidar'
import FormData from 'form-data'
import type { AgentConfig } from './types'
import { createApiClient, axiosErrorMessage } from './api-client'
import { log, warn, err } from '../logger'

const STABILITY_CHECK_INTERVAL_MS = 500
const STABILITY_MAX_CHECKS = 10
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const UNCLAIMED_DIRNAME = '_unclaimed'

export interface ScanWatcherHandle {
  stop: () => Promise<void>
}

/** 等待文件大小连续两次读取一致，判定为"写入完成"。超时仍返回 false。 */
async function waitForStableFile(filePath: string): Promise<boolean> {
  let lastSize = -1
  for (let i = 0; i < STABILITY_MAX_CHECKS; i++) {
    if (!existsSync(filePath)) return false
    const { size } = statSync(filePath)
    if (size > 0 && size === lastSize) return true
    lastSize = size
    await new Promise((resolve) => setTimeout(resolve, STABILITY_CHECK_INTERVAL_MS))
  }
  return false
}

function ensureUnclaimedDir(scanWatchFolder: string): string {
  const dir = join(scanWatchFolder, UNCLAIMED_DIRNAME)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

/** 处理单个候选文件：稳定性检查 → 投递 → 成功删除 / 未匹配隔离 / 其它错误留原地重试。 */
async function processCandidate(
  filePath: string,
  filename: string,
  config: AgentConfig,
): Promise<void> {
  const stable = await waitForStableFile(filePath)
  if (!stable) {
    warn(`scan-watcher: file did not stabilize in time, skipping this round — ${filename}`)
    return
  }

  const buffer = readFileSync(filePath)
  const form = new FormData()
  form.append('file', buffer, { filename, contentType: guessMimeType(filename) })

  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

  try {
    await client.post(`/terminals/${config.terminalId}/scan-sessions/deliver`, form, {
      headers: form.getHeaders(),
    })
    unlinkSync(filePath)
    log(`scan-watcher: delivered and removed source file — ${filename}`)
  } catch (e) {
    const code = (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
    if (code === 'NO_WAITING_SCAN_TASK') {
      const unclaimedDir = ensureUnclaimedDir(config.scanWatchFolder!)
      renameSync(filePath, join(unclaimedDir, filename))
      warn(`scan-watcher: no waiting scan task, moved to _unclaimed — ${filename}`)
      return
    }
    err(`scan-watcher: delivery failed, leaving file for next sweep — ${filename}: ${axiosErrorMessage(e)}`)
  }
}

/** 目录清点：处理当前已存在、不在 _unclaimed 子目录里的文件。 */
async function sweepFolder(scanWatchFolder: string, config: AgentConfig): Promise<void> {
  let entries: string[]
  try {
    entries = readdirSync(scanWatchFolder)
  } catch (e) {
    warn(`scan-watcher: failed to read scanWatchFolder — ${axiosErrorMessage(e)}`)
    return
  }
  for (const name of entries) {
    if (name === UNCLAIMED_DIRNAME) continue
    const fullPath = join(scanWatchFolder, name)
    try {
      if (statSync(fullPath).isDirectory()) continue
    } catch {
      continue
    }
    await processCandidate(fullPath, name, config)
  }
}

/**
 * 启动扫描监听。未配置 config.scanWatchFolder 时直接返回 undefined，
 * 不影响心跳 / claim 等其余 Agent 功能。
 */
export function startScanWatcher(config: AgentConfig): ScanWatcherHandle | undefined {
  const folder = config.scanWatchFolder?.trim()
  if (!folder) {
    log('scan-watcher: scanWatchFolder 未配置，跳过扫描监听')
    return undefined
  }

  log(`scan-watcher: watching ${folder}`)

  const watcher: FSWatcher = chokidar.watch(folder, {
    ignoreInitial: true,
    depth: 0,
    ignored: (path: string) => path.includes(UNCLAIMED_DIRNAME),
  })

  watcher.on('add', (filePath: string) => {
    const filename = filePath.split(/[\\/]/).pop() ?? filePath
    void processCandidate(filePath, filename, config)
  })

  watcher.on('error', (error: unknown) => {
    err(`scan-watcher: watcher error — ${axiosErrorMessage(error)}`)
  })

  // 启动时清点一次（处理 Agent 重启期间到达、被 ignoreInitial 跳过的文件）
  void sweepFolder(folder, config)

  const sweepTimer = setInterval(() => void sweepFolder(folder, config), SWEEP_INTERVAL_MS)

  return {
    stop: async () => {
      clearInterval(sweepTimer)
      await watcher.close()
    },
  }
}
```

- [ ] **Step 2: typecheck**

```bash
cd apps/terminal-agent
pnpm run typecheck
```

Expected: 无报错。若 `chokidar`/`form-data` 缺少类型声明报错，检查是否需要额外安装 `@types/...`（chokidar 4.x 自带类型；`form-data` 通常也自带 `.d.ts`，一般不需要额外 `@types` 包）。

---

### Task 13: Terminal Agent — 装配进入主流程

**Files:**
- Modify: `apps/terminal-agent/src/index.ts`

- [ ] **Step 1: 查看现有 `agent` 命令的启动顺序**

```bash
grep -n "startHeartbeat\|import.*heartbeat" apps/terminal-agent/src/index.ts
```

- [ ] **Step 2: 引入并启动 scan-watcher**

在文件顶部 import 区域，找到 `heartbeat` 相关 import 那一行附近，加一行：

```ts
import { startScanWatcher } from './agent/scan-watcher'
```

在 `agent` 命令处理函数里，找到 `startHeartbeat(...)` 调用之后的位置，加：

```ts
    startScanWatcher(config)
```

（不需要保留返回的 handle 做优雅关闭——现有 Agent 主进程本来就是靠 `Ctrl+C`/进程退出结束，与 heartbeat/claim 定时器的既有生命周期管理方式一致，不单独引入新的关闭钩子。）

- [ ] **Step 3: typecheck + 既有 verify 回归**

```bash
cd apps/terminal-agent
pnpm run typecheck
pnpm run verify:print-scan-agent
pnpm run verify:agent-profile-guard
```

Expected: typecheck 无报错；两个既有 verify 脚本仍 `ALL PASS`（确认没有破坏心跳/claim 现有逻辑）。

---

### Task 14: Terminal Agent — scan-watcher 单元验证

**Files:**
- Create: `apps/terminal-agent/scripts/verify-scan-watcher.mjs`

- [ ] **Step 1: 写入验证脚本（用临时目录 + 假文件，不需要真实打印机/后端）**

```js
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 本脚本只做静态/结构性检查（源码里必须存在的关键行为），
// 不直接 import TS 源码执行完整监听逻辑（chokidar 真实监听需要事件循环持续运行，
// 不适合一次性 verify 脚本）；真实监听行为交给 Windows 真机验收覆盖。

const source = readFileSync(new URL('../src/agent/scan-watcher.ts', import.meta.url), 'utf8')

async function main() {
  assert.match(source, /export function startScanWatcher/, 'must export startScanWatcher')
  assert.match(source, /scanWatchFolder\?\.trim\(\)/, 'must treat unconfigured scanWatchFolder as a no-op, not a crash')
  assert.match(source, /ignoreInitial:\s*true/, 'chokidar watch must ignore pre-existing files at boot (handled separately by sweepFolder)')
  assert.match(source, /NO_WAITING_SCAN_TASK/, 'must special-case the no-match error code')
  assert.match(source, /_unclaimed/, 'must quarantine unmatched files instead of silently dropping or misattributing them')
  assert.match(source, /unlinkSync\(filePath\)/, 'must delete the source file after successful delivery (privacy: no lingering scans in the shared folder)')
  assert.match(source, /setInterval\(\(\) => void sweepFolder/, 'must periodically re-sweep the folder, not rely solely on chokidar change events for retries')

  // 稳定性检测的行为级验证：构造一个临时目录，确认目录清点能正确跳过 _unclaimed 子目录本身。
  const dir = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-'))
  try {
    writeFileSync(join(dir, 'sample.pdf'), '%PDF-1.4 test')
    const unclaimedDir = join(dir, '_unclaimed')
    mkdirSync(unclaimedDir)
    const entries = readdirSync(dir)
    assert.ok(entries.includes('sample.pdf'))
    assert.ok(entries.includes('_unclaimed'))
    assert.ok(existsSync(unclaimedDir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log('PASS scan-watcher verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: 在 `apps/terminal-agent/package.json` 新增 script**

```json
    "verify:scan-watcher": "node scripts/verify-scan-watcher.mjs"
```

- [ ] **Step 3: 运行**

```bash
cd apps/terminal-agent
pnpm run verify:scan-watcher
```

Expected: `PASS scan-watcher verification`。

---

### Task 15: Kiosk — API 客户端

**Files:**
- Create: `apps/kiosk/src/services/api/scanTasks.ts`

- [ ] **Step 1: 写入文件（结构参照 `uploadSessions.ts`）**

```ts
import type {
  ScanSessionCancelResponse,
  ScanSessionCreateRequest,
  ScanSessionCreateResponse,
  ScanSessionStatusResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

function makeUrl(path: string): string {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

async function requestJson<T>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> {
  const token = init?.token
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(makeUrl(path), { ...init, headers, credentials: 'include' })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<T> | T | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T> | T
  } catch {
    payload = null
  }

  if (!res.ok) {
    const envelope = payload as ResponseEnvelope<T> | null
    const code = envelope?.error?.code ?? 'UNKNOWN_ERROR'
    const message = envelope?.error?.message ?? `请求失败（${res.status}）`
    throw new ApiHttpError(code, message, res.status)
  }

  const envelope = payload as ResponseEnvelope<T> | null
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    if (envelope.data === undefined || envelope.data === null) {
      throw new ApiHttpError('SCAN_TASK_EMPTY', '扫描任务返回数据为空', res.status)
    }
    return envelope.data
  }
  if (payload === null) {
    throw new ApiHttpError('SCAN_TASK_EMPTY', '扫描任务返回数据为空', res.status)
  }
  return payload as T
}

export function createScanSession(
  input: ScanSessionCreateRequest,
  token?: string | null,
): Promise<ScanSessionCreateResponse> {
  return requestJson<ScanSessionCreateResponse>('/scan/sessions', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  })
}

export function getScanSessionStatus(scanTaskId: string, token?: string | null): Promise<ScanSessionStatusResponse> {
  return requestJson<ScanSessionStatusResponse>(`/scan/sessions/${encodeURIComponent(scanTaskId)}`, { token })
}

export function cancelScanSession(scanTaskId: string, token?: string | null): Promise<ScanSessionCancelResponse> {
  return requestJson<ScanSessionCancelResponse>(`/scan/sessions/${encodeURIComponent(scanTaskId)}`, {
    method: 'DELETE',
    token,
  })
}
```

- [ ] **Step 2: typecheck**

```bash
cd apps/kiosk
pnpm run typecheck
```

Expected: 无报错（若 `@ai-job-print/shared` 类型未生效，先在仓库根目录跑一次 `pnpm -w build` 或对应 shared 包的 build/typecheck 确保类型已生成）。

---

### Task 16: Kiosk — ScanStartPage 去掉整体禁用

**Files:**
- Modify: `apps/kiosk/src/pages/scan/ScanStartPage.tsx`

- [ ] **Step 1: 移除 `API_MODE==='http'` 整体禁用**

删除：

```ts
  const scanUnavailable = API_MODE === 'http'
```

以及 JSX 里所有引用 `scanUnavailable` 的地方（`ComplianceBanner` 的条件文案、按钮的 `disabled`/文案分支），改为固定展示"流程演示"文案在 mock 模式、真实模式下正常显示"下一步"。具体：

```tsx
      {/* 真实扫描已接入：mock 模式仍提示为流程演示，http 模式不再整体禁用 */}
      <div className="mt-4">
        <ComplianceBanner tone="success" title="真实扫描">
          {COMPLIANCE_COPY.KIOSK_SCAN_DEMO_NOTICE}
        </ComplianceBanner>
      </div>
```

按钮部分改为：

```tsx
      <div className="mt-6">
        <Button
          size="lg"
          className="w-full"
          disabled={selected === null}
          onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}
        >
          下一步
        </Button>
      </div>
```

删掉不再使用的 `API_MODE` import（若本文件其它地方不再引用）。

- [ ] **Step 2: typecheck + lint**

```bash
cd apps/kiosk
pnpm run typecheck
npx eslint src/pages/scan/ScanStartPage.tsx
```

Expected: 无报错，无未使用 import 警告。

---

### Task 17: Kiosk — ScanSettingsPage 重写为操作指引

**Files:**
- Modify: `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`

- [ ] **Step 1: 整体重写**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, LoaderIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { getTerminalId } from '../../services/api/screensaver'
import { createScanSession } from '../../services/api/scanTasks'

type ScanType = 'resume' | 'id' | 'document'

interface LocationState {
  scanType?: ScanType
}

export function ScanSettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const scanType = state.scanType ?? 'document'

  const [instructions, setInstructions] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanTaskId, setScanTaskId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    createScanSession({ scanType, terminalId: getTerminalId() }, getToken())
      .then((created) => {
        if (cancelled) return
        setInstructions(created.instructions)
        setScanTaskId(created.scanTaskId)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '创建扫描任务失败，请重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConfirm = () => {
    if (!scanTaskId || starting) return
    setStarting(true)
    navigate('/scan/progress', { state: { scanTaskId, scanType } })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="扫描设置"
        subtitle="请按下方指引在打印机上操作"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            上一步
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {loading && (
          <Card className="flex items-center gap-3 p-5">
            <LoaderIcon className="h-5 w-5 animate-spin text-primary-500" />
            <p className="text-sm text-neutral-600">正在创建扫描任务…</p>
          </Card>
        )}

        {error && (
          <Card className="flex items-center gap-2 border-error/30 bg-error-bg p-5">
            <AlertCircleIcon className="h-4 w-4 shrink-0 text-error-fg" />
            <p className="text-sm text-error-fg">{error}</p>
          </Card>
        )}

        {instructions && (
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium text-neutral-700">请到打印机操作面板依次操作</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-neutral-700">
              {instructions.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          </Card>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate(-1)}>
          返回
        </Button>
        <Button size="lg" className="flex-1" disabled={!scanTaskId || starting} onClick={handleConfirm}>
          我已在打印机上操作，开始等待
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: typecheck + lint**

```bash
cd apps/kiosk
pnpm run typecheck
npx eslint src/pages/scan/ScanSettingsPage.tsx
```

Expected: 无报错。

---

### Task 18: Kiosk — ScanProgressPage 重写为真实轮询

**Files:**
- Modify: `apps/kiosk/src/pages/scan/ScanProgressPage.tsx`

- [ ] **Step 1: 整体重写**

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AlertCircleIcon, ScanIcon, XCircleIcon } from 'lucide-react'
import { Button } from '@ai-job-print/ui'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { cancelScanSession, getScanSessionStatus } from '../../services/api/scanTasks'

type ScanType = 'resume' | 'id' | 'document'

interface LocationState {
  scanTaskId?: string
  scanType?: ScanType
}

const POLL_INTERVAL_MS = 2000

export function ScanProgressPage() {
  useBusyLock(true)
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const scanTaskId = state.scanTaskId
  const scanType = state.scanType ?? 'document'

  const [error, setError] = useState<string | null>(null)
  const cancellingRef = useRef(false)

  useEffect(() => {
    if (!scanTaskId) {
      navigate('/scan/start', { replace: true })
      return undefined
    }

    let stopped = false
    const poll = async () => {
      try {
        const status = await getScanSessionStatus(scanTaskId, getToken())
        if (stopped) return
        if (status.status === 'completed' && status.file) {
          navigate('/scan/result', {
            replace: true,
            state: {
              scanType,
              success: true,
              file: {
                fileId: status.file.fileId,
                fileUrl: status.file.fileUrl,
                name: status.file.filename,
                size: formatSize(status.file.sizeBytes),
                mimeType: status.file.mimeType,
                pages: null,
                format: 'PDF' as const,
              },
            },
          })
          return
        }
        if (status.status === 'expired') {
          navigate('/scan/result', { replace: true, state: { scanType, success: false, reason: '扫描超时，请返回重新开始' } })
          return
        }
        if (status.status === 'failed') {
          navigate('/scan/result', { replace: true, state: { scanType, success: false, reason: status.errorMessage ?? '扫描处理失败，请重试' } })
          return
        }
        if (status.status === 'cancelled') {
          navigate('/scan/start', { replace: true })
          return
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : '查询扫描状态失败')
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTaskId])

  const handleCancel = async () => {
    if (!scanTaskId || cancellingRef.current) return
    cancellingRef.current = true
    try {
      await cancelScanSession(scanTaskId, getToken())
    } catch {
      // best-effort：任务会在过期后自然结束
    } finally {
      navigate('/scan/start', { replace: true })
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="mb-10 flex h-24 w-24 items-center justify-center rounded-full bg-primary-50">
        <ScanIcon className="h-12 w-12 animate-pulse text-primary-600" />
      </div>

      <h1 className="text-2xl font-bold text-neutral-900">等待打印机端扫描完成</h1>
      <p className="mt-2 text-base text-neutral-500">请在打印机上完成操作，本页会自动检测结果</p>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error-fg">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-10">
        <Button variant="secondary" size="lg" onClick={handleCancel}>
          <XCircleIcon className="mr-2 h-4 w-4" />
          取消扫描
        </Button>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
```

- [ ] **Step 2: typecheck + lint**

```bash
cd apps/kiosk
pnpm run typecheck
npx eslint src/pages/scan/ScanProgressPage.tsx
```

Expected: 无报错。

---

### Task 19: Kiosk — ScanResultPage 接真实文件

**Files:**
- Modify: `apps/kiosk/src/pages/scan/ScanResultPage.tsx`

- [ ] **Step 1: 更新 `ScannedFile`/`ScanResultState` 类型 + 三个动作函数**

把：

```ts
interface ScannedFile {
  name: string
  size: string
  pages: number
  format: 'PDF'
}
```

改为：

```ts
interface ScannedFile {
  fileId: string
  fileUrl: string
  name: string
  size: string
  pages: number | null
  format: 'PDF'
  mimeType?: string
}
```

把三个动作函数里 `API_MODE === 'http'` 的判断全部去掉，改判是否有真实 `file`：

```ts
  const handlePrint = () => {
    if (!file) return
    navigate('/print/confirm', {
      state: {
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, pages: file.pages, mimeType: file.mimeType },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleSave = () => {
    if (!file) return
    navigate('/me/documents')
  }

  const handleResumeAI = () => {
    if (!file) return
    navigate('/resume/parse', {
      state: {
        source: 'scan',
        file: { fileId: file.fileId, fileUrl: file.fileUrl, name: file.name, size: file.size, format: file.format },
      },
    })
  }
```

同步把 JSX 里三个按钮的 `disabled={API_MODE === 'http'}`/`title={API_MODE === 'http' ? ... : undefined}` 改成 `disabled={!file}`（"AI 简历识别"按钮额外保留 `scanType !== 'resume'` 的判断，只去掉 `API_MODE` 部分）；删掉不再使用的 `API_MODE` import（若本文件其余地方不再需要）。

**保存动作的落点调整说明**：现有 mock 的 `handleSave` 之前跳 `/profile` 并在 state 里塞 `savedFile`——这是假保存（并没有真的持久化）。真实链路里，扫描文件在 `deliverScanFile()` 时已经通过 `FilesService.upload()` 落库成真实 `FileObject`（`endUserId` 已按会话归属），所以"保存"这个动作不需要再额外发一次请求，直接跳转到已存在的 `/me/documents`（我的文档）页面查看即可，不新增后端调用。

- [ ] **Step 2: typecheck + lint**

```bash
cd apps/kiosk
pnpm run typecheck
npx eslint src/pages/scan/ScanResultPage.tsx
```

Expected: 无报错，无 `API_MODE` 未使用警告。

---

### Task 20: Kiosk — 服务中心去掉"流程演示"提示

**Files:**
- Modify: `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx`

- [ ] **Step 1: 删除"材料扫描"卡片的 note**

找到：

```ts
  {
    key: 'scan',
    icon: ScanLineIcon,
    iconBg: 'bg-success-bg',
    iconColor: 'text-success-fg',
    title: '材料扫描',
    description: '纸质材料扫描成 PDF / 图片存档',
    to: '/scan/start',
    available: true,
    note: '流程演示，真机扫描需连接 Terminal Agent',
  },
```

删除 `note` 这一行：

```ts
  {
    key: 'scan',
    icon: ScanLineIcon,
    iconBg: 'bg-success-bg',
    iconColor: 'text-success-fg',
    title: '材料扫描',
    description: '纸质材料扫描成 PDF / 图片存档',
    to: '/scan/start',
    available: true,
  },
```

- [ ] **Step 2: typecheck + lint**

```bash
cd apps/kiosk
pnpm run typecheck
npx eslint src/pages/print-scan/PrintScanHomePage.tsx
```

Expected: 无报错。

---

### Task 21: 全量验证 + 浏览器走查

**Files:** 无新增/修改，纯验证步骤。

- [ ] **Step 1: 全仓 typecheck**

```bash
pnpm --filter @ai-job-print/shared run typecheck
pnpm --filter @ai-job-print/api run typecheck
pnpm --filter terminal-agent run typecheck
pnpm --filter @ai-job-print/kiosk run typecheck
```

Expected: 全部无报错。

- [ ] **Step 2: 全量 lint（改动文件）**

```bash
npx eslint \
  packages/shared/src/types/scanTask.ts \
  services/api/src/scan-tasks/ \
  services/api/src/terminals/terminals.service.ts \
  services/api/scripts/verify-scan-tasks.ts \
  apps/terminal-agent/src/agent/scan-watcher.ts \
  apps/terminal-agent/src/agent/types.ts \
  apps/terminal-agent/src/index.ts \
  apps/kiosk/src/services/api/scanTasks.ts \
  apps/kiosk/src/pages/scan/ \
  apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx
```

Expected: 无报错。

- [ ] **Step 3: 后端 + Agent 验证脚本**

```bash
cd services/api && pnpm run verify:scan-tasks
cd ../../apps/terminal-agent && pnpm run verify:scan-watcher && pnpm run verify:print-scan-agent
```

Expected: 全部 PASS。

- [ ] **Step 4: `git diff --check`（行尾空白检查）**

```bash
git diff --check
```

Expected: 无输出。

- [ ] **Step 5: Kiosk 浏览器走查（mock 模式，无需真实后端/打印机）**

用 preview 工具启动 kiosk（`preview_start` name=`kiosk`），走以下路径并截图确认：

1. 首页 → 打印扫描分组 → 纸质扫描（或 `/print-scan` → 材料扫描卡片，确认 note 已消失）→ `/scan/start`。
2. 选任意扫描类型 → 下一步 → `/scan/settings`：确认展示"正在创建扫描任务…"（mock 模式下 `createScanSession` 会走真实 fetch 到不存在的后端，预期看到诚实的错误提示而不是崩溃，这与本轮"手机扫码上传"验证时的行为一致）。
3. 确认页面没有白屏、没有 React 报错（`preview_console_logs` level=error 应为空）。

- [ ] **Step 6: 提交前自查**

```bash
git status --short
```

确认改动文件列表与本计划"文件清单"一致，没有意外改动其它文件。

---

## 已知遗留（不在本轮解决，写入进度文档）

- 打印机"扫描到 SMB"的物理配置、Windows 真机端到端联调（真实纸质文件走完整链路）、Agent 重启后遗留文件的真机验证——排入 Windows 真机验收清单，需要真实硬件环境。
- Kiosk 无法探测"该终端 Agent 是否真的配置了 scanWatchFolder"，未配置时只能靠 10 分钟超时兜底（设计文档里已记录为已知限制）。
- 若未来出现"多终端共享同一台打印机"的部署形态，当前"匹配最早一条 waiting 任务"的机制需要重新设计（当前单终端单打印机场景下足够）。
