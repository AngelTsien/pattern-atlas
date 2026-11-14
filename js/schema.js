/* Helpers for the built atlas.json (already normalized by build.py). */
(function (global) {
  const TZ = "Europe/Rome";
  const HORIZONS = [5, 10, 20];

  const KIND_CLASS = {
    reversal_bear: "bear",
    continuation_bear: "bear",
    reversal_bull: "bull",
    continuation_bull: "bull",
  };

  function loadAtlas(url) {
    return fetch(url, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("无法载入数据 (" + r.status + ")");
      return r.json();
    });
  }

  function isExample(atlas) {
    const m = (atlas && atlas.meta) || {};
    if (m.example === true) return true;
    const src = String(m.source || "").toLowerCase();
    return src === "example" || src === "sample" || src === "demo" || src === "synthetic";
  }

  function instById(atlas, id) {
    return (atlas.instruments || []).find((x) => x.id === id) || { id: id, name: id, short: id };
  }
  function tfById(atlas, id) {
    return (atlas.timeframes || []).find((x) => x.id === id) || { id: id, name: id };
  }
  function typeById(atlas, id) {
    return (atlas.pattern_types || []).find((x) => x.id === id) || { id: id, name: id, kind: "" };
  }

  function instName(atlas, id) {
    const it = instById(atlas, id);
    return it.short || it.name || id;
  }
  function instFullName(atlas, id) {
    const it = instById(atlas, id);
    if (it.short && it.name && it.short !== it.name) return it.short + " · " + it.name;
    return it.name || it.short || id;
  }
  function tfName(atlas, id) {
    return tfById(atlas, id).name || id;
  }
  function typeName(atlas, id) {
    return typeById(atlas, id).name || id;
  }
  function typeClass(atlas, id) {
    const k = (typeById(atlas, id).kind || "");
    return KIND_CLASS[k] || "";
  }

  function getCurrent(atlas, inst, tf) {
    return (atlas.current || []).find((c) => c.instrument === inst && c.timeframe === tf) || null;
  }

  function getPattern(atlas, id) {
    if (!id) return null;
    return (atlas.patterns || []).find((p) => p.id === id) || null;
  }

  function patternsFor(atlas, { instrument, timeframe, type } = {}) {
    return (atlas.patterns || []).filter((p) => {
      if (instrument && instrument !== "*" && p.instrument !== instrument) return false;
      if (timeframe && timeframe !== "*" && p.timeframe !== timeframe) return false;
      if (type && type !== "*" && p.pattern_type !== type) return false;
      return true;
    });
  }

  function getStats(atlas, instrument, timeframe, type) {
    const rows = atlas.stats || [];
    const keys = [
      [instrument || "*", timeframe || "*", type],
      [instrument || "*", "*", type],
      ["*", timeframe || "*", type],
      ["*", "*", type],
    ];
    for (const [i, t, p] of keys) {
      const hit = rows.find((s) => s.instrument === i && s.timeframe === t && s.pattern_type === p);
      if (hit) return hit;
    }
    return null;
  }

  function fmtTime(ts, timeframe) {
    if (ts == null || ts === "") return "—";
    const d = new Date(typeof ts === "number" ? (ts > 1e12 ? ts : ts * 1000) : ts);
    if (Number.isNaN(d.getTime())) return "—";
    const daily = timeframe === "1D" || timeframe === "1W";
    const opts = daily
      ? { timeZone: TZ, year: "numeric", month: "short", day: "numeric" }
      : { timeZone: TZ, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
    return new Intl.DateTimeFormat("zh-CN", opts).format(d);
  }

  function fmtDateRange(start, end, timeframe) {
    const a = fmtTime(start, timeframe);
    const b = fmtTime(end, timeframe);
    if (a === "—" && b === "—") return "—";
    if (a === b) return a;
    return a + " → " + b;
  }

  function pct(x, digits) {
    if (x == null || Number.isNaN(Number(x))) return "—";
    const n = Number(x) * 100;
    const d = digits == null ? (Math.abs(n) >= 10 ? 1 : 2) : digits;
    const s = n.toFixed(d);
    const body = (n > 0 ? "+" : "") + s + "%";
    return body.replace("-", "−");
  }

  function pctClass(x) {
    if (x == null || Number.isNaN(Number(x))) return "flat";
    if (x > 0.0005) return "up";
    if (x < -0.0005) return "down";
    return "flat";
  }

  function simPct(s) {
    if (s == null || Number.isNaN(Number(s))) return "—";
    return (Number(s) * 100).toFixed(1);
  }

  function hasOHLC(bars) {
    return Array.isArray(bars) && bars.length > 0 && bars.every((b) => b.o != null && b.h != null && b.l != null && b.c != null);
  }

  /**
   * Build overlay series pinned at the match point (end of pattern / last current bar) = 0%.
   * Returns { current, historical, follow, nPattern, nFollow }.
   * Times are unix seconds spaced by 1 day, mapped from bar offset.
   */
  function overlaySeries(currentBars, histBars, followBars) {
    const cur = currentBars || [];
    const hist = histBars || [];
    const follow = followBars || [];
    const n = Math.min(cur.length, hist.length) || Math.max(cur.length, hist.length);
    if (!n) return { current: [], historical: [], follow: [], nPattern: 0, nFollow: 0, epoch: 0 };

    const takeRight = (arr, len) => (arr.length <= len ? arr.slice() : arr.slice(arr.length - len));
    const cWin = takeRight(cur, n);
    const hWin = takeRight(hist, n);
    const cRef = cWin[cWin.length - 1] && cWin[cWin.length - 1].c;
    const hRef = hWin[hWin.length - 1] && hWin[hWin.length - 1].c;
    const epoch = 1700000000; // dummy UTC seconds
    const step = 86400;
    const timeAt = (offsetFromEnd) => epoch + (offsetFromEnd + (n - 1)) * step;
    // offsets: -(n-1) .. 0 for pattern, +1 .. +follow for continuation
    const toPts = (win, ref) => {
      if (!ref) return [];
      return win.map((b, i) => ({
        time: timeAt(i - (win.length - 1)),
        value: ((b.c / ref) - 1) * 100,
      }));
    };
    const current = toPts(cWin, cRef);
    const historical = toPts(hWin, hRef);
    const followPts = [];
    if (hRef && follow.length) {
      // connect from 0
      followPts.push({ time: timeAt(0), value: 0 });
      follow.forEach((b, i) => {
        followPts.push({ time: timeAt(i + 1), value: ((b.c / hRef) - 1) * 100 });
      });
    }
    return {
      current,
      historical,
      follow: followPts,
      nPattern: n,
      nFollow: follow.length,
      epoch,
      step,
      timeAt,
    };
  }

  function sparkValues(pattern) {
    const bars = (pattern.bars || []).concat(pattern.follow_bars || []);
    return bars.map((b) => b.c);
  }

  function primaryInstruments(atlas) {
    return (atlas.instruments || []).filter((x) => !x.match_source_only);
  }

  function currentWindows(cur) {
    if (!cur) return [];
    if (cur.windows && cur.windows.length) return cur.windows;
    return cur.bars ? [{ window: cur.window || cur.bars.length, bars: cur.bars, matches: cur.matches, match_stats: cur.match_stats }] : [];
  }

  function resolveCurrent(cur, windowSize) {
    if (!cur) return null;
    const wins = currentWindows(cur);
    let w = null;
    if (windowSize != null) w = wins.find((x) => Number(x.window) === Number(windowSize));
    if (!w) w = wins.find((x) => Number(x.window) === Number(cur.window)) || wins[0];
    if (!w) return cur;
    return Object.assign({}, cur, {
      window: w.window,
      bars: w.bars || cur.bars,
      matches: w.matches || cur.matches,
      match_stats: w.match_stats || cur.match_stats,
      start: w.start,
      end: w.end,
      rule_type: w.rule_type,
    });
  }

  function patternTypeName(atlas, pattern) {
    if (pattern && pattern.type_name) return pattern.type_name;
    const id = pattern && pattern.pattern_type;
    return typeName(atlas, id);
  }

  global.Atlas = {
    HORIZONS,
    loadAtlas,
    isExample,
    instById,
    tfById,
    typeById,
    instName,
    instFullName,
    tfName,
    typeName,
    typeClass,
    getCurrent,
    getPattern,
    patternsFor,
    getStats,
    fmtTime,
    fmtDateRange,
    pct,
    pctClass,
    simPct,
    hasOHLC,
    overlaySeries,
    sparkValues,
    primaryInstruments,
    currentWindows,
    resolveCurrent,
    patternTypeName,
  };
})(window);
