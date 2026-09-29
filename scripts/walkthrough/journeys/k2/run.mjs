// 把 stdin 里的一段代码发给 driver.mjs 执行，打印结果。
import http from 'node:http';
const PORT = Number(process.env.K2_DRIVER_PORT || 4792);
let code = '';
process.stdin.on('data', (c) => { code += c; });
process.stdin.on('end', () => {
  const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/', timeout: 0 }, (res) => {
    let out = '';
    res.on('data', (c) => { out += c; });
    res.on('end', () => {
      try {
        const j = JSON.parse(out);
        if (!j.ok) { console.log('ERROR', j.error, '\nURL', j.url, '\nSHOT', j.shot); return; }
        const o = j.out;
        console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 1));
        console.log(`(${j.ms}ms)`);
      } catch { console.log(out); }
    });
  });
  req.on('error', (e) => console.log('driver 不可达', e.message));
  req.end(code);
});
