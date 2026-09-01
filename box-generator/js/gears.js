/* =============================================================================
 *  gears.js — математика евольвентних шестерень під лазер.
 *  Чистий модуль без DOM: на вхід параметри, на вихід — плоскі контури в мм
 *  і розкладка передачі, яку можна крутити.
 *
 *  Чому евольвента, а не «зубчики на око»: тільки в неї передатне відношення
 *  стале протягом усього зачеплення. Зуби, намальовані дугами чи трапеціями,
 *  на кожному кроці то підганяють, то гальмують ведену шестерню — на око це
 *  видно як тремтіння, а на дотик як хрускіт.
 *
 *  Основні розміри (m — модуль, z — кількість зубів):
 *      ділильний  d  = m·z          зубці рахуються саме по ньому
 *      вершин     da = d + 2·m      те, що міряєш штангенциркулем
 *      западин    df = d − 2.5·m    0.25·m — запас під галтель
 *      основне    db = d·cos α      з нього починається евольвента
 * ========================================================================== */

(function (global) {
  'use strict';

  var EPS = 1e-9;
  var TAU = Math.PI * 2;

  /** Евольвентна функція: inv α = tan α − α. */
  function inv(a) { return Math.tan(a) - a; }

  /** Обернена до неї: знайти α за inv α. Ньютон, бо аналітично не береться. */
  function invSolve(v) {
    if (v <= 0) return 0;
    var a = Math.pow(3 * v, 1 / 3), i, f, d;
    for (i = 0; i < 30; i++) {
      f = Math.tan(a) - a - v;
      d = Math.tan(a) * Math.tan(a);      // похідна inv: tan²α
      if (Math.abs(d) < 1e-12) break;
      a -= f / d;
      if (a <= 0) a = 1e-4;
      if (a > 1.5) a = 1.5;
    }
    return a;
  }

  /**
   * Коефіцієнт зміщення профілю. Менше 17 зубів евольвента не тримає: рейка
   * при обкатці вигризає ніжку, зуб худне в основі, а сусідка впирається
   * вершиною в те, що лишилось. Зміщення відсуває профіль назовні рівно на
   * стільки, скільки бракує, і підріз зникає — це стандартний спосіб, а не
   * хитрість.
   */
  function shiftFor(z) {
    return z >= 17 ? 0 : (17 - z) / 17;
  }

  /**
   * Половина кутової товщини зуба на радіусі r по ЕВОЛЬВЕНТІ.
   * Нижче основного кола евольвенти не існує — там працює трохоїда.
   */
  function involuteHalf(r, rb, psib) {
    if (r <= rb + EPS) return psib;
    return psib - inv(Math.acos(Math.min(1, rb / r)));
  }

  /**
   * Ніжка зуба — трохоїда, слід від кута вершини обкатної рейки.
   *
   * Це не прикраса. Якщо замість неї лишити радіальну пряму (як просилося
   * спершу), біля основи зуба залишиться зайвий метал: у шестерень до 17
   * зубів вершина сусідки заходить саме туди й упирається. На картинці це
   * виглядає як «жування», на фанері — як заклинений механізм.
   *
   * Рейка котиться по ділильному колу без ковзання: коли шестерня
   * повернулась на φ, рейка проїхала rp·φ. Слід кута її вершини в системі
   * шестерні (вісь ЗАПАДИНИ дивиться вздовж +Y):
   *     X = (px + rp·φ)·cos φ + (rp − hf)·sin φ
   *     Y = −(px + rp·φ)·sin φ + (rp − hf)·cos φ
   * де px — півширина зуба рейки на глибині hf, тобто πm/4 + hf·tan α.
   *
   * Повертає таблицю [радіус, півкут від осі ЗУБА], відсортовану за радіусом.
   */
  function trochoid(m, z, al, hf, rackH) {
    var rp = m * z / 2;
    /* Зуб рейки ЗВУЖУЄТЬСЯ до вершини: бічні грані нахилені на α, тому на
     * вершині півширина менша за половину товщини по ділильній лінії. Міряти
     * її треба від ПОВНОЇ висоти зуба рейки (1.25m), а не від того, наскільки
     * глибоко рейка занурилась: зміщення відсуває інструмент, але самої
     * рейки не переточує. */
    var px = Math.max(0, Math.PI * m / 4 - rackH * Math.tan(al));
    var pitch = Math.PI / z;              // від осі западини до осі зуба
    var tab = [], n = 90, i, f, X, Y, r, psi, s;
    for (i = 0; i <= n; i++) {
      f = (2.2 * Math.PI / z) * i / n;    // з запасом: на дрібних колесах слід довший
      s = px + rp * f;
      X = s * Math.cos(f) - (rp - hf) * Math.sin(f);
      Y = s * Math.sin(f) + (rp - hf) * Math.cos(f);
      r = Math.hypot(X, Y);
      psi = Math.atan2(X, Y);             // кут від осі западини
      tab.push([r, pitch - psi]);         // ... переводимо у півкут від осі зуба
    }
    tab.sort(function (a, b) { return a[0] - b[0]; });
    return tab;
  }

  /** Півкут трохоїди на радіусі r (лінійна інтерполяція таблиці). */
  function trochoidHalf(tab, r) {
    if (!tab.length) return null;
    if (r <= tab[0][0]) return tab[0][1];
    if (r >= tab[tab.length - 1][0]) return null;   // вище трохоїди працює евольвента
    var lo = 0, hi = tab.length - 1, mid;
    while (hi - lo > 1) {
      mid = (lo + hi) >> 1;
      if (tab[mid][0] <= r) lo = mid; else hi = mid;
    }
    var t = (r - tab[lo][0]) / Math.max(EPS, tab[hi][0] - tab[lo][0]);
    return tab[lo][1] + (tab[hi][1] - tab[lo][1]) * t;
  }

  /**
   * Контур однієї шестерні з центром у нулі. Перший зуб центрований на осі X.
   *
   * @param {object} p
   *   m         — модуль, мм
   *   z         — кількість зубів
   *   alpha     — кут зачеплення, градуси (20 — стандарт)
   *   backlash  — боковий зазор у зачепленні, мм по дузі ділильного кола
   *   kerf      — ширина різу: зуб малюємо ТОВЩИМ на kerf, лазер його й з'їсть
   *   bore      — діаметр отвору під вал, мм (0 — без отвору)
   *   steps     — точок на бік зуба
   */
  function gear(p) {
    var m = Math.max(0.05, +p.m || 1);
    var z = Math.max(4, Math.round(+p.z || 12));
    var al = (isFinite(p.alpha) ? +p.alpha : 20) * Math.PI / 180;
    var kerf = Math.max(0, +p.kerf || 0);
    var back = Math.max(0, +p.backlash || 0);
    var steps = Math.max(6, Math.round(+p.steps || 16));

    var x = isFinite(p.shift) ? +p.shift : shiftFor(z);
    var rp = m * z / 2;
    var rb = rp * Math.cos(al);
    // kerf компенсуємо прямо в профілі, а не еквідистантою готового контуру:
    // на зубі з десятками точок еквідистанта псує саме увігнуті ділянки біля
    // западини, а тут те саме досягається зсувом двох чисел
    var ra = rp + m * (1 + x) + kerf / 2;
    var rf = rp - m * (1.25 - x) + kerf / 2;
    if (rf < 0.15 * rp) rf = 0.15 * rp;

    // товщина зуба на ділильному колі: половина кроку, плюс приріст від
    // зміщення, мінус люфт, плюс kerf
    var psi = Math.PI / (2 * z) + 2 * x * Math.tan(al) / z - (back - kerf) / (2 * rp);
    if (psi < 0.02 * Math.PI / z) psi = 0.02 * Math.PI / z;
    var psib = psi + inv(al);

    /* Профіль зуба склеєний із двох кривих: знизу трохоїда (ніжка), вище
     * евольвента (робочий бік). Стик — там, де трохоїда стає вужчою за
     * евольвенту. Вище стику трохоїду брати НЕ можна: вона там уже описує
     * рух інструменту повз сусідній зуб і, якщо її послухатись, зріже цей.
     *
     * Саме розташування стику й показує, є підріз чи ні: у шестерні з 17+
     * зубами він лягає нижче основного кола (ніжка майже радіальна), а на
     * дрібних піднімається вище — тоді трохоїда законно вигризає частину
     * евольвенти, і зуб виходить із «талією». Так і має бути. */
    var troch = trochoid(m, z, al, m * (1.25 - x) - kerf / 2, 1.25 * m);
    var kAng = kerf / 2;                  // потовщення на kerf — у кутах
    var rCross = null, ti;
    for (ti = 0; ti < troch.length; ti++) {
      if (troch[ti][1] <= involuteHalf(troch[ti][0], rb, psib)) {
        rCross = troch[ti][0];
        break;
      }
    }

    function halfAt(r) {
      var v;
      if (rCross !== null && r < rCross - EPS) {
        v = trochoidHalf(troch, r);
        if (v === null) v = involuteHalf(r, rb, psib);
      } else {
        v = involuteHalf(r, rb, psib);
      }
      return Math.max(0, v + kAng / Math.max(r, EPS));
    }

    // дно западини — найнижча точка трохоїди
    rf = Math.max(rf, troch[0][0]);
    var rStart = rf;
    var thA = halfAt(ra);
    var thF = halfAt(rf);

    var pts = [];
    var i, k, r;

    for (i = 0; i < z; i++) {
      var base = TAU * i / z;

      // ліва сторона знизу вгору: радіус росте, півтовщина спадає, кут росте.
      // Крок по радіусу нерівномірний: біля ніжки крива крутіша, там точок треба
      // більше, ніж на пологій вершині
      for (k = 0; k <= steps; k++) {
        var u = k / steps;
        r = rStart + (ra - rStart) * (u * u * 0.65 + u * 0.35);
        pts.push(pol(base - halfAt(r), r));
      }
      // вершина зуба
      for (k = 1; k < 4; k++) {
        pts.push(pol(base - thA + (2 * thA) * k / 4, ra));
      }
      // права сторона згори вниз
      for (k = steps; k >= 0; k--) {
        var u2 = k / steps;
        r = rStart + (ra - rStart) * (u2 * u2 * 0.65 + u2 * 0.35);
        pts.push(pol(base + halfAt(r), r));
      }

      // дно западини до наступного зуба
      var a0 = base + thF, a1 = base + TAU / z - thF;
      if (a1 > a0) for (k = 1; k < 4; k++) pts.push(pol(a0 + (a1 - a0) * k / 4, rf));
    }

    var holes = [];
    var bore = +p.bore || 0;
    var rBore = 0;
    if (bore > 0.2) {
      // отвір ріжеться меншим рівно на kerf — вал має сісти, а не бовтатись
      rBore = Math.max(0.1, bore / 2 - kerf / 2);
      if (rBore < rf - 0.5 * m) holes.push(circleAt(0, 0, rBore));
      else rBore = 0;
    }

    /* Полегшувальні отвори в диску. Диск ділиться на три: стінка маточини,
     * самі отвори, обід під зубами. І маточина, і обід міряються модулем, а
     * не міліметрами: на дрібній шестерні міліметрові запаси з'їдають увесь
     * диск, і отвори зникають саме там, де їх видно найкраще.
     *
     * Якщо задана кількість не влазить — зменшуємо її, а не прибираємо
     * отвори зовсім: на маленькій шестерні краще три отвори, ніж жодного. */
    var nWant = Math.max(0, Math.min(12, Math.round(+p.spokes || 0)));
    if (nWant >= 3) {
      var rHub = Math.max(rBore + Math.max(1.5, 0.7 * m), 0.16 * rf);
      var rRim = rf - Math.max(1.5, m);
      var minR = Math.max(0.7, 0.3 * m);
      var nSp, rMid, byR, byGap, rSp, s, aSp;
      for (nSp = nWant; nSp >= 3; nSp--) {
        if (rRim - rHub < 2 * minR) break;
        rMid = (rHub + rRim) / 2;
        // діаметр — менший із двох обмежень: по радіусу і по проміжку між сусідами
        byR = (rRim - rHub) * 0.78;
        byGap = 2 * rMid * Math.sin(Math.PI / nSp) * 0.72;
        rSp = Math.min(byR, byGap) / 2 - kerf / 2;
        if (rSp < minR) continue;          // з меншою кількістю вони стануть більшими
        for (s = 0; s < nSp; s++) {
          aSp = TAU * s / nSp + Math.PI / nSp;
          holes.push(circleAt(rMid * Math.cos(aSp), rMid * Math.sin(aSp), rSp));
        }
        break;
      }
    }

    return {
      outline: pts, holes: holes,
      z: z, m: m, alpha: al * 180 / Math.PI, x: x,
      rp: rp, rb: rb, ra: ra, rf: rf,
      d: 2 * rp, da: 2 * ra, df: 2 * rf,
      sa: 2 * ra * thA          // товщина зуба по вершині, мм
    };

    function pol(ang, rad) { return [rad * Math.cos(ang), rad * Math.sin(ang)]; }
    function circleAt(cx, cy, rad) {
      var n = Math.max(24, Math.round(rad * 4)), c = [];
      for (var j = 0; j < n; j++) {
        c.push([cx + rad * Math.cos(TAU * j / n), cy + rad * Math.sin(TAU * j / n)]);
      }
      return c;
    }
  }

  /**
   * Передача: ланцюжок шестерень, кожна зчеплена з попередньою.
   *
   * Дві речі, які й роблять із набору кіл механізм:
   *
   * 1. Міжосьова відстань. Для зовнішнього зачеплення a = m·(z₁+z₂)/2 — сума
   *    ділильних радіусів. Помилився на пів міліметра — або заклинить, або
   *    буде люфт на пів зуба.
   *
   * 2. Фаза. Зуб однієї мусить стояти рівно навпроти западини другої, інакше
   *    на картинці зуби проходять крізь метал. Звідси
   *        θ₂ = φ + π + π/z₂ − (z₁/z₂)·(θ₁ − φ),
   *    де φ — напрямок лінії центрів. π/z₂ — це саме пів зуба, зсув із зуба
   *    на западину; останній доданок тримає фазу, коли перша шестерня стоїть
   *    не «нулем» до сусідки.
   *
   * Швидкості звідти ж: ω₂ = −ω₁·z₁/z₂. Мінус — бо сусідні крутяться в різні
   * боки, і саме він робить картинку схожою на механізм, а не на карусель.
   */
  function train(p) {
    var m = Math.max(0.05, +p.m || 1);
    var list = (p.teeth || []).map(function (t) { return Math.max(4, Math.round(t)); });
    if (!list.length) return { gears: [], box: { x0: 0, y0: 0, x1: 0, y1: 0 } };

    var ang = (isFinite(p.angle) ? +p.angle : 0) * Math.PI / 180;
    var gears = [];

    list.forEach(function (z, i) {
      var g = gear({
        m: m, z: z, alpha: p.alpha, backlash: p.backlash,
        kerf: p.kerf, bore: p.bore, steps: p.steps, spokes: p.spokes
      });
      if (!i) {
        g.cx = 0; g.cy = 0; g.phase = 0; g.rate = 1; g.axis = 0;
        gears.push(g);
        return;
      }
      var A = gears[i - 1];
      var phi = (i % 2) ? ang : -ang;      // зигзаг, щоб передача не тікала в рядок

      /* Міжосьова відстань. Для звичайних коліс це сума ділильних радіусів,
       * але щойно з'явилось зміщення — колеса треба розсунути, інакше зуби
       * заклинить. Робочий кут зачеплення шукаємо з
       *     inv αw = inv α + 2(x₁+x₂)·tan α / (z₁+z₂),
       * а сама відстань виходить з нього: aw = a·cos α / cos αw. */
      var alr = (isFinite(p.alpha) ? +p.alpha : 20) * Math.PI / 180;
      var a = m * (A.z + z) / 2;
      var xs = (A.x || 0) + (g.x || 0);
      if (xs > 1e-9) {
        var invW = inv(alr) + 2 * xs * Math.tan(alr) / (A.z + z);
        a = a * Math.cos(alr) / Math.cos(invSolve(invW));
      }
      g.cx = A.cx + a * Math.cos(phi);
      g.cy = A.cy + a * Math.sin(phi);
      g.phase = phi + Math.PI + Math.PI / z - (A.z / z) * (A.phase - phi);
      g.rate = -A.rate * A.z / z;
      g.axis = a;
      gears.push(g);
    });

    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    gears.forEach(function (g) {
      if (g.cx - g.ra < b.x0) b.x0 = g.cx - g.ra;
      if (g.cy - g.ra < b.y0) b.y0 = g.cy - g.ra;
      if (g.cx + g.ra > b.x1) b.x1 = g.cx + g.ra;
      if (g.cy + g.ra > b.y1) b.y1 = g.cy + g.ra;
    });

    return {
      gears: gears, box: b, m: m,
      ratio: gears.length > 1 ? gears[gears.length - 1].z / gears[0].z : 1,
      warnings: check(gears, p)
    };
  }

  /** Те, що зіпсує деталь на верстаті, а не в теорії. */
  function check(gears, p) {
    var w = [];
    var m = gears[0] ? gears[0].m : 1;

    /* Про підріз тут не попереджаємо: колесам до 17 зубів генератор сам дає
     * зміщення профілю, і підрізу в них немає. А от зворотний бік зміщення
     * реальний — зуб росте назовні й на дуже дрібних колесах загострюється
     * до вістря. Ось це й міряємо: товщину по самій вершині. */
    gears.forEach(function (g) {
      if (g.sa < 0.3 * g.m) {
        w.push('Зуб шестерні на ' + g.z + ' зубів загострюється: на вершині ' +
          g.sa.toFixed(2) + ' мм. Додай зубів або візьми більший модуль — ' +
          'таке вістря сколюється при першому ж зачепленні.');
      }
    });
    var thin = gears.filter(function (g) { return g.m * Math.PI / 2 < 1.2; });
    if (thin.length) {
      w.push('Зуб завтовшки ' + (m * Math.PI / 2).toFixed(2) + ' мм при модулі ' +
        m + ' — тонше за міліметр фанера просто викришиться. Бери більший модуль.');
    }
    var bore = +p.bore || 0;
    gears.forEach(function (g) {
      if (bore > 0 && bore / 2 > g.rf - m) {
        w.push('Отвір ⌀' + bore + ' мм майже дістає до западин шестерні на ' +
          g.z + ' зубів — стінки не лишиться.');
      }
    });
    if (!(+p.kerf > 0)) {
      w.push('Kerf = 0. Зуби вийдуть тоншими на ширину променя, і в зачепленні ' +
        'з`явиться люфт. Заміряй різ на обрізку і впиши.');
    }
    return w.filter(function (x, i) { return w.indexOf(x) === i; });
  }

  /** Кут повороту шестерні в момент t (обертів першої шестерні). */
  function angleAt(g, turns) {
    return g.phase + g.rate * turns * TAU;
  }

  var api = { gear: gear, train: train, angleAt: angleAt, inv: inv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.BoxGears = api;

})(typeof window !== 'undefined' ? window : globalThis);
