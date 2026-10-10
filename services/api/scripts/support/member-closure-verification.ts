import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { AppPrismaClient } from '../../src/prisma/create-client'

/** 离线 Redis 协议替身；真 Redis 模式使用正式 RedisService 的 Lua，不能据此声称 Lua 已验。 */
export class ClosureMemoryRedis {
  readonly values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: string, ...options: unknown[]) {
    if (options.includes('NX') && this.values.has(key)) return null
    this.values.set(key, value); return 'OK'
  }
  async setEx(key: string, _ttl: number, value: string) { await this.set(key, value) }
  async setNxEx(key: string, value: string, ttl: number) { return await this.set(key, value, 'EX', ttl, 'NX') === 'OK' }
  async del(...keys: string[]) { return keys.reduce((n, key) => n + Number(this.values.delete(key)), 0) }
  async type(key: string) { return this.values.has(key) ? 'string' : 'none' }
  async scan(_cursor: string, _match: string, pattern: string) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return ['0', [...this.values.keys()].filter((key) => new RegExp(`^${escaped}$`).test(key))] as [string, string[]]
  }
  async zrem(_key: string, _member: string) { return 0 }
  async eval(_script: string, _number: number, key: string, owner: string) { return await this.get(key) === owner ? 1 : 0 }
  async getAndDelIfEquals(key: string, value: string) {
    const current = await this.get(key)
    if (!current) return 'missing' as const
    if (current !== value) return 'mismatched' as const
    await this.del(key); return 'matched' as const
  }
  async incrWithTtl(key: string, _ttl: number) { const value = Number(await this.get(key) ?? '0') + 1; await this.set(key, String(value)); return value }
  async registerMemberSession(id: string, sid: string, _ttl: number) { await this.set(`member:session:${sid}`, id) }
  async unregisterMemberSession(_id: string, sid: string) { await this.del(`member:session:${sid}`) }
  async revokeMemberSessions(id: string) {
    let n = 0
    for (const [key, value] of this.values) if (key.startsWith('member:session:') && value === id) n += await this.del(key)
    return n
  }
  async registerMemberStepUpGrant(id: string, hash: string, _ttl: number, raw: string) {
    assert.equal(JSON.parse(raw).endUserId, id); await this.set(`member:step-up:grant:${hash}`, raw)
  }
  async getDelMemberStepUpGrant(id: string, hash: string) {
    const key = `member:step-up:grant:${hash}`; const raw = await this.get(key)
    if (!raw || JSON.parse(raw).endUserId !== id) return null
    await this.del(key); return raw
  }
  async revokeMemberStepUpGrants(id: string) {
    let n = 0
    for (const [key, value] of this.values) if (key.startsWith('member:step-up:grant:') && JSON.parse(value).endUserId === id) n += await this.del(key)
    return n
  }
  async revokeCapabilitiesByUser(digest: string) {
    let n = 0
    for (const [key, value] of this.values) if (key.startsWith('member:export:') && value.includes(digest)) n += await this.del(key)
    return n
  }
}

/** 不变审计的精确字段豁免。新注销审计无任何豁免，不能全表或全 action 放过。 */
export const CLOSURE_AUDIT_PII_EXEMPTIONS: Record<string, readonly string[]> = {
  'member.phone.rebind': ['oldPhoneMasked', 'newPhoneMasked'],
  'member_benefit.search': ['phoneMasked'],
  'member_benefit.grant': ['phoneMasked'],
  'member_benefit.revoke': ['phoneMasked'],
  'feedback.view': ['phoneMasked'],
  'feedback.reply': ['phoneMasked'],
  'feedback.status_change': ['phoneMasked'],
}

export interface ClosureScanIdentity { phone: string; phoneHash: string; phoneEnc: string; wxOpenId: string; nickname: string }

type ClosureStringVisitor = (value: string, location: string, path: string, model: string, field: string, row: Record<string, unknown>) => void

