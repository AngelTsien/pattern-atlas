/* Pattern Atlas — candlestick-first, hash routes. */
(function () {
  const $app = () => document.getElementById("app");
  const state = {
    atlas: null,
    error: null,
    tfByInst: {},
    winByKey: {},
    catalogLimit: 12,
    catalogKey: "",
    catalogSort: "end-desc",
    homeMode: "pair",
    detailNorm: false,
    resembleInst: "",
  };
  const PAGE_SIZE = 12;

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
    if (segs[0] === "resemble") return { page: "resemble", query };
    if (segs[0] === "detail") return { page: "detail", id: decodeURIComponent(segs.slice(1).join("/") || ""), query };
    return { page: "home", query };
  }

  function defaultCatalogType(atlas) {
    const types = (atlas && atlas.pattern_types) || [];
    return types.length ? types[0].id : "*";
  }

  function catalogFilters(atlas, query) {
    query = query || {};
    const origin = query.origin === "match" ? "match" : "library";
    const type = query.type || defaultCatalogType(atlas);
    const sort = query.sort || "end-desc";
    state.catalogSort = sort;
    return {
      instrument: query.instrument || "*",
      timeframe: query.timeframe || "*",
      type: type,
      origin: origin,
      sort: sort,
    };
  }

  function catalogHref(filters) {
    const p = new URLSearchParams();
    if (filters.instrument && filters.instrument !== "*") p.set("instrument", filters.instrument);
    if (filters.timeframe && filters.timeframe !== "*") p.set("timeframe", filters.timeframe);
    if (filters.type) p.set("type", filters.type);
    if (filters.origin && filters.origin !== "library") p.set("origin", filters.origin);
    if (filters.sort && filters.sort !== "end-desc") p.set("sort", filters.sort);
    const s = p.toString();
    return "#/catalog" + (s ? "?" + s : "");
  }

  function catalogList(atlas, filters) {
    const list = Atlas.patternsFor(atlas, filters).filter((pat) => {
      if (filters.origin === "library") return pat.origin !== "match";
      if (filters.origin === "match") return pat.origin === "match";
      return true;
    }).slice();
    const sort = (filters && filters.sort) || state.catalogSort || "end-desc";
    list.sort((a, b) => {
      if (sort === "end-asc") return (a.end || 0) - (b.end || 0);
      if (sort === "ret20-asc") return ((a.returns && a.returns["20"]) || 0) - ((b.returns && b.returns["20"]) || 0);
      if (sort === "ret20-desc") return ((b.returns && b.returns["20"]) || 0) - ((a.returns && a.returns["20"]) || 0);
      if (sort === "typicality") return (b.typicality || 0) - (a.typicality || 0);
      return (b.end || 0) - (a.end || 0);
    });
    return list;
  }

  function populatedTimeframes(atlas) {
    return (atlas.timeframes || []).filter((t) => Atlas.patternsFor(atlas, { timeframe: t.id }).length > 0);
  }

  function homeHref(q) {
    q = q || {};
    const p = new URLSearchParams();
    if (q.instrument) p.set("instrument", q.instrument);
    if (q.timeframe) p.set("timeframe", q.timeframe);
    if (q.window) p.set("window", String(q.window));
    if (q.mode && q.mode !== "pair") p.set("mode", q.mode);
    const s = p.toString();
    return "#/" + (s ? "?" + s : "");
  }

  function resembleHref(q) {
    const p = new URLSearchParams();
    if (q.instrument) p.set("instrument", q.instrument);
    if (q.timeframe) p.set("timeframe", q.timeframe);
    const s = p.toString();
    return "#/resemble" + (s ? "?" + s : "");
  }

  function detailHref(id, ctx) {
    ctx = ctx || state.linkCtx || {};
    const p = new URLSearchParams();
    if (ctx.from) p.set("from", ctx.from);
    if (ctx.instrument && ctx.instrument !== "*") p.set("instrument", ctx.instrument);
    if (ctx.timeframe && ctx.timeframe !== "*") p.set("timeframe", ctx.timeframe);
    if (ctx.type) p.set("type", ctx.type);
    if (ctx.origin) p.set("origin", ctx.origin);
    if (ctx.sort && ctx.sort !== "end-desc") p.set("sort", ctx.sort);
    if (ctx.window) p.set("window", String(ctx.window));
    if (ctx.mode && ctx.mode !== "pair") p.set("mode", ctx.mode);
    if (ctx.norm || state.detailNorm) p.set("norm", "1");
    const s = p.toString();
    return "#/detail/" + encodeURIComponent(id) + (s ? "?" + s : "");
  }

  function applyHomeQuery(atlas, query) {
    query = query || {};
    state.homeMode = query.mode === "overlay" ? "overlay" : "pair";
    const insts = Atlas.primaryInstruments(atlas).map((i) => i.id);
    if (query.instrument && insts.indexOf(query.instrument) >= 0) {
      if (query.timeframe && Atlas.getCurrent(atlas, query.instrument, query.timeframe)) {
        state.tfByInst[query.instrument] = query.timeframe;
      }
      const tf = state.tfByInst[query.instrument] || query.timeframe;
      if (query.window && tf) state.winByKey[winKey(query.instrument, tf)] = Number(query.window);
    } else if (query.timeframe) {
      insts.forEach((id) => {
        if (Atlas.getCurrent(atlas, id, query.timeframe)) state.tfByInst[id] = query.timeframe;
      });
    }
  }

  function forecastNote() {
    return '<p class="note-forecast">此后走势与涨跌比例来自历史样本，<strong>不是预测</strong>。</p>';
  }

  function detailNav(atlas, id, query) {
    query = query || {};
    const pat = Atlas.getPattern(atlas, id);
    if (pat && query.from !== "home") {
      if (!query.type) query = Object.assign({}, query, { type: pat.pattern_type });
      if (!query.origin) query = Object.assign({}, query, { origin: pat.origin === "match" ? "match" : "library" });
    }
    let list = [];
    let backHref = "#/catalog";
    let backLabel = "返回分类";
    if (query.from === "home") {
      const tf = query.timeframe || (query.instrument ? defaultTf(atlas, query.instrument) : "");
      if (query.window && query.instrument && tf) state.winByKey[winKey(query.instrument, tf)] = Number(query.window);
      const cur = query.instrument && tf ? viewFor(atlas, query.instrument, tf) : null;
      list = ((cur && cur.matches) || []).map((m) => m.pattern_id).filter(Boolean);
      backHref = homeHref({ instrument: query.instrument, timeframe: tf, window: query.window, mode: query.mode || state.homeMode });
      backLabel = "返回当前走势";
    } else if (query.from === "resemble") {
      backHref = resembleHref({ instrument: query.instrument, timeframe: query.timeframe });
      backLabel = "返回最像哪类";
      const filters = catalogFilters(atlas, Object.assign({}, query, { origin: query.origin || "library" }));
      list = catalogList(atlas, filters).map((p) => p.id);
    } else {
      const filters = catalogFilters(atlas, query);
      list = catalogList(atlas, filters).map((p) => p.id);
      backHref = catalogHref(filters);
    }
    const idx = list.indexOf(id);
    const ctx = {
      from: query.from || "catalog",
      instrument: query.instrument,
      timeframe: query.timeframe,
      type: query.type,
      origin: query.origin,
      sort: query.sort,
      window: query.window,
      mode: query.mode,
      norm: query.norm === "1" || state.detailNorm,
    };
    return {
      idx: idx,
      total: list.length,
      backHref: backHref,
      backLabel: backLabel,
      ctx: ctx,
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
    };
  }

  function setNav(page) {
    qsa("[data-nav]").forEach((a) => {
      const on = a.dataset.nav === page || (page === "detail" && a.dataset.nav === "catalog");
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
      if (el._factory) return;
      const spec = el.getAttribute("data-candle") || "";
      const parts = spec.split(":");
      const kind = parts[0];
      Charts.watch(el, function (node) {
        if (kind === "current") {
          const inst = parts[1], tf = parts[2];
          const cur = viewFor(atlas, inst, tf);
          if (!cur || !cur.bars || !cur.bars.length) return null;
          const best = (cur.matches || [])[0];
          const pat = best && Atlas.getPattern(atlas, best.pattern_id);
          const pad = pat && pat.follow_bars ? pat.follow_bars.length : 0;
          const pairAlign = page === "home" && state.homeMode !== "overlay";
          node.innerHTML = "";
          return Charts.createCandleChart(node, {
            bars: cur.bars,
            followBars: [],
            interactive: true,
            currentOnly: true,
            padAfter: pairAlign ? pad : 0,
            alignIndex: pairAlign,
            sepLabel: pairAlign ? "对照点" : null,
          });
        }
        if (kind === "overlay") {
          const inst = parts[1], tf = parts[2];
          const cur = viewFor(atlas, inst, tf);
          const best = cur && (cur.matches || [])[0];
          const pat = best && Atlas.getPattern(atlas, best.pattern_id);
          if (!cur || !pat || !pat.bars || !pat.bars.length) return null;
          node.innerHTML = "";
          return Charts.createOverlayCandleChart(node, {
            currentBars: cur.bars,
            histBars: pat.bars,
            followBars: pat.follow_bars,
            interactive: true,
          });
        }
        if (kind === "match" || kind === "thumb") {
          const pat = Atlas.getPattern(atlas, parts.slice(1).join(":"));
          if (!pat || !pat.bars || !pat.bars.length) return null;
          node.innerHTML = "";
          return Charts.createCandleChart(node, {
            bars: pat.bars,
            followBars: pat.follow_bars,
            interactive: kind === "match",
            alignIndex: kind === "match" && page === "home",
            sepLabel: kind === "match" ? "此后" : null,
          });
        }
        if (kind === "detail") {
          const pat = Atlas.getPattern(atlas, parts.slice(1).join(":"));
          if (!pat || !pat.bars || !pat.bars.length) return null;
          const tf = pat.timeframe;
          node.innerHTML = "";
          return Charts.createCandleChart(node, {
            bars: pat.bars,
            followBars: pat.follow_bars,
            interactive: true,
            timeVisible: !state.detailNorm && tf !== "1D" && tf !== "1W",
            normalized: state.detailNorm,
            pricePercent: state.detailNorm,
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

      const syncKey = inst.id + "|" + tf;
      const overlay = state.homeMode === "overlay";
      const pair = pat
        ? (
          (overlay
            ? ('<div class="thumb-label">叠加对照（对照点 = 0%）</div>' +
               '<div class="chart-box home overlay">' +
                 '<div class="chart-el home" data-candle="overlay:' + inst.id + ":" + tf + '"><div class="chart-skel"></div></div>' +
               "</div>" +
               '<div class="legend">' +
                 '<span class="current"><i></i>当前走势</span>' +
                 '<span class="hist"><i></i>历史形态</span>' +
                 '<span class="follow"><i></i>历史此后</span>' +
               "</div>")
            : ('<div class="pair-grid">' +
                '<div class="thumb-card current-card">' +
                  '<div class="thumb-label">当前走势</div>' +
                  '<div class="chart-box home">' +
                    '<div class="chart-el home" data-candle="current:' + inst.id + ":" + tf + '" data-sync="' + syncKey + '"><div class="chart-skel"></div></div>' +
                  "</div>" +
                  '<p class="thumb-meta">' + Atlas.fmtTime(cur.bars[0].t, tf) + " → " + Atlas.fmtTime(cur.bars[cur.bars.length - 1].t, tf) +
                  " · " + cur.bars.length + " 根。右侧留白是尚未发生的此后区间，与历史图对齐。</p>" +
                "</div>" +
                '<div class="thumb-card match-card">' +
                  '<div class="thumb-label">最相似历史</div>' +
                  '<div class="chart-box home">' +
                    '<div class="chart-el home" data-candle="match:' + pat.id + '" data-sync="' + syncKey + '"><div class="chart-skel"></div></div>' +
                  "</div>" +
                  '<p class="thumb-meta">' + escapeHtml(Atlas.instName(atlas, pat.instrument)) +
                  (pat.source_symbol ? " · " + escapeHtml(pat.source_symbol) : "") +
                  " · " + Atlas.fmtDateRange(pat.start, pat.end, pat.timeframe) + "</p>" +
                "</div>" +
              "</div>")
          ) +
          '<div class="pair-meta">' +
            '<div class="stat-block"><h3>相似度</h3><div class="score">' + Atlas.simPct(best.similarity) + "<small>%</small></div></div>" +
            "<div>" + kindBadge(atlas, pat.pattern_type, pat.type_name) + "</div>" +
            '<div class="rets">' + retCells(pat.returns || best.returns) + "</div>" +
            '<a class="link-btn" href="' + detailHref(pat.id, { from: "home", instrument: inst.id, timeframe: tf, window: cur.window, mode: state.homeMode }) + '">打开这条 K 线</a>' +
          "</div>")
        : '<p class="muted">尚未找到相似的历史形态。</p>';

      const more = rest.length
        ? ('<h3 class="section-title tight">其他接近的匹配</h3>' +
          '<div class="candle-grid">' + rest.map((m) => thumbCard(atlas, m, true, { from: "home", instrument: inst.id, timeframe: tf, window: cur.window, mode: state.homeMode })).join("") + "</div>")
        : "";

      const nearest = (cur.nearest_types || []).slice(0, 3);
      const nearHtml = nearest.length
        ? '<p class="meta-line">当前更接近：' + nearest.map((n) => escapeHtml(n.name || n.pattern_type)).join("、") +
          ' · <a href="' + resembleHref({ instrument: inst.id, timeframe: tf }) + '">查看最像哪一类</a></p>'
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
        '<p class="lede">并排时两图对齐对照点，缩放和十字线同步；叠加则把当前与历史归一化到对照点 = 0%。金色是历史此后走势，不是预测。</p>' +
        (asOf ? '<p class="meta-line">窗口截止 ' + Atlas.fmtTime(asOf, "1H") + "（罗马时间）</p>" : "") +
        '<div class="toolbar mode-bar" role="group" aria-label="对照方式">' +
          '<button type="button" class="pill' + (state.homeMode !== "overlay" ? " active" : "") + '" data-home-mode="pair">并排对照</button>' +
          '<button type="button" class="pill' + (state.homeMode === "overlay" ? " active" : "") + '" data-home-mode="overlay">叠加归一化</button>' +
          '<a class="link-btn" href="#/resemble">当前最像哪一类</a>' +
        "</div>" +
        forecastNote() +
      "</section>" +
      (blocks || '<p class="empty">还没有当前走势数据。</p>');

    scheduleCharts(atlas, "home");
    const focus = parseHash().query.instrument;
    if (focus) {
      const block = document.querySelector('[data-inst-block="' + focus + '"]');
      if (block && block.scrollIntoView) block.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }

  function thumbCard(atlas, matchOrPattern, isMatch, ctx) {
    const pat = isMatch ? Atlas.getPattern(atlas, matchOrPattern.pattern_id) : matchOrPattern;
    if (!pat) return "";
    const sim = isMatch ? matchOrPattern.similarity : null;
    return (
      '<a class="thumb-card" href="' + detailHref(pat.id, ctx) + '">' +
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

  function originTabs(filters) {
    const items = [
      { id: "library", name: "典型样本" },
      { id: "match", name: "当前匹配" },
    ];
    return items.map((it) =>
      '<a class="tab' + (filters.origin === it.id ? " active" : "") +
      '" href="' + catalogHref(Object.assign({}, filters, { origin: it.id })) +
      '" data-f="origin" data-v="' + it.id + '">' + it.name + "</a>"
    ).join("");
  }

  function loadMoreBar(shown, total) {
    if (total <= shown) {
      return total ? '<p class="page-cap">已显示全部 ' + total + " 例</p>" : "";
    }
    return (
      '<div class="load-more-wrap">' +
        '<p class="page-cap">已显示 ' + shown + " / " + total + " 例</p>" +
        '<button type="button" class="link-btn" data-load-more>加载更多</button>' +
      "</div>"
    );
  }

  function renderCatalog(atlas, query) {
    const filters = catalogFilters(atlas, query);
    const key = [filters.instrument, filters.timeframe, filters.type, filters.origin].join("|");
    if (state.catalogKey !== key) {
      state.catalogKey = key;
      state.catalogLimit = PAGE_SIZE;
    }
    const el = $app();
    const insts = Atlas.primaryInstruments(atlas);
    const list = catalogList(atlas, filters);
    const shown = Math.min(state.catalogLimit, list.length);
    const originLabel = filters.origin === "match" ? "当前匹配" : "典型样本";
    const title = (filters.type === "*" ? "全部形态" : Atlas.typeName(atlas, filters.type)) +
      " · " + originLabel + " · " + list.length + " 例";

    el.innerHTML =
      '<section class="hero">' +
        '<p class="kicker">形态分类</p>' +
        " <h1>一次只看一种形态</h1>" +
        '<p class="lede">先选形态，再在「典型样本」和「当前匹配」之间切换。每屏只加载一部分 K 线，可继续往下加载。只有收盘价的样本会画成折线，并标「仅收盘价」。</p>' +
        forecastNote() +
      "</section>" +
      '<div class="filters">' +
        '<div class="filter-row type-switch"><span class="lbl">形态</span><div class="pills">' + chips(atlas.pattern_types || [], "type", filters.type, "全部") + "</div></div>" +
        '<div class="tabs" role="tablist" aria-label="样本来源">' + originTabs(filters) + "</div>" +
        '<div class="filter-row"><span class="lbl">品种</span><div class="pills">' + chips(insts, "instrument", filters.instrument, "全部") + "</div></div>" +
        '<div class="filter-row"><span class="lbl">周期</span><div class="pills">' + chips(populatedTimeframes(atlas), "timeframe", filters.timeframe, "全部") + "</div></div>" +
        '<div class="filter-row sort-row"><label class="lbl" for="catalog-sort">排序</label>' +
          '<select id="catalog-sort" class="sort-select" data-catalog-sort>' +
            '<option value="end-desc"' + (state.catalogSort === "end-desc" ? " selected" : "") + ">时间新到旧</option>" +
            '<option value="end-asc"' + (state.catalogSort === "end-asc" ? " selected" : "") + ">时间旧到新</option>" +
            '<option value="ret20-asc"' + (state.catalogSort === "ret20-asc" ? " selected" : "") + ">此后 20 根从低到高</option>" +
            '<option value="ret20-desc"' + (state.catalogSort === "ret20-desc" ? " selected" : "") + ">此后 20 根从高到低</option>" +
            '<option value="typicality"' + (state.catalogSort === "typicality" ? " selected" : "") + ">典型度</option>" +
          "</select></div>" +
      "</div>" +
      '<h2 class="section-title">' + escapeHtml(title) + "</h2>" +
      (list.length
        ? '<div class="candle-grid catalog">' + list.slice(0, shown).map((pat) => thumbCard(atlas, pat, false, Object.assign({ from: "catalog" }, filters))).join("") + "</div>" +
          loadMoreBar(shown, list.length)
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
  function renderDetail(atlas, id, query) {
    const el = $app();
    query = query || {};
    if (query.norm === "1") state.detailNorm = true;
    if (query.norm === "0") state.detailNorm = false;
    const p = Atlas.getPattern(atlas, id);
    if (!p) {
      el.innerHTML = '<p class="empty">找不到这条形态。可能数据已更新。<a href="#/catalog">返回分类</a></p>';
      return;
    }
    const nav = detailNav(atlas, id, query);
    state.linkCtx = nav.ctx;
    const st = Atlas.getStats(atlas, p.instrument, p.timeframe, p.pattern_type);
    const mean20 = st && st.horizons && st.horizons["20"] && st.horizons["20"].mean;
    const up20 = st && st.horizons && st.horizons["20"] && st.horizons["20"].up_pct;

    el.innerHTML =
      '<section class="detail-head">' +
        '<p class="crumb"><a href="' + nav.backHref + '">' + escapeHtml(nav.backLabel) + "</a> / " +
          '<a href="' + catalogHref({ instrument: p.instrument, timeframe: p.timeframe, type: p.pattern_type, origin: query.origin, sort: query.sort }) + '">' +
          escapeHtml(Atlas.patternTypeName(atlas, p)) + "</a></p>" +
        '<div class="detail-nav">' +
          '<a class="link-btn" href="' + nav.backHref + '">' + escapeHtml(nav.backLabel) + "</a>" +
          (nav.prev ? '<a class="link-btn" href="' + detailHref(nav.prev, nav.ctx) + '">上一条</a>' : '<span class="link-btn disabled">上一条</span>') +
          (nav.total ? '<span class="page-pos">' + (nav.idx >= 0 ? (nav.idx + 1) : "—") + " / " + nav.total + "</span>" : "") +
          (nav.next ? '<a class="link-btn" href="' + detailHref(nav.next, nav.ctx) + '">下一条</a>' : '<span class="link-btn disabled">下一条</span>') +
        "</div>" +
        '<h1 class="page-title">' + escapeHtml(Atlas.patternTypeName(atlas, p)) + " · " +
          escapeHtml(Atlas.instFullName(atlas, p.instrument)) + " · " + escapeHtml(Atlas.tfName(atlas, p.timeframe)) + "</h1>" +
        '<p class="sub">' + Atlas.fmtDateRange(p.start, p.end, p.timeframe) + "（罗马时间）。青色为形态段，金色为对照点之后。可捏合缩放、拖动。</p>" +
        forecastNote() +
        '<div class="toolbar" role="group" aria-label="价格坐标">' +
          '<button type="button" class="pill' + (!state.detailNorm ? " active" : "") + '" data-detail-norm="0">原始价格</button>' +
          '<button type="button" class="pill' + (state.detailNorm ? " active" : "") + '" data-detail-norm="1">相对形态结束</button>' +
        "</div>" +
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

  function renderResemble(atlas, query) {
    const el = $app();
    const insts = Atlas.primaryInstruments(atlas);
    if (!insts.length) {
      el.innerHTML = '<p class="empty">还没有当前窗口。</p>';
      return;
    }
    const instId = query.instrument || state.resembleInst || insts[0].id;
    state.resembleInst = instId;
    const inst = insts.find((i) => i.id === instId) || insts[0];
    const tfs = availableTfs(atlas, inst.id);
    const tf = (query.timeframe && Atlas.getCurrent(atlas, inst.id, query.timeframe))
      ? query.timeframe
      : defaultTf(atlas, inst.id);
    const cur = viewFor(atlas, inst.id, tf);
    const instPills = insts.map((i) =>
      '<a class="pill' + (i.id === inst.id ? " active" : "") + '" href="#/resemble?instrument=' + encodeURIComponent(i.id) +
      "&timeframe=" + encodeURIComponent(tf) + '">' + escapeHtml(i.short || i.name) + "</a>"
    ).join("");
    const tfPills = tfs.map((titem) =>
      '<a class="pill' + (titem.id === tf ? " active" : "") + '" href="#/resemble?instrument=' + encodeURIComponent(inst.id) +
      "&timeframe=" + encodeURIComponent(titem.id) + '">' + escapeHtml(titem.name) + "</a>"
    ).join("");

    const types = (cur && cur.nearest_types) || [];
    const rows = types.map((nt, idx) => {
      const samples = Atlas.typicalSamples(atlas, { type: nt.pattern_type, instrument: inst.id, timeframe: tf }, 3);
      const fromMatches = ((cur && cur.matches) || [])
        .map((m) => Atlas.getPattern(atlas, m.pattern_id))
        .filter((pat) => pat && pat.pattern_type === nt.pattern_type);
      const seen = {};
      const thumbs = [];
      fromMatches.concat(samples).forEach((pat) => {
        if (pat && !seen[pat.id] && thumbs.length < 3) { seen[pat.id] = true; thumbs.push(pat); }
      });
      const hz = nt.type_stats || {};
      const retHtml = Atlas.HORIZONS.map((h) => {
        const s = hz[String(h)] || {};
        return '<div class="ret"><span class="h">其后 ' + h + " 根</span>" +
          '<span class="v ' + Atlas.pctClass(s.median) + '">' + Atlas.pct(s.median) + "</span>" +
          '<span class="h">向上 ' + (s.up_pct != null ? (s.up_pct * 100).toFixed(0) + "%" : "—") + "</span></div>";
      }).join("");
      const maxScore = Math.max.apply(null, types.map((x) => Number(x.score) || 0).concat([1]));
      const barW = Math.min(100, ((Number(nt.score) || 0) / maxScore) * 100);
      const href = catalogHref({ instrument: inst.id, timeframe: tf, type: nt.pattern_type, origin: "library" });
      return (
        '<article class="type-row card">' +
          '<header class="type-row-head">' +
            '<div><span class="rank"># ' + (idx + 1) + "</span> " + kindBadge(atlas, nt.pattern_type, nt.name) + "</div>" +
            '<a class="link-btn" href="' + href + '">浏览此类</a>' +
          "</header>" +
          '<div class="score-line"><span class="score tight">' + (Number(nt.score) || 0).toFixed(2) + "</span>" +
            '<div class="bar tall" title="综合接近度"><span style="width:' + barW.toFixed(1) + '%"></span></div></div>' +
          '<p class="thumb-sub">质心相关 ' + (nt.centroid_corr != null ? Number(nt.centroid_corr).toFixed(2) : "—") +
            " · 匹配占比 " + (nt.match_share != null ? (nt.match_share * 100).toFixed(0) + "%" : "—") +
            (nt.rule_hit_windows && nt.rule_hit_windows.length ? " · 规则命中窗口 " + nt.rule_hit_windows.join("、") + " 根" : "") +
          "</p>" +
          '<div class="rets">' + retHtml + "</div>" +
          (thumbs.length
            ? '<div class="candle-grid compact">' + thumbs.map((pat) => thumbCard(atlas, pat, false, { from: "resemble", instrument: inst.id, timeframe: tf, type: nt.pattern_type, origin: "library" })).join("") + "</div>"
            : '<p class="muted">还没有可展示的典型 K 线。</p>') +
        "</article>"
      );
    }).join("");

    el.innerHTML =
      '<section class="hero">' +
        '<p class="kicker">当前最像哪一类</p>' +
        "<h1>此刻的窗口，更接近哪些形态</h1>" +
        '<p class="lede">综合接近度结合了与该类质心的相关、历史匹配里该类的占比，以及规则是否在本窗口命中。下面的 5 / 10 / 20 根统计来自该类型的历史样本，不是对当前行情的预测。</p>' +
        forecastNote() +
      "</section>" +
      '<div class="filters">' +
        '<div class="filter-row"><span class="lbl">品种</span><div class="pills">' + instPills + "</div></div>" +
        '<div class="filter-row"><span class="lbl">周期</span><div class="pills">' + tfPills + "</div></div>" +
      "</div>" +
      (cur && cur.bars && cur.bars.length
        ? '<div class="card mini-current"><div class="thumb-label">' + escapeHtml(inst.name) + " · " + escapeHtml(Atlas.tfName(atlas, tf)) + " 当前窗口</div>" +
          '<div class="chart-box home">' + host("current", "current:" + inst.id + ":" + tf) + "</div></div>"
        : "") +
      (rows || '<p class="empty">这个品种和周期还没有类型判断。</p>');

    scheduleCharts(atlas, "resemble");
    if (Charts.mountAll) Charts.mountAll();
  }

  function typesForRoute(atlas, route) {
    if (route.page === "detail") {
      const pat = Atlas.getPattern(atlas, route.id);
      return pat && pat.pattern_type ? [pat.pattern_type] : [];
    }
    if (route.page === "catalog") {
      const f = catalogFilters(atlas, route.query);
      if (f.type && f.type !== "*") return [f.type];
      const list = catalogList(atlas, f).slice(0, state.catalogLimit);
      const types = [];
      list.forEach((pat) => { if (pat.pattern_type && types.indexOf(pat.pattern_type) < 0) types.push(pat.pattern_type); });
      return types;
    }
    if (route.page === "resemble") {
      const insts = Atlas.primaryInstruments(atlas);
      const instId = route.query.instrument || (insts[0] && insts[0].id);
      const tf = route.query.timeframe || (instId ? defaultTf(atlas, instId) : "");
      const cur = instId && tf ? viewFor(atlas, instId, tf) : null;
      return ((cur && cur.nearest_types) || []).map((n) => n.pattern_type).filter(Boolean);
    }
    const types = [];
    Atlas.primaryInstruments(atlas).forEach((inst) => {
      const tf = defaultTf(atlas, inst.id);
      const cur = viewFor(atlas, inst.id, tf);
      const best = cur && (cur.matches || [])[0];
      const pat = best && Atlas.getPattern(atlas, best.pattern_id);
      if (pat && pat.pattern_type && types.indexOf(pat.pattern_type) < 0) types.push(pat.pattern_type);
    });
    return types;
  }

  function hydrateAndPaint() {
    const atlas = state.atlas;
    if (!atlas || !Atlas.ensureTypes) return;
    const route = parseHash();
    const sig = location.hash;
    Atlas.ensureTypes(atlas, typesForRoute(atlas, route)).then(() => {
      if (location.hash !== sig) return;
      if (Charts.mountAll) Charts.mountAll();
    });
  }

  function render() {
    Charts.destroyAll();
    const route = parseHash();
    const atlas = state.atlas;
    if (state.error) { $app().innerHTML = '<p class="error">' + escapeHtml(state.error) + "</p>"; return; }
    if (!atlas) {
      $app().innerHTML = '<div class="loading-block"><p class="loading">正在载入图库…</p><div class="chart-box home"><div class="chart-skel"></div></div></div>';
      return;
    }
    if (route.query.norm === "1") state.detailNorm = true;
    if (route.query.norm === "0") state.detailNorm = false;
    applyHomeQuery(atlas, route.query);
    setNav(route.page);
    setBanner(Atlas.isExample(atlas));
    if (route.page === "catalog") renderCatalog(atlas, route.query);
    else if (route.page === "resemble") renderResemble(atlas, route.query);
    else if (route.page === "detail") renderDetail(atlas, route.id, route.query);
    else renderHome(atlas);
    document.title = route.page === "catalog" ? "形态分类 · 相似图形图库"
      : route.page === "resemble" ? "当前最像哪一类 · 相似图形图库"
      : route.page === "detail" ? "形态详情 · 相似图形图库"
      : "当前走势 · 相似图形图库";
    hydrateAndPaint();
  }

  document.addEventListener("click", (ev) => {
    const winBtn = ev.target.closest(".pill[data-win][data-inst]");
    if (winBtn && state.atlas) {
      ev.preventDefault();
      const inst = winBtn.dataset.inst;
      const tf = state.tfByInst[inst] || defaultTf(state.atlas, inst);
      state.winByKey[winKey(inst, tf)] = Number(winBtn.dataset.win);
      location.hash = homeHref({ instrument: inst, timeframe: tf, window: winBtn.dataset.win, mode: state.homeMode }).slice(1);
      return;
    }
    const pill = ev.target.closest(".pill[data-tf][data-inst]");
    if (pill && state.atlas) {
      ev.preventDefault();
      state.tfByInst[pill.dataset.inst] = pill.dataset.tf;
      const cur = viewFor(state.atlas, pill.dataset.inst, pill.dataset.tf);
      location.hash = homeHref({ instrument: pill.dataset.inst, timeframe: pill.dataset.tf, window: cur && cur.window, mode: state.homeMode }).slice(1);
      return;
    }
    const homeMode = ev.target.closest("[data-home-mode]");
    if (homeMode && state.atlas) {
      ev.preventDefault();
      state.homeMode = homeMode.dataset.homeMode;
      const q = parseHash().query;
      const inst = q.instrument || (Atlas.primaryInstruments(state.atlas)[0] && Atlas.primaryInstruments(state.atlas)[0].id);
      const tf = inst ? (state.tfByInst[inst] || defaultTf(state.atlas, inst)) : q.timeframe;
      const cur = inst && tf ? viewFor(state.atlas, inst, tf) : null;
      location.hash = homeHref({ instrument: inst, timeframe: tf, window: cur && cur.window, mode: state.homeMode }).slice(1);
      return;
    }
    const dnorm = ev.target.closest("[data-detail-norm]");
    if (dnorm && state.atlas) {
      ev.preventDefault();
      state.detailNorm = dnorm.dataset.detailNorm === "1";
      const route = parseHash();
      const ctx = Object.assign({}, state.linkCtx || route.query, { norm: state.detailNorm });
      location.hash = detailHref(route.id, ctx).slice(1);
      return;
    }
    const more = ev.target.closest("[data-load-more]");
    if (more && state.atlas) {
      ev.preventDefault();
      const route = parseHash();
      const filters = catalogFilters(state.atlas, route.query);
      const list = catalogList(state.atlas, filters);
      const from = state.catalogLimit;
      state.catalogLimit += PAGE_SIZE;
      const next = list.slice(from, state.catalogLimit);
      const grid = qs(".candle-grid.catalog");
      const ctx = Object.assign({ from: "catalog" }, filters);
      if (grid && next.length) grid.insertAdjacentHTML("beforeend", next.map((pat) => thumbCard(state.atlas, pat, false, ctx)).join(""));
      const bar = qs(".load-more-wrap, .page-cap");
      const html = loadMoreBar(Math.min(state.catalogLimit, list.length), list.length);
      if (bar && bar.parentNode) {
        const wrap = bar.closest(".load-more-wrap") || bar;
        wrap.outerHTML = html;
      }
      scheduleCharts(state.atlas, "catalog");
      const types = [];
      next.forEach((pat) => { if (pat.pattern_type && types.indexOf(pat.pattern_type) < 0) types.push(pat.pattern_type); });
      Atlas.ensureTypes(state.atlas, types).then(() => { if (Charts.mountAll) Charts.mountAll(); });
      return;
    }
    const chip = ev.target.closest(".chip[data-f], .tab[data-f]");
    if (chip && state.atlas) {
      ev.preventDefault();
      const route = parseHash();
      const f = Object.assign(catalogFilters(state.atlas, route.query), { [chip.dataset.f]: chip.dataset.v });
      location.hash = catalogHref(f).slice(1);
    }
  });

  document.addEventListener("change", (ev) => {
    const sel = ev.target.closest("[data-catalog-sort]");
    if (sel && state.atlas) {
      const route = parseHash();
      const f = Object.assign(catalogFilters(state.atlas, route.query), { sort: sel.value });
      state.catalogSort = sel.value;
      state.catalogLimit = PAGE_SIZE;
      location.hash = catalogHref(f).slice(1);
    }
  });

  window.addEventListener("hashchange", render);

  Atlas.loadAtlas("./data/index.json")
    .then((atlas) => { state.atlas = atlas; render(); })
    .catch((err) => { state.error = (err && err.message) ? err.message : "载入失败"; render(); });
})();
