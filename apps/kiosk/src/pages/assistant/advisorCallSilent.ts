// 通话已进房、却一直没有小青的声音和字幕。现场没有人协助，只能自己把用户带回文字。

/**
 * 远端音量超过这个值，视为小青正在出声。
 * 与 AUDIO_VOLUME 里把状态切到 speaking 用的是同一个数。
 */
export const ADVISOR_HEARD_VOLUME_THRESHOLD = 5

/**
 * 进房后欢迎语应当马上开始播，字幕也跟着到。只在 live 里计，两档放在一起：
 * 12 秒：留给语音合成冷启动和一次进房抖动。超过仍无声音也无字幕，就不再假装通话正常，先提示可以改用文字。
 * 30 秒：提示留出读完并自己点的时间。到点还是没有动静，就结束这通计费会话并转文字，避免一直停在「通话中」。
 */
export const ADVISOR_SILENT_PROMPT_MS = 12_000
export const ADVISOR_SILENT_FALLBACK_MS = 30_000

export type AdvisorSilentStage = 'none' | 'prompt' | 'fallback'

export interface AdvisorSilentWatch {
  readonly heard: boolean
  markHeard: () => void
  arm: () => void
  disarm: () => void
  dispose: () => void
}

/** 听到过一次就停表。对话中间安静不再报。arm 只在确认进入 live 后调用。 */
export function createAdvisorSilentWatch(onStage: (stage: AdvisorSilentStage) => void): AdvisorSilentWatch {
  let heard = false
  let watching = false
  let timers: number[] = []

  const clearTimers = () => {
    for (const id of timers) window.clearTimeout(id)
    timers = []
    watching = false
  }

  return {
    get heard() {
      return heard
    },
    markHeard() {
      if (heard) return
      heard = true
      clearTimers()
      onStage('none')
    },
    arm() {
      if (heard || watching) return
      watching = true
      timers = [
        window.setTimeout(() => {
          if (!heard) onStage('prompt')
        }, ADVISOR_SILENT_PROMPT_MS),
        window.setTimeout(() => {
          if (!heard) onStage('fallback')
        }, ADVISOR_SILENT_FALLBACK_MS),
      ]
    },
    disarm() {
      heard = false
      clearTimers()
      onStage('none')
    },
    dispose() {
      clearTimers()
    },
  }
}
