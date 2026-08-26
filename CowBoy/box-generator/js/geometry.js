/* =============================================================================
 *  geometry.js — математика розкрою коробки на пальцевих шипах
 *  (finger joints / box joints). Чистий модуль без DOM: на вхід параметри,
 *  на вихід — набір плоских деталей у міліметрах.
 *
 *  Система координат коробки:
 *      X — ширина  (W)
 *      Y — глибина (D)
 *      Z — висота  (H)
 *
 *  Локальні координати деталей (вісь Y дивиться ВГОРУ, як у математиці):
 *      bottom / top : (lx, ly) = (X,     Y)
 *      front        : (lx, ly) = (X,     Z)
 *      back         : (lx, ly) = (W - X, Z)
 *      left         : (lx, ly) = (D - Y, Z)
 *      right        : (lx, ly) = (Y,     Z)
 *
 *  Принцип з'єднання:
 *  Кожна деталь — це повний зовнішній прямокутник своєї площини. По кожному
 *  ребру йде чергування "шип" (матеріал до самого краю) / "паз" (матеріал
 *  відступає всередину рівно на товщину t). Дві спряжені деталі мають
 *  протилежну фазу — і вони змикаються без зазорів.
 *
 *  Кількість комірок на ребрі ЗАВЖДИ непарна. Це дає дві речі задарма: фаза
 *  збігається навіть якщо деталі рахують спільне ребро в протилежних
 *  напрямках, і кут коробки однозначно дістається одній деталі
 *  (пріоритет: дно/кришка → перед/зад → боки), без накладань і щілин.
 * ========================================================================== */

