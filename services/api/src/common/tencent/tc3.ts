import { createHash, createHmac } from 'crypto'

// ============================================================
// 腾讯云 API TC3-HMAC-SHA256 签名（共享 util）。
// 消费方：mock-interview ASR（一句话识别）、TTS（TextToVoice）。
// 密钥仅服务端持有，绝不进前端 / 日志 / 仓库。
// ============================================================

export interface Tc3SignArgs {
  /** 不含端口的 Host（签名用） */
  host: string
  service: string
  payload: string
  /** Unix 秒 */
  ts: number
  secretId: string
  secretKey: string
}

export function tc3Sign(args: Tc3SignArgs): string {
  const hashHex = (d: string) => createHash('sha256').update(d).digest('hex')
  const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest()
  const date = new Date(args.ts * 1000).toISOString().slice(0, 10)
  const canonical = [
    'POST', '/', '',
    `content-type:application/json\nhost:${args.host}\n`,
    'content-type;host',
    hashHex(args.payload),
  ].join('\n')
  const scope = `${date}/${args.service}/tc3_request`
  const toSign = ['TC3-HMAC-SHA256', args.ts, scope, hashHex(canonical)].join('\n')
  const signature = createHmac(
    'sha256',
    hmac(hmac(hmac(`TC3${args.secretKey}`, date), args.service), 'tc3_request'),
  ).update(toSign).digest('hex')
  return `TC3-HMAC-SHA256 Credential=${args.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`
}
