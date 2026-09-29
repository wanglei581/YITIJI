const t0 = Date.now(); const log = [];
let last = '';
for (let i = 0; i < 40; i++) {
  const u = page.url();
  if (u !== last) { log.push(`${Math.round((Date.now()-t0)/1000)}s ${u}`); last = u; }
  if (u.includes('screensaver')) break;
  await page.waitForTimeout(5000);
}
const s = await lib.shot(page, 'handover-idle-screensaver');
await page.mouse.click(540, 1000); await page.waitForTimeout(2000);
const s2 = await lib.shot(page, 'handover-after-wake-home');
const t = await lib.visibleText(page, 600);
lib.ledger({人物:'下一位游客丁', 页面: page.url(), 操作:'在「我的文档」页停手不动，等闲置清场后轻触屏保', 结果: log.join(' → '), 截图:s+','+s2});
return log.join('\n')+'\n'+t;
