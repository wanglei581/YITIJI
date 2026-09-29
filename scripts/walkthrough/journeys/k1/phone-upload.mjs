// 手机端上传：node phone-upload.mjs <一体机二维码原文> <文件> <人物>
import * as lib from './lib.mjs';
const [qr, file, who] = process.argv.slice(2);
const { browser, page } = await lib.connect('phone');
const url = qr.replace('127.0.0.1:4310', '127.0.0.1:4311');
await page.goto('about:blank');
await page.goto(url); await page.waitForTimeout(2500);
const reqs = lib.netlog(page);
await page.locator('input[type=file]').first().setInputFiles(file);
await page.waitForTimeout(4000);
const s = await lib.shot(page, 'phone-uploaded');
lib.ledger({ 人物: who, 端: '手机', 页面: url.split('#')[0], 操作: '手机扫码页上传文件', 输入: file.split('/').pop(), 结果: reqs.join(' ; ').slice(0, 200), 截图: s });
console.log(reqs.join('\n'));
await browser.close();
