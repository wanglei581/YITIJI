// 2D 数字人引导员 — SVG + CSS 动画，无额外依赖
// 状态：idle（待机）/ talking（说话）/ greeting（打招呼）

import { useEffect, useState } from 'react'

export type AvatarState = 'idle' | 'talking' | 'greeting'

interface DigitalHumanProps {
  state?: AvatarState
  className?: string
}

const KEYFRAMES = `
@keyframes dh-blink {
  0%, 88%, 100% { transform: scaleY(1); }
  92%            { transform: scaleY(0.06); }
}
@keyframes dh-breathe {
  0%, 100% { transform: translateY(0px); }
  50%      { transform: translateY(-5px); }
}
@keyframes dh-talk {
  0%, 100% { transform: scaleY(1); }
  50%      { transform: scaleY(0.18); }
}
@keyframes dh-wave {
  0%   { transform: rotate(0deg)   translateX(0); }
  20%  { transform: rotate(-22deg) translateX(2px); }
  45%  { transform: rotate(15deg)  translateX(-1px); }
  65%  { transform: rotate(-18deg) translateX(2px); }
  82%  { transform: rotate(10deg)  translateX(-1px); }
  100% { transform: rotate(0deg)   translateX(0); }
}
@keyframes dh-pulse {
  0%   { transform: scale(1);    opacity: 0.35; }
  100% { transform: scale(1.12); opacity: 0; }
}
@keyframes dh-nod {
  0%, 100% { transform: translateY(0); }
  30%      { transform: translateY(-6px); }
  60%      { transform: translateY(3px); }
}
`

