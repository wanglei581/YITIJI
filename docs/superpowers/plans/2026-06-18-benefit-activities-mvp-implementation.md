# 权益活动中心 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commercial-ready benefit activity MVP where Admin publishes activities, Kiosk users claim them, and each successful claim creates a `BenefitGrant` visible in `/me/benefits`.

**Architecture:** Add `BenefitActivity` and `BenefitClaim` as the activity template and claim ledger. Keep `BenefitGrant` as the only user-facing entitlement asset, with `sourceRef=BenefitActivity.id`. Implement the backend first with a service-level verify script that proves idempotent claims, stock safety, compliance copy checks, guard metadata, and no regression to existing benefits.

**Tech Stack:** NestJS, Prisma SQLite/PostgreSQL schemas, React + Vite + TypeScript, Tailwind, lucide-react, existing API envelope clients, existing `verify:*` script pattern.

---

## Scope Lock

This plan implements only:

```text
Admin benefit activity config
→ Kiosk activities list/detail
→ logged-in member claim
→ BenefitClaim + BenefitGrant
→ /me/benefits visibility
→ Admin claim records
```

This plan explicitly excludes:

```text
payment, package purchase, paid order, benefit consumption, fair check-in,
fair registration credential, Partner self-service activity config,
automatic qualification review, scheduled publish/end jobs
```

## File Structure

Backend files:

- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260618190000_add_benefit_activities/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260618190000_add_benefit_activities/migration.sql`
- Create: `services/api/src/benefit-activities/benefit-activities.types.ts`
- Create: `services/api/src/benefit-activities/dto/benefit-activities.dto.ts`
- Create: `services/api/src/benefit-activities/benefit-activities.service.ts`
- Create: `services/api/src/benefit-activities/benefit-activities.controller.ts`
- Create: `services/api/src/benefit-activities/admin-benefit-activities.controller.ts`
- Create: `services/api/src/benefit-activities/benefit-activities.module.ts`
- Create: `services/api/src/common/guards/optional-end-user-auth.guard.ts`
- Modify: `services/api/src/app.module.ts`
- Create: `services/api/scripts/verify-benefit-activities.ts`
- Modify: `services/api/package.json`

Shared/frontend type files:

- Modify: `packages/shared/src/index.ts`
- Create: `apps/kiosk/src/services/api/benefitActivities.ts`
- Create: `apps/kiosk/src/pages/activities/BenefitActivitiesPage.tsx`
- Create: `apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Create: `apps/admin/src/services/api/benefitActivitiesAdmin.ts`
- Create: `apps/admin/src/routes/benefit-activities/index.tsx`
- Modify: `apps/admin/src/routes/index.tsx`
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`

Docs:

- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/profile-benefit-activities-p2/task.json`
- Create or update: `.ccg/tasks/profile-benefit-activities-p2/review.md` after dual-model review

## Task 1: Backend Data Model And Migration

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Modify: `services/api/prisma/postgres/schema.prisma`
- Create: `services/api/prisma/migrations/20260618190000_add_benefit_activities/migration.sql`
- Create: `services/api/prisma/postgres/migrations/20260618190000_add_benefit_activities/migration.sql`

- [ ] **Step 1: Add Prisma models to SQLite schema**

Add these models near `BenefitGrant` in `services/api/prisma/schema.prisma`:

```prisma
model BenefitActivity {
  id                String         @id @default(cuid())
  title             String
  description       String?
  rulesText         String?
  benefitType       String
  sourceType        String         @default("platform")
  quantityTotal     Int?
  stockTotal        Int?
  stockRemaining    Int?
  claimLimitPerUser Int            @default(1)
  status            String         @default("draft")
  validFrom         DateTime?
  validUntil        DateTime?
  grantValidDays    Int?
  createdById       String?
  createdBy         User?          @relation(fields: [createdById], references: [id])
  claims            BenefitClaim[]
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  @@index([status])
  @@index([sourceType])
  @@index([validFrom, validUntil])
}

model BenefitClaim {
  id             String          @id @default(cuid())
  activityId     String
  activity       BenefitActivity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  endUserId      String
  endUser        EndUser         @relation(fields: [endUserId], references: [id], onDelete: Cascade)
  benefitGrantId String          @unique
  benefitGrant   BenefitGrant    @relation(fields: [benefitGrantId], references: [id], onDelete: Cascade)
  createdAt      DateTime        @default(now())

  @@unique([activityId, endUserId])
  @@index([endUserId])
  @@index([activityId, createdAt])
}
```

Add relation fields:

```prisma
model User {
  // existing fields
  createdBenefitActivities BenefitActivity[]
}

model EndUser {
  // existing fields
  benefitClaims BenefitClaim[]
}

model BenefitGrant {
  // existing fields
  benefitClaim BenefitClaim?
}
```

