/* Мост между страницей (web/app.js) и процессом Electron. Страница видит его как window.hostBridge. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostBridge', {
  platform: process.platform,
  /** Состояние документа: {dirty, hasResult, locked, title, name} — для меню и вопроса при закрытии. */
  state: (s) => ipcRenderer.send('state', s),
  /** Список примеров для меню «Примеры»: [{id, title}]. */
  setPresets: (list) => ipcRenderer.send('presets', list),
  /** Команды нативного меню: cb(cmd, arg). */
  onCommand: (cb) => { ipcRenderer.on('cmd', (_e, cmd, arg) => cb(cmd, arg)); },
  /** Диалог «Открыть»: {path, name, text} или null. */
  openFile: () => ipcRenderer.invoke('open-file'),
  /** Сохранение: {path?, suggestedName, data: string|Uint8Array, filters} -> {path, name} или null. */
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  /** Текст по адресу (только сайт IAEA) — для «Данные → Обновить данные IAEA». */
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  /** Закрыть окно без вопроса (после подтверждения на странице). */
  closeNow: () => ipcRenderer.send('close-now'),
});
