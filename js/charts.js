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

  const MAX_MOUNTED = 14;
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

  function evictIfNeeded(keep) {
    if (mounted.length < MAX_MOUNTED) return;
    const evict = mounted.filter((el) => el !== keep && !el._isIntersecting);
    const victims = evict.length ? evict : mounted.filter((el) => el !== keep);
    while (mounted.length >= MAX_MOUNTED && victims.length) {
      unmountEl(victims.shift());
    }
  }

  function mountEl(el) {
    el._isIntersecting = true;
    if (el._chart || !el._factory) return;
    evictIfNeeded(el);
    try {
      el._chart = el._factory(el);
      if (el._chart && mounted.indexOf(el) < 0) mounted.push(el);
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

  function attachSeparator(chart, host, time) {
    const line = document.createElement("div");
    line.className = "chart-sep";
    line.setAttribute("aria-hidden", "true");
    host.appendChild(line);
    const label = document.createElement("div");
    label.className = "chart-sep-label";
    label.textContent = "此后";
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

    const pattern = (opts && opts.bars) || [];
    const follow = (opts && opts.followBars) || [];
    const hasFollow = follow.length > 0;
    const useBD = decideBusinessDay([pattern, follow]);
    const palPat = (opts && opts.currentOnly)
      ? { up: COLORS.up, down: COLORS.down }
      : { up: COLORS.cyan, down: COLORS.cyanDown };
    const palFol = { up: COLORS.gold, down: COLORS.goldDown };
    const closePat = Atlas.isCloseOnlyBars(pattern);
    const closeFol = hasFollow && Atlas.isCloseOnlyBars(follow);
    const lineColorPat = (opts && opts.currentOnly) ? COLORS.up : COLORS.cyan;

    if (closePat) {
      const sPat = chart.addSeries(L.LineSeries, {
        color: lineColorPat,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerRadius: 3,
        title: "",
      });
      sPat.setData(toLine(pattern, useBD));
    } else {
      const sPat = chart.addSeries(L.CandlestickSeries, {
        lastValueVisible: false,
        priceLineVisible: false,
        title: "",
      });
      sPat.setData(toCandles(pattern, palPat, useBD));
    }

    if (hasFollow) {
      if (closeFol) {
        const sFol = chart.addSeries(L.LineSeries, {
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
        const sFol = chart.addSeries(L.CandlestickSeries, {
          lastValueVisible: false,
          priceLineVisible: false,
          title: "",
        });
        sFol.setData(toCandles(follow, palFol, useBD));
      }
    }

    if (closePat || closeFol) markCloseOnly(el);

    chart.timeScale().fitContent();
    if (hasFollow && follow[0] && follow[0].t != null) {
      attachSeparator(chart, el, asTime(follow[0].t, useBD));
    }
    return chart;
  }

  global.Charts = {
    COLORS,
    watch,
    destroyAll,
    createCandleChart,
  };
})(window);
