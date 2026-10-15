import base from './playwright.w2.config'
const out = process.env.PROBE_OUT ?? '/tmp/purring-probe-out/evidence'
export default {
  ...base,
  testMatch: /fusion-w2-scan\.spec\.ts$/,
  outputDir: out,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4192' },
  projects: [
    { name: 'k1080', grep: /@w2/, use: { viewport: { width: 1080, height: 1920 } } },
    { name: 'p390', grep: /@w2/, use: { viewport: { width: 390, height: 844 } } },
    { name: 'l1280', grep: /@w2/, use: { viewport: { width: 1280, height: 720 } } },
  ],
  webServer: undefined,
}
