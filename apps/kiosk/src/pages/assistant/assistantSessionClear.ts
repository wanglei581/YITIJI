import { newSessionId } from './advisorScenes'

/**
 * 清场时作废还在路上的这一轮，并换掉页上的会话号。
 * 屏上的字由调用方清。页面不卸载。
 */
export function applyAssistantSessionClear(
  requestToken: { current: number },
  sessionId: { current: string },
  resetScreen: () => void,
): void {
  requestToken.current += 1
  sessionId.current = newSessionId()
  resetScreen()
}
