/**
 * 进程内最小 Redis(RESP2)服务端 —— 只为**本机没有 Redis** 的验证场景存在。
 *
 * ## 为什么需要它
 *
 * `verify:content-pipeline-e2e` 要走真实 HTTP,而 `RedisModule` 在 `REDIS_URL`
 * 缺省时**直接抛错**(见 src/common/redis/redis.module.ts),应用根本起不来;
 * 把 `REDIS_URL` 指向一个死端口又会让 webhook 的 nonce 防重放
 * (`RedisService.setNxEx`)在 ~10s 后以 MaxRetriesPerRequestError 失败 ——
 * 于是「webhook 能不能进数据」这一步在本机变成**不可判别**。
 *
 * 差分归因的结构性盲区正是这个:一条门禁若因环境原因恒红,它对改动就失去判别力。
 * 这个桩把「本机无 Redis」从不可判别变成可判别。
 *
 * ## 边界(务必读)
 *
 * - **只实现 RESP2 的一个子集**,够跑 ioredis 握手 + 字符串/集合/TTL 命令。
 * - `EVAL` / `EVALSHA` / `SCRIPT` **一律返回错误**:不实现 Lua。BullMQ 全靠 Lua,
 *   因此队列在这个桩上是失败的 —— 这是**刻意**的,验证脚本据此把「API 拉取」
 *   按 inline 执行路径验证,并在报告里如实标注,而不是假装队列跑通了。
 * - 单进程内存,不持久化,不做集群/复制/发布订阅语义保证。
 * - **禁止用于生产或任何真实数据**,只在 verify 脚本里 new 出来。
 */
import { createServer, type Server, type Socket } from 'node:net'

type StoredValue = { kind: 'string'; value: string } | { kind: 'set'; value: Set<string> }

interface Entry {
  data: StoredValue
  /** epoch ms;null = 永不过期 */
  expiresAt: number | null
}

/** RESP2 编码。null 用 `$-1` / `*-1` 表示。 */
function encode(value: unknown): string {
  if (value === null || value === undefined) return '$-1\r\n'
  if (value === 'OK') return '+OK\r\n'
  if (typeof value === 'number') return `:${value}\r\n`
  if (value instanceof Error) return `-ERR ${value.message}\r\n`
  if (Array.isArray(value)) {
    return `*${value.length}\r\n${value.map(encode).join('')}`
  }
  const s = String(value)
  return `$${Buffer.byteLength(s)}\r\n${s}\r\n`
}

/** 简单状态回复(`+xxx`),与 bulk string 区分开。 */
class Status {
  constructor(readonly text: string) {}
}

function encodeReply(value: unknown): string {
  if (value instanceof Status) return `+${value.text}\r\n`
  return encode(value)
}

/**
 * 增量 RESP 请求解析器。客户端发来的都是 `*N\r\n$len\r\n...` 形式的数组。
 * 返回解析出的完整命令,以及剩余未消费的 buffer。
 */
function parseCommands(buf: Buffer): { commands: string[][]; rest: Buffer } {
  const commands: string[][] = []
  let offset = 0

  for (;;) {
    const start = offset
    if (offset >= buf.length) break
    if (buf[offset] !== 0x2a /* '*' */) {
      // inline command(极少见,ioredis 不用);整行丢弃避免死循环
      const nl = buf.indexOf('\n', offset)
      if (nl === -1) break
      offset = nl + 1
      continue
    }
    const headerEnd = buf.indexOf('\r\n', offset)
    if (headerEnd === -1) break
    const argc = Number(buf.subarray(offset + 1, headerEnd).toString())
    offset = headerEnd + 2
    const args: string[] = []
    let incomplete = false
    for (let i = 0; i < argc; i++) {
      if (offset >= buf.length || buf[offset] !== 0x24 /* '$' */) {
        incomplete = true
        break
      }
      const lenEnd = buf.indexOf('\r\n', offset)
      if (lenEnd === -1) {
        incomplete = true
        break
      }
      const len = Number(buf.subarray(offset + 1, lenEnd).toString())
      const valueStart = lenEnd + 2
      if (buf.length < valueStart + len + 2) {
        incomplete = true
        break
      }
      args.push(buf.subarray(valueStart, valueStart + len).toString())
      offset = valueStart + len + 2
    }
    if (incomplete) {
      offset = start
      break
    }
    commands.push(args)
  }

  return { commands, rest: buf.subarray(offset) }
}

export interface InMemoryRedisServer {
  /** `redis://127.0.0.1:<port>` —— 直接塞进 REDIS_URL */
  url: string
  port: number
  /** 收到过的、本桩不支持的命令(大写)。验证脚本据此如实报告能力边界。 */
  unsupported: Set<string>
  close(): Promise<void>
}

