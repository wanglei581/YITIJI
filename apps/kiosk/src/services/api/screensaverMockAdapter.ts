import type { KioskScreensaverPlaylist } from '@ai-job-print/shared'

/**
 * 屏保配置 Mock adapter。
 *
 * 纯 mock 模式(无后端)下没有真实素材,返回 enabled:false:
 * 屏保需要后端 + 管理员上传素材并绑定终端方案才生效。
 * 这样在 mock 模式下 idle 也不会进入空白屏保(诚实降级,非 bug)。
 */
export const screensaverMockAdapter = {
  async getPlaylist(): Promise<KioskScreensaverPlaylist> {
    return { enabled: false, idleTimeoutSec: 180, items: [] }
  },
}
