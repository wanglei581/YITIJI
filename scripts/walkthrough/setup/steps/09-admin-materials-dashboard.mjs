// A7：求职材料库 → 查看模板列表（只看）。A8：工作台 → 记录数字（截图 + 文字）。也顺带记录数据大屏。
export default async ({ page, h }) => {
  await h.goto('/job-materials')
  await h.settle(1200)
  let shot = await h.shot('job-materials')
  await h.log({ action: '打开求职材料库，查看模板', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 1500), screenshot: shot })

  await h.goto('/')
  await h.settle(2000)
  shot = await h.shot('admin-dashboard-after-setup')
  await h.log({ action: '工作台（配置完成后）', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 2500), screenshot: shot })
  const errs = h.netErrors()
  if (errs.length) await h.log({ action: '工作台加载时的失败请求', result: JSON.stringify(errs) })

  await h.goto('/devices?tab=overview')
  await h.settle(1200)
  shot = await h.shot('devices-overview')
  await h.log({ action: '设备管理 → 设备总览', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 800), screenshot: shot })
}
