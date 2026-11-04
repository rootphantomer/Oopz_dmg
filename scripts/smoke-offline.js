'use strict'

// 离线页冒烟测试（在 Electron 里跑，不是 Node）：
//   electron scripts/smoke-offline.js
//
// 断言两件事：
//   1. 重试目标来自页面内常量，而不是 window.location.search（CodeQL js/xss
//      与 js/client-side-unvalidated-url-redirection 的回归测试）
//   2. 点击「重新连接」触发的导航目标是可信域名

const { app, BrowserWindow } = require('electron')
const path = require('path')

const PAGE = path.join(__dirname, '..', 'offline.html')
const EXPECTED = 'https://web.oopz.cn/'

app.disableHardwareAcceleration()

// 无 GUI 会话的环境里 Electron 可能启动就挂住，避免 CI 一直等 job 超时
const watchdog = setTimeout(() => {
  console.error('[smoke] FAIL: 90s 内未完成（当前环境可能没有 GUI 会话）')
  app.exit(1)
}, 90 * 1000)

function fail (message) {
  clearTimeout(watchdog)
  console.error(`[smoke] FAIL: ${message}`)
  app.exit(1)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  let navTarget = null

  win.webContents.on('will-navigate', (event, url) => {
    navTarget = url
    event.preventDefault()
  })

  try {
    // 故意注入恶意 query：页面必须完全忽略它
    await win.loadFile(PAGE, { query: { retry: 'javascript:alert(1)' } })

    const retryUrl = await win.webContents.executeJavaScript('RETRY_URL')
    if (retryUrl !== 'https://web.oopz.cn') {
      return fail(`RETRY_URL 应为常量 https://web.oopz.cn，实际 ${JSON.stringify(retryUrl)}`)
    }

    const readsSearch = await win.webContents.executeJavaScript(
      'document.documentElement.outerHTML.includes("URLSearchParams(window.location.search)")'
    )
    if (readsSearch) {
      return fail('offline.html 仍在读取 window.location.search 作为跳转目标')
    }

    await win.webContents.executeJavaScript("document.getElementById('retryBtn').click()")
    await new Promise(resolve => setTimeout(resolve, 500))

    if (navTarget !== EXPECTED) {
      return fail(`点击重试后导航目标应为 ${EXPECTED}，实际 ${JSON.stringify(navTarget)}`)
    }

    const status = await win.webContents.executeJavaScript(
      "document.getElementById('status').textContent"
    )
    if (status !== '正在连接...') {
      return fail(`状态提示应为「正在连接...」，实际 ${JSON.stringify(status)}`)
    }

    console.log('[smoke] PASS: 离线页忽略外部 retry 参数，重试目标为', navTarget)
    clearTimeout(watchdog)
    app.exit(0)
  } catch (err) {
    console.error('[smoke] ERROR:', err)
    clearTimeout(watchdog)
    app.exit(1)
  }
})
