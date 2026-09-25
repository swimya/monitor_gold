/* ==========================================================================
   趋势图渲染（纯原生 JS + SVG，无任何外部依赖，内联进 index.html）
   ========================================================================== */
(function () {
  'use strict';

  var dataEl = document.getElementById('report-data');
  if (!dataEl) return;

  var REPORT;
  try {
    REPORT = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  var NS = 'http://www.w3.org/2000/svg';
  var money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var money3 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  function fmtMoney(v, range) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return range < 1 ? money3.format(v) : money.format(v);
  }

  function el(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtDate(ts, span, withTime) {
    var d = new Date(ts);
    var base = d.getMonth() + 1 + '/' + d.getDate();
    if (span > 400 * 86400000) return d.getFullYear() + '/' + (d.getMonth() + 1);
    if (withTime) return base + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return base;
  }

  function fmtDateTime(ts) {
    var d = new Date(ts);
    return (
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    );
  }

  function niceStep(raw) {
    if (!isFinite(raw) || raw <= 0) return 1;
    var exp = Math.floor(Math.log10(raw));
    var base = Math.pow(10, exp);
    var norm = raw / base;
    var mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return mult * base;
  }

  function buildSeriesPoints(series, key) {
    var out = [];
    for (var i = 0; i < series.length; i += 1) {
      var v = series[i][key];
      if (v === null || v === undefined || !isFinite(v)) continue;
      out.push({ t: series[i].t, v: v });
    }
    return out;
  }

  function renderChart(host, item) {
    var key = host.getAttribute('data-value-key') || 'price';
    var points = buildSeriesPoints(item.series || [], key);

    host.innerHTML = '';
    if (points.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = '暂无足够数据，等待下一次采样…';
      host.appendChild(empty);
      return;
    }

    var width = host.clientWidth || 640;
    var height = host.clientHeight || 260;
    var pad = { l: 64, r: 16, t: 16, b: 28 };
    if (width < 480) pad.l = 52;
    var plotW = Math.max(10, width - pad.l - pad.r);
    var plotH = Math.max(10, height - pad.t - pad.b);

    var values = points.map(function (p) { return p.v; });
    var minV = Math.min.apply(null, values);
    var maxV = Math.max.apply(null, values);
    var span = maxV - minV;
    if (span <= 0) {
      var bump = Math.max(Math.abs(maxV) * 0.01, 0.5);
      minV -= bump;
      maxV += bump;
      span = maxV - minV;
    }
    var padV = span * 0.12;
    var yMin = minV - padV;
    var yMax = maxV + padV;

    var t0 = points[0].t;
    var t1 = points[points.length - 1].t;
    var tSpan = Math.max(1, t1 - t0);

    var xOf = function (t) { return pad.l + ((t - t0) / tSpan) * plotW; };
    var yOf = function (v) { return pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH; };

    var svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: width,
      height: height,
      role: 'img',
      'aria-label': item.name + ' ' + (key === 'price' ? '价格' : '单价') + '走势',
    });

    var defs = el('defs');
    var gradId = 'grad-' + item.id + '-' + key;
    var grad = el('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': item.chartColor || '#b8860b', 'stop-opacity': '0.28' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': item.chartColor || '#b8860b', 'stop-opacity': '0' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // --- Y 轴网格与刻度 ---
    var step = niceStep((yMax - yMin) / 4);
    var tick = Math.ceil(yMin / step) * step;
    var gridGroup = el('g');
    var range = maxV - minV;
    while (tick <= yMax) {
      var y = yOf(tick);
      gridGroup.appendChild(el('line', {
        x1: pad.l, x2: pad.l + plotW, y1: y, y2: y,
        stroke: 'rgba(128,140,155,0.22)', 'stroke-width': 1,
        'stroke-dasharray': '3 4',
      }));
      var label = el('text', {
        x: pad.l - 8, y: y + 4, 'text-anchor': 'end',
        'font-size': 11, fill: 'rgba(128,140,155,1)',
      });
      label.textContent = fmtMoney(tick, range);
      gridGroup.appendChild(label);
      tick += step;
    }
    svg.appendChild(gridGroup);

    // --- X 轴刻度 ---
    var withTime = tSpan <= 3 * 86400000;
    var tickCount = Math.max(2, Math.min(6, Math.floor(plotW / 120)));
    var xGroup = el('g');
    for (var i = 0; i < tickCount; i += 1) {
      var t = t0 + (tSpan * i) / (tickCount - 1);
      var x = xOf(t);
      var tx = el('text', {
        x: x, y: height - 8, 'text-anchor': 'middle',
        'font-size': 11, fill: 'rgba(128,140,155,1)',
      });
      tx.textContent = fmtDate(t, tSpan, withTime);
      xGroup.appendChild(tx);
    }
    svg.appendChild(xGroup);

    // --- 数据线 ---
    var lineParts = [];
    var areaParts = [];
    for (var j = 0; j < points.length; j += 1) {
      var px = xOf(points[j].t);
      var py = yOf(points[j].v);
      lineParts.push((j === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1));
      areaParts.push((j === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1));
    }
    if (points.length === 1) {
      lineParts.push('L' + (pad.l + plotW).toFixed(1) + ' ' + yOf(points[0].v).toFixed(1));
      areaParts.push('L' + (pad.l + plotW).toFixed(1) + ' ' + yOf(points[0].v).toFixed(1));
    }
    areaParts.push('L' + xOf(points[points.length - 1].t).toFixed(1) + ' ' + (pad.t + plotH));
    areaParts.push('L' + xOf(points[0].t).toFixed(1) + ' ' + (pad.t + plotH) + ' Z');

    svg.appendChild(el('path', { d: areaParts.join(' '), fill: 'url(#' + gradId + ')', stroke: 'none' }));
    svg.appendChild(el('path', {
      d: lineParts.join(' '),
      fill: 'none',
      stroke: item.chartColor || '#b8860b',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }));

    // --- 数据点（点多时不画，避免糊成一团）---
    if (points.length <= 150) {
      var dotGroup = el('g');
      for (var k = 0; k < points.length; k += 1) {
        dotGroup.appendChild(el('circle', {
          cx: xOf(points[k].t).toFixed(1),
          cy: yOf(points[k].v).toFixed(1),
          r: points.length > 60 ? 1.8 : 2.6,
          fill: item.chartColor || '#b8860b',
        }));
      }
      svg.appendChild(dotGroup);
    }

    // --- 悬停交互层 ---
    var hoverLine = el('line', {
      y1: pad.t, y2: pad.t + plotH, stroke: 'rgba(128,140,155,0.6)',
      'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0,
    });
    var hoverDot = el('circle', {
      r: 4.5, fill: '#fff', stroke: item.chartColor || '#b8860b', 'stroke-width': 2, opacity: 0,
    });
    svg.appendChild(hoverLine);
    svg.appendChild(hoverDot);

    var overlay = el('rect', {
      x: pad.l, y: pad.t, width: plotW, height: plotH,
      fill: 'transparent', style: 'cursor:crosshair',
    });
    svg.appendChild(overlay);

    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    host.appendChild(svg);
    host.appendChild(tip);

    var unitText = key === 'price' ? '元' : item.unitLabel || '元/克';

    function nearestIndex(clientX) {
      var rect = svg.getBoundingClientRect();
      var scale = rect.width / width;
      var x = (clientX - rect.left) / scale;
      var ratio = (x - pad.l) / plotW;
      var targetT = t0 + Math.max(0, Math.min(1, ratio)) * tSpan;
      var lo = 0;
      var hi = points.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (points[mid].t < targetT) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(points[lo - 1].t - targetT) < Math.abs(points[lo].t - targetT)) return lo - 1;
      return lo;
    }

    function showAt(clientX) {
      var idx = nearestIndex(clientX);
      var p = points[idx];
      var px = xOf(p.t);
      var py = yOf(p.v);
      hoverLine.setAttribute('x1', px);
      hoverLine.setAttribute('x2', px);
      hoverLine.setAttribute('opacity', 1);
      hoverDot.setAttribute('cx', px);
      hoverDot.setAttribute('cy', py);
      hoverDot.setAttribute('opacity', 1);

      tip.innerHTML =
        '<div>' + fmtDateTime(p.t) + '</div>' +
        '<div><b>' + fmtMoney(p.v, range) + '</b> ' + unitText + '</div>' +
        (points.length > 1 && idx > 0
          ? '<div style="opacity:.7">较上一点 ' +
            (p.v - points[idx - 1].v >= 0 ? '+' : '') + fmtMoney(p.v - points[idx - 1].v, range) + '</div>'
          : '');
      tip.classList.add('is-visible');

      var rect = svg.getBoundingClientRect();
      var scale = rect.width / width;
      var left = px * scale;
      var top = Math.max(46, py * scale - 10);
      left = Math.max(60, Math.min(rect.width - 60, left));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    function hide() {
      hoverLine.setAttribute('opacity', 0);
      hoverDot.setAttribute('opacity', 0);
      tip.classList.remove('is-visible');
    }

    overlay.addEventListener('pointermove', function (e) { showAt(e.clientX); });
    overlay.addEventListener('pointerdown', function (e) { showAt(e.clientX); });
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('pointerup', hide);
  }

  var hosts = document.querySelectorAll('.chart-host[data-item-id]');
  var itemsById = {};
  for (var i = 0; i < REPORT.items.length; i += 1) itemsById[REPORT.items[i].id] = REPORT.items[i];

  var palette = ['#b8860b', '#2f6feb', '#14884a', '#d92f2f', '#8b5cf6', '#0d9488', '#ea580c', '#0891b2'];
  for (var p = 0; p < REPORT.items.length; p += 1) {
    REPORT.items[p].chartColor = palette[p % palette.length];
  }

  var targets = [];
  for (var h = 0; h < hosts.length; h += 1) {
    var item = itemsById[hosts[h].getAttribute('data-item-id')];
    if (!item) continue;
    targets.push({ host: hosts[h], item: item });
  }

  function renderAll() {
    for (var n = 0; n < targets.length; n += 1) renderChart(targets[n].host, targets[n].item);
  }

  renderAll();

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 150);
  });

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { renderAll(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();
