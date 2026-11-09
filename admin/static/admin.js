/* Anii-Editor: Wörter anlegen, bearbeiten, Aufnahmen hinzufügen. Spricht nur mit /admin/api/. */
"use strict";
(() => {
  const app = document.getElementById("app");
  const S = { data: null, q: "", lesson: "", lastField: null };
  const remember = {
    get(k, d) { try { return localStorage.getItem("anii_ed_" + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("anii_ed_" + k, v); } catch { /* egal */ } },
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  async function api(path, body, opts = {}) {
    const res = await fetch("/admin/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: opts.type ? { "Content-Type": opts.type } : body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body === undefined ? undefined : opts.type ? body : JSON.stringify(body),
      credentials: "same-origin",
    });
    let data = {};
    try { data = await res.json(); } catch { /* leer */ }
    if (res.status === 401 && path !== "login") { viewLogin(); throw new Error(data.error || "Bitte anmelden"); }
    if (!res.ok && res.status !== 422) throw new Error(data.error || "Fehler " + res.status);
    return { status: res.status, ...data };
  }
  let toastTimer = 0;
  function toast(text, bad) {
    document.querySelector(".toast")?.remove();
    const t = h("div", { class: "toast" + (bad ? " bad" : ""), role: "status" }, text);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), bad ? 8000 : 3500);
  }
  const pushNote = (p) => (p === "ok" ? "Gespeichert – auf der Seite in ca. 2 Minuten." : p === "keine Änderung" ? "Keine Änderung." : "Gespeichert. " + p);

  // Such-Faltung wie auf der öffentlichen Seite
  const FOLD = { "ǝ": "e", "ə": "e", "ɛ": "e", "ɔ": "o", "ɩ": "i", "ɪ": "i", "ʊ": "u", "ŋ": "n", "ɖ": "d" };
  const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").replace(/[ǝəɛɔɩɪʊŋɖ]/g, (c) => FOLD[c]);

  // ------------------------------------------------------------ Anmeldung
  function viewLogin() {
    const pw = h("input", { type: "password", autocomplete: "current-password", required: true });
    const msg = h("p", { class: "error", role: "alert" });
    app.replaceChildren(h("form", { class: "panel login", onsubmit: async (e) => {
      e.preventDefault();
      msg.textContent = "";
      const r = await fetch("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw.value }) });
      if (r.ok) return start();
      msg.textContent = (await r.json().catch(() => ({}))).error || "Anmeldung fehlgeschlagen";
    } }, h("h1", null, "Anmelden"), h("label", { class: "field" }, "Passwort", pw), msg, h("button", { class: "btn primary block" }, "Anmelden")));
    pw.focus();
  }

  async function load() {
    S.data = await api("data");
    return S.data;
  }

  // ------------------------------------------------------------ Liste
  function viewList() {
    const d = S.data;
    const q = h("input", { type: "search", placeholder: "Suchen (Anii, Französisch, Deutsch, ID)", value: S.q, autocomplete: "off", spellcheck: "false" });
    const sel = h("select", null, h("option", { value: "" }, "Alle Lektionen"), d.lessons.map((l) => h("option", { value: l, selected: l === S.lesson }, l)));
    const list = h("ul", { class: "list" });
    const count = h("p", { class: "small muted" });
    function render() {
      const f = fold(S.q.trim());
      const rows = d.entries.filter((e) => (!S.lesson || e.lektion === S.lesson) &&
        (!f || fold([e.id, e.anii, e.francais, e.deutsch, e.plural].join(" ")).includes(f)));
      count.textContent = `${rows.length} von ${d.entries.length} Wörtern`;
      list.replaceChildren(...rows.map((e) => h("li", null, h("button", { type: "button", onclick: () => viewForm(e) },
        h("span", { class: "a", lang: "blo" }, e.anii),
        h("span", { class: "f" }, e.francais || e.deutsch),
        h("span", { class: "tags" }, e._audio ? "🔊" : "", e.geprueft === "ja" ? "✓" : "", e.lektion.split("·")[0].trim()),
        h("span", { class: "id" }, e.id)))));
    }
    q.addEventListener("input", () => { S.q = q.value; render(); });
    sel.addEventListener("change", () => { S.lesson = sel.value; render(); });
    const status = h("div", { class: "status" }, "Letzte Änderung: ", d.head || "–",
      d.unpushed ? [" · ", h("span", { class: "warn" }, `${d.unpushed} Änderung(en) noch nicht auf GitHub`), " ",
        h("button", { class: "linkish", style: "display:inline;padding:0", type: "button", onclick: async () => {
          try { const r = await api("push", {}); toast(pushNote(r.push), r.push !== "ok"); await load(); viewList(); } catch (e) { toast(e.message, true); }
        } }, "erneut senden")] : null);
    app.replaceChildren(
      h("div", { class: "bar" },
        h("button", { class: "btn primary", type: "button", onclick: () => viewForm(null) }, "+ Neues Wort"),
        h("button", { class: "btn", type: "button", onclick: () => viewTable() }, "Tabelle"),
        h("button", { class: "btn", type: "button", onclick: () => viewRecordSetup() }, "Aufnehmen"),
        h("button", { class: "btn", type: "button", onclick: viewSpeakers }, "Sprecher"),
        h("button", { class: "linkish", style: "margin:0 0 0 auto", type: "button", onclick: async () => { await api("logout", {}); viewLogin(); } }, "Abmelden")),
      status,
      h("div", { class: "bar" }, q, sel), count, list);
    render();
  }

  // ------------------------------------------------------------ Sonderzeichen
  function keyDock() {
    let shift = false;
    const chars = ["ǝ", "ɛ", "ɩ", "ŋ", "ɔ", "ʊ"];
    const UP = { "ǝ": "Ǝ", "ɛ": "Ɛ", "ɩ": "Ɩ", "ŋ": "Ŋ", "ɔ": "Ɔ", "ʊ": "Ʊ" };
    const keys = chars.map((ch) => h("button", { type: "button", tabindex: "-1", onmousedown: (e) => e.preventDefault(), onclick: () => {
      const input = S.lastField;
      if (!input) return;
      const c = shift ? UP[ch] : ch;
      const s = input.selectionStart ?? input.value.length;
      const e2 = input.selectionEnd ?? s;
      input.value = input.value.slice(0, s) + c + input.value.slice(e2);
      input.setSelectionRange(s + c.length, s + c.length);
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (shift) toggle();
    } }, ch));
    const sh = h("button", { type: "button", class: "shift", tabindex: "-1", "aria-pressed": "false", "aria-label": "Großbuchstaben", onmousedown: (e) => e.preventDefault(), onclick: () => toggle() }, "⇧");
    function toggle() {
      shift = !shift;
      sh.setAttribute("aria-pressed", String(shift));
      keys.forEach((k, i) => { k.textContent = shift ? UP[chars[i]] : chars[i]; });
    }
    return h("div", { class: "keydock" }, h("div", { class: "keys" }, sh, keys));
  }

  // ------------------------------------------------------------ Formular
  function viewForm(entry) {
    const isNew = !entry;
    const today = new Date().toISOString().slice(0, 10);
    const e = entry ? { ...entry } : {
      id: "", anii: "", francais: "", deutsch: "", lektion: remember.get("lektion", ""), plural: "", beispiel: "",
      dialekt: remember.get("dialekt", "Balanka"), quelle: remember.get("quelle", ""), datum: today, sprecher: "", geprueft: "nein", notiz: "",
    };
    const F = {};
    const field = (name, label, opts = {}) => {
      const tag = opts.area ? "textarea" : "input";
      const el = h(tag, { name, value: e[name] || "", autocomplete: "off", spellcheck: opts.anii ? "false" : null, lang: opts.anii ? "blo" : null,
        autocapitalize: opts.anii ? "off" : null, list: opts.list || null, type: opts.type || null, required: opts.required || null });
      if (opts.anii) el.addEventListener("focus", () => { S.lastField = el; });
      el.addEventListener("input", scheduleCheck);
      F[name] = el;
      return h("label", { class: "field" + (opts.wide ? " wide" : "") }, label, opts.hint ? h("small", null, opts.hint) : null, el);
    };
    const lessons = h("datalist", { id: "lessons" }, S.data.lessons.map((l) => h("option", { value: l })));
    const spk = h("select", { name: "sprecher" }, h("option", { value: "" }, "– keine Angabe –"),
      S.data.speakers.map((s) => h("option", { value: s.kuerzel, selected: s.kuerzel === e.sprecher }, `${s.kuerzel} · ${s.name}${s.zustimmung === "ja" ? "" : " (ohne Zustimmung)"}`)));
    F.sprecher = spk;
    const ok = h("input", { type: "checkbox", name: "geprueft", checked: e.geprueft === "ja" });
    F.geprueft = ok;
    const msgs = h("ul", { class: "msgs", "aria-live": "polite" });

    const collect = () => {
      const out = { id: e.id };
      for (const [k, el] of Object.entries(F)) out[k] = el.type === "checkbox" ? (el.checked ? "ja" : "nein") : el.value;
      return out;
    };
    const showMsgs = (list) => msgs.replaceChildren(...(list || []).map((m) => h("li", { class: m.level }, m.msg)));
    let timer = 0;
    function scheduleCheck() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const v = collect();
        if (!v.anii.trim()) return showMsgs([]);
        try { showMsgs((await api("check", { entry: v })).messages); } catch { /* offline o. ä. */ }
      }, 450);
    }

    async function save(next) {
      const v = collect();
      if (!v.anii.trim()) { F.anii.focus(); return; }
      btns.forEach((b) => { b.disabled = true; });
      try {
        const r = await api("save", { entry: v });
        if (r.status === 422) { showMsgs(r.messages); toast("Nicht gespeichert – bitte die roten Fehler beheben.", true); return; }
        for (const k of ["lektion", "dialekt", "quelle"]) remember.set(k, v[k]);
        toast((isNew ? `${r.id} angelegt. ` : "") + pushNote(r.push), r.push !== "ok" && r.push !== "keine Änderung");
        await load();
        if (next) viewForm(null);
        else viewForm(S.data.entries.find((x) => x.id === r.id));
      } catch (err) {
        toast(err.message, true);
      } finally {
        btns.forEach((b) => { b.disabled = false; });
      }
    }
    const btns = [
      h("button", { class: "btn primary", type: "submit" }, "Speichern"),
      isNew ? h("button", { class: "btn", type: "button", onclick: () => save(true) }, "Speichern & nächstes Wort") : null,
    ].filter(Boolean);

    const form = h("form", { onsubmit: (ev) => { ev.preventDefault(); save(false); } },
      h("div", { class: "form" },
        field("anii", "Anii", { anii: true, required: true }),
        field("francais", "Français"),
        field("deutsch", "Deutsch"),
        field("lektion", "Lektion", { list: "lessons", hint: "aus der Liste wählen oder neu eintippen, z. B. „9 · La famille“" }),
        field("plural", "Plural", { anii: true }),
        field("beispiel", "Beispielsatz", { anii: true }),
        field("notiz", "Anmerkung", { area: true, wide: true, hint: "wird im Wörterbuch angezeigt" }),
        field("dialekt", "Dialekt"),
        field("quelle", "Quelle", { hint: "Person, Buch, Wortliste …" }),
        field("datum", "Datum", { type: "date" }),
        h("label", { class: "field" }, "Sprecher (für die Aufnahme)", spk),
        h("label", { class: "row-check wide" }, ok, "Herkunft geprüft (von jemandem aus Balanka bestätigt)")),
      lessons, msgs,
      h("div", { class: "actions" }, btns,
        h("button", { class: "btn", type: "button", onclick: () => { viewList(); } }, "Zurück"),
        !isNew ? h("button", { class: "btn danger", type: "button", onclick: async () => {
          if (!confirm(`„${e.anii}“ (${e.id}) wirklich löschen? Die ID wird nicht neu vergeben.`)) return;
          try { const r = await api("delete", { id: e.id }); toast(pushNote(r.push)); await load(); viewList(); } catch (err) { toast(err.message, true); }
        } }, "Löschen") : null));

    app.replaceChildren(
      h("p", { class: "small" }, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); viewList(); } }, "← alle Wörter")),
      h("h1", null, isNew ? "Neues Wort" : [h("span", { lang: "blo" }, e.anii), " ", h("small", { class: "muted" }, e.id)]),
      isNew ? h("p", { class: "muted small" }, `Bekommt beim Speichern die ID ${S.data.next_id}. Einsortiert wird automatisch nach dem Anii-Alphabet.`) : null,
      form,
      isNew ? h("p", { class: "muted small" }, "Aufnahmen kannst du hinzufügen, sobald das Wort gespeichert ist.") : [audioBox(e, () => F.sprecher.value), e.plural ? audioBox(e, () => "", "pl") : null],
      keyDock());
    S.lastField = F.anii;
    if (isNew) F.anii.focus();
    else scheduleCheck();
  }

  // ------------------------------------------------------------ Aufnahme
  function audioBox(e, speaker, form = "sg") {
    const pl = form === "pl";
    const have = pl ? e._audio_pl : e._audio;
    const box = h("fieldset", null, h("legend", null, pl ? `Aufnahme Plural (${e.plural})` : "Aufnahme Singular"));
    const current = have
      ? h("div", { class: "rec" }, h("audio", { controls: true, preload: "none", src: `/admin/audio/${encodeURIComponent(have)}?t=${Date.now()}` }),
          h("small", { class: "muted" }, have),
          h("button", { class: "btn", type: "button", onclick: async () => {
            if (!confirm("Aufnahme entfernen?")) return;
            try { const r = await api("audio-delete", { id: e.id, form }); toast(pushNote(r.push)); await refresh(); } catch (err) { toast(err.message, true); }
          } }, "Entfernen"))
      : h("p", { class: "muted small" }, "Noch keine Aufnahme.");
    const preview = h("div", { class: "rec" });
    const recBtn = h("button", { class: "btn", type: "button" }, "● Aufnehmen");
    const file = h("input", { type: "file", accept: "audio/*", style: "max-width:100%" });
    const hint = pl ? null : h("p", { class: "muted small" }, "Nur mit Zustimmung der sprechenden Person (bei Kindern: der Eltern). Für viele Wörter am Stück: „Aufnehmen“ in der Wortliste.");

    async function upload(blob) {
      const type = (blob.type || "").split(";")[0] || "audio/webm";
      try {
        const r = await api(`audio?id=${encodeURIComponent(e.id)}&form=${form}&speaker=${encodeURIComponent(speaker())}`, blob, { type });
        toast(pushNote(r.push), r.push !== "ok");
        await refresh();
      } catch (err) { toast(err.message, true); }
    }
    async function refresh() {
      await load();
      viewForm(S.data.entries.find((x) => x.id === e.id));
    }
    file.addEventListener("change", () => { if (file.files[0]) upload(file.files[0]); });

    let rec = null;
    recBtn.addEventListener("click", async () => {
      if (rec) { rec.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) { toast("Aufnehmen geht in diesem Browser nicht – bitte Datei wählen.", true); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } }); } catch { toast("Kein Zugriff aufs Mikrofon.", true); return; }
      const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
      const chunks = [];
      rec.ondataavailable = (ev) => chunks.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
        rec = null;
        recBtn.textContent = "● Neu aufnehmen";
        recBtn.classList.remove("on");
        const url = URL.createObjectURL(blob);
        preview.replaceChildren(h("audio", { controls: true, src: url }),
          h("button", { class: "btn primary", type: "button", onclick: () => upload(blob) }, "Diese Aufnahme speichern"));
      };
      rec.start();
      recBtn.textContent = "■ Stopp";
      recBtn.classList.add("on");
    });

    box.append(current, h("div", { class: "rec", style: "margin-top:.6rem" }, recBtn, h("span", { class: "muted small" }, "oder Datei:"), file), preview, hint);
    return box;
  }

  // ------------------------------------------------------------ Aufnahme-Modus (viele Wörter am Stück, auch offline)
  // Jede Aufnahme landet zuerst auf dem Gerät (IndexedDB) und wird hochgeladen, sobald Netz da ist.
  // Schlüssel „w0012|sg“ / „w0012|pl“: eine neue Aufnahme ersetzt eine noch nicht hochgeladene.
  const Queue = {
    db: null, running: false, timer: 0, listeners: new Set(), last: 0,
    async open() {
      if (!this.db) {
        this.db = await new Promise((res, rej) => {
          const r = indexedDB.open("anii-aufnahmen", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("q", { keyPath: "key" });
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return this.db;
    },
    async req(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const r = fn(db.transaction("q", mode).objectStore("q"));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    all() { return this.req("readonly", (st) => st.getAll()); },
    get(key) { return this.req("readonly", (st) => st.get(key)); },
    async add(item) { await this.req("readwrite", (st) => st.put(item)); this.notify(); this.kick(); },
    async del(key) { await this.req("readwrite", (st) => st.delete(key)); this.notify(); },
    async notify() {
      try { this.last = (await this.all()).length; } catch { /* egal */ }
      this.listeners.forEach((f) => f(this.last));
    },
    async kick() {
      if (this.running) return;
      this.running = true;
      clearTimeout(this.timer);
      let left = 0;
      try {
        const items = (await this.all()).sort((a, b) => a.ts - b.ts);
        left = items.length;
        for (const it of items) {
          if (navigator.onLine === false) break;
          let res;
          try {
            res = await fetch(`/admin/api/audio?id=${encodeURIComponent(it.id)}&form=${it.form}`, {
              method: "POST", body: it.blob, headers: { "Content-Type": it.type }, credentials: "same-origin" });
          } catch { break; } // kein Netz: später nochmal
          if (res.status === 401) break; // abgemeldet: nach dem Anmelden weiter
          if (res.ok) {
            const r = await res.json().catch(() => ({}));
            await this.del(it.key);
            left--;
            const e = S.data && S.data.entries.find((x) => x.id === it.id);
            if (e && r.audio) e[it.form === "pl" ? "_audio_pl" : "_audio"] = r.audio;
          } else if (res.status >= 400 && res.status < 500) {
            const r = await res.json().catch(() => ({}));
            toast(`Aufnahme ${it.anii} (${it.form === "pl" ? "Plural" : "Singular"}) abgelehnt: ${r.error || res.status}`, true);
            await this.del(it.key);
            left--;
          } else break;
        }
      } catch { /* IndexedDB nicht verfügbar */ }
      this.running = false;
      this.notify();
      if (left > 0) this.timer = setTimeout(() => this.kick(), 20000);
    },
  };
  window.addEventListener("online", () => Queue.kick());

  const Mic = {
    stream: null, ctx: null, analyser: null, lock: null,
    async get() {
      if (!this.stream || !this.stream.active) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      try { if (!this.lock && navigator.wakeLock) this.lock = await navigator.wakeLock.request("screen"); } catch { /* egal */ }
      return this.stream;
    },
    release() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close().catch(() => {});
      if (this.lock) this.lock.release().catch(() => {});
      this.stream = this.ctx = this.analyser = this.lock = null;
    },
  };
  window.addEventListener("pagehide", () => Mic.release());

  const recType = () => ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";

  async function record(levelEl, maxMs = 8000) {
    const stream = await Mic.get();
    const type = recType();
    const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
    const chunks = [];
    const t0 = Date.now();
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    const done = new Promise((res) => { mr.onstop = () => res({ blob: new Blob(chunks, { type: (mr.mimeType || type || "audio/webm") }), ms: Date.now() - t0 }); });
    mr.start();
    const buf = new Uint8Array(Mic.analyser.fftSize);
    let raf = 0;
    const tick = () => {
      Mic.analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      levelEl.style.width = Math.min(100, (peak / 128) * 170) + "%";
      raf = requestAnimationFrame(tick);
    };
    tick();
    const timer = setTimeout(() => { if (mr.state === "recording") mr.stop(); }, maxMs);
    return {
      stop() { if (mr.state === "recording") mr.stop(); },
      done: done.finally(() => { clearTimeout(timer); cancelAnimationFrame(raf); levelEl.style.width = "0%"; }),
    };
  }

  const REC = { lesson: "", onlyMissing: true, plural: true };

  function recList() {
    const d = S.data;
    const order = (l) => { const i = d.lessons.indexOf(l); return i < 0 ? 999 : i; };
    return d.entries.filter((e) => !REC.lesson || e.lektion === REC.lesson)
      .sort((a, b) => order(a.lektion) - order(b.lektion) || a.id.localeCompare(b.id));
  }

  async function viewRecordSetup() {
    Mic.release();
    const d = S.data;
    const queued = new Set((await Queue.all().catch(() => [])).map((x) => x.key));
    const missing = (e) => (!e._audio && !queued.has(e.id + "|sg")) || (REC.plural && e.plural && !e._audio_pl && !queued.has(e.id + "|pl"));
    const sel = h("select", null, h("option", { value: "" }, "Alle Lektionen"), d.lessons.map((l) => h("option", { value: l, selected: l === REC.lesson }, l)));
    const only = h("input", { type: "checkbox", checked: REC.onlyMissing });
    const pl = h("input", { type: "checkbox", checked: REC.plural });
    const count = h("p", { class: "muted" });
    const upd = () => {
      REC.lesson = sel.value; REC.onlyMissing = only.checked; REC.plural = pl.checked;
      const all = recList();
      const todo = all.filter(missing);
      count.textContent = `${all.length} Wörter, davon ${todo.length} mit fehlender Aufnahme.`;
    };
    [sel, only, pl].forEach((x) => x.addEventListener("change", upd));
    const qs = queueStatus();
    app.replaceChildren(
      h("p", { class: "small" }, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); viewList(); } }, "← alle Wörter")),
      h("h1", null, "Aufnehmen"),
      h("p", { class: "lead" }, "Ein Wort nach dem anderen: groß anzeigen, aufnehmen, anhören, behalten. Funktioniert auch ohne Netz – die Aufnahmen werden hochgeladen, sobald wieder Verbindung da ist."),
      h("div", { class: "panel" },
        h("label", { class: "field" }, "Lektion", sel),
        h("label", { class: "row-check" }, only, "Nur Wörter, bei denen noch eine Aufnahme fehlt"),
        h("label", { class: "row-check" }, pl, "Plural auch aufnehmen (wenn eingetragen)"),
        count,
        h("button", { class: "btn primary big", type: "button", onclick: async () => {
          const list = REC.onlyMissing ? recList().filter(missing) : recList();
          if (!list.length) { toast("In dieser Auswahl fehlen keine Aufnahmen."); return; }
          if (!navigator.mediaDevices || !window.MediaRecorder) { toast("Dieser Browser kann nicht aufnehmen. Bitte Chrome oder Firefox auf dem Handy benutzen.", true); return; }
          try { await Mic.get(); } catch { toast("Kein Zugriff aufs Mikrofon. Bitte im Browser erlauben.", true); return; }
          viewRecord(list, 0);
        } }, "● Starten")),
      h("p", { class: "muted small" }, "Bitte nur mit Einverständnis der Eltern aufnehmen. Namen der Kinder werden nirgends gespeichert oder veröffentlicht."),
      qs);
    upd();
  }

  function queueStatus() {
    const el = h("p", { class: "qstat", role: "status" });
    const show = (n) => {
      if (el.isConnected) el.dataset.seen = "1";
      else if (el.dataset.seen) { Queue.listeners.delete(show); return; } // Ansicht verlassen
      el.className = "qstat" + (n ? " wait" : "");
      el.textContent = n ? `${n} Aufnahme${n === 1 ? "" : "n"} warten auf Upload${navigator.onLine === false ? " (kein Netz)" : " …"}` : "✓ Alles hochgeladen";
    };
    Queue.listeners.add(show);
    Queue.notify();
    return el;
  }

  async function viewRecord(list, i) {
    if (i < 0) i = 0;
    if (i >= list.length) return recDone(list);
    const e = list[i];
    const forms = [["sg", "Singular", e.anii]];
    if (REC.plural && e.plural) forms.push(["pl", "Plural", e.plural]);
    const kept = new Set();
    const next = () => viewRecord(list, i + 1);

    async function block(form, label, word) {
      const key = e.id + "|" + form;
      const server = form === "pl" ? e._audio_pl : e._audio;
      const queued = await Queue.get(key).catch(() => null);
      const wrap = h("div", { class: "recform" });
      const level = h("span");
      const meter = h("div", { class: "level" }, level);
      const state = h("div", { class: "recstate" });
      const recBtn = h("button", { class: "recbtn", type: "button", "aria-label": `${label} aufnehmen` }, "●");
      let current = null;

      function showHave() {
        const src = queued ? URL.createObjectURL(queued.blob) : server ? `/admin/audio/${encodeURIComponent(server)}?t=${Date.now()}` : null;
        state.replaceChildren(src
          ? h("span", { class: "ok" }, "✓ ", queued ? "aufgenommen (wartet auf Upload)" : "vorhanden", " ",
              h("button", { class: "btn small", type: "button", onclick: () => new Audio(src).play() }, "▶ Anhören"))
          : h("span", { class: "muted" }, "noch keine Aufnahme"));
      }
      showHave();

      recBtn.addEventListener("click", async () => {
        if (current) { current.stop(); return; }
        try { current = await record(level); } catch { toast("Kein Zugriff aufs Mikrofon.", true); return; }
        recBtn.classList.add("on");
        recBtn.textContent = "■";
        state.replaceChildren(h("span", { class: "live" }, "Aufnahme läuft – jetzt sprechen"));
        const { blob, ms } = await current.done;
        current = null;
        recBtn.classList.remove("on");
        recBtn.textContent = "●";
        if (ms < 400 || blob.size < 1000) { toast("Zu kurz – bitte nochmal.", true); showHave(); return; }
        const url = URL.createObjectURL(blob);
        new Audio(url).play().catch(() => {});
        state.replaceChildren(
          h("button", { class: "btn small", type: "button", onclick: () => new Audio(url).play() }, "▶ Nochmal anhören"),
          h("button", { class: "btn primary", type: "button", onclick: async () => {
            await Queue.add({ key, id: e.id, form, anii: e.anii, type: (blob.type || "audio/webm").split(";")[0], blob, ts: Date.now() });
            kept.add(form);
            state.replaceChildren(h("span", { class: "ok" }, "✓ gespeichert"));
            if (forms.every(([f]) => kept.has(f) || (f === "pl" ? e._audio_pl : e._audio))) setTimeout(next, 700);
          } }, "✓ Behalten"),
          h("button", { class: "btn", type: "button", onclick: () => recBtn.click() }, "↺ Neu aufnehmen"));
      });
      wrap.append(h("div", { class: "reclabel" }, h("span", { class: "muted small" }, label), h("b", { lang: "blo" }, word)), recBtn, meter, state);
      return wrap;
    }

    const blocks = await Promise.all(forms.map(([f, l, w]) => block(f, l, w)));
    app.replaceChildren(
      h("div", { class: "rechead" },
        h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); Mic.release(); viewRecordSetup(); } }, "← Ende"),
        h("span", { class: "muted" }, `${i + 1} / ${list.length}`),
        queueStatus()),
      h("div", { class: "meter-bar" }, h("span", { style: `width:${Math.round((i / list.length) * 100)}%` })),
      h("div", { class: "recword" },
        h("div", { class: "big", lang: "blo" }, e.anii),
        h("div", { class: "muted" }, [e.francais, e.deutsch].filter(Boolean).join(" · ")),
        e.lektion ? h("div", { class: "muted small" }, e.lektion) : null),
      blocks,
      h("div", { class: "recnav" },
        h("button", { class: "btn", type: "button", disabled: i === 0, onclick: () => viewRecord(list, i - 1) }, "← Zurück"),
        h("button", { class: "btn primary", type: "button", onclick: next }, i + 1 < list.length ? "Weiter →" : "Fertig")));
  }

  function recDone(list) {
    Mic.release();
    app.replaceChildren(
      h("h1", null, "Geschafft"),
      h("p", { class: "lead" }, `${list.length} Wörter durchgegangen. Die Aufnahmen erscheinen auf der Seite etwa 2 Minuten nach dem Upload.`),
      queueStatus(),
      h("div", { class: "row gap" },
        h("button", { class: "btn primary", type: "button", onclick: () => viewRecordSetup() }, "Weitere aufnehmen"),
        h("button", { class: "btn", type: "button", onclick: () => viewList() }, "Zur Wortliste")));
  }

  // ------------------------------------------------------------ Tabelle (wie Excel)
  const TCOLS = [
    ["anii", "Anii", 11, true], ["francais", "Français", 13], ["deutsch", "Deutsch", 13], ["lektion", "Lektion", 12],
    ["plural", "Plural", 9, true], ["beispiel", "Beispiel", 12, true], ["notiz", "Anmerkung", 18, true],
    ["quelle", "Quelle", 7], ["datum", "Datum", 8.5],
  ];
  let dirty = new Map(); // key -> {id, fields}
  window.addEventListener("beforeunload", (ev) => { if (dirty.size) { ev.preventDefault(); ev.returnValue = ""; } });

  function viewTable(keepFilter) {
    const d = S.data;
    if (!keepFilter) dirty = new Map();
    const lessonOrder = (l) => { const i = d.lessons.indexOf(l); return i < 0 ? 999 : i; };
    const rows = d.entries.slice().sort((a, b) => lessonOrder(a.lektion) - lessonOrder(b.lektion) || a.id.localeCompare(b.id));
    const sel = h("select", null, h("option", { value: "" }, "Alle Lektionen"), d.lessons.map((l) => h("option", { value: l, selected: l === S.lesson }, l)));
    const q = h("input", { type: "search", placeholder: "Filtern", value: S.q, autocomplete: "off", spellcheck: "false" });
    const tbody = h("tbody");
    const saveBtn = h("button", { class: "btn primary", type: "button", disabled: true }, "Speichern");
    const info = h("span", { class: "small muted" });
    let newCount = 0;

    function updSave() {
      saveBtn.disabled = !dirty.size;
      saveBtn.textContent = dirty.size ? `Speichern (${dirty.size})` : "Speichern";
      info.textContent = dirty.size ? "ungespeicherte Änderungen" : "";
    }
    function rowEl(e, key) {
      const tr = h("tr", { "data-key": key });
      tr.append(h("td", { class: "tid" }, e.id ? h("a", { href: "#", title: "Formular öffnen (Audio, Sprecher, Löschen)", onclick: (ev) => {
        ev.preventDefault();
        if (dirty.size && !confirm("Ungespeicherte Änderungen in der Tabelle verwerfen?")) return;
        dirty = new Map();
        viewForm(d.entries.find((x) => x.id === e.id));
      } }, e.id) : h("span", { class: "muted" }, "neu")));
      for (const [col, , , isAnii] of TCOLS) {
        const inp = h("input", { value: e[col] || "", "data-col": col, list: col === "lektion" ? "t-lessons" : null,
          lang: isAnii ? "blo" : null, spellcheck: isAnii ? "false" : null, autocomplete: "off", autocapitalize: "off" });
        if (isAnii) inp.addEventListener("focus", () => { S.lastField = inp; });
        inp.addEventListener("input", () => {
          const entry = dirty.get(key) || { id: e.id, key, fields: {} };
          entry.fields[col] = inp.value;
          dirty.set(key, entry);
          tr.classList.add("dirty");
          updSave();
        });
        tr.append(h("td", null, inp));
      }
      const ok = h("input", { type: "checkbox", checked: e.geprueft === "ja", title: "Herkunft geprüft" });
      ok.addEventListener("change", () => {
        const entry = dirty.get(key) || { id: e.id, key, fields: {} };
        entry.fields.geprueft = ok.checked ? "ja" : "nein";
        dirty.set(key, entry);
        tr.classList.add("dirty");
        updSave();
      });
      tr.append(h("td", { class: "tc" }, ok), h("td", { class: "tc" }, e._audio ? "🔊" : ""));
      return tr;
    }
    function render() {
      const f = fold(S.q.trim());
      tbody.replaceChildren(...rows.filter((e) => (!S.lesson || e.lektion === S.lesson) &&
        (!f || fold([e.id, e.anii, e.francais, e.deutsch, e.notiz].join(" ")).includes(f))).map((e) => rowEl(e, e.id)));
    }
    function addRow() {
      const key = "neu" + ++newCount;
      const today = new Date().toISOString().slice(0, 10);
      const e = { id: "", lektion: S.lesson || remember.get("lektion", ""), quelle: remember.get("quelle", ""), datum: today, geprueft: "nein" };
      const tr = rowEl(e, key);
      tr.classList.add("dirty", "new");
      dirty.set(key, { id: "", key, fields: { lektion: e.lektion, quelle: e.quelle, datum: today, dialekt: "Balanka" } });
      tbody.append(tr);
      updSave();
      tr.querySelector("input").focus();
    }
    async function save() {
      saveBtn.disabled = true;
      tbody.querySelectorAll(".msgrow").forEach((x) => x.remove());
      tbody.querySelectorAll("tr.err").forEach((x) => x.classList.remove("err"));
      try {
        const r = await api("save-many", { rows: [...dirty.values()] });
        if (r.status === 422) {
          for (const [key, msgs] of Object.entries(r.messages || {})) {
            const tr = tbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
            if (!tr || !msgs.length) continue;
            if (r.errors && r.errors[key]) tr.classList.add("err");
            tr.after(h("tr", { class: "msgrow" }, h("td", { colspan: String(TCOLS.length + 3) },
              h("ul", { class: "msgs" }, msgs.map((m) => h("li", { class: m.level }, m.msg))))));
          }
          toast(`Nicht gespeichert – ${Object.keys(r.errors).length} Zeile(n) mit Fehlern (rot).`, true);
          updSave();
          return;
        }
        const last = [...dirty.values()].pop();
        if (last && last.fields.lektion) remember.set("lektion", last.fields.lektion);
        if (last && last.fields.quelle) remember.set("quelle", last.fields.quelle);
        const warn = Object.values(r.messages || {}).flat().filter((m) => m.level === "WARNUNG").length;
        toast(`${Object.keys(r.ids).length} Zeile(n) gespeichert. ` + pushNote(r.push) + (warn ? ` ${warn} Warnung(en) – siehe Formular.` : ""),
          r.push !== "ok" && r.push !== "keine Änderung");
        dirty = new Map();
        await load();
        viewTable(true);
      } catch (err) {
        toast(err.message, true);
        updSave();
      }
    }
    saveBtn.addEventListener("click", save);
    q.addEventListener("input", () => { S.q = q.value; render(); });
    sel.addEventListener("change", () => { S.lesson = sel.value; render(); });

    app.replaceChildren(
      h("p", { class: "small" }, h("a", { href: "#", onclick: (ev) => {
        ev.preventDefault();
        if (dirty.size && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
        dirty = new Map(); viewList();
      } }, "← Liste")),
      h("h1", null, "Tabelle"),
      h("p", { class: "muted small" }, "Zellen direkt bearbeiten, neue Zeilen unten anfügen, dann „Speichern“. Neue Wörter bekommen beim Speichern automatisch die nächste ID. Für Aufnahmen, Sprecher oder Löschen auf die ID klicken."),
      h("div", { class: "bar" }, q, sel),
      h("datalist", { id: "t-lessons" }, d.lessons.map((l) => h("option", { value: l }))),
      h("div", { class: "table-wrap" }, h("table", { class: "grid-table" },
        h("colgroup", null, h("col", { style: "width:4.5rem" }), TCOLS.map(([, , w]) => h("col", { style: `width:${w}rem` })), h("col", { style: "width:2.5rem" }), h("col", { style: "width:2rem" })),
        h("thead", null, h("tr", null, h("th", null, "ID"), TCOLS.map(([, label]) => h("th", null, label)), h("th", { title: "Herkunft geprüft" }, "✓"), h("th", { title: "Aufnahme" }, "🔊"))),
        tbody)),
      h("div", { class: "table-actions" },
        h("button", { class: "btn", type: "button", onclick: addRow }, "+ Zeile"),
        h("button", { class: "btn", type: "button", onclick: () => { for (let i = 0; i < 5; i++) addRow(); } }, "+ 5 Zeilen"),
        saveBtn, info),
      keyDock());
    render();
    updSave();
  }

  // ------------------------------------------------------------ Sprecher
  function viewSpeakers() {
    const list = S.data.speakers;
    const name = h("input", { autocomplete: "off" });
    const ort = h("input", { value: "Balanka" });
    const ok = h("input", { type: "checkbox" });
    app.replaceChildren(
      h("p", { class: "small" }, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); viewList(); } }, "← alle Wörter")),
      h("h1", null, "Sprecherinnen und Sprecher"),
      list.length ? h("ul", { class: "list" }, list.map((s) => h("li", null, h("button", { type: "button", onclick: async () => {
        const z = s.zustimmung === "ja" ? "nein" : "ja";
        if (!confirm(`Zustimmung für ${s.name} auf „${z}“ setzen?`)) return;
        try { const r = await api("speaker", { ...s, zustimmung: z }); toast(pushNote(r.push)); await load(); viewSpeakers(); } catch (err) { toast(err.message, true); }
      } }, h("span", { class: "a" }, s.kuerzel), h("span", { class: "f" }, s.name, s.ort ? ` (${s.ort})` : ""),
        h("span", { class: "tags" }, s.zustimmung === "ja" ? "Zustimmung ✓" : "keine Zustimmung"))))) : h("p", { class: "muted" }, "Noch niemand eingetragen."),
      h("form", { class: "panel", onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          const r = await api("speaker", { name: name.value, ort: ort.value, zustimmung: ok.checked ? "ja" : "nein", datum_zustimmung: ok.checked ? new Date().toISOString().slice(0, 10) : "" });
          toast(`${r.kuerzel} angelegt. ` + pushNote(r.push));
          await load(); viewSpeakers();
        } catch (err) { toast(err.message, true); }
      } }, h("h2", null, "Neu"),
        h("label", { class: "field" }, "Name (wie er auf der Seite stehen darf)", name),
        h("label", { class: "field" }, "Ort", ort),
        h("label", { class: "row-check" }, ok, "hat zugestimmt, dass Aufnahmen und Name unter CC BY-SA 4.0 veröffentlicht werden"),
        h("button", { class: "btn primary" }, "Anlegen")));
  }

  async function start() {
    Queue.kick();
    try { await load(); viewList(); } catch (e) { if (S.data === null) app.replaceChildren(h("p", { class: "error" }, e.message)); }
  }
  api("me").then((r) => (r.ok ? start() : viewLogin())).catch((e) => app.replaceChildren(h("p", { class: "error" }, e.message)));
})();
