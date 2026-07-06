/**
 * HTTP body parser 装配（main.ts bootstrap 与 verify 脚本共用同一实现，
 * 防「真实入口」与「测试口径」漂移 —— C5-6 双模型审查 Critical 修复的守护点）。
 *
 * 为什么两个 parser 都要挂 rawBody verify：
 * - sync webhook 与 wechat 回调是 application/json；
 * - alipay notify 是 application/x-www-form-urlencoded；
 * 验签都必须基于**原始字节**（对 parsed object 重新序列化字段顺序/编码会变，签名必失败）。
 * 只对白名单路径前缀保留 rawBody，其他路由不背内存成本。
 */
import type { Request, Response } from 'express'

export const RAW_BODY_JSON_PREFIXES = ['/api/v1/sync/', '/api/v1/payment/callback/'] as const
export const RAW_BODY_URLENCODED_PREFIXES = ['/api/v1/payment/callback/'] as const

export interface RawBodyRequest extends Request {
  rawBody?: Buffer
}

export function rawBodyCaptureFor(prefixes: readonly string[]) {
  return (req: RawBodyRequest, _res: Response, buf: Buffer): void => {
    if (prefixes.some((prefix) => req.url.startsWith(prefix))) {
      req.rawBody = Buffer.from(buf)
    }
  }
}

/** 在 express 应用上装配 json + urlencoded parser（含 rawBody 捕获）。 */
export function installBodyParsers(app: { use: (mw: unknown) => unknown }): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express') as typeof import('express')
  app.use(express.json({ verify: rawBodyCaptureFor(RAW_BODY_JSON_PREFIXES) }))
  app.use(express.urlencoded({ extended: true, verify: rawBodyCaptureFor(RAW_BODY_URLENCODED_PREFIXES) }))
}