- [ ] **Step 2: Mirror the same models in PostgreSQL schema**

Apply the same model changes to `services/api/prisma/postgres/schema.prisma`.

- [ ] **Step 3: Create SQLite migration**

Create `services/api/prisma/migrations/20260618190000_add_benefit_activities/migration.sql`:

```sql
CREATE TABLE "BenefitActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "rulesText" TEXT,
  "benefitType" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'platform',
  "quantityTotal" INTEGER,
  "stockTotal" INTEGER,
  "stockRemaining" INTEGER,
  "claimLimitPerUser" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "validFrom" DATETIME,
  "validUntil" DATETIME,
  "grantValidDays" INTEGER,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BenefitActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BenefitClaim" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activityId" TEXT NOT NULL,
  "endUserId" TEXT NOT NULL,
  "benefitGrantId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BenefitClaim_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "BenefitActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BenefitClaim_endUserId_fkey" FOREIGN KEY ("endUserId") REFERENCES "EndUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BenefitClaim_benefitGrantId_fkey" FOREIGN KEY ("benefitGrantId") REFERENCES "BenefitGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BenefitActivity_status_idx" ON "BenefitActivity"("status");
CREATE INDEX "BenefitActivity_sourceType_idx" ON "BenefitActivity"("sourceType");
CREATE INDEX "BenefitActivity_validFrom_validUntil_idx" ON "BenefitActivity"("validFrom", "validUntil");
CREATE UNIQUE INDEX "BenefitClaim_benefitGrantId_key" ON "BenefitClaim"("benefitGrantId");
CREATE UNIQUE INDEX "BenefitClaim_activityId_endUserId_key" ON "BenefitClaim"("activityId", "endUserId");
CREATE INDEX "BenefitClaim_endUserId_idx" ON "BenefitClaim"("endUserId");
CREATE INDEX "BenefitClaim_activityId_createdAt_idx" ON "BenefitClaim"("activityId", "createdAt");
```

- [ ] **Step 4: Add PostgreSQL timestamp migration**

Add equivalent PostgreSQL DDL into `services/api/prisma/postgres/migrations/20260618190000_add_benefit_activities/migration.sql`, using `TEXT`, `TIMESTAMP(3)`, and existing migration style. Add foreign keys and indexes with the same names. Do not modify the already-applied `0_init` baseline.

- [ ] **Step 5: Generate Prisma client**

Run:

```bash
pnpm --filter ./services/api exec prisma generate
```

Expected: Prisma client generation succeeds.

## Task 2: Backend Types, DTOs, And Service

**Files:**

- Create: `services/api/src/benefit-activities/benefit-activities.types.ts`
- Create: `services/api/src/benefit-activities/dto/benefit-activities.dto.ts`
- Create: `services/api/src/benefit-activities/benefit-activities.service.ts`
- Create: `services/api/src/benefit-activities/benefit-activities.module.ts`
- Create: `services/api/src/common/guards/optional-end-user-auth.guard.ts`
- Modify: `services/api/src/app.module.ts`

- [ ] **Step 1: Add types**

Create `services/api/src/benefit-activities/benefit-activities.types.ts`:

```ts
export const BENEFIT_ACTIVITY_STATUS = ['draft', 'published', 'ended'] as const
export const BENEFIT_ACTIVITY_TYPES = ['coupon', 'free_quota', 'package_entitlement', 'subsidy_eligibility_hint'] as const
export const BENEFIT_ACTIVITY_SOURCE_TYPES = ['platform', 'campus', 'gov', 'fair', 'partner'] as const

export type BenefitActivityStatus = typeof BENEFIT_ACTIVITY_STATUS[number]
export type BenefitActivityType = typeof BENEFIT_ACTIVITY_TYPES[number]
export type BenefitActivitySourceType = typeof BENEFIT_ACTIVITY_SOURCE_TYPES[number]

export interface BenefitActivityListItem {
  id: string
  title: string
  description: string | null
  rulesText: string | null
  benefitType: BenefitActivityType
  sourceType: BenefitActivitySourceType
  quantityTotal: number | null
  stockTotal: number | null
  stockRemaining: number | null
  claimLimitPerUser: number
  status: BenefitActivityStatus
  validFrom: string | null
  validUntil: string | null
  grantValidDays: number | null
  claimable: boolean
  claimed: boolean
  soldOut: boolean
  ended: boolean
  createdAt: string
  updatedAt: string
}

export interface BenefitActivityClaimItem {
  id: string
  activityId: string
  endUserId: string
  phoneMasked: string
  benefitGrantId: string
  grantStatus: string
  createdAt: string
}
```

