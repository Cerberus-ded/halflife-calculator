/* Сохранение файлов, когда калькулятор открыт как страница на claude.ai.
 * Страница там работает в закрытой рамке: обычные скачивания не проходят, поэтому файлы
 * отдаются через возможность downloads (зритель подтверждает сохранение). app.js вызывает
 * window.HLSaveHook(blob, name, mime) вместо собственного способа сохранения. */
(function () {
  'use strict';
  // Обёртка claude.ai не задаёт язык страницы; без него экранные дикторы читают русский текст английским голосом.
  if (!document.documentElement.lang) document.documentElement.lang = 'ru';
  var ready =(window.claude && typeof window.claude.use === 'function')
    ? Promise.resolve(window.claude.use('downloads')).catch(function () { return null; })
    : Promise.resolve(null);
  // Расширения, которые принимает claude.ai; остальные получают безопасный хвост.
  var ALLOWED = /\.(txt|json|md|csv|xlsx|docx|zip|html|svg|pdf|png)$/i;
  function artifactName(name) {
    if (/\.hlc$/i.test(name)) return name + '.json';      // открывается обратно через «Файл → Открыть»
    if (!ALLOWED.test(name)) return name + '.txt';         // .mpl, .tex, .py — текст формул
    return name;
  }
  var MSG = {
    host_unavailable: 'Это приложение Claude не умеет сохранять файлы. Откройте калькулятор в браузере или на компьютере.',
    rate_limited: 'Предыдущее сохранение ещё не подтверждено. Подтвердите или закройте его и повторите.',
    too_large: 'Файл слишком большой для сохранения отсюда.'
  };
  window.HLSaveHook = function (blob, name) {
    return ready.then(function (dl) {
      if (!dl) throw new Error('Сохранение файлов в этом окне недоступно. Скачайте веб-версию калькулятора (halflife-calc-web.zip) и откройте index.html.');
      return dl.save({ filename: artifactName(name), data: blob }).then(function () { return true; }, function (e) {
        var code = e && e.code;
        if (code === 'declined') return false;
        throw new Error(MSG[code] || 'Сохранение не удалось' + (code ? ' (' + code + ')' : '') + '.');
      });
    });
  };
})();
/* В рамке claude.ai печать недоступна: пункт «Печать протокола» скрывается, протокол сохраняется в Word. */
window.HLNoPrint = true;
