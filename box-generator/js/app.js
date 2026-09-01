/* =============================================================================
 *  app.js — інтерфейс: читає поля, будує геометрію, малює розкрій, віддає файли.
 *  Усе в міліметрах.
 * ========================================================================== */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ==========================================================================
   *  1. ПОЛЯ
   * ====================================================================== */

  var NUM_FIELDS = ['W', 'D', 'H', 't', 'finger', 'kerf', 'fit', 'divX', 'divY'];

  // проміжок між деталями на листі. Досить, щоб різи не зливались і щоб
  // деталі не тримались одна за одну обрізком у 0.2 мм
  var GAP = 3;

  // поле по краях листа: крайні шипи не мусять впиратись у саму межу — інакше
  // їх не роздивитись на прев'ю, та й лист на верстаті ніколи не обрізаний
  // рівно по контуру розкрою
  var MARGIN = 10;

  var DEFAULTS = {
    // fit тут — те, що дасть модель для фанери 4 мм на забивній посадці.
    // Реально його перерахує refreshFit(), це просто щоб поле не було пустим.
    W: 200, D: 150, H: 100, t: 4, finger: 12, kerf: 0.16, fit: -0.025,
    divX: 0, divY: 0,
    dimMode: 'outer', labels: 'preview',
    mat: 'ply4', fitMode: 'press', joint: 'finger',
    faces: { top: true, bottom: true, front: true, back: true, left: true, right: true }
  };

  var FACES = ['top', 'bottom', 'front', 'back', 'left', 'right'];

  var SHAPES = {
    closed: { top: 1, bottom: 1, front: 1, back: 1, left: 1, right: 1 },
    open: { top: 0, bottom: 1, front: 1, back: 1, left: 1, right: 1 }
  };

  /* ------------------------------------------------------------------------
   *  ПРОФІЛІ МАТЕРІАЛУ
   *  t      — НОМІНАЛ. Реальна фанера майже завжди тонша, ніколи не товща,
   *           тому номінал — безпечний бік: стик вийде вільнішим, а не
   *           «деталі не лізуть». Але заміряти все одно треба.
   *  kerf   — типовий різ CO₂ 60–80 Вт, лінза 2″. Товще → ширше й конічніше.
   *  finger — ≈4 товщини. Дрібніший крок = більше зубів = довший різ і зайвий
   *           час верстата, а міцності майже не додає.
   *  fam    — родина матеріалу для розрахунку зазору (див. FIT_MODEL).
   *
   *  Зазору тут НЕМА: він не табличний, а рахується з товщини — і саме тому
   *  перераховується, коли ти вписуєш свою заміряну товщину замість номіналу.
   * --------------------------------------------------------------------- */
  var MATERIALS = {
    ply3: { label: 'Фанера 3 мм', t: 3, kerf: 0.15, finger: 9, fam: 'ply' },
    ply4: { label: 'Фанера 4 мм', t: 4, kerf: 0.16, finger: 12, fam: 'ply' },
    ply6: { label: 'Фанера 6 мм', t: 6, kerf: 0.20, finger: 18, fam: 'ply' },
    ply8: { label: 'Фанера 8 мм', t: 8, kerf: 0.24, finger: 24, fam: 'ply' },
    ply10: { label: 'Фанера 10 мм', t: 10, kerf: 0.28, finger: 30, fam: 'ply' },
    ply12: { label: 'Фанера 12 мм', t: 12, kerf: 0.32, finger: 36, fam: 'ply' },
    hdf3: { label: 'ХДФ / оргаліт 3 мм', t: 3, kerf: 0.13, finger: 9, fam: 'hdf' },
    mdf3: { label: 'МДФ 3 мм', t: 3, kerf: 0.16, finger: 9, fam: 'mdf' },
    acr3: { label: 'Акрил 3 мм', t: 3, kerf: 0.13, finger: 10, fam: 'acr' },
    acr5: { label: 'Акрил 5 мм', t: 5, kerf: 0.16, finger: 15, fam: 'acr' }
  };

  /* ------------------------------------------------------------------------
   *  МОДЕЛЬ ЗАЗОРУ
   *
   *  Зазор не вибирається зі списку, а рахується з двох фізичних причин.
   *
   *  taper — КОНІЧНІСТЬ різу. Промінь сходиться в конус, тому паз знизу вужчий
   *          за паз зверху, і саме це найвужче місце вирішує, чи зайде шип.
   *          Різниця росте з товщиною — тому зазор мусить рости разом з нею.
   *          У фанері до цього додається обвуглений шар на стінках пазу, в
   *          акрилі — оплавлений валик, і він тонший. Це мм зазору на 1 мм
   *          товщини.
   *
   *  crush — ЗМИНАННЯ. Скільки натягу стик прощає, бо матеріал трохи
   *          зминається, а не колеться. Шпон зминається добре, тому фанера
   *          тримає мінус; акрил не зминається взагалі — там натяг це тріщина.
   *
   *  free / tight — наскільки розійтись від забивної в кожен бік. Обидва
   *          залежать від товщини: довший стик треба вільніше, щоб він взагалі
   *          зайшов, а натяг на товстому просто нікуди не подіти — 12 мм
   *          фанери не зминеш, вона розколеться.
   *
   *  kerf у формулу НЕ входить свідомо: його вже компенсує еквідистанта
   *  контуру в geometry.js, точно й до кінця. Врахувати його ще й тут означало
   *  б відняти ширину променя двічі.
   * --------------------------------------------------------------------- */
  var FIT_MODEL = {
    ply: { taper: 0.0075, crush: 0.055, free: 0.10, tight: 0.060, of: 'фанери' },
    mdf: { taper: 0.0065, crush: 0.050, free: 0.10, tight: 0.040, of: 'МДФ' },
    hdf: { taper: 0.0065, crush: 0.050, free: 0.10, tight: 0.040, of: 'ХДФ' },
    acr: { taper: 0.0045, crush: 0.015, free: 0.12, tight: 0.000, of: 'акрилу' }
  };

  var FIT_MODES = { free: 1, press: 1, tight: 1 };

  // яка секція панелі якому генератору належить
  var GEN_OF = { genBox: 'box', genGear: 'gear' };

  var S = {
    gen: '',          // увімкнений генератор; порожньо — поле теж порожнє
    view: 'mech',     // що показує поле в шестернях: механізм чи розкрій
    gsize: 'dia',     // чим задано шестерні: діаметром у мм чи зубами
    dimMode: 'outer',
    labels: 'preview',
    mat: 'ply4',
    fitMode: 'press',
    joint: 'finger',
    zoom: 1,
    autoFit: true
  };

  var lastResult = null, lastSheet = null, lastTrain = null;

  /* ==========================================================================
   *  2. ЧИТАННЯ / ЗАПИС ПОЛІВ
   * ====================================================================== */

  function num(id, def) {
    var v = parseFloat($(id).value);
    return isFinite(v) ? v : def;
  }

  function readParams() {
    var p = {};
    NUM_FIELDS.forEach(function (f) { p[f] = num(f, DEFAULTS[f]); });

    // геометрія все одно обріже перегородки до 0..12 — робимо це тут, щоб
    // цифри в панелі не розходились із тим, що реально ріжеться
    p.divX = Math.max(0, Math.min(12, Math.round(p.divX)));
    p.divY = Math.max(0, Math.min(12, Math.round(p.divY)));

    p.dimMode = S.dimMode;
    p.labels = S.labels;
    p.joint = S.joint;
    p.faces = {};
    FACES.forEach(function (f) {
      p.faces[f] = document.querySelector('[data-face="' + f + '"]').checked;
    });
    return p;
  }

  function writeParams(cfg) {
    NUM_FIELDS.forEach(function (f) {
      if (cfg[f] !== undefined) $(f).value = round(cfg[f], 3);
    });
    if (cfg.faces) {
      FACES.forEach(function (f) {
        var cb = document.querySelector('[data-face="' + f + '"]');
        cb.checked = !!cfg.faces[f];
        cb.parentNode.classList.toggle('on', cb.checked);
      });
    }
    syncShapeSeg();
    if (cfg.dimMode) setSeg('dimSeg', 'dim', (S.dimMode = cfg.dimMode));
    // зі збереженого стану може прилетіти вже неіснуючий режим гравіювання
    S.labels = cfg.labels === 'none' ? 'none' : 'preview';
    setSeg('labelSeg', 'lbl', S.labels);

    S.joint = cfg.joint === 'tslot' ? 'tslot' : 'finger';
    setSeg('jointSeg', 'joint', S.joint);

    // Матеріал і посадка — це ПІДПИС під числами, а не самі числа: значення
    // вже лежать у полях вище. Тому лише відновлюємо, який пункт підсвічений,
    // і нічого не перераховуємо — інакше правки полів руками щоразу зникали б.
    S.mat = cfg.mat !== undefined ? cfg.mat : '';
    S.fitMode = cfg.fitMode !== undefined ? cfg.fitMode : '';
    $('matSel').value = MATERIALS[S.mat] ? S.mat : '';
    setSeg('fitSeg', 'fit', S.fitMode);
    // якщо посадка вибрана — зазор перераховуємо, а не беремо з конфігу: він
    // однозначно виводиться з товщини й матеріалу, тож поле й примітка не
    // можуть розійтись. Своє значення (посадка не вибрана) лишається як є.
    refreshFit();
  }

  function currentConfig() {
    var p = readParams();
    var cfg = {
      dimMode: p.dimMode, labels: p.labels, faces: p.faces,
      mat: S.mat, fitMode: S.fitMode, joint: S.joint
    };
    NUM_FIELDS.forEach(function (f) { cfg[f] = p[f]; });
    return cfg;
  }

  /* ==========================================================================
   *  2a. ПРОФІЛЬ МАТЕРІАЛУ І ТИП ПОСАДКИ
   *
   *  Профіль матеріалу — це кнопка «підстав значення», а не замок. Правки
   *  полів руками його НЕ скидають: ти й далі ріжеш ту саму фанеру, просто
   *  крок шипа чи заміряна товщина в тебе свої. У списку так і лишається
   *  «Фанера 4 мм», хоч у полях уже твої числа. Скинути назад — вибрати той
   *  самий матеріал ще раз.
   * ====================================================================== */

  function fillMatSelect() {
    var sel = $('matSel');
    sel.innerHTML = '';
    var o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = '— свій матеріал —';
    sel.appendChild(o0);
    Object.keys(MATERIALS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = MATERIALS[k].label;
      sel.appendChild(o);
    });
  }

  /** Родина матеріалу для моделі зазору. Без вибраного — рахуємо як фанеру. */
  function fitFam() {
    var m = MATERIALS[S.mat];
    return (m && FIT_MODEL[m.fam]) ? m.fam : 'ply';
  }

  /**
   * Порахувати зазор під заданий характер стику і ЗАМІРЯНУ товщину.
   * Повертає ще й доданки — щоб примітка показувала, звідки взялось число.
   */
  function computeFit(mode, t, fam) {
    var m = FIT_MODEL[fam] || FIT_MODEL.ply;
    t = isFinite(t) && t > 0 ? t : 4;

    var taper = m.taper * t;                             // конічність різу
    var crush = m.crush;                                 // запас на зминання
    var press = taper - crush;

    // довший стик треба вільніше, щоб він узагалі зайшов на всю глибину
    var slack = mode === 'free' ? m.free + 0.006 * t : 0;
    // натяг на товстому нікуди подіти: 12 мм фанери не зминеш, вона розколеться
    var bite = mode === 'tight' ? Math.max(0, m.tight - 0.004 * t) : 0;

    return {
      value: press + slack - bite,
      taper: taper, crush: crush, slack: slack, bite: bite, m: m
    };
  }

  /** Підтягнути товщину, kerf і крок шипа під матеріал; зазор — порахувати. */
  function applyMaterial(key) {
    var m = MATERIALS[key];
    S.mat = m ? key : '';
    $('matSel').value = S.mat;
    if (!m) { refreshFit(); return; }

    $('t').value = m.t;
    $('kerf').value = m.kerf;
    $('finger').value = m.finger;
    applyFitMode(S.fitMode || 'press', true);
    scheduleRender();
    toast(m.label + ': товщина, kerf і крок шипа підставлено, зазор порахований. ' +
      'Заміряй товщину штангенциркулем і впиши свою — номінал майже завжди бреше ' +
      'на 0.1–0.4 мм, і зазор перерахується під неї сам.');
  }

  /** Вибрати характер стику. Саме число рахується, а не береться зі списку. */
  function applyFitMode(mode, silent) {
    if (!FIT_MODES[mode]) return;
    S.fitMode = mode;
    setSeg('fitSeg', 'fit', mode);
    $('fit').value = round(computeFit(mode, num('t', 4), fitFam()).value, 3);
    if (!silent) scheduleRender();
  }

  /**
   * Перерахувати зазор під поточну товщину. Кличеться, коли міняється `t`:
   * саме через це модель і потрібна була — вписав заміряні 3.7 замість
   * номінальних 4.0, і зазор поїхав за ними, а не лишився табличним.
   */
  function refreshFit() {
    if (!FIT_MODES[S.fitMode]) return;
    $('fit').value = round(computeFit(S.fitMode, num('t', 4), fitFam()).value, 3);
  }

  function round(v, d) {
    var m = Math.pow(10, d);
    return Math.round(v * m) / m;
  }

  /**
   * Підсвітити ту швидку форму, якій ЗАРАЗ відповідають стінки. Кнопка мусить
   * показувати стан, а не факт свого натискання: галочки стінок правляться і
   * поодинці, і тоді жодна форма не підсвічена — так і має бути.
   */
  function syncShapeSeg() {
    var found = '';
    Object.keys(SHAPES).forEach(function (k) {
      var same = FACES.every(function (f) {
        return !!SHAPES[k][f] === document.querySelector('[data-face="' + f + '"]').checked;
      });
      if (same && !found) found = k;
    });
    setSeg('quickShape', 'shape', found);
  }

  function setSeg(segId, attr, value) {
    Array.prototype.forEach.call($(segId).children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-' + attr) === value);
    });
  }

  /* ==========================================================================
   *  3. ГОЛОВНИЙ ПРОГІН
   * ====================================================================== */

  var pending = null;
  function scheduleRender() {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(function () { pending = null; render(); });
  }

  /** Підсвітити ту секцію панелі, чий генератор зараз увімкнений. */
  function syncGens() {
    Object.keys(GEN_OF).forEach(function (id) {
      $(id).classList.toggle('open', S.gen === GEN_OF[id]);
    });
  }

  /** Порожнє поле з поясненням, чому воно порожнє. */
  function emptyStage(msg) {
    stopMech();
    lastResult = null;
    lastSheet = null;
    lastTrain = null;
    $('canvas').innerHTML = '<div class="empty">' + msg + '</div>';
    $('sheetInfo').textContent = '';
    $('view3d').innerHTML = '';
    $('viewSeg').classList.add('hidden');
    $('appBox').classList.add('no-aside');
  }

  function render() {
    if (S.gen === 'gear') return renderGears();
    if (S.gen !== 'box') return emptyStage('Вибери генератор у панелі зліва.');

    $('appBox').classList.remove('no-aside');
    $('asideBox').classList.remove('hidden');
    $('asideGear').classList.add('hidden');
    $('viewSeg').classList.add('hidden');
    stopMech();

    var p = readParams();
    var res;
    try {
      res = BoxGeom.build(p);
    } catch (e) {
      showWarnings([{ t: 'err', m: 'Не вдалося побудувати: ' + e.message }]);
      return;
    }
    lastResult = res;

    var items = res.panels.map(function (pan) { return { w: pan.w, h: pan.h, ref: pan }; });
    lastSheet = buildSheet(BoxGeom.layout(items, GAP, MARGIN));

    drawCanvas();
    drawPreview(res);
    drawStats(res, p);
    saveLocal();
  }

  /* ==========================================================================
   *  3b. ГЕНЕРАТОР ШЕСТЕРЕНЬ
   *
   *  Поле показує або сам механізм (шестерні крутяться зчепленими), або
   *  розкрій тих самих деталей. Рахується це з одних параметрів: крутиться
   *  рівно те, що поїде на верстат.
   * ====================================================================== */

  var GEAR_DEFAULTS = {
    gm: 3, gcount: 3, gsizes: [90, 70, 40],
    gbore: 5, gspokes: 5, gangle: 30, gkerf: 0.16, gback: 0.15
  };
  var GEAR_NUM = ['gm', 'gcount', 'gbore', 'gspokes', 'gangle', 'gkerf', 'gback'];
  var MAX_GEARS = 8;

  /**
   * Поле на кожну шестерню. Рядки будуються під поточну кількість, уже
   * введені значення переживають зміну кількості — інакше, додаючи четверту
   * шестерню, довелось би заново набирати три перші.
   */
  function syncGearRows(vals) {
    var box = $('gRows');
    var n = Math.max(1, Math.min(MAX_GEARS, Math.round(num('gcount', GEAR_DEFAULTS.gcount))));
    var cur = vals || gearSizes();
    var dia = S.gsize === 'dia';
    var i, row, input, prev;

    box.innerHTML = '';
    for (i = 0; i < n; i++) {
      prev = isFinite(cur[i]) ? cur[i]
        : (dia ? (isFinite(cur[i - 1]) ? cur[i - 1] : 60) : (isFinite(cur[i - 1]) ? cur[i - 1] : 20));
      row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<label>Шестерня ' + (i + 1) +
        ' <span class="hint">' + (dia ? '⌀ по вершинах, мм' : 'зубів') + '</span></label>';
      input = document.createElement('input');
      input.type = 'number';
      input.className = 'gsize';
      input.min = dia ? 8 : 6;
      input.step = dia ? 1 : 1;
      input.value = round(prev, 2);
      input.addEventListener('input', scheduleRender);
      row.appendChild(input);
      box.appendChild(row);
    }
  }

  /** Те, що зараз вписано в поля шестерень. */
  function gearSizes() {
    return Array.prototype.map.call(document.querySelectorAll('#gRows .gsize'), function (el) {
      return parseFloat(el.value);
    });
  }

  /**
   * Діаметри в міліметрах → кількість зубів.
   *
   * Діаметр тут ЗОВНІШНІЙ — той, що міряється штангенциркулем по вершинах
   * зубів: da = m·(z + 2). Зубів буває тільки ціле число, тому розмір лягає
   * кроком у модуль; скільки вийшло насправді — видно в панелі праворуч.
   */
  function teethFromDia(list, m) {
    return list.map(function (d) { return Math.max(6, Math.round(d / m - 2)); });
  }

  /** Назад: кількість зубів → зовнішній діаметр. */
  function diaFromTeeth(z, m) { return (Math.round(z) + 2) * m; }

  function readGears() {
    var p = {};
    GEAR_NUM.forEach(function (f) { p[f] = num(f, GEAR_DEFAULTS[f]); });
    var raw = gearSizes().filter(function (n) { return isFinite(n) && n > 0; });
    if (!raw.length) raw = S.gsize === 'dia' ? [90] : [24];
    var teeth = S.gsize === 'dia'
      ? teethFromDia(raw, p.gm)
      : raw.map(function (n) { return Math.max(4, Math.min(300, Math.round(n))); });
    return {
      m: p.gm, teeth: teeth, want: raw, bore: p.gbore, spokes: p.gspokes,
      angle: p.gangle, kerf: p.gkerf, backlash: p.gback, alpha: 20
    };
  }

  /**
   * Підібрати модуль під задані діаметри. Перебираємо стандартний ряд і
   * беремо той, на якому діаметри лягають найточніше; за однакової точності
   * — більший модуль, бо зуб міцніший.
   */
  var MODULES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

  function fitModule() {
    var want = gearSizes().filter(function (n) { return isFinite(n) && n > 0; });
    if (!want.length) return toast('Спершу впиши розміри шестерень');
    if (S.gsize !== 'dia') return toast('Підбір модуля працює в режимі «Діаметр, мм»');
    var best = null;
    MODULES.forEach(function (m) {
      var err = 0, tooSmall = false;
      want.forEach(function (d) {
        var z = Math.round(d / m - 2);
        if (z < 8) tooSmall = true;
        err += Math.abs(d - diaFromTeeth(Math.max(8, z), m));
      });
      if (tooSmall && best) return;
      if (!best || err < best.err - 1e-9 || (Math.abs(err - best.err) < 1e-9 && m > best.m)) {
        best = { m: m, err: err };
      }
    });
    $('gm').value = best.m;
    scheduleRender();
    toast('Модуль ' + best.m + ' мм: діаметри лягають із похибкою ' +
      round(best.err / Math.max(1, want.length), 2) + ' мм у середньому.');
  }

  function renderGears() {
    $('appBox').classList.remove('no-aside');
    $('asideBox').classList.add('hidden');
    $('asideGear').classList.remove('hidden');
    $('viewSeg').classList.remove('hidden');

    var p = readGears();
    var tr;
    try {
      tr = BoxGears.train(p);
    } catch (e) {
      showWarnings([{ t: 'err', m: 'Не вдалося побудувати: ' + e.message }], 'gWarns');
      return;
    }
    lastTrain = tr;

    // деталі для розкрою — ті самі контури, тільки без розстановки в передачі
    var items = tr.gears.map(function (g, i) {
      var b = BoxGeom.bbox([g.outline]);
      return {
        w: b.x1 - b.x0, h: b.y1 - b.y0,
        ref: {
          name: 'Z' + g.z, outline: g.outline, holes: g.holes,
          w: b.x1 - b.x0, h: b.y1 - b.y0
        }
      };
    });
    lastSheet = buildSheet(BoxGeom.layout(items, GAP, MARGIN));

    if (S.view === 'cut') { stopMech(); drawCanvas(); }
    else drawMech(tr);

    gearStats(tr, p);
    saveGears();
  }

  function gearStats(tr, p) {
    var g0 = tr.gears[0];
    $('gCount').textContent = tr.gears.length;
    $('gMod').textContent = 'm' + round(p.m, 2);
    $('gSize').textContent = round(tr.box.x1 - tr.box.x0, 1) + ' × ' +
      round(tr.box.y1 - tr.box.y0, 1);

    $('gRatio').textContent = tr.gears.map(function (g) { return g.z; }).join(' : ');
    $('gAxis').textContent = tr.gears.length > 1
      ? tr.gears.slice(1).map(function (g) { return round(g.axis, 1); }).join(' / ') + ' мм'
      : '—';

    // у режимі діаметрів показуємо і замовлений розмір, і той, що вийшов:
    // зубів буває тільки ціле число, тому діаметр лягає кроком у модуль
    var list = $('gList');
    list.innerHTML = '';
    tr.gears.forEach(function (g, i) {
      var want = (S.gsize === 'dia' && p.want && isFinite(p.want[i])) ? p.want[i] : null;
      var row = document.createElement('div');
      row.className = 'stat';
      row.innerHTML = '<span>' + (want !== null ? 'просив ' + round(want, 1) : g.z + ' зубів') +
        '</span><b>⌀' + round(g.da, 1) +
        ' <span class="hint">' + (want !== null ? g.z + ' зуб.' : 'діл. ' + round(g.d, 1)) +
        '</span></b>';
      list.appendChild(row);
    });

    $('gSheet').textContent = lastSheet && lastSheet.parts.length
      ? round(lastSheet.w, 1) + ' × ' + round(lastSheet.h, 1) : '—';
    var cut = 0;
    (lastSheet ? lastSheet.parts : []).forEach(function (part) {
      cut += BoxGeom.polyLength(part.outline);
      part.holes.forEach(function (h) { cut += BoxGeom.polyLength(h); });
    });
    $('gCut').textContent = round(cut / 1000, 2) + ' м';

    var w = tr.warnings.map(function (m) { return { t: 'warn', m: m }; });
    if (!w.length) w.push({ t: 'ok', m: 'Все ок — можна різати.' });
    showWarnings(w, 'gWarns');
  }

  /* ---------- механізм, який крутиться ----------
   * Обертання рахуємо від часу і передатного відношення, а не «на око»:
   * ω кожної наступної = −ω попередньої · z_попередньої / z_цієї. Мінус тут
   * обов'язковий — сусідні шестерні крутяться в різні боки, і саме це робить
   * картинку механізмом.
   */
  var mech = null;

  function stopMech() {
    if (mech && mech.raf) cancelAnimationFrame(mech.raf);
    mech = null;
  }

  function drawMech(tr) {
    stopMech();
    var c = $('canvas');
    c.innerHTML = '';
    if (!tr.gears.length) return;

    var pad = tr.m * 2 + 4;
    var w = (tr.box.x1 - tr.box.x0) + 2 * pad;
    var h = (tr.box.y1 - tr.box.y0) + 2 * pad;
    $('sheetInfo').textContent = round(w - 2 * pad, 1) + ' × ' + round(h - 2 * pad, 1) +
      ' мм · ' + tr.gears.length + ' шт.';

    if (S.autoFit) {
      var avail = c.clientWidth - 44;
      S.zoom = Math.max(0.05, Math.min(4, avail / Math.max(1, w)));
      $('zoomVal').textContent = Math.round(S.zoom * 100) + '%';
    }

    var wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    var svg = el('svg', {
      'class': 'sheet mech',
      viewBox: round(tr.box.x0 - pad, 2) + ' ' + round(tr.box.y0 - pad, 2) + ' ' +
        round(w, 2) + ' ' + round(h, 2),
      width: Math.round(w * S.zoom),
      height: Math.round(h * S.zoom)
    });

    var nodes = tr.gears.map(function (g) {
      var grp = el('g', { 'class': 'gear' });
      var d = BoxExport.polyToPath(g.outline);
      (g.holes || []).forEach(function (hl) { d += ' ' + BoxExport.polyToPath(hl); });
      grp.appendChild(el('path', { d: d, 'class': 'cut', 'fill-rule': 'evenodd' }));
      // вісь — щоб було видно, що шестерня крутиться навколо неї, а не пливе
      grp.appendChild(el('circle', { cx: 0, cy: 0, r: Math.max(0.6, tr.m * 0.22), 'class': 'axle' }));
      svg.appendChild(grp);
      return grp;
    });

    wrap.appendChild(svg);
    c.appendChild(wrap);

    mech = { t0: 0, turns: 0, nodes: nodes, tr: tr, raf: 0, run: S.spin !== false };
    place();
    if (mech.run) tick();

    function place() {
      tr.gears.forEach(function (g, i) {
        var a = BoxGears.angleAt(g, mech.turns) * 180 / Math.PI;
        nodes[i].setAttribute('transform',
          'translate(' + round(g.cx, 3) + ' ' + round(g.cy, 3) + ') rotate(' + round(a, 3) + ')');
      });
    }
    function tick(ts) {
      if (!mech) return;
      if (ts) {
        if (!mech.t0) mech.t0 = ts;
        // 6 секунд на оберт ведучої — видно і зуби, і зчеплення
        mech.turns = (ts - mech.t0) / 6000;
        place();
      }
      mech.raf = requestAnimationFrame(tick);
    }
  }

  var LS_GEARS = 'boxgen.gears.v1';

  function saveGears() {
    var cfg = { gsize: S.gsize, gsizes: gearSizes() };
    GEAR_NUM.forEach(function (f) { cfg[f] = num(f, GEAR_DEFAULTS[f]); });
    try { localStorage.setItem(LS_GEARS, JSON.stringify(cfg)); } catch (e) { }
  }

  function writeGears(cfg) {
    GEAR_NUM.forEach(function (f) {
      if (cfg[f] !== undefined) $(f).value = round(cfg[f], 3);
    });
    S.gsize = cfg.gsize === 'teeth' ? 'teeth' : 'dia';
    setSeg('gSizeSeg', 'gsize', S.gsize);
    syncGearRows(cfg.gsizes && cfg.gsizes.length ? cfg.gsizes : GEAR_DEFAULTS.gsizes);
  }

  /* ==========================================================================
   *  4. ПІДГОТОВКА ЛИСТА
   * ====================================================================== */

  function buildSheet(lay) {
    var parts = lay.placed.map(function (pl) {
      var pan = pl.ref;
      var box = BoxGeom.bbox([pan.outline]);
      var lbl = labelFit(pan.name, pl.w, pl.h);
      return {
        name: pan.name,
        outline: BoxGeom.placePoly(pan.outline, pl, box),
        holes: (pan.holes || []).map(function (h) { return BoxGeom.placePoly(h, pl, box); }),
        cx: pl.x + pl.w / 2,
        cy: pl.y + pl.h / 2,
        realW: pan.w, realH: pan.h,
        rot: pl.rot,
        fs: lbl.fs,
        lrot: lbl.rot
      };
    });
    return { w: lay.w, h: lay.h, parts: parts };
  }

  /**
   * Кегль і поворот підпису так, щоб він гарантовано вліз у деталь.
   * На вузьких деталях текст кладеться вздовж довгої сторони.
   */
  function labelFit(name, w, h) {
    var rot = h > w * 1.3 ? -90 : 0;
    var along = rot ? h : w;         // доступна довжина рядка
    var across = rot ? w : h;        // доступна висота рядка
    var fs = Math.min(across / 3, along * 0.92 / (0.56 * Math.max(1, (name || '').length)), 9);
    return { rot: rot, fs: Math.max(1.5, fs) };
  }

  /* ==========================================================================
   *  5. МАЛЮВАННЯ РОЗКРОЮ
   * ====================================================================== */

  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function drawCanvas() {
    var c = $('canvas');
    c.innerHTML = '';

    var sheet = lastSheet;
    if (!sheet || !sheet.parts.length) {
      $('sheetInfo').textContent = '';
      c.innerHTML = '<div class="empty">Немає що різати — увімкни хоча б кілька стінок.</div>';
      return;
    }

    $('sheetInfo').textContent = round(sheet.w, 1) + ' × ' + round(sheet.h, 1) + ' мм · ' +
      sheet.parts.length + ' дет.';

    if (S.autoFit) {
      var avail = c.clientWidth - 44;
      S.zoom = Math.max(0.05, Math.min(4, avail / Math.max(1, sheet.w)));
      $('zoomVal').textContent = Math.round(S.zoom * 100) + '%';
    }

    var wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';

    var svg = el('svg', {
      'class': 'sheet',
      viewBox: '0 0 ' + sheet.w + ' ' + sheet.h,
      width: Math.round(sheet.w * S.zoom),
      height: Math.round(sheet.h * S.zoom)
    });

    var gCut = el('g', { 'class': 'cutgroup' });
    sheet.parts.forEach(function (part) {
      var d = BoxExport.polyToPath(part.outline);
      part.holes.forEach(function (h) { d += ' ' + BoxExport.polyToPath(h); });
      var path = el('path', { d: d, 'class': 'cut', 'fill-rule': 'evenodd' });
      var title = el('title');
      title.textContent = part.name + ' — ' + round(part.realW, 1) + ' × ' +
        round(part.realH, 1) + (part.rot ? ' (повернуто 90°)' : '');
      path.appendChild(title);
      gCut.appendChild(path);
    });
    svg.appendChild(gCut);

    if (S.labels !== 'none') {
      var gLbl = el('g', { 'class': 'lblgroup' });
      sheet.parts.forEach(function (part) {
        var a = { x: part.cx, y: part.cy, 'class': 'lbl', 'font-size': round(part.fs, 2) };
        if (part.lrot) {
          a.transform = 'rotate(' + part.lrot + ' ' + round(part.cx, 2) + ' ' +
            round(part.cy, 2) + ')';
        }
        var tx = el('text', a);
        tx.textContent = part.name;
        gLbl.appendChild(tx);
      });
      svg.appendChild(gLbl);
    }

    wrap.appendChild(svg);
    c.appendChild(wrap);
  }

  /* ==========================================================================
   *  5b. ПРЕВ'Ю ЗІБРАНОЇ КОРОБКИ
   *
   *  Ізометрія без жодної бібліотеки. Кожна деталь — паралелепіпед, і при
   *  фіксованій камері з нього видно рівно три грані: верх, праву й передню.
   *  Решту навіть не рахуємо.
   *
   *  Глибину вирішує порядок малювання (спершу дальні), а не Z-буфер: деталі
   *  коробки одна одну не протикають, тому цього досить.
   * ====================================================================== */

  var ISO = Math.cos(Math.PI / 6);

  function drawPreview(res) {
    var host = $('view3d');
    host.innerHTML = '';
    var sol = res.solids || [];
    if (!sol.length) return;

    // вісь Y перевертаємо: так до камери повернуті ПЕРЕДНЯ стінка, права і верх
    var Dy = res.dims.D;
    function pr(x, y, z) {
      var yy = Dy - y;
      return [(x - yy) * ISO, (x + yy) * 0.5 - z];
    }

    var faces = [];
    sol.forEach(function (s) {
      // кришку показуємо привидом — інакше вона накриє все, заради чого дивляться
      var ghost = (s.id === 'top' || s.id === 'lid') ? ' ghost' : '';
      function face(cls, pts) {
        var dep = 0;
        var pp = pts.map(function (p) {
          dep += p[0] + (Dy - p[1]) + p[2];
          return pr(p[0], p[1], p[2]);
        });
        faces.push({ cls: cls + ghost, pts: pp, d: dep / pts.length });
      }
      face('f-top', [[s.x0, s.y0, s.z1], [s.x1, s.y0, s.z1], [s.x1, s.y1, s.z1], [s.x0, s.y1, s.z1]]);
      face('f-side', [[s.x1, s.y0, s.z0], [s.x1, s.y1, s.z0], [s.x1, s.y1, s.z1], [s.x1, s.y0, s.z1]]);
      face('f-front', [[s.x0, s.y0, s.z0], [s.x1, s.y0, s.z0], [s.x1, s.y0, s.z1], [s.x0, s.y0, s.z1]]);
    });
    faces.sort(function (a, b) { return a.d - b.d; });

    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    faces.forEach(function (f) {
      f.pts.forEach(function (p) {
        if (p[0] < b.x0) b.x0 = p[0];
        if (p[1] < b.y0) b.y0 = p[1];
        if (p[0] > b.x1) b.x1 = p[0];
        if (p[1] > b.y1) b.y1 = p[1];
      });
    });
    var pad = Math.max(2, (b.x1 - b.x0) * 0.03);
    var svg = el('svg', {
      viewBox: round(b.x0 - pad, 2) + ' ' + round(b.y0 - pad, 2) + ' ' +
        round(b.x1 - b.x0 + 2 * pad, 2) + ' ' + round(b.y1 - b.y0 + 2 * pad, 2)
    });
    faces.forEach(function (f) {
      svg.appendChild(el('polygon', {
        'class': f.cls,
        points: f.pts.map(function (p) {
          return round(p[0], 2) + ',' + round(p[1], 2);
        }).join(' ')
      }));
    });
    host.appendChild(svg);
  }

  /* ==========================================================================
   *  6. ЦИФРИ
   * ====================================================================== */

  function polyArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i++) {
      var q = p[(i + 1) % p.length];
      a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    return Math.abs(a / 2);
  }

  function drawStats(res, p) {
    var d = res.dims, inn = res.inner;

    $('oOuter').textContent = round(d.W, 1) + '×' + round(d.D, 1) + '×' + round(d.H, 1);
    $('oInner').textContent = round(inn.W, 1) + '×' + round(inn.D, 1) + '×' + round(inn.H, 1);
    var litres = (inn.W * inn.D * inn.H) / 1e6;
    $('oVol').textContent = litres < 1 ? round(litres * 1000, 0) + ' мл' : round(litres, 2) + ' л';
    $('oLid').textContent = p.faces.top ? 'на шипах' : 'немає';

    // у Т-стику комірка через одну — язичок, тому й рахуємо язички: у панелі
    // мусить стояти те, що видно на деталі, а не внутрішня одиниця розрахунку
    var tslot = res.joint === 'tslot';
    var cells = [res.fingers.W, res.fingers.D, res.fingers.H];
    $('oFingersLbl').textContent = tslot ? 'Язичків W / D / H' : 'Шипів W / D / H';
    $('oFingers').textContent = cells.map(function (n) {
      return tslot ? (n - 1) / 2 : n;
    }).join(' / ');
    $('oStep').textContent = round(res.fingers.stepW, 1) + ' / ' +
      round(res.fingers.stepD, 1) + ' / ' + round(res.fingers.stepH, 1);

    $('oParts').textContent = res.panels.length;
    $('oSheet').textContent = lastSheet && lastSheet.parts.length
      ? round(lastSheet.w, 1) + ' × ' + round(lastSheet.h, 1)
      : '—';
    $('oCut').textContent = round(res.cutLength / 1000, 2) + ' м';

    // Секції рахуємо по РЕАЛЬНИХ перегородках, а не по полю: геометрія
    // обмежує їх дванадцятьма, і без цього цифри розходились із розкроєм.
    var ndx = res.dividers.x.length, ndy = res.dividers.y.length;
    $('cellCount').textContent = (ndx + 1) * (ndy + 1);
    var cw = (inn.W - ndx * d.t) / (ndx + 1);
    var cd = (inn.D - ndy * d.t) / (ndy + 1);
    $('cellSize').textContent = (cw > 0 && cd > 0)
      ? round(cw, 1) + ' × ' + round(cd, 1) : '—';

    var list = res.warnings.map(function (w) { return { t: 'warn', m: w }; });
    if (ndx > 0 && cw <= d.t * 2) {
      list.push({ t: 'warn', m: 'Секції по ширині вужчі за 2 товщини — перегородок забагато.' });
    }
    if (ndy > 0 && cd <= d.t * 2) {
      list.push({ t: 'warn', m: 'Секції по глибині вужчі за 2 товщини — перегородок забагато.' });
    }
    if (!(p.kerf > 0)) {
      list.push({
        t: 'warn', m: 'Kerf = 0. Деталі вийдуть меншими на ширину променя і будуть ' +
          'теліпатись. Заміряй різ на обрізку і впиши реальне значення.'
      });
    }
    if (!list.length) list.push({ t: 'ok', m: 'Все ок — можна різати.' });
    showWarnings(list);
  }

  function showWarnings(list, boxId) {
    var box = $(boxId || 'warns');
    box.innerHTML = '';
    list.forEach(function (w) {
      var d = document.createElement('div');
      d.className = 'warn-item' + (w.t === 'err' ? ' err' : w.t === 'ok' ? ' ok' : '');
      d.textContent = w.m;
      box.appendChild(d);
    });
  }

  /* ==========================================================================
   *  7. ЕКСПОРТ
   * ====================================================================== */

  function baseName() {
    if (S.gen === 'gear') {
      var g = readGears();
      return 'gears_m' + round(g.m, 2) + '_z' + g.teeth.join('-');
    }
    var d = lastResult ? lastResult.dims : readParams();
    return 'box_' + Math.round(d.W) + 'x' + Math.round(d.D) + 'x' + Math.round(d.H) +
      '_t' + round(d.t, 1);
  }

  function exportFiles(kind) {
    if (!lastSheet || !lastSheet.parts.length) return toast('Нема чого експортувати');
    // у файл ідуть самі різи: підписи лишаються справою прев'ю
    var name = baseName() + (kind === 'dxf' ? '.dxf' : '.svg');
    var text = kind === 'dxf'
      ? BoxExport.dxfString(lastSheet, { labels: false })
      : BoxExport.svgString(lastSheet, { labels: false, title: baseName() });
    BoxExport.download(name, text, kind === 'dxf' ? 'application/dxf' : 'image/svg+xml');
    toast(name + ' збережено');
  }

  /* ==========================================================================
   *  8. ЗБЕРЕЖЕННЯ СТАНУ І ТОСТ
   * ====================================================================== */

  var LS_LAST = 'boxgen.last.v2';

  function saveLocal() {
    try { localStorage.setItem(LS_LAST, JSON.stringify(currentConfig())); } catch (e) { }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4200);
  }

  /* ==========================================================================
   *  9. ПОДІЇ
   * ====================================================================== */

  function bind() {
    NUM_FIELDS.forEach(function (f) {
      $(f).addEventListener('input', scheduleRender);
    });

    // профіль матеріалу — це кнопка «підстав значення», не замок.
    // Правки полів руками його не скидають: ти й далі ріжеш ту саму фанеру,
    // просто крок шипа чи заміряна товщина в тебе свої.
    $('matSel').addEventListener('change', function () { applyMaterial(this.value); });

    // тип посадки
    $('fitSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-fit]');
      if (!b) return;
      applyFitMode(b.getAttribute('data-fit'));
    });
    // ручна правка зазору знімає режим посадки: далі це вже своє число
    $('fit').addEventListener('input', function () {
      S.fitMode = '';
      setSeg('fitSeg', 'fit', '');
    });

    // ЗАМІРЯНА товщина перераховує зазор. Саме тут табличні числа й не канали:
    // вписуєш свої 3.7 замість номінальних 4.0 — а зазор лишався від номіналу.
    $('t').addEventListener('input', refreshFit);

    // тип стику корпусу і кріплення перегородок
    $('jointSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-joint]');
      if (!b) return;
      S.joint = b.getAttribute('data-joint') === 'tslot' ? 'tslot' : 'finger';
      setSeg('jointSeg', 'joint', S.joint);
      scheduleRender();
    });
    // шестерні: усі поля ведуть в один перерахунок
    GEAR_NUM.forEach(function (f) {
      $(f).addEventListener('input', scheduleRender);
    });
    // кількість шестерень — це ще й перебудова самих полів
    $('gcount').addEventListener('input', function () {
      syncGearRows();
      scheduleRender();
    });
    $('gReset').onclick = function () {
      writeGears(GEAR_DEFAULTS);
      scheduleRender();
      toast('Скинуто');
    };
    $('gFit').onclick = fitModule;
    $('gSizeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-gsize]');
      if (!b) return;
      var next = b.getAttribute('data-gsize') === 'teeth' ? 'teeth' : 'dia';
      if (next === S.gsize) return;
      // переводимо те, що вже вписано, у нові одиниці — щоб не набирати заново
      var m = num('gm', GEAR_DEFAULTS.gm), cur = gearSizes();
      var conv = next === 'teeth'
        ? teethFromDia(cur, m)
        : cur.map(function (z) { return round(diaFromTeeth(z, m), 1); });
      S.gsize = next;
      setSeg('gSizeSeg', 'gsize', S.gsize);
      syncGearRows(conv);
      scheduleRender();
    });
    $('viewSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (!b) return;
      S.view = b.getAttribute('data-view') === 'cut' ? 'cut' : 'mech';
      setSeg('viewSeg', 'view', S.view);
      S.autoFit = true;
      scheduleRender();
    });

    // стінки
    document.querySelectorAll('[data-face]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        cb.parentNode.classList.toggle('on', cb.checked);
        syncShapeSeg();
        scheduleRender();
      });
    });

    // швидкі форми
    $('quickShape').addEventListener('click', function (e) {
      var b = e.target.closest('[data-shape]');
      if (!b) return;
      var map = SHAPES[b.getAttribute('data-shape')];
      if (!map) return;
      FACES.forEach(function (f) {
        var cb = document.querySelector('[data-face="' + f + '"]');
        cb.checked = !!map[f];
        cb.parentNode.classList.toggle('on', cb.checked);
      });
      syncShapeSeg();
      scheduleRender();
    });

    // сегменти
    $('dimSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dim]');
      if (!b) return;
      S.dimMode = b.getAttribute('data-dim');
      setSeg('dimSeg', 'dim', S.dimMode);
      scheduleRender();
    });
    $('labelSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-lbl]');
      if (!b) return;
      S.labels = b.getAttribute('data-lbl');
      setSeg('labelSeg', 'lbl', S.labels);
      scheduleRender();
    });

    // масштаб розкрою
    $('zoomIn').onclick = function () {
      S.autoFit = false; S.zoom = Math.min(6, S.zoom * 1.25); redrawZoom();
    };
    $('zoomOut').onclick = function () {
      S.autoFit = false; S.zoom = Math.max(0.05, S.zoom / 1.25); redrawZoom();
    };

    // експорт
    $('btnSvg').onclick = function () { exportFiles('svg'); };
    $('btnDxf').onclick = function () { exportFiles('dxf'); };
    $('btnPrint').onclick = function () { window.print(); };

    /* Шапка генератора вмикає його: розкриває параметри і віддає йому поле.
     * Відкритий завжди один — два розкрої на одному полотні все одно нема як
     * показати, а порожнє поле чесніше за чужу коробку під чужими цифрами. */
    document.querySelectorAll('.gen-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var id = h.parentNode.id;
        S.gen = S.gen === GEN_OF[id] ? '' : GEN_OF[id];
        syncGens();
        render();
      });
    });

    // тема
    $('btnTheme').onclick = function () {
      document.documentElement.classList.toggle('light');
      try { localStorage.setItem('boxgen.theme', document.documentElement.className); } catch (e) { }
    };

    $('btnReset').onclick = function () {
      writeParams(DEFAULTS);
      scheduleRender();
      toast('Скинуто');
    };

    /* Тягання листа лівою кнопкою. Возимо не сам SVG, а прокрутку контейнера:
     * так лист не «відривається» від смуг прокрутки й від колеса, і нічого не
     * треба перемальовувати. */
    var cv = $('canvas'), pan = null;
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      pan = { x: e.clientX, y: e.clientY, sl: cv.scrollLeft, st: cv.scrollTop };
      cv.classList.add('grabbing');
      if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', function (e) {
      if (!pan) return;
      e.preventDefault();
      cv.scrollLeft = pan.sl - (e.clientX - pan.x);
      cv.scrollTop = pan.st - (e.clientY - pan.y);
    });
    // саме lostpointercapture, а не pointerleave: із захопленим вказівником
    // тягнути можна і за межами вікна, і обривати це на виході — тільки бісити
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
      cv.addEventListener(ev, function () {
        pan = null;
        cv.classList.remove('grabbing');
      });
    });

    // масштаб розкрою колесом з Ctrl
    $('canvas').addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      S.autoFit = false;
      S.zoom = Math.max(0.05, Math.min(6, S.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
      redrawZoom();
    }, { passive: false });

    // гарячі клавіші
    window.addEventListener('keydown', function (e) {
      // Ctrl+S ловимо ДО перевірки фокуса: інакше з поля введення він
      // провалювався в браузер і той пропонував зберегти сторінку
      if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        exportFiles('svg');
        return;
      }
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === '0') { S.autoFit = true; scheduleRender(); }
      else if (e.key === '+' || e.key === '=') $('zoomIn').click();
      else if (e.key === '-') $('zoomOut').click();
    });

    window.addEventListener('resize', function () { if (S.autoFit) scheduleRender(); });
  }

  function redrawZoom() {
    $('zoomVal').textContent = Math.round(S.zoom * 100) + '%';
    document.querySelectorAll('svg.sheet').forEach(function (svg) {
      var vb = svg.getAttribute('viewBox').split(' ');
      svg.setAttribute('width', Math.round(parseFloat(vb[2]) * S.zoom));
      svg.setAttribute('height', Math.round(parseFloat(vb[3]) * S.zoom));
    });
  }

  /* ==========================================================================
   *  10. СТАРТ
   * ====================================================================== */

  function init() {
    try {
      var th = localStorage.getItem('boxgen.theme');
      if (th) document.documentElement.className = th;
    } catch (e) { }

    fillMatSelect();
    bind();

    var cfg = null;
    try { cfg = JSON.parse(localStorage.getItem(LS_LAST)); } catch (e) { }
    writeParams(cfg || DEFAULTS);

    var gcfg = null;
    try { gcfg = JSON.parse(localStorage.getItem(LS_GEARS)); } catch (e) { }
    writeGears(gcfg || GEAR_DEFAULTS);

    syncGens();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