- [ ] **Step 2: Add DTOs**

Create `services/api/src/benefit-activities/dto/benefit-activities.dto.ts` with:

```ts
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { BENEFIT_ACTIVITY_SOURCE_TYPES, BENEFIT_ACTIVITY_STATUS, BENEFIT_ACTIVITY_TYPES } from '../benefit-activities.types'

export class ListBenefitActivitiesQueryDto {
  @IsOptional()
  @IsIn([...BENEFIT_ACTIVITY_SOURCE_TYPES])
  source?: string
}

export class AdminListBenefitActivitiesQueryDto {
  @IsOptional()
  @IsIn([...BENEFIT_ACTIVITY_STATUS])
  status?: string

  @IsOptional()
  @IsIn([...BENEFIT_ACTIVITY_SOURCE_TYPES])
  source?: string
}

export class UpsertBenefitActivityDto {
  @IsString()
  @MaxLength(80)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rulesText?: string | null

  @IsIn([...BENEFIT_ACTIVITY_TYPES])
  benefitType!: string

  @IsIn([...BENEFIT_ACTIVITY_SOURCE_TYPES])
  sourceType!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  quantityTotal?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999)
  stockTotal?: number | null

  @IsOptional()
  @IsString()
  validFrom?: string | null

  @IsOptional()
  @IsString()
  validUntil?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  grantValidDays?: number | null
}
```

- [ ] **Step 3: Implement service constants**

Create `services/api/src/benefit-activities/benefit-activities.service.ts` and include these constants:

```ts
const FORBIDDEN_COPY = /到账|已发放金额|发放金额|保证|通过率|录用|面试|候选人推荐|平台投递|一键投递|立即投递/
const ACTIVE_GRANT_STATUSES = ['active', 'used_up', 'expired', 'revoked'] as const
```

Implement helper functions:

```ts
function cleanNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_DATE_INVALID', message: '活动时间格式不正确' } })
  }
  return date
}
```

- [ ] **Step 4: Implement validation**

Add `validateActivityInput(dto)`:

```ts
private validateActivityInput(dto: UpsertBenefitActivityDto): void {
  const title = dto.title.trim()
  if (!title) {
    throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_TITLE_REQUIRED', message: '活动标题不能为空' } })
  }
  const text = `${title} ${dto.description ?? ''} ${dto.rulesText ?? ''}`
  if (FORBIDDEN_COPY.test(text)) {
    throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_COPY_FORBIDDEN', message: '活动文案含有不合规承诺，请调整为信息说明' } })
  }
  if (dto.benefitType === 'subsidy_eligibility_hint' && dto.quantityTotal !== null && dto.quantityTotal !== undefined) {
    throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_QUANTITY_FORBIDDEN', message: '政策资格提示不允许设置额度' } })
  }
  const validFrom = parseOptionalDate(dto.validFrom)
  const validUntil = parseOptionalDate(dto.validUntil)
  if (validFrom && validUntil && validFrom.getTime() > validUntil.getTime()) {
    throw new BadRequestException({ error: { code: 'BENEFIT_ACTIVITY_DATE_INVALID', message: '活动开始时间不能晚于结束时间' } })
  }
}
```

- [ ] **Step 5: Implement Admin create/update/publish/end**

Implement these methods:

```ts
async adminList(query: AdminListBenefitActivitiesQueryDto): Promise<{ items: BenefitActivityListItem[] }>
async create(admin: AuthedUser, dto: UpsertBenefitActivityDto): Promise<BenefitActivityListItem>
async update(admin: AuthedUser, id: string, dto: UpsertBenefitActivityDto): Promise<BenefitActivityListItem>
async publish(admin: AuthedUser, id: string): Promise<BenefitActivityListItem>
async end(admin: AuthedUser, id: string): Promise<BenefitActivityListItem>
async listClaims(id: string): Promise<{ items: BenefitActivityClaimItem[] }>
```

Rules:

```text
create status = draft
publish only from draft or ended? No. Publish only draft.
end only published.
update only draft.
stockRemaining = stockTotal when stockTotal is not null.
claimLimitPerUser fixed to 1.
publish re-runs copy/date/subsidy validation.
```

Each Admin write uses `AuditService.write()` with:

```ts
action: 'benefit_activity.create' | 'benefit_activity.update' | 'benefit_activity.publish' | 'benefit_activity.end'
targetType: 'BenefitActivity'
targetId: activity.id
payload: { title: activity.title, benefitType: activity.benefitType, sourceType: activity.sourceType, status: activity.status }
```

- [ ] **Step 6: Implement public list/detail**

Implement:

```ts
async listVisible(query: ListBenefitActivitiesQueryDto, endUserId?: string | null): Promise<{ items: BenefitActivityListItem[] }>
async detail(id: string, endUserId?: string | null): Promise<BenefitActivityListItem>
```

