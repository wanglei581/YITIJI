/**
 * 排版出站现实写法的补充用例。由 verify-layout-outbound-realistic 拉起，
 * 不单独进 CI。分段不再按固定组数列举，日期豁免和随机拼接都在这里钉住。
 */
const PHONE = '13800138000'
const ID_CARD = '110101199003072315'

type Covered = (label: string, raw: string, secretDigits: string, json?: string) => void

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
