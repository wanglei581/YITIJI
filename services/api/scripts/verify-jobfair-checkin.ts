/**
 * 招聘会来源签到入口防回退验证。
 *
 * 只允许“打开第三方/官方来源签到入口”：
 * - JobFair 持久化真实 checkinUrl，不生成本平台签到码。
 * - Partner 导入/编辑可提交 checkinUrl，编辑后必须重新审核发布。
 * - Admin 审核详情可看见 checkinUrl。
 * - Activity 只记录 external_checkin_open 这个打开动作，snapshot sourceUrl 使用 checkinUrl。
 * - 禁止出现签到结果、入场状态、报名闭环字段。
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const REPO_ROOT = join(ROOT, '..', '..')

let failed = 0
function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string) { failed += 1; console.error(`  FAIL ${message}`) }

function read(absOrRel: string): string {
  const path = absOrRel.startsWith('/') ? absOrRel : join(ROOT, absOrRel)
  if (!existsSync(path)) {
    fail(`文件缺失: ${absOrRel}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

function mustContain(rel: string, markers: string[], label: string) {
  const src = read(rel)
  const missing = markers.filter((marker) => !src.includes(marker))
  if (missing.length > 0) fail(`${label}: 缺少 ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(rel: string, patterns: RegExp[], label: string) {
  const src = read(rel)
  const hits = patterns.filter((pattern) => pattern.test(src)).map(String)
  if (hits.length > 0) fail(`${label}: 命中 ${hits.join(' | ')}`)
  else pass(label)
}

console.log('\n=== 招聘会来源签到入口防回退验证 ===')

for (const rel of ['prisma/schema.prisma', 'prisma/postgres/schema.prisma']) {
  mustContain(rel, ['model JobFair', 'checkinUrl  String?'], `${rel} 持久化可选 checkinUrl`)
}

mustContain(
  'src/jobs/dto/import-fairs.dto.ts',
  ['checkinUrl?: string', '@IsOptional() @IsString() @MaxLength(500)'],
  '导入 DTO 允许可选 checkinUrl 且只收字符串 URL',
)

mustContain(
  'src/jobs/dto/partner-edit.dto.ts',
  ['checkinUrl?: string', '@IsOptional() @IsString() @MaxLength(500)'],
  'Partner 编辑 DTO 允许可选 checkinUrl',
)

mustContain(
  'src/jobs/jobs.service.ts',
  [
    'checkinUrl: string | null',
    'checkinUrl: f.checkinUrl ?? undefined',
    'normalizeOptionalHttpUrl',
    'checkinUrl: normalizeOptionalHttpUrl',
    'reviewStatus: \'pending\'',
    'publishStatus: \'draft\'',
  ],
  'JobsService 映射、写入 checkinUrl，并复用重新审核状态机',
)

mustContain(
  'src/activity/activity.types.ts',
  [
    'external_checkin_open',
    'JUMP_ACTIONS_BY_TARGET',
    "job_fair: ['external_appointment', 'external_checkin_open']",
  ],
  'Activity 类型允许招聘会预约与来源签到两种打开动作',
)

mustContain(
  'src/activity/activity.service.ts',
  [
    'JUMP_ACTIONS_BY_TARGET[targetType].includes',
    'loadPublishedTarget(targetType, targetId, action)',
    'checkinUrl',
    "action === 'external_checkin_open'",
  ],
  'ActivityService 校验 external_checkin_open 并用 checkinUrl 做快照来源',
)

mustContain(
  join(REPO_ROOT, 'packages/shared/src/types/job.ts'),
  ['checkinUrl?: string', '扫码前往来源平台签到'],
  'shared 招聘会类型暴露可选 checkinUrl，语义限定为来源平台',
)

mustContain(
  join(REPO_ROOT, 'packages/shared/src/types/memberAssets.ts'),
  ['external_checkin_open'],
  'shared 会员行为记录动作包含 external_checkin_open',
)

mustContain(
  join(REPO_ROOT, 'apps/admin/src/services/api/types.ts'),
  ['checkinUrl?: string'],
  'Admin 招聘会来源类型包含 checkinUrl',
)

mustContain(
  join(REPO_ROOT, 'apps/partner/src/services/api/types.ts'),
  ['checkinUrl?: string'],
  'Partner 招聘会来源类型和编辑 payload 包含 checkinUrl',
)

mustContain(
  join(REPO_ROOT, 'apps/admin/src/routes/fair-sources/index.tsx'),
  ['来源签到链接', 'checkinUrl'],
  'Admin 来源审核详情展示 checkinUrl',
)

mustContain(
  join(REPO_ROOT, 'apps/partner/src/routes/fairs/index.tsx'),
  ['来源平台签到链接', 'checkinUrl'],
  'Partner 招聘会编辑表单可维护 checkinUrl',
)

const bannedStatusPatterns = [
  /\bcheckin(Status|Result|Code|Token|Users?)\b/,
  /签到成功|确认签到|平台内签到|入场成功|报名成功|报名状态|入场状态/,
]
for (const rel of [
  'src/jobs/jobs.service.ts',
  'src/activity/activity.service.ts',
  'src/activity/activity.types.ts',
]) {
  mustNotContain(rel, bannedStatusPatterns, `后端不建模签到结果 ${rel}`)
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) ===`)
  process.exit(1)
}

console.log('\n=== ALL PASS ===')