Visible filter:

```ts
where: {
  status: 'published',
  sourceType: query.source ? query.source : undefined,
  AND: [
    { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
    { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
  ],
}
```

- [ ] **Step 7: Implement claim transaction**

Implement:

```ts
async claim(endUserId: string, activityId: string): Promise<MemberBenefitItem>
```

Transaction algorithm:

```ts
return this.prisma.$transaction(async (tx) => {
  const activity = await tx.benefitActivity.findUnique({ where: { id: activityId } })
  if (!activity || activity.status !== 'published') throw notClaimable
  if (activity.validFrom && activity.validFrom.getTime() > Date.now()) throw notClaimable
  if (activity.validUntil && activity.validUntil.getTime() < Date.now()) throw notClaimable

  const grant = await tx.benefitGrant.create({ data: grantDataFromActivity })
  try {
    await tx.benefitClaim.create({ data: { activityId: activity.id, endUserId, benefitGrantId: grant.id } })
  } catch (error) {
    throw alreadyClaimed
  }

  if (activity.stockRemaining !== null) {
    const updated = await tx.benefitActivity.updateMany({
      where: { id: activity.id, stockRemaining: { gt: 0 } },
      data: { stockRemaining: { decrement: 1 } },
    })
    if (updated.count !== 1) throw soldOut
  }
  await this.audit.write(...)
  return toMemberBenefitItem(grant)
})
```

Important implementation detail: the `BenefitGrant`, `BenefitClaim`, and stock decrement must all happen inside the same Prisma transaction. If unique claim creation or stock decrement fails, the whole transaction rolls back, leaving no partial grant.

```text
create placeholder BenefitGrant inside transaction
create BenefitClaim with unique(activityId,endUserId)
decrement stock with stockRemaining > 0
return BenefitGrant
```

Because the transaction rolls back on any error, unique failure or stock failure leaves no partial grant.

- [ ] **Step 8: Add optional member auth guard for public list/detail**

Create `services/api/src/common/guards/optional-end-user-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedEndUser } from '../decorators/current-end-user.decorator'
import { RedisService } from '../redis/redis.service'
import { memberSessionKey } from './end-user-auth.guard'

interface EndUserJwtPayload {
  sub: string
  jti?: string
  aud?: string
}

@Injectable()
export class OptionalEndUserAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { endUser?: AuthedEndUser }>()
    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) return true

    try {
      const token = header.slice(7).trim()
      const payload = this.jwtService.verify<EndUserJwtPayload>(token, { audience: 'enduser' })
      const sessionId = payload.jti
      if (!sessionId) return true
      const ownerId = await this.redis.get(memberSessionKey(sessionId))
      if (ownerId && ownerId === payload.sub) req.endUser = { endUserId: payload.sub, sessionId }
    } catch {
      return true
    }
    return true
  }
}
```

Only use this guard on public read endpoints. Never use it on claim or any write endpoint.

- [ ] **Step 9: Register module**

Create `services/api/src/benefit-activities/benefit-activities.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { BenefitActivitiesController } from './benefit-activities.controller'
import { AdminBenefitActivitiesController } from './admin-benefit-activities.controller'
import { BenefitActivitiesService } from './benefit-activities.service'

@Module({
  controllers: [BenefitActivitiesController, AdminBenefitActivitiesController],
  providers: [BenefitActivitiesService],
})
export class BenefitActivitiesModule {}
```

Add to `services/api/src/app.module.ts`:

```ts
import { BenefitActivitiesModule } from './benefit-activities/benefit-activities.module'
```

and include `BenefitActivitiesModule` near `MemberBenefitsModule`.

## Task 3: Backend Controllers And Verify Script

**Files:**

- Create: `services/api/src/benefit-activities/benefit-activities.controller.ts`
- Create: `services/api/src/benefit-activities/admin-benefit-activities.controller.ts`
- Create: `services/api/scripts/verify-benefit-activities.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: Implement Kiosk controller**

Create `services/api/src/benefit-activities/benefit-activities.controller.ts`:

```ts
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { OptionalEndUserAuthGuard } from '../common/guards/optional-end-user-auth.guard'
import { BenefitActivitiesService } from './benefit-activities.service'
import { ListBenefitActivitiesQueryDto } from './dto/benefit-activities.dto'

type MaybeEndUserRequest = Request & { endUser?: AuthedEndUser }

@Controller('activities')
export class BenefitActivitiesController {
  constructor(private readonly service: BenefitActivitiesService) {}

