export function toolBandStatus(status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }): {
  text: string
  tone: 'ok' | 'warn' | 'unknown'
} {
  const tone = status.tone === 'ok' ? 'ok' : status.tone === 'warn' || status.tone === 'bad' ? 'warn' : 'unknown'
  return { text: status.label, tone }
}
