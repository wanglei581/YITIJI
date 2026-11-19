/**
 * 排版出站现实写法的补充用例。由 verify-layout-outbound-realistic 拉起，
 * 不单独进 CI。分段不再按固定组数列举，日期豁免和随机拼接都在这里钉住。
 */
const PHONE = '13800138000'
const ID_CARD = '110101199003072315'

type Covered = (label: string, raw: string, secretDigits: string, json?: string) => void
type Kept = (label: string, raw: string) => void

/** 扩展分隔把 1–8 位的数字段接成号码。三段都放进原文、字段值和简历 JSON。 */
export function runExtendedSegmentCases(assertCovered: Covered): void {
  assertCovered('七加四斜线手机号', '1380013/8000', PHONE)
  assertCovered('七加四换行手机号', '1380013\n8000', PHONE)
  assertCovered('身份证六四四四斜线', '110101/1990/0307/2315', ID_CARD)
  assertCovered('身份证六四四四换行', '110101\n1990\n0307\n2315', ID_CARD)
  assertCovered('固话四四四斜线', '0755/8888/8888', '075588888888')
  assertCovered('固话四四四换行', '0755\n8888\n8888', '075588888888')
  assertCovered('全角斜线手机号', '138\uFF0F0013\uFF0F8000', PHONE)
  assertCovered('通用分隔和斜线混用的手机号', '138 - 0013/8000', PHONE)
  assertCovered(
    'JSON 相邻字段各含一段斜线手机号',
    '138/0013/8000',
    PHONE,
    '{"prefix":"138/0013","suffix":"8000"}',
  )
}

/**
 * 整段像日期、时间或年份串的不遮。三段都要原样看见。
 * 月日不合法、或者根本不是日期的长数字仍然遮。
 */
export function runDateExemptionCases(assertKept: Kept, assertCovered: Covered): void {
  assertKept('不补零的点分年月日区间', '2018.9.1-2022.6.30')
  assertKept('不补零的斜线年月日区间', '2018/9/1-2022/6/30')
  assertKept('不补零的年月区间', '2018.10-2022.6')
  assertKept('紧凑日期区间', '20230501-20230505')
  assertKept('年份串', '2018-2020-2022')
  assertKept('全角分隔的年月日区间', '2018\uFF0F9\uFF0F1\uFF0D2022\uFF0E6\uFF0E30')
  assertKept('斜线年月区间仍不遮', '2020/09 - 2024/06')
  assertKept('点与破折号年月区间仍不遮', '2019.09\u20142023.06')
  assertKept('中文年月区间仍不遮', '2021年3月-2024年5月')
  assertKept('斜线年月日仍不遮', '2020/09/01')
  assertKept('钟点时间段仍不遮', '9:00-18:00')
  assertCovered('不像日期的斜线手机号仍遮', '138/0013/8000', PHONE)
  assertCovered('月日不合法的紧凑区间仍遮', '20231345-20230505', '2023134520230505')
}