/** 遍历 Prisma 全模型的全部字符串/JSON列（JSON 的键与值都算），不按已知保留表列白名单。返回列数。 */
async function visitClosureStrings(client: AppPrismaClient, onString: ClosureStringVisitor, onRow?: (model: string, row: Record<string, unknown>) => void) {
  let columns = 0
  const metadata = (client as unknown as { _runtimeDataModel: { models: Record<string, { fields: Array<{ name: string; kind: string; type: string }> }> } })._runtimeDataModel
  assert.ok(metadata?.models, 'Prisma 全模型元数据必须可用，禁止退化为已知表白名单')
  for (const [name, metadataModel] of Object.entries(metadata.models)) {
    const model = { name, ...metadataModel }
    const fields = model.fields.filter((field) => field.kind !== 'object' && ['String', 'Json'].includes(field.type))
    if (!fields.length) continue
    columns += fields.length
    const delegate = (client as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, unknown>[]> }>)[model.name[0]!.toLowerCase() + model.name.slice(1)]!
    const rows = await delegate.findMany({ select: Object.fromEntries(fields.map((field) => [field.name, true])) })
    for (const row of rows) {
      onRow?.(model.name, row)
      for (const field of fields) {
        let value = row[field.name]
        if (value === null || value === undefined) continue
        if (typeof value === 'string' && field.name.endsWith('Json')) {
          try { value = JSON.parse(value) } catch { /* 不是有效 JSON 的字符串仍要扫描 */ }
        }
        const visit = (child: unknown, path: string): void => {
          if (child && typeof child === 'object') {
            for (const [key, item] of Object.entries(child)) { visit(key, `${path}.<key>`); visit(item, path ? `${path}.${key}` : key) }
            return
          }
          if (typeof child !== 'string') return
          onString(child, `${model.name}.${field.name}${path ? `.${path}` : ''}`, path, model.name, field.name, row)
        }
        visit(value, '')
      }
    }
  }
  return columns
}

/** 来自 Prisma 全模型的全部字符串/JSON列，不按已知保留表列白名单扫描。 */
export async function scanClosureDatabase(client: AppPrismaClient, identity: ClosureScanIdentity, pair?: [string, string]) {
  const tokens = [identity.phone, identity.phoneHash, identity.phoneEnc, identity.wxOpenId, identity.nickname]
  const tail = new RegExp(`(?<![A-Za-z0-9])${identity.phone.slice(-4)}(?![A-Za-z0-9])`)
  const hits: string[] = []; const exempted: string[] = []; const links: string[] = []
  const columns = await visitClosureStrings(client, (child, location, path, model, field, row) => {
    if (!(tokens.some((token) => child.includes(token)) || tail.test(child))) return
    if (model === 'AuditLog' && field === 'payloadJson'
      && (CLOSURE_AUDIT_PII_EXEMPTIONS[String(row['action'])] ?? []).includes(path)
      && child === `${identity.phone.slice(0, 3)}****${identity.phone.slice(-4)}`) {
      exempted.push(`${location}: 历史审计不改写，待合规裁定`)
    } else hits.push(location)
  }, (model, row) => {
    if (pair && pair.every((id) => JSON.stringify(row).includes(id))) links.push(`${model}:${row['id'] ?? ''}`)
  })
  return { hits, exempted, links, columns }
}

/**
 * 库里已经出现过的「前后不挨字母数字的 4 位数」。上面的后四位反查按这个边界匹配，
 * 共享库里别的门禁和种子早就留下这类串（如种子岗位 job-uni-0041 / UNI-2026-JOB-0041），
 * 测试手机号的后四位若恰好撞上就会误报。造会员前先收集一次、选号时避开，
 * 扫描本身一列一行都不放过。
 */
export async function collectBoundedFourDigitTokens(client: AppPrismaClient) {
  const taken = new Set<string>()
  await visitClosureStrings(client, (child) => {
    for (const match of child.matchAll(/(?<![A-Za-z0-9])(\d{4})(?![A-Za-z0-9])/g)) taken.add(match[1]!)
  })
  return taken
}

export async function scanClosureRedis(client: { scan(...args: unknown[]): Promise<[string, string[]]>; type(key: string): Promise<string>; get(key: string): Promise<string | null> }, identity: ClosureScanIdentity, oldId: string) {
  const hits: string[] = []; let cursor = '0'
  const tokens = [identity.phone, identity.phoneHash, identity.phoneEnc, identity.wxOpenId, identity.nickname, oldId,
    createHash('sha256').update(oldId).digest('hex')]
  do {
    const page = await client.scan(cursor, 'MATCH', '*', 'COUNT', 200); cursor = page[0]
    for (const key of page[1]) {
      if (key.startsWith('member:closure:lock:')) continue // 执行中租约不含原身份，finally 会删。
      const value = await client.type(key) === 'string' ? await client.get(key) : null
      if (tokens.some((token) => key.includes(token) || value?.includes(token))) hits.push(key)
    }
  } while (cursor !== '0')
  return hits
}