  @Get()
  @UseGuards(OptionalEndUserAuthGuard)
  async list(@Query() query: ListBenefitActivitiesQueryDto, @Req() req: MaybeEndUserRequest) {
    return ApiResponse.ok(await this.service.listVisible(query, req.endUser?.endUserId ?? null))
  }

  @Get(':id')
  @UseGuards(OptionalEndUserAuthGuard)
  async detail(@Param('id') id: string, @Req() req: MaybeEndUserRequest) {
    return ApiResponse.ok(await this.service.detail(id, req.endUser?.endUserId ?? null))
  }

  @Post(':id/claim')
  @UseGuards(EndUserAuthGuard)
  async claim(@Param('id') id: string, @CurrentEndUser() user: AuthedEndUser) {
    return ApiResponse.ok(await this.service.claim(user.endUserId, id))
  }
}
```

List/detail use optional auth so visitors can browse and logged-in users can see `claimed=true`. Claim uses strict member auth.

- [ ] **Step 2: Implement Admin controller**

Create `services/api/src/benefit-activities/admin-benefit-activities.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { BenefitActivitiesService } from './benefit-activities.service'
import { AdminListBenefitActivitiesQueryDto, UpsertBenefitActivityDto } from './dto/benefit-activities.dto'

@Controller('admin/benefit-activities')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminBenefitActivitiesController {
  constructor(private readonly service: BenefitActivitiesService) {}

  @Get()
  async list(@Query() query: AdminListBenefitActivitiesQueryDto) {
    return ApiResponse.ok(await this.service.adminList(query))
  }

  @Post()
  async create(@Body() dto: UpsertBenefitActivityDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.create(user, dto))
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpsertBenefitActivityDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.update(user, id, dto))
  }

  @Patch(':id/publish')
  async publish(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.publish(user, id))
  }

  @Patch(':id/end')
  async end(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.service.end(user, id))
  }

  @Get(':id/claims')
  async claims(@Param('id') id: string) {
    return ApiResponse.ok(await this.service.listClaims(id))
  }
}
```

- [ ] **Step 3: Write failing verify script**

Create `services/api/scripts/verify-benefit-activities.ts` using the same fallback DB pattern as `verify-feedback-notifications.ts`.

The script must test these cases:

```ts
pass('1. Admin 创建草稿活动')
pass('2. 发布时二次合规校验拒绝违规文案')
pass('3. 发布后 Kiosk 列表可见')
pass('4. 游客可看列表但 claimed=false')
pass('5. 登录会员领取生成 BenefitGrant 且 sourceRef=activityId')
pass('6. /me/benefits 可读取领取到的权益')
pass('7. 同一用户重复领取被拒且只有一条 BenefitClaim/BenefitGrant')
pass('8. 有限库存不会超发')
pass('9. subsidy_eligibility_hint 不允许配置额度')
pass('10. 下架活动不可领取')
pass('11. Admin 领取记录只返回脱敏手机号')
pass('12. create/publish/end/claim 写 AuditLog 且 payload 不含明文手机号')
pass('13. 控制器鉴权元数据正确')
```

Use direct service/controller calls, not HTTP. Instantiate:

```ts
const prisma = new PrismaService()
const audit = new AuditService(prisma)
const activities = new BenefitActivitiesService(prisma, audit)
const benefits = new MemberBenefitsService(prisma)
```

Fallback DB DDL must create:

```sql
"User", "EndUser", "AuditLog", "BenefitGrant", "BenefitActivity", "BenefitClaim"
```

- [ ] **Step 4: Add package script**

Modify `services/api/package.json`:

```json
"verify:benefit-activities": "node -r @swc-node/register scripts/verify-benefit-activities.ts"
```

- [ ] **Step 5: Run verify and typecheck**

Run:

```bash
pnpm --filter ./services/api verify:benefit-activities
pnpm --filter ./services/api typecheck
```

Expected:

```text
ALL PASS
```

and TypeScript exits 0.

## Task 4: Shared Types And Kiosk API Client

**Files:**

- Modify: `packages/shared/src/index.ts`
- Create: `apps/kiosk/src/services/api/benefitActivities.ts`

- [ ] **Step 1: Export shared frontend types**

Add to `packages/shared/src/index.ts`:

```ts
export type BenefitActivityStatus = 'draft' | 'published' | 'ended'
export type BenefitActivityType = 'coupon' | 'free_quota' | 'package_entitlement' | 'subsidy_eligibility_hint'
export type BenefitActivitySourceType = 'platform' | 'campus' | 'gov' | 'fair' | 'partner'

