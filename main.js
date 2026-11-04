'use strict'

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, session, Notification, screen, dialog, desktopCapturer } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const { isAllowedAppUrl, isAllowedExternalUrl, isPermissionAllowed } = require('./lib/security')

// ── 常量 ───────────────────────────────────────────────────────────────
const APP_URL = 'https://web.oopz.cn'
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'trayTemplate.png')
const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png')
const OFFLINE_PAGE_PATH = path.join(__dirname, 'offline.html')

// 窗口状态文件路径必须在 app ready 之后才能求值（app.getPath 未就绪时返回错误路径）
let windowStatePath = null

// ── 全局变量 ────────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let loadTimeout = null
let saveDebounce = null
// 离线页文件本身损坏/漏打包时置位，防止 loadFile → loadURL → did-fail-load 无限循环
let offlinePageBroken = false
const MAX_RENDERER_RETRIES = 3
// 崩溃计数窗口：60 秒内的崩溃才累计，避免「加载成功一次就归零」导致上限失效
const CRASH_WINDOW_MS = 60000
let rendererCrashTimestamps = []

// ── 窗口状态持久化 ──────────────────────────────────────────────────────
function loadWindowState () {
  const fallback = { width: 1280, height: 820, x: undefined, y: undefined }
  if (!windowStatePath) return fallback
  try {
    if (fs.existsSync(windowStatePath)) {
      const data = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'))
      if (data.width >= 400 && data.height >= 300) {
        // 校验坐标是否仍在当前显示器范围内：多屏断开后旧坐标会指向屏幕外
        if (Number.isFinite(data.x) && Number.isFinite(data.y)) {
          const onScreen = screen.getAllDisplays().some(d => {
            const b = d.bounds
            return data.x >= b.x && data.y >= b.y &&
                   data.x + data.width <= b.x + b.width &&
                   data.y + data.height <= b.y + b.height
          })
          if (!onScreen) {
            data.x = undefined
            data.y = undefined
          }
        }
        return data
      }
    }
  } catch { /* ignore */ }
  return fallback
}

function saveWindowState () {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!windowStatePath) return
  try {
    const bounds = mainWindow.getBounds()
    // userData 目录可能已被用户或系统清理，写入前确保存在
    fs.mkdirSync(path.dirname(windowStatePath), { recursive: true })
    fs.writeFileSync(windowStatePath, JSON.stringify(bounds), 'utf8')
  } catch { /* ignore */ }
}

function scheduleSaveWindowState () {
  clearTimeout(saveDebounce)
  saveDebounce = setTimeout(saveWindowState, 500)
}


// ── URL / Origin 安全校验 ──────────────────────────────────────────────
// 判定逻辑在 lib/security.js（纯函数，scripts/check-permissions.js 有对应断言）
function safeOpenExternal (url) {
  if (!isAllowedExternalUrl(url)) {
    console.warn('[navigation] blocked external URL:', url)
    return
  }
  shell.openExternal(url).catch(err => {
    console.error('[navigation] failed to open external URL:', err.message)
  })
}

// ── 权限策略 ───────────────────────────────────────────────────────────
// 默认拒绝：只有 lib/security.js 里 GRANTED_PERMISSIONS 列出的权限，
// 且来源是可信域（https + web.oopz.cn / oopz.cn）时才放行。
// 硬件本身仍由 macOS TCC 把关，Electron 这里只是 Chromium 层的开关。
function resolveRequestOrigin (webContents, details = {}, fallbackOrigin) {
  return details.securityOrigin ||
    fallbackOrigin ||
    details.requestingUrl ||
    (webContents && webContents.getURL()) ||
    ''
}

function setupPermissions () {
  const ses = session.fromPartition('persist:oopz')

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = resolveRequestOrigin(webContents, details)
    const granted = isPermissionAllowed(permission, origin)
    if (!granted) console.warn('[permission] denied:', permission, origin)
    callback(granted)
  })

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const origin = resolveRequestOrigin(webContents, details, requestingOrigin)
    return isPermissionAllowed(permission, origin)
  })

  // 屏幕共享：Chromium 只会在 display-capture 权限放行后走到这里。
  // macOS 15+ 用系统自带选择器（useSystemPicker），此时 handler 不会被调用；
  // 更早的系统没有选择器 API，退回共享主屏——比完全不可用要好，
  // 后续如果要让用户选窗口，需要自己做选择器 UI。
  ses.setDisplayMediaRequestHandler((request, callback) => {
    try {
      // securityOrigin 是首选来源；frame 可能已经被销毁（为 null），只做兜底
      const origin = request.securityOrigin || (request.frame ? request.frame.url : '')
      if (!isAllowedAppUrl(origin)) {
        console.warn('[display-media] blocked:', origin)
        callback(null)
        return
      }

      desktopCapturer.getSources({ types: ['screen'] })
        .then(sources => {
          if (!sources || sources.length === 0) {
            callback(null)
            return
          }
          callback({ video: sources[0] })
        })
        .catch(err => {
          console.error('[display-media] getSources failed:', err.message)
          callback(null)
        })
    } catch (err) {
      console.error('[display-media] handler error:', err.message)
      try { callback(null) } catch { /* ignore */ }
    }
  }, { useSystemPicker: true })
}