export async function startInMemoryRedis(): Promise<InMemoryRedisServer> {
  const store = new Map<string, Entry>()
  const unsupported = new Set<string>()
  const sockets = new Set<Socket>()

  const now = (): number => Date.now()

  function live(key: string): Entry | null {
    const e = store.get(key)
    if (!e) return null
    if (e.expiresAt !== null && e.expiresAt <= now()) {
      store.delete(key)
      return null
    }
    return e
  }

  function asString(key: string): string | null {
    const e = live(key)
    if (!e || e.data.kind !== 'string') return null
    return e.data.value
  }

  function dispatch(args: string[]): unknown {
    const cmd = (args[0] ?? '').toUpperCase()
    const a = args.slice(1)

    switch (cmd) {
      case 'PING':
        return a.length ? a[0] : new Status('PONG')
      case 'QUIT':
        return new Status('OK')
      case 'INFO':
        // ioredis 的 enableReadyCheck 会解析 `loading:0`。
        return '# Server\r\nredis_version:7.0.0\r\nredis_mode:standalone\r\n# Persistence\r\nloading:0\r\n'
      case 'CLIENT':
      case 'HELLO':
      case 'SELECT':
      case 'CONFIG':
        return new Status('OK')
      case 'COMMAND':
        return []
      case 'SET': {
        const [key, value, ...opts] = a
        if (key === undefined || value === undefined) return new Error('wrong number of arguments')
        let ttlMs: number | null = null
        let nx = false
        let xx = false
        for (let i = 0; i < opts.length; i++) {
          const o = (opts[i] ?? '').toUpperCase()
          if (o === 'EX') ttlMs = Number(opts[++i]) * 1000
          else if (o === 'PX') ttlMs = Number(opts[++i])
          else if (o === 'NX') nx = true
          else if (o === 'XX') xx = true
        }
        const existing = live(key)
        if (nx && existing) return null
        if (xx && !existing) return null
        store.set(key, { data: { kind: 'string', value }, expiresAt: ttlMs === null ? null : now() + ttlMs })
        return 'OK'
      }
      case 'SETEX': {
        const [key, ttl, value] = a
        if (key === undefined || value === undefined) return new Error('wrong number of arguments')
        store.set(key, { data: { kind: 'string', value }, expiresAt: now() + Number(ttl) * 1000 })
        return 'OK'
      }
      case 'GET':
        return asString(a[0] ?? '')
      case 'GETDEL': {
        const key = a[0] ?? ''
        const v = asString(key)
        store.delete(key)
        return v
      }
      case 'DEL': {
        let n = 0
        for (const key of a) {
          if (live(key)) n++
          store.delete(key)
        }
        return n
      }
      case 'EXISTS': {
        let n = 0
        for (const key of a) if (live(key)) n++
        return n
      }
      case 'TTL': {
        const e = live(a[0] ?? '')
        if (!e) return -2
        if (e.expiresAt === null) return -1
        return Math.ceil((e.expiresAt - now()) / 1000)
      }
      case 'EXPIRE': {
        const e = live(a[0] ?? '')
        if (!e) return 0
        e.expiresAt = now() + Number(a[1]) * 1000
        return 1
      }
      case 'INCR': {
        const key = a[0] ?? ''
        const cur = Number(asString(key) ?? '0') + 1
        const prev = store.get(key)
        store.set(key, { data: { kind: 'string', value: String(cur) }, expiresAt: prev?.expiresAt ?? null })
        return cur
      }
      case 'SADD': {
        const key = a[0] ?? ''
        const e = live(key)
        const set = e && e.data.kind === 'set' ? e.data.value : new Set<string>()
        let added = 0
        for (const m of a.slice(1)) if (!set.has(m)) { set.add(m); added++ }
        store.set(key, { data: { kind: 'set', value: set }, expiresAt: e?.expiresAt ?? null })
        return added
      }
      case 'SREM': {
        const e = live(a[0] ?? '')
        if (!e || e.data.kind !== 'set') return 0
        let removed = 0
        for (const m of a.slice(1)) if (e.data.value.delete(m)) removed++
        return removed
      }
      case 'SMEMBERS': {
        const e = live(a[0] ?? '')
        if (!e || e.data.kind !== 'set') return []
        return [...e.data.value]
      }
      case 'SCARD': {
        const e = live(a[0] ?? '')
        return e && e.data.kind === 'set' ? e.data.value.size : 0
      }
      case 'SCAN':
        return ['0', [...store.keys()]]
      case 'SUBSCRIBE':
      case 'PSUBSCRIBE':
        // BullMQ 的事件订阅。回一个合法的 subscribe 确认,不做任何投递。
        return [cmd.toLowerCase(), a[0] ?? '', 1]
      default:
        // EVAL / EVALSHA / SCRIPT / XADD ... 一律显式报错,绝不静默假装成功。
        unsupported.add(cmd)
        return new Error(`unsupported command in in-memory stub: ${cmd}`)
    }
  }

  const server: Server = createServer((socket) => {
    sockets.add(socket)
    let buf = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      const { commands, rest } = parseCommands(buf)
      buf = rest
      let out = ''
      for (const c of commands) out += encodeReply(dispatch(c))
      if (out) socket.write(out)
    })
    socket.on('error', () => { /* 客户端断开,忽略 */ })
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `redis://127.0.0.1:${port}`,
    port,
    unsupported,
    async close() {
      for (const s of sockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
