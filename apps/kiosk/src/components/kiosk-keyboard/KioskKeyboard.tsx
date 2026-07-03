// KioskKeyboard — 一体机页内悬浮虚拟键盘（墨青纸感）
//
// 公共触控终端无物理键盘，文字输入靠本组件。三种模式：
//   中文 — QWERTY 输拼音，实时出汉字候选（pinyinDict，离线内置）
//   英文 — 字母直接上屏
//   符号 — 数字 + 常用中英标点
// 点输入框弹出、点键盘外（backdrop）收起；按键不夺输入框焦点（pointerdown preventDefault）。
//
// 受控用法：<KioskKeyboard open value onChange onEnter onClose />
import { useMemo, useState } from 'react'
import { KIcon } from '../kiosk-icon'
import { queryCandidates } from './pinyinDict'
import './kiosk-keyboard.css'

type Mode = 'cn' | 'en' | 'num'

const ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]

const NUM_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['，', '。', '？', '！', '、', '：', '；', '“', '”'],
  ['@', '.', '_', '-', '/', '（', '）', '#'],
]

export function KioskKeyboard({
  open,
  value,
  onChange,
  onEnter,
  onClose,
}: {
  open: boolean
  value: string
  onChange: (next: string) => void
  onEnter?: () => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('cn')
  const [composing, setComposing] = useState('')

  const candidates = useMemo(
    () => (mode === 'cn' && composing ? queryCandidates(composing) : []),
    [mode, composing],
  )

  if (!open) return null

  // 阻止按键夺走输入框焦点
  const hold = (e: React.PointerEvent) => e.preventDefault()

  const commitChar = (ch: string) => onChange(value + ch)

  const pickCandidate = (word: string) => {
    onChange(value + word)
    setComposing('')
  }

  const onLetter = (ch: string) => {
    if (mode === 'cn') setComposing((c) => c + ch)
    else commitChar(ch)
  }

  const onBackspace = () => {
    if (composing) {
      setComposing((c) => c.slice(0, -1))
      return
    }
    // 删末尾一个字符（含中文，用 Array.from 处理代理对）
    const arr = Array.from(value)
    onChange(arr.slice(0, -1).join(''))
  }

  const onSpace = () => {
    if (mode === 'cn' && composing) {
      if (candidates[0]) pickCandidate(candidates[0])
      return
    }
    commitChar(' ')
  }

  const onReturn = () => {
    if (mode === 'cn' && composing && candidates[0]) {
      pickCandidate(candidates[0])
      return
    }
    onEnter?.()
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setComposing('')
  }

  const keyRows = mode === 'num' ? NUM_ROWS : ROWS
  const showCn = mode === 'cn'

  return (
    <>
      <div className="kkb-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="kkb" role="group" aria-label="虚拟键盘" onPointerDown={hold}>
        {/* 候选条：中文模式且正在拼音输入时显示 */}
        {showCn && composing && (
          <div className="kkb-cand">
            <span className="kkb-comp">{composing}</span>
            <div className="kkb-cand-list">
              {candidates.length > 0 ? (
                candidates.map((w, i) => (
                  <button key={w + i} type="button" className="kkb-cand-item" onClick={() => pickCandidate(w)}>
                    {w}
                  </button>
                ))
              ) : (
                <span className="kkb-cand-empty">无候选，可切「符号」或用「英文」</span>
              )}
            </div>
          </div>
        )}

        {/* 顶部条：模式指示 + 收起 */}
        {!(showCn && composing) && (
          <div className="kkb-bar">
            <span className="kkb-hint">
              {mode === 'cn' ? '拼音输入 · 输字母出汉字' : mode === 'en' ? '英文输入' : '数字与符号'}
            </span>
            <button type="button" className="kkb-collapse" onClick={onClose} aria-label="收起键盘">
              <KIcon name="arrow" />
              收起
            </button>
          </div>
        )}

        {/* 键位 */}
        <div className="kkb-keys">
          {keyRows.map((row, ri) => (
            <div className="kkb-row" key={ri}>
              {/* 字母模式第三行左侧放符号切换，右侧放退格 */}
              {mode !== 'num' && ri === 2 && (
                <button type="button" className="kkb-key kkb-fn wide" onClick={() => switchMode('num')}>
                  ?123
                </button>
              )}
              {row.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="kkb-key"
                  onClick={() => (mode === 'num' ? commitChar(k) : onLetter(k))}
                >
                  {mode === 'en' ? k.toUpperCase() : k}
                </button>
              ))}
              {ri === 2 && (
                <button type="button" className="kkb-key kkb-fn wide" onClick={onBackspace} aria-label="退格">
                  ⌫
                </button>
              )}
              {mode === 'num' && ri === 2 && (
                <button type="button" className="kkb-key kkb-fn wide" onClick={() => switchMode('cn')}>
                  拼音
                </button>
              )}
            </div>
          ))}

          {/* 底部功能行 */}
          <div className="kkb-row kkb-bottom">
            <button
              type="button"
              className="kkb-key kkb-fn"
              onClick={() => switchMode(mode === 'cn' ? 'en' : 'cn')}
            >
              {mode === 'cn' ? '中' : mode === 'en' ? 'EN' : '拼音'}
            </button>
            <button type="button" className="kkb-key kkb-fn" onClick={() => switchMode('num')} aria-label="符号">
              符
            </button>
            <button type="button" className="kkb-key kkb-space" onClick={onSpace}>
              空格
            </button>
            <button type="button" className="kkb-key kkb-fn" onClick={() => commitChar('，')}>
              ，
            </button>
            <button type="button" className="kkb-key kkb-send" onClick={onReturn}>
              <KIcon name="send" />
              发送
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
