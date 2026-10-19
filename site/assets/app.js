/* Anii · Balanka – Wörterbuch, Trainer, Offline-Funktionen. Ohne Framework, ohne externe Dienste. */
"use strict";
(() => {
  const LANG = document.documentElement.lang === "de" ? "de" : "fr";
  const OTHER = LANG === "fr" ? "de" : "fr";
  const uiEl = document.getElementById("ui");
  const T = uiEl ? JSON.parse(uiEl.textContent) : {};
  const t = (k, vars) => String(T[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => (vars && v in vars ? vars[v] : ""));
  const ROUND = 10;
  const AUTO_AUDIO_BYTES = 5 * 1024 * 1024; // bis zu dieser Größe Aufnahmen automatisch offline speichern

  // ------------------------------------------------------------ Speicher (localStorage kann fehlen)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat/voll */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
  };

  // ------------------------------------------------------------ Sprache merken, Startseite
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-lang]");
    if (a) store.set("anii_lang", a.dataset.lang);
  });
  if (document.body.classList.contains("root")) {
    const pref = store.get("anii_lang", null);
    if (pref === "fr" || pref === "de") location.replace("/" + pref + "/");
  }

  // ------------------------------------------------------------ Hilfen
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }
  function icon(name) {
    const span = document.createElement("span");
    span.className = "icon";
    span.setAttribute("aria-hidden", "true");
    const ICONS = window.ANII_ICONS || {};
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || "") + "</svg>";
    return span;
  }
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Such-Faltung – muss zu fold() in tools/anii.py passen
  const FOLD = { "ǝ": "e", "ə": "e", "ɛ": "e", "ɔ": "o", "ɩ": "i", "ɪ": "i", "ʊ": "u", "ŋ": "n", "ɖ": "d", "œ": "oe", "æ": "ae", "ß": "ss", "’": "'" };
  const stripMarks = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  const fold = (s) => stripMarks(String(s || "").toLowerCase()).replace(/[ǝəɛɔɩɪʊŋɖœæß’]/g, (c) => FOLD[c]);

  // ------------------------------------------------------------ Service Worker, Netzstatus
  const net = document.getElementById("net");
  function showNet() {
    if (!net) return;
    const off = navigator.onLine === false;
    net.className = "net " + (off ? "off" : "ok");
    const ready = navigator.serviceWorker && navigator.serviceWorker.controller;
    net.textContent = off ? "· " + (T.offline_now || "offline") : (ready ? "· ✓ " + (T.offline_ready || "offline") : "");
  }
  addEventListener("online", showNet);
  addEventListener("offline", showNet);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", showNet);
  }
  showNet();

  // ------------------------------------------------------------ Daten
  let dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch("/data/anii.json").then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).then((d) => {
        d.byId = new Map(d.entries.map((e) => [e.id, e]));
        d.lessonById = new Map(d.lessons.map((l) => [l.id, l]));
        return d;
      });
      dataPromise.catch(() => { dataPromise = null; });
    }
    return dataPromise;
  }

  // ------------------------------------------------------------ Audio
  let player = null;
  let playingBtn = null;
  function play(src, btn) {
    if (player) { player.pause(); if (playingBtn) playingBtn.classList.remove("playing"); }
    player = new Audio(src);
    playingBtn = btn || null;
    if (btn) btn.classList.add("playing");
    const stop = () => btn && btn.classList.remove("playing");
    player.addEventListener("ended", stop);
    player.addEventListener("error", stop);
    player.play().catch(stop);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-audio]");
    if (b) { e.preventDefault(); e.stopPropagation(); play(b.dataset.audio, b); }
  }, true);
  function audioBtn(entry, label) {
    if (!entry.au) return h("span", { class: "speak off", title: t("no_audio"), "aria-label": t("no_audio") }, icon("mic"));
    return h("button", { class: "speak", type: "button", "data-audio": "/audio/" + entry.au, "aria-label": t("play") + " " + (label || entry.a) }, icon("volume-2"));
  }

  // Aufnahmen offline speichern: klein -> automatisch, groß -> auf Knopfdruck
  async function offlineAudio() {
    const box = document.getElementById("audio-dl");
    if (!box || !("caches" in window)) return;
    let d;
    try { d = await loadData(); } catch { return; }
    const files = d.audio.files;
    if (!files.length) return;
    const cache = await caches.open("anii-audio");
    const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
    const missing = files.map((f) => "/audio/" + f).filter((u) => !have.has(u));
    const mb = (d.audio.bytes / 1048576).toFixed(1).replace(".", ",");
    box.hidden = false;
    if (!missing.length) { box.textContent = "✓ " + t("audio_dl_done"); return; }
    const run = async () => {
      box.textContent = t("audio_dl_busy");
      for (const u of missing) {
        try {
          const res = await fetch(u);
          if (res.ok) await cache.put(u, res);
        } catch { break; }
      }
      const left = (await cache.keys()).length;
      box.textContent = left >= files.length ? "✓ " + t("audio_dl_done") : "";
      if (left < files.length) box.append(btn);
    };
    const btn = h("button", { class: "btn", type: "button", onclick: run }, icon("download"), ` ${t("audio_dl")} (${mb} ${t("mb")})`);
    const saveData = navigator.connection && navigator.connection.saveData;
    if (d.audio.bytes <= AUTO_AUDIO_BYTES && !saveData && navigator.onLine !== false) run();
    else box.replaceChildren(btn);
  }
  if (uiEl) setTimeout(offlineAudio, 1500);

  // ------------------------------------------------------------ Übersetzung in der Oberflächensprache
  function tr(e) {
    if (e[LANG]) return { text: e[LANG], fallback: false };
    return { text: e[OTHER] || "", fallback: true };
  }

  // ============================================================ Wörterbuch
  function dictApp(root, d) {
    const state = { q: "", lesson: "", only: null, limit: 60 };
    const index = d.entries.map((e, i) => ({
      e, i,
      fa: fold([e.a, e.pl].filter(Boolean).join(" ")),
      ft: fold([e[LANG], e[OTHER]].filter(Boolean).join(" ")),
      fx: fold(e.ex || ""),
    }));
    const input = h("input", { type: "search", placeholder: t("d_search"), "aria-label": t("d_search"), autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "search" });
    const sel = h("select", { "aria-label": t("d_lesson") },
      h("option", { value: "" }, t("d_all_lessons")),
      d.lessons.map((l) => h("option", { value: l.id }, `${l.name} (${l.n})`)));
    const count = h("p", { class: "muted small", role: "status" });
    const list = h("div");
    root.replaceChildren(
      h("div", { class: "search" }, h("div", { class: "row" }, input, sel), h("small", { class: "muted" }, t("d_search_hint"))),
      count, list);

    function score(x, q) {
      if (x.fa.startsWith(q)) return 0;
      if ((" " + x.fa).includes(" " + q)) return 1;
      if (x.fa.includes(q)) return 2;
      if ((" " + x.ft).includes(" " + q)) return 3;
      if (x.ft.includes(q)) return 4;
      if (x.fx.includes(q)) return 6;
      return -1;
    }

    function card(e) {
      const pl = e.pl ? h("span", { class: "pl" }, ` · ${t("d_plural")} `, h("span", { lang: "blo" }, e.pl)) : null;
      const trs = [LANG, OTHER].filter((l) => e[l]).map((l) =>
        h("div", { class: "tr", lang: l }, h("span", { class: "lab" }, l.toUpperCase()), " ", e[l]));
      const lesson = d.lessonById.get(e.l);
      const meta = [
        lesson && [t("d_lesson"), lesson.name],
        e.dia && [t("d_dialect"), e.dia],
        e.src && [t("d_source"), e.src],
        e.date && [t("d_date"), e.date],
      ].filter(Boolean).map(([k, v]) => h("span", null, k + (LANG === "fr" ? " : " : ": "), v));
      return h("li", { class: "word", id: e.id },
        h("div", { class: "word-head" }, h("span", { class: "anii", lang: "blo" }, e.a, pl), audioBtn(e)),
        trs,
        e.ex ? h("div", { class: "ex", lang: "blo" }, "« ", e.ex, " »") : null,
        e.no ? h("div", { class: "note" }, h("span", { class: "lab" }, t("d_note")), " ", e.no) : null,
        h("div", { class: "meta" },
          e.ok ? h("span", { class: "badge ok" }, icon("shield-check"), t("d_checked")) : h("span", { class: "badge no" }, t("d_unchecked")),
          meta,
          h("a", { class: "correct", href: T.urls.participer + "#" + e.id }, t("d_correct")),
          h("span", { class: "muted" }, e.id)));
    }

    function render() {
      let rows;
      if (state.only) {
        rows = index.filter((x) => x.e.id === state.only);
      } else {
        const q = fold(state.q.trim());
        rows = index.filter((x) => !state.lesson || x.e.l === state.lesson);
        if (q) {
          rows = rows.map((x) => ({ x, s: score(x, q) })).filter((r) => r.s >= 0)
            .sort((a, b) => a.s - b.s || a.x.i - b.x.i).map((r) => r.x);
        }
      }
      count.textContent = rows.length === 1 ? t("d_result1") : t("d_results", { n: rows.length });
      const shown = rows.slice(0, state.limit);
      const out = [];
      let ul = null;
      let letter = null;
      const grouped = !state.q.trim() && !state.only;
      for (const x of shown) {
        if (!ul || (grouped && x.e.fl !== letter)) {
          letter = x.e.fl;
          if (grouped && letter) out.push(h("h2", { class: "letter-head", lang: "blo" }, upperLetter(letter) + " " + letter));
          ul = h("ul", { class: "words" });
          out.push(ul);
        }
        ul.append(card(x.e));
      }
      if (!rows.length) out.push(h("p", null, t("d_none")));
      if (rows.length > shown.length) {
        out.push(h("button", { class: "btn block", type: "button", onclick: () => { state.limit += 100; render(); } }, t("d_more")));
      }
      if (state.only) {
        out.push(h("button", { class: "btn block", type: "button", onclick: () => { history.replaceState(null, "", location.pathname); state.only = null; render(); } }, t("d_show_all")));
      }
      list.replaceChildren(...out);
    }

    let timer = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = input.value; state.only = null; state.limit = 60; render(); }, 120);
    });
    sel.addEventListener("change", () => { state.lesson = sel.value; state.only = null; state.limit = 60; render(); });
    function fromHash() {
      const id = decodeURIComponent(location.hash.slice(1));
      state.only = d.byId.has(id) ? id : null;
      render();
      if (state.only) document.getElementById(id)?.scrollIntoView({ block: "center" });
    }
    addEventListener("hashchange", fromHash);
    fromHash();
  }

  const UPPER = { "ǝ": "Ǝ", "ɛ": "Ɛ", "ɩ": "Ɩ", "ŋ": "Ŋ", "ɔ": "Ɔ", "ʊ": "Ʊ" };
  const upperLetter = (l) => (UPPER[l[0]] || l[0].toUpperCase()) + l.slice(1);

  // ============================================================ Trainer (Leitner-System)
  // Fach 1–5; Fach 0 = noch nie geübt. Nach richtiger Antwort ein Fach weiter,
  // nach falscher zurück in Fach 1. Wiedervorlage nach so vielen Tagen:
  const INTERVAL = [0, 0, 1, 3, 7, 14];
  const LKEY = "anii_leitner_v1";
  const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  let L = store.get(LKEY, {});
  const cardKey = (e, dir) => e.id + "|" + dir; // dir: "a" = Anii → Übersetzung, "x" = Übersetzung → Anii
  const boxOf = (e, dir) => (L[cardKey(e, dir)] || [0, 0])[0];
  function grade(e, dir, result) {
    const k = cardKey(e, dir);
    let [box] = L[k] || [0, 0];
    if (result === "ok") box = Math.min(5, box + 1);
    else if (result === "bad") box = 1;
    else box = Math.max(1, box); // fast richtig: bleibt im Fach
    L[k] = [box, today() + (result === "ok" ? INTERVAL[box] : 0), Date.now()]; // [Fach, fällig am, geändert (ms)]
    store.set(LKEY, L);
    Account.changed();
  }
  const isDue = (e, dir) => { const s = L[cardKey(e, dir)]; return s && s[0] >= 1 && s[1] <= today(); };

  // ------------------------------------------------------------ Konto (freiwillig): Lernstand auf dem Server
  // Ohne Konto bleibt alles im Browser. Mit Konto wird pro Karte abgeglichen (neuerer Stand gewinnt);
  // offline Geübtes wird nachgeschickt, sobald wieder Netz da ist.
  const Account = {
    user: store.get("anii_user", null),
    timer: 0,
    listeners: [],
    async call(path, body, keepalive) {
      const res = await fetch("/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        keepalive: !!keepalive,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && path === "progress") this.setUser(null);
      if (!res.ok) throw Object.assign(new Error(data.error || "net"), { code: data.error || "net" });
      return data;
    },
    setUser(name) {
      this.user = name;
      if (name) store.set("anii_user", name); else store.del("anii_user");
      this.listeners.forEach((f) => f());
    },
    adopt(cards) {
      // Server liefert den zusammengeführten Stand; lokal Neueres (während der Anfrage) behalten
      const merged = { ...cards };
      for (const [k, v] of Object.entries(L)) if (!merged[k] || (v[2] || 0) > (merged[k][2] || 0)) merged[k] = v;
      L = merged;
      store.set(LKEY, L);
    },
    changed() {
      if (!this.user) return;
      store.set("anii_dirty", 1);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync(), 2500);
    },
    async sync(keepalive) {
      if (!this.user || navigator.onLine === false) return;
      try {
        const r = await this.call("progress", { cards: L }, keepalive);
        this.adopt(r.cards);
        store.del("anii_dirty");
      } catch { /* offline: später nochmal */ }
    },
    async auth(kind, name, password) {
      const r = await this.call(kind, { name, password, cards: L });
      this.adopt(r.cards);
      store.del("anii_dirty");
      this.setUser(r.name);
    },
    async logout() {
      await this.sync();
      try { await this.call("logout", {}); } catch { /* egal */ }
      // Geteilte Handys: Lernstand der Person nicht für die nächste liegen lassen
      L = {};
      store.del(LKEY);
      store.del("anii_dirty");
      this.setUser(null);
    },
  };
  addEventListener("online", () => Account.sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && store.get("anii_dirty", 0)) Account.sync(true);
  });

  function trainApp(root, d) {
    let dir = store.get("anii_dir", "a2x");
    if (!["a2x", "x2a", "mix"].includes(dir)) dir = "a2x";
    const dirs = () => (dir === "a2x" ? ["a"] : dir === "x2a" ? ["x"] : ["a", "x"]);
    const known = (e) => dirs().every((x) => boxOf(e, x) >= 4);
    const dueCards = (entries) => entries.flatMap((e) => dirs().filter((x) => isDue(e, x)).map((x) => ({ e, dir: x })));

    function selection(sel) {
      if (sel === "rev") return { title: t("t_review"), entries: d.entries, back: "#/", review: true };
      if (sel.startsWith("c:")) {
        const ids = sel.slice(2).split("+").filter((x) => d.lessonById.has(x));
        return { title: ids.map((x) => d.lessonById.get(x).name).join(" + "), entries: d.entries.filter((e) => ids.includes(e.l)), back: "#/" };
      }
      const l = d.lessonById.get(sel);
      if (!l) return null;
      return { title: l.name, entries: d.entries.filter((e) => e.l === sel), back: "#/l/" + sel };
    }

    function dirControl(onchange) {
      const seg = h("div", { class: "seg", role: "group", "aria-label": t("t_dir") });
      for (const [v, label] of [["a2x", t("t_dir_a2x")], ["x2a", t("t_dir_x2a")], ["mix", t("t_dir_mix")]]) {
        seg.append(h("button", { type: "button", "aria-pressed": String(v === dir), onclick: () => { dir = v; store.set("anii_dir", v); onchange(); } }, label));
      }
      return h("div", null, h("p", { class: "muted small" }, t("t_dir")), seg);
    }
    const meter = (k, n) => h("div", { class: "meter" },
      h("div", { class: "meter-bar" }, h("span", { style: `width:${n ? Math.round((k / n) * 100) : 0}%` })),
      h("small", null, t("t_known", { k, n })));

    // Anmelden / Konto erstellen (freiwillig)
    function accountBox() {
      if (Account.user) {
        return h("div", { class: "account in" }, icon("users"), " ", t("a_logged_in", { name: Account.user }), " · ",
          h("button", { class: "linkish inline", type: "button", onclick: async () => { await Account.logout(); route(); } }, t("a_logout")));
      }
      const box = h("div", { class: "panel account" });
      function show(mode) {
        if (!mode) {
          box.replaceChildren(h("p", null, icon("info"), " ", t("a_hint")),
            h("div", { class: "row gap" },
              h("button", { class: "btn primary", type: "button", onclick: () => show("login") }, t("a_login")),
              h("button", { class: "btn", type: "button", onclick: () => show("register") }, t("a_register"))));
          return;
        }
        const reg = mode === "register";
        const name = h("input", { autocomplete: "username", autocapitalize: "words", maxlength: "30", required: true });
        const pw = h("input", { type: "password", autocomplete: reg ? "new-password" : "current-password", required: true });
        const pw2 = reg ? h("input", { type: "password", autocomplete: "new-password", required: true }) : null;
        const msg = h("p", { class: "error", role: "alert" });
        const ERR = { wrong: "a_err_wrong", taken: "a_err_taken", name: "a_err_name", password: "a_err_password", too_many: "a_err_too_many" };
        box.replaceChildren(h("form", { onsubmit: async (ev) => {
          ev.preventDefault();
          msg.textContent = "";
          if (reg && pw.value !== pw2.value) { msg.textContent = t("a_err_mismatch"); return; }
          try {
            await Account.auth(reg ? "register" : "login", name.value, pw.value);
            route();
          } catch (err) { msg.textContent = t(ERR[err.code] || "a_err_net"); }
        } },
          h("h2", null, reg ? t("a_register") : t("a_login")),
          h("label", { class: "field" }, t("a_name"), reg ? h("small", null, t("a_name_hint")) : null, name),
          h("label", { class: "field" }, t("a_password"), reg ? h("small", null, t("a_password_hint")) : null, pw),
          reg ? h("label", { class: "field" }, t("a_password2"), pw2) : null,
          msg,
          h("div", { class: "row gap" },
            h("button", { class: "btn primary", type: "submit" }, reg ? t("a_register") : t("a_login")),
            h("button", { class: "linkish inline", type: "button", onclick: () => show(reg ? "login" : "register") }, reg ? t("a_have_account") : t("a_no_account"))),
          h("p", { class: "muted small" }, reg ? t("a_privacy") : t("a_forgot"))));
        name.focus();
      }
      show(null);
      return box;
    }
    const savedNote = () => h("p", { class: "muted small" }, Account.user ? t("a_saved_account") : t("t_saved"));

    function viewHome() {
      const due = dueCards(d.entries).length;
      const picks = new Set();
      const go = h("a", { class: "btn primary block", href: "#/", "aria-disabled": "true" }, t("t_combine_go"));
      const upd = () => { go.href = picks.size ? "#/l/c:" + [...picks].join("+") : "#/"; go.setAttribute("aria-disabled", String(!picks.size)); };
      return h("div", null,
        h("h1", null, icon("layers"), " ", T.nav.train),
        h("p", { class: "lead" }, t("t_intro")),
        accountBox(),
        dirControl(route),
        due
          ? h("a", { class: "card review", href: "#/p/cards/rev", style: "margin-top:1rem" },
              h("span", { class: "card-icon" }, icon("rotate-ccw")),
              h("span", { class: "card-body" }, h("strong", null, t("t_review")), h("small", null, t("t_review_sub", { n: due }))))
          : h("p", { class: "muted" }, t("t_review_none")),
        h("h2", null, t("t_lessons")),
        h("div", { class: "grid" }, d.lessons.map((l) => {
          const es = d.entries.filter((e) => e.l === l.id);
          return h("a", { class: "card", href: "#/l/" + l.id },
            h("span", { class: "card-icon" }, icon("book-open")),
            h("span", { class: "card-body" }, h("strong", null, l.name), h("small", null, t("t_words", { n: es.length })), meter(es.filter(known).length, es.length)));
        })),
        d.lessons.length > 1 ? h("details", { class: "panel combine" },
          h("summary", null, t("t_combine")),
          d.lessons.map((l) => h("label", null, h("input", { type: "checkbox", onchange: (ev) => { ev.target.checked ? picks.add(l.id) : picks.delete(l.id); upd(); } }), l.name)),
          go) : null,
        h("button", { class: "linkish small", type: "button", onclick: () => { if (confirm(t("t_reset_confirm"))) { const now = Date.now(); for (const k of Object.keys(L)) L[k] = [0, 0, now]; store.set(LKEY, L); Account.changed(); route(); } } }, t("t_reset")));
    }

    function viewLesson(sel) {
      const s = selection(sel);
      if (!s) return notFound();
      const mode = (m, ic, title, sub) => h("a", { class: "mode", href: `#/p/${m}/${sel}` },
        h("span", { class: "card-icon" }, icon(ic)), h("strong", null, title), h("small", null, sub));
      const boxes = (e) => {
        const b = Math.min(...dirs().map((x) => boxOf(e, x)));
        return h("span", { class: "box", title: b ? t("t_box", { b }) : t("t_new") },
          h("span", { class: "boxes" }, [1, 2, 3, 4, 5].map((i) => h("i", { class: i <= b ? "on" : null }))));
      };
      return h("div", null,
        h("p", { class: "small" }, h("a", { href: "#/" }, "← ", T.nav.train)),
        h("h1", null, s.title),
        meter(s.entries.filter(known).length, s.entries.length),
        h("div", { style: "margin-top:1rem" }, dirControl(route)),
        h("div", { class: "modes" },
          mode("cards", "layers", t("t_cards"), t("t_cards_sub")),
          mode("quiz", "list-checks", t("t_quiz"), t("t_quiz_sub")),
          mode("write", "pen-line", t("t_write"), t("t_write_sub"))),
        h("h2", null, `${t("t_wordlist")} (${s.entries.length})`),
        h("ul", { class: "wordlist" }, s.entries.map((e) =>
          h("li", null,
            h("div", null, h("b", { lang: "blo" }, e.a), h("div", { class: "muted small" }, tr(e).text)),
            h("div", { class: "row" }, boxes(e), audioBtn(e))))));
    }

    // Karten für eine Runde: fällige zuerst (niedriges Fach vorn), dann neue, dann der Rest
    function pickCards(s) {
      const now = today();
      let cands = s.entries.flatMap((e, i) => dirs().map((x) => {
        const st = L[cardKey(e, x)];
        let p;
        if (st && st[0] >= 1 && st[1] <= now) p = st[0] * 0.1;
        else if (!st || !st[0]) p = 1 + i * 1e-4;
        else p = 2 + (st[1] - now) * 0.01 + st[0] * 0.001;
        return { e, dir: x, p: p + Math.random() * 0.05 };
      }));
      if (s.review) cands = cands.filter((c) => isDue(c.e, c.dir));
      cands.sort((a, b) => a.p - b.p);
      const seen = new Set();
      const out = [];
      for (const c of cands) {
        if (seen.has(c.e.id)) continue; // dasselbe Wort nicht in beiden Richtungen pro Runde
        seen.add(c.e.id);
        out.push(c);
        if (out.length >= ROUND) break;
      }
      return shuffle(out);
    }

    // Antworten vergleichen
    const norm = (s) => String(s).normalize("NFC").toLowerCase().replace(/[’`´]/g, "'")
      .replace(/[.,!?;:"«»“”„()[\]…]/g, " ").replace(/\s+/g, " ").trim();
    const ARTICLES = /^(le |la |les |l'|un |une |des |der |die |das |ein |eine |to )/;
    function variants(text) {
      const out = new Set();
      for (const part of String(text).split(/[,;/]/)) {
        const p = part.trim();
        if (!p) continue;
        out.add(p);
        out.add(p.replace(/\([^)]*\)/g, " "));
      }
      return [...out].map(norm).filter(Boolean);
    }
    function judge(input, answers, anii) {
      const a = norm(input);
      if (!a) return "bad";
      const opts = answers.flatMap(variants);
      if (opts.includes(a)) return "ok";
      if (!anii) {
        const noArt = (x) => x.replace(ARTICLES, "");
        if (opts.some((x) => noArt(x) === noArt(a))) return "ok";
        if (opts.some((x) => stripMarks(noArt(x)) === stripMarks(noArt(a)))) return "accents";
        return "bad";
      }
      if (opts.some((x) => stripMarks(x) === stripMarks(a))) return "tones";
      if (opts.some((x) => fold(x) === fold(a))) return "almost";
      return "bad";
    }

    // Frage aus einer Karte bauen
    function promptSide(c) {
      if (c.dir === "a") {
        return h("div", null, h("div", { class: "q-main", lang: "blo" }, c.e.a), audioBtn(c.e));
      }
      const x = tr(c.e);
      return h("div", null,
        x.fallback ? h("div", { class: "q-sub small" }, t("t_fallback")) : null,
        h("div", { class: "q-main", lang: x.fallback ? OTHER : LANG }, x.text));
    }
    function solutionText(c) { return `${c.e.a} = ${tr(c.e).text}`; }

    function quizQ(c, pool) {
      const label = (e) => (c.dir === "a" ? tr(e).text : e.a);
      const right = label(c.e);
      const others = [];
      for (const src of [shuffle(pool), shuffle(d.entries)]) {
        for (const e of src) {
          const l = label(e);
          if (l && l !== right && !others.includes(l)) others.push(l);
          if (others.length >= 3) break;
        }
        if (others.length >= 3) break;
      }
      return { kind: "choice", c, label: c.dir === "a" ? t("t_q_meaning") : t("t_q_anii"), choices: shuffle([right, ...others]), answer: right };
    }
    function writeQ(c, pool) {
      const anii = c.dir === "x";
      // Wörter mit gleicher Übersetzung (Synonyme) gelten auch
      const same = pool.filter((e) => (anii ? tr(e).text === tr(c.e).text : e.a === c.e.a));
      const answers = anii ? same.map((e) => e.a) : same.map((e) => tr(e).text);
      return { kind: "input", c, anii, label: anii ? t("t_q_write_anii") : t("t_q_write_x"), answers };
    }

    function keyBar(input) {
      let shift = false;
      const chars = ["ǝ", "ɛ", "ɩ", "ŋ", "ɔ", "ʊ"];
      const keys = chars.map((ch) => h("button", { type: "button", tabindex: "-1", onmousedown: (e) => e.preventDefault(), onclick: () => {
        const c = shift ? UPPER[ch] : ch;
        const s = input.selectionStart ?? input.value.length;
        const e2 = input.selectionEnd ?? s;
        input.value = input.value.slice(0, s) + c + input.value.slice(e2);
        input.setSelectionRange(s + c.length, s + c.length);
        input.focus();
        if (shift) toggle();
      } }, ch));
      const sh = h("button", { type: "button", class: "shift", tabindex: "-1", "aria-pressed": "false", "aria-label": t("t_shift"), onmousedown: (e) => e.preventDefault(), onclick: () => toggle() }, "⇧");
      function toggle() {
        shift = !shift;
        sh.setAttribute("aria-pressed", String(shift));
        keys.forEach((k, i) => { k.textContent = shift ? UPPER[chars[i]] : chars[i]; });
      }
      return h("div", { class: "keys", role: "group", "aria-label": t("t_keys") }, sh, keys);
    }

    function practiceHeader(title, back, idx, total) {
      return h("div", { class: "practice-head" },
        h("a", { class: "close", href: back, title: t("t_quit"), "aria-label": t("t_quit") }, icon("x")),
        h("div", { class: "practice-title" }, h("small", null, title),
          h("div", { class: "meter-bar" }, h("span", { style: `width:${Math.round((idx / total) * 100)}%` }))),
        h("span", { class: "count" }, `${Math.min(idx + 1, total)}/${total}`));
    }

    function emptyView(back) {
      return h("div", { class: "practice" }, h("p", null, s_empty()), h("a", { class: "btn", href: back }, t("t_back")));
    }
    const s_empty = () => (location.hash.includes("/rev") ? t("t_review_none") : t("t_empty"));

    function runner(s, questions) {
      const wrap = h("div", { class: "practice" });
      if (!questions.length) return emptyView(s.back);
      const results = [];
      const mistakes = [];
      let idx = 0;

      function show() {
        const q = questions[idx];
        let answered = false;
        const feedback = h("div", { class: "feedback", role: "status" });
        const nextBtn = h("button", { class: "btn primary block", type: "button", hidden: true, onclick: next }, idx + 1 < questions.length ? t("t_next") : t("t_result"));

        function finish(verdict, msg) {
          answered = true;
          const ok = verdict === "ok";
          results.push(ok || verdict === "almost");
          grade(q.c.e, q.c.dir, verdict === "almost" ? "almost" : ok ? "ok" : "bad");
          if (!ok) mistakes.push(q.c);
          feedback.className = "feedback " + (ok ? "good" : verdict === "almost" ? "almost" : "bad");
          const showSol = !ok || msg;
          feedback.replaceChildren(...[
            h("strong", null, ok ? [icon("check"), " ", t("t_right")] : verdict === "almost" ? "" : [icon("x"), " ", t("t_wrong")]), " ", msg || "",
            showSol ? h("div", { class: "solution" }, t("t_solution"), " ", h("b", { lang: "blo" }, q.c.e.a), " = ", tr(q.c.e).text, audioBtn(q.c.e)) : null,
          ].filter((x) => x != null));
          nextBtn.hidden = false;
          nextBtn.focus();
        }

        let area;
        if (q.kind === "input") {
          const input = h("input", { class: "answer", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "go", "aria-label": q.label, lang: q.anii ? "blo" : LANG });
          const checkBtn = h("button", { class: "btn primary block", type: "submit" }, t("t_check"));
          const skip = h("button", { class: "linkish", type: "button", onclick: () => {
            if (answered) return;
            input.disabled = true; checkBtn.hidden = true; skip.hidden = true;
            finish("bad", t("t_no_problem"));
          } }, t("t_dont_know"));
          area = h("form", { class: "answer-form", onsubmit: (e) => {
            e.preventDefault();
            if (answered) return next();
            if (!input.value.trim()) { input.focus(); return; }
            const v = judge(input.value, q.answers, q.anii);
            input.disabled = true; checkBtn.hidden = true; skip.hidden = true;
            if (v === "almost") finish("almost", t("t_spelling"));
            else if (v === "tones") finish("ok", t("t_tones"));
            else if (v === "accents") finish("ok", t("t_accents"));
            else finish(v);
          } }, input, q.anii ? keyBar(input) : null, checkBtn, skip);
          setTimeout(() => input.focus(), 50);
        } else {
          area = h("div", { class: "choices" }, q.choices.map((c) =>
            h("button", { type: "button", class: "choice", lang: q.c.dir === "x" ? "blo" : LANG, onclick: (e) => {
              if (answered) return;
              const ok = c === q.answer;
              for (const b of area.querySelectorAll("button")) {
                b.disabled = true;
                if (b.textContent === q.answer) b.classList.add("right");
              }
              if (!ok) e.currentTarget.classList.add("wrong");
              finish(ok ? "ok" : "bad");
            } }, c)));
        }
        wrap.replaceChildren(
          practiceHeader(s.title, s.back, idx, questions.length),
          h("div", { class: "panel question" }, h("div", { class: "q-label" }, q.label), promptSide(q.c)),
          area, feedback, nextBtn);
      }
      function next() {
        idx++;
        if (idx < questions.length) show();
        else done();
      }
      function done() {
        const correct = results.filter(Boolean).length;
        const total = results.length;
        const r = correct / total;
        wrap.replaceChildren(h("div", { class: "result" },
          h("div", { class: "score" }, h("b", null, correct), ` / ${total}`),
          h("h2", null, r === 1 ? t("t_perfect") : r >= 0.8 ? t("t_very_good") : r >= 0.5 ? t("t_good") : t("t_keep")),
          savedNote(),
          mistakes.length ? h("div", { class: "panel" }, h("h3", null, t("t_practice_more")),
            h("ul", { class: "mistakes" }, mistakes.map((c) => h("li", null, h("b", { lang: "blo" }, c.e.a), " = ", tr(c.e).text, " ", audioBtn(c.e))))) : null,
          h("div", { class: "row gap" },
            h("button", { class: "btn primary", type: "button", onclick: route }, icon("rotate-ccw"), t("t_again_round")),
            h("a", { class: "btn", href: s.back }, t("t_back")))));
      }
      show();
      return wrap;
    }

    function flashcards(s, cards) {
      const wrap = h("div", { class: "practice" });
      if (!cards.length) return emptyView(s.back);
      let queue = cards.slice();
      const total = queue.length;
      const first = new Map();

      function show() {
        if (!queue.length) return done();
        const c = queue[0];
        let flipped = false;
        const backSide = h("div", null,
          c.dir === "a"
            ? h("div", { class: "q-main", lang: LANG }, tr(c.e).text)
            : h("div", null, h("div", { class: "q-main", lang: "blo" }, c.e.a), audioBtn(c.e)),
          c.e.pl ? h("div", { class: "muted small", lang: "blo" }, t("d_plural"), " ", c.e.pl) : null,
          c.e.ex ? h("div", { class: "ex", lang: "blo" }, "« ", c.e.ex, " »") : null,
          c.e.no ? h("div", { class: "note muted small" }, c.e.no) : null);
        backSide.hidden = true;
        const divider = h("hr", { hidden: true }); // Trennlinie erst nach dem Umdrehen, damit die Vorderseite mittig steht
        const flipBtn = h("button", { class: "btn primary block", type: "button", onclick: flip }, t("t_flip"));
        const rate = h("div", { class: "row gap rate", hidden: true },
          h("button", { class: "btn again", type: "button", onclick: () => answer(false) }, icon("rotate-ccw"), t("t_again")),
          h("button", { class: "btn good", type: "button", onclick: () => answer(true) }, icon("check"), t("t_knew")));
        function flip() {
          if (flipped) return;
          flipped = true;
          backSide.hidden = false;
          divider.hidden = false;
          flipBtn.hidden = true;
          rate.hidden = false;
        }
        function answer(ok) {
          if (!first.has(cardKey(c.e, c.dir))) {
            first.set(cardKey(c.e, c.dir), ok);
            grade(c.e, c.dir, ok ? "ok" : "bad");
          }
          const item = queue.shift();
          if (!ok) queue.splice(Math.min(3, queue.length), 0, item); // bald wiederholen
          show();
        }
        wrap.replaceChildren(
          practiceHeader(t("t_cards") + " · " + s.title, s.back, first.size, total),
          h("div", { class: "panel flashcard", onclick: (e) => { if (!e.target.closest("button")) flip(); }, role: "button", tabindex: "0", "aria-label": t("t_flip") },
            promptSide(c), divider, backSide),
          flipBtn, rate);
      }
      function done() {
        const correct = [...first.values()].filter(Boolean).length;
        wrap.replaceChildren(h("div", { class: "result" },
          h("div", { class: "score" }, h("b", null, correct), ` / ${total}`),
          h("h2", null, t("t_done_cards")),
          h("p", null, t("t_done_cards_sub")),
          savedNote(),
          h("div", { class: "row gap" },
            h("button", { class: "btn primary", type: "button", onclick: route }, icon("rotate-ccw"), t("t_again_round")),
            h("a", { class: "btn", href: s.back }, t("t_back")))));
      }
      show();
      return wrap;
    }

    function viewPractice(mode, sel) {
      const s = selection(sel);
      if (!s) return notFound();
      const cards = pickCards(s);
      if (mode === "cards") return flashcards(s, cards);
      if (mode === "quiz") return runner(s, cards.map((c) => quizQ(c, s.entries)));
      if (mode === "write") return runner(s, cards.map((c) => writeQ(c, s.entries)));
      return notFound();
    }
    function notFound() {
      return h("div", null, h("p", null, t("t_empty")), h("a", { class: "btn", href: "#/" }, t("t_back")));
    }

    function route() {
      L = store.get(LKEY, {});
      const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
      let view;
      if (parts[0] === "l" && parts[1]) view = viewLesson(parts[1]);
      else if (parts[0] === "p" && parts[2]) view = viewPractice(parts[1], parts[2]);
      else view = viewHome();
      root.replaceChildren(view);
      window.scrollTo(0, 0);
    }
    addEventListener("hashchange", route);
    route();
    // Mit Konto: beim Öffnen den Stand vom Server holen (nicht mitten in einer Übung neu zeichnen)
    if (Account.user) Account.sync().then(() => { if (!location.hash.startsWith("#/p/")) route(); });
    Account.listeners.push(() => { if (!location.hash.startsWith("#/p/")) route(); });
  }

  // ============================================================ Mitmachen: Text zum Teilen erzeugen
  function contribApp(form, d) {
    const f = (n) => form.elements[n];
    const preview = form.querySelector("#contrib-preview");
    const share = form.querySelector("#contrib-share");
    const copy = form.querySelector("#contrib-copy");
    const msg = form.querySelector("#contrib-msg");
    const id = decodeURIComponent(location.hash.slice(1));
    if (d && d.byId.has(id)) {
      f("word").value = id;
      f("type").value = "fix";
    }
    function text() {
      const lines = [t("p_subject")];
      const typeOpt = f("type").selectedOptions[0];
      lines.push(`${t("p_type")}: ${typeOpt ? typeOpt.textContent : ""}`);
      const w = f("word").value.trim();
      if (w) {
        const e = d && (d.byId.get(w) || d.entries.find((x) => x.a === w));
        lines.push(`${t("p_word")}: ${w}` + (e ? ` (${e.id}: ${e.a} = ${e.fr || ""}${e.de ? " / " + e.de : ""})` : ""));
      }
      lines.push(`${t("p_text")}: ${f("text").value.trim()}`);
      if (f("name").value.trim()) lines.push(`${t("p_name")}: ${f("name").value.trim()}`);
      if (f("village").value.trim()) lines.push(`${t("p_village")}: ${f("village").value.trim()}`);
      lines.push(location.origin + "/");
      return lines.join("\n");
    }
    const upd = () => { preview.textContent = text(); };
    form.addEventListener("input", upd);
    form.addEventListener("change", upd);
    form.addEventListener("submit", (e) => e.preventDefault());
    if (navigator.share) {
      share.hidden = false;
      share.addEventListener("click", () => navigator.share({ title: t("p_subject"), text: text() }).catch(() => {}));
    }
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text()); } catch {
        const r = document.createRange(); r.selectNodeContents(preview);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand("copy");
      }
      msg.textContent = t("p_copied");
    });
    upd();
  }

  // ------------------------------------------------------------ Start
  const app = document.getElementById("app");
  const form = document.getElementById("contrib");
  if (app || form) {
    loadData().then((d) => {
      if (app && app.dataset.app === "dict") dictApp(app, d);
      if (app && app.dataset.app === "train") trainApp(app, d);
      if (form) contribApp(form, d);
    }).catch(() => {
      if (app) app.replaceChildren(h("p", { class: "error" }, t("load_error")));
      if (form) contribApp(form, null);
    });
  }
})();
