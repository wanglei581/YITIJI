/** 官方语音失败时的浏览器播报。失败不阻塞作答。 */
export function speakInterview(text: string, onState?: (speaking: boolean) => void): void {
  try {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    utterance.onstart = () => onState?.(true)
    utterance.onend = () => onState?.(false)
    utterance.onerror = () => onState?.(false)
    window.speechSynthesis.speak(utterance)
  } catch {
    onState?.(false)
  }
}
