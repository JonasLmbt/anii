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
      isNew ? h("p", { class: "muted small" }, "Aufnahmen kannst du hinzufügen, sobald das Wort gespeichert ist.") : audioBox(e, () => F.sprecher.value),
      keyDock());
    S.lastField = F.anii;
    if (isNew) F.anii.focus();
    else scheduleCheck();
  }

  // ------------------------------------------------------------ Aufnahme
  function audioBox(e, speaker) {
    const box = h("fieldset", null, h("legend", null, "Aufnahme"));
    const current = e._audio
      ? h("div", { class: "rec" }, h("audio", { controls: true, preload: "none", src: `/admin/audio/${encodeURIComponent(e._audio)}?t=${Date.now()}` }),
          h("small", { class: "muted" }, e._audio),
          h("button", { class: "btn", type: "button", onclick: async () => {
            if (!confirm("Aufnahme entfernen?")) return;
            try { const r = await api("audio-delete", { id: e.id }); toast(pushNote(r.push)); await refresh(); } catch (err) { toast(err.message, true); }
          } }, "Entfernen"))
      : h("p", { class: "muted small" }, "Noch keine Aufnahme.");
    const preview = h("div", { class: "rec" });
    const recBtn = h("button", { class: "btn", type: "button" }, "● Aufnehmen");
    const file = h("input", { type: "file", accept: "audio/*", style: "max-width:100%" });
    const hint = h("p", { class: "muted small" }, "Nur mit Zustimmung der sprechenden Person. Sprecher oben im Formular wählen – ohne Zustimmung wird die Aufnahme nicht veröffentlicht.");

    async function upload(blob) {
      const type = (blob.type || "").split(";")[0] || "audio/webm";
      try {
        const r = await api(`audio?id=${encodeURIComponent(e.id)}&speaker=${encodeURIComponent(speaker())}`, blob, { type });
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
    try { await load(); viewList(); } catch (e) { if (S.data === null) app.replaceChildren(h("p", { class: "error" }, e.message)); }
  }
  api("me").then((r) => (r.ok ? start() : viewLogin())).catch((e) => app.replaceChildren(h("p", { class: "error" }, e.message)));
})();
