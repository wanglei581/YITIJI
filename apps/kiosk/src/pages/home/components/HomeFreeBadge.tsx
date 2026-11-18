// 首页问候块右上角的「免费使用」。不带动画。显不显示由调用方决定。

export function HomeFreeBadge() {
  return (
    <span className="qxt-home-free" aria-label="免费使用">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      免费使用
    </span>
  )
}
