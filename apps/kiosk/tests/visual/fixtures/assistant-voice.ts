import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'

/** 仅浏览器 UI 夹具：替换 SDK chunk，不申请麦克风、不连接真实房间。 */
export async function mockAssistantVoice(page: Page, api: ApiRouter, micDenied = false) {
  api.respond('POST', '/api/v1/trtc/session', {
    status: 200,
    json: { sdkAppId: 1, roomId: 'm5-fixture-room', userId: 'm5-fixture-user', userSig: 'synthetic', taskId: 'm5-fixture-task' },
  })
  api.respond('POST', '/api/v1/trtc/session/stop', { status: 200, json: { ok: true } })
  await page.route(/\/assets\/trtc-[^/]+\.js(?:\?.*)?$/, async (route) => {
    // Vite 的 CJS interop 会把动态导入变成 .then(m => m.<alias>)；保留实际 chunk 的导出名。
    const original = await route.fetch()
    const source = await original.text()
    const aliases = [...source.matchAll(/export\s*\{([^}]+)\}/g)]
      .flatMap((match) => match[1]!.split(','))
      .map((part) => part.trim().split(/\s+as\s+/).at(-1)!)
      .filter((name) => name !== 'default' && /^[a-zA-Z_$][\w$]*$/.test(name))
    await route.fulfill({ contentType: 'text/javascript', body: `
      const EVENT = Object.fromEntries(['REMOTE_AUDIO_AVAILABLE', 'REMOTE_AUDIO_UNAVAILABLE', 'CUSTOM_MESSAGE', 'AUDIO_VOLUME', 'AUTOPLAY_FAILED', 'ERROR'].map(k => [k, k]));
      const fixture = { EVENT, create() {
        const handlers = {};
        return {
          on(event, listener) { handlers[event] = listener; },
          async enterRoom() {},
          async startLocalAudio() { ${micDenied ? "throw new DOMException('Denied', 'NotAllowedError');" : ''} },
          async startRemoteAudio() {},
          async updateRemoteAudio() {},
          async updateLocalAudio() {},
          async stopLocalAudio() {},
          async exitRoom() {},
          destroy() {},
          enableAudioVolumeEvaluation() {
            handlers[EVENT.CUSTOM_MESSAGE]?.({ data: new TextEncoder().encode(JSON.stringify({ type: 'subtitle', text: '可以先说说你最想解决的问题。' })).buffer });
            handlers[EVENT.AUDIO_VOLUME]?.({ result: [] });
          },
        };
      } };
      export default fixture;
      const fixtureNamespace = { default: fixture };
      ${aliases.map((name) => `export { fixtureNamespace as ${name} };`).join('\n')}
    ` })
  })
}
