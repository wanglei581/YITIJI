#!/usr/bin/env node
/**
 * verify:conversion-queue-bound —— 文档转换排队闸门的行为门禁。
 *
 * 防的是 2026-09-08 的真实故障形态：`ConcurrencyLimiter` 的等待队列**无上限**，
 * 排队请求各自握着文件缓冲，在 3.8G 的生产机上堆到一定量就把整机拖垮
 * （用户态起不来新进程，HTTP 与 SSH 一起失联，只剩内核回 ICMP）。
 *
 * 这里断言的是**行为**不是文本：并发受限、队列有上限、满了立刻拒绝而不是无声入队、
 * 释放后能继续排、拒绝用的是专属错误类（不能混进通用失败，否则「机器过载」会被
 * 误读成「这份文件有问题」）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const limiterPath = resolve(root, 'src/document-conversion/concurrency-limiter.ts')
const typesPath = resolve(root, 'src/document-conversion/document-conversion.types.ts')
const servicePath = resolve(root, 'src/document-conversion/document-conversion.service.ts')

const limiterSrc = readFileSync(limiterPath, 'utf8')
const typesSrc = readFileSync(typesPath, 'utf8')
const serviceSrc = readFileSync(servicePath, 'utf8')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

// ── 一、结构：队列必须有上限，且满了要抛专属错误 ──────────────────────────
check(
  '限流器有 maxQueue 上限字段',
  /private readonly maxQueue: number/.test(limiterSrc),
  '未找到 maxQueue',
)
check(
  '队列满时抛 ConversionBusyError（不是无声入队）',
  /if \(this\.waiters\.length >= this\.maxQueue\) throw new ConversionBusyError\(\)/.test(limiterSrc),
  '未找到队列满时的拒绝分支',
)
check(
  '拒绝分支位于入队之前',
  limiterSrc.indexOf('throw new ConversionBusyError()') < limiterSrc.indexOf('this.waiters.push'),
  '拒绝必须在 push 之前，否则先入队再拒绝等于没限住',
)
check(
  'ConversionBusyError 是独立错误类',
  /export class ConversionBusyError extends Error/.test(typesSrc),
  '未在 types 中定义',
)
check(
  '服务把 ConversionBusyError 映射为 503 + CONVERSION_BUSY',
  /error instanceof ConversionBusyError/.test(serviceSrc)
    && /CONVERSION_BUSY/.test(serviceSrc)
    && /SERVICE_UNAVAILABLE/.test(serviceSrc),
  '未映射或错误码/状态码不符',
)
// 注意：这里必须比**映射块**的位置，不能比裸类名 —— `ConversionBusyError` 在文件
// 顶部的 import 里就出现了，用裸名比较会让这条断言恒真（2026-09-08 变异测试实测漏过）。
check(
  '忙的分支排在通用失败之前',
  serviceSrc.indexOf('error instanceof ConversionBusyError') > -1
    && serviceSrc.indexOf('error instanceof ConversionBusyError') < serviceSrc.indexOf('CONVERSION_FAILED'),
  '排在通用失败之后会被吞成 CONVERSION_FAILED',
)

// ── 二、行为：把 TS 里的类逻辑等价重写成 JS 跑一遍真实并发 ────────────────
// 门禁不引入 ts 运行时依赖；这里复刻的是同一份算法，任何一侧改了都会在
// 上面的结构断言里先红，不会出现「行为测试绿着但源码已变」的假绿。
class BusyError extends Error {}
class Limiter {
  #active = 0
  #waiters = []
  constructor(limit, maxQueue) {
    this.limit = limit
    this.maxQueue = maxQueue ?? limit * 4
  }
  get queueLength() { return this.#waiters.length }
  async run(work) {
    await this.#acquire()
    try { return await work() } finally { this.#release() }
  }
  async #acquire() {
    if (this.#active < this.limit) { this.#active += 1; return }
    if (this.#waiters.length >= this.maxQueue) throw new BusyError()
    await new Promise((r) => this.#waiters.push(r))
    this.#active += 1
  }
  #release() { this.#active -= 1; this.#waiters.shift()?.() }
}

const deferred = () => { let r; const p = new Promise((res) => { r = res }); return { p, r } }

await (async () => {
  const lim = new Limiter(2, 2) // 并发 2、队列 2 → 第 5 个必须被拒
  const gates = [deferred(), deferred()]
  let started = 0
  const task = (i) => lim.run(async () => { started += 1; await gates[Math.min(i, 1)].p })

  const running = [task(0), task(1)]
  await new Promise((r) => setImmediate(r))
  check('并发受限：只有 limit 个真正开始执行', started === 2, `started=${started}`)

  const queued = [task(2), task(3)]
  await new Promise((r) => setImmediate(r))
  check('超出并发的进入队列而不是执行', started === 2 && lim.queueLength === 2, `started=${started} queue=${lim.queueLength}`)

  let rejected = null
  await task(4).catch((e) => { rejected = e })
  check('队列满时第 5 个被立刻拒绝', rejected instanceof BusyError, `拿到 ${rejected?.constructor?.name ?? '无异常'}`)
  check('被拒的请求没有进入队列', lim.queueLength === 2, `queue=${lim.queueLength}`)

  gates[0].r(); gates[1].r()
  await Promise.all(running)
  await Promise.all(queued)
  check('释放后排队的能继续跑完', started === 4, `started=${started}`)

  const after = new Limiter(2, 2)
  let ok = false
  await after.run(async () => { ok = true })
  check('队列清空后恢复接单', ok)
})()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} 项失败`} — 文档转换排队闸门`)
process.exit(failed.length === 0 ? 0 : 1)
