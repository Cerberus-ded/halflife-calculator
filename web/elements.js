/* Химические элементы: символ, русское название, место в таблице Менделеева.
 * window.HLElements = { list, bySym, pos, symbolOf, parse }.
 *  - list: [{z, sym, ru}] для Z = 1…118;
 *  - pos(z): {row, col}: ряды 1–7 — периоды, 9 — лантаноиды, 10 — актиноиды; колонки 1–18 (у f-блока 3–17);
 *  - symbolOf('цезий' | 'цезия' | 'Cs'): символ или null;
 *  - parse('цезий-137' | '137 цезий' | 'технеций-99м'): {sym, a, meta} — запись в обозначение Cs-137; {sym} — только элемент.
 */
(function (g) {
  'use strict';
  const RAW = 'H Водород|He Гелий|Li Литий|Be Бериллий|B Бор|C Углерод|N Азот|O Кислород|F Фтор|Ne Неон|' +
    'Na Натрий|Mg Магний|Al Алюминий|Si Кремний|P Фосфор|S Сера|Cl Хлор|Ar Аргон|K Калий|Ca Кальций|' +
    'Sc Скандий|Ti Титан|V Ванадий|Cr Хром|Mn Марганец|Fe Железо|Co Кобальт|Ni Никель|Cu Медь|Zn Цинк|' +
    'Ga Галлий|Ge Германий|As Мышьяк|Se Селен|Br Бром|Kr Криптон|Rb Рубидий|Sr Стронций|Y Иттрий|Zr Цирконий|' +
    'Nb Ниобий|Mo Молибден|Tc Технеций|Ru Рутений|Rh Родий|Pd Палладий|Ag Серебро|Cd Кадмий|In Индий|Sn Олово|' +
    'Sb Сурьма|Te Теллур|I Иод|Xe Ксенон|Cs Цезий|Ba Барий|La Лантан|Ce Церий|Pr Празеодим|Nd Неодим|' +
    'Pm Прометий|Sm Самарий|Eu Европий|Gd Гадолиний|Tb Тербий|Dy Диспрозий|Ho Гольмий|Er Эрбий|Tm Тулий|Yb Иттербий|' +
    'Lu Лютеций|Hf Гафний|Ta Тантал|W Вольфрам|Re Рений|Os Осмий|Ir Иридий|Pt Платина|Au Золото|Hg Ртуть|' +
    'Tl Таллий|Pb Свинец|Bi Висмут|Po Полоний|At Астат|Rn Радон|Fr Франций|Ra Радий|Ac Актиний|Th Торий|' +
    'Pa Протактиний|U Уран|Np Нептуний|Pu Плутоний|Am Америций|Cm Кюрий|Bk Берклий|Cf Калифорний|Es Эйнштейний|Fm Фермий|' +
    'Md Менделевий|No Нобелий|Lr Лоуренсий|Rf Резерфордий|Db Дубний|Sg Сиборгий|Bh Борий|Hs Хассий|Mt Мейтнерий|Ds Дармштадтий|' +
    'Rg Рентгений|Cn Коперниций|Nh Нихоний|Fl Флеровий|Mc Московий|Lv Ливерморий|Ts Теннессин|Og Оганесон';
  const list = RAW.split('|').map((s, i) => { const [sym, ru] = s.split(' '); return { z: i + 1, sym, ru }; });
  const bySym = {};
  for (const e of list) bySym[e.sym] = e;

  /** Место в таблице: длинная форма с вынесенными лантаноидами и актиноидами. */
  function pos(z) {
    if (z === 1) return { row: 1, col: 1 };
    if (z === 2) return { row: 1, col: 18 };
    if (z <= 18) { const row = z <= 10 ? 2 : 3, i = z - (row === 2 ? 3 : 11); return { row, col: i < 2 ? i + 1 : i + 11 }; }
    if (z <= 54) { const row = z <= 36 ? 4 : 5; return { row, col: z - (row === 4 ? 18 : 36) }; }
    const row = z <= 86 ? 6 : 7, base = row === 6 ? 54 : 86, i = z - base; // i = 1…32
    if (i <= 2) return { row, col: i };
    if (i <= 17) return { row: row + 3, col: i }; // f-блок: La…Lu, Ac…Lr — колонки 3…17
    return { row, col: i - 14 };
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  /** Название и родительный падеж («активность цезия-137»). */
  function forms(ru) {
    const n = norm(ru), out = [n];
    if (/ий$/.test(n)) out.push(n.slice(0, -2) + 'ия');
    else if (/ец$/.test(n)) out.push(n.slice(0, -2) + 'ца');
    else if (/[оа]$/.test(n)) out.push(n.slice(0, -1) + (n.endsWith('о') ? 'а' : 'ы'));
    else if (/ь$/.test(n)) out.push(n.slice(0, -1) + 'и');
    else out.push(n + 'а');
    return out;
  }
  const byWord = new Map();
  for (const e of list) for (const f of forms(e.ru)) if (!byWord.has(f)) byWord.set(f, e.sym);
  for (const f of forms('Йод')) byWord.set(f, 'I'); // обе записи: иод и йод

  function symbolOf(word) {
    const w = String(word || '').trim();
    if (bySym[w]) return w;
    const cap = w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '';
    if (bySym[cap] && /^[a-z]{1,2}$/i.test(w)) return cap;
    return byWord.get(norm(w)) || null;
  }

  /** Разбор записи с русским названием: «цезий-137», «Цезий 137», «137 цезий», «технеций-99м». */
  function parse(text) {
    const s = String(text || '').trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
    if (/^трити[йя]$/.test(norm(s))) return { sym: 'H', a: 3, meta: '' }; // тритий = H-3
    let m =s.match(/^([A-Za-zА-Яа-яЁё]+)[\s-]*(\d{1,3})\s*([mnмн]?)$/) || null;
    let word, a, meta;
    if (m) { word = m[1]; a = m[2]; meta = m[3]; } else {
      m = s.match(/^(\d{1,3})\s*([mnмн]?)[\s-]*([A-Za-zА-Яа-яЁё]+)$/);
      if (m) { a = m[1]; meta = m[2]; word = m[3]; } else {
        const sym = symbolOf(s);
        return sym ? { sym } : null;
      }
    }
    // «99м» — метастабильное: русская «м» = латинская m
    meta = ({ 'м': 'm', 'н': 'n' })[meta] || meta || '';
    const sym = symbolOf(word);
    return sym ? { sym, a: Number(a), meta } : null;
  }

  g.HLElements = { list, bySym, pos, symbolOf, parse };
})(typeof window !== 'undefined' ? window : globalThis);