export interface BenefitActivityListItem {
  id: string
  title: string
  description: string | null
  rulesText: string | null
  benefitType: BenefitActivityType
  sourceType: BenefitActivitySourceType
  quantityTotal: number | null
  stockTotal: number | null
  stockRemaining: number | null
  claimLimitPerUser: number
  status: BenefitActivityStatus
  validFrom: string | null
  validUntil: string | null
  grantValidDays: number | null
  claimable: boolean
  claimed: boolean
  soldOut: boolean
  ended: boolean
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Add Kiosk API client**

Create `apps/kiosk/src/services/api/benefitActivities.ts`:

```ts
import type { BenefitActivityListItem, BenefitActivitySourceType, MemberBenefitItem } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

export class BenefitActivitiesApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message)
    this.name = 'BenefitActivitiesApiError'
  }
}

interface Envelope<T> { success: boolean; data: T }

async function request<T>(path: string, token?: string | null, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'include',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText || '请求失败'
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    throw new BenefitActivitiesApiError(code, message, res.status)
  }
  const json = await res.json() as Envelope<T>
  return json.data
}

export function listBenefitActivities(token?: string | null, source?: BenefitActivitySourceType | 'fair'): Promise<{ items: BenefitActivityListItem[] }> {
  if (API_MODE !== 'http') return Promise.resolve({ items: [] })
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  const q = params.toString()
  return request(`/activities${q ? `?${q}` : ''}`, token)
}

export function getBenefitActivity(id: string, token?: string | null): Promise<BenefitActivityListItem> {
  if (API_MODE !== 'http') return Promise.reject(new BenefitActivitiesApiError('MOCK_DISABLED', 'mock 模式暂无权益活动详情', 400))
  return request(`/activities/${encodeURIComponent(id)}`, token)
}

export function claimBenefitActivity(id: string, token: string | null | undefined): Promise<MemberBenefitItem> {
  if (API_MODE !== 'http') return Promise.reject(new BenefitActivitiesApiError('MOCK_DISABLED', 'mock 模式不支持领取权益活动', 400))
  if (!token) return Promise.reject(new BenefitActivitiesApiError('LOGIN_REQUIRED', '请先登录后领取', 401))
  return request(`/activities/${encodeURIComponent(id)}/claim`, token, { method: 'POST' })
}
```

- [ ] **Step 3: Run shared and Kiosk typecheck**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: both pass.

## Task 5: Kiosk Activities Pages And Profile Entry Wiring

**Files:**

- Create: `apps/kiosk/src/pages/activities/BenefitActivitiesPage.tsx`
- Create: `apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/pages/profile/ProfilePage.tsx`

- [ ] **Step 1: Build list page**

Create `apps/kiosk/src/pages/activities/BenefitActivitiesPage.tsx` with:

```tsx
export function BenefitActivitiesPage() {
  // useSearchParams source=fair
  // useAuth getToken/isLoggedIn
  // load listBenefitActivities(getToken(), source)
  // render cards with status button:
  // - not logged in: 登录后领取
  // - claimed: 查看我的权益
  // - soldOut: 已领完
  // - ended: 已结束
  // - claimable: 查看详情
}
```

Visual requirements:

```text
No nested cards.
Use a full-width page band with constrained inner content.
Cards are individual activity items only.
Buttons must not overflow at 21.5-inch portrait width or mobile.
Use lucide icons: GiftIcon, TicketIcon, LandmarkIcon, ChevronRightIcon.
```

Copy requirements:

```text
政策资格提示只提供官方入口与材料指引。
招聘会服务活动只发放本系统服务权益，不代表报名、签到或投递结果。
```

- [ ] **Step 2: Build detail page**

Create `apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx` with:

```tsx
export function BenefitActivityDetailPage() {
  // useParams id
  // load getBenefitActivity(id, getToken())
  // claim button calls claimBenefitActivity(id, getToken())
  // success state shows 查看我的权益 CTA
}
```

Error handling:

```text
LOGIN_REQUIRED: navigate('/login', { state: { from: `/activities/${id}` } })
BENEFIT_ACTIVITY_ALREADY_CLAIMED: show "已领取，可在我的权益查看"
BENEFIT_ACTIVITY_SOLD_OUT: show "活动名额已领完"
BENEFIT_ACTIVITY_NOT_CLAIMABLE: show "活动暂不可领取"
network error: ErrorState retry
```

- [ ] **Step 3: Add routes**

Modify `apps/kiosk/src/routes/index.tsx`:

```ts
import { BenefitActivitiesPage } from '../pages/activities/BenefitActivitiesPage'
import { BenefitActivityDetailPage } from '../pages/activities/BenefitActivityDetailPage'
```

Add children:

```tsx
{ path: 'activities', element: <BenefitActivitiesPage /> },
{ path: 'activities/:id', element: <BenefitActivityDetailPage /> },
```

- [ ] **Step 4: Wire ProfilePage entries**

Modify `apps/kiosk/src/pages/profile/ProfilePage.tsx`:

```ts
{ icon: GiftIcon, iconBg: 'bg-rose-50', iconColor: 'text-rose-600', label: '权益活动', route: '/activities?source=fair' }
```

for the `FAIRS` section, and:

```ts
{ icon: TicketIcon, iconBg: 'bg-rose-50', iconColor: 'text-rose-600', label: '权益活动', route: '/activities' }
```

for the `BENEFITS` section.

Keep these as `建设中`:

```text
招聘会扫码凭证
求职打印套餐
AI服务套餐
```

- [ ] **Step 5: Run Kiosk checks**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk build
```

Expected: pass, except existing Fast Refresh warnings are acceptable only if already present.

## Task 6: Admin API Client And Page

**Files:**

- Create: `apps/admin/src/services/api/benefitActivitiesAdmin.ts`
- Create: `apps/admin/src/routes/benefit-activities/index.tsx`
- Modify: `apps/admin/src/routes/index.tsx`
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`

- [ ] **Step 1: Add Admin API client**

Create `apps/admin/src/services/api/benefitActivitiesAdmin.ts` with request style matching `memberBenefitsAdmin.ts`.

Types:

```ts
export type AdminBenefitActivityStatus = 'draft' | 'published' | 'ended'
export type AdminBenefitActivityType = 'coupon' | 'free_quota' | 'package_entitlement' | 'subsidy_eligibility_hint'
export type AdminBenefitActivitySourceType = 'platform' | 'campus' | 'gov' | 'fair' | 'partner'

export interface AdminBenefitActivityItem {
  id: string
  title: string
  description: string | null
  rulesText: string | null
  benefitType: AdminBenefitActivityType
  sourceType: AdminBenefitActivitySourceType
  quantityTotal: number | null
  stockTotal: number | null
  stockRemaining: number | null
  claimLimitPerUser: number
  status: AdminBenefitActivityStatus
  validFrom: string | null
  validUntil: string | null
  grantValidDays: number | null
  claimable: boolean
  claimed: boolean
  soldOut: boolean
  ended: boolean
  createdAt: string
  updatedAt: string
}

export interface AdminBenefitActivityClaimItem {
  id: string
  activityId: string
  endUserId: string
  phoneMasked: string
  benefitGrantId: string
  grantStatus: string
  createdAt: string
}
```

Methods:

```ts
list(params?: { status?: AdminBenefitActivityStatus; source?: AdminBenefitActivitySourceType }): Promise<{ items: AdminBenefitActivityItem[] }>
create(input: UpsertBenefitActivityInput): Promise<AdminBenefitActivityItem>
update(id: string, input: UpsertBenefitActivityInput): Promise<AdminBenefitActivityItem>
publish(id: string): Promise<AdminBenefitActivityItem>
end(id: string): Promise<AdminBenefitActivityItem>
claims(id: string): Promise<{ items: AdminBenefitActivityClaimItem[] }>
```

- [ ] **Step 2: Build Admin page**

Create `apps/admin/src/routes/benefit-activities/index.tsx`.

Page sections:

```text
top compliance notice
filter row: status/source
left/main list of activities
right drawer/card form for create/edit draft
claim records panel for selected activity
```

Form rules:

```text
subsidy_eligibility_hint disables quantityTotal
published activities cannot edit core fields
publish/end buttons require confirmation
errors from API are shown in amber error box
```

No payment UI, no QR credential UI, no package purchase wording.

- [ ] **Step 3: Add route**

Modify `apps/admin/src/routes/index.tsx`:

```ts
import BenefitActivitiesPage from './benefit-activities'
```

Add route:

```tsx
{ path: 'benefit-activities', element: <BenefitActivitiesPage /> },
```

- [ ] **Step 4: Add nav entry**

Modify `apps/admin/src/layouts/AdminLayoutWrapper.tsx`:

```ts
'/benefit-activities': 'benefit-activities',
```

and nav item:

```ts
{ key: 'benefit-activities', label: '权益活动', icon: GiftIcon, href: KEY_TO_PATH['benefit-activities'] },
```

Place near `会员权益`.

- [ ] **Step 5: Run Admin checks**

Run:

```bash
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin build
```

Expected: pass.

## Task 7: Documentation And CI Script Wiring

**Files:**

- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/profile-benefit-activities-p2/task.json`

- [ ] **Step 1: Update product matrix**

In `docs/product/user-data-flow-matrix.md` §3.9, split the row:

```text
权益活动
求职打印套餐
AI服务套餐
招聘会扫码凭证
```

Mark:

```text
权益活动 = ✅ 已打通
求职打印套餐 / AI服务套餐 / 招聘会扫码凭证 = ❌ 未打通
```

Record the flow:

```text
/activities → claim → BenefitClaim + BenefitGrant → /me/benefits → Admin /benefit-activities claims
```

- [ ] **Step 2: Update progress docs**

In `docs/progress/current-progress.md`, add a dated entry:

```text
2026-06-18: P2 权益活动中心 MVP 完成：Admin 活动配置/发布/下架/领取记录，Kiosk 活动列表/详情/领取，领取后生成 BenefitGrant 并进入 /me/benefits；不含支付、套餐购买、招聘会凭证、核销和 Partner 自助配置。
```

In `docs/progress/next-tasks.md`, move `权益活动` out of construction, keep these as future:

```text
求职打印套餐、AI服务套餐、招聘会扫码凭证、权益核销、支付域
```

- [ ] **Step 3: Update CCG task**

Set `.ccg/tasks/profile-benefit-activities-p2/task.json`:

```json
{
  "currentPhase": "review",
  "nextAction": "运行完整验证并进行双模型审查"
}
```

- [ ] **Step 4: Run doc diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

## Task 8: Final Verification And Dual-Model Review

**Files:**

- Create or update: `.ccg/tasks/profile-benefit-activities-p2/review.md`

- [ ] **Step 1: Run backend verification**

Run:

```bash
pnpm --filter ./services/api verify:benefit-activities
pnpm --filter ./services/api verify:member-benefits-admin
pnpm --filter ./services/api verify:member-favorites-benefits
pnpm --filter ./services/api verify:feedback-notifications
pnpm --filter ./services/api typecheck
pnpm --filter ./services/api lint
pnpm --filter ./services/api build
```

Expected:

```text
ALL PASS
```

for verify scripts, and all build/type/lint commands exit 0.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk build
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin build
```

Expected: all pass.

- [ ] **Step 3: Run real HTTP smoke**

Start API with temp SQLite and frontends in http mode. Exercise:

```text
Admin login
Create benefit activity
Publish activity
Member SMS/login using SMS_PROVIDER=log
Kiosk /activities loads activity
Claim activity
/me/benefits shows generated grant
Admin /benefit-activities shows claim record
```

Expected: visible flow works end-to-end.

- [ ] **Step 4: Dual-model review**

Run both reviewers in parallel:

```bash
~/.claude/bin/codeagent-wrapper --progress --backend antigravity - "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/antigravity/reviewer.md
<TASK>
审查权益活动中心 MVP 变更。重点检查 Kiosk/Admin 前端体验、入口重复、合规文案、空态/错误态、按钮状态、移动/一体机布局。运行 git diff 只读审查，不修改文件。
</TASK>
OUTPUT: Critical/Warning/Info 分级审查报告
EOF
&
~/.claude/bin/codeagent-wrapper --progress --backend claude - "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/claude/reviewer.md
<TASK>
审查权益活动中心 MVP 变更。重点检查 NestJS/Prisma/auth/事务/库存/幂等/合规/审计/越权/生产风险。运行 git diff 只读审查，不修改文件。
</TASK>
OUTPUT: Critical/Warning/Info 分级审查报告
EOF
&
wait
```

Write combined results to `.ccg/tasks/profile-benefit-activities-p2/review.md`.

- [ ] **Step 5: Fix Critical/High findings**

If either review reports Critical or High:

```text
fix issue
rerun targeted verification
rerun dual-model review for changed diff
```

Warnings may be fixed if they affect commercial readiness, clarity, or safety.

- [ ] **Step 6: Final explicit staging and commit**

Run:

```bash
git status --short
git diff --check
```

Stage explicit paths only. Do not use `git add .`.

Commit:

```bash
git commit -m "feat: add benefit activities mvp"
```

## Implementation Order

Recommended execution order:

1. Task 1: schema and migrations.
2. Task 2: service and module.
3. Task 3: controllers and verify script.
4. Task 4: shared types and Kiosk API client.
5. Task 5: Kiosk pages and profile entries.
6. Task 6: Admin page.
7. Task 7: docs.
8. Task 8: verification and dual-model review.

## Self-Review Coverage

This plan covers every requirement from `docs/superpowers/specs/2026-06-18-benefit-activities-mvp-design.md`:

```text
Admin configure/publish/end: Task 2, Task 3, Task 6
Kiosk list/detail/claim: Task 3, Task 4, Task 5
BenefitClaim + BenefitGrant: Task 1, Task 2, Task 3
idempotent single claim: Task 1, Task 2, Task 3, Task 8
stock no oversell: Task 2, Task 3, Task 8
compliance copy checks: Task 2, Task 3, Task 8
subsidy info-only: Task 2, Task 5, Task 6, Task 8
no payment/package/fair credential: Scope Lock, Task 5, Task 6, Task 7
docs update: Task 7
dual-model review: Task 8
```
