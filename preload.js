'use strict'

// preload.js — 在渲染进程启动前注入
// 目前仅做安全隔离用途，保留扩展空间

// 如需向网页暴露原生能力，在此通过 contextBridge 安全注入
// 示例：
// const { contextBridge, ipcRenderer } = require('electron')
// contextBridge.exposeInMainWorld('electronAPI', {
//   showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body })
// })
