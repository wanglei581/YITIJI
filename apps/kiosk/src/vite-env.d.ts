/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_USE_TRTC_CALL: string
  readonly VITE_ALLOW_TEXT_ONLY_ASSISTANT: string
  readonly VITE_TERMINAL_ID: string
  readonly VITE_PRINTER_NAME: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Web Speech API — 部分 TS 版本未内置，手动补全
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}
interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart:  ((e: Event) => void) | null
  onend:    ((e: Event) => void) | null
  onerror:  ((e: Event) => void) | null
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}
declare const SpeechRecognition: { new(): SpeechRecognition }
declare const webkitSpeechRecognition: { new(): SpeechRecognition }

// trtc-sdk-v5 — 腾讯 TRTC Web SDK，运行时动态加载
declare module 'trtc-sdk-v5'
