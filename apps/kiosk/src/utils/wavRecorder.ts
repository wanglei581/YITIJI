// ============================================================
// WAV 录音器（2C+ 语音回答）：getUserMedia + AudioContext 采集 PCM，
// 重采样为 16kHz 16bit 单声道 WAV（百度短语音识别要求格式）。
//
// 公共一体机约束：
// - 显式 start/stop（「开始回答 / 结束回答」两状态按钮，不做按住说话）。
// - stop 后立即释放麦克风轨道（不留常驻采集）。
// - 音频只在内存（Float32 缓冲 → WAV Blob），不落任何本地存储。
// ============================================================

export interface WavRecorder {
  /** 停止并返回 16k 单声道 WAV（同时释放麦克风）。 */
  stop(): Promise<Blob>
  /** 放弃录音并释放麦克风。 */
  cancel(): void
}

export async function startWavRecorder(): Promise<WavRecorder> {
  // 权限请求超时保护:一体机权限框无人响应/被系统静默挂起时,10s 后明确失败,
  // 由调用方回退文字输入(不让界面卡在等待态)。
  let timedOut = false
  let timeoutId: number | null = null
  const getUserMedia = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  }).then((lateStream) => {
    if (timedOut) lateStream.getTracks().forEach((track) => track.stop())
    return lateStream
  })
  let stream: MediaStream
  try {
    stream = await Promise.race([
      getUserMedia,
      new Promise<never>((_, reject) =>
        { timeoutId = window.setTimeout(() => { timedOut = true; reject(new Error('MIC_PERMISSION_TIMEOUT')) }, 10_000) },
      ),
    ])
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtx()
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessor 兼容性最稳（Edge Kiosk）；deprecated 但无构建期依赖
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  source.connect(processor)
  processor.connect(ctx.destination)

  const release = () => {
    try { processor.disconnect() } catch { /* noop */ }
    try { source.disconnect() } catch { /* noop */ }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => undefined)
  }

  return {
    stop(): Promise<Blob> {
      const sampleRate = ctx.sampleRate
      release()
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const pcm = new Float32Array(total)
      let off = 0
      for (const c of chunks) { pcm.set(c, off); off += c.length }
      return Promise.resolve(encodeWav16k(pcm, sampleRate))
    },
    cancel(): void {
      release()
      chunks.length = 0
    },
  }
}

/** 线性重采样到 16k 并编码 16bit 单声道 WAV。 */
function encodeWav16k(input: Float32Array, inputRate: number): Blob {
  const targetRate = 16000
  const ratio = inputRate / targetRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    const sample = input[i0] * (1 - frac) + input[i1] * frac
    const clamped = Math.max(-1, Math.min(1, sample))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  const buffer = new ArrayBuffer(44 + out.length * 2)
  const view = new DataView(buffer)
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i += 1) view.setUint8(o + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + out.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, targetRate, true)
  view.setUint32(28, targetRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, out.length * 2, true)
  new Int16Array(buffer, 44).set(out)
  return new Blob([buffer], { type: 'audio/wav' })
}