export function DigitalHuman({ state = 'idle', className = '' }: DigitalHumanProps) {
  // 节流：greeting 动画只播一次（3s 后归 idle）
  const [localState, setLocalState] = useState<AvatarState>(state)
  useEffect(() => {
    setLocalState(state)
    if (state === 'greeting') {
      const t = setTimeout(() => setLocalState('idle'), 3000)
      return () => clearTimeout(t)
    }
  }, [state])

  const _isTalking  = localState === 'talking'
  const _isGreeting = localState === 'greeting'

  return (
    <div className={`relative flex flex-col items-center select-none ${className}`}>
      <style>{KEYFRAMES}</style>

      {/* 说话时的光晕脉冲圈 */}
      {_isTalking && (
        <div
          className="absolute inset-0 rounded-full bg-blue-400 pointer-events-none"
          style={{ animation: 'dh-pulse 1.1s ease-out infinite' }}
        />
      )}

      <svg
        viewBox="0 0 200 240"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full overflow-visible"
        aria-label="AI 数字人引导员"
        role="img"
      >
        {/* ── 背景圆形头像框 ───────────────────────────── */}
        <circle cx="100" cy="108" r="93" fill="#EFF6FF" />
        <circle cx="100" cy="108" r="93" fill="none" stroke="#BFDBFE" strokeWidth="2" />

        {/* ── 打招呼时头部点头 ─────────────────────────── */}
        <g
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center 120px',
            animation: _isGreeting ? 'dh-nod 0.6s ease-in-out 3' : undefined,
          }}
        >
          {/* ── 身体 / 制服 ──────────────────────────── */}
          <g style={{ animation: 'dh-breathe 3.6s ease-in-out infinite' }}>
            {/* 制服主体 */}
            <path
              d="M 10,240 Q 12,198 52,182 L 78,193 L 100,200 L 122,193 L 148,182 Q 188,198 190,240 Z"
              fill="#1E3A8A"
            />
            {/* 白色内衬衬衫 */}
            <path d="M 78,193 L 94,220 L 100,208 L 106,220 L 122,193" fill="white" />
            {/* 左翻领 */}
            <path d="M 78,193 L 94,220 L 100,200 Z" fill="#F1F5F9" />
            {/* 右翻领 */}
            <path d="M 122,193 L 106,220 L 100,200 Z" fill="#F1F5F9" />
            {/* 领带/工牌区 */}
            <rect x="94" y="218" width="12" height="16" rx="2" fill="#3B82F6" />
            <rect x="96" y="220" width="8" height="3" rx="1" fill="white" opacity="0.8" />
            {/* 脖子 */}
            <rect x="91" y="174" width="18" height="20" rx="7" fill="#FDDCAE" />
          </g>

          {/* ── 头部（含呼吸动画） ─────────────────────── */}
          <g style={{ animation: 'dh-breathe 3.6s ease-in-out infinite' }}>
            {/* 耳朵 */}
            <ellipse cx="44" cy="118" rx="7" ry="10" fill="#F0C99A" />
            <ellipse cx="44" cy="118" rx="3.5" ry="6" fill="#E5B882" />
            <ellipse cx="156" cy="118" rx="7" ry="10" fill="#F0C99A" />
            <ellipse cx="156" cy="118" rx="3.5" ry="6" fill="#E5B882" />

            {/* 头部主椭圆 */}
            <ellipse cx="100" cy="107" rx="57" ry="66" fill="#FDDCAE" />

            {/* ── 头发 ────────────────────────────── */}
            {/* 顶部发型（短发/职业感） */}
            <path
              d="M 47,104 Q 50,46 100,43 Q 150,46 153,104
                 Q 144,72 100,68 Q 56,72 47,104 Z"
              fill="#1C1C2E"
            />
            {/* 左鬓角 */}
            <path d="M 47,104 L 44,140 Q 44,148 49,147 L 51,122 Z" fill="#1C1C2E" />
            {/* 右鬓角 */}
            <path d="M 153,104 L 156,140 Q 156,148 151,147 L 149,122 Z" fill="#1C1C2E" />
            {/* 发丝高光 */}
            <path
              d="M 68,58 Q 100,48 132,60"
              stroke="#4A4A6E"
              strokeWidth="2"
              fill="none"
              opacity="0.5"
              strokeLinecap="round"
            />

            {/* ── 眉毛 ────────────────────────────── */}
            <path
              d="M 72,92 Q 83,87 93,90"
              stroke="#1C1C2E"
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 107,90 Q 117,87 128,92"
              stroke="#1C1C2E"
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
            />

            {/* ── 左眼 ────────────────────────────── */}
            <g
              transform="translate(82, 107)"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: 'dh-blink 4.2s ease-in-out infinite',
                animationDelay: '0.3s',
              }}
            >
              <ellipse rx="12.5" ry="8.5" fill="white" />
              <ellipse cx="1" ry="7" rx="7" fill="#1C1C2E" />
              <ellipse cx="3" cy="-2.5" rx="2.5" ry="2" fill="white" opacity="0.65" />
              <ellipse rx="12.5" ry="8.5" fill="none" stroke="#DEB896" strokeWidth="0.5" />
            </g>

            {/* ── 右眼 ────────────────────────────── */}
            <g
              transform="translate(118, 107)"
              style={{
                transformBox: 'fill-box',
                transformOrigin: 'center',
                animation: 'dh-blink 4.2s ease-in-out infinite',
                animationDelay: '0.8s',
              }}
            >
              <ellipse rx="12.5" ry="8.5" fill="white" />
              <ellipse cx="1" ry="7" rx="7" fill="#1C1C2E" />
              <ellipse cx="3" cy="-2.5" rx="2.5" ry="2" fill="white" opacity="0.65" />
              <ellipse rx="12.5" ry="8.5" fill="none" stroke="#DEB896" strokeWidth="0.5" />
            </g>

            {/* ── 鼻子 ────────────────────────────── */}
            <path
              d="M 97,122 Q 94,134 93,136 Q 100,140 107,136 Q 106,134 103,122"
              fill="#E8B080"
              opacity="0.55"
            />
            <path
              d="M 93,135 Q 100,139 107,135"
              stroke="#C08850"
              strokeWidth="1"
              fill="none"
              strokeLinecap="round"
            />

            {/* ── 嘴巴 ────────────────────────────── */}
            {!_isTalking ? (
              /* 微笑（待机 / 打招呼） */
              <path
                d="M 87,152 Q 100,163 113,152"
                stroke="#C07050"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
              />
            ) : (
              /* 说话动画嘴型 */
              <g>
                <ellipse
                  cx="100" cy="153"
                  rx="14" ry="8"
                  fill="#C07050"
                  style={{
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                    animation: 'dh-talk 0.2s ease-in-out infinite',
                  }}
                />
                <ellipse
                  cx="100" cy="152"
                  rx="11" ry="5"
                  fill="#7B2525"
                  style={{
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                    animation: 'dh-talk 0.2s ease-in-out infinite',
                  }}
                />
                <rect
                  x="88" y="149" width="24" height="5"
                  rx="2.5" fill="white" opacity="0.8"
                />
              </g>
            )}

            {/* 腮红 */}
            <ellipse cx="72" cy="135" rx="11" ry="7" fill="#FFB0B0" opacity="0.18" />
            <ellipse cx="128" cy="135" rx="11" ry="7" fill="#FFB0B0" opacity="0.18" />
          </g>

          {/* ── 打招呼：挥手手臂 ──────────────────────── */}
          {_isGreeting && (
            <g
              transform="translate(158, 178)"
              style={{
                transformBox: 'fill-box',
                transformOrigin: '0 0',
                animation: 'dh-wave 0.55s ease-in-out 4',
              }}
            >
              {/* 手臂 */}
              <path
                d="M 0,0 Q 12,-8 18,-22 Q 22,-32 20,-38"
                stroke="#FDDCAE"
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
              />
              {/* 手掌 */}
              <ellipse cx="20" cy="-40" rx="9" ry="7" fill="#FDDCAE" transform="rotate(-20)" />
            </g>
          )}
        </g>
      </svg>
    </div>
  )
}
