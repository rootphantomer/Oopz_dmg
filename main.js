'use strict'

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, session, systemPreferences } = require('electron')
const path = require('path')
const fs = require('fs')

// ── 常量 ───────────────────────────────────────────────────────────────
const APP_URL = 'https://web.oopz.cn'
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'trayTemplate.png')
const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png')
const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json')

// ── 全局变量 ────────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let loadTimeout = null

// ── 窗口状态持久化 ──────────────────────────────────────────────────────
function loadWindowState () {
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'))
      if (data.width >= 400 && data.height >= 300) {
        return data
      }
    }
  } catch { /* ignore */ }
  return { width: 1280, height: 820, x: undefined, y: undefined }
}

function saveWindowState () {
  if (!mainWindow) return
  try {
    const bounds = mainWindow.getBounds()
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(bounds), 'utf8')
  } catch { /* ignore */ }
}

// ── 离线提示页（内联 HTML，无需额外文件）────────────────────────────
function showOfflinePage () {
  if (!mainWindow) return
  const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Oopz - 离线</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #0f0f0f;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
          user-select: none;
        }
        .icon { font-size: 48px; margin-bottom: 16px; opacity: 0.6; }
        h2 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #ffffff; }
        p { font-size: 13px; color: #8e8e93; margin-bottom: 24px; }
        button {
          padding: 8px 24px;
          background: #007aff;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          transition: background 0.2s;
        }
        button:hover { background: #0056cc; }
        .status { font-size: 12px; color: #ff3b30; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="icon">📡</div>
      <h2>网络已断开</h2>
      <p>请检查网络连接后重试</p>
      <button onclick="retry()">重新连接</button>
      <div class="status" id="status"></div>
      <script>
        function retry() {
          document.getElementById('status').textContent = '正在连接...';
          window.location.href = '${APP_URL}';
        }
        window.addEventListener('online', () => {
          document.getElementById('status').textContent = '网络已恢复，正在重新加载...';
          setTimeout(() => { window.location.href = '${APP_URL}'; }, 800);
        });
      </script>
    </body>
    </html>
  `
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

// ── 媒体权限：自动授权麦克风 ──────────────────────────────────────
function setupMediaPermissions () {
  const ses = session.fromPartition('persist:oopz')

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'audioCapture']
    if (allowed.includes(permission)) {
      callback(true)
    } else {
      callback(false)
    }
  })

  ses.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'mediaKeySystem', 'audioCapture']
    return allowed.includes(permission)
  })
}

// macOS：提前请求系统级麦克风权限（首次会弹系统弹窗）
function requestSystemMediaAccess () {
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      systemPreferences.askForMediaAccess('microphone')
    }
  }
}

// ── 解析 title 中的未读数，设置 Dock 徽标 ─────────────────────────
function updateDockBadge (title) {
  if (!app.dock) return
  const match = title.match(/[\(\[](\d+\+?)[\]\)]/)
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
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
      nativeWindowOpen: true,
    },
    show: false,
  })

  mainWindow.loadURL(APP_URL)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 加载超过 8 秒仍未完成：强制显示窗口
  loadTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 8000)
  mainWindow.webContents.once('did-finish-load', () => {
    clearTimeout(loadTimeout)
  })

  // 点击关闭按钮 → 最小化到托盘，Dock 图标保留
  mainWindow.on('close', (event) => {
    saveWindowState()
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  // 页面标题变化 → 更新 Dock 徽标（未读消息数）
  mainWindow.webContents.on('page-title-updated', (event, title) => {
    updateDockBadge(title)
  })

  // 加载失败（断网等）→ 显示离线提示页
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (event.sender === mainWindow.webContents) {
      showOfflinePage()
    }
  })

  // 外部链接在系统浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('https://web.oopz.cn') && !url.startsWith('https://oopz.cn')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // 页面内导航也限制在 oopz.cn 域名
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('https://web.oopz.cn') || url.startsWith('https://oopz.cn')
    if (!allowed) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
}

// ── 创建系统托盘 ────────────────────────────────────────────────────────
function createTray () {
  let icon
  try {
    icon = nativeImage.createFromPath(TRAY_ICON_PATH)
    if (icon.isEmpty()) throw new Error('tray icon empty')
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Oopz')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 Oopz',
      click () { showWindow() },
    },
    { type: 'separator' },
    {
      label: '退出',
      click () {
        app.isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      showWindow()
    }
  })
}

// ── 工具函数 ────────────────────────────────────────────────────────────
function showWindow () {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
  if (app.dock) app.dock.show()
}

// ── 应用事件 ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  setupMediaPermissions()
  requestSystemMediaAccess()
  createWindow()
  createTray()
  app.on('activate', () => { showWindow() })
})

app.on('window-all-closed', (event) => {
  // 不退出，靠托盘维持运行
})

app.on('before-quit', () => {
  app.isQuitting = true
  saveWindowState()
})
