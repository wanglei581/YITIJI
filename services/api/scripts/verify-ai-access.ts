import 'reflect-metadata'
import { Reflector } from '@nestjs/core'
import { AiAccessGuard } from '../src/ai-access/ai-access.guard'
import { AiAccessService } from '../src/ai-access/ai-access.service'
import { AiUse, MaintenanceBlocked, AI_USE_METADATA, MAINTENANCE_BLOCKED_METADATA } from '../src/ai-access/ai-access.decorator'
async function main() {
const checks: Array<[string, boolean]> = []
const assert = (name: string, value: boolean) => checks.push([name, value])
const reflector = new Reflector()
const config = { loginGate: 'off' as const, declarationEnforced: false, paused: false, maintenance: false }
const service = new AiAccessService({ get: async () => null } as never, {} as never, {} as never, { userAiConsent: { findFirst: async () => null } } as never)
let reads = 0
;(service as any).getConfig = async () => { reads++; return config }
const guard = new AiAccessGuard(reflector, service)
const ctx = (handler: Function, req: any) => ({ getHandler: () => handler, getClass: () => class X {}, switchToHttp: () => ({ getRequest: () => req }) }) as any
const plain = () => true
await guard.canActivate(ctx(plain, { headers: {} }))
assert('无标记路由零配置读取', reads === 0)
const gen = AiUse('generate')(plain) || plain
await guard.canActivate(ctx(gen, { headers: {} }))
assert('有标记路由读取配置', reads === 1)
const blocked = MaintenanceBlocked()(plain) || plain
;(service as any).getConfig = async () => ({ ...config, maintenance: true })
let maintenance = false
try { await guard.canActivate(ctx(blocked, { headers: {} })) } catch (e: any) { maintenance = e?.getResponse?.()?.error?.code === 'MAINTENANCE_MODE' }
assert('维护模式拦截维护标记', maintenance)
assert('装饰器元数据可读', reflector.get(AI_USE_METADATA, gen) === 'generate' && reflector.get(MAINTENANCE_BLOCKED_METADATA, blocked) === true)
;(service as any).getConfig = async () => ({ ...config, paused: true })
let paused = false
try { await guard.canActivate(ctx(gen, { headers: {} })) } catch (e: any) { paused = e?.getResponse?.()?.error?.code === 'AI_PAUSED' }
assert('AI 暂停拦截生成', paused)
;(service as any).getConfig = async () => ({ ...config, maintenance: true })
let readAllowed = true
const readable = () => true
AiUse('read')(readable)
try { await guard.canActivate(ctx(readable, { headers: {} })) } catch { readAllowed = false }
assert('维护模式放行 AI read', readAllowed)
for (const [name, ok] of checks) { if (!ok) throw new Error(`FAIL ${name}`); console.log(`PASS ${name}`) }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
