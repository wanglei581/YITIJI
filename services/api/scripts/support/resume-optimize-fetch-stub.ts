import { EventEmitter } from 'node:events'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'

/** 沙箱不能监听时，复用原门禁的整个 HTTP handler 和所有桩队列，仅替换传输。 */
export function installResumeOptimizeFetchStub(handler: RequestListener) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.deepseek.com/v1/')) throw new Error('离线桩拒绝外网请求')
    return new Promise<Response>((resolve) => {
      const req = new EventEmitter()
      const headers = new Headers()
      const res = {
        statusCode: 200,
        setHeader: (name: string, value: string) => headers.set(name, value),
        end(body: string) { resolve(new Response(body, { status: this.statusCode, headers })) },
      }
      handler(req as IncomingMessage, res as unknown as ServerResponse)
      req.emit('data', Buffer.from(String(init?.body ?? '')))
      req.emit('end')
    })
  }
  return { baseURL: 'https://api.deepseek.com/v1', restore: () => { globalThis.fetch = original } }
}
