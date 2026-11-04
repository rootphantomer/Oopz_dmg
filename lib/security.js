'use strict'

// 安全判定集中在这里：纯函数、无 Electron 依赖，方便用 Node 直接跑单元测试
// （scripts/check-permissions.js）。main.js 只负责把事件接进来。

// 应用自身的域名：允许在窗口内导航
const ALLOWED_APP_HOSTS = new Set(['web.oopz.cn', 'oopz.cn'])

// 交给系统浏览器处理的协议白名单：只放行明确安全的几类，
// file: / smb: / 自定义 scheme 一律拒绝（shell.openExternal 会真的去执行它们）
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

// 可信来源（仅 https + 上述域名）按需放行的权限。
// 未列出的权限一律拒绝——新增一项之前先确认站点真的需要。
//
// 说明：这里只做 Chromium 层的授权，真正的硬件访问仍由 macOS TCC 把关，
// 例如 media 放行后，首次用麦克风/摄像头时系统仍会弹授权框。
const GRANTED_PERMISSIONS = new Set([
  'media', // 麦克风 + 摄像头（视频通话）
  'display-capture', // 屏幕共享（配合 setDisplayMediaRequestHandler）
  'speaker-selection', // 选择扬声器输出设备（setSinkId / selectAudioOutput）
  'notifications', // 网页消息通知
  'clipboard-sanitized-write', // 复制邀请码/房间号等写剪贴板
  'fullscreen', // 全屏查看共享画面
])

function parseUrl (url) {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function isAllowedAppHost (hostname) {
  return ALLOWED_APP_HOSTS.has(hostname)
}

// 只有 https + 白名单域名才允许留在应用窗口内（精确匹配 hostname，防 sub.web.oopz.cn 之类）
function isAllowedAppUrl (url) {
  const parsed = parseUrl(url)
  return Boolean(parsed && parsed.protocol === 'https:' && isAllowedAppHost(parsed.hostname))
}

// 可以交给系统浏览器（或系统邮件/电话）打开的 URL
function isAllowedExternalUrl (url) {
  const parsed = parseUrl(url)
  return Boolean(parsed && ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol))
}

// 权限请求的来源是否可信。origin 可能是 https://web.oopz.cn 或完整 URL，两者都能解析。
function isTrustedOrigin (origin) {
  if (!origin) return false
  const parsed = parseUrl(origin)
  return Boolean(parsed && parsed.protocol === 'https:' && isAllowedAppHost(parsed.hostname))
}

// permission 见 Electron 的 setPermissionRequestHandler / setPermissionCheckHandler 的枚举
function isPermissionAllowed (permission, origin) {
  if (!isTrustedOrigin(origin)) return false
  return GRANTED_PERMISSIONS.has(permission)
}

module.exports = {
  ALLOWED_APP_HOSTS,
  ALLOWED_EXTERNAL_PROTOCOLS,
  GRANTED_PERMISSIONS,
  parseUrl,
  isAllowedAppHost,
  isAllowedAppUrl,
  isAllowedExternalUrl,
  isTrustedOrigin,
  isPermissionAllowed,
}
