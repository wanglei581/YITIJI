import type { DeviceFault } from './scanDeviceState'

/** 逐字照 cs-scan-err-*。无告警证据不承诺提醒；设备 timeout 不证明本屏等满三分钟。 */
export const DEVICE_ERROR_COPY = {
  nopaper: {
    title: '进纸器里没有纸', sub: '扫描仪没有在进纸器里找到纸。', chip: '进纸器没有纸',
    reason: '扫描仪没有在进纸器里找到纸', detail: '放好纸后再试，或者改用玻璃台。',
    ask: '问小青：进纸器没纸怎么办', primary: '放好纸再试',
    retryDetail: '把纸放进进纸器，字朝上，再点一次',
  },
  jam: {
    title: '卡纸或盖板没合上', sub: '先处理好，再点“再试”。', chip: '扫描仪报告有故障',
    reason: '扫描仪报告：卡纸或盖板没合上', detail: '合上盖板、取出卡住的纸后再试。',
    ask: '问小青：卡纸怎么办', primary: '处理好了，再试',
    retryDetail: '盖板合好、卡住的纸取出来之后，再点一次',
  },
  busy: {
    title: '打印机正在忙', sub: '等它空下来再试。', chip: '打印机正在忙',
    reason: '打印机正在打印，或有人在打印机屏幕上操作', detail: '等它空下来再点「再试」。',
    ask: '问小青：打印机忙要等多久', primary: '再试', retryDetail: '打印机空下来之后，再点一次',
  },
  noresp: {
    title: '扫描仪没有响应', sub: '这次扫不了，请换个办法。', chip: '扫描仪没有响应',
    reason: '这台机器暂时连不上扫描仪', detail: '',
    ask: '问小青：扫描仪连不上怎么办', primary: '改用面板扫描', retryDetail: '',
  },
  timeout: {
    title: '等太久没有结果', sub: '这次没有扫出文件。', chip: '等待超时',
    reason: '这次没有扫出文件。', detail: '这次不会自动重扫。',
    ask: '问小青：等太久没结果怎么办', primary: '重新开始', retryDetail: '回到第一步，重新选材料',
  },
} satisfies Record<DeviceFault, {
  title: string; sub: string; chip: string; reason: string; detail: string; ask: string; primary: string; retryDetail: string
}>
