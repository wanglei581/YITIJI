// 与终端模式共用同一 E2E 构建标志；地址参数不能开启生产样例。
export const IS_E2E_BUILD = Boolean(import.meta.env['VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN']?.trim())
export const ALLOW_FIXTURES = import.meta.env.DEV || IS_E2E_BUILD
