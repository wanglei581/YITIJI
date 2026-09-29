// 在页面里读出二维码组件的 value（qrcode.react 的 SVG 不含原文，从 React fiber 取 props）
(() => {
  const out = [];
  for (const svg of document.querySelectorAll('svg')) {
    const key = Object.keys(svg).find((k) => k.startsWith('__reactFiber$'));
    if (!key) continue;
    let f = svg[key];
    for (let i = 0; f && i < 6; i++, f = f.return) {
      const v = f.memoizedProps && f.memoizedProps.value;
      if (typeof v === 'string' && v.includes('://')) { out.push(v); break; }
    }
  }
  return out;
})()
