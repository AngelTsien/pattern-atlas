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

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("无法载入数据 (" + r.status + ")");
      return r.json();
    });
  }

  function expandBar(b) {
    if (!b) return b;
    if (Array.isArray(b)) {
      const o = { t: b[0], c: b[4] };
      if (b[1] != null) o.o = b[1];
      if (b[2] != null) o.h = b[2];
      if (b[3] != null) o.l = b[3];
      if (b.length > 5 && b[5] != null) o.v = b[5];
      return o;
    }
    return b;
  }

  function expandBars(arr) {
    return (arr || []).map(expandBar);
  }

  function expandCurrent(c) {
    const o = Object.assign({}, c, { bars: expandBars(c.bars) });
    if (o.windows) {
      o.windows = o.windows.map((w) => Object.assign({}, w, { bars: expandBars(w.bars) }));
    }
    return o;
  }

  function indexPatterns(atlas) {
    atlas._patternById = {};
    atlas._loadedTypes = atlas._loadedTypes || {};
    (atlas.patterns || []).forEach((p) => { atlas._patternById[p.id] = p; });
  }

  function prepareAtlas(data) {
    const atlas = data || {};
    atlas.current = (atlas.current || []).map(expandCurrent);
    atlas._loadedTypes = {};
    const hasBars = (atlas.patterns || []).some((p) => p.bars && p.bars.length);
    if (hasBars) {
      (atlas.patterns || []).forEach((p) => {
        p.bars = expandBars(p.bars);
        p.follow_bars = expandBars(p.follow_bars);
        if (p.pattern_type) atlas._loadedTypes[p.pattern_type] = true;
      });
    }
    indexPatterns(atlas);
    return atlas;
  }

  function loadAtlas(url) {
    const primary = url || "./data/index.json";
    return fetchJson(primary).catch((err) => {
      if (primary.indexOf("index.json") >= 0) return fetchJson("./data/atlas.json");
      throw err;
    }).then(prepareAtlas);
  }

  function shardUrl(atlas, type) {
    const shards = (atlas.meta && atlas.meta.shards) || {};
    return shards[type] || ("./data/shards/" + type + ".json");
  }

  function ensureTypes(atlas, types) {
    const need = [];
    const seen = {};
    (types || []).forEach((t) => {
      if (t && t !== "*" && !atlas._loadedTypes[t] && !seen[t]) {
        seen[t] = true;
        need.push(t);
      }
    });
    if (!need.length) return Promise.resolve(atlas);
    return Promise.all(need.map((t) => fetchJson(shardUrl(atlas, t)).then((data) => {
      (data.patterns || []).forEach((sp) => {
        const rec = (atlas._patternById && atlas._patternById[sp.id]) || sp;
        rec.bars = expandBars(sp.bars);
        rec.follow_bars = expandBars(sp.follow_bars);
        if (!atlas._patternById[sp.id]) {
          atlas.patterns = atlas.patterns || [];
          atlas.patterns.push(rec);
          atlas._patternById[sp.id] = rec;
        }
      });
      atlas._loadedTypes[t] = true;
    }).catch((err) => {
      console.warn("shard failed", t, err);
      atlas._loadedTypes[t] = "error";
    }))).then(() => atlas);
  }

  function ensurePatternIds(atlas, ids) {
    const types = [];
    (ids || []).forEach((id) => {
      const pat = getPattern(atlas, id);
      if (pat && pat.pattern_type && !(pat.bars && pat.bars.length)) types.push(pat.pattern_type);
    });
    return ensureTypes(atlas, types);
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

  function isCloseOnlyBars(bars) {
    if (!Array.isArray(bars) || !bars.length) return false;
    return bars.every((b) => {
      if (b == null || b.c == null) return false;
      const c = Number(b.c);
      if (!Number.isFinite(c)) return false;
      if (b.o == null && b.h == null && b.l == null) return true;
      const o = b.o == null ? c : Number(b.o);
      const h = b.h == null ? c : Number(b.h);
      const l = b.l == null ? c : Number(b.l);
      return o === c && h === c && l === c;
    });
  }

  function sampleIsCloseOnly(pattern) {
    if (!pattern) return false;
    const all = (pattern.bars || []).concat(pattern.follow_bars || []);
    return isCloseOnlyBars(all);
  }

  function inferBarStep(bars) {
    if (!bars || bars.length < 2) return 86400;
    const ds = [];
    for (let i = 1; i < bars.length && i < 8; i++) {
      const d = bars[i].t - bars[i - 1].t;
      if (d > 0) ds.push(d);
    }
    ds.sort((a, b) => a - b);
    return ds.length ? ds[Math.floor(ds.length / 2)] : 86400;
  }

  function rebaseToAnchor(bars, anchorClose) {
    if (!bars || !anchorClose) return bars || [];
    const f = (x) => (x == null ? x : (Number(x) / anchorClose - 1) * 100);
    return bars.map((b) => {
      const o = { t: b.t, c: f(b.c) };
      if (b.o != null) o.o = f(b.o);
      if (b.h != null) o.h = f(b.h);
      if (b.l != null) o.l = f(b.l);
      if (b.v != null) o.v = b.v;
      return o;
    });
  }

  function retargetTimes(bars, times) {
    const n = Math.min(bars.length, times.length);
    const out = [];
    for (let i = 0; i < n; i++) out.push(Object.assign({}, bars[i], { t: times[i] }));
    return out;
  }

  function takeRight(arr, len) {
    if (!arr) return [];
    return arr.length <= len ? arr.slice() : arr.slice(arr.length - len);
  }

  function typicalSamples(atlas, { type, instrument, timeframe }, n) {
    n = n || 3;
    let list = patternsFor(atlas, { instrument: instrument, timeframe: timeframe, type: type })
      .filter((p) => p.origin !== "match")
      .sort((a, b) => (b.typicality || 0) - (a.typicality || 0));
    if (list.length < n) {
      const extra = patternsFor(atlas, { type: type })
        .filter((p) => p.origin !== "match" && !list.some((x) => x.id === p.id))
        .sort((a, b) => (b.typicality || 0) - (a.typicality || 0));
      list = list.concat(extra);
    }
    return list.slice(0, n);
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
    ensureTypes,
    ensurePatternIds,
    expandBars,
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
    isCloseOnlyBars,
    sampleIsCloseOnly,
    inferBarStep,
    rebaseToAnchor,
    retargetTimes,
    takeRight,
    typicalSamples,
    overlaySeries,
    sparkValues,
    primaryInstruments,
    currentWindows,
    resolveCurrent,
    patternTypeName,
  };
})(window);
