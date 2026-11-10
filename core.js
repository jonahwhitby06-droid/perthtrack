/* Runs on every page: header, footer, data loading and the user's saved state.
   Works in two modes:
   - server: talks to the PerthTrack API (accounts, email alerts, nightly page checks)
   - local:  no server found (e.g. the static demo); data comes from data/programs.json and
             everything the user saves stays in this browser. */
(function () {
  const PT = window.PT;
  const LS_KEY = "pt-local-v1";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- local storage (wrapped: storage can be blocked) ---------- */
  function readLocal() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) {}
    s.watch = s.watch || []; s.contacts = s.contacts || []; s.applications = s.applications || [];
    s.alerts = s.alerts || []; s.prefs = { ...PT.DEFAULT_PREFS, ...(s.prefs || {}) }; s.nextId = s.nextId || 1;
    try { /* carry over stars from the first PerthTrack page */
      const old = JSON.parse(localStorage.getItem("perthtrack-watch") || "[]");
      old.forEach(id => { if (!s.watch.includes(id)) s.watch.push(id); });
    } catch (e) {}
    return s;
  }
  function writeLocal(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {} }

  async function api(method, url, body) {
    const opt = { method, headers: { "content-type": "application/json" }, credentials: "same-origin" };
    if (method !== "GET") opt.body = JSON.stringify(body || {});
    const r = await fetch(url, opt);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  const Store = {
    mode: "local", programs: [], byId: {}, updated: null, user: null,
    prefs: { ...PT.DEFAULT_PREFS }, watch: new Set(), contacts: new Set(), events: [], lastRun: null,

    async init() {
      const isStatic = document.documentElement.dataset.static === "1";
      if (!isStatic) try {
        const h = await fetch("/api/health", { credentials: "same-origin" });
        const j = h.ok ? await h.json() : null;
        if (j && j.mode === "server") this.mode = "server";
      } catch (e) {}
      if (this.mode === "server") {
        const [pd, me, ev] = await Promise.all([api("GET", "/api/programs"), api("GET", "/api/me"), api("GET", "/api/events").catch(() => ({ events: [] }))]);
        this.programs = pd.programs; this.updated = pd.updated; this.events = ev.events || []; this.lastRun = ev.lastRun;
        if (me.user) {
          this.user = me.user; this.prefs = { ...PT.DEFAULT_PREFS, ...me.user.prefs };
          this.watch = new Set(me.watch); this.contacts = new Set(me.contacts);
        } else this.loadLocalState();
      } else {
        const r = await fetch("programs.json");
        const pd = await r.json();
        this.programs = pd.programs; this.updated = pd.updated;
        this.loadLocalState();
      }
      this.prefs = { ...PT.DEFAULT_PREFS, ...this.prefs };
      this.allPrograms = this.programs;
      this.byId = Object.fromEntries(this.allPrograms.map(p => [p.id, p]));
      this.programs = this.allPrograms.filter(p => PT.inField(p, this.prefs.field));
    },
    get field() { return this.prefs.field || "All"; },
    async setField(field) {
      const prefs = { field };
      if (field !== "All" && !this.prefs.interests.some(x => PT.FIELD_OF[x] === field)) {
        prefs.interests = [...PT.DEFAULT_INTERESTS[field], ...this.prefs.interests].slice(0, 6);
      }
      await this.setPrefs(prefs);
    },
    loadLocalState() {
      const s = readLocal();
      this.prefs = s.prefs; this.watch = new Set(s.watch); this.contacts = new Set(s.contacts);
    },
    get signedIn() { return !!this.user; },

    async toggle(kind, id) {
      const set = this[kind];
      const on = !set.has(id);
      on ? set.add(id) : set.delete(id);
      if (this.signedIn) await api("PUT", `/api/me/${kind}/${id}`, { on });
      else { const s = readLocal(); s[kind] = [...set]; writeLocal(s); }
      return on;
    },
    async setPrefs(p) {
      this.prefs = { ...this.prefs, ...p };
      if (this.signedIn) await api("PUT", "/api/me/prefs", this.prefs);
      else { const s = readLocal(); s.prefs = this.prefs; writeLocal(s); }
    },
    apps: {
      async list() { return Store.signedIn ? (await api("GET", "/api/me/applications")).applications : readLocal().applications; },
      async add(a) {
        if (Store.signedIn) return api("POST", "/api/me/applications", a);
        const s = readLocal(); const row = { id: s.nextId++, status: "Interested", team: "", notes: "", applied_on: null, ...a, updated: new Date().toISOString() };
        s.applications.unshift(row); writeLocal(s); return row;
      },
      async update(id, patch) {
        if (Store.signedIn) return api("PUT", `/api/me/applications/${id}`, patch);
        const s = readLocal(); const row = s.applications.find(x => x.id === id);
        Object.assign(row, patch, { updated: new Date().toISOString() }); writeLocal(s); return row;
      },
      async remove(id) {
        if (Store.signedIn) return api("DELETE", `/api/me/applications/${id}`);
        const s = readLocal(); s.applications = s.applications.filter(x => x.id !== id); writeLocal(s);
      }
    },
    alerts: {
      async list() { return Store.signedIn ? (await api("GET", "/api/me/alerts")).alerts : readLocal().alerts; },
      async add(a) {
        if (Store.signedIn) return api("POST", "/api/me/alerts", a);
        const s = readLocal(); s.alerts.push({ id: s.nextId++, ...a }); writeLocal(s);
      },
      async remove(id) {
        if (Store.signedIn) return api("DELETE", `/api/me/alerts/${id}`);
        const s = readLocal(); s.alerts = s.alerts.filter(x => x.id !== id); writeLocal(s);
      }
    },
    localSnapshot() { return readLocal(); },
    clearLocal() { try { localStorage.removeItem(LS_KEY); localStorage.removeItem("perthtrack-watch"); } catch (e) {} }
  };

  /* ---------- header & footer ---------- */
  const NAV = [
    ["tracker.html", "Tracker"], ["best-bets.html", "Best bets"], ["companies.html", "Companies"],
    ["calendar.html", "Calendar"], ["saved.html", "My applications"], ["network.html", "My network"], ["alerts.html", "Alerts"], ["resources.html", "Guides"]
  ];
  function renderChrome() {
    const here = location.pathname.split("/").pop() || "index.html";
    const hdr = document.getElementById("hdr");
    if (hdr) {
      const acct = Store.mode !== "server" ? `<span class="mode-note" title="Your stars and applications are saved in this browser">Saved on this device</span>`
        : Store.signedIn ? `<a class="btn ghost" href="account.html">${esc(Store.user.email.split("@")[0])}</a>`
        : `<a class="nav-link" href="login.html">Log in</a><a class="btn" href="signup.html">Sign up free</a>`;
      hdr.innerHTML = `<header class="top"><div class="wrap">
        <a class="logo" href="index.html"><span class="dot"></span>PerthTrack</a>
        <button class="menu-btn" aria-expanded="false" aria-controls="mainnav" aria-label="Open menu">☰</button>
        <div class="fieldswitch" role="group" aria-label="Show internships for">${["Finance", "Engineering", "All"].map(f => `<button data-field="${f}" aria-pressed="${Store.field === f}">${f}</button>`).join("")}</div>
        <nav class="main" id="mainnav" aria-label="Main">${NAV.map(([h, t]) => `<a href="${h}"${h === here ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>
        <div class="acct"><button class="btn small li-btn" id="liBtn" type="button">${window.Net && Net.has ? `<span class="in">in</span> ${Net.count} connected` : `<span class="in">in</span> Connect LinkedIn`}</button>${acct}</div>
      </div></header>`;
      hdr.querySelector("#liBtn").onclick = () => openLinkedIn();
      hdr.querySelectorAll("[data-field]").forEach(b => b.onclick = async () => {
        if (b.dataset.field === Store.field) return;
        try { await Store.setField(b.dataset.field); } catch (e) {}
        location.reload();
      });
      const btn = hdr.querySelector(".menu-btn"), nav = hdr.querySelector("nav.main");
      btn.onclick = () => { const o = nav.classList.toggle("open"); btn.setAttribute("aria-expanded", o); btn.setAttribute("aria-label", o ? "Close menu" : "Open menu"); };
    }
    const ftr = document.getElementById("ftr");
    if (ftr) ftr.innerHTML = `<footer class="foot"><div class="wrap">
      <div class="foot-grid">
        <div><a class="logo" href="index.html"><span class="dot"></span>PerthTrack</a><p>Every finance and engineering internship in Perth, and when its window opens. Built by a Perth student, for Perth students.</p></div>
        <div><h4>Tracker</h4><a href="tracker.html">All programs</a><a href="best-bets.html">Best bets</a><a href="companies.html">Companies</a><a href="calendar.html">Calendar</a></div>
        <div><h4>Guides</h4><a href="guide-timeline.html">Perth recruiting timeline</a><a href="guide-winter.html">Winter internships</a><a href="guide-cv.html">Finance CV checklist</a><a href="guide-cover-letter.html">Cover letter template</a><a href="guide-engineering.html">Engineering vacation programs</a><a href="guide-linkedin.html">How to connect LinkedIn</a></div>
        <div><h4>About</h4><a href="faq.html">FAQ</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a></div>
      </div>
      <p class="fine">Data checked against each firm's own pages${Store.updated ? `, last updated ${esc(String(Store.updated).slice(0, 10))}` : ""}. Dates marked “est.” are projected from last cycle. Not affiliated with any listed firm; verify on the firm's site before you apply.</p>
    </div></footer>`;
  }

  /* ---------- shared bits of UI ---------- */
  function initials(name) { return name.replace(/\(.*\)/, "").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase(); }
  function mark(p) { return `<span class="mark" style="background:${p.color}">${esc(initials(p.firm))}</span>`; }
  function windowText(p) {
    const s = PT.statusOf(p);
    let next = "—", count = "";
    if (s.win) {
      next = `${PT.fmtShort(s.win.od)} to ${PT.fmt(s.win.cd)}${s.win.est ? '<span class="est">est.</span>' : ""}`;
      count = s.key === "open" ? `<span class="mono">${s.days}</span> days left` : `in <span class="mono">${s.days}</span> days`;
    } else if (s.key === "adhoc") next = "No fixed window";
    else if (s.key === "tbc") next = "Not yet published";
    return { s, next, count };
  }
  function pill(s) { return `<span class="pill ${s.key}">${esc(s.label)}</span>`; }
  function toast(msg) {
    let t = document.getElementById("toastbox");
    if (!t) { t = document.createElement("div"); t.id = "toastbox"; t.className = "toastbox"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3500);
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function isLight(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 165; }
  function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const f = c => Math.max(0, Math.round(c * (1 - amt))); return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map(x => x.toString(16).padStart(2, "0")).join(""); }
  function meter(n, cls) { return `<span class="meter ${cls}" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`; }

  /* Team tiles for one program, ranked for the current user. */
  function teamTiles(p) {
    const rs = PT.rolesFor(p, Store.prefs).sort((a, b) => b.score - a.score);
    const light = isLight(p.color);
    const conns = window.Net ? Net.atProgram(p) : [];
    return `<div class="teams-h"><h4>Teams at ${esc(p.firm)}</h4><span>Ranked for you · click a team for the careers page</span></div>
    <div class="tiles">${rs.map((r, i) => `<a class="tile${light ? " dark" : ""}" href="${esc(p.url)}" target="_blank" rel="noopener"
      style="background:linear-gradient(180deg,${p.color},${shade(p.color, .18)});color:${light ? "#1a1a1a" : "#fff"}"
      aria-label="${esc(r.role)} at ${esc(p.firm)}: fit ${r.fit} of 5, competition ${PT.COMP_LABEL[r.comp]}, score ${r.score}. Opens careers page">
      <span class="rank">#${i + 1}</span><span class="tn">${esc(r.role)}</span>
      ${(n => n ? `<span class="tconn">👥 ${n} connection${n > 1 ? "s" : ""} here</span>` : "")(conns.filter(c => c.team === r.role).length)}
      <span><span class="tm"><b>Fit ${r.fit}/5</b><b>Comp. ${PT.COMP_LABEL[r.comp]}</b><b>Score ${r.score}</b></span>
      <span class="tf">Find out more <i>›</i></span></span></a>`).join("")}</div>`;
  }

  function detailBlock(p) {
    return `<dl class="detail-grid">
      <div><dt>Last cycle</dt><dd>${esc(p.last)}</dd></div>
      <div><dt>Eligibility</dt><dd>${esc(p.elig)}${p.finalYear ? ' <span class="fy">Final-year OK</span>' : ""}</dd></div>
      <div><dt>Length</dt><dd>${esc(p.duration)}</dd></div>
      <div><dt>Projected windows</dt><dd>${(p.windows || []).length ? p.windows.map(w => `${esc(w.label)}: ${PT.fmt(PT.d(w.o))} to ${PT.fmt(PT.d(w.c))}${w.est ? " (est.)" : ""}`).join("<br>") : "None published"}</dd></div>
      <div class="wide"><dt>Notes</dt><dd>${esc(p.note)} <a href="${esc(p.url)}" target="_blank" rel="noopener">Source ↗</a></dd></div>
    </dl>
    <div class="detail-actions">
      <button class="btn small" data-act="watch" data-id="${p.id}">${Store.watch.has(p.id) ? "★ Watching" : "☆ Watch"}</button>
      <button class="btn small ghost" data-act="track" data-id="${p.id}">+ Track my application</button>
      <button class="btn small ghost" data-act="contact" data-id="${p.id}" aria-pressed="${Store.contacts.has(p.id)}">${Store.contacts.has(p.id) ? "✓ I know someone here" : "I know someone here"}</button>
    </div>
    ${networkBlock([p], p.firm)}
    ${teamTiles(p)}`;
  }
  /* Who the user knows at a firm, from their own LinkedIn export (kept on this device). */
  function networkBlock(programs, firm) {
    const second = window.Net ? `<a href="${esc(Net.secondDegreeUrl(firm))}" target="_blank" rel="noopener">See your 2nd-degree connections at ${esc(firm.replace(/\(.*?\)/g, "").trim())} on LinkedIn ↗</a>` : "";
    if (!window.Net || !Net.has) return `<div class="netbox empty"><b>Your network:</b> <a href="#" data-connect-li>connect LinkedIn</a> to see who you know here and which team they're in. · ${second}</div>`;
    const list = Net.atPrograms(programs);
    if (!list.length) return `<div class="netbox empty"><b>Your network:</b> none of your ${Net.count} connections list this firm as their current company. · ${second}</div>`;
    const teams = {};
    list.forEach(c => { const t = c.team || "Team not matched"; (teams[t] = teams[t] || []).push(c); });
    return `<div class="netbox"><div class="nethead"><b>👥 You know ${list.length} ${list.length === 1 ? "person" : "people"} here</b><span>${second}</span></div>
      ${Object.entries(teams).sort((a, b) => (a[0] === "Team not matched") - (b[0] === "Team not matched") || b[1].length - a[1].length).map(([t, cs]) =>
        `<div class="netteam"><span class="sector">${esc(t)} · ${cs.length}</span><ul>${cs.map(c => `<li>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)} — ${esc(c.position || "role not listed")}</li>`).join("")}</ul></div>`).join("")}
    </div>`;
  }
  /* Handles the buttons inside detailBlock wherever it's shown. */
  function bindDetailActions(root, rerender) {
    root.querySelectorAll("[data-act]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const id = b.dataset.id, act = b.dataset.act;
      try {
        if (act === "watch") { const on = await Store.toggle("watch", id); toast(on ? "Added to your watchlist." : "Removed from your watchlist."); }
        if (act === "contact") { await Store.toggle("contacts", id); }
        if (act === "track") { await Store.apps.add({ program_id: id, status: "Interested" }); toast("Added to My applications."); }
      } catch (err) { toast(err.message); }
      rerender && rerender();
    });
  }

  /* Checkbox list of interest categories, grouped by field. Shows the current field only, unless "All". */
  function interestChecks(prefs, field) {
    const fields = field && field !== "All" ? [field] : PT.FIELDS;
    return fields.map(f => `<div class="ifield"><span class="sector">${f}</span><div class="checks">${PT.CATEGORIES.filter(c => c.field === f).map(c =>
      `<label><input type="checkbox" value="${c.id}" ${prefs.interests.includes(c.id) ? "checked" : ""}> ${esc(c.label)}</label>`).join("")}</div></div>`).join("");
  }
  function readInterests(root, prefs) {
    const picked = [...root.querySelectorAll("input:checked")].map(i => i.value);
    const shown = new Set([...root.querySelectorAll("input")].map(i => i.value));
    /* keep picks from fields not shown here, keep existing order, then add new picks */
    const kept = prefs.interests.filter(x => !shown.has(x) || picked.includes(x));
    return [...kept, ...picked.filter(x => !kept.includes(x))].slice(0, 8);
  }
  /* ---------- Connect LinkedIn dialog ---------- */
  const LI_CONNECTIONS = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
  const LI_DOWNLOAD = "https://www.linkedin.com/mypreferences/d/download-my-data";
  function openLinkedIn(tab) {
    if (!window.Net) return;
    let dlg = document.getElementById("liDialog");
    if (dlg) dlg.remove();
    dlg = document.createElement("dialog");
    dlg.id = "liDialog"; dlg.className = "li-dialog";
    const when = Net.imported ? new Date(Net.imported).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";
    dlg.innerHTML = `<form method="dialog" class="li-close"><button aria-label="Close">✕</button></form>
      <h2><span class="in big">in</span> Connect LinkedIn</h2>
      <p class="sector">See who you know at every firm, and which team they're in. Your connections stay in this browser. Nothing is uploaded. <a href="guide-linkedin.html">Full step-by-step guide</a></p>
      ${Net.has ? `<div class="notice" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><span>✓ Connected: <b>${Net.count}</b> connections${when ? `, added ${when}` : ""}${Net.source === "paste" ? " (pasted)" : ""}.</span>
        <span style="display:flex;gap:8px"><a class="btn small" href="network.html">See my network</a><button class="btn small ghost" id="liDisconnect" type="button">Disconnect</button></span></div>
        <p class="sector" style="margin:0 0 6px">To update, use either option below. It replaces what's saved now.</p>` : ""}
      <div class="tabs" role="tablist">
        <button type="button" class="chip" role="tab" data-tab="paste" aria-pressed="${tab !== "file"}">Paste: 30 seconds</button>
        <button type="button" class="chip" role="tab" data-tab="file" aria-pressed="${tab === "file"}">Upload LinkedIn's download: most accurate</button>
      </div>
      <div data-panel="paste" ${tab === "file" ? "hidden" : ""}>
        <ol class="li-steps">
          <li><a class="btn small" href="${LI_CONNECTIONS}" target="_blank" rel="noopener">Open my LinkedIn connections ↗</a> <span class="sector">(sign in if asked)</span></li>
          <li>Scroll to the bottom of that page until all your connections have loaded.</li>
          <li>Press <kbd>⌘ Cmd</kbd>+<kbd>A</kbd> then <kbd>⌘ Cmd</kbd>+<kbd>C</kbd> on a Mac, or <kbd>Ctrl</kbd>+<kbd>A</kbd> then <kbd>Ctrl</kbd>+<kbd>C</kbd> on Windows.</li>
          <li>Come back and paste it here:</li>
        </ol>
        <textarea id="liPaste" rows="6" placeholder="Paste your LinkedIn connections page here" aria-label="Pasted LinkedIn connections"></textarea>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px"><button class="btn" id="liPasteBtn" type="button">Connect</button><span class="err" id="liErr" role="alert"></span></div>
        <p class="sector" style="font-size:12px">Pasting gives each person's name and headline, so we match the firm from their headline. Headlines don't always name the employer, so for exact company and job title, use LinkedIn's download instead.</p>
      </div>
      <div data-panel="file" ${tab === "file" ? "" : "hidden"}>
        <ol class="li-steps">
          <li><a class="btn small" href="${LI_DOWNLOAD}" target="_blank" rel="noopener">Open LinkedIn's data download ↗</a></li>
          <li>Choose <b>Want something in particular?</b>, tick only <b>Connections</b>, then click <b>Request archive</b>.</li>
          <li>LinkedIn emails you a link, usually within about 10 minutes. Download the zip file.</li>
          <li>Drop the zip file here. There's no need to unzip it.</li>
        </ol>
        <label class="dropzone" id="liDrop" for="liFile"><div style="font-size:26px">📦</div><b>Drop LinkedIn's zip (or Connections.csv) here</b><br><span class="sector">or click to choose it</span>
          <input type="file" id="liFile" accept=".zip,.csv,application/zip,text/csv" style="position:absolute;left:-9999px"></label>
        <span class="err" id="liErr2" role="alert"></span>
      </div>`;
    document.body.appendChild(dlg);
    const done = n => { toast(`Connected ${n} LinkedIn connections. They stay on this device.`); setTimeout(() => location.reload(), 700); };
    dlg.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => {
      dlg.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-pressed", x === b));
      dlg.querySelectorAll("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== b.dataset.tab);
    });
    dlg.querySelector("#liPasteBtn").onclick = () => {
      try { done(Net.importPaste(dlg.querySelector("#liPaste").value)); }
      catch (e) { dlg.querySelector("#liErr").textContent = e.message; }
    };
    const handle = async f => {
      if (!f) return;
      try { done(await Net.importFile(f)); } catch (e) { dlg.querySelector("#liErr2").textContent = e.message; }
    };
    dlg.querySelector("#liFile").onchange = e => handle(e.target.files[0]);
    const dz = dlg.querySelector("#liDrop");
    dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); handle(e.dataTransfer.files[0]); };
    const dis = dlg.querySelector("#liDisconnect");
    if (dis) dis.onclick = () => { if (confirm("Remove your LinkedIn connections from this browser?")) { Net.clear(); location.reload(); } };
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  document.addEventListener("click", e => { const a = e.target.closest("[data-connect-li]"); if (a) { e.preventDefault(); openLinkedIn(); } });
  function qs() { return Object.fromEntries(new URLSearchParams(location.search)); }

  window.App = { Store, api, esc, interestChecks, readInterests, networkBlock, openLinkedIn, initials, mark, windowText, pill, toast, download, meter, teamTiles, detailBlock, bindDetailActions, qs,
    async boot(fn) {
      try { await Store.init(); }
      catch (e) { console.error(e); }
      renderChrome();
      if (fn) await fn();
    } };
})();
