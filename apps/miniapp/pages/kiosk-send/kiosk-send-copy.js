// pages/kiosk-send/kiosk-send-copy.js
// 传文件页的提示文案与「码不能再传时说哪一句」。从 kiosk-send.js 拆出（页面到 500 行，CLAUDE.md §8），
// 只放字和这一个选句的纯函数，顶层不碰 wx。

const UNKNOWN_COPY = '这次上传的结果还不确定。请回到一体机屏幕核对，不要在这里重复发送。'
const BUSY_COPY = '这个二维码正在处理一次上传。请回到一体机屏幕查看，不要重复发送。'
// 码失效 / 已用 / 过期：与一体机 uploadSessionUserMessage 同一句（一体机句子为准）
const DEAD_COPY = '二维码已失效或已使用，请回到一体机刷新二维码。'
// 这一单已经不收文件了（收到了一份、一体机已确认或已取消）。可能是旁人拍到屏上的码先传了：
// 叫本人去一体机上看，不是自己的就取消再扫（无人值守，只能靠本人认）。
const OCCUPIED_COPY = '这一单已经不能再收文件了。如果一体机屏上有不是你传的文件，请在一体机上点「取消」，再重新扫码。'
const REJECT_FALLBACK = '系统没有收下这份文件，可以重新选择后再试'
const OFFLINE_COPY = '没连上终端，可以重试。'
const NOT_KIOSK_COPY = '这不是一体机上的二维码，请扫一体机屏幕上显示的二维码。'
const INCOMPLETE_COPY = '扫码信息不完整，请回到一体机重新扫码'
const LOGIN_PAGE_FAILED_COPY = '没能打开扫码登录页，请返回后重新扫码。'
// 从「我的文档」选
const DOC_NOT_FOUND_COPY = '这份文件现在用不了，可能已删除或已过期，请换一份。'
const DOC_TOO_LARGE_COPY = '这份文件超过 10MB，这台一体机这一单收不了，请换一份。'
const MEMBER_MISMATCH_COPY = '这台一体机现在登录的是另一个账号。请先在一体机上退出登录，再重新扫码。'
const LOGIN_EXPIRED_COPY = '登录已失效，请重新登录后再选。'
const DOCS_LOAD_FALLBACK = '我的文档这次没读到，可以重新读取。'

/** 码已不能再传时说哪一句：这一单不再收文件（NOT_PENDING）单说，其余照一体机那句。 */
function deadCopyOf(err) {
  return err && err.code === 'UPLOAD_SESSION_NOT_PENDING' ? OCCUPIED_COPY : DEAD_COPY
}

module.exports = {
  UNKNOWN_COPY,
  BUSY_COPY,
  DEAD_COPY,
  OCCUPIED_COPY,
  REJECT_FALLBACK,
  OFFLINE_COPY,
  NOT_KIOSK_COPY,
  INCOMPLETE_COPY,
  LOGIN_PAGE_FAILED_COPY,
  DOC_NOT_FOUND_COPY,
  DOC_TOO_LARGE_COPY,
  MEMBER_MISMATCH_COPY,
  LOGIN_EXPIRED_COPY,
  DOCS_LOAD_FALLBACK,
  deadCopyOf,
}
