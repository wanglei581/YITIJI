/**
 * 扫描指引里的面板用词必须是奔图面板上真实印着的字（走查 W-12）。
 *
 * 用户照着一体机屏幕上的话去按打印机面板；屏幕写「打开扫描功能」「扫描到网络 / SMB」，
 * 面板上却是「扫描」按钮和「扫描到 SMB」这一项，用户就找不到。
 * 单独成文件是因为 verify-scan-tasks.ts 已 5000+ 行（只减不增），这里只放这一条规则。
 */
import assert from 'node:assert/strict'
import { SCAN_TYPE_INSTRUCTIONS } from '../../src/scan-tasks/scan-tasks.service'

const PANEL_SCAN_BUTTON = '点击「扫描」'
const PANEL_SMB_TARGET = '「扫描到 SMB」'
/** 面板上没有这些字样；出现就说明指引又写回了与面板不符的叫法。 */
const NOT_ON_PANEL = ['打开「扫描」', '「扫描」功能', '扫描到网络', '网络 / SMB']

/** `createdDocumentInstructions`：service.create({ scanType: 'document' }) 实际返回给一体机的指引。 */
export function assertScanPanelWording(createdDocumentInstructions: readonly string[]): void {
  assert.deepEqual(createdDocumentInstructions, SCAN_TYPE_INSTRUCTIONS.document, 'create returns the panel guidance verbatim')
  const instructions: Record<string, readonly string[]> = SCAN_TYPE_INSTRUCTIONS
  assert.deepEqual(Object.keys(instructions).sort(), ['contract', 'document', 'id', 'resume'], 'every scan type has guidance')
  for (const [scanType, lines] of Object.entries(instructions)) {
    const text = lines.join('\n')
    assert.ok(text.includes(PANEL_SCAN_BUTTON), `${scanType}: guidance must say ${PANEL_SCAN_BUTTON} (panel wording)`)
    assert.ok(text.includes(PANEL_SMB_TARGET), `${scanType}: guidance must name the panel item ${PANEL_SMB_TARGET}`)
    for (const phrase of NOT_ON_PANEL) {
      assert.ok(!text.includes(phrase), `${scanType}: guidance must not use "${phrase}" (not printed on the Pantum panel)`)
    }
  }
  console.log('PASS scan guidance uses the Pantum panel wording (W-12)')
}
