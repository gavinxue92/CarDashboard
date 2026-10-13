'use strict';
/* 渲染进程 preload（外圈自己的桥，隔离世界）。
 * S0 只暴露账号引导与切号；后续阶段的注入桥属于 <webview> 的 preload（圈一），不在这里。 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  bootstrap: () => ipcRenderer.invoke('shell:bootstrap'),
  switchAccount: id => ipcRenderer.invoke('shell:switch-account', id)
});
