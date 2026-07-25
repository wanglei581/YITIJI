/**
 * TRUST_PROXY_HOPS 解析 + Express 跳数行为 + 控制器禁止手解析 XFF。
 */
import express from 'express'
import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  assertProductionTrustProxyHops,
  resolveTrustProxyHops,
} from '../src/config/trust-proxy'
import { resolveClientIp, resolveClientIpOrUnknown } from '../src/common/client-ip'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

function expectThrow(fn: () => unknown, code: string, label: string): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(code)) {
      throw new Error(`${label}: expected ${code}, got ${message}`)
    }
    pass(label)
    return
  }
  throw new Error(`${label}: expected throw ${code}`)
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      collectTsFiles(full, out)
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

async function assertExpressHopBehavior(): Promise<void> {
  const app = express()
  app.set('trust proxy', 1)
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip })
  })

  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    server.close()
    throw new Error('failed to bind test server')
  }

  try {
    const spoofed = await fetch(`http://127.0.0.1:${addr.port}/ip`, {
      headers: { 'X-Forwarded-For': '203.0.113.9' },
    }).then((r) => r.json() as Promise<{ ip: string }>)
    if (spoofed.ip !== '203.0.113.9') {
      throw new Error(`trust proxy=1 should honor single XFF hop, got ${spoofed.ip}`)
    }
    pass('Express trust proxy=1 识别单层 X-Forwarded-For')

    const app2 = express()
    // trust proxy 关闭：req.ip 应为直连地址，不应采信客户端伪造 XFF
    app2.get('/ip', (req, res) => {
      res.json({ ip: req.ip })
    })
    const server2 = createServer(app2)
    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve))
    const addr2 = server2.address()
    if (!addr2 || typeof addr2 === 'string') {
      server2.close()
      throw new Error('failed to bind test server2')
    }
    try {
      const direct = await fetch(`http://127.0.0.1:${addr2.port}/ip`, {
        headers: { 'X-Forwarded-For': '203.0.113.9' },
      }).then((r) => r.json() as Promise<{ ip: string }>)
      if (direct.ip === '203.0.113.9') {
        throw new Error('without trust proxy, forged XFF must not become req.ip')
      }
      pass('未配置 trust proxy 时拒绝采信伪造 X-Forwarded-For')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server2.close((err) => (err ? reject(err) : resolve())),
      )
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
}

function assertNoManualXffParsing(): void {
  const srcRoot = join(__dirname, '../src')
  const allowCommentFiles = new Set([
    relative(srcRoot, join(srcRoot, 'config/trust-proxy.ts')),
    relative(srcRoot, join(srcRoot, 'common/client-ip.ts')),
    relative(srcRoot, join(srcRoot, 'main.ts')),
    relative(srcRoot, join(srcRoot, 'member-auth/member-auth.controller.ts')),
  ])
  const offenders: string[] = []
  for (const file of collectTsFiles(srcRoot)) {
    const rel = relative(srcRoot, file)
    const text = readFileSync(file, 'utf8')
    // 禁止运行时读取 headers['x-forwarded-for'] / headers["x-forwarded-for"]
    if (/headers(?:\?\.|\.)?\s*\[\s*['"]x-forwarded-for['"]\s*\]/i.test(text)) {
      offenders.push(rel)
      continue
    }
    if (/headerOf\([^,]+,\s*['"]x-forwarded-for['"]\)/i.test(text)) {
      offenders.push(rel)
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `controllers must not parse X-Forwarded-For manually: ${offenders.join(', ')}`,
    )
  }
  // allowlisted files may mention the header in comments only
  for (const rel of allowCommentFiles) {
    const text = readFileSync(join(srcRoot, rel), 'utf8')
    if (/headers(?:\?\.|\.)?\s*\[\s*['"]x-forwarded-for['"]\s*\]/i.test(text)) {
      throw new Error(`${rel} still reads x-forwarded-for at runtime`)
    }
  }
  pass('源码无手解析 x-forwarded-for（仅注释允许提及）')
}

async function main(): Promise<void> {
  console.log('\n=== verify:trust-proxy ===\n')

  if (resolveTrustProxyHops({ NODE_ENV: 'development' }) !== false) {
    throw new Error('dev unset should disable trust proxy')
  }
  pass('非生产未设置 → false')

  if (resolveTrustProxyHops({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '1' }) !== 1) {
    throw new Error('expected hops=1')
  }
  pass('开发环境可显式设置 hops=1')

  if (resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' }) !== 2) {
    throw new Error('expected hops=2')
  }
  pass('生产 hops=2 合法')

  expectThrow(
    () => resolveTrustProxyHops({ NODE_ENV: 'production' }),
    'PRODUCTION_TRUST_PROXY_HOPS_UNDECLARED',
    '生产未声明 hops 拒启动',
  )
  expectThrow(
    () => resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 'true' }),
    'TRUST_PROXY_HOPS_BOOLEAN_FORBIDDEN',
    '禁止 TRUST_PROXY_HOPS=true',
  )
  expectThrow(
    () => resolveTrustProxyHops({ NODE_ENV: 'development', TRUST_PROXY_HOPS: 'false' }),
    'TRUST_PROXY_HOPS_BOOLEAN_FORBIDDEN',
    '禁止 TRUST_PROXY_HOPS=false',
  )
  expectThrow(
    () => resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' }),
    'TRUST_PROXY_HOPS_INVALID',
    '禁止 hops=0',
  )
  expectThrow(
    () => resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '10' }),
    'TRUST_PROXY_HOPS_INVALID',
    '禁止 hops=10',
  )

  assertProductionTrustProxyHops({ NODE_ENV: 'development' })
  pass('非生产 assert 放行')
  expectThrow(
    () => assertProductionTrustProxyHops({ NODE_ENV: 'production' }),
    'PRODUCTION_TRUST_PROXY_HOPS_UNDECLARED',
    '生产 assert 强制声明',
  )

  if (resolveClientIp({ ip: ' 10.0.0.8 ' }) !== '10.0.0.8') {
    throw new Error('resolveClientIp should prefer req.ip')
  }
  if (
    resolveClientIp({
      ip: undefined,
      socket: { remoteAddress: '127.0.0.1' },
    }) !== '127.0.0.1'
  ) {
    throw new Error('resolveClientIp should fall back to socket')
  }
  if (resolveClientIpOrUnknown({}) !== 'unknown') {
    throw new Error('resolveClientIpOrUnknown fallback')
  }
  pass('resolveClientIp 只信 req.ip / socket')

  await assertExpressHopBehavior()
  assertNoManualXffParsing()

  console.log('\n=== ALL PASS ===\n')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
