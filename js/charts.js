/* Candlestick charts. Requires LightweightCharts. Lazy-mount via IntersectionObserver. */
(function (global) {
  const COLORS = {
    bg: "transparent",
    text: "#9a9488",
    grid: "rgba(239, 234, 224, 0.05)",
    border: "rgba(239, 234, 224, 0.10)",
    cyan: "#7ed3c7",
    cyanDown: "#5aa8a0",
    gold: "#e8c888",
    goldDown: "#c4894a",
    up: "#5ecf9a",
    down: "#e06b73",
    cross: "rgba(239, 234, 224, 0.45)",
    sep: "rgba(215, 177, 106, 0.9)",
  };

  const MAX_MOUNTED = 36;
  const mounted = [];
  let io = null;
  const watched = new Set();

  function ensureIO() {
    if (io) return io;
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) mountEl(e.target);
        else maybeUnmount(e.target);
      });
    }, { root: null, rootMargin: "160px 0px", threshold: 0.01 });
    return io;
  }

  function isInView(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    return r.width > 0 && r.height > 0 && r.bottom > -80 && r.top < vh + 80;
  }

  function evictIfNeeded(keep) {
    if (mounted.length < MAX_MOUNTED) return;
    const evict = mounted.filter((el) => el !== keep && !isInView(el) && !el._isIntersecting);
    while (mounted.length >= MAX_MOUNTED && evict.length) {
      unmountEl(evict.shift());
    }
  }

  function mountEl(el) {
    el._isIntersecting = true;
    if (el._chart || !el._factory) return;
    evictIfNeeded(el);
    try {
      el._chart = el._factory(el);
      if (el._chart && mounted.indexOf(el) < 0) mounted.push(el);
      if (el.getAttribute("data-sync")) trySyncKey(el.getAttribute("data-sync"));
    } catch (err) {
      console.error("chart mount failed", err);
      el.classList.add("chart-error");
    }
  }

  function unmountEl(el) {
    if (!el) return;
    const i = mounted.indexOf(el);
    if (i >= 0) mounted.splice(i, 1);
    if (el._chart) {
      try {
        if (el._chart._sepCleanup) el._chart._sepCleanup();
        el._chart.remove();
      } catch (e) { /* ignore */ }
      el._chart = null;
    }
    // keep placeholder child after lightweight-charts wipes the node
    if (el._factory) {
      el.innerHTML = "";
    }
  }

  function maybeUnmount(el) {
    el._isIntersecting = false;
    if (mounted.length > MAX_MOUNTED) unmountEl(el);
  }

  function watch(el, factory) {
    if (!el) return;
    el._factory = factory;
    ensureIO().observe(el);
    watched.add(el);
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    if (rect.top < vh + 160 && rect.bottom > -160) mountEl(el);
  }

  function mountAll() {
    watched.forEach((el) => mountEl(el));
  }

  function destroyAll() {
    if (io) {
      watched.forEach((el) => {
        try { io.unobserve(el); } catch (e) { /* ignore */ }
        unmountEl(el);
        el._factory = null;
      });
    } else {
      mounted.slice().forEach(unmountEl);
    }
    watched.clear();
    mounted.length = 0;
  }

  function baseOptions(interactive, height) {
    const L = global.LightweightCharts;
    const hide = !interactive;
    return {
      autoSize: true,
      height: height || undefined,
      layout: {
        background: { type: L.ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, sans-serif',
        fontSize: hide ? 9 : 11,
        attributionLogo: !!interactive,
      },
      grid: {
        vertLines: { color: hide ? "transparent" : COLORS.grid },
        horzLines: { color: hide ? "transparent" : COLORS.grid },
      },
      rightPriceScale: {
        visible: !!interactive,
        borderColor: COLORS.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        visible: !!interactive,
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: interactive ? 3 : 1,
        fixLeftEdge: !interactive,
        fixRightEdge: !interactive,
      },
      crosshair: {
        mode: interactive ? L.CrosshairMode.Normal : L.CrosshairMode.Hidden,
        vertLine: { color: COLORS.cross, width: 1, labelBackgroundColor: "#2a2e36" },
        horzLine: { color: COLORS.cross, width: 1, labelBackgroundColor: "#2a2e36" },
      },
      handleScroll: interactive
        ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }
        : false,
      handleScale: interactive
        ? { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
        : false,
      kineticScroll: { touch: !!interactive, mouse: false },
    };
  }

  function isUtcMidnight(t) {
    return typeof t === "number" && t % 86400 === 0;
  }
  function asTime(t, useBusinessDay) {
    if (!useBusinessDay) return t;
    const d = new Date(t * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function decideBusinessDay(barsList) {
    const ts = [];
    barsList.forEach((arr) => (arr || []).forEach((b) => { if (b && b.t != null) ts.push(b.t); }));
    if (!ts.length) return false;
    if (ts.some((t) => t < 0)) return true;
    return ts.every(isUtcMidnight);
  }
  function toCandles(bars, palette, useBusinessDay) {
    return (bars || []).filter((b) => b && b.t != null && b.o != null && b.h != null && b.l != null && b.c != null)
      .map((b) => {
        const up = b.c >= b.o;
        const color = palette ? (up ? palette.up : palette.down) : (up ? COLORS.up : COLORS.down);
        return {
          time: asTime(b.t, useBusinessDay),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          color,
          borderColor: color,
          wickColor: color,
        };
      });
  }

  function toLine(bars, useBusinessDay) {
    return (bars || []).filter((b) => b && b.t != null && b.c != null)
      .map((b) => ({ time: asTime(b.t, useBusinessDay), value: b.c }));
  }

  function markCloseOnly(host) {
    if (!host || host.querySelector(".chart-close-only")) return;
    const tag = document.createElement("div");
    tag.className = "chart-close-only";
    tag.textContent = "仅收盘价";
    host.appendChild(tag);
  }

  function attachSeparator(chart, host, time, labelText) {
    const line = document.createElement("div");
    line.className = "chart-sep";
    line.setAttribute("aria-hidden", "true");
    host.appendChild(line);
    const label = document.createElement("div");
    label.className = "chart-sep-label";
    label.textContent = labelText || "此后";
    host.appendChild(label);
    function place() {
      try {
        const x = chart.timeScale().timeToCoordinate(time);
        if (x == null || Number.isNaN(x)) {
          line.style.display = "none";
          label.style.display = "none";
          return;
        }
        line.style.display = "block";
        label.style.display = "block";
        line.style.transform = "translateX(" + Math.round(x) + "px)";
        label.style.transform = "translateX(" + Math.round(x) + "px)";
      } catch (e) { /* scale not ready */ }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(place);
    const ro = new ResizeObserver(place);
    ro.observe(host);
    requestAnimationFrame(place);
    setTimeout(place, 50);
    chart._sepCleanup = function () {
      try { ro.disconnect(); } catch (e) { /* ignore */ }
      line.remove();
      label.remove();
    };
  }

  function createCandleChart(container, opts) {
    const L = global.LightweightCharts;
    const el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el || !L) return null;
    const interactive = !!(opts && opts.interactive);
    const chart = L.createChart(el, Object.assign(baseOptions(interactive, el.clientHeight || 160), {
      localization: { locale: "zh-CN" },
      timeScale: Object.assign(baseOptions(interactive).timeScale, {
        timeVisible: !!(opts && opts.timeVisible != null ? opts.timeVisible : interactive),
      }),
    }));

    let pattern = (opts && opts.bars) || [];
    let follow = (opts && opts.followBars) || [];
    if (opts && opts.normalized && pattern.length && pattern[pattern.length - 1].c) {
      const anchor = pattern[pattern.length - 1].c;
      pattern = Atlas.rebaseToAnchor(pattern, anchor);
      follow = Atlas.rebaseToAnchor(follow, anchor);
    }
    const hasFollow = follow.length > 0;
    const alignIndex = !!(opts && opts.alignIndex);
    const useBD = alignIndex ? false : decideBusinessDay([pattern, follow]);
    if (opts && opts.pricePercent) {
      chart.applyOptions({
        localization: {
          locale: "zh-CN",
          priceFormatter: (v) => {
            const n = Number(v);
            const s = n.toFixed(Math.abs(n) >= 10 ? 1 : 2);
            return (n > 0 ? "+" : "") + s + "%";
          },
        },
      });
    }
    const INDEX_EPOCH = 1700000000;
    const INDEX_STEP = 86400;
    if (alignIndex) {
      const n = pattern.length;
      const padN = ((opts && opts.padAfter) || 0) + follow.length;
      const patT = [];
      for (let i = 0; i < n; i++) patT.push(INDEX_EPOCH + i * INDEX_STEP);
      const folT = [];
      for (let i = 0; i < follow.length; i++) folT.push(INDEX_EPOCH + (n + i) * INDEX_STEP);
      if (n) pattern = Atlas.retargetTimes(pattern, patT);
      if (follow.length) follow = Atlas.retargetTimes(follow, folT);
      chart.applyOptions({
        localization: Object.assign({}, (opts && opts.pricePercent) ? {
          locale: "zh-CN",
          priceFormatter: (v) => {
            const num = Number(v);
            const s = num.toFixed(Math.abs(num) >= 10 ? 1 : 2);
            return (num > 0 ? "+" : "") + s + "%";
          },
        } : { locale: "zh-CN" }, {
          timeFormatter: (time) => {
            const idx = Math.round((time - INDEX_EPOCH) / INDEX_STEP) - (n - 1);
            if (idx === 0) return "0";
            return (idx > 0 ? "+" : "") + idx;
          },
        }),
        timeScale: {
          timeVisible: true,
          tickMarkFormatter: (time) => {
            const idx = Math.round((time - INDEX_EPOCH) / INDEX_STEP) - (n - 1);
            if (idx === 0) return "0";
            return (idx > 0 ? "+" : "") + idx;
          },
        },
      });
    }

    const palPat = (opts && opts.currentOnly)
      ? { up: COLORS.up, down: COLORS.down }
      : { up: COLORS.cyan, down: COLORS.cyanDown };
    const palFol = { up: COLORS.gold, down: COLORS.goldDown };
    const closePat = Atlas.isCloseOnlyBars(pattern);
    const closeFol = hasFollow && Atlas.isCloseOnlyBars(follow);
    const lineColorPat = (opts && opts.currentOnly) ? COLORS.up : COLORS.cyan;

    let sPat;
    if (closePat) {
      sPat = chart.addSeries(L.LineSeries, {
        color: lineColorPat,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerRadius: 3,
        title: "",
      });
      sPat.setData(toLine(pattern, useBD));
    } else {
      sPat = chart.addSeries(L.CandlestickSeries, {
        lastValueVisible: false,
        priceLineVisible: false,
        title: "",
      });
      const data = toCandles(pattern, palPat, useBD);
      const pad = (opts && opts.padAfter) || 0;
      if (pad && pattern.length) {
        const lastT = pattern[pattern.length - 1].t;
        const step = alignIndex ? INDEX_STEP : Atlas.inferBarStep(pattern);
        const usePadBD = alignIndex ? false : useBD;
        for (let i = 1; i <= pad; i++) {
          data.push({ time: asTime(lastT + step * i, usePadBD) });
        }
      }
      sPat.setData(data);
    }
    chart._mainSeries = sPat;

    if (hasFollow) {
      let sFol;
      if (closeFol) {
        sFol = chart.addSeries(L.LineSeries, {
          color: COLORS.gold,
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerRadius: 3,
          title: "",
        });
        const join = [];
        if (pattern.length) join.push(pattern[pattern.length - 1]);
        sFol.setData(toLine(join.concat(follow), useBD));
      } else {
        sFol = chart.addSeries(L.CandlestickSeries, {
          lastValueVisible: false,
          priceLineVisible: false,
          title: "",
        });
        sFol.setData(toCandles(follow, palFol, useBD));
      }
      chart._followSeries = sFol;
    }

    if (closePat || closeFol) markCloseOnly(el);

    chart.timeScale().fitContent();
    const sepTime = (hasFollow && follow[0] && follow[0].t != null)
      ? asTime(follow[0].t, alignIndex ? false : useBD)
      : (alignIndex && pattern.length ? pattern[pattern.length - 1].t : null);
    const sepLabel = (opts && opts.sepLabel) || (hasFollow ? "此后" : (alignIndex ? "对照点" : null));
    if (sepTime != null && sepLabel) attachSeparator(chart, el, sepTime, sepLabel);
    return chart;
  }

  function createOverlayCandleChart(container, opts) {
    const L = global.LightweightCharts;
    const el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el || !L || !opts) return null;
    const current = opts.currentBars || [];
    const hist = opts.histBars || [];
    const follow = opts.followBars || [];
    const n = Math.min(current.length, hist.length) || Math.max(current.length, hist.length);
    if (!n) return null;
    const cWin = Atlas.takeRight(current, n);
    const hWin = Atlas.takeRight(hist, n);
    const cRef = cWin[cWin.length - 1] && cWin[cWin.length - 1].c;
    const hRef = hWin[hWin.length - 1] && hWin[hWin.length - 1].c;
    const epoch = 1700000000;
    const step = 86400;
    const timesPat = [];
    for (let i = 0; i < n; i++) timesPat.push(epoch + i * step);
    const timesFol = [];
    for (let i = 0; i < follow.length; i++) timesFol.push(epoch + (n + i) * step);
    const cBars = Atlas.retargetTimes(Atlas.rebaseToAnchor(cWin, cRef), timesPat);
    const hBars = Atlas.retargetTimes(Atlas.rebaseToAnchor(hWin, hRef), timesPat);
    const fBars = Atlas.retargetTimes(Atlas.rebaseToAnchor(follow, hRef), timesFol);
    const interactive = opts.interactive !== false;
    const chart = L.createChart(el, Object.assign(baseOptions(interactive, el.clientHeight || 240), {
      localization: {
        locale: "zh-CN",
        priceFormatter: (v) => {
          const num = Number(v);
          const s = num.toFixed(Math.abs(num) >= 10 ? 1 : 2);
          return (num > 0 ? "+" : "") + s + "%";
        },
        timeFormatter: (time) => {
          const idx = Math.round((time - epoch) / step) - (n - 1);
          if (idx === 0) return "0";
          return (idx > 0 ? "+" : "") + idx;
        },
      },
      timeScale: Object.assign(baseOptions(interactive).timeScale, {
        timeVisible: true,
        tickMarkFormatter: (time) => {
          const idx = Math.round((time - epoch) / step) - (n - 1);
          if (idx === 0) return "0";
          return (idx > 0 ? "+" : "") + idx;
        },
      }),
    }));

    const closeCur = Atlas.isCloseOnlyBars(cWin);
    const closeHist = Atlas.isCloseOnlyBars(hWin.concat(follow));
    const sHist = closeHist
      ? chart.addSeries(L.LineSeries, { color: COLORS.gold, lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: "" })
      : chart.addSeries(L.CandlestickSeries, { lastValueVisible: false, priceLineVisible: false, title: "" });
    if (closeHist) sHist.setData(toLine(hBars.concat(fBars), false));
    else {
      sHist.setData(toCandles(hBars, { up: "#c4b08a", down: "#8d7350" }, false));
      if (fBars.length) {
        const sFol = chart.addSeries(L.CandlestickSeries, { lastValueVisible: false, priceLineVisible: false, title: "" });
        sFol.setData(toCandles(fBars, { up: COLORS.gold, down: COLORS.goldDown }, false));
      }
    }
    const sCur = closeCur
      ? chart.addSeries(L.LineSeries, { color: COLORS.cyan, lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: "" })
      : chart.addSeries(L.CandlestickSeries, { lastValueVisible: false, priceLineVisible: false, title: "" });
    if (closeCur) sCur.setData(toLine(cBars, false));
    else sCur.setData(toCandles(cBars, { up: COLORS.cyan, down: COLORS.cyanDown }, false));
    chart._mainSeries = sCur;
    if (closeCur || closeHist) markCloseOnly(el);

    sHist.createPriceLine({
      price: 0,
      color: "rgba(239, 234, 224, 0.28)",
      lineWidth: 1,
      lineStyle: L.LineStyle.Dotted,
      axisLabelVisible: false,
      title: "",
    });
    chart.timeScale().fitContent();
    if (timesFol.length) attachSeparator(chart, el, timesFol[0]);
    else attachSeparator(chart, el, timesPat[timesPat.length - 1]);
    return chart;
  }

  function syncPair(a, b) {
    if (!a || !b || a === b) return;
    let lock = false;
    const onRange = (src, dst) => () => {
      if (lock) return;
      const r = src.timeScale().getVisibleLogicalRange();
      if (!r) return;
      lock = true;
      try { dst.timeScale().setVisibleLogicalRange(r); } catch (e) { /* ignore */ }
      lock = false;
    };
    a.timeScale().subscribeVisibleLogicalRangeChange(onRange(a, b));
    b.timeScale().subscribeVisibleLogicalRangeChange(onRange(b, a));
    const L = global.LightweightCharts;
    const dir = (L.MismatchDirection && L.MismatchDirection.NearestLeft) || 0;
    const onMove = (src, dst) => (param) => {
      if (lock) return;
      const series = dst._mainSeries;
      if (!param || param.logical == null || !series) {
        try { dst.clearCrosshairPosition(); } catch (e) { /* ignore */ }
        return;
      }
      const pt = series.dataByIndex(Math.round(param.logical), dir);
      if (!pt || pt.time == null) {
        try { dst.clearCrosshairPosition(); } catch (e) { /* ignore */ }
        return;
      }
      const price = pt.close != null ? pt.close : pt.value;
      if (price == null) return;
      lock = true;
      try { dst.setCrosshairPosition(price, pt.time, series); } catch (e) { /* ignore */ }
      lock = false;
    };
    a.subscribeCrosshairMove(onMove(a, b));
    b.subscribeCrosshairMove(onMove(b, a));
  }

  function trySyncKey(key) {
    if (!key) return;
    const nodes = Array.from(document.querySelectorAll('[data-sync="' + key + '"]'));
    const charts = nodes.map((n) => n._chart).filter(Boolean);
    if (charts.length >= 2 && !nodes[0]._synced) {
      syncPair(charts[0], charts[1]);
      nodes.forEach((n) => { n._synced = true; });
    }
  }

  global.Charts = { mountAll, 
    COLORS,
    watch,
    destroyAll,
    createCandleChart,
    createOverlayCandleChart,
    syncPair,
    trySyncKey,
  };
})(window);
