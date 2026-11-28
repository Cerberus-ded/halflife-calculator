/* Мост страницы (web/app.js) с компактной версией для Windows (windows/main_windows.go).
 * Оболочка внедряет этот файл до загрузки страницы. Страница видит его как window.hostBridge,
 * так же как мост Electron (desktop/preload.js), но меню и горячие клавиши остаются на странице (nativeMenu: false).
 * Функции window.hl* оболочка привязывает через WebView2; долгие вызовы (диалоги файлов, загрузка IAEA)
 * отвечают позже через window.__hlDone(id, ok, значение). */
(function () {
  'use strict';
  if (window.hostBridge) return;
  const wait = {};
  let seq = 0;
  window.__hlDone = (id, ok, value) => {
    const w = wait[id];
    if (!w) return;
    delete wait[id];
    if (ok) w.resolve(value); else w.reject(new Error(value || 'Ошибка программы'));
  };
  const call = (fn, ...args) => new Promise((resolve, reject) => {
    const id = ++seq;
    wait[id] = { resolve, reject };
    Promise.resolve().then(() => window[fn](id, ...args)).catch((e) => { delete wait[id]; reject(e); });
  });
  const toB64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (s) => {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  // файл от оболочки: {path, name, text} или {path, name, b64} (Excel) → вид, который ждёт страница
  const fileIn = (f) => (f && f.b64 ? { path: f.path, name: f.name, bytes: fromB64(f.b64) } : f);
  const quiet = (fn, ...args) => { try { const p = window[fn] && window[fn](...args); if (p && p.catch) p.catch(() => {}); } catch (e) { /* оболочка недоступна */ } };

  window.hostBridge = {
    kind: 'webview2',
    nativeMenu: false,
    platform: 'win32',
    /** Состояние документа: заголовок окна. */
    state: (s) => quiet('hlState', s || {}),
    /** Диалог «Открыть»: {path, name, text | bytes} или null. */
    openFile: () => call('hlOpenFile').then(fileIn),
    /** Сохранение: {path?, suggestedName, data: string|Uint8Array, filters} → {path, name} или null. */
    saveFile: (o) => {
      o = o || {};
      const text = typeof o.data === 'string';
      const bytes = text ? null : (o.data instanceof Uint8Array ? o.data : new Uint8Array(o.data || []));
      return call('hlSaveFile', {
        path: o.path || '', suggestedName: String(o.suggestedName || ''), filters: Array.isArray(o.filters) ? o.filters : [],
        text: text ? o.data : '', b64: text ? '' : toB64(bytes), isText: text,
      });
    },
    /** Текст по адресу (только сайт IAEA) — для «Данные → Обновить данные IAEA». */
    fetchText: (url) => call('hlFetchText', String(url)),
    /** Закрыть окно без вопроса (после подтверждения на странице). */
    closeNow: () => quiet('hlCloseNow'),
    /** Страница готова: оболочка передаёт файл, с которым запущена программа. */
    ready: () => quiet('hlReady'),
  };

  // Файл от оболочки (запуск с файлом, перетаскивание на exe, второй запуск программы)
  window.__hlOpen = (f) => {
    const go = () => window.App && window.App.run('openPath', fileIn(f));
    if (window.App) go(); else document.addEventListener('DOMContentLoaded', go);
  };
  // Крестик окна: страница спрашивает про несохранённые изменения и сама закрывает окно (closeNow)
  window.__hlClose = () => {
    quiet('hlCloseAck');
    if (window.App && window.App.run) window.App.run('closeRequest'); else quiet('hlCloseNow');
  };

  // Ссылки на сайты — в системный браузер, а не во всплывающее окно WebView2
  const external = (u) => {
    try {
      const x = new URL(u, location.href);
      return /^https?:$/.test(x.protocol) && x.origin !== location.origin ? x.href : null;
    } catch (e) { return null; }
  };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    const u = a && external(a.getAttribute('href'));
    if (u) { e.preventDefault(); quiet('hlOpenUrl', u); }
  }, true);
  const open0 = window.open;
  window.open = function (u, ...rest) {
    const x = u ? external(String(u)) : null;
    if (x) { quiet('hlOpenUrl', x); return null; }
    return open0.call(window, u, ...rest);
  };
})();
