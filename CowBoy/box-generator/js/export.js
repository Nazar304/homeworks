/* =============================================================================
 *  export.js — перетворення розкладених листів у файли для верстата.
 *
 *  Формат «листа», який приймають усі функції нижче:
 *  {
 *    w, h,                       // розмір листа, мм
 *    parts: [{
 *      name,                     // підпис
 *      outline: [[x,y], ...],    // зовнішній контур, мм, Y вниз (як у SVG)
 *      holes:  [[[x,y], ...]],   // внутрішні отвори
 *      cx, cy, fs                // де і яким кеглем ставити підпис
 *    }]
 *  }
 * ========================================================================== */

(function (global) {
  'use strict';

  var NL = '\r\n';
  function f(v) { return (Math.round(v * 1000) / 1000).toString(); }

  function polyToPath(poly) {
    if (!poly.length) return '';
    var d = 'M' + f(poly[0][0]) + ',' + f(poly[0][1]);
    for (var i = 1; i < poly.length; i++) d += 'L' + f(poly[i][0]) + ',' + f(poly[i][1]);
    return d + 'Z';
  }

  /* ==========================================================================
   *  SVG
   * ====================================================================== */

  /**
   * @param {object} sheet
   * @param {object} o  { labels:boolean, title:string }
   */
  function svgString(sheet, o) {
    o = o || {};
    var body = '';

    body += '  <g id="cut" fill="none" stroke="#000000" stroke-width="0.1">' + NL;
    sheet.parts.forEach(function (p) {
      if (p.outline && p.outline.length) body += '    <path d="' + polyToPath(p.outline) + '"/>' + NL;
      (p.holes || []).forEach(function (h) {
        body += '    <path d="' + polyToPath(h) + '"/>' + NL;
      });
    });
    body += '  </g>' + NL;

    if (o.labels) {
      body += '  <g id="engrave" fill="none" stroke="#ff0000" stroke-width="0.1" ' +
        'font-family="Arial, sans-serif" text-anchor="middle">' + NL;
      sheet.parts.forEach(function (p) {
        if (!p.name) return;
        var rot = p.lrot ? ' transform="rotate(' + p.lrot + ' ' + f(p.cx) + ' ' + f(p.cy) + ')"' : '';
        body += '    <text x="' + f(p.cx) + '" y="' + f(p.cy + p.fs * 0.35) +
          '" font-size="' + f(p.fs) + '"' + rot + '>' + esc(p.name) + '</text>' + NL;
      });
      body += '  </g>' + NL;
    }

    return '<?xml version="1.0" encoding="UTF-8"?>' + NL +
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1"' +
      ' width="' + f(sheet.w) + 'mm" height="' + f(sheet.h) + 'mm"' +
      ' viewBox="0 0 ' + f(sheet.w) + ' ' + f(sheet.h) + '">' + NL +
      '  <title>' + esc(o.title || 'BoxGen') + '</title>' + NL +
      body + '</svg>' + NL;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ==========================================================================
   *  DXF (R12 ASCII — читають LightBurn, RDWorks, LaserGRBL, AutoCAD, Inkscape)
   *  Вісь Y у DXF дивиться вгору, тому дзеркалимо відносно висоти листа.
   * ====================================================================== */

  function dxfString(sheet, o) {
    o = o || {};
    var s = [];
    function g(code, val) { s.push(code, val); }

    // --- заголовок: одиниці = міліметри
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$INSUNITS'); g(70, 4);
    g(9, '$MEASUREMENT'); g(70, 1);
    g(0, 'ENDSEC');

    // --- шари
    g(0, 'SECTION'); g(2, 'TABLES');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, 2);
    [['CUT', 5], ['ENGRAVE', 1]].forEach(function (L) {
      g(0, 'LAYER'); g(2, L[0]); g(70, 0); g(62, L[1]); g(6, 'CONTINUOUS');
    });
    g(0, 'ENDTAB'); g(0, 'ENDSEC');

    // --- геометрія
    g(0, 'SECTION'); g(2, 'ENTITIES');
    var Y = function (y) { return sheet.h - y; };

    function poly(pts, layer) {
      g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, 1);
      g(10, 0); g(20, 0); g(30, 0);
      pts.forEach(function (p) {
        g(0, 'VERTEX'); g(8, layer); g(10, f(p[0])); g(20, f(Y(p[1]))); g(30, 0);
      });
      g(0, 'SEQEND'); g(8, layer);
    }

    sheet.parts.forEach(function (p) {
      if (p.outline && p.outline.length) poly(p.outline, 'CUT');
      (p.holes || []).forEach(function (h) { poly(h, 'CUT'); });
    });

    if (o.labels) {
      sheet.parts.forEach(function (p) {
        if (!p.name) return;
        g(0, 'TEXT'); g(8, 'ENGRAVE');
        g(10, f(p.cx)); g(20, f(Y(p.cy))); g(30, 0);
        g(40, f(p.fs));
        g(1, p.name);
        g(50, p.lrot ? f(-p.lrot) : 0);   // кут повороту тексту, у DXF проти год. стрілки
        g(72, 1); g(73, 2);
        g(11, f(p.cx)); g(21, f(Y(p.cy))); g(31, 0);
      });
    }

    g(0, 'ENDSEC'); g(0, 'EOF');

    var out = '';
    for (var i = 0; i < s.length; i += 2) {
      out += String(s[i]) + NL + String(s[i + 1]) + NL;
    }
    return out;
  }

  /* ==========================================================================
   *  Завантаження файлів
   * ====================================================================== */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /** Кілька файлів підряд — браузери не люблять миттєву чергу, тому з паузою. */
  function downloadAll(files) {
    files.forEach(function (fl, i) {
      setTimeout(function () { download(fl.name, fl.text, fl.mime); }, i * 320);
    });
  }

  global.BoxExport = {
    svgString: svgString,
    dxfString: dxfString,
    polyToPath: polyToPath,
    download: download,
    downloadAll: downloadAll,
    esc: esc
  };

})(typeof window !== 'undefined' ? window : globalThis);
