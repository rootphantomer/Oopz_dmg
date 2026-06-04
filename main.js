'use strict'

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, session, systemPreferences } = require('electron')
const path = require('path')

// ── 常量 ───────────────────────────────────────────────────────────────
const APP_URL = 'https://web.oopz.cn'
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'trayTemplate.png')
const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png')

// ── 全局变量 ────────────────────────────────────────────────────────────
let mainWindow = null
let tray = null

// ── 媒体权限：自动授权麦克风和摄像头 ────────────────────────────────────
// macOS 首次需要系统级授权，之后会记住选择
function setupMediaPermissions () {
  // 在 app ready 之前，通过 session 预授权媒体设备
  const ses = session.fromPartition('persist:oopz')

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'audioCapture', 'videoCapture']
    if (allowed.includes(permission)) {
      callback(true)
    } else {
      callback(false)
    }
  })

  // 处理权限检查（某些网站会先 check 再 request）
  ses.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'mediaKeySystem', 'audioCapture', 'videoCapture']
    return allowed.includes(permission)
  })
}

// macOS：提前请求系统级麦克风权限（首次会弹系统弹窗）
function requestSystemMediaAccess () {
  if (process.platform === 'darwin') {
    // 请求麦克风权限
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      systemPreferences.askForMediaAccess('microphone')
    }
    // 请求摄像头权限
    const camStatus = systemPreferences.getMediaAccessStatus('camera')
    if (camStatus === 'not-determined') {
      systemPreferences.askForMediaAccess('camera')
    }
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'Oopz',
    icon: APP_ICON_PATH,
    // 标准 macOS 原生标题栏
    titleBarStyle: 'default',
    webPreferences: {
      // 使用持久化 session，保持登录状态
      partition: 'persist:oopz',
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 允许网页内的弹窗/跳转
      nativeWindowOpen: true,
    },
    show: false, // 先隐藏，ready-to-show 后显示（避免白屏闪烁）
  })

  // 加载目标网址
  mainWindow.loadURL(APP_URL)

  // 窗口准备好后再显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 点击关闭按钮 → 最小化到托盘（不退出）
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      // macOS：隐藏 Dock 图标（可选，让 App 更「原生托盘」）
      // app.dock.hide()
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
    // macOS 使用 Template 图标（黑白自动适配深/浅色模式）
    icon = nativeImage.createFromPath(TRAY_ICON_PATH)
    if (icon.isEmpty()) throw new Error('tray icon empty')
  } catch {
    // 备用：用空的 16x16 图像
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Oopz')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 Oopz',
      click () {
        showWindow()
      },
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

  // 左键点击托盘图标：切换窗口显示/隐藏
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
  // 设置媒体权限自动授权（必须在窗口创建前）
  setupMediaPermissions()

  // macOS：首次启动时请求系统级麦克风/摄像头权限
  requestSystemMediaAccess()

  createWindow()
  createTray()

  // macOS：点击 Dock 图标时重新显示窗口
  app.on('activate', () => {
    showWindow()
  })
})

// macOS：所有窗口关闭时不退出（靠托盘维持运行）
app.on('window-all-closed', (event) => {
  // 不调用 app.quit()，保持后台运行
})

app.on('before-quit', () => {
  app.isQuitting = true
})