(function (global) {
  'use strict';

  var EPS = 1e-7;

  /* ==========================================================================
   *  1. ДРІБНІ УТИЛІТИ
   * ====================================================================== */

  function lineIntersect(p1, d1, p2, d2) {
    var den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) return [p2[0], p2[1]];
    var t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
  }

  /** прибрати підряд однакові точки (і замикання) */
  function dedupe(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], l = out[out.length - 1];
      if (l && Math.abs(l[0] - p[0]) < EPS && Math.abs(l[1] - p[1]) < EPS) continue;
      out.push([p[0], p[1]]);
    }
    while (out.length > 1) {
      var a = out[0], b = out[out.length - 1];
      if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) out.pop();
      else break;
    }
    return out;
  }

  function polyArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i++) {
      var q = p[(i + 1) % p.length];
      a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    return a / 2;
  }

  /**
   * Еквідистанта замкнутого контуру.
   * d > 0 — розширити многокутник відносно його ВЛАСНОЇ внутрішньої області.
   * Для зовнішнього контуру деталі внутрішня область = матеріал.
   * Для отвору внутрішня область = порожнеча, тому там d від'ємне.
   */
  function offsetPoly(pts, d) {
    var p = dedupe(pts), n = p.length;
    if (n < 3 || Math.abs(d) < EPS) return p;
    var sgn = polyArea(p) > 0 ? 1 : -1;

    var lines = [];
    for (var i = 0; i < n; i++) {
      var a = p[i], b = p[(i + 1) % n];
      var ux = b[0] - a[0], uy = b[1] - a[1];
      var L = Math.hypot(ux, uy) || 1;
      ux /= L; uy /= L;
      lines.push({ p: [a[0] + uy * sgn * d, a[1] - ux * sgn * d], d: [ux, uy] });
    }
    var out = [];
    for (var k = 0; k < n; k++) {
      var l1 = lines[(k - 1 + n) % n], l2 = lines[k];
      out.push(lineIntersect(l1.p, l1.d, l2.p, l2.d));
    }
    return out;
  }

  function polyLength(p) {
    var s = 0;
    for (var i = 0; i < p.length; i++) {
      var q = p[(i + 1) % p.length];
      s += Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
    }
    return s;
  }

  function bbox(polys) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    polys.forEach(function (poly) {
      poly.forEach(function (pt) {
        if (pt[0] < b.x0) b.x0 = pt[0];
        if (pt[1] < b.y0) b.y0 = pt[1];
        if (pt[0] > b.x1) b.x1 = pt[0];
        if (pt[1] > b.y1) b.y1 = pt[1];
      });
    });
    return b;
  }

  function rect(x0, y0, x1, y1) {
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }

  /** Коло як багатокутник. Крок беремо від радіуса, щоб дрібні отвори не гранили. */
  function circlePts(cx, cy, r, n) {
    n = Math.max(16, n || Math.round(r * 5));
    var p = [];
    for (var i = 0; i < n; i++) {
      var a = 2 * Math.PI * i / n;
      p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return p;
  }

  /** Овал-«стадіон»: прямокутник len×h зі скругленими торцями. */
  function stadiumPts(cx, cy, len, h, n) {
    var r = h / 2, half = Math.max(0, len / 2 - r), p = [];
    n = Math.max(8, n || Math.round(r * 4));
    for (var i = 0; i <= n; i++) {                       // правий торець: −90° → +90°
      var a = -Math.PI / 2 + Math.PI * i / n;
      p.push([cx + half + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    for (var j = 0; j <= n; j++) {                       // лівий торець: +90° → +270°
      var b = Math.PI / 2 + Math.PI * j / n;
      p.push([cx - half + r * Math.cos(b), cy + r * Math.sin(b)]);
    }
    return dedupe(p);
  }

  /* ==========================================================================
   *  2. РЕБРА
   *
   *  Ребро — масив ділянок [s0, s1] зі стабільним відступом усередину деталі.
   *  Так живуть і шипи, і пази, і наскрізні прорізи під перегородки.
   * ====================================================================== */

  /** Непарна кількість комірок шипа вздовж ребра. */
  function fingerCount(len, target, t) {
    var n = Math.round(len / Math.max(target, 0.5));
    if (n % 2 === 0) n += 1;
    if (n < 3) n = 3;
    // комірка мусить бути більшою за товщину, інакше кути «з'їдають» шип
    while (n > 3 && len / n < t * 1.25) n -= 2;
    return n;
  }

  /**
   * `plain` на ділянці означає «тут матеріал доходить до краю, бо з'єднання
   * тут просто НЕМА» — на відміну від шипа, у якого відступ теж нульовий.
   * Розрізняти обов'язково: інакше рівна ділянка ребра поїде в tabSegs як
   * шип, і в сусідній стінці з'явиться наскрізний паз, під який нема чого
   * вставляти. Тому дві сусідні ділянки з однаковим відступом зливаємо лише
   * тоді, коли в них однаковий `plain`.
   */
  function mergeSegs(segs) {
    segs.sort(function (a, b) { return a.s0 - b.s0; });
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], last = out[out.length - 1];
      if (last && Math.abs(last.off - s.off) < EPS && Math.abs(last.s1 - s.s0) < EPS &&
        !last.plain === !s.plain) last.s1 = s.s1;
      else out.push({ s0: s.s0, s1: s.s1, off: s.off, plain: s.plain });
    }
    return out;
  }

  /** Ребро з шипами. startMale=true — перша комірка це шип (матеріал до краю). */
  function fingerEdge(len, n, startMale, t) {
    var c = len / n, segs = [];
    for (var i = 0; i < n; i++) {
      var isTab = (i % 2 === 0) === !!startMale;
      segs.push({ s0: i * c, s1: (i + 1) * c, off: isTab ? 0 : t });
    }
    return { len: len, segs: mergeSegs(segs), joined: true, cell: c };
  }

  /**
   * Ребро, де з'єднання займає лише ділянку [a, b], решта — рівна.
   * Треба для кришки-засувки: заїзна стінка нижча за боки, тому бік
   * тримає шипи тільки на її висоті, а вище йде гладкий борт.
   */
  function partEdge(len, a, b, n, startMale, t) {
    a = Math.max(0, a); b = Math.min(len, b);
    if (b - a < EPS) return plainEdge(len);
    var c = (b - a) / n, segs = [];
    if (a > EPS) segs.push({ s0: 0, s1: a, off: 0, plain: 1 });
    for (var i = 0; i < n; i++) {
      var isTab = (i % 2 === 0) === !!startMale;
      segs.push({ s0: a + i * c, s1: a + (i + 1) * c, off: isTab ? 0 : t });
    }
    if (len - b > EPS) segs.push({ s0: b, s1: len, off: 0, plain: 1 });
    return { len: len, segs: mergeSegs(segs), joined: true, cell: c };
  }

  /** Рівне ребро без з'єднання (коли сусідньої стінки немає). */
  function plainEdge(len) {
    return { len: len, segs: [{ s0: 0, s1: len, off: 0, plain: 1 }], joined: false, cell: len };
  }

  /**
   * Ребро Т-СТИКУ: базова лінія — це торець, яким деталь упирається в ПЛОЩИНУ
   * сусідньої, а язички виступають ЗА неї на `depth` і проходять крізь сусідку
   * наскрізь. Зустрічний проріз ріжеться не в ребрі сусідки, а в її площині,
   * тому обидва ребра стику лишаються рівними — гребінки з торця немає.
   *
   * Від'ємний відступ і є весь фокус: buildOutline відкладає його по
   * ВНУТРІШНІЙ нормалі, тому мінус виносить матеріал назовні деталі.
   *
   * Кути ребра завжди порожні — язички стоять на непарних комірках. Інакше
   * два сусідні ребра зрослись би в кутку одним Г-подібним виступом, а ще
   * buildOutline почав би «з'їдати» кут на від'ємну величину.
   *
   * [a, b] — ділянка, на якій з'єднання взагалі є; решта ребра рівна. Треба
   * для засувки: заїзна стінка нижча за боки, і язички мусять скінчитись
   * рівно на її висоті.
   */
  function tabEdge(len, a, b, n, depth) {
    a = Math.max(0, a); b = Math.min(len, b);
    if (b - a < EPS || n < 3) return plainEdge(len);
    var c = (b - a) / n, segs = [];
    if (a > EPS) segs.push({ s0: 0, s1: a, off: 0, plain: 1 });
    for (var i = 0; i < n; i++) {
      var isTab = i % 2 === 1;
      segs.push({
        s0: a + i * c, s1: a + (i + 1) * c,
        off: isTab ? -depth : 0, plain: isTab ? 0 : 1
      });
    }
    if (len - b > EPS) segs.push({ s0: b, s1: len, off: 0, plain: 1 });
    return { len: len, segs: mergeSegs(segs), joined: true, cell: c };
  }

  /** Ділянки ребра, де матеріал ВИХОДИТЬ за базову лінію — язички Т-стику. */
  function outSegs(edge) {
    return edge.segs.filter(function (s) {
      return s.off < -EPS && s.s1 - s.s0 > EPS;
    });
  }

  /** Прорізати в ребрі паз глибиною off на ділянці [s0,s1] (напів-переплетення). */
  function notchEdge(edge, s0, s1, off) {
    s0 = Math.max(0, s0); s1 = Math.min(edge.len, s1);
    if (s1 - s0 < EPS) return edge;

    var res = [];
    edge.segs.forEach(function (sg) {
      if (sg.s1 <= s0 + EPS || sg.s0 >= s1 - EPS) {
        res.push({ s0: sg.s0, s1: sg.s1, off: sg.off, plain: sg.plain });
        return;
      }
      if (sg.s0 < s0 - EPS) res.push({ s0: sg.s0, s1: s0, off: sg.off, plain: sg.plain });
      if (sg.s1 > s1 + EPS) res.push({ s0: s1, s1: sg.s1, off: sg.off, plain: sg.plain });
    });
    res.push({ s0: s0, s1: s1, off: off });
    return { len: edge.len, segs: mergeSegs(res), joined: edge.joined, cell: edge.cell };
  }

  function offAt(edge, s) {
    for (var i = 0; i < edge.segs.length; i++) {
      if (s < edge.segs[i].s1 - EPS) return edge.segs[i].off;
    }
    return edge.segs[edge.segs.length - 1].off;
  }

  /** Ділянки ребра, де матеріал виходить на край саме як ШИП. */
  function tabSegs(edge) {
    return edge.segs.filter(function (s) {
      return !s.plain && Math.abs(s.off) < EPS && s.s1 - s.s0 > EPS;
    });
  }

  /* ==========================================================================
   *  3. КОНТУР ДЕТАЛІ
   *  Ребра йдуть проти годинникової стрілки (Y вгору):
   *      e0 низ (зліва направо), e1 право (вгору), e2 верх (справа наліво),
   *      e3 ліво (вниз)
   * ====================================================================== */

  function buildOutline(A, B, e0, e1, e2, e3) {
    var E = [e0, e1, e2, e3];
    var G = [
      { p: [0, 0], d: [1, 0], n: [0, 1] },
      { p: [A, 0], d: [0, 1], n: [-1, 0] },
      { p: [A, B], d: [-1, 0], n: [0, -1] },
      { p: [0, B], d: [0, -1], n: [1, 0] }
    ];
    var pts = [];

    for (var k = 0; k < 4; k++) {
      var e = E[k], g = G[k];
      var prev = E[(k + 3) % 4], next = E[(k + 1) % 4];
      // кут деталі «з'їдається» відступом сусіднього ребра
      var sStart = offAt(prev, prev.len);
      var sEnd = e.len - offAt(next, 0);

      e.segs.forEach(function (sg) {
        var a = Math.max(sg.s0, sStart), b = Math.min(sg.s1, sEnd);
        if (b <= a + EPS) return;
        pts.push([g.p[0] + g.d[0] * a + g.n[0] * sg.off, g.p[1] + g.d[1] * a + g.n[1] * sg.off]);
        pts.push([g.p[0] + g.d[0] * b + g.n[0] * sg.off, g.p[1] + g.d[1] * b + g.n[1] * sg.off]);
      });
    }
    return dedupe(pts);
  }

  /* ==========================================================================
   *  4. ГОЛОВНА ЗБІРКА
   * ====================================================================== */

  /**
   * @param {object} p
   *   W,D,H      — габарити, мм
   *   t          — товщина матеріалу, мм
   *   finger     — бажаний крок шипа, мм
   *   kerf       — ширина різу лазера, мм
   *   fit        — додатковий зазор посадки, мм (0 = впритул)
   *   dimMode    — 'outer' | 'inner'
   *   faces      — {top,bottom,front,back,left,right} : boolean
   *   joint      — 'finger' (пальці по ребру) | 'tslot' (язичок крізь площину)
   *   divJoint   — 'through' (перегородка наскрізь у стінки) | 'tab' (язички
   *                лише в дно, стінки зовні чисті)
   *   divX, divY — кількість перегородок по осях X / Y
   *   lid        — {type:'finger'|'slide', dir:'front'|'back', drop, clear,
   *                 notch, pull:'none'|'ring'|'oval'|'half', pullSize}
   */
  function build(p) {
    var warn = [];
    var t = Math.max(0.1, +p.t || 3);
    var W = +p.W, D = +p.D, H = +p.H;
    var F = p.faces || {};

    /* ---------- 4.0 кришка: тип і висоти ----------
     * finger — на шипах: сідає пальцями в усі чотири стінки. Найміцніше, але
     *          з перегородками коробка глуха — вони заходять шипами і в неї.
     * slide  — ЗАСУВКА: їздить у горизонтальному каналі, прорізаному наскрізь
     *          у боках. Заїзна стінка коротшає рівно до низу кришки (інакше
     *          засувці нема як зайти), над кришкою лишається борт, який її і
     *          тримає, а перегородки коротшають до того ж рівня.
     */
    var lidCfg = p.lid || {};
    var slide = !!F.top && lidCfg.type === 'slide';
    var slideDir = lidCfg.dir === 'back' ? 'back' : 'front';
    var lidClear = Math.max(0, +lidCfg.clear);
    if (!isFinite(lidClear)) lidClear = 0.25;
    var lidDrop = +lidCfg.drop;
    if (!isFinite(lidDrop)) lidDrop = t;

    /* ---------- 4.0a тип стику ----------
     * finger — пальці по ребру: обидві деталі повного розміру, кут ділять
     *          шипи. Видно з торця, зате нічого нікуди не втоплюється.
     * tslot  — Т-стик: деталь упирається торцем у ПЛОЩИНУ сусідки, а язички
     *          проходять крізь неї наскрізь. Ребра лишаються рівними.
     *
     * `m` — перемичка: скільки матеріалу лишається між прорізом і краєм
     * приймаючої деталі. Вона ж і є втоплення: паз не може виходити на край,
     * інакше замість пазу вийде виріз, а замість перемички — нуль. Товщина
     * матеріалу тут найпростіша й найчесніша міра, вона ж дає рівний
     * тіньовий шов по периметру.
     */
    var TS = p.joint === 'tslot';
    var m = TS ? t : 0;

    if (p.dimMode === 'inner') {
      W += (F.left ? m + t : 0) + (F.right ? m + t : 0);
      D += (F.front ? m + t : 0) + (F.back ? m + t : 0);
      H += (F.bottom ? t : 0) + (slide ? lidDrop + t : (F.top ? t : 0));
    }

    if (slide) {
      // борт над кришкою мусить лишитись, і під кришкою мусить лишитись коробка
      var dropMin = Math.min(1.5, t * 0.5);
      var dropMax = Math.max(dropMin, H - 3 * t);
      var dropFix = Math.min(Math.max(lidDrop, dropMin), dropMax);
      if (Math.abs(dropFix - lidDrop) > 0.01) {
        warn.push('Заглиблення кришки ' + lidDrop.toFixed(1) + ' мм не влазить у висоту ' +
          H.toFixed(1) + ' мм — узято ' + dropFix.toFixed(1) + ' мм.');
      }
      lidDrop = dropFix;
      if (lidDrop < t) {
        warn.push('Над засувкою лишається всього ' + lidDrop.toFixed(1) +
          ' мм борта — тонко, відламається. Постав заглиблення ≥ ' + t + ' мм.');
      }
      if (!F.left || !F.right) {
        warn.push('Кришці-засувці нема за що триматись: канал ріжеться в лівій і ' +
          'правій стінках, а вони вимкнені.');
      }
    }

    var TOP = !!F.top && !slide;              // верх на шипах
    var lidZ1 = H - lidDrop;                  // верх кришки
    var lidZ0 = lidZ1 - t;                    // низ кришки
    var hEntry = slide ? lidZ0 : H;           // висота заїзної стінки
    var hDiv = slide ? lidZ0 : H;             // висота перегородок

    var frontEntry = slide && slideDir === 'front';
    var backEntry = slide && slideDir === 'back';
    var hF = frontEntry ? hEntry : H;         // висота передньої стінки
    var hB = backEntry ? hEntry : H;          // висота задньої

    /* ---------- 4.0b межі тіл деталей ----------
     * У пальцевому стику всі шість деталей повного розміру: вони ділять кут
     * шипами. У Т-стику тіла коротшають — деталь упирається в площину сусідки,
     * а не змикається з нею ребром. Габарит коробки при цьому тримають дно й
     * кришка, тому W×D×H лишаються тим, що написано в полях.
     *
     * Ієрархія «хто в кого впирається» та сама, що й для пальців:
     * дно/кришка → перед/зад → боки. Тому перед лишається на всю ширину W, а
     * бік коротшає з обох кінців і втоплюється на `m` від бічної грані.
     */
    var wz0 = TS && F.bottom ? t : 0;         // низ стінок (верх дна)
    var wz1 = TS && TOP ? H - t : H;          // верх стінок (низ кришки)
    var sy0 = TS && F.front ? m + t : 0;      // тіло боків по Y
    var sy1 = TS && F.back ? D - m - t : D;
    var inZ0 = F.bottom ? t : 0;              // внутрішнє дно
    var inZ1 = slide ? lidZ0 : (TOP ? H - t : H);

    var nW = fingerCount(W, p.finger, t);
    var nD = fingerCount(D, p.finger, t);
    var nH = fingerCount(H, p.finger, t);
    var nDiv = fingerCount(hDiv, p.finger, t);

    /**
     * Вертикальне ребро стінки: з'єднання від низу до висоти `top`, вище рівне.
     * fromTop=true — у цього ребра s рахується від ВЕРХУ деталі (ребро e3).
     *
     * Потрібне саме через засувку: заїзна стінка нижча за боки, і спільний
     * кутовий стик мусить закінчитись на її висоті. Обидві сусідні деталі
     * рахують ту саму висоту й ту саму кількість комірок, тому фаза сходиться.
     */
    function vSpec(B, top, fromTop, male, on) {
      if (!on) return { len: B, on: false };
      var n = fingerCount(Math.min(top, B), p.finger, t);
      if (top >= B - EPS) return { len: B, n: n, male: male, on: true };
      return fromTop
        ? { len: B, a: B - top, b: B, n: n, male: male, on: true }
        : { len: B, a: 0, b: top, n: n, male: male, on: true };
    }

    /* ---------- 4.1 компенсація різу + посадка ----------
     * Промінь виїдає смугу kerf, центровану на лінії: деталь худне на kerf/2
     * з кожного боку, отвір товщає на стільки ж. Тому зовнішній контур
     * розширюємо на kerf/2, а отвори звужуємо.
     *
     * `fit` — СУМАРНИЙ люфт у з'єднанні. Коефіцієнти різні, бо в пальцевому
     * стику зазор набігає з двох боків (шип худне і паз ширшає), а в
     * наскрізному пазі під перегородку — лише з одного: товщина шипа там
     * дорівнює фізичній товщині фанери, яку ми ніяк не змінюємо.
     */
    var kerf = +p.kerf || 0, fit = +p.fit || 0;
    var cOut = kerf / 2 - fit / 4;    // зовнішній контур: шип −fit/2, паз +fit/2
    var cHole = -kerf / 2 + fit / 2;  // паз під перегородку: +fit

    var panels = [];
    var slots = {};   // ім'я деталі -> масив прорізів (локальні коорд.)
    function addSlot(panel, r) { (slots[panel] = slots[panel] || []).push(r); }

    /* Координати коробки → локальні координати деталі.
     * Пара (a, b) — це та пара осей, у якій деталь і лежить:
     *   дно / кришка — (X, Y),  перед / зад — (X, Z),  боки — (Y, Z).
     * Осі місцями й напрямком крутить саме тут, тому всі прорізи — і від
     * перегородок, і від язичків Т-стику — рахуються в координатах коробки,
     * де їх видно очима, а не в локальних, де легко переплутати знак. */
    var LOCAL = {
      bottom: function (a, b) { return [a, b]; },
      top: function (a, b) { return [a, b]; },
      front: function (a, b) { return [a, b - wz0]; },
      back: function (a, b) { return [W - a, b - wz0]; },
      left: function (a, b) { return [sy1 - a, b - wz0]; },
      right: function (a, b) { return [a - sy0, b - wz0]; }
    };

    /* Місце деталі в зібраній коробці — для прев'ю. Плоский розкрій цього не
     * знає: там у деталі лише свої локальні координати. */
    var solids = [];
    function addSolid(id, name, x0, x1, y0, y1, z0, z1) {
      solids.push({
        id: id, name: name,
        x0: x0, x1: x1, y0: y0, y1: y1, z0: z0, z1: z1
      });
    }

    /** Проріз у деталі, заданий двома кутами в координатах коробки. */
    function slotIn(panel, a0, b0, a1, b1) {
      var f = LOCAL[panel];
      if (!f) return;
      var p0 = f(a0, b0), p1 = f(a1, b1);
      addSlot(panel, rect(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]),
        Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])));
    }

    /* ---------- 4.2 перегородки: позиції ---------- */
    var xIn0 = F.left ? m + t : 0, xIn1 = F.right ? W - m - t : W;
    var yIn0 = F.front ? m + t : 0, yIn1 = F.back ? D - m - t : D;
    var innerW = xIn1 - xIn0, innerD = yIn1 - yIn0;

    var nx = Math.max(0, Math.min(12, p.divX | 0));
    var ny = Math.max(0, Math.min(12, p.divY | 0));
    var Xd = [], Yd = [], i, j;
    for (i = 0; i < nx; i++) Xd.push(xIn0 + innerW * (i + 1) / (nx + 1));
    for (j = 0; j < ny; j++) Yd.push(yIn0 + innerD * (j + 1) / (ny + 1));

    /* ---------- 4.3 перегородки ----------
     * through — наскрізні шипи в дно, кришку і бічні стінки. Найміцніше, зате
     *           знадвору видно щілину від кожного шипа.
     * tab     — язички лише в дно, у стінки перегородка впирається торцем
     *           враспор: стінки лишаються чистими. Заразом кришка на шипах
     *           перестає бути замком — перегородки в неї вже не заходять,
     *           і коробка відкривається.
     *
     * Різниця між режимами — лише в межах тіла й наборі ребер. Далі обидва
     * йдуть спільним кодом, тому напів-переплетення на перехрестях однакове.
     */
    var divTab = p.divJoint === 'tab';
    var divZ0 = divTab ? inZ0 : 0;                 // низ тіла перегородки
    var divZ1 = divTab ? inZ1 : hDiv;              // верх
    var divB = Math.max(0, divZ1 - divZ0);
    // у наскрізному режимі перегородка доходить до ЗОВНІШНЬОЇ поверхні стінки:
    // шип мусить пройти її наскрізь і стати врівень
    var dX0 = divTab ? xIn0 : (F.left ? m : 0);
    var dX1 = divTab ? xIn1 : (F.right ? W - m : W);
    var dY0 = divTab ? yIn0 : (F.front ? m : 0);
    var dY1 = divTab ? yIn1 : (F.back ? D - m : D);

    /** Ребро перегородки: язичок у Т-режимі, палець у наскрізному. */
    function divEdge(len, on, tab) {
      if (!on || len < EPS || divB < EPS) return plainEdge(len);
      var n = fingerCount(len, p.finger, t);
      return tab ? tabEdge(len, 0, len, n, t) : fingerEdge(len, n, false, t);
    }

    /** Ділянки ребра, під які треба різати паз у сусідній деталі. */
    function divCuts(edge) { return divTab ? outSegs(edge) : tabSegs(edge); }

    /* 4.3a перегородки вздовж Y — ділять ширину. Локально lx = Y, ly = Z. */
    var divA = dY1 - dY0;
    Xd.forEach(function (xd, idx) {
      var e0 = divEdge(divA, F.bottom, divTab);              // низ  -> дно
      var e1 = divEdge(divB, F.back && !divTab, false);      // lx=max -> зад
      var e2 = divEdge(divA, TOP && !divTab, false);         // верх -> кришка
      var e3 = divEdge(divB, F.front && !divTab, false);     // lx=0 -> перед

      // напів-переплетення з перегородками іншої осі: паз згори
      Yd.forEach(function (yd) {
        e2 = notchEdge(e2, dY1 - (yd + t / 2), dY1 - (yd - t / 2), divB / 2);
      });

      var outline = buildOutline(divA, divB, e0, e1, e2, e3);
      var x0 = xd - t / 2, x1 = xd + t / 2;

      divCuts(e0).forEach(function (s) { slotIn('bottom', x0, dY0 + s.s0, x1, dY0 + s.s1); });
      divCuts(e1).forEach(function (s) { slotIn('back', x0, divZ0 + s.s0, x1, divZ0 + s.s1); });
      divCuts(e2).forEach(function (s) { slotIn('top', x0, dY1 - s.s0, x1, dY1 - s.s1); });
      divCuts(e3).forEach(function (s) {
        slotIn('front', x0, divZ1 - s.s0, x1, divZ1 - s.s1);
      });

      addSolid('divX' + idx, 'Перег A' + (idx + 1), x0, x1, dY0, dY1, divZ0, divZ1);
      panels.push({
        id: 'divX' + idx, name: 'Перег A' + (idx + 1), kind: 'divider',
        outline: outline, holes: []
      });
    });

    /* 4.3b перегородки вздовж X — ділять глибину. Локально lx = X, ly = Z. */
    var divC = dX1 - dX0;
    Yd.forEach(function (yd, idx) {
      var e0 = divEdge(divC, F.bottom, divTab);              // низ  -> дно
      var e1 = divEdge(divB, F.right && !divTab, false);     // lx=max -> право
      var e2 = divEdge(divC, TOP && !divTab, false);         // верх -> кришка
      var e3 = divEdge(divB, F.left && !divTab, false);      // lx=0 -> ліво

      // паз знизу — назустріч верхньому в перегородках іншої осі
      Xd.forEach(function (xd) {
        e0 = notchEdge(e0, xd - t / 2 - dX0, xd + t / 2 - dX0, divB / 2);
      });

      var outline = buildOutline(divC, divB, e0, e1, e2, e3);
      var y0 = yd - t / 2, y1 = yd + t / 2;

      divCuts(e0).forEach(function (s) { slotIn('bottom', dX0 + s.s0, y0, dX0 + s.s1, y1); });
      divCuts(e1).forEach(function (s) { slotIn('right', y0, divZ0 + s.s0, y1, divZ0 + s.s1); });
      divCuts(e2).forEach(function (s) { slotIn('top', dX1 - s.s0, y0, dX1 - s.s1, y1); });
      divCuts(e3).forEach(function (s) {
        slotIn('left', y0, divZ1 - s.s0, y1, divZ1 - s.s1);
      });

      addSolid('divY' + idx, 'Перег B' + (idx + 1), dX0, dX1, y0, y1, divZ0, divZ1);
      panels.push({
        id: 'divY' + idx, name: 'Перег B' + (idx + 1), kind: 'divider',
        outline: outline, holes: []
      });
    });

    /* ---------- 4.5 шість основних стінок ----------
     * Пріоритет «хто займає кут»: дно/кришка (шип на всіх ребрах) >
     * перед/зад (шип на вертикальних) > боки (паз усюди).
     */
    function wall(id, name, A, B, spec, opts) {
      opts = opts || {};
      var e = spec.map(function (s) {
        if (!s.on) return plainEdge(s.len);
        if (s.a !== undefined) return partEdge(s.len, s.a, s.b, s.n, s.male, t);
        return fingerEdge(s.len, s.n, s.male, t);
      });
      (opts.notches || []).forEach(function (nc) {
        e[nc.k] = notchEdge(e[nc.k], nc.s0, nc.s1, nc.off);
      });
      panels.push({
        id: id, name: name, kind: 'wall',
        outline: buildOutline(A, B, e[0], e[1], e[2], e[3]),
        holes: slots[id] || []
      });
    }

    /* ---------- 4.5a канал під засувку ----------
     * Горизонтальний проріз НАСКРІЗЬ у боках, відкритий з боку заїзду. Краї
     * кришки ходять просто в ньому, тому кришка завширшки майже на всю
     * коробку, а знадвору видно її торці.
     *
     * Канал спиняється за одну товщину до дальньої стінки — інакше він злився
     * б із пазами кутового з'єднання і контур деталі перестав би бути простим.
     *
     * Ширину задаємо номінальну (t + люфт): загальна еквідистанта контуру
     * звузить її, а лазер потім рівно на стільько ж і поверне.
     */
    var yL0 = frontEntry ? m : yIn0;
    var yL1 = backEntry ? D - m : yIn1;
    var lidSpan = yL1 - yL0;
    var zMid = (lidZ0 + lidZ1) / 2;
    var chW = (t + lidClear) / 2;

    // Канал міряється від ЗАЇЗНОГО ТОРЦЯ бока, а не від грані коробки: у
    // Т-стику бік коротший за неї, і кришка на цю різницю виступає над низькою
    // заїзною стінкою — рівно так вона в канал і заходить.
    var edgeY = frontEntry ? sy0 : sy1;
    var stopY = frontEntry ? yL1 - t : yL0 + t;
    var chDepth = frontEntry ? stopY - edgeY : edgeY - stopY;
    var sideB = wz1 - wz0;                    // висота тіла бока
    var chS = zMid - wz0;                     // канал у координаті ребра знизу вгору

    var leftNotch = [], rightNotch = [];
    if (slide && chDepth > t) {
      // ліва: заїзд спереду — ребро 1 (s знизу вгору); ззаду — ребро 3 (навпаки)
      leftNotch.push(frontEntry
        ? { k: 1, s0: chS - chW, s1: chS + chW, off: chDepth }
        : { k: 3, s0: sideB - chS - chW, s1: sideB - chS + chW, off: chDepth });
      rightNotch.push(frontEntry
        ? { k: 3, s0: sideB - chS - chW, s1: sideB - chS + chW, off: chDepth }
        : { k: 1, s0: chS - chW, s1: chS + chW, off: chDepth });
    }

    if (TS) tsWalls(); else fingerWalls();

    /* Місця стінок у коробці. У пальцевому стику всі шість повного розміру й
     * ділять кут шипами; у Т-стику — те, що порахували у 4.0b. */
    if (F.bottom) addSolid('bottom', 'Дно', 0, W, 0, D, 0, t);
    if (TOP) addSolid('top', 'Кришка', 0, W, 0, D, H - t, H);
    if (F.front) {
      addSolid('front', 'Передня', 0, W, TS ? m : 0, TS ? m + t : t,
        wz0, TS ? (frontEntry ? hEntry : wz1) : hF);
    }
    if (F.back) {
      addSolid('back', 'Задня', 0, W, TS ? D - m - t : D - t, TS ? D - m : D,
        wz0, TS ? (backEntry ? hEntry : wz1) : hB);
    }
    if (F.left) addSolid('left', 'Ліва', TS ? m : 0, TS ? m + t : t, sy0, sy1, wz0, wz1);
    if (F.right) {
      addSolid('right', 'Права', TS ? W - m - t : W - t, TS ? W - m : W,
        sy0, sy1, wz0, wz1);
    }

    /* Комірки міряємо по ТИХ ребрах, які реально є. У Т-стику бік коротший за
     * глибину коробки, а стінка нижча за її висоту — рахувати від габариту
     * означало б показувати в панелі числа, яких на деталях немає. */
    var fLenD = TS ? sy1 - sy0 : D;
    var fLenH = TS ? wz1 - wz0 : H;
    var fW = nW;
    var fD = TS ? fingerCount(fLenD, p.finger, t) : nD;
    var fH = TS ? fingerCount(fLenH, p.finger, t) : nH;
    var fingersOut = {
      W: fW, D: fD, H: fH,
      stepW: W / fW, stepD: fLenD / fD, stepH: fLenH / fH
    };

    /* ---------- 4.5c стінки Т-стику ----------
     * Дно й кришка нічого не віддають, лише приймають: обидві лишаються цілими
     * прямокутниками W×D. Перед і зад стоять між ними на всю ширину, боки —
     * між передом і задом, втоплені на `m` від бічної грані. Саме це втоплення
     * і лишає в приймаючій деталі перемичку між прорізом та її краєм.
     *
     * Спершу рахуємо ребра всіх чотирьох стінок — кожен язичок одразу ріже
     * зустрічний паз у сусідці, — і лише потім складаємо деталі: інакше дно
     * пішло б у список без жодного пазу.
     */
    function tsWalls() {
      var sideA = sy1 - sy0;                          // довжина тіла бока по Y
      var hi = wz1 - wz0;                             // висота звичайної стінки
      var hiF = (frontEntry ? hEntry : wz1) - wz0;    // передньої (нижча при заїзді)
      var hiB = (backEntry ? hEntry : wz1) - wz0;     // задньої
      var made = {};

      /** Ребро з язичками — і зустрічні прорізи в тій деталі, куди воно входить. */
      function edge(len, on, cut, a, b) {
        if (!on || len < EPS) return plainEdge(Math.max(0, len));
        a = a || 0;
        b = b === undefined ? len : b;
        if (b - a < EPS) return plainEdge(len);
        var e = tabEdge(len, a, b, fingerCount(b - a, p.finger, t), t);
        outSegs(e).forEach(function (s) { cut(s.s0, s.s1); });
        return e;
      }

      function add(id, name, A, B, e, notches) {
        (notches || []).forEach(function (nc) {
          e[nc.k] = notchEdge(e[nc.k], nc.s0, nc.s1, nc.off);
        });
        made[id] = { name: name, A: A, B: B, e: e };
      }

      // --- боки: язички в усі чотири сусідні деталі ---
      var lx0 = m, lx1 = m + t;                       // слід лівої стінки по X
      var rx0 = W - m - t, rx1 = W - m;               // правої
      if (F.left) {
        add('left', 'Ліва', sideA, hi, [
          edge(sideA, F.bottom, function (s0, s1) {
            slotIn('bottom', lx0, sy1 - s0, lx1, sy1 - s1);
          }),
          edge(hi, F.front, function (s0, s1) {
            slotIn('front', lx0, wz0 + s0, lx1, wz0 + s1);
          }, 0, hiF),
          edge(sideA, TOP, function (s0, s1) {
            slotIn('top', lx0, sy0 + s0, lx1, sy0 + s1);
          }),
          edge(hi, F.back, function (s0, s1) {
            slotIn('back', lx0, wz0 + hi - s0, lx1, wz0 + hi - s1);
          }, hi - hiB, hi)
        ], leftNotch);
      }
      if (F.right) {
        add('right', 'Права', sideA, hi, [
          edge(sideA, F.bottom, function (s0, s1) {
            slotIn('bottom', rx0, sy0 + s0, rx1, sy0 + s1);
          }),
          edge(hi, F.back, function (s0, s1) {
            slotIn('back', rx0, wz0 + s0, rx1, wz0 + s1);
          }, 0, hiB),
          edge(sideA, TOP, function (s0, s1) {
            slotIn('top', rx0, sy1 - s0, rx1, sy1 - s1);
          }),
          edge(hi, F.front, function (s0, s1) {
            slotIn('front', rx0, wz0 + hi - s0, rx1, wz0 + hi - s1);
          }, hi - hiF, hi)
        ], rightNotch);
      }

      // --- перед і зад: язички тільки вниз і вгору, боки вони приймають самі ---
      var fy0 = m, fy1 = m + t;                       // слід передньої стінки по Y
      var by0 = D - m - t, by1 = D - m;               // задньої
      if (F.front) {
        add('front', 'Передня', W, hiF, [
          edge(W, F.bottom, function (s0, s1) { slotIn('bottom', s0, fy0, s1, fy1); }),
          plainEdge(hiF),
          edge(W, TOP && !frontEntry, function (s0, s1) {
            slotIn('top', W - s0, fy0, W - s1, fy1);
          }),
          plainEdge(hiF)
        ]);
      }
      if (F.back) {
        add('back', 'Задня', W, hiB, [
          edge(W, F.bottom, function (s0, s1) { slotIn('bottom', W - s0, by0, W - s1, by1); }),
          plainEdge(hiB),
          edge(W, TOP && !backEntry, function (s0, s1) { slotIn('top', s0, by0, s1, by1); }),
          plainEdge(hiB)
        ]);
      }

      // --- дно і кришка: цілі прямокутники, уся робота в прорізах ---
      if (F.bottom) made.bottom = { name: 'Дно', A: W, B: D, e: null };
      if (TOP) made.top = { name: 'Кришка', A: W, B: D, e: null };

      ['bottom', 'top', 'front', 'back', 'left', 'right'].forEach(function (id) {
        var w = made[id];
        if (!w) return;
        panels.push({
          id: id, name: w.name, kind: 'wall',
          outline: w.e
            ? buildOutline(w.A, w.B, w.e[0], w.e[1], w.e[2], w.e[3])
            : rect(0, 0, w.A, w.B),
          holes: slots[id] || []
        });
      });
    }

    /* ---------- 4.5d стінки на пальцях ---------- */
    function fingerWalls() {
      // дно і кришка-на-шипах — «чоловічі» на всіх чотирьох ребрах
      if (F.bottom) wall('bottom', 'Дно', W, D, [
        { len: W, n: nW, male: true, on: F.front },
        { len: D, n: nD, male: true, on: F.right },
        { len: W, n: nW, male: true, on: F.back },
        { len: D, n: nD, male: true, on: F.left }
      ]);
      if (TOP) wall('top', 'Кришка', W, D, [
        { len: W, n: nW, male: true, on: F.front },
        { len: D, n: nD, male: true, on: F.right },
        { len: W, n: nW, male: true, on: F.back },
        { len: D, n: nD, male: true, on: F.left }
      ]);

      // перед / зад — паз знизу і згори, шип по боках
      if (F.front) wall('front', 'Передня', W, hF, [
        { len: W, n: nW, male: false, on: F.bottom },
        vSpec(hF, hF, false, true, F.right),
        { len: W, n: nW, male: false, on: TOP },
        vSpec(hF, hF, true, true, F.left)
      ]);
      if (F.back) wall('back', 'Задня', W, hB, [
        { len: W, n: nW, male: false, on: F.bottom },
        vSpec(hB, hB, false, true, F.left),
        { len: W, n: nW, male: false, on: TOP },
        vSpec(hB, hB, true, true, F.right)
      ]);

      // боки — паз на всіх ребрах.
      // Увага: у лівої стінки локальна вісь X перевернута (lx = D - Y),
      // тому ребро при lx=D дивиться на ПЕРЕД, а при lx=0 — на ЗАД.
      if (F.left) wall('left', 'Ліва', D, H, [
        { len: D, n: nD, male: false, on: F.bottom },
        vSpec(H, hF, false, false, F.front),
        { len: D, n: nD, male: false, on: TOP },
        vSpec(H, hB, true, false, F.back)
      ], { notches: leftNotch });
      if (F.right) wall('right', 'Права', D, H, [
        { len: D, n: nD, male: false, on: F.bottom },
        vSpec(H, hB, false, false, F.back),
        { len: D, n: nD, male: false, on: TOP },
        vSpec(H, hF, true, false, F.front)
      ], { notches: rightNotch });
    }

    /* ---------- 4.5b сама кришка-засувка ----------
     * Локально: lx — по ширині коробки, ly = 0 на ЗАЇЗНОМУ ребрі.
     */
    var lidInfo = null;
    if (slide) {
      // кришка сідає врівень із зовнішньою поверхнею боків: у пальцевому стику
      // це грань коробки, у Т-стику — на `m` углиб від неї
      var lidW = W - 2 * m - lidClear;
      var lidD = lidSpan - lidClear;
      var cn = +lidCfg.notch;
      if (!isFinite(cn) || cn < 0) cn = t;
      cn = Math.min(cn, lidW / 3, lidD / 3);

      var pull = lidCfg.pull || 'none';
      var pullSize = +lidCfg.pullSize;
      if (!isFinite(pullSize) || pullSize <= 0) pullSize = 16;
      pullSize = Math.min(pullSize, lidW * 0.6);

      var out = [[0, 0]];
      if (pull === 'half' && pullSize > 1) {
        // півкруглий вихват просто в заїзному ребрі — пальцем не промахнешся
        var pr = pullSize / 2, pcx = lidW / 2, hn = 24;
        out.push([pcx - pr, 0]);
        for (var a2 = 0; a2 <= hn; a2++) {
          var ang = Math.PI - Math.PI * a2 / hn;
          out.push([pcx + pr * Math.cos(ang), pr * Math.sin(ang)]);
        }
      }
      out.push([lidW, 0]);
      if (cn > 0.05) {
        // вирізи на стопорних кутах: дають кришці сісти до кінця навіть коли
        // в кутових шипах стоїть клей, і не дають упертись у зайвий шип
        out.push([lidW, lidD - cn], [lidW - cn, lidD - cn], [lidW - cn, lidD],
          [cn, lidD], [cn, lidD - cn], [0, lidD - cn]);
      } else {
        out.push([lidW, lidD], [0, lidD]);
      }

      var lidHoles = [];
      var bridge = Math.max(6, t * 1.5);
      var pcy = Math.min(lidD * 0.5, pullSize / 2 + bridge);
      if (pull === 'ring' && pullSize > 1) lidHoles.push(circlePts(lidW / 2, pcy, pullSize / 2));
      if (pull === 'oval' && pullSize > 1) {
        lidHoles.push(stadiumPts(lidW / 2, pcy,
          Math.min(pullSize * 1.8, lidW * 0.7), pullSize * 0.55));
      }
      if (pull !== 'none' && pull !== 'half' && pcy < pullSize / 2 + t) {
        warn.push('Хват завеликий для такої кришки — між ним і краєм майже нема ' +
          'матеріалу. Зменш розмір хвата.');
      }

      panels.push({
        id: 'lid', name: 'Кришка-засувка', kind: 'slidelid',
        outline: dedupe(out), holes: lidHoles,
        // кришка мусить ХОДИТИ, а не сідати внатяг: люфт уже заклали в розмір,
        // тому тут чиста компенсація kerf, без премії від `fit`
        off: kerf / 2, offHole: -kerf / 2
      });

      addSolid('lid', 'Кришка-засувка', m, W - m, yL0, yL1, lidZ0, lidZ1);
      lidInfo = {
        type: 'slide', dir: slideDir, z0: lidZ0, z1: lidZ1, y0: yL0, y1: yL1,
        w: lidW, d: lidD, drop: lidDrop, clear: lidClear, pull: pull, notch: cn
      };
    }

    /* ---------- 4.6 компенсація різу + метрики ---------- */
    var cutLen = 0;
    panels.forEach(function (pan) {
      // кришка-засувка компенсується інакше за решту: вона мусить ходити
      var oo = pan.off === undefined ? cOut : pan.off;
      var oh = pan.offHole === undefined ? cHole : pan.offHole;
      pan.outline = offsetPoly(pan.outline, oo);
      pan.holes = (pan.holes || []).map(function (h) { return offsetPoly(h, oh); });
      var b = bbox([pan.outline]);
      pan.w = b.x1 - b.x0;
      pan.h = b.y1 - b.y0;
      pan.contours = 1 + pan.holes.length;
      cutLen += polyLength(pan.outline);
      pan.holes.forEach(function (h) { cutLen += polyLength(h); });
    });

    /* ---------- 4.7 перевірки ---------- */
    var minSide = Math.min(W, D, H);
    if (minSide < 4 * t) {
      warn.push('Габарит ' + minSide.toFixed(1) + ' мм замалий для товщини ' + t +
        ' мм — з\'єднання вийде хирлявим.');
    }
    [['ширини', W, nW], ['глибини', D, nD], ['висоти', H, nH]].forEach(function (a) {
      if (a[1] / a[2] < t * 1.25) {
        warn.push('Крок шипа по ' + a[0] + ' (' + (a[1] / a[2]).toFixed(1) +
          ' мм) менший за 1.25× товщини — шипи будуть крихкі.');
      }
    });
    if (nx + ny > 0 && !F.bottom) {
      warn.push(divTab
        ? 'Перегородки без дна нема чим тримати: язичкам нема куди заходити, ' +
          'лишається сама розпірка. Увімкни дно або візьми наскрізні шипи.'
        : 'Перегородки без дна тримаються лише на стінках — краще увімкнути дно.');
    }
    if (nx + ny > 0 && TOP && !divTab) {
      warn.push('Перегородки заходять шипами і в кришку — коробка вийде глухою, ' +
        'кришку не зняти. Візьми кришку-засувку, перегородки на язичках у дно ' +
        'або вимкни кришку.');
    }

    /* Т-стик з'їдає габарит двічі: на втоплення і на саму стінку, з кожного
     * боку. Тому те, що для пальців ще коробка, тут може стати нічим. */
    if (TS) {
      if (innerW <= 0 || innerD <= 0 || inZ1 - inZ0 <= 0) {
        warn.push('Для Т-стику ' + W.toFixed(0) + '×' + D.toFixed(0) + '×' +
          H.toFixed(0) + ' мм замало: втоплення й стінки з\'їдають усе нутро. ' +
          'Збільш габарит або візьми пальцевий стик.');
      } else if (Math.min(innerW, innerD) < 6 * t) {
        warn.push('Стінки Т-стику втоплені на ' + t + ' мм з кожного боку — ' +
          'нутра лишилось ' + innerW.toFixed(0) + '×' + innerD.toFixed(0) +
          ' мм. На пальцях те саме нутро вийшло б більшим.');
      }
      if (t < 2) {
        warn.push('Т-стик на матеріалі ' + t + ' мм: перемичка між прорізом і ' +
          'краєм теж ' + t + ' мм — вона просто вилетить. Тонше 2 мм краще різати ' +
          'на пальцях.');
      }
    }
    if (slide && chDepth <= t) {
      warn.push('Глибина ' + D.toFixed(1) + ' мм замала для засувки — каналу нема куди йти.');
    }
    if (slide && ((frontEntry && !F.back) || (backEntry && !F.front))) {
      warn.push('Стінка на дальньому кінці вимкнена — засувку ніщо не спинить, ' +
        'вона проїде наскрізь. Увімкни ' + (frontEntry ? 'задню' : 'передню') + ' стінку.');
    }
    if (slide && lidClear < 0.1) {
      warn.push('Люфт ' + lidClear.toFixed(2) + ' мм — кришка заклинить. Тримай 0.2–0.4 мм.');
    }
    if (Object.keys(F).filter(function (k) { return F[k]; }).length < 3) {
      warn.push('Менше трьох стінок — це вже не коробка :)');
    }

    // однакові попередження прилітають з кожної перегородки — лишаємо по одному
    warn = warn.filter(function (m, k) { return warn.indexOf(m) === k; });

    return {
      panels: panels,
      solids: solids,
      warnings: warn,
      cutLength: cutLen,
      dims: { W: W, D: D, H: H, t: t },
      inner: { W: innerW, D: innerD, H: inZ1 - inZ0 },
      joint: TS ? 'tslot' : 'finger',
      fingers: fingersOut,
      dividers: { x: Xd, y: Yd, height: hDiv },
      lid: lidInfo,
      heights: { wall: H, entry: hEntry, div: hDiv, entryFace: slide ? slideDir : null }
    };
  }

  /* ==========================================================================
   *  5. РОЗКЛАДКА
   *
   *  Один лист, розмір якого підбирається сам під деталі. Ширину беремо з
   *  їхньої сумарної площі, щоб лист вийшов приблизно квадратним, і складаємо
   *  деталі полицями за спаданням висоти.
   *
   *  Це свідомо не «вписати в лист 600×400»: на виході один файл, який ти вже
   *  розкладаєш під конкретний обрізок у своїй програмі для верстата. Тут же
   *  ніщо не може «не влізти» — а отже й нема що втратити.
   * ====================================================================== */

  function layout(items, gap, margin) {
    gap = isFinite(gap) ? Math.max(0, gap) : 3;
    // поле по краях листа: деталь із шипами не мусить впиратись у саму межу —
    // інакше на прев'ю крайні шипи зливаються з рамкою, а на верстаті лист
    // ніколи не буває обрізаний рівно по контуру розкрою
    margin = isFinite(margin) ? Math.max(0, margin) : 0;
    if (!items.length) return { w: 0, h: 0, placed: [] };

    // Кожну деталь кладемо довгою стороною горизонтально: полиці виходять
    // рівніші, а листа менше. Сортування за спаданням висоти — щоб полицю
    // завжди відкривала найвища деталь, і нижчі підселялись до неї.
    var list = items.map(function (it, i) {
      var rot = it.h > it.w;
      return { it: it, w: rot ? it.h : it.w, h: rot ? it.w : it.h, rot: rot ? 90 : 0, i: i };
    }).sort(function (a, b) { return b.h - a.h || b.w - a.w || a.i - b.i; });

    var area = list.reduce(function (s, e) { return s + (e.w + gap) * (e.h + gap); }, 0);
    var widest = list.reduce(function (m, e) { return Math.max(m, e.w); }, 0);

    /* Ширину листа не вгадуємо, а перебираємо: пакування полицями дуже
     * чутливе до неї — зайві 10 мм інколи дають зайву полицю на всю висоту.
     * Прогонів мало (десяток на кілька десятків деталей), тому дешевше
     * перебрати і взяти найкращий, ніж мати рихлий лист. */
    var cands = [];
    for (var k = 0; k <= 14; k++) {
      var maxW = Math.max(widest, Math.sqrt(area * (0.6 + k * 0.15)));
      var c = pack(list, gap, maxW);
      c.ratio = c.w / Math.max(EPS, c.h);
      cands.push(c);
    }

    /* Спершу відсіюємо за ФОРМОЮ, і тільки потім міряємо площу. Навпаки не
     * можна: найменшу площу завжди дає смуга в одну колонку — кожна полиця
     * рівно по своїй деталі, нуль втрат по ширині. Площа чудова, а лист
     * непридатний: два метри висоти й нуль користі. */
    var band = cands.filter(function (c) { return c.ratio >= 0.7 && c.ratio <= 2.2; });
    var pool = band.length ? band : cands;
    pool.sort(function (a, b) {
      return (a.w * a.h) - (b.w * b.h) ||
        Math.abs(a.ratio - 1.3) - Math.abs(b.ratio - 1.3);
    });
    var best = pool[0];
    if (!margin) return { w: best.w, h: best.h, placed: best.placed };
    return {
      w: best.w + 2 * margin,
      h: best.h + 2 * margin,
      placed: best.placed.map(function (p) {
        return {
          ref: p.ref, x: p.x + margin, y: p.y + margin,
          rot: p.rot, w: p.w, h: p.h
        };
      })
    };
  }

  /** Полиці best-fit: деталь іде на полицю з найменшим залишком по висоті. */
  function pack(list, gap, maxW) {
    var shelves = [], placed = [], w = 0, h = 0;

    list.forEach(function (e) {
      var best = null;
      shelves.forEach(function (s) {
        if (s.x + e.w > maxW + EPS || e.h > s.h + EPS) return;
        var waste = s.h - e.h;
        if (!best || waste < best.waste) best = { waste: waste, s: s };
      });

      var sh;
      if (best) {
        sh = best.s;
      } else {
        var last = shelves[shelves.length - 1];
        sh = { y: last ? last.y + last.h + gap : 0, h: e.h, x: 0 };
        shelves.push(sh);
      }
      placed.push({ ref: e.it.ref, x: sh.x, y: sh.y, rot: e.rot, w: e.w, h: e.h });
      if (sh.x + e.w > w) w = sh.x + e.w;
      if (sh.y + e.h > h) h = sh.y + e.h;
      sh.x += e.w + gap;
    });

    return { w: w, h: h, placed: placed };
  }

  /** Повернути точки деталі, розвернуті на 90° і зсунуті у координати листа. */
  function placePoly(poly, place, panelBox) {
    var b = panelBox;
    return poly.map(function (pt) {
      var lx = pt[0] - b.x0, ly = pt[1] - b.y0;           // локально, Y вгору
      if (place.rot === 90) { var tmp = lx; lx = ly; ly = (b.x1 - b.x0) - tmp; }
      var hh = place.rot === 90 ? (b.x1 - b.x0) : (b.y1 - b.y0);
      return [place.x + lx, place.y + (hh - ly)];         // на листі Y вниз
    });
  }

  /* ==========================================================================
   *  ЕКСПОРТ МОДУЛЯ
   * ====================================================================== */
  var api = {
    build: build,
    layout: layout,
    placePoly: placePoly,
    bbox: bbox,
    polyLength: polyLength,
    offsetPoly: offsetPoly,
    fingerCount: fingerCount,
    _internals: {
      buildOutline: buildOutline, fingerEdge: fingerEdge, plainEdge: plainEdge,
      partEdge: partEdge, notchEdge: notchEdge, tabSegs: tabSegs, offAt: offAt,
      mergeSegs: mergeSegs, circlePts: circlePts, stadiumPts: stadiumPts,
      tabEdge: tabEdge, outSegs: outSegs
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.BoxGeom = api;

})(typeof window !== 'undefined' ? window : globalThis);
