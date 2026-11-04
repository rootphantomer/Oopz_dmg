'use strict'

// 权限矩阵 / URL 白名单的单元测试。纯 Node，不需要 Electron 也不需要真机。
// 断言对象是 lib/security.js —— main.js 的 handler 只是把事件接进去。

const {
  isAllowedAppUrl,
  isAllowedExternalUrl,
  isPermissionAllowed,
} = require('../lib/security')

let failures = 0

function check (name, actual, expected) {
  if (actual === expected) return
  failures += 1
  console.error(`[permissions] FAIL: ${name} → 期望 ${expected}，实际 ${actual}`)
}

// ── 应用内导航（白名单域名 + https）────────────────────────────────
check('https://web.oopz.cn 应允许', isAllowedAppUrl('https://web.oopz.cn'), true)
check('子路径/参数/哈希应允许', isAllowedAppUrl('https://web.oopz.cn/room/123?a=1#b'), true)
check('apex 域应允许', isAllowedAppUrl('https://oopz.cn/'), true)
check('http 应拒绝', isAllowedAppUrl('http://web.oopz.cn'), false)
check('后缀欺骗应拒绝', isAllowedAppUrl('https://web.oopz.cn.evil.com'), false)
check('前缀欺骗应拒绝', isAllowedAppUrl('https://evil.com/?web.oopz.cn'), false)
check('file: 应拒绝', isAllowedAppUrl('file:///Users/x/offline.html'), false)
check('javascript: 应拒绝', isAllowedAppUrl('javascript:alert(1)'), false)
check('空值应拒绝', isAllowedAppUrl(''), false)

// ── 外链协议白名单 ────────────────────────────────────────────────
check('https 外链应允许', isAllowedExternalUrl('https://example.com/a'), true)
check('mailto 应允许', isAllowedExternalUrl('mailto:a@b.com'), true)
check('tel 应允许', isAllowedExternalUrl('tel:+8610000'), true)
check('file: 应拒绝', isAllowedExternalUrl('file:///etc/passwd'), false)
check('smb: 应拒绝', isAllowedExternalUrl('smb://host/share'), false)
check('javascript: 应拒绝', isAllowedExternalUrl('javascript:alert(1)'), false)
check('自定义 scheme 应拒绝', isAllowedExternalUrl('oopz://room/1'), false)

// ── 权限矩阵：可信来源按需放行 ────────────────────────────────────
const TRUSTED_ORIGINS = ['https://web.oopz.cn', 'https://oopz.cn', 'https://web.oopz.cn/room/1']
const GRANTED = [
  'media',
  'display-capture',
  'speaker-selection',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
]
for (const origin of TRUSTED_ORIGINS) {
  for (const permission of GRANTED) {
    check(`${permission} @ ${origin} 应允许`, isPermissionAllowed(permission, origin), true)
  }
}

// ── 权限矩阵：其余权限一律拒绝 ────────────────────────────────────
const DENIED_PERMISSIONS = [
  'geolocation',
  'usb',
  'hid',
  'serial',
  'midi',
  'midiSysex',
  'clipboard-read',
  'openExternal',
  'payment-handler',
  'pointerLock',
  'idle-detection',
  'persistent-storage',
  'storage-access',
  'unknown',
]
for (const permission of DENIED_PERMISSIONS) {
  check(`${permission} @ 可信来源应拒绝`, isPermissionAllowed(permission, 'https://web.oopz.cn'), false)
}

// ── 权限矩阵：不可信来源全部拒绝 ──────────────────────────────────
const UNTRUSTED_ORIGINS = [
  'https://evil.com',
  'http://web.oopz.cn',
  'https://web.oopz.cn.evil.com',
  'https://evil.com/?web.oopz.cn',
  'file:///Users/x/offline.html',
  '',
  undefined,
  'null',
]
for (const origin of UNTRUSTED_ORIGINS) {
  for (const permission of GRANTED) {
    check(`${permission} @ ${String(origin)} 应拒绝`, isPermissionAllowed(permission, origin), false)
  }
}

if (failures > 0) {
  console.error(`[permissions] ${failures} 个断言失败`)
  process.exit(1)
}

console.log('[permissions] PASS: URL 白名单与权限矩阵断言全部通过')
