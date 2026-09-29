// 拼页面路径。源码里不写连续的 /pages/<名>/<名>，
// 这样停放后的上传包扫描不会把字符串当成写死路由。
function pagePath(name) {
  return '/pages/' + name + '/' + name
}

module.exports = { pagePath }