// ── 离线提示页 ─────────────────────────────────────────────────────────
// 用真实的 file:// 页面而非 data: URL：避免超长 URL、CSP 限制，
// 且重试导航能被 will-navigate 正常放行。
// 重试目标固定为 offline.html 内的常量（APP_URL），不通过 query 注入：
// 把窗口位置数据当跳转目标会构成 DOM XSS / 开放重定向
// （CodeQL js/xss、js/client-side-unvalidated-url-redirection）
function showOfflinePage () {
  if (!mainWindow || mainWindow.isDestroyed()) return

  // 离线页本身不可用（漏打包 / 文件损坏）时，兜底的 loadURL 失败会再次触发
  // did-fail-load → showOfflinePage，形成无上限的导航循环。
  // 一旦确认离线页打不开就永久停手，让 Chromium 的错误页留在窗口里。
  if (offlinePageBroken) return

  mainWindow.loadFile(OFFLINE_PAGE_PATH).catch(err => {
    offlinePageBroken = true
    // loadFile 加载 file:// 失败时不会触发 did-fail-load，这里是唯一兜底。
    // 退回到主域名，至少让 Chromium 渲染自带的错误页而不是纯白屏。
    console.error('[offline] failed to load offline page:', err.message)
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.loadURL(APP_URL).catch(() => {})
  })
}

// ── 解析 title 中的未读数，设置 Dock 徽标 ─────────────────────────
function updateDockBadge (title) {
  if (!app.dock) return
  // 同时兼容半角 (3) [12+] 与全角 （3） 【12+】
  const match = title.match(/[(（[【]\s*(\d+\+?)\s*[)）\]】]/)
  if (match) {
    app.dock.setBadge(match[1])
  } else {
    app.dock.setBadge('')
  }
}

// ── 单实例锁 ────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ── 生产环境菜单：屏蔽 Electron 默认菜单（DevTools / Reload / 品牌标识）──
function setupApplicationMenu () {
  if (process.env.NODE_ENV === 'development') return

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Oopz',
      submenu: [
        { role: 'about', label: '关于 Oopz' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Oopz' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Oopz' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' }
      ]
    }
  ]))
}

// ── 创建主窗口 ─────────────────────────────────────────────────────────
function createWindow () {
  const savedBounds = loadWindowState()

  mainWindow = new BrowserWindow({
    ...savedBounds,
    minWidth: 800,
    minHeight: 600,
    title: 'Oopz',
    icon: APP_ICON_PATH,
    titleBarStyle: 'default',
    webPreferences: {
      partition: 'persist:oopz',
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    show: false,
  })

  // loadURL 返回 Promise，失败时（如断网）会产生未捕获 rejection
  mainWindow.loadURL(APP_URL).catch(err => {
    console.error('[load] loadURL rejected:', err.message)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 加载超过 8 秒仍未完成：强制显示窗口
  loadTimeout = setTimeout(() => {
    loadTimeout = null
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 8000)
  mainWindow.webContents.once('did-finish-load', () => {
    clearTimeout(loadTimeout)
    loadTimeout = null
  })

  // 点击关闭按钮 → 最小化到托盘，Dock 图标保留
  mainWindow.on('close', (event) => {
    saveWindowState()
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  // 窗口销毁时清理防抖句柄，避免下次重建窗口时误触发
  mainWindow.on('closed', () => {
    clearTimeout(saveDebounce)
    saveDebounce = null
    mainWindow = null
  })

  // 窗口大小/位置变化时实时保存（防抖）
  mainWindow.on('resize', scheduleSaveWindowState)
  mainWindow.on('move', scheduleSaveWindowState)

  // 页面标题变化 → 更新 Dock 徽标（未读消息数）
  mainWindow.webContents.on('page-title-updated', (event, title) => {
    updateDockBadge(title)
  })

  // 加载失败（断网等）→ 显示离线提示页。
  // did-fail-load 对子 frame 也会触发，只有主文档失败才代表「这一页没加载出来」；
  // 用 isMainFrame 过滤，顺便避免子 frame 失败时提前清掉 8 秒兜底计时器。
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return

    clearTimeout(loadTimeout)
    loadTimeout = null

    // 主窗口可能已经在退出流程里被销毁
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (event.sender !== mainWindow.webContents) return
    // -3 = ERR_ABORTED：被新的导航顶掉（例如切到离线页），不是真的失败
    if (errorCode === -3) return

    console.error('[load] failed:', errorCode, errorDescription, validatedURL)
    showOfflinePage()
  })

  // 渲染进程崩溃 → 自动恢复（避免白屏卡死，限制重试次数防止无限循环）
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer-gone]', details.reason)

    // 只统计 CRASH_WINDOW_MS 时间窗内的崩溃。
    // 旧逻辑在 did-finish-load 时归零，但崩溃后 reload 也会触发该事件，
    // 导致计数器永远清零、MAX_RENDERER_RETRIES 形同虚设。
    const now = Date.now()
    rendererCrashTimestamps = rendererCrashTimestamps.filter(t => now - t < CRASH_WINDOW_MS)
    rendererCrashTimestamps.push(now)

    if (rendererCrashTimestamps.length > MAX_RENDERER_RETRIES) {
      console.error('[renderer-gone] 达到最大重试次数，停止恢复')
      rendererCrashTimestamps = []
      showOfflinePage()
      return
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  })

  // 外部链接在系统浏览器中打开，所有 window.open() 统一拒绝（保持单窗口）
  //
  // 白名单域名必须留在 app 内：踢到 Safari 会丢失登录态，
  // 且 WebRTC 麦克风权限在浏览器里需要重新授权。
  // 代价是当前页面被替换（无法后退），这是单窗口设计的固有取舍。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppUrl(url) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(url).catch(err => {
        console.error('[navigation] in-app loadURL failed:', err.message)
      })
    } else {
      safeOpenExternal(url)
    }
    return { action: 'deny' }
  })

  // 页面内导航限制在 Oopz 可信域名；外部 http(s) 链接交给系统浏览器
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppUrl(url)) return
    event.preventDefault()
    safeOpenExternal(url)
  })
}

