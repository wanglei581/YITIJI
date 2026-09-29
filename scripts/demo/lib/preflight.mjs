// 演示包体检：Node 版本、依赖是否装好、Redis 是否可连、端口是否空闲。
// 只用 node 内置模块；不自动安装任何东西，缺什么就用中文说清楚怎么补。

import net from 'node:net'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export class DemoPreflightError extends Error {}

export function checkNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  if (major !== 22 || minor < 13) {
    throw new DemoPreflightError(
      `当前 Node.js 版本是 ${version}，演示包需要 22.13 及以上的 22.x 版本。\n` +
      '  请到 https://nodejs.org 下载 Node.js 22 LTS 安装后重开终端再试。',
    )
  }
}

/** 解析某个应用目录下装好的依赖文件；解析不到说明没跑 pnpm install。 */
export function resolveFrom(packageDir, request) {
  try {
    return createRequire(join(packageDir, 'package.json')).resolve(request)
  } catch {
    return null
  }
}

/**
 * 解析某个依赖包里的具体文件（例如 vite/bin/vite.js）。先解析包自己的 package.json，
 * 再拼路径 —— 很多包的 exports 不暴露 bin 文件，直接 resolve 会失败。
 */
export function resolvePackageFile(packageDir, packageName, file) {
  const manifest = resolveFrom(packageDir, `${packageName}/package.json`)
  if (!manifest) return null
  const target = join(dirname(manifest), file)
  return existsSync(target) ? target : null
}

export function checkDependencies(paths) {
  const required = [
    [paths.apiDir, 'prisma', 'build/index.js', 'services/api 的 prisma'],
    [paths.apiDir, '@swc-node/register', null, 'services/api 的 @swc-node/register'],
    [paths.appDir('kiosk'), 'vite', 'bin/vite.js', 'apps/kiosk 的 vite'],
    [paths.appDir('admin'), 'vite', 'bin/vite.js', 'apps/admin 的 vite'],
    [paths.appDir('partner'), 'vite', 'bin/vite.js', 'apps/partner 的 vite'],
  ]
  const missing = required.filter(([dir, name, file]) => !(file === null ? resolveFrom(dir, name) : resolvePackageFile(dir, name, file))).map(([, , , label]) => label)
  if (!existsSync(join(paths.repoRoot, 'node_modules'))) missing.unshift('仓库根目录 node_modules')
  if (missing.length > 0) {
    throw new DemoPreflightError(
      `依赖还没装好（缺：${missing.join('、')}）。\n  请在仓库根目录先运行：pnpm install`,
    )
  }
}

export function parseRedisUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new DemoPreflightError(`Redis 地址格式不对：${raw}（示例：redis://127.0.0.1:6379/11）`)
  }
  if (url.protocol !== 'redis:') throw new DemoPreflightError(`Redis 地址只支持 redis://，当前：${url.protocol}`)
  const db = url.pathname.replace(/^\//, '')
  return {
    host: url.hostname || '127.0.0.1',
    port: Number(url.port || 6379),
    password: decodeURIComponent(url.password || ''),
    db: db === '' ? 0 : Number(db),
  }
}

const REDIS_HELP =
  '  演示包需要本机 Redis（终端会话、登录验证码都存在里面）。启动方法：\n' +
  '    macOS：  brew install redis && brew services start redis\n' +
  '    Windows：安装 Docker Desktop 后运行  docker run -d --name demo-redis -p 6379:6379 redis:7-alpine\n' +
  '             或安装 Memurai（Windows 版 Redis 兼容服务），装好后会自动在 6379 端口运行\n' +
  '  已有别的 Redis 地址时，可设置 DEMO_REDIS_URL（例如 redis://127.0.0.1:6380/11）再运行。'

/** 用最小 RESP 对话探测 Redis：可选 AUTH → SELECT → PING。 */
export function probeRedis(rawUrl, timeoutMs = 2_000) {
  const target = parseRedisUrl(rawUrl)
  const commands = []
  if (target.password) commands.push(['AUTH', target.password])
  commands.push(['SELECT', String(target.db)], ['PING'])
  const encode = (parts) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`

  return new Promise((resolvePromise, reject) => {
    const socket = net.createConnection({ host: target.host, port: target.port })
    let buffer = ''
    const fail = (reason) => {
      socket.destroy()
      reject(new DemoPreflightError(`连不上 Redis（${target.host}:${target.port}）：${reason}\n${REDIS_HELP}`))
    }
    socket.setTimeout(timeoutMs, () => fail('连接超时'))
    socket.once('error', (error) => fail(error.code === 'ECONNREFUSED' ? '端口上没有 Redis 在运行' : error.message))
    socket.once('connect', () => socket.write(commands.map(encode).join('')))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\r\n').filter(Boolean)
      const error = lines.find((line) => line.startsWith('-'))
      if (error) {
        fail(error.includes('NOAUTH') ? '需要密码，请在 DEMO_REDIS_URL 里带上 redis://:密码@主机:端口/库号' : error.slice(1))
        return
      }
      if (lines.length >= commands.length && lines.includes('+PONG')) {
        socket.end()
        resolvePromise(target)
      }
    })
  })
}

function tryListen(port, host) {
  return new Promise((resolvePromise) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolvePromise(false))
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolvePromise(true)))
  })
}

/** 端口在 127.0.0.1 与全部网卡上都能监听才算空闲（服务端监听的是全部网卡）。 */
export async function isPortFree(port) {
  return (await tryListen(port, '127.0.0.1')) && (await tryListen(port, '0.0.0.0'))
}

/**
 * 为每个服务找一个空闲端口：先试默认端口，被占就往后顺延（跳过 41xx），
 * 返回实际端口与被换掉的记录，供启动时如实告诉用户。
 */
export async function allocatePorts(preferred, { isFree = isPortFree, maxShift = 20 } = {}) {
  const taken = new Set()
  const result = {}
  const moved = []
  for (const [name, start] of Object.entries(preferred)) {
    let chosen = null
    for (let offset = 0; offset <= maxShift; offset += 1) {
      const port = start + offset * 10
      if (port >= 4100 && port <= 4199) continue
      if (taken.has(port)) continue
      if (await isFree(port)) {
        chosen = port
        break
      }
    }
    if (chosen === null) {
      throw new DemoPreflightError(`找不到可用端口给 ${name}（从 ${start} 起试了 ${maxShift + 1} 个）。请关掉占用这些端口的程序再试。`)
    }
    if (chosen !== start) moved.push(`${name}：${start} 被占用，改用 ${chosen}`)
    taken.add(chosen)
    result[name] = chosen
  }
  return { ports: result, moved }
}
