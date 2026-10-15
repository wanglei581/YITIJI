// 本地专用，**不提交**：B 路在各自工作目录里跑浏览器用例时换端口，几个目录同时跑不撞端口。
// 用法（在 apps/kiosk 下）：QXB_BASE=w3 QXB_PORT=4361 playwright test --config=playwright.qxb-port.config.ts -g "..."
// QXB_BASE 取 default | w1 | w2 | w3 | w4 | w5 | w6 | mic | scan-safety（对应同名 playwright.*.config.ts）。
import base from './playwright.config'
import w1 from './playwright.w1.config'
import w2 from './playwright.w2.config'
import w3 from './playwright.w3.config'
import w4 from './playwright.w4.config'
import w5 from './playwright.w5.config'
import w6 from './playwright.w6.config'
import mic from './playwright.mic-capability.config'
import scanSafety from './playwright.scan-safety.config'
import privacy from './playwright.privacy.config'

const table: Record<string, typeof base> = { default: base, w1, w2, w3, w4, w5, w6, mic, 'scan-safety': scanSafety, privacy }
const pick = table[process.env.QXB_BASE ?? '']
if (!pick) throw new Error(`QXB_BASE 必须是 ${Object.keys(table).join(' | ')}`)
const port = Number(process.env.QXB_PORT)
if (!Number.isInteger(port) || port < 4300 || port > 4399) throw new Error('QXB_PORT 必须是 4300–4399 的整数')
const origin = `http://127.0.0.1:${port}`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = pick.webServer as any

export default {
  ...pick,
  outputDir: `../../test-results/qxb-${port}`,
  use: { ...pick.use, baseURL: origin },
  webServer: {
    ...server,
    command: String(server.command).replace(/--port \d+/, `--port ${port}`),
    url: origin,
    reuseExistingServer: false,
    // 机器忙（好几个窗口同时构建）时构建会超过原配置的 3 分钟，本地放宽到 15 分钟。
    timeout: 900_000,
  },
}
