/**
 * 机构类型枚举多处同步门禁（2026-09-29：新增「零工之家」「就业服务站」）。
 *
 * 机构类型在代码里有五处，漏一处的后果各不相同，都不会在类型检查里暴露：
 *   1. CreateOrgDto / UpdateOrgDto 的 PARTNER_TYPES（入参白名单）—— 漏了：后台建机构直接 400；
 *   2. admin-orgs.service.ts 的 ORG_TYPE_MATRIX（场景模板与模块上限）—— 漏了：ORG_TYPE_MATRIX_VIOLATION；
 *   3. partner-capabilities.ts 的能力矩阵 —— 漏了：该机构登录机构后台后数据接入、政策页 403；
 *   4. shared ORG_TYPE_SCENE_TEMPLATE —— 漏了：管理员后台选了类型带不出场景，保存被服务端拒；
 *   5. shared PARTNER_TYPE_LABELS —— 漏了：管理员后台下拉里根本选不到。
 * Organization.type 在库里是字符串，不是库枚举，所以两套 schema 与迁移都不涉及。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { CreateOrgDto, PARTNER_TYPES, UpdateOrgDto } from '../src/orgs/dto/admin-org.dto'
import { ORG_TYPE_MATRIX } from '../src/orgs/admin-orgs.service'
import { getPartnerCapabilities } from '../src/jobs/partner-capabilities'
import { ORG_TYPE_SCENE_TEMPLATE, PARTNER_TYPE_LABELS } from '../../../packages/shared/src/types/partner'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function typeErrors(dto: object): string[] {
  return validateSync(dto).filter((error) => error.property === 'type').map((error) => error.property)
}

console.log('\n=== organization type enum sync ===')

const NEW_TYPES = { gig_worker_home: '零工之家', employment_service_station: '就业服务站' } as const
const serverTypes = [...PARTNER_TYPES].sort()

for (const [type, label] of Object.entries(NEW_TYPES)) {
  assert.ok((PARTNER_TYPES as readonly string[]).includes(type), `PARTNER_TYPES includes ${type}`)
  assert.equal((PARTNER_TYPE_LABELS as Record<string, string>)[type], label, `shared label for ${type} is ${label}`)
}
pass('新增机构类型：零工之家（gig_worker_home）、就业服务站（employment_service_station）')

assert.deepEqual(Object.keys(ORG_TYPE_MATRIX).sort(), serverTypes, 'ORG_TYPE_MATRIX covers exactly PARTNER_TYPES')
assert.deepEqual(Object.keys(PARTNER_TYPE_LABELS).sort(), serverTypes, 'shared PARTNER_TYPE_LABELS covers exactly PARTNER_TYPES')
assert.deepEqual(Object.keys(ORG_TYPE_SCENE_TEMPLATE).sort(), serverTypes, 'shared ORG_TYPE_SCENE_TEMPLATE covers exactly PARTNER_TYPES')
pass('DTO 白名单、服务端场景矩阵、shared 标签与场景投影四处的类型集合完全一致')

for (const type of PARTNER_TYPES) {
  const rule = ORG_TYPE_MATRIX[type]!
  assert.equal(
    (ORG_TYPE_SCENE_TEMPLATE as Record<string, string | null>)[type],
    rule.sceneTemplate,
    `${type}: shared scene projection must equal the server ORG_TYPE_MATRIX scene`,
  )
  assert.doesNotThrow(() => getPartnerCapabilities(type), `${type}: partner capability matrix has a rule`)
  assert.deepEqual(typeErrors(plainToInstance(CreateOrgDto, { name: 'x', type })), [], `${type}: CreateOrgDto accepts it`)
  assert.deepEqual(typeErrors(plainToInstance(UpdateOrgDto, { type })), [], `${type}: UpdateOrgDto accepts it`)
}
assert.deepEqual(typeErrors(plainToInstance(CreateOrgDto, { name: 'x', type: 'gig_worker' })), ['type'], 'CreateOrgDto still rejects unknown types')
pass('每个类型：场景投影与服务端一致、有数据接入能力规则、建/改机构 DTO 都收')

// 零工之家、就业服务站属公共就业服务体系：场景、模块上限、数据接入与政策权限都与公共就业服务机构相同。
const reference = ORG_TYPE_MATRIX['public_employment_service']!
const referenceCaps = getPartnerCapabilities('public_employment_service')
for (const type of Object.keys(NEW_TYPES)) {
  assert.equal(ORG_TYPE_MATRIX[type]!.sceneTemplate, 'public_employment', `${type}: scene is public_employment`)
  assert.deepEqual([...ORG_TYPE_MATRIX[type]!.allowedModules].sort(), [...reference.allowedModules].sort(), `${type}: module ceiling equals public_employment_service`)
  assert.ok(!ORG_TYPE_MATRIX[type]!.allowedModules.has('smart_campus'), `${type}: smart_campus stays school-only`)
  assert.deepEqual(
    { ...getPartnerCapabilities(type), orgType: 'public_employment_service' },
    referenceCaps,
    `${type}: partner capabilities equal public_employment_service`,
  )
}
pass('零工之家、就业服务站：人社版场景，模块上限与数据接入/政策权限同公共就业服务机构，不含智慧校园')

console.log('\nALL PASS')
