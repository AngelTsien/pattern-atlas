/* Pattern Atlas — candlestick-first, hash routes. */
(function () {
  const $app = () => document.getElementById("app");
  const state = {
    atlas: null,
    error: null,
    tfByInst: {},
    winByKey: {},
  };

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function parseHash() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const [pathPart, queryPart] = raw.split("?");
    const path = (pathPart || "/").replace(/\/+$/, "") || "/";
    const query = {};
    if (queryPart) new URLSearchParams(queryPart).forEach((v, k) => { query[k] = v; });
    const segs = path.split("/").filter(Boolean);
    if (segs[0] === "catalog") return { page: "catalog", query };
    if (segs[0] === "detail") return { page: "detail", id: decodeURIComponent(segs.slice(1).join("/") || ""), query };
    return { page: "home", query };
  }

  function catalogHref(filters) {
    const p = new URLSearchParams();
    if (filters.instrument && filters.instrument !== "*") p.set("instrument", filters.instrument);
    if (filters.timeframe && filters.timeframe !== "*") p.set("timeframe", filters.timeframe);
    if (filters.type && filters.type !== "*") p.set("type", filters.type);
    const s = p.toString();
    return "#/catalog" + (s ? "?" + s : "");
  }
  function detailHref(id) { return "#/detail/" + encodeURIComponent(id); }

  function setNav(page) {
    qsa("[data-nav]").forEach((a) => {
      const on = (page === "home" && a.dataset.nav === "home") || (page !== "home" && a.dataset.nav === "catalog");
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  function setBanner(on) {
    const el = document.getElementById("example-banner");
    document.body.classList.toggle("has-example", !!on);
    if (!el) return;
    if (on) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function kindBadge(atlas, typeId, typeName) {
    const name = typeName || Atlas.typeName(atlas, typeId);
    const cls = Atlas.typeClass(atlas, typeId);
    return '<span class="badge ' + cls + '">' + escapeHtml(name) + "</span>";
  }
  function retCells(returns) {
    return Atlas.HORIZONS.map((h) => {
      const v = returns && returns[String(h)];
      return '<div class="ret"><span class="h">其后 ' + h + ' 根</span><span class="v ' +
        Atlas.pctClass(v) + '">' + Atlas.pct(v) + "</span></div>";
    }).join("");
  }
  function retInline(returns) {
    return Atlas.HORIZONS.map((h) => {
      const v = returns && returns[String(h)];
      return '<span class="' + Atlas.pctClass(v) + '">' + h + "根 " + Atlas.pct(v) + "</span>";
    }).join("");
  }

  function availableTfs(atlas, inst) {
    return (atlas.timeframes || []).filter((t) => Atlas.getCurrent(atlas, inst, t.id));
  }
  function defaultTf(atlas, inst) {
    if (state.tfByInst[inst] && Atlas.getCurrent(atlas, inst, state.tfByInst[inst])) {
      return state.tfByInst[inst];
    }
    const tfs = availableTfs(atlas, inst).map((t) => t.id);
    const prefer = ["1D", "4H", "1H"];
    for (const t of prefer) if (tfs.includes(t)) { state.tfByInst[inst] = t; return t; }
    const tf = tfs[0] || "1D";
    state.tfByInst[inst] = tf;
    return tf;
  }
  function winKey(inst, tf) { return inst + "|" + tf; }
  function viewFor(atlas, inst, tf) {
    const cur = Atlas.getCurrent(atlas, inst, tf);
    const w = state.winByKey[winKey(inst, tf)];
    return Atlas.resolveCurrent(cur, w);
  }

  function host(kind, payload) {
    return '<div class="chart-el ' + kind + '" data-candle="' + escapeHtml(payload) + '"><div class="chart-skel"></div></div>';
  }

  function scheduleCharts(atlas, page, extra) {
    qsa("[data-candle]").forEach((el) => {
      const spec = el.getAttribute("data-candle") || "";
      const parts = spec.split(":");
      const kind = parts[0];
      Charts.watch(el, function (node) {
        node.innerHTML = "";
        if (kind === "current") {
          const inst = parts[1], tf = parts[2];
          const cur = viewFor(atlas, inst, tf);
          return Charts.createCandleChart(node, { bars: cur && cur.bars, followBars: [], interactive: false, currentOnly: true });
        }
        if (kind === "match" || kind === "thumb") {
          const pat = Atlas.getPattern(atlas, parts.slice(1).join(":"));
          if (!pat) return null;
          return Charts.createCandleChart(node, { bars: pat.bars, followBars: pat.follow_bars, interactive: false });
        }
        if (kind === "detail") {
          const pat = Atlas.getPattern(atlas, parts.slice(1).join(":"));
          if (!pat) return null;
          const tf = pat.timeframe;
          return Charts.createCandleChart(node, {
            bars: pat.bars,
            followBars: pat.follow_bars,
            interactive: true,
            timeVisible: tf !== "1D" && tf !== "1W",
          });
        }
        return null;
      });
    });
  }

  /* ---------- home ---------- */
  function renderHome(atlas) {
    const el = $app();
    const asOf = atlas.meta && atlas.meta.as_of;
    const insts = Atlas.primaryInstruments(atlas);
    const blocks = insts.map((inst) => {
      const tfs = availableTfs(atlas, inst.id);
      if (!tfs.length) return "";
      const tf = defaultTf(atlas, inst.id);
      const cur = viewFor(atlas, inst.id, tf);
      const tfPills = tfs.map((t) =>
        '<button type="button" class="pill' + (t.id === tf ? " active" : "") +
        '" data-inst="' + inst.id + '" data-tf="' + t.id + '">' + escapeHtml(t.name) + "</button>"
      ).join("");
      const wins = Atlas.currentWindows(Atlas.getCurrent(atlas, inst.id, tf));
      const winPills = wins.length > 1
        ? '<div class="pills" role="tablist" aria-label="窗口长度">' +
          wins.map((w) =>
            '<button type="button" class="pill' + (Number(w.window) === Number(cur && cur.window) ? " active" : "") +
            '" data-inst="' + inst.id + '" data-win="' + w.window + '">' + w.window + " 根</button>"
          ).join("") + "</div>"
        : "";

      if (!cur || !cur.bars || !cur.bars.length) {
        return '<section class="inst-block"><div class="inst-head"><h2>' + escapeHtml(inst.name) +
          "</h2><div class=\"pills\">" + tfPills + "</div></div>" +
          '<div class="card"><p class="muted">这个周期还没有当前窗口。</p></div></section>';
      }
      const best = (cur.matches || [])[0];
      const pat = best && Atlas.getPattern(atlas, best.pattern_id);
      const rest = (cur.matches || []).slice(1, 7);

      const pair = pat
        ? ('<div class="pair-grid">' +
            '<div class="thumb-card current-card">' +
              '<div class="thumb-label">当前走势</div>' +
              '<div class="chart-box home">' + host("current", "current:" + inst.id + ":" + tf) + "</div>" +
              '<p class="thumb-meta">' + Atlas.fmtTime(cur.bars[0].t, tf) + " → " + Atlas.fmtTime(cur.bars[cur.bars.length - 1].t, tf) +
              " · " + cur.bars.length + " 根</p>" +
            "</div>" +
            '<a class="thumb-card match-card" href="' + detailHref(pat.id) + '">' +
              '<div class="thumb-label">最相似历史</div>' +
              '<div class="chart-box home">' + host("match", "match:" + pat.id) + "</div>" +
              '<p class="thumb-meta">' + escapeHtml(Atlas.instName(atlas, pat.instrument)) +
              (pat.source_symbol ? " · " + escapeHtml(pat.source_symbol) : "") +
              " · " + Atlas.fmtDateRange(pat.start, pat.end, pat.timeframe) + "</p>" +
            "</a>" +
          "</div>" +
          '<div class="pair-meta">' +
            '<div class="stat-block"><h3>相似度</h3><div class="score">' + Atlas.simPct(best.similarity) + "<small>%</small></div></div>" +
            "<div>" + kindBadge(atlas, pat.pattern_type, pat.type_name) + "</div>" +
            '<div class="rets">' + retCells(pat.returns || best.returns) + "</div>" +
            '<a class="link-btn" href="' + detailHref(pat.id) + '">打开这条 K 线</a>' +
          "</div>")
        : '<p class="muted">尚未找到相似的历史形态。</p>';

      const more = rest.length
        ? ('<h3 class="section-title tight">其他接近的匹配</h3>' +
          '<div class="candle-grid">' + rest.map((m) => thumbCard(atlas, m, true)).join("") + "</div>")
        : "";

      const nearest = (cur.nearest_types || []).slice(0, 3);
      const nearHtml = nearest.length
        ? '<p class="meta-line">当前更接近：' + nearest.map((n) => escapeHtml(n.name || n.pattern_type)).join("、") + "</p>"
        : "";

      return (
        '<section class="inst-block" data-inst-block="' + inst.id + '">' +
          '<div class="inst-head">' +
            "<h2>" + escapeHtml(inst.name) +
              (inst.short && inst.short !== inst.name ? "<span>" + escapeHtml(inst.short) + "</span>" : "") + "</h2>" +
            '<div class="pills" role="tablist">' + tfPills + "</div>" +
          "</div>" +
          winPills +
          '<div class="card">' + pair + nearHtml + more + "</div>" +
        "</section>"
      );
    }).join("");

    el.innerHTML =
      '<section class="hero">' +
        '<p class="kicker">当前走势</p>' +
        "<h1>用 K 线对照此刻和历史上最像的一段</h1>" +
        '<p class="lede">左侧是当前窗口的真实蜡烛图，右侧是最相似的历史片段；金色为对照点之后的走势。点进详情可以放大、拖动。</p>' +
        (asOf ? '<p class="meta-line">窗口截止 ' + Atlas.fmtTime(asOf, "1H") + "（罗马时间）</p>" : "") +
      "</section>" +
      (blocks || '<p class="empty">还没有当前走势数据。</p>');

    scheduleCharts(atlas, "home");
  }

  function thumbCard(atlas, matchOrPattern, isMatch) {
    const pat = isMatch ? Atlas.getPattern(atlas, matchOrPattern.pattern_id) : matchOrPattern;
    if (!pat) return "";
    const sim = isMatch ? matchOrPattern.similarity : null;
    return (
      '<a class="thumb-card" href="' + detailHref(pat.id) + '">' +
        '<div class="chart-box thumb">' + host("thumb", "thumb:" + pat.id) + "</div>" +
        '<div class="thumb-info">' +
          '<div class="thumb-title">' + escapeHtml(Atlas.patternTypeName(atlas, pat)) +
            " · " + escapeHtml(Atlas.instName(atlas, pat.instrument)) +
            " · " + escapeHtml(Atlas.tfName(atlas, pat.timeframe)) + "</div>" +
          '<div class="thumb-sub">' + Atlas.fmtDateRange(pat.start, pat.end, pat.timeframe) +
            (sim != null ? ' · 相似 ' + Atlas.simPct(sim) + "%" : "") + "</div>" +
          '<div class="retv">' + retInline(pat.returns || (isMatch && matchOrPattern.returns)) + "</div>" +
        "</div>" +
      "</a>"
    );
  }

  /* ---------- catalog ---------- */
  function chips(list, key, selected, allLabel) {
    return ['<button type="button" class="chip' + (selected === "*" ? " active" : "") +
      '" data-f="' + key + '" data-v="*">' + allLabel + "</button>"]
      .concat(list.map((it) =>
        '<button type="button" class="chip' + (selected === it.id ? " active" : "") +
        '" data-f="' + key + '" data-v="' + it.id + '">' + escapeHtml(it.short || it.name || it.id) + "</button>"
      )).join("");
  }

  function statsDetails(atlas, filters) {
    const types = (atlas.pattern_types || []).filter((t) => filters.type === "*" || t.id === filters.type);
    if (!types.length) return "";
    const rows = types.map((t) => {
      const st = Atlas.getStats(atlas, filters.instrument, filters.timeframe, t.id);
      const n = st ? st.n : 0;
      if (!n && filters.type === "*") return "";
      const cells = Atlas.HORIZONS.map((h) => {
        const hz = st && st.horizons && st.horizons[String(h)];
        const up = hz ? hz.up_pct : 0;
        const mid = hz ? hz.median : null;
        return '<div class="horizon-row"><span class="lab">' + h + " 根</span>" +
          '<div class="bar" title="向上 ' + (up * 100).toFixed(0) + '%"><span style="width:' + (up * 100).toFixed(1) + '%"></span></div>' +
          '<span class="mid ' + Atlas.pctClass(mid) + '">' + Atlas.pct(mid) + "</span></div>";
      }).join("");
      const samples = (st && st.horizons && st.horizons["20"] && st.horizons["20"].samples) || [];
      return '<div class="stat-mini"><header><strong>' + escapeHtml(t.name) + "</strong><span>" + n +
        " 例</span></header>" + cells +
        '<div class="hist-wrap"><canvas data-hist="' + t.id + '"></canvas></div></div>';
    }).join("");
    if (!rows.replace(/\s/g, "")) return "";
    return '<details class="stats-fold"><summary>形态统计（其后 5 / 10 / 20 根）</summary>' +
      '<div class="stat-mini-grid">' + rows + "</div></details>";
  }

  function renderCatalog(atlas, query) {
    const filters = {
      instrument: query.instrument || "*",
      timeframe: query.timeframe || "*",
      type: query.type || "*",
    };
    const el = $app();
    const insts = Atlas.primaryInstruments(atlas);
    const list = Atlas.patternsFor(atlas, filters).slice().sort((a, b) => (b.end || 0) - (a.end || 0));
    const title = (filters.type === "*" ? "全部样本" : Atlas.typeName(atlas, filters.type)) + " · " + list.length + " 例";

    el.innerHTML =
      '<section class="hero">' +
        '<p class="kicker">形态分类</p>' +
        " <h1>用 K 线浏览历史上的相似片段</h1>" +
        '<p class="lede">每张缩略图都是真实蜡烛：青色是形态段，金色是此后 20 根。统计折叠在下方，先看图再看数字。</p>' +
      "</section>" +
      '<div class="filters">' +
        '<div class="filter-row"><span class="lbl">品种</span><div class="pills">' + chips(insts, "instrument", filters.instrument, "全部") + "</div></div>" +
        '<div class="filter-row"><span class="lbl">周期</span><div class="pills">' + chips(atlas.timeframes || [], "timeframe", filters.timeframe, "全部") + "</div></div>" +
        '<div class="filter-row"><span class="lbl">形态</span><div class="pills">' + chips(atlas.pattern_types || [], "type", filters.type, "全部") + "</div></div>" +
      "</div>" +
      '<h2 class="section-title">' + escapeHtml(title) + "</h2>" +
      (list.length
        ? '<div class="candle-grid catalog">' + list.slice(0, 240).map((p) => thumbCard(atlas, p, false)).join("") + "</div>"
        : '<p class="empty">这个筛选条件下没有样本。</p>') +
      statsDetails(atlas, filters);

    qsa("canvas[data-hist]").forEach((c) => {
      const st = Atlas.getStats(atlas, filters.instrument, filters.timeframe, c.getAttribute("data-hist"));
      if (typeof Charts.drawHistogram === "function") {
        Charts.drawHistogram(c, (st && st.horizons && st.horizons["20"] && st.horizons["20"].samples) || []);
      } else {
        drawHist(c, (st && st.horizons && st.horizons["20"] && st.horizons["20"].samples) || []);
      }
    });
    scheduleCharts(atlas, "catalog");
  }

  function drawHist(canvas, samples) {
    if (!canvas) return;
    const xs = (samples || []).map(Number).filter((x) => !Number.isNaN(x));
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(120, canvas.clientWidth || 240);
    const h = Math.max(48, canvas.clientHeight || 64);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!xs.length) return;
    const absMax = Math.max.apply(null, xs.map((x) => Math.abs(x)));
    const range = Math.max(absMax * 1.1, 0.005);
    const bins = 17, counts = new Array(bins).fill(0);
    xs.forEach((x) => {
      let i = Math.floor(((x + range) / (2 * range)) * bins);
      if (i < 0) i = 0; if (i >= bins) i = bins - 1;
      counts[i]++;
    });
    const maxC = Math.max.apply(null, counts) || 1;
    const gap = 2, barW = (w - 4) / bins;
    const zeroX = 2 + ((0 + range) / (2 * range)) * (w - 4);
    ctx.strokeStyle = "rgba(239, 234, 224, 0.2)";
    ctx.beginPath(); ctx.moveTo(zeroX, 2); ctx.lineTo(zeroX, h - 2); ctx.stroke();
    counts.forEach((c, i) => {
      const x = 2 + i * barW + gap / 2;
      const bh = (c / maxC) * (h - 8);
      const center = -range + ((i + 0.5) / bins) * (2 * range);
      ctx.fillStyle = center >= 0 ? "rgba(94, 207, 154, 0.85)" : "rgba(224, 107, 115, 0.85)";
      const bw = Math.max(1, barW - gap);
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, h - 4 - bh, bw, bh, 2); ctx.fill(); }
      else ctx.fillRect(x, h - 4 - bh, bw, bh);
    });
  }

  /* ---------- detail ---------- */
  function renderDetail(atlas, id) {
    const el = $app();
    const p = Atlas.getPattern(atlas, id);
    if (!p) {
      el.innerHTML = '<p class="empty">找不到这条形态。可能数据已更新。<a href="#/catalog">返回分类</a></p>';
      return;
    }
    const st = Atlas.getStats(atlas, p.instrument, p.timeframe, p.pattern_type);
    const mean20 = st && st.horizons && st.horizons["20"] && st.horizons["20"].mean;
    const up20 = st && st.horizons && st.horizons["20"] && st.horizons["20"].up_pct;

    el.innerHTML =
      '<section class="detail-head">' +
        '<p class="crumb"><a href="#/catalog">形态分类</a> / ' +
          '<a href="' + catalogHref({ instrument: p.instrument, timeframe: p.timeframe, type: p.pattern_type }) + '">' +
          escapeHtml(Atlas.patternTypeName(atlas, p)) + "</a></p>" +
        '<h1 class="page-title">' + escapeHtml(Atlas.patternTypeName(atlas, p)) + " · " +
          escapeHtml(Atlas.instFullName(atlas, p.instrument)) + " · " + escapeHtml(Atlas.tfName(atlas, p.timeframe)) + "</h1>" +
        '<p class="sub">' + Atlas.fmtDateRange(p.start, p.end, p.timeframe) + "（罗马时间）。青色为形态段，金色为对照点之后。可捏合缩放、拖动。</p>" +
      "</section>" +
      '<div class="chart-box tall detail">' + host("detail", "detail:" + p.id) + "</div>" +
      '<div class="legend">' +
        '<span class="current"><i></i>形态段</span>' +
        '<span class="hist"><i></i>此后走势</span>' +
      "</div>" +
      '<div class="stat-strip">' +
        '<div class="cell"><div class="k">形态结束</div><div class="v">' + Atlas.fmtTime(p.end, p.timeframe) + "</div></div>" +
        '<div class="cell"><div class="k">其后 5 根</div><div class="v ' + Atlas.pctClass(p.returns && p.returns["5"]) + '">' + Atlas.pct(p.returns && p.returns["5"]) + "</div></div>" +
        '<div class="cell"><div class="k">其后 10 根</div><div class="v ' + Atlas.pctClass(p.returns && p.returns["10"]) + '">' + Atlas.pct(p.returns && p.returns["10"]) + "</div></div>" +
        '<div class="cell"><div class="k">其后 20 根</div><div class="v ' + Atlas.pctClass(p.returns && p.returns["20"]) + '">' + Atlas.pct(p.returns && p.returns["20"]) + "</div></div>" +
      "</div>" +
      '<details class="stats-fold">' +
        "<summary>样本说明与同类分布</summary>" +
        "<dl class=\"kv\">" +
          (p.source_symbol ? "<dt>行情来源</dt><dd>" + escapeHtml(p.source_symbol) + "</dd>" : "") +
          (p.window ? "<dt>窗口长度</dt><dd>" + p.window + " 根</dd>" : "") +
          (p.typicality != null ? "<dt>典型度</dt><dd>" + Number(p.typicality).toFixed(3) + "</dd>" : "") +
        "</dl>" +
        (st
          ? '<p class="muted">同类型在当前筛选口径下共 ' + st.n + " 例。其后 20 根向上比例 " +
            (up20 != null ? (up20 * 100).toFixed(0) + "%" : "—") + "，平均 " + Atlas.pct(mean20) +
            "。本例为 " + Atlas.pct(p.returns && p.returns["20"]) + "。</p>" +
            '<div class="hist-wrap"><canvas id="detail-hist" style="height:80px"></canvas>' +
            '<div class="hist-cap"><span>下跌 ←</span><span>其后 20 根涨跌分布</span><span>→ 上涨</span></div></div>'
          : "") +
        '<p class="note">形态相似不等于接下来会走同样的方向。这里只展示这一次历史样本，以及同类样本的分布。</p>' +
      "</details>";

    if (st && st.horizons && st.horizons["20"]) drawHist(qs("#detail-hist"), st.horizons["20"].samples || []);
    scheduleCharts(atlas, "detail");
  }

  /* ---------- router ---------- */
  function render() {
    Charts.destroyAll();
    const route = parseHash();
    const atlas = state.atlas;
    if (state.error) { $app().innerHTML = '<p class="error">' + escapeHtml(state.error) + "</p>"; return; }
    if (!atlas) { $app().innerHTML = '<p class="loading">正在载入…</p>'; return; }
    setNav(route.page);
    setBanner(Atlas.isExample(atlas));
    if (route.page === "catalog") renderCatalog(atlas, route.query);
    else if (route.page === "detail") renderDetail(atlas, route.id);
    else renderHome(atlas);
    document.title = route.page === "catalog" ? "形态分类 · 相似图形图库"
      : route.page === "detail" ? "形态详情 · 相似图形图库"
      : "当前走势 · 相似图形图库";
  }

  document.addEventListener("click", (ev) => {
    const winBtn = ev.target.closest(".pill[data-win][data-inst]");
    if (winBtn && state.atlas) {
      ev.preventDefault();
      const inst = winBtn.dataset.inst;
      const tf = state.tfByInst[inst] || defaultTf(state.atlas, inst);
      state.winByKey[winKey(inst, tf)] = Number(winBtn.dataset.win);
      Charts.destroyAll();
      renderHome(state.atlas);
      return;
    }
    const pill = ev.target.closest(".pill[data-tf][data-inst]");
    if (pill && state.atlas) {
      ev.preventDefault();
      state.tfByInst[pill.dataset.inst] = pill.dataset.tf;
      Charts.destroyAll();
      renderHome(state.atlas);
      return;
    }
    const chip = ev.target.closest(".chip[data-f]");
    if (chip) {
      ev.preventDefault();
      const route = parseHash();
      const f = Object.assign({
        instrument: route.query.instrument || "*",
        timeframe: route.query.timeframe || "*",
        type: route.query.type || "*",
      }, { [chip.dataset.f]: chip.dataset.v });
      location.hash = catalogHref(f).slice(1);
    }
  });

  window.addEventListener("hashchange", render);

  Atlas.loadAtlas("./data/atlas.json")
    .then((atlas) => { state.atlas = atlas; render(); })
    .catch((err) => { state.error = (err && err.message) ? err.message : "载入失败"; render(); });
})();
