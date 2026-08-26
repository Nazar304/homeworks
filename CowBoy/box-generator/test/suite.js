/* =============================================================================
 *  suite.js — перевірка geometry.js.
 *
 *  Дві половини:
 *  1) РЕГРЕСІЯ — проганяє купу конфігурацій і в кожній шукає «зламано взагалі»:
 *     NaN, самоперетини контурів, пази за межами деталі, нульові розміри.
 *     Самоперетин — головний ворог: контур після нього виглядає майже
 *     нормально, а еквідистанта різу видає сміття, і це видно тільки на
 *     різаній фанері.
 *  2) ЗАМІРИ — що числа саме такі, як задумано: фаза шипів у кутку сходиться,
 *     пази в дні стоять точно проти шипів перегородки, kerf зсунув контур у
 *     правильний бік.
 * ========================================================================== */
(function () {
  var G = window.BoxGeom, I = G._internals;
  var lines = [];
  function log(s) { lines.push(s); }

  var fails = 0, checks = 0;
  function ok(cond, msg) {
    checks++;
    if (!cond) { fails++; log('  X ' + msg); } else { log('  . ' + msg); }
  }

  /* ---------- інструменти ---------- */

  function segInt(a, b, c, d) {
    var d1 = [b[0] - a[0], b[1] - a[1]], d2 = [d[0] - c[0], d[1] - c[1]];
    var den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) return false;
    var t = ((c[0] - a[0]) * d2[1] - (c[1] - a[1]) * d2[0]) / den;
    var u = ((c[0] - a[0]) * d1[1] - (c[1] - a[1]) * d1[0]) / den;
    var E = 1e-9;
    return t > E && t < 1 - E && u > E && u < 1 - E;
  }
  function selfIntersects(poly) {
    var n = poly.length;
    for (var i = 0; i < n; i++) {
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (segInt(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return [i, j];
      }
    }
    return null;
  }
  function hasNaN(poly) {
    for (var i = 0; i < poly.length; i++) {
      if (!isFinite(poly[i][0]) || !isFinite(poly[i][1])) return true;
    }
    return false;
  }

  /** Y-координати перетинів вертикалі x=X з контуром, знизу вгору. */
  function vCross(poly, X) {
    var ys = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      if (Math.abs(a[0] - b[0]) < 1e-9) continue;
      if (X <= Math.min(a[0], b[0]) || X >= Math.max(a[0], b[0])) continue;
      ys.push(a[1] + (b[1] - a[1]) * (X - a[0]) / (b[0] - a[0]));
    }
    return ys.sort(function (p, q) { return p - q; });
  }

  /** X-координати перетинів горизонталі y=Y з контуром, злива направо. */
  function hCross(poly, Y) {
    var xs = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      if (Math.abs(a[1] - b[1]) < 1e-9) continue;
      if (Y <= Math.min(a[1], b[1]) || Y >= Math.max(a[1], b[1])) continue;
      xs.push(a[0] + (b[0] - a[0]) * (Y - a[1]) / (b[1] - a[1]));
    }
    return xs.sort(function (p, q) { return p - q; });
  }

  function byId(res, id) {
    return res.panels.filter(function (p) { return p.id === id; })[0];
  }

  var FACES_ALL = { top: 1, bottom: 1, front: 1, back: 1, left: 1, right: 1 };
  var FACES_OPEN = { top: 0, bottom: 1, front: 1, back: 1, left: 1, right: 1 };
  var FACES_TRAY = { top: 0, bottom: 0, front: 1, back: 1, left: 1, right: 1 };

  function merge() {
    var o = {};
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i] || {};
      for (var k in s) o[k] = s[k];
    }
    return o;
  }
  function base(over) {
    return merge({
      W: 200, D: 150, H: 100, t: 4, finger: 12, kerf: 0.16, fit: -0.03,
      dimMode: 'outer', faces: FACES_ALL, divX: 0, divY: 0
    }, over);
  }

  /** Паз не має вилазити за контур деталі (груба перевірка по bbox). */
  function holesInside(pan) {
    var b = G.bbox([pan.outline]), bad = 0;
    pan.holes.forEach(function (h) {
      var hb = G.bbox([h]);
      if (hb.x0 < b.x0 - 0.01 || hb.y0 < b.y0 - 0.01 ||
        hb.x1 > b.x1 + 0.01 || hb.y1 > b.y1 + 0.01) bad++;
    });
    return bad;
  }

  function check(name, p) {
    var res, bad = 0;
    try {
      res = G.build(p);
    } catch (e) {
      checks++; fails++;
      log('X ' + name + ' — ВИКИНУЛО: ' + e.message + '\n' + (e.stack || ''));
      return { panels: [], warnings: [] };
    }
    res.panels.forEach(function (pan) {
      if (hasNaN(pan.outline)) { log('  X ' + name + ': NaN у контурі "' + pan.name + '"'); bad++; }
      if (pan.outline.length < 4) {
        log('  X ' + name + ': контур "' + pan.name + '" має ' + pan.outline.length + ' точок');
        bad++;
      }
      var si = selfIntersects(pan.outline);
      if (si) {
        log('  X ' + name + ': САМОПЕРЕТИН у "' + pan.name + '" (сегменти ' +
          si[0] + '/' + si[1] + ' з ' + pan.outline.length + ')');
        bad++;
      }
      if (!(pan.w > 0) || !(pan.h > 0)) {
        log('  X ' + name + ': "' + pan.name + '" має розмір ' + pan.w + 'x' + pan.h);
        bad++;
      }
      var out = holesInside(pan);
      if (out) {
        log('  X ' + name + ': ' + out + ' паз(ів) вилазить за контур "' + pan.name + '"');
        bad++;
      }
      pan.holes.forEach(function (h, i) {
        if (hasNaN(h)) { log('  X ' + name + ': NaN у пазі ' + i + ' деталі "' + pan.name + '"'); bad++; }
        if (selfIntersects(h)) { log('  X ' + name + ': самоперетин пазу ' + i + ' у "' + pan.name + '"'); bad++; }
      });
    });
    checks++;
    if (bad) fails++;
    log((bad ? 'X ' : 'OK ') + name + ' — ' + res.panels.length + ' дет., різ ' +
      (res.cutLength / 1000).toFixed(2) + ' м, warn ' + res.warnings.length);
    return res;
  }

  /* ======================================================================
   *  1. РЕГРЕСІЯ
   * ================================================================== */
  log('=== 1. Базові конфігурації ===');
  var r = check('закрита коробка', base());
  ok(r.panels.length === 6, 'шість деталей (' + r.panels.length + ')');
  ok(!r.warnings.length, 'без попереджень (' + r.warnings.length + ')');

  check('без кришки', base({ faces: FACES_OPEN }));
  check('лоток без дна й кришки', base({ faces: FACES_TRAY }));
  check('внутрішні габарити', base({ dimMode: 'inner' }));
  check('тільки три стінки', base({ faces: { top: 0, bottom: 1, front: 1, back: 0, left: 1, right: 0 } }));
  check('одна стінка', base({ faces: { top: 0, bottom: 1, front: 0, back: 0, left: 0, right: 0 } }));
  check('без жодної стінки', base({ faces: {} }));
  check('куб 100', base({ W: 100, D: 100, H: 100 }));
  check('крихітна коробка', base({ W: 40, D: 40, H: 30, t: 3, finger: 9 }));
  check('довга й пласка', base({ W: 500, D: 60, H: 25, t: 3, finger: 9 }));
  check('товста фанера 12мм', base({ t: 12, finger: 36, kerf: 0.32, fit: 0.04 }));
  check('тонкий картон 1мм', base({ t: 1, finger: 5, kerf: 0.08, fit: 0 }));
  check('крок шипа 25', base({ finger: 25 }));
  check('крок шипа 1 (дрібніше товщини)', base({ finger: 1 }));
  check('крок шипа 500 (більше габариту)', base({ finger: 500 }));
  check('kerf 0', base({ kerf: 0, fit: 0 }));
  check('kerf великий 0.6', base({ kerf: 0.6 }));
  check('зазор вільний +0.15', base({ fit: 0.15 }));
  check('зазор внатяг -0.08', base({ fit: -0.08 }));

  log('');
  log('=== 2. Перегородки ===');
  r = check('перегородки 2x1', base({ faces: FACES_OPEN, divX: 2, divY: 1 }));
  ok(r.panels.length === 8, 'п`ять стінок + три перегородки (' + r.panels.length + ')');
  ok(r.dividers.x.length === 2 && r.dividers.y.length === 1, 'перегородки порахувались');

  check('перегородки 1x0', base({ faces: FACES_OPEN, divX: 1 }));
  check('перегородки 0x1', base({ faces: FACES_OPEN, divY: 1 }));
  check('перегородки 5x3 дрібні', base({
    W: 260, D: 180, H: 45, t: 3, finger: 9, faces: FACES_OPEN, divX: 5, divY: 3
  }));
  check('перегородки 12x12 (межа)', base({
    W: 400, D: 400, H: 60, t: 3, finger: 9, faces: FACES_OPEN, divX: 12, divY: 12
  }));
  check('перегородки 99 (обріже до 12)', base({ W: 400, D: 400, H: 60, faces: FACES_OPEN, divX: 99 }));
  check('перегородки в лотку без дна', base({ faces: FACES_TRAY, divX: 2, divY: 1 }));
  r = check('перегородки + кришка на шипах', base({ divX: 2, divY: 2 }));
  ok(r.warnings.join('|').indexOf('глухою') >= 0, 'попереджає, що коробка вийде глухою');
  r = check('перегородки без дна', base({ faces: FACES_TRAY, divX: 1 }));
  ok(r.warnings.join('|').indexOf('без дна') >= 0, 'попереджає, що перегородкам нема за що триматись');
  check('перегородки в коробці без боків', base({
    faces: { top: 0, bottom: 1, front: 1, back: 1, left: 0, right: 0 }, divX: 1, divY: 1
  }));

  log('');
  log('=== 2b. Кришка-засувка ===');
  var SL = { type: 'slide', dir: 'front', drop: 4, clear: 0.25, notch: 4, pull: 'ring', pullSize: 16 };

  r = check('засувка спереду', base({ lid: SL }));
  ok(!!r.lid && r.lid.type === 'slide', 'res.lid заповнено');
  ok(r.panels.some(function (p) { return p.kind === 'slidelid'; }), 'деталь кришки-засувки є');
  ok(!r.panels.some(function (p) { return p.id === 'top'; }), 'кришки на шипах немає');
  var slid = r.panels.filter(function (p) { return p.kind === 'slidelid'; })[0];
  ok(slid.holes.length === 1, 'кільце-хват прорізане (' + slid.holes.length + ')');
  ok(Math.abs(slid.w - 200) < 0.6, 'ширина кришки ≈ W: ' + slid.w.toFixed(2));
  ok(Math.abs(slid.h - (150 - 4)) < 0.6, 'глибина ≈ D−t: ' + slid.h.toFixed(2));
  var slF = byId(r, 'front'), slL = byId(r, 'left');
  ok(Math.abs(slF.h - (100 - 8)) < 0.6, 'заїзна стінка знижена до низу кришки: ' + slF.h.toFixed(2));
  ok(Math.abs(slL.h - 100) < 0.6, 'бік лишився на повну висоту: ' + slL.h.toFixed(2));
  ok(Math.abs(r.inner.H - (100 - 8 - 4)) < 0.6,
    'внутрішня висота врахувала засувку: ' + r.inner.H.toFixed(2));

  /* Канал мусить бути НАСКРІЗНИМ прорізом у боці: вертикаль, що йде через
   * нього, перетинає контур чотири рази — знизу, під каналом, над каналом,
   * зверху. Три чи два перетини означали б, що канал десь зімкнувся. */
  var cr = vCross(slL.outline, 75.3);
  log('  вертикаль x=75.3 через ліву стінку: ' + cr.map(function (v) { return v.toFixed(2); }).join(', '));
  ok(cr.length === 4, 'канал наскрізний (перетинів ' + cr.length + ', треба 4)');
  if (cr.length === 4) {
    /* Шлях різу вужчий за готовий канал рівно на (kerf − fit/2): лазер його
     * потім і поверне. Тому очікуємо (t + люфт) − (kerf − fit/2). */
    var want = (4 + 0.25) - (0.16 - (-0.03) / 2);
    ok(Math.abs((cr[2] - cr[1]) - want) < 0.02,
      'ширина шляху різу ' + want.toFixed(3) + ' (готовий канал 4.25), реально ' +
      (cr[2] - cr[1]).toFixed(3));
    ok(slL.h - cr[2] > 3, 'над каналом лишився борт ' + (slL.h - cr[2]).toFixed(2) + ' мм');
    ok(cr[1] > 80, 'канал зверху, а не посередині (ly=' + cr[1].toFixed(1) + ')');

    // на висоті каналу матеріал мусить бути суцільним до стопора
    var xs = hCross(slL.outline, (cr[1] + cr[2]) / 2);
    log('  горизонталь по центру каналу: ' + xs.map(function (v) { return v.toFixed(2); }).join(', '));
    /* На висоті каналу матеріал лишається лише перемичкою між пазом кутового
     * з'єднання (lx≈t) і кінцем каналу (lx≈2t). Саме ця перемичка тримає борт
     * над каналом, і саме через неї заглиблення менше товщини — відламується. */
    ok(xs.length === 2, 'канал не розрізав стінку навпіл (перетинів ' + xs.length + ')');
    ok(xs.length === 2 && Math.abs(xs[1] - 8) < 0.4,
      'канал спиняється за товщину до дальнього кута, lx≈2t=8 (реально ' +
      (xs.length === 2 ? xs[1].toFixed(2) : '?') + ')');
    ok(xs.length === 2 && xs[1] - xs[0] > 3.5,
      'перемичка ≈ товщина: ' + (xs.length === 2 ? (xs[1] - xs[0]).toFixed(2) : '?') + ' мм');
  }

  check('засувка ззаду', base({ lid: merge(SL, { dir: 'back' }) }));
  check('засувка + овальний хват', base({ lid: merge(SL, { pull: 'oval' }) }));
  check('засувка + півкруглий вихват', base({ lid: merge(SL, { pull: 'half', pullSize: 22 }) }));
  check('засувка без хвата й вирізів', base({ lid: merge(SL, { pull: 'none', notch: 0 }) }));
  check('засувка, величезний хват', base({ lid: merge(SL, { pull: 'oval', pullSize: 400 }) }));
  check('засувка, заглиблення 0', base({ lid: merge(SL, { drop: 0 }) }));
  check('засувка, заглиблення 200', base({ lid: merge(SL, { drop: 200 }) }));
  check('засувка, люфт 0', base({ lid: merge(SL, { clear: 0 }) }));
  check('засувка на малій коробці 3мм', base({
    W: 120, D: 90, H: 30, t: 3, finger: 9, lid: merge(SL, { drop: 3, notch: 3, pullSize: 12 })
  }));
  check('засувка на дуже низькій коробці', base({
    W: 120, D: 90, H: 16, t: 3, finger: 9, lid: merge(SL, { drop: 3, notch: 3, pullSize: 10 })
  }));
  check('засувка на дуже вузькій коробці', base({ W: 200, D: 20, H: 60, lid: SL }));
  check('внутрішні габарити + засувка', base({ dimMode: 'inner', lid: SL }));
  check('засувка + лоток без дна', base({
    faces: { top: 1, bottom: 0, front: 1, back: 1, left: 1, right: 1 }, lid: SL
  }));

  r = check('засувка + перегородки 2x2', base({ lid: SL, divX: 2, divY: 2 }));
  ok(Math.abs(r.dividers.height - 92) < 0.6,
    'перегородки знижені під засувку: ' + r.dividers.height.toFixed(1));
  ok(!r.warnings.length, 'із засувкою перегородки більше не роблять коробку глухою (warn ' +
    r.warnings.length + ')');

  r = check('засувка без задньої стінки', base({
    faces: { top: 1, bottom: 1, front: 1, back: 0, left: 1, right: 1 }, lid: SL
  }));
  ok(r.warnings.join('|').indexOf('спинить') >= 0, 'попереджає, що засувка проїде наскрізь');
  r = check('засувка без боків', base({
    faces: { top: 1, bottom: 1, front: 1, back: 1, left: 0, right: 0 }, lid: SL
  }));
  ok(r.warnings.join('|').indexOf('канал') >= 0, 'попереджає, що каналу нема де різати');

  /* ======================================================================
   *  3. ЗАМІРИ: фаза шипів і кутки
   * ================================================================== */
  log('');
  log('=== 3. Кількість комірок ===');
  ok(G.fingerCount(200, 12, 4) % 2 === 1, 'кількість комірок непарна');
  ok(G.fingerCount(10, 0.1, 4) >= 3, 'мінімум три комірки навіть на дрібному ребрі');
  ok(G.fingerCount(60, 4, 20) === 3, 'комірка не буває вужчою за 1.25 товщини (' +
    G.fingerCount(60, 4, 20) + ')');
  var e = I.fingerEdge(90, 3, true, 4);
  ok(e.segs.length === 3, 'ребро з 3 комірок дало 3 ділянки');
  ok(I.offAt(e, 1) === 0 && I.offAt(e, 45) === 4 && I.offAt(e, 89) === 0,
    'шип-паз-шип: 0 / 4 / 0');
  ok(I.tabSegs(e).length === 2, 'два шипи на такому ребрі');
  ok(I.tabSegs(I.plainEdge(90)).length === 0,
    'рівне ребро НЕ віддає шипів (інакше в сусіда з`явився б паз у нікуди)');

  log('');
  log('=== 4. Кутки змикаються ===');
  /* У кутку «перед-ліва» передня стінка стоїть ребром при lx=0, ліва — при
   * lx=D. Обидві мусять давати ОДНАКОВІ висоти переходів шип/паз, інакше в
   * кутку буде щілина або накладання. Скануємо вертикаль усередині смуги
   * з'єднання: вона ріже саме горизонтальні переходи.
   *
   * Міряємо на НОМІНАЛІ (kerf=0, fit=0). На готовому шляху різу шип і паз
   * навмисно розходяться на (kerf − fit/2): лазер це рівно й повертає. Тобто
   * різні координати там — не щілина, а посадка, і порівнювати їх безглуздо. */
  var rc = G.build(base({ faces: FACES_OPEN, kerf: 0, fit: 0 }));
  var fr = byId(rc, 'front'), lf = byId(rc, 'left');

  /* Відкидаємо переходи біля самого низу: вони від СУСІДНЬОГО ребра (виїмка
   * під дно), а не від кутового з'єднання, і в двох деталей стоять у різній
   * фазі за задумом. */
  function steps(pan, X) {
    return vCross(pan.outline, X).filter(function (y) {
      return y > 4.5 && y < 99;
    }).map(function (y) { return +y.toFixed(2); });
  }
  var sFront = steps(fr, 2), sLeft = steps(lf, 150 - 2);
  log('  переходи шип/паз: перед ' + sFront.join(',') + ' | бік ' + sLeft.join(','));
  ok(sFront.length > 0 && sFront.length === sLeft.length,
    'однакова кількість комірок з обох боків кутка (' + sFront.length + '/' + sLeft.length + ')');
  ok(sFront.every(function (v, i) { return Math.abs(v - sLeft[i]) < 0.02; }),
    'висоти переходів збігаються — кут змикається без щілини');

  /* І та сама перевірка з протилежного боку коробки: там фаза інша, і саме
   * непарна кількість комірок робить так, що вона все одно сходиться. */
  var bk = byId(rc, 'back'), rt = byId(rc, 'right');
  var sBack = steps(bk, 2), sRight = steps(rt, 150 - 2);
  ok(sBack.length === sRight.length && sBack.every(function (v, i) {
    return Math.abs(v - sRight[i]) < 0.02;
  }), 'кут «зад-права» теж змикається (' + sBack.length + '/' + sRight.length + ')');

  log('');
  log('=== 5. Компенсація різу ===');
  var r0 = G.build(base({ kerf: 0, fit: 0 }));
  var rk = G.build(base({ kerf: 0.4, fit: 0 }));
  var b0 = G.bbox([byId(r0, 'bottom').outline]);
  var bk = G.bbox([byId(rk, 'bottom').outline]);
  var grew = (bk.x1 - bk.x0) - (b0.x1 - b0.x0);
  ok(Math.abs(grew - 0.4) < 0.01,
    'контур розширився рівно на kerf: ' + grew.toFixed(3) + ' (треба 0.400)');
  var s0 = G.bbox([byId(r0, 'bottom').holes[0] || [[0, 0]]]);
  var divR = G.build(base({ faces: FACES_OPEN, divX: 1, kerf: 0.4, fit: 0 }));
  var div0 = G.build(base({ faces: FACES_OPEN, divX: 1, kerf: 0, fit: 0 }));
  var wSlot = function (res) {
    var h = byId(res, 'bottom').holes[0];
    var bb = G.bbox([h]);
    return bb.x1 - bb.x0;
  };
  ok(Math.abs((wSlot(divR) - wSlot(div0)) + 0.4) < 0.02,
    'паз звузився рівно на kerf: ' + (wSlot(divR) - wSlot(div0)).toFixed(3) + ' (треба −0.400)');
  ok(Math.abs(wSlot(div0) - 4) < 0.01, 'при kerf=0 паз рівно в товщину: ' + wSlot(div0).toFixed(3));

  log('');
  log('=== 6. Пази стоять проти шипів ===');
  /* Найважливіша перевірка перегородок: у дні паз мусить бути точно там, де в
   * перегородки шип. Порівнюємо середини по осі перегородки. */
  var rd = G.build(base({ faces: FACES_OPEN, divX: 1, kerf: 0, fit: 0 }));
  var bot = byId(rd, 'bottom'), dv = byId(rd, 'divX0');
  var xd = rd.dividers.x[0];
  log('  перегородка на X=' + xd.toFixed(1) + ', пазів у дні ' + bot.holes.length);
  ok(bot.holes.length >= 2, 'пазів у дні кілька (' + bot.holes.length + ')');
  var allOnAxis = bot.holes.every(function (h) {
    var bb = G.bbox([h]);
    return Math.abs((bb.x0 + bb.x1) / 2 - xd) < 0.02;
  });
  ok(allOnAxis, 'усі пази дна стоять на осі перегородки');

  // шипи перегородки по нижньому ребру (ly≈0) проти пазів дна по Y
  var tabsY = [];
  dv.holes.length;
  var dvBottomTabs = I.tabSegs(I.fingerEdge(150, rd.fingers.D, false, 4));
  dvBottomTabs.forEach(function (s) { tabsY.push([+s.s0.toFixed(2), +s.s1.toFixed(2)]); });
  var slotsY = bot.holes.map(function (h) {
    var bb = G.bbox([h]);
    return [+bb.y0.toFixed(2), +bb.y1.toFixed(2)];
  }).sort(function (a, b) { return a[0] - b[0]; });
  log('  шипи перегородки: ' + tabsY.map(function (a) { return a.join('..'); }).join('  '));
  log('  пази в дні:       ' + slotsY.map(function (a) { return a.join('..'); }).join('  '));
  ok(tabsY.length === slotsY.length,
    'скільки шипів — стільки й пазів (' + tabsY.length + '/' + slotsY.length + ')');
  ok(tabsY.length === slotsY.length && tabsY.every(function (a, i) {
    return Math.abs(a[0] - slotsY[i][0]) < 0.02 && Math.abs(a[1] - slotsY[i][1]) < 0.02;
  }), 'кожен паз стоїть точно проти свого шипа');

  log('');
  log('=== 7. Напів-переплетення перегородок ===');
  var rx = G.build(base({ faces: FACES_OPEN, divX: 1, divY: 1, kerf: 0, fit: 0 }));
  var dA = byId(rx, 'divX0'), dB = byId(rx, 'divY0');
  var yd = rx.dividers.y[0], xd2 = rx.dividers.x[0];
  // A: виріз ЗВЕРХУ на глибину H/2 у місці перетину (lx = D − Y)
  var cutA = vCross(dA.outline, 150 - yd);
  // B: виріз ЗНИЗУ на ту саму глибину (lx = X)
  var cutB = vCross(dB.outline, xd2);
  log('  A на перетині: ' + cutA.map(function (v) { return v.toFixed(1); }).join(', '));
  log('  B на перетині: ' + cutB.map(function (v) { return v.toFixed(1); }).join(', '));
  ok(cutA.length >= 2 && Math.abs(cutA[cutA.length - 1] - 50) < 0.6,
    'у A матеріал доходить до H/2 — вище виріз (' + cutA[cutA.length - 1].toFixed(1) + ')');
  ok(cutB.length >= 2 && Math.abs(cutB[0] - 50) < 0.6,
    'у B матеріал починається з H/2 — нижче виріз (' + cutB[0].toFixed(1) + ')');

  log('');
  log('=== 8. Розкладка ===');

  /** Скільки пар деталей перекривається (з урахуванням проміжку). */
  function overlaps(lay, gap) {
    var n = 0;
    for (var i = 0; i < lay.placed.length; i++) {
      for (var j = i + 1; j < lay.placed.length; j++) {
        var a = lay.placed[i], b = lay.placed[j];
        if (a.x < b.x + b.w + gap - 0.01 && b.x < a.x + a.w + gap - 0.01 &&
          a.y < b.y + b.h + gap - 0.01 && b.y < a.y + a.h + gap - 0.01) n++;
      }
    }
    return n;
  }
  /** Чи всі деталі всередині листа. */
  function inside(lay) {
    return lay.placed.every(function (e) {
      return e.x >= -0.01 && e.y >= -0.01 &&
        e.x + e.w <= lay.w + 0.01 && e.y + e.h <= lay.h + 0.01;
    });
  }

  var big = G.build(base({ W: 260, D: 180, H: 70, divX: 3, divY: 1, faces: FACES_OPEN }));
  var items = big.panels.map(function (p) { return { w: p.w, h: p.h, ref: p }; });
  var lay = G.layout(items, 3);
  log('  ' + items.length + ' деталей -> лист ' + lay.w.toFixed(1) + ' × ' + lay.h.toFixed(1) +
    ' мм, полиць ' + (function () {
      var ys = {};
      lay.placed.forEach(function (e) { ys[e.y.toFixed(1)] = 1; });
      return Object.keys(ys).length;
    })());
  ok(lay.placed.length === items.length,
    'усі ' + items.length + ' деталей розкладено (' + lay.placed.length + ')');
  ok(overlaps(lay, 3) === 0, 'деталі не перекриваються і тримають проміжок');
  ok(inside(lay), 'усі деталі всередині листа');
  ok(lay.w > 0 && lay.h > 0, 'лист має ненульовий розмір');
  ok(lay.w / lay.h > 0.5 && lay.w / lay.h < 3.5,
    'лист приблизно квадратний, а не смуга (' + (lay.w / lay.h).toFixed(2) + ')');

  // найширша деталь задає мінімальну ширину листа — «не влізти» тут нема куди
  var wide = G.layout([{ w: 5000, h: 20, ref: {} }, { w: 50, h: 50, ref: {} }], 3);
  ok(wide.placed.length === 2, 'величезна деталь усе одно розкладається');
  ok(wide.w >= 5000, 'лист розтягнувся під неї (' + wide.w.toFixed(0) + ')');
  ok(inside(wide), 'і вона всередині листа');

  /* Поле по краях: лист більший рівно на два поля, і жодна деталь у нього не
   * залазить — інакше крайні шипи впиралися б у саму межу листа. */
  var lm = G.layout(items, 3, 10);
  ok(Math.abs(lm.w - (lay.w + 20)) < 0.01 && Math.abs(lm.h - (lay.h + 20)) < 0.01,
    'лист виріс рівно на два поля (' + lm.w.toFixed(1) + '×' + lm.h.toFixed(1) + ')');
  ok(lm.placed.every(function (e) {
    return e.x >= 9.99 && e.y >= 9.99 &&
      e.x + e.w <= lm.w - 9.99 && e.y + e.h <= lm.h - 9.99;
  }), 'жодна деталь не залазить у поле');
  ok(overlaps(lm, 3) === 0, 'із полем деталі так само не перекриваються');

  var one = G.layout([{ w: 100, h: 40, ref: {} }], 3);
  ok(Math.abs(one.w - 100) < 0.01 && Math.abs(one.h - 40) < 0.01,
    'одна деталь — лист рівно по ній (' + one.w + '×' + one.h + ')');

  var empty = G.layout([], 3);
  ok(empty.placed.length === 0 && empty.w === 0, 'порожній список — порожній лист');

  var g0 = G.layout(items, 0);
  ok(g0.placed.length === items.length && overlaps(g0, 0) === 0,
    'з нульовим проміжком теж без накладань');

  // повороти: вертикальні деталі кладуться лежачи
  var rots = G.layout([{ w: 30, h: 200, ref: {} }], 3);
  ok(rots.placed[0].rot === 90 && rots.placed[0].w === 200,
    'висока деталь повернулась на 90° (' + rots.placed[0].rot + ')');

  // розкладка мусить бути стабільною: той самий вхід — той самий лист
  var again = G.layout(items, 3);
  ok(again.w === lay.w && again.h === lay.h &&
    again.placed.every(function (e, i) { return e.x === lay.placed[i].x && e.y === lay.placed[i].y; }),
    'повторний прогін дає той самий результат');

  /* ======================================================================
   *  9. Т-СТИК: язичок крізь площину
   * ================================================================== */
  log('');
  log('=== 9. Т-стик ===');

  function ts(over) { return base(merge({ joint: 'tslot' }, over)); }

  var rts = check('Т-стик, закрита коробка', ts({}));
  ok(rts.panels.length === 6, 'шість деталей (' + rts.panels.length + ')');
  check('Т-стик без кришки', ts({ faces: FACES_OPEN }));
  check('Т-стик, лоток без дна й кришки', ts({ faces: FACES_TRAY }));
  check('Т-стик, три стінки', ts({ faces: { top: 0, bottom: 1, front: 1, back: 0, left: 1, right: 0 } }));
  check('Т-стик, куб 100', ts({ W: 100, D: 100, H: 100 }));
  check('Т-стик, товста фанера 12мм', ts({ t: 12, finger: 36, kerf: 0.32, fit: 0.04 }));
  check('Т-стик, довга й пласка', ts({ W: 500, D: 60, H: 25, t: 3, finger: 9 }));
  check('Т-стик, крок шипа 500', ts({ finger: 500 }));
  check('Т-стик, внутрішні габарити', ts({ dimMode: 'inner' }));

  var rtm = check('Т-стик на крихітній коробці', ts({ W: 40, D: 40, H: 30, t: 6, finger: 18 }));
  ok(rtm.warnings.length > 0, 'попереджає, що втоплення з\'їдає нутро (warn ' +
    rtm.warnings.length + ')');
  var rtt = check('Т-стик на картоні 1мм', ts({ t: 1, finger: 5, kerf: 0.08, fit: 0 }));
  ok(rtt.warnings.join('|').indexOf('перемичка') >= 0, 'попереджає, що перемичка вилетить');

  /* Заміри — на номіналі: kerf і зазор тут тільки заважають порівнювати. */
  var T = G.build(ts({ kerf: 0, fit: 0 }));
  var tBot = byId(T, 'bottom'), tFr = byId(T, 'front'), tLf = byId(T, 'left');

  ok(tBot.outline.length === 4, 'дно лишилось цілим прямокутником (' +
    tBot.outline.length + ' точок, у пальцях їх десятки)');
  ok(Math.abs(tBot.w - 200) < 0.01 && Math.abs(tBot.h - 150) < 0.01,
    'дно рівно W×D — габарит коробки тримає воно: ' + tBot.w + '×' + tBot.h);
  ok(Math.abs(tFr.w - 200) < 0.01, 'передня на всю ширину (' + tFr.w.toFixed(1) + ')');
  ok(Math.abs(tFr.h - 100) < 0.01,
    'язички переду доходять до зовнішніх площин дна й кришки: ' + tFr.h.toFixed(1));
  ok(Math.abs(tLf.w - (150 - 8)) < 0.01,
    'бік коротший на дві товщини — впирається в площини переду й заду: ' + tLf.w.toFixed(1));

  /* Ребро мусить лишитись РІВНИМ між язичками — заради цього все й затівалось.
   * Вертикаль у порожній комірці ріже тіло (H−2t), у язичку — усі H. */
  var tCell = 200 / G.fingerCount(200, 12, 4);
  var tvEmpty = vCross(tFr.outline, tCell * 0.5);        // комірка 0 — порожня
  var tvTab = vCross(tFr.outline, tCell * 1.5);          // комірка 1 — язичок
  log('  передня: у порожній комірці ' + tvEmpty.map(function (v) { return v.toFixed(1); }).join('..') +
    ', у язичку ' + tvTab.map(function (v) { return v.toFixed(1); }).join('..'));
  ok(tvEmpty.length === 2 && Math.abs((tvEmpty[1] - tvEmpty[0]) - 92) < 0.02,
    'між язичками ребро рівне, тіло рівно H−2t');
  ok(tvTab.length === 2 && Math.abs((tvTab[1] - tvTab[0]) - 100) < 0.02,
    'язичок виступає рівно на товщину в кожен бік');

  /* Перемичка: паз НЕ виходить на край приймаючої деталі, інакше замість пазу
   * вийде виріз, і кут перестане бути кутом. */
  var tGap = Math.min.apply(null, tBot.holes.map(function (h) {
    var bb = G.bbox([h]);
    return Math.min(bb.x0, bb.y0, 200 - bb.x1, 150 - bb.y1);
  }));
  ok(Math.abs(tGap - 4) < 0.01, 'перемичка від краю дна рівно в товщину: ' + tGap.toFixed(2));

  var tBands = tBot.holes.every(function (h) {
    var bb = G.bbox([h]);
    return (bb.y0 > 3.99 && bb.y1 < 8.01) || (bb.y0 > 141.99 && bb.y1 < 146.01) ||
      (bb.x0 > 3.99 && bb.x1 < 8.01) || (bb.x0 > 191.99 && bb.x1 < 196.01);
  });
  ok(tBands, 'кожен паз дна стоїть у смузі своєї стінки (' + tBot.holes.length + ' пазів)');

  /* Паз проти язичка — те саме, що для перегородок, але тепер для корпусу. */
  var tTabX = hCross(tFr.outline, -2), tTabs = [];
  for (var ti = 0; ti + 1 < tTabX.length; ti += 2) {
    tTabs.push([+tTabX[ti].toFixed(2), +tTabX[ti + 1].toFixed(2)]);
  }
  var tSlots = tBot.holes.filter(function (h) {
    var bb = G.bbox([h]);
    return bb.y0 > 3.99 && bb.y1 < 8.01;
  }).map(function (h) {
    var bb = G.bbox([h]);
    return [+bb.x0.toFixed(2), +bb.x1.toFixed(2)];
  }).sort(function (a, b) { return a[0] - b[0]; });
  log('  язички переду: ' + tTabs.map(function (a) { return a.join('..'); }).join(' '));
  log('  пази в дні:    ' + tSlots.map(function (a) { return a.join('..'); }).join(' '));
  ok(tTabs.length > 0 && tTabs.length === tSlots.length,
    'скільки язичків — стільки й пазів (' + tTabs.length + '/' + tSlots.length + ')');
  ok(tTabs.length === tSlots.length && tTabs.every(function (a, i) {
    return Math.abs(a[0] - tSlots[i][0]) < 0.02 && Math.abs(a[1] - tSlots[i][1]) < 0.02;
  }), 'кожен паз дна стоїть точно проти свого язичка');

  ok(tFr.holes.length > 0, 'у передній прорізані пази під язички боків (' +
    tFr.holes.length + ')');
  ok(tFr.holes.every(function (h) {
    var bb = G.bbox([h]);
    return (bb.x0 > 3.99 && bb.x1 < 8.01) || (bb.x0 > 191.99 && bb.x1 < 196.01);
  }), 'пази під боки — у смузі бока, з перемичкою від краю передньої');
  ok(!tLf.holes.length, 'бік нічого не приймає — він у цій ієрархії найнижчий');

  ok(Math.abs(T.inner.W - (200 - 16)) < 0.01,
    'нутро вужче на чотири товщини: втоплення + стінка з кожного боку (' +
    T.inner.W.toFixed(1) + ')');
  ok(Math.abs(T.inner.H - (100 - 8)) < 0.01,
    'нутро по висоті — рівно між дном і кришкою (' + T.inner.H.toFixed(1) + ')');

  var Ti = G.build(ts({ dimMode: 'inner', W: 100, D: 100, H: 100, kerf: 0, fit: 0 }));
  ok(Math.abs(Ti.inner.W - 100) < 0.01 && Math.abs(Ti.inner.D - 100) < 0.01,
    'внутрішні габарити: нутро вийшло рівно як просили (' +
    Ti.inner.W.toFixed(1) + '×' + Ti.inner.D.toFixed(1) + ')');

  var Ts = check('Т-стик + засувка', ts({ lid: SL }));
  var tsLid = Ts.panels.filter(function (p) { return p.kind === 'slidelid'; })[0];
  ok(!!tsLid, 'кришка-засувка є і в Т-стику');
  ok(tsLid && Math.abs(tsLid.w - (200 - 8 - 0.25)) < 0.6,
    'кришка сіла врівень із втопленими боками, а не стирчить: ' +
    (tsLid ? tsLid.w.toFixed(2) : '?') + ' (треба ≈191.75)');
  check('Т-стик + засувка ззаду', ts({ lid: merge(SL, { dir: 'back' }) }));
  check('Т-стик + засувка + перегородки', ts({ lid: SL, divX: 1, divY: 1, divJoint: 'tab' }));

  /* ======================================================================
   *  9b. МІСЦЯ ДЕТАЛЕЙ У КОРОБЦІ (прев'ю)
   * ================================================================== */
  log('');
  log('=== 9b. Місця деталей ===');

  function solid(res, id) {
    return (res.solids || []).filter(function (s) { return s.id === id; })[0];
  }
  /** Чи лежить деталь у габариті коробки. */
  function insideBox(res) {
    var d = res.dims;
    return (res.solids || []).every(function (s) {
      return s.x0 > -0.01 && s.y0 > -0.01 && s.z0 > -0.01 &&
        s.x1 < d.W + 0.01 && s.y1 < d.D + 0.01 && s.z1 < d.H + 0.01 &&
        s.x1 > s.x0 && s.y1 > s.y0 && s.z1 > s.z0;
    });
  }

  var rf = G.build(base({ divX: 1, faces: FACES_OPEN }));
  ok(rf.solids.length === rf.panels.length,
    'на кожну деталь є місце в коробці (' + rf.solids.length + '/' + rf.panels.length + ')');
  ok(insideBox(rf), 'усі деталі пальцевої коробки в межах габариту й ненульові');
  ok(insideBox(T) && T.solids.length === 6, 'те саме для Т-стику');

  var sfL = solid(T, 'left'), sfB = solid(T, 'bottom'), sfF = solid(T, 'front');
  ok(Math.abs(sfL.x0 - 4) < 0.01 && Math.abs(sfL.x1 - 8) < 0.01,
    'бік Т-стику втоплений на товщину від грані: x ' + sfL.x0 + '..' + sfL.x1);
  ok(Math.abs(sfB.z0) < 0.01 && Math.abs(sfB.z1 - 4) < 0.01, 'дно лежить у самому низу');
  ok(Math.abs(sfF.z0 - 4) < 0.01, 'передня стоїть НА дні, а не поруч із ним');
  var sfLf = solid(G.build(base({ kerf: 0, fit: 0 })), 'left');
  ok(Math.abs(sfLf.x0) < 0.01 && Math.abs(sfLf.x1 - 4) < 0.01,
    'у пальцевому стику бік — на самій грані: x ' + sfLf.x0 + '..' + sfLf.x1);

  var rsl = G.build(base({ lid: SL }));
  ok(!!solid(rsl, 'lid'), 'кришка-засувка теж має місце в коробці');
  ok(insideBox(rsl), 'із засувкою всі деталі в межах габариту');

  /* ======================================================================
   *  10. ПЕРЕГОРОДКИ НА ЯЗИЧКАХ У ДНО
   * ================================================================== */
  log('');
  log('=== 10. Перегородки на язичках ===');

  check('язички + пальцевий корпус', base({ divJoint: 'tab', divX: 2, divY: 1 }));
  check('язички + Т-стик', ts({ divJoint: 'tab', divX: 2, divY: 1 }));
  check('язички, 5x3 дрібні', base({
    W: 260, D: 180, H: 45, t: 3, finger: 9, divJoint: 'tab', divX: 5, divY: 3
  }));
  var rNo = check('язички без дна', base({ faces: FACES_TRAY, divJoint: 'tab', divX: 1 }));
  ok(rNo.warnings.join('|').indexOf('нема чим тримати') >= 0,
    'попереджає, що без дна язичкам нема куди заходити');

  var Dv = G.build(base({ divJoint: 'tab', divX: 1, kerf: 0, fit: 0 }));
  var dvBot = byId(Dv, 'bottom'), dvLf = byId(Dv, 'left'), dvTop = byId(Dv, 'top');
  var dvA = byId(Dv, 'divX0');

  ok(!Dv.warnings.some(function (w) { return w.indexOf('глухою') >= 0; }),
    'кришка на шипах більше не робить коробку глухою — перегородка в неї не заходить');
  ok(!dvLf.holes.length && !dvTop.holes.length,
    'у стінках і кришці ЖОДНОГО прорізу від перегородки (' +
    dvLf.holes.length + '/' + dvTop.holes.length + ')');
  ok(dvBot.holes.length >= 2, 'у дні пази під язички (' + dvBot.holes.length + ')');
  ok(Math.abs(dvA.w - (150 - 8)) < 0.02,
    'перегородка враспор між стінками: ' + dvA.w.toFixed(1) + ' (треба 142)');
  ok(Math.abs(dvA.h - (100 - 8 + 4)) < 0.02,
    'висота — від верху дна до низу кришки, плюс язичок: ' + dvA.h.toFixed(1) + ' (треба 96)');

  var dvTabX = hCross(dvA.outline, -2), dvTabs = [];
  for (var di = 0; di + 1 < dvTabX.length; di += 2) {
    dvTabs.push([+dvTabX[di].toFixed(2), +dvTabX[di + 1].toFixed(2)]);
  }
  var dvSlots = dvBot.holes.map(function (h) {
    var bb = G.bbox([h]);
    return [+(bb.y0 - 4).toFixed(2), +(bb.y1 - 4).toFixed(2)];
  }).sort(function (a, b) { return a[0] - b[0]; });
  log('  язички перегородки: ' + dvTabs.map(function (a) { return a.join('..'); }).join(' '));
  log('  пази в дні (−yIn0): ' + dvSlots.map(function (a) { return a.join('..'); }).join(' '));
  ok(dvTabs.length > 0 && dvTabs.length === dvSlots.length,
    'скільки язичків — стільки й пазів (' + dvTabs.length + '/' + dvSlots.length + ')');
  ok(dvTabs.length === dvSlots.length && dvTabs.every(function (a, i) {
    return Math.abs(a[0] - dvSlots[i][0]) < 0.02 && Math.abs(a[1] - dvSlots[i][1]) < 0.02;
  }), 'кожен паз стоїть точно проти свого язичка');

  /* Напів-переплетення мусить пережити зміну режиму: перегородки все одно
   * заходять одна в одну, просто тепер обидві стоять на дні. */
  var Dx = G.build(base({ divJoint: 'tab', divX: 1, divY: 1, kerf: 0, fit: 0 }));
  var dxA = byId(Dx, 'divX0'), dxB = byId(Dx, 'divY0');
  var dxCutA = vCross(dxA.outline, Dx.dividers.y[0] - 4);   // lx = Y − yIn0
  var dxCutB = vCross(dxB.outline, Dx.dividers.x[0] - 4);   // lx = X − xIn0
  log('  A на перетині: ' + dxCutA.map(function (v) { return v.toFixed(1); }).join(', '));
  log('  B на перетині: ' + dxCutB.map(function (v) { return v.toFixed(1); }).join(', '));
  ok(dxCutA.length >= 2 && Math.abs(dxCutA[dxCutA.length - 1] - 46) < 0.6,
    'у A матеріал доходить до половини висоти — вище виріз (' +
    dxCutA[dxCutA.length - 1].toFixed(1) + ')');
  ok(dxCutB.length >= 2 && Math.abs(dxCutB[0] - 46) < 0.6,
    'у B матеріал починається з половини — нижче виріз (' + dxCutB[0].toFixed(1) + ')');

  /* ======================================================================
   *  11. ШЕСТЕРНІ
   * ================================================================== */
  log('');
  log('=== 11. Шестерні ===');

  var GR = window.BoxGears;

  /** Кут повороту шестерні; окремо вирізана деталь стоїть як намальована. */
  function rotOf(g, turns) {
    return isFinite(g.phase) ? GR.angleAt(g, turns || 0) : 0;
  }

  /** Радіус контуру в напрямку кута ang (світового), з урахуванням повороту. */
  function radiusAt(g, ang, turns) {
    var local = ang - rotOf(g, turns);
    var best = null, i, p, a, d;
    for (i = 0; i < g.outline.length; i++) {
      p = g.outline[i];
      a = Math.atan2(p[1], p[0]);
      d = Math.abs(((a - local + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (best === null || d < best.d) best = { d: d, r: Math.hypot(p[0], p[1]) };
    }
    return best.r;
  }

  /* Профіль шестерні як функція кута: будь-який промінь із центра перетинає
   * контур рівно раз, тому r(θ) однозначна — на цьому й тримається перевірка
   * перекриття нижче.
   *
   * Саме тут ховалася перша версія цієї перевірки, яка «знаходила» врізання
   * на третину міліметра: вона розкладала контур по комірках кута і брала в
   * комірці максимум. Біля ніжки радіус міняється так круто, що максимум по
   * комірці — це вже помітно більший радіус, ніж насправді. Тому тут чесна
   * інтерполяція між сусідніми точками контуру, а не сітка. */
  function radialFn(g) {
    var pts = g.outline.map(function (p) {
      return [Math.atan2(p[1], p[0]), Math.hypot(p[0], p[1])];
    }).sort(function (a, b) { return a[0] - b[0]; });
    return function (ang) {
      var a = ((ang + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      var lo = 0, hi = pts.length - 1, mid;
      if (a <= pts[0][0] || a >= pts[hi][0]) {
        // шов між останньою і першою точкою — інтерполюємо через нього
        var d = (pts[0][0] + Math.PI * 2) - pts[hi][0];
        var t0 = (a < pts[0][0] ? a + Math.PI * 2 : a) - pts[hi][0];
        return pts[hi][1] + (pts[0][1] - pts[hi][1]) * (d > 1e-12 ? t0 / d : 0);
      }
      while (hi - lo > 1) {
        mid = (lo + hi) >> 1;
        if (pts[mid][0] <= a) lo = mid; else hi = mid;
      }
      var span = pts[hi][0] - pts[lo][0];
      return pts[lo][1] + (pts[hi][1] - pts[lo][1]) * (span > 1e-12 ? (a - pts[lo][0]) / span : 0);
    };
  }

  /**
   * Наскільки глибоко зуби однієї шестерні залазять у тіло другої.
   * Це і є головна перевірка передачі: якщо фаза чи міжосьова хоч трохи
   * не ті, метал проходить крізь метал, і на картинці шестерні «жують» одна
   * одну. Нуль означає, що вони рівно дотикаються.
   */
  function penetration(A, B, turns) {
    var rA = radialFn(A);
    var rotA = rotOf(A, turns), rotB = rotOf(B, turns);
    var worst = 0;
    B.outline.forEach(function (p) {
      var a = Math.atan2(p[1], p[0]) + rotB;
      var r = Math.hypot(p[0], p[1]);
      var wx = B.cx + r * Math.cos(a), wy = B.cy + r * Math.sin(a);
      var vx = wx - A.cx, vy = wy - A.cy;
      var d = Math.hypot(vx, vy);
      if (d > A.ra) return;
      var deep = rA(Math.atan2(vy, vx) - rotA) - d;
      if (deep > worst) worst = deep;
    });
    return worst;
  }

  var g1 = GR.gear({ m: 3, z: 24, kerf: 0, backlash: 0, bore: 5 });
  ok(Math.abs(g1.d - 72) < 0.01, 'ділильний ⌀ = m·z: ' + g1.d.toFixed(2) + ' (треба 72)');
  ok(Math.abs(g1.da - 78) < 0.01, 'вершин ⌀ = d + 2m: ' + g1.da.toFixed(2) + ' (треба 78)');
  // дно западини — найнижча точка трохоїди, тому на соті більше за d − 2.5m
  ok(Math.abs(g1.df - 64.5) < 0.15, 'западин ⌀ ≈ d − 2.5m: ' + g1.df.toFixed(2) + ' (треба 64.5)');
  ok(Math.abs(g1.rb - 36 * Math.cos(20 * Math.PI / 180)) < 0.01,
    'основне коло = d·cos α / 2: ' + g1.rb.toFixed(3));
  ok(!hasNaN(g1.outline), 'контур без NaN');
  ok(g1.outline.length > 24 * 20, 'зуби промальовані точками (' + g1.outline.length + ')');
  ok(!selfIntersects(g1.outline), 'контур шестерні не самоперетинається');
  ok(g1.holes.length === 1, 'отвір під вал прорізаний (' + g1.holes.length + ')');

  /* Найважливіше в шестерні — що ВСІ зуби однакові й рівномірні. Міряємо
   * радіус контуру в напрямках через кожен крок зуба: там мусить бути вершина,
   * і всюди та сама. */
  var tipR = [], valR = [];
  for (var gi = 0; gi < 24; gi++) {
    tipR.push(radiusAt(g1, 2 * Math.PI * gi / 24));
    valR.push(radiusAt(g1, 2 * Math.PI * (gi + 0.5) / 24));
  }
  var tipMax = Math.max.apply(null, tipR), tipMin = Math.min.apply(null, tipR);
  var valMax = Math.max.apply(null, valR), valMin = Math.min.apply(null, valR);
  ok(tipMax - tipMin < 0.02, 'усі вершини на одному радіусі (розкид ' +
    (tipMax - tipMin).toFixed(4) + ')');
  ok(Math.abs(tipMin - g1.ra) < 0.02, 'вершина = радіус вершин (' + tipMin.toFixed(3) + ')');
  ok(valMax - valMin < 0.02, 'усі западини на одному радіусі (розкид ' +
    (valMax - valMin).toFixed(4) + ')');
  ok(Math.abs(valMin - g1.rf) < 0.02, 'дно западини = радіус западин (' + valMin.toFixed(3) + ')');

  var gk = GR.gear({ m: 3, z: 24, kerf: 0.4, backlash: 0, bore: 5 });
  ok(gk.da - g1.da > 0.3, 'kerf товщить заготовку: ⌀ вершин ' + gk.da.toFixed(2) +
    ' проти ' + g1.da.toFixed(2));
  var boreK = G.bbox([gk.holes[0]]), bore0 = G.bbox([g1.holes[0]]);
  ok((boreK.x1 - boreK.x0) < (bore0.x1 - bore0.x0) - 0.3,
    'а отвір під вал, навпаки, звужує: ' + (boreK.x1 - boreK.x0).toFixed(2) +
    ' проти ' + (bore0.x1 - bore0.x0).toFixed(2));

  var gsp = GR.gear({ m: 3, z: 40, kerf: 0, bore: 6, spokes: 6 });
  ok(gsp.holes.length === 7, 'вал + шість отворів у диску (' + gsp.holes.length + ')');
  var spOut = gsp.holes.slice(1).every(function (h) {
    var bb = G.bbox([h]);
    return Math.hypot((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2) + (bb.x1 - bb.x0) / 2 < gsp.rf - 2;
  });
  ok(spOut, 'отвори в диску не лізуть у западини — обід цілий');
  /* Отвори мусять бути й на дрібних — просто меншими. Раніше вони там просто
   * зникали, бо запаси на маточину й обід міряли міліметрами, а не модулем. */
  var gsp1 = GR.gear({ m: 3, z: 11, kerf: 0.16, bore: 5, spokes: 5 });
  ok(gsp1.holes.length === 6, 'на шестерні з 11 зубів отвори теж є (' +
    (gsp1.holes.length - 1) + ')');
  var spR = function (g, i) {
    var bb = G.bbox([g.holes[i]]);
    return { r: (bb.x1 - bb.x0) / 2, c: Math.hypot((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2) };
  };
  var bigSp = spR(GR.gear({ m: 3, z: 28, kerf: 0.16, bore: 5, spokes: 5 }), 1);
  var smallSp = spR(gsp1, 1);
  ok(smallSp.r < bigSp.r * 0.5,
    'і вони пропорційно менші: ⌀' + (smallSp.r * 2).toFixed(1) + ' проти ⌀' +
    (bigSp.r * 2).toFixed(1));
  ok(smallSp.c + smallSp.r < gsp1.rf - 1.4,
    'обід під зубами лишився цілим (' + (gsp1.rf - smallSp.c - smallSp.r).toFixed(1) + ' мм)');

  var gsp0 = GR.gear({ m: 2, z: 8, kerf: 0.16, bore: 6, spokes: 6 });
  ok(gsp0.holes.length === 1,
    'а там, де отвір вийшов би з голку, його таки немає (' + (gsp0.holes.length - 1) + ')');

  log('');
  log('--- зачеплення ---');

  /* Передача тримається на двох числах. Міжосьова відстань — сума ділильних
   * радіусів; фаза — зуб однієї рівно навпроти западини другої. Друге й
   * перевіряємо: на лінії центрів у ведучої мусить бути ВЕРШИНА, у веденої —
   * ДНО ЗАПАДИНИ. Якби фаза була довільна, вони б їхали одна крізь одну. */
  var trStd = GR.train({ m: 3, teeth: [24, 20], angle: 0, kerf: 0, backlash: 0, bore: 4 });
  ok(Math.abs(trStd.gears[1].axis - 3 * (24 + 20) / 2) < 0.01,
    'без зміщення міжосьова = m(z₁+z₂)/2 = 66: ' + trStd.gears[1].axis.toFixed(2));

  var tr = GR.train({ m: 3, teeth: [24, 12, 18], angle: 30, kerf: 0, backlash: 0, bore: 4 });
  ok(tr.gears.length === 3, 'три шестерні в передачі');
  ok(Math.abs(tr.gears[1].x - (17 - 12) / 17) < 1e-9,
    'дванадцятизуба отримала зміщення ' + tr.gears[1].x.toFixed(3));
  ok(tr.gears[0].x === 0, 'а двадцятичотиризуба обійшлася без нього');
  // зі зміщенням колеса законно розсуваються — інакше зуби заклинить
  ok(tr.gears[1].axis > 54 && tr.gears[1].axis < 55.5,
    'міжосьова 1–2 розсунута під зміщення: ' + tr.gears[1].axis.toFixed(2) + ' (стандартна 54)');
  var dist12 = Math.hypot(tr.gears[1].cx - tr.gears[0].cx, tr.gears[1].cy - tr.gears[0].cy);
  ok(Math.abs(dist12 - tr.gears[1].axis) < 0.01,
    'центри реально стоять на цій відстані: ' + dist12.toFixed(2));

  ok(Math.abs(tr.gears[1].rate + 24 / 12) < 1e-9,
    'друга крутиться назад і вдвічі швидше: ' + tr.gears[1].rate.toFixed(3));
  ok(Math.abs(tr.gears[2].rate - (24 / 18)) < 1e-9,
    'третя — знову вперед, ' + tr.gears[2].rate.toFixed(3) + ' (проміжна не міняє відношення)');

  /* Через кожні 1/z оберту зуб ведучої стає рівно на лінію центрів. Тоді
   * вершина зуба + дно западини сусідки = міжосьова МІНУС радіальний зазор
   * 0.25·m: западина навмисне глибша за зуб, інакше вершина впиралася б у дно
   * замість того, щоб працювали бокові поверхні. */
  [0, 1 / 24, 5 / 24, 0.5].forEach(function (t) {
    var A = tr.gears[0], B = tr.gears[1];
    var phi = Math.atan2(B.cy - A.cy, B.cx - A.cx);
    var tip = radiusAt(A, phi, t), val = radiusAt(B, phi + Math.PI, t);
    ok(Math.abs(tip - A.ra) < 0.05 && Math.abs(val - B.rf) < 0.05 && tip + val < B.axis,
      'оберт ' + t.toFixed(4) + ': вершина ' + tip.toFixed(2) + ' + западина ' +
      val.toFixed(2) + ' = ' + (tip + val).toFixed(2) + ' < міжосьової ' +
      B.axis.toFixed(2) + ' — вершина не впирається в дно');
  });

  /* А це головне: у ЖОДНИЙ момент зуби не проходять крізь метал сусідки.
   * Саме тут ловиться і збита фаза, і хибна міжосьова — на статичній картинці
   * вони обидві виглядають майже пристойно. */
  var worst12 = 0, worst23 = 0, tSample;
  for (tSample = 0; tSample < 1; tSample += 1 / 60) {
    worst12 = Math.max(worst12, penetration(tr.gears[0], tr.gears[1], tSample));
    worst23 = Math.max(worst23, penetration(tr.gears[1], tr.gears[2], tSample));
  }
  log('  найглибше проникнення за оберт: пара 1–2 ' + worst12.toFixed(3) +
    ' мм, пара 2–3 ' + worst23.toFixed(3) + ' мм');
  ok(worst12 < 0.2, 'пара 1–2 котиться без врізання (' + worst12.toFixed(3) + ' мм)');
  ok(worst23 < 0.2, 'пара 2–3 теж (' + worst23.toFixed(3) + ' мм)');

  /* Контроль на самий тест: зсунемо фазу на пів зуба — зуби мусять полізти
   * одне в одне, інакше перевірка вище нічого не ловить. */
  var broken = GR.train({ m: 3, teeth: [24, 12], angle: 30, kerf: 0, backlash: 0, bore: 4 });
  broken.gears[1].phase += Math.PI / 12;
  var bad = penetration(broken.gears[0], broken.gears[1], 0);
  ok(bad > 1, 'збита фаза ловиться: проникнення ' + bad.toFixed(2) + ' мм');

  /* Люфт мусить прибирати метал із зуба, інакше зачеплення заклинить. */
  var trB = GR.train({ m: 3, teeth: [24, 12], angle: 0, kerf: 0, backlash: 0.4, bore: 4 });
  var wide = GR.train({ m: 3, teeth: [24, 12], angle: 0, kerf: 0, backlash: 0, bore: 4 });
  function toothWidth(g) {
    // ширина зуба по ділильному колу: скільки точок контуру лежить «в тілі»
    var half = 0, i, p, r, a;
    for (i = 0; i < g.outline.length; i++) {
      p = g.outline[i];
      r = Math.hypot(p[0], p[1]);
      if (Math.abs(r - g.rp) < 0.4) {
        a = Math.abs(Math.atan2(p[1], p[0]));
        if (a < Math.PI / g.z) half = Math.max(half, a);
      }
    }
    return half;
  }
  ok(toothWidth(trB.gears[0]) < toothWidth(wide.gears[0]),
    'люфт стоншує зуб (' + toothWidth(trB.gears[0]).toFixed(4) + ' проти ' +
    toothWidth(wide.gears[0]).toFixed(4) + ')');

  /* Про підріз більше не попереджаємо — зміщення його прибирає. Натомість
   * стежимо за тим, що зміщення й породжує: загостреною вершиною. */
  var trOk = GR.train({ m: 3, teeth: [12, 18], kerf: 0.16, bore: 4 });
  ok(trOk.warnings.join('|').indexOf('підріз') < 0,
    'на 12 зубах уже не лякає підрізом — зміщення його прибрало');
  ok(trOk.gears[0].sa > 0.3 * 3, 'і вершина зуба лишилась товстою: ' +
    trOk.gears[0].sa.toFixed(2) + ' мм');
  var trSharp = GR.train({ m: 3, teeth: [6, 20], kerf: 0.16, bore: 3 });
  ok(trSharp.warnings.join('|').indexOf('загострюється') >= 0,
    'а на шести зубах попереджає, що зуб виходить вістрям');
  var trThin = GR.train({ m: 0.6, teeth: [24, 12], kerf: 0.16, bore: 1 });
  ok(trThin.warnings.join('|').indexOf('викришиться') >= 0,
    'попереджає, що зуб на модулі 0.6 викришиться');

  var trOne = GR.train({ m: 2, teeth: [30], kerf: 0.1, bore: 5 });
  ok(trOne.gears.length === 1 && trOne.gears[0].rate === 1, 'одна шестерня — теж передача');
  var trEmpty = GR.train({ m: 2, teeth: [], kerf: 0.1 });
  ok(trEmpty.gears.length === 0, 'порожній список зубів нічого не ламає');

  log('');
  log((fails ? '### ПРОВАЛЕНО ' + fails : '### УСЕ ЧИСТО') + ' — ' + (checks - fails) + '/' + checks);
  document.getElementById('out').textContent = lines.join('\n');
})();
