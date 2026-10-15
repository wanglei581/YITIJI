import base from './playwright.w2.config'
export default {
  ...base,
  testMatch: /tmpprobe-.*\.spec\.ts$/,
  outputDir: '/tmp/purring-probe-out/results',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4192' },
  projects: [{ name: 'probe', use: { viewport: { width: 390, height: 844 } } }],
  webServer: undefined,
}