// ── 创建系统托盘 ────────────────────────────────────────────────────────
function createTray () {
  // Electron 的 nativeImage.createFromPath 会自动加载同目录的 @2x 文件
  // （trayTemplate.png ↔ trayTemplate@2x.png），无需手动 addRepresentation。
  // 但「自动模板图」依赖文件名以 Template 结尾——打包后资源名可能被哈希化，
  // 所以仍要显式 setTemplateImage(true)，否则深色模式下图标不可见。
  let icon
  try {
    icon = nativeImage.createFromPath(TRAY_ICON_PATH)
    if (icon.isEmpty()) throw new Error('tray icon empty')
    icon.setTemplateImage(true)
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Oopz')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 Oopz',
      click () { showWindow() }
    },
    { type: 'separator' },
    {
      label: '退出',
      click () {
        app.isQuitting = true
        app.quit()
      }
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showWindow()
    }
  })
}

// ── 自动更新 ──────────────────────────────────────────────────────────
function setupAutoUpdater () {
  if (process.env.NODE_ENV === 'development') return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    const notif = new Notification({
      title: 'Oopz 更新已就绪',
      body: `版本 ${info.version} 已下载完成，点击重启以更新`,
      silent: true
    })
    notif.on('click', () => { autoUpdater.quitAndInstall() })
    notif.show()
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-updater]', err.message)
  })

  // 启动后延迟检查，避免影响首次加载
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 10000)
}
// ── 文件下载处理 ──────────────────────────────────────────────────────
function setupDownloadHandler () {
  const ses = session.fromPartition('persist:oopz')
  ses.on('will-download', (_event, item) => {
    // 只保留文件名部分：远端 Content-Disposition 里的 filename 理论上可能带路径分隔符
    const rawName = path.basename(item.getFilename() || '')
    const defaultPath = rawName && rawName !== '.' && rawName !== '..' ? rawName : 'download'
    const options = { defaultPath, buttonLabel: '保存' }
    let savePath = defaultPath

    item.pause()
    item.on('done', (_event, state) => {
      if (state === 'completed') {
        console.log('[download] 完成:', savePath)
      } else if (state !== 'cancelled') {
        console.error('[download] 失败:', state)
      }
    })

    // 主窗口可能已销毁/正在退出：不能把失效的窗口当父窗口传进去
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    let pending
    try {
      pending = parent
        ? dialog.showSaveDialog(parent, options)
        : dialog.showSaveDialog(options)
    } catch (err) {
      console.error('[download] 保存对话框打开失败:', err.message)
      item.cancel()
      return
    }

    pending.then(({ canceled, filePath }) => {
      if (canceled || !filePath) {
        item.cancel()
        return
      }
      savePath = filePath
      item.setSavePath(filePath)
      item.resume()
    }).catch((err) => {
      console.error('[download] 保存对话框失败:', err.message)
      item.cancel()
    })
  })
}
// ── 工具函数 ────────────────────────────────────────────────────────────
function showWindow () {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (app.dock) app.dock.show()
}

// ── 应用事件 ────────────────────────────────────────────────────────────
// 只有拿到单实例锁的进程才初始化：第二实例已经调了 app.quit()，
// 如果继续注册 whenReady，可能在退出前短暂创建窗口/托盘
if (gotLock) {
  app.whenReady().then(() => {
    // app.getPath 必须在 ready 之后调用
    windowStatePath = path.join(app.getPath('userData'), 'window-state.json')

    setupPermissions()
    setupApplicationMenu()
    setupAutoUpdater()
    setupDownloadHandler()
    createWindow()
    createTray()
    app.on('activate', () => { showWindow() })
  })
}

app.on('window-all-closed', () => {
  // 不退出，靠托盘维持运行
})

app.on('before-quit', () => {
  app.isQuitting = true
  saveWindowState()
})
