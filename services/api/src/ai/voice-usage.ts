export interface VoiceUsage {
  audioSeconds?: number | null
  textChars?: number
  succeededChars?: number
  segments?: number
  succeededSegments?: number
  complete: boolean
  rule: 'v1'
}

export function parseVoiceUsage(value: string | null | undefined): VoiceUsage | undefined {
  try {
    const v: unknown = JSON.parse(value || '{}')?.voiceUsage
    if (!v || typeof v !== 'object') return undefined
    const x = v as Record<string, unknown>
    if (x.rule !== 'v1' || typeof x.complete !== 'boolean') return undefined
    const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0
    if (x.audioSeconds !== undefined && x.audioSeconds !== null && !valid(x.audioSeconds)) return undefined
    for (const key of ['textChars', 'succeededChars', 'segments', 'succeededSegments']) {
      if (x[key] !== undefined && (!valid(x[key]) || !Number.isInteger(x[key]))) return undefined
    }
    return x as unknown as VoiceUsage
  } catch { return undefined }
}
