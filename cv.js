/* CV Score page: upload → score → improve → edit → reanalyse → download. */
App.boot(async () => {
  const { Store } = App;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isStatic = document.documentElement.dataset.static === "1";

  const S = {
    file: null, originalDoc: null, doc: null, history: [], settings: { mode: "graduate", variant: "en-AU", engine: "rules" },
    decisions: {}, edited: {}, answers: {}, undo: [], redo: [], selected: null, jd: "", jdTitle: "", match: null,
    template: "classic", ai: false, aiModel: null, tab: "score", dirty: false, sugFilter: "all", sevFilter: "all", action: null
  };
  const cur = () => S.history[S.history.length - 1] || null;
  const base = () => S.history[0] || null;

  /* ---------- AI availability ---------- */
  const engineSel = $("cvEngine");
  $("cvMode").onchange = e => { S.settings.mode = e.target.value; };
  $("cvVariant").onchange = e => { S.settings.variant = e.target.value; };

  /* ---------- upload ---------- */
  const dz = $("drop"), input = $("cvFile");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files[0]) start(e.dataTransfer.files[0]); });
  dz.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.onchange = () => { if (input.files[0]) start(input.files[0]); input.value = ""; };
  $("pasteBtn").onclick = () => { const t = $("pasteText").value; if (t.trim()) start(null, t); };
  $("ctaAnalyse").onclick = e => { e.preventDefault(); $("upload").scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => dz.focus(), 400); };

  function progress(step, msg) {
    const steps = ["read", "extract", "analyse", "done"];
    $("progress").hidden = false;
    $("progress").querySelectorAll("li").forEach(li => {
      const i = steps.indexOf(li.dataset.step), k = steps.indexOf(step);
      li.className = i < k ? "done" : i === k ? "now" : "";
    });
    $("progressMsg").textContent = msg || "";
  }
  function uploadError(msg) { $("progress").hidden = true; $("uploadErr").hidden = false; $("uploadErr").textContent = msg; }

  async function start(file, pasted) {
    $("uploadErr").hidden = true;
    if (S.dirty && !confirm("Start again with a new CV? Your current edits will be lost.")) return;
    try {
      progress("read", file ? `Reading ${file.name}…` : "Reading pasted text…");
      let r;
      if (file) { progress("extract", file.name.toLowerCase().endsWith(".pdf") ? "Extracting text from the PDF…" : "Extracting text…"); r = await CVIO.readFile(file); }
      else r = { text: pasted.replace(/\r\n?/g, "\n").trim(), method: "paste", name: "Pasted text" };
      if (r.scanned) return uploadError("This PDF looks like a scanned image, so its text can't be read reliably. We don't run OCR (text recognition). Upload a text-based PDF exported from Word or Google Docs, or a .docx file — or paste your CV text below.");
      const q = CVE.checkText(r.text);
      if (!q.ok) return uploadError(q.message);
      S.file = { name: r.name, method: r.method, pages: r.pages, words: q.words };
      S.originalDoc = CVE.parse(r.text);
      S.doc = CVE.clone(S.originalDoc);
      S.history = []; S.decisions = {}; S.edited = {}; S.answers = {}; S.undo = []; S.redo = []; S.match = null; S.selected = null; S.dirty = false;
      progress("analyse", S.settings.engine === "ai" ? "AI is reading your CV (this can take 20–40 seconds)…" : "Scoring your CV…");
      await analyse("first");
      progress("done", "Done.");
      setTimeout(() => { $("progress").hidden = true; }, 600);
      $("landing").hidden = true;
      $("workspace").hidden = false;
      showTab("score");
      $("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { console.error(e); uploadError(e.message || "Something went wrong reading that file."); }
  }

  async function analyse(kind) {
    let a = null;
    if (!a) a = CVE.analyse(S.doc, S.settings);
    a.kind = kind;
    a.snapshot = CVE.toText(S.doc);
    S.history.push(a);
    renderAll();
  }

  /* ---------- tabs ---------- */
  const TABS = ["score", "improve", "editor", "match", "export"];
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $("cvTabs").addEventListener("keydown", e => {
    if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const i = TABS.indexOf(S.tab) + (e.key === "ArrowRight" ? 1 : -1);
    showTab(TABS[(i + TABS.length) % TABS.length]); $("cvTabs").querySelector(`[data-tab="${S.tab}"]`).focus();
  });
  function showTab(t) {
    S.tab = t;
    document.querySelectorAll("[data-tab]").forEach(b => { const on = b.dataset.tab === t; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
    TABS.forEach(x => { $("tab-" + x).hidden = x !== t; });
    render(t);
  }
  function renderAll() { renderBar(); render(S.tab); }
  function render(t) { ({ score: renderScore, improve: renderImprove, editor: renderEditor, match: renderMatch, export: renderExport })[t](); }

  /* ---------- sticky bar ---------- */
  function renderBar() {
    const a = cur(), b = base();
    const delta = a && b && a !== b ? a.total - b.total : null;
    $("barScore").innerHTML = a ? `<b class="mono" style="color:${a.band.color}">${a.total}</b><span>/100</span>${delta !== null ? ` <span class="delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}">${delta > 0 ? "+" : ""}${delta}</span>` : ""}` : "";
    $("barFile").textContent = S.file ? `${S.file.name} · ${a ? a.engineLabel : ""}` : "";
    $("undoBtn").disabled = !S.undo.length; $("redoBtn").disabled = !S.redo.length;
    const changed = a && CVE.toText(S.doc) !== a.snapshot;
    $("reBtn").classList.toggle("pulse", !!changed);
    $("reHint").textContent = changed ? "You've made changes since the last score." : "";
  }
  $("reBtn").onclick = async () => {
    const btn = $("reBtn"); btn.disabled = true; btn.textContent = "Reanalysing…";
    try { await analyse("re"); showTab("score"); App.toast && App.toast("Reanalysed with the same criteria."); }
    catch (e) { alert(e.message); }
    finally { btn.disabled = false; btn.textContent = "Reanalyse my CV"; }
  };

  /* ---------- undo / redo ---------- */
  function commit(fn, label) {
    S.undo.push(JSON.stringify(S.doc)); if (S.undo.length > 100) S.undo.shift();
    S.redo = []; fn(); S.dirty = true; if (label) S.lastLabel = label;
    renderBar();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.undo.pop()); renderAll(); }
  function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.redo.pop()); renderAll(); }
  $("undoBtn").onclick = undo; $("redoBtn").onclick = redo;
  document.addEventListener("keydown", e => {
    if (!S.doc || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
    if (/^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) return; // let fields undo their own typing
    e.preventDefault(); e.shiftKey ? redo() : undo();
  });
  window.addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  const itemOf = id => S.doc ? CVE.findItem(S.doc, id) : null;
  function setText(id, text) { const x = itemOf(id); if (x && x.item.text !== text) commit(() => { x.item.text = text; }); }

  /* ---------- shared bits ---------- */
  function ring(score, color, size = 148, label = "") {
    const r = size / 2 - 10, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || `Score ${score} out of 100`)}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="ring-num">${score}</text><text x="50%" y="${size / 2 + 24}" text-anchor="middle" class="ring-of">/100</text></svg>`;
  }
  function diffHtml(a, b) { return CVE.diff(a, b).map(p => p.t === "eq" ? esc(p.s) : p.t === "ins" ? `<ins>${esc(p.s)}</ins>` : `<del>${esc(p.s)}</del>`).join(""); }
  const sevBadge = s => `<span class="sev sev-${s.toLowerCase()}">${s} impact</span>`;
  const catName = k => (CVE.CATEGORIES.find(c => c.key === k) || {}).name || k;
  const bandOf = t => CVE.band(t);

  /* ---------- SCORE ---------- */
  function renderScore() {
    const a = cur(), b = base();
    if (!a) return;
    const el = $("tab-score");
    const compare = a !== b ? `
      <div class="card cmp">
        <h3>Score comparison</h3>
        <div class="cmp-row"><div><span class="sector">Original</span><b class="mono">${b.total}/100</b></div><div><span class="sector">Updated</span><b class="mono">${a.total}/100</b></div>
          <div><span class="sector">Change</span><b class="mono delta ${a.total > b.total ? "up" : a.total < b.total ? "down" : ""}">${a.total - b.total > 0 ? "+" : ""}${a.total - b.total} points</b></div></div>
        <table class="cmp-table"><thead><tr><th>Category</th><th>Original</th><th>Updated</th><th>Change</th></tr></thead><tbody>
        ${a.categories.map((c, i) => { const o = b.categories[i]; const d = c.score - o.score; return `<tr><td>${esc(c.name)}</td><td class="mono">${o.score}/${c.max}</td><td class="mono">${c.score}/${c.max}</td><td class="mono delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">${d > 0 ? "+" : ""}${d || "–"}</td></tr>`; }).join("")}</tbody></table>
        ${a.engine !== b.engine ? `<p class="notice">These two results came from different methods (${esc(b.engineLabel)} vs ${esc(a.engineLabel)}), so the change isn't a like-for-like comparison.</p>` : ""}
        <p class="sector">${S.history.length} analyses this session. Scores only change when a fresh analysis of your edited CV supports it — accepting suggestions doesn't raise the score by itself.</p>
      </div>` : "";
    const plan = a.plan.map(id => a.findings.find(f => f.id === id)).filter(Boolean);
    el.innerHTML = `
      <div class="score-top">
        <div class="card score-card">
          ${ring(a.total, a.band.color, 160, `CV score ${a.total} out of 100: ${a.band.label}`)}
          <div>
            <div class="band" style="color:${a.band.color}">${esc(a.band.label)}</div>
            <p>${esc(a.summary)}</p>
            <p class="engine-tag">${a.engine === "ai" ? `AI analysis${a.model ? ` · ${esc(a.model)}` : ""}` : "Rule-based check (no AI)"} · ${a.mode === "graduate" ? "Student / graduate mode" : "Experienced mode"} · ${esc(CVE.variantName(a.variant))}</p>
            <p class="disclaimer">This is an automated assessment to help you improve your CV. It isn't a recruiter's opinion or an applicant tracking system's rating, and it doesn't predict whether you'll get an interview.</p>
          </div>
        </div>
        <div class="card">
          <h3>Category scores</h3>
          <ul class="cats">${a.categories.map(c => `
            <li><details><summary><span class="cat-name">${esc(c.name)}</span><span class="mono">${c.score}/${c.max}</span>
              <span class="bar" aria-hidden="true"><i style="width:${(c.score / c.max * 100).toFixed(0)}%;background:${bandOf(c.score / c.max * 100).color}"></i></span></summary>
              <ul class="reasons">${c.reasons.map(r => `<li class="${r.sign > 0 ? "plus" : "minus"}"><span aria-hidden="true">${r.sign > 0 ? "✓" : "–"}</span> ${esc(r.text)}</li>`).join("")}</ul></details></li>`).join("")}
          </ul>
          <p class="sector">Categories add up to exactly 100. Click one to see why points were given or lost.</p>
        </div>
      </div>
      ${compare}
      <div class="grid2 score-mid">
        <div class="card"><h3>Your CV's strengths</h3>
          ${a.strengths.length ? `<ul class="strengths">${a.strengths.map(s => `<li><b>${esc(s.title)}</b><span>${esc(s.detail)}</span></li>`).join("")}</ul>` : `<p class="sector">We didn't find strengths we could back up with text from your CV yet. The improvements below will help build them.</p>`}
          ${a.strengths.length && a.strengths.length < 3 ? `<p class="sector">Only ${a.strengths.length} strength${a.strengths.length > 1 ? "s are" : " is"} clearly supported by your CV right now.</p>` : ""}
        </div>
        <div class="card"><h3>Your top 5 improvements</h3>
          ${plan.length ? `<ol class="plan">${plan.map(f => `<li><a href="#f-${f.id}" data-goto-finding="${f.id}">${esc(f.title)}</a> <span class="sector">${esc(catName(f.category))}</span></li>`).join("")}</ol>` : `<p class="sector">No major issues found.</p>`}
          <h4>Section scores</h4>
          <div class="secscores">${Object.entries(a.sectionScores).map(([k, v]) => `<div><span class="sector">${k[0].toUpperCase() + k.slice(1)}</span><b class="mono">${v}/10</b><span class="bar"><i style="width:${v * 10}%;background:${bandOf(v * 10).color}"></i></span></div>`).join("")}</div>
        </div>
      </div>
      <div class="card">
        <div class="sec-head"><div><h3>Areas to improve</h3><p class="sector">${a.findings.length} found · <b>Objective</b> = an error or a missing item. <b>Suggestion</b> = a judgement about style.</p></div>
          <div class="chips" role="group" aria-label="Filter by impact">${["all", "High", "Medium", "Low"].map(s => `<button class="chip" data-sev="${s}" aria-pressed="${S.sevFilter === s}">${s === "all" ? "All" : s}</button>`).join("")}</div></div>
        <div class="findings">${a.findings.filter(f => S.sevFilter === "all" || f.severity === S.sevFilter).map(findingCard).join("") || `<p class="sector">Nothing at this level.</p>`}</div>
      </div>
      ${a.grammar && a.grammar.length ? `<div class="card"><h3>Grammar and spelling check</h3><ul class="gram">${a.grammar.slice(0, 20).map(g => `<li><q>${esc(g.text.slice(0, 120))}</q> — ${esc(g.issues.join(", "))} <button class="linkbtn" data-edit="${g.itemId}">Fix in editor</button></li>`).join("")}${(a.spelling || []).slice(0, 10).map(s => `<li>"${esc(s.word)}" → "${esc(s.fix)}" (${esc(CVE.variantName(a.variant))})</li>`).join("")}</ul></div>` : ""}`;
    el.querySelectorAll("[data-sev]").forEach(b => b.onclick = () => { S.sevFilter = b.dataset.sev; renderScore(); });
    bindFindingActions(el);
  }
  function findingCard(f) {
    const it = f.itemId ? itemOf(f.itemId) : null;
    const stillThere = !f.itemId || (it && it.item.text === f.original);
    const missingSection = f.location === "Missing section";
    return `<article class="finding" id="f-${f.id}">
      <header>${sevBadge(f.severity)} <span class="kind">${f.kind === "objective" ? "Objective" : "Suggestion"}</span> <span class="sector">${esc(catName(f.category))}</span></header>
      <h4>${esc(f.title)}</h4>
      <dl>
        <dt>Location</dt><dd>${esc(f.location)}${f.itemId && !stillThere ? ' <span class="fy">edited since</span>' : ""}</dd>
        ${f.original ? `<dt>Your CV</dt><dd><q>${esc(f.original)}</q></dd>` : ""}
        <dt>Why it matters</dt><dd>${esc(f.why)}</dd>
        <dt>What to do</dt><dd>${esc(f.recommendation)}</dd>
        ${f.example ? `<dt>Example</dt><dd class="diff">${f.original ? diffHtml(f.original, f.example) : esc(f.example)}</dd>` : ""}
      </dl>
      ${f.needsFacts && f.question ? `<div class="ask"><label for="ans-${f.id}"><b>We need your input:</b> ${esc(f.question)}</label>
        ${f.itemId && f.metric ? `<div class="ask-row"><input id="ans-${f.id}" data-answer="${f.id}" placeholder="Only add what's true, e.g. about 60 per shift" value="${esc(S.answers[f.id] || "")}"><button class="btn small" data-apply-answer="${f.id}">Add to this line</button></div>` : `<p class="sector">${f.itemId ? "Answer it by editing this line in the Editor." : `Add this in the Editor tab${missingSection ? " using “Add section”" : ""}.`}</p>`}</div>` : ""}
      <div class="factions">
        ${f.example && f.itemId && stillThere ? `<button class="btn small" data-accept-example="${f.id}">Use example wording</button>` : ""}
        ${f.example && !f.itemId && f.kind2 === "summary" ? `<button class="btn small" data-add-summary="${f.id}">Add this profile</button>` : ""}
        ${f.itemId ? `<button class="btn small ghost" data-edit="${f.itemId}">Edit this line</button>` : ""}
        ${missingSection && !f.kind2 ? `<button class="btn small ghost" data-add-section="${esc(f.title.replace(/^No | section found$/g, "").replace(/^contact details found$/, "Contact"))}">Add section</button>` : ""}
      </div>
    </article>`;
  }
  function bindFindingActions(root) {
    const a = cur();
    const fOf = id => a.findings.find(f => f.id === id);
    root.querySelectorAll("[data-goto-finding]").forEach(x => x.onclick = e => { e.preventDefault(); S.sevFilter = "all"; renderScore(); const t = $("f-" + x.dataset.gotoFinding); if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); } });
    root.querySelectorAll("[data-edit]").forEach(x => x.onclick = () => { S.selected = x.dataset.edit; showTab("editor"); });
    root.querySelectorAll("[data-answer]").forEach(x => x.oninput = () => { S.answers[x.dataset.answer] = x.value; });
    root.querySelectorAll("[data-apply-answer]").forEach(x => x.onclick = () => {
      const f = fOf(x.dataset.applyAnswer), ans = (S.answers[f.id] || "").trim();
      if (!ans) return root.querySelector(`[data-answer="${f.id}"]`).focus();
      const it = itemOf(f.itemId); if (!it) return;
      const next = CVE.withMetric(it.item.text, ans);
      if (confirm(`Change this line to:\n\n${next}\n\nYou can edit it further in the Editor.`)) { setText(f.itemId, next); toast("Added. Reanalyse to update your score."); renderScore(); }
    });
    root.querySelectorAll("[data-accept-example]").forEach(x => x.onclick = () => { const f = fOf(x.dataset.acceptExample); setText(f.itemId, f.example); toast("Wording updated. Reanalyse to see the effect on your score."); renderScore(); });
    root.querySelectorAll("[data-add-summary]").forEach(x => x.onclick = () => { addProfile(fOf(x.dataset.addSummary).example); renderScore(); });
    root.querySelectorAll("[data-add-section]").forEach(x => x.onclick = () => { addSection(x.dataset.addSection); showTab("editor"); });
  }
  function toast(m) { if (App.toast) App.toast(m); }

  /* ---------- IMPROVE (before / after) ---------- */
  function renderImprove() {
    const a = cur(); if (!a) return;
    const el = $("tab-improve");
    const list = a.suggestions.filter(s => S.sugFilter === "all" || (S.sugFilter === "facts" ? s.needsFacts : !s.needsFacts));
    const wordingOpen = a.suggestions.filter(s => !s.needsFacts && !S.decisions[s.id] && stillValid(s));
    const draft = CVE.summaryDraft(S.doc, { target: S.jdTitle ? `a ${S.jdTitle} role` : "" });
    const hasSummary = S.doc.sections.some(s => s.type === "summary" && s.items.length);
    el.innerHTML = `
      <div class="sec-head"><div><h2>Before and after</h2><p class="sector">Suggested changes to your own wording. Accept, reject or edit each one. Rewrites never add new facts or figures — where a number would help, we ask you for it.</p></div>
        <div class="chips" role="group" aria-label="Show">${[["all", "All"], ["wording", "Wording"], ["facts", "Needs your input"]].map(([k, l]) => `<button class="chip" data-sf="${k}" aria-pressed="${S.sugFilter === k}">${l}</button>`).join("")}
        ${wordingOpen.length > 1 ? `<button class="btn small" id="acceptAll">Accept all ${wordingOpen.length} wording fixes</button>` : ""}</div></div>
      <div class="card profile-card"><h3>Profile writer</h3>
        <p class="sector">A 2–3 line profile built only from facts already in your CV${S.ai && S.settings.engine === "ai" ? " (or ask the AI to write one)" : ""}. ${hasSummary ? "You already have a profile — this would replace it." : ""}</p>
        ${draft ? `<textarea id="profileDraft" rows="3">${esc(draft)}</textarea><div class="factions"><button class="btn small" id="useProfile">${hasSummary ? "Replace my profile" : "Add to my CV"}</button>${S.ai && S.settings.engine === "ai" ? `<button class="btn small ghost" id="aiProfile">Write with AI</button>` : ""}</div>`
          : `<p>Not enough detail yet — add your degree, university and skills first.</p>`}
      </div>
      <div class="sugs">${list.map(sugCard).join("") || `<p class="card">No suggestions${S.sugFilter !== "all" ? " of this type" : ""}. Use the Editor for line-by-line rewrites.</p>`}</div>`;
    el.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => { S.sugFilter = b.dataset.sf; renderImprove(); });
    const all = $("acceptAll"); if (all) all.onclick = () => {
      if (!confirm(`Apply ${wordingOpen.length} wording changes? You can undo this in one step.`)) return;
      commit(() => { for (const s of wordingOpen) { const x = CVE.findItem(S.doc, s.itemId); if (x) { x.item.text = S.edited[s.id] ?? s.revised; S.decisions[s.id] = "accepted"; } } });
      renderImprove(); toast("Changes applied. Reanalyse to update your score.");
    };
    const up = $("useProfile"); if (up) up.onclick = () => { addProfile($("profileDraft").value.trim()); renderImprove(); };
    el.querySelectorAll("[data-sug]").forEach(card => {
      const id = card.dataset.sug, s = a.suggestions.find(x => x.id === id);
      const ta = card.querySelector("textarea"), dv = card.querySelector(".diff");
      if (ta) ta.oninput = () => {
        if (s.needsFacts) { S.answers[id] = ta.value; dv.innerHTML = ta.value.trim() ? diffHtml(s.original, CVE.withMetric(s.original, ta.value)) : "<span class='sector'>Your answer will appear here.</span>"; }
        else { S.edited[id] = ta.value; dv.innerHTML = diffHtml(s.original, ta.value); }
      };
      const acc = card.querySelector("[data-accept]"), rej = card.querySelector("[data-reject]"), und = card.querySelector("[data-undo-dec]");
      if (acc) acc.onclick = () => {
        const val = s.needsFacts ? CVE.withMetric(s.original, (S.answers[id] || "").trim()) : (S.edited[id] ?? s.revised);
        if (s.needsFacts && !(S.answers[id] || "").trim()) { ta.focus(); return; }
        const x = itemOf(s.itemId); if (!x) return;
        commit(() => { x.item.text = val; S.decisions[id] = "accepted"; }); renderImprove();
      };
      if (rej) rej.onclick = () => { S.decisions[id] = "rejected"; renderImprove(); };
      if (und) und.onclick = () => {
        if (S.decisions[id] === "accepted") { const x = itemOf(s.itemId); if (x) commit(() => { x.item.text = s.original; }); }
        delete S.decisions[id]; renderImprove();
      };
    });
  }
  function stillValid(s) { const x = itemOf(s.itemId); return x && (x.item.text === s.original || S.decisions[s.id] === "accepted"); }
  function sugCard(s) {
    const dec = S.decisions[s.id], valid = stillValid(s);
    const after = s.needsFacts ? (S.answers[s.id] ? CVE.withMetric(s.original, S.answers[s.id]) : "") : (S.edited[s.id] ?? s.revised);
    return `<article class="sug ${dec || ""}" data-sug="${s.id}">
      <header><span class="sector">${esc(s.section)}</span>${s.needsFacts ? ' <span class="kind facts">Needs your input</span>' : ' <span class="kind">Same facts, better wording</span>'}${dec ? ` <span class="fy">${dec}</span>` : ""}</header>
      <div class="ba">
        <div><span class="lbl">Before</span><p>${esc(s.original)}</p></div>
        <div><span class="lbl">After</span>${dec === "accepted" ? `<p>${esc(itemOf(s.itemId) ? itemOf(s.itemId).item.text : after)}</p>` : s.needsFacts
          ? `<label class="q" for="ta-${s.id}">${esc(s.question)}</label><textarea id="ta-${s.id}" rows="2" placeholder="Only add what's true, e.g. about 60 per shift">${esc(S.answers[s.id] || "")}</textarea>`
          : `<label class="sr" for="ta-${s.id}">Suggested wording (editable)</label><textarea id="ta-${s.id}" rows="2">${esc(after)}</textarea>`}</div>
      </div>
      ${dec === "accepted" ? "" : `<div class="diff" aria-label="Changes">${after ? diffHtml(s.original, after) : "<span class='sector'>Your answer will appear here.</span>"}</div>`}
      <p class="why">${esc(s.why)}</p>
      <div class="factions">${!valid && !dec ? `<span class="sector">This line has been edited since — <button class="linkbtn" data-edit="${s.itemId}">open in editor</button></span>` : dec
        ? `<button class="btn small ghost" data-undo-dec>${dec === "accepted" ? "Undo accept" : "Reconsider"}</button>`
        : `<button class="btn small" data-accept>Accept</button><button class="btn small ghost" data-reject>Reject</button>`}</div>
    </article>`;
  }
  function addProfile(text) {
    if (!text) return;
    commit(() => {
      let sec = S.doc.sections.find(s => s.type === "summary");
      if (!sec) { sec = { id: "s" + Date.now().toString(36), title: "Profile", type: "summary", items: [] }; S.doc.sections.unshift(sec); }
      sec.items = [{ id: "i" + Date.now().toString(36), text, bullet: false, kind: "line" }];
    });
    toast("Profile added. Check it reads true to you, then reanalyse.");
  }
  function addSection(name) {
    const map = { Education: "education", Skills: "skills", Experience: "experience", "Experience, projects or involvement": "experience", "Work experience": "experience", Contact: "header" };
    const type = map[name] || "other";
    commit(() => {
      if (type === "header") { S.doc.header.push({ id: "i" + Date.now().toString(36), text: "Mobile · email · linkedin.com/in/yourname · Perth WA", bullet: false, kind: "line" }); return; }
      S.doc.sections.push({ id: "s" + Date.now().toString(36), title: name === "Experience, projects or involvement" ? "Experience" : name, type, items: [{ id: "i" + Date.now().toString(36), text: "", bullet: type === "experience", kind: type === "experience" ? "bullet" : "line" }] });
    });
  }

  /* ---------- EDITOR ---------- */
  const EDIT_ACTIONS = [["improve", "Improve wording"], ["concise", "Make more concise"], ["professional", "Make more professional"], ["verbs", "Strengthen action verbs"], ["grammar", "Correct grammar"], ["readability", "Improve readability"], ["tailor", "Tailor to job ad"]];
  function renderEditor() {
    if (!S.doc) return;
    const el = $("tab-editor");
    const line = (it, sec) => `<div class="eline ${S.selected === it.id ? "sel" : ""} ${it.bullet ? "is-bullet" : ""} k-${it.kind || "line"}" data-line="${it.id}">
        <button class="bul" data-tog="${it.id}" title="${it.bullet ? "Remove bullet" : "Make bullet point"}" aria-label="${it.bullet ? "Remove bullet" : "Make bullet point"}">${it.bullet ? "•" : "¶"}</button>
        <textarea rows="1" data-text="${it.id}" aria-label="${esc(sec ? sec.title : "Header")} line">${esc(it.text)}</textarea>
        <span class="eline-tools"><button data-add-after="${it.id}" title="Add line below" aria-label="Add line below">+</button><button data-del="${it.id}" title="Delete line" aria-label="Delete line">×</button></span>
      </div>`;
    el.innerHTML = `
      <div class="editor">
        <div class="ed-left card">
          <div class="ed-head"><h3>Your CV</h3><button class="btn small ghost" id="rawToggle">${S.raw ? "Back to sections" : "Edit as plain text"}</button></div>
          ${S.raw ? `<p class="sector">Edit the whole CV as text. Put each heading on its own line and start bullet points with •.</p><textarea id="rawText" class="raw" rows="28">${esc(CVE.toText(S.doc))}</textarea><div class="factions"><button class="btn small" id="rawApply">Apply text</button></div>`
          : `<div class="ed-sec"><div class="ed-sec-title"><b>Header &amp; contact</b></div>${S.doc.header.map(h => line(h, null)).join("")}</div>
            ${S.doc.sections.map((s, i) => `<div class="ed-sec" data-sec="${s.id}"><div class="ed-sec-title"><input value="${esc(s.title)}" data-title="${s.id}" aria-label="Section heading"><span class="sector">${esc(s.type === "other" ? "custom" : s.type)}</span>
              <span class="eline-tools"><button data-up="${s.id}" ${i === 0 ? "disabled" : ""} aria-label="Move section up" title="Move up">↑</button><button data-down="${s.id}" ${i === S.doc.sections.length - 1 ? "disabled" : ""} aria-label="Move section down" title="Move down">↓</button><button data-add-line="${s.id}" aria-label="Add line" title="Add line">+</button><button data-del-sec="${s.id}" aria-label="Delete section" title="Delete section">×</button></span></div>
              ${s.items.map(it => line(it, s)).join("")}</div>`).join("")}
            <div class="factions"><select id="newSecType" aria-label="New section type">${["Profile:summary", "Education:education", "Experience:experience", "Projects:projects", "Leadership & Volunteering:leadership", "Skills:skills", "Certifications:certifications", "Awards:achievements", "Interests:interests"].map(x => `<option value="${x}">${x.split(":")[0]}</option>`).join("")}</select><button class="btn small ghost" id="addSec">Add section</button></div>`}
        </div>
        <aside class="ed-right card" aria-live="polite">${sidePanel()}</aside>
      </div>`;
    el.querySelectorAll("textarea[data-text]").forEach(ta => {
      autosize(ta);
      ta.oninput = () => { autosize(ta); livePreview(ta.dataset.text, ta.value); };
      ta.onfocus = () => { if (S.selected !== ta.dataset.text) { S.selected = ta.dataset.text; S.action = null; el.querySelectorAll(".eline").forEach(l => l.classList.toggle("sel", l.dataset.line === S.selected)); el.querySelector(".ed-right").innerHTML = sidePanel(); bindSide(); } };
      ta.onchange = () => { setText(ta.dataset.text, ta.value.replace(/\n+/g, " ").trim()); };
      ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); addAfter(ta.dataset.text); } };
    });
    el.querySelectorAll("[data-title]").forEach(i => i.onchange = () => { const s = S.doc.sections.find(x => x.id === i.dataset.title); commit(() => { s.title = i.value.trim() || s.title; }); });
    el.querySelectorAll("[data-tog]").forEach(b => b.onclick = () => { const x = itemOf(b.dataset.tog); commit(() => { x.item.bullet = !x.item.bullet; if (x.section && ["experience", "projects", "leadership"].includes(x.section.type)) x.item.kind = x.item.bullet ? "bullet" : "entry"; }); renderEditor(); });
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { const id = b.dataset.del; commit(() => { S.doc.header = S.doc.header.filter(i => i.id !== id); S.doc.sections.forEach(s => { s.items = s.items.filter(i => i.id !== id); }); }); if (S.selected === id) S.selected = null; renderEditor(); });
    el.querySelectorAll("[data-add-after]").forEach(b => b.onclick = () => addAfter(b.dataset.addAfter));
    el.querySelectorAll("[data-add-line]").forEach(b => b.onclick = () => { const s = S.doc.sections.find(x => x.id === b.dataset.addLine); const last = s.items[s.items.length - 1]; const nid = newId(); commit(() => { s.items.push({ id: nid, text: "", bullet: last ? last.bullet : false, kind: last && last.bullet ? "bullet" : "line" }); }); S.selected = nid; renderEditor(); focusLine(nid); });
    el.querySelectorAll("[data-del-sec]").forEach(b => b.onclick = () => { const s = S.doc.sections.find(x => x.id === b.dataset.delSec); if (confirm(`Delete the “${s.title}” section and its ${s.items.length} lines?`)) { commit(() => { S.doc.sections = S.doc.sections.filter(x => x !== s); }); renderEditor(); } });
    el.querySelectorAll("[data-up],[data-down]").forEach(b => b.onclick = () => { const id = b.dataset.up || b.dataset.down, i = S.doc.sections.findIndex(x => x.id === id), j = i + (b.dataset.up ? -1 : 1); commit(() => { const t = S.doc.sections[i]; S.doc.sections[i] = S.doc.sections[j]; S.doc.sections[j] = t; }); renderEditor(); });
    const as = $("addSec"); if (as) as.onclick = () => { const [title, type] = $("newSecType").value.split(":"); const nid = newId(); commit(() => { S.doc.sections.push({ id: newId("s"), title, type, items: [{ id: nid, text: "", bullet: ["experience", "projects", "leadership"].includes(type), kind: ["experience", "projects", "leadership"].includes(type) ? "bullet" : "line" }] }); }); S.selected = nid; renderEditor(); focusLine(nid); };
    $("rawToggle").onclick = () => { S.raw = !S.raw; renderEditor(); };
    const ra = $("rawApply"); if (ra) ra.onclick = () => { const t = $("rawText").value; const q = CVE.checkText(t); if (!q.ok && !confirm(q.message + "\n\nApply anyway?")) return; commit(() => { S.doc = CVE.parse(t); }); S.raw = false; S.selected = null; renderEditor(); toast("Sections re-read from your text."); };
    bindSide();
  }
  function newId(p = "i") { return p + Math.random().toString(36).slice(2, 9); }
  function addAfter(id) {
    const nid = newId();
    commit(() => {
      const lists = [S.doc.header, ...S.doc.sections.map(s => s.items)];
      for (const l of lists) { const i = l.findIndex(x => x.id === id); if (i >= 0) { const src = l[i]; l.splice(i + 1, 0, { id: nid, text: "", bullet: src.bullet, kind: src.bullet ? "bullet" : src.kind === "entry" ? "bullet" : src.kind, current: src.current }); break; } }
    });
    S.selected = nid; renderEditor(); focusLine(nid);
  }
  function focusLine(id) { const t = document.querySelector(`textarea[data-text="${id}"]`); if (t) t.focus(); }
  function autosize(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  function livePreview(id, value) { const p = document.querySelector(".ed-right .cvdoc"); if (!p) return; const x = itemOf(id); if (!x) return; const old = x.item.text; x.item.text = value; p.outerHTML = CVIO.previewHtml(S.doc, S.template, esc); x.item.text = old; }
  function sidePanel() {
    const x = S.selected ? itemOf(S.selected) : null;
    if (!x) return `<h3>Live preview</h3><p class="sector">Click any line to get suggestions for it. Changes appear here as you type.</p><div class="preview-wrap small">${CVIO.previewHtml(S.doc, S.template, esc)}</div>`;
    const a = cur();
    const rel = a ? a.findings.filter(f => f.itemId === x.item.id) : [];
    const gram = a && a.grammar ? a.grammar.filter(g => g.itemId === x.item.id) : [];
    const act = S.action && S.action.id === x.item.id ? S.action : null;
    const aiOn = S.ai && S.settings.engine === "ai";
    return `<div class="side-head"><h3>Selected line</h3><button class="linkbtn" id="deselect">Show preview</button></div>
      <p class="selq">${esc(x.item.text) || "<span class='sector'>(empty)</span>"}</p>
      <p class="sector">${esc(x.section ? x.section.title : "Header")}${x.item.current ? " · current role (present tense)" : ""}</p>
      <div class="actions">${EDIT_ACTIONS.map(([k, l]) => `<button class="chip" data-act="${k}" ${k === "tailor" && !S.jd ? "disabled title='Paste a job ad in the Job match tab first'" : ""}>${l}</button>`).join("")}</div>
      <p class="sector">${aiOn ? `Rewrites by ${esc(S.aiModel)}. Any figure not already in the line is removed automatically.` : "Rule-based rewrites: verbs, filler words, grammar and spelling. They never add facts."}</p>
      ${act ? `<div class="result">${act.loading ? `<p>Working…</p>` : act.error ? `<p class="err">${esc(act.error)}</p>` : `
        ${act.unchanged ? `<p>No change needed for this — ${act.note ? esc(act.note) : "it already reads well by this measure."}</p>` : `<label class="lbl" for="actOut">Suggestion (you can edit it)</label><textarea id="actOut" rows="3">${esc(act.text)}</textarea><div class="diff" id="actDiff">${diffHtml(x.item.text, act.text)}</div>${act.note ? `<p class="why">${esc(act.note)}</p>` : ""}`}
        ${act.question ? `<p class="ask"><b>To strengthen it:</b> ${esc(act.question)}</p>` : ""}
        ${act.unchanged ? "" : `<div class="factions"><button class="btn small" id="actAccept">Accept</button><button class="btn small ghost" id="actReject">Reject</button></div>`}`}</div>` : ""}
      ${rel.length ? `<h4>Feedback on this line</h4>${rel.map(f => `<div class="mini-f">${sevBadge(f.severity)} <b>${esc(f.title)}</b><p>${esc(f.recommendation)}</p>${f.needsFacts && f.question ? `<p class="ask">${esc(f.question)}</p>` : ""}</div>`).join("")}` : ""}
      ${gram.length ? `<h4>Grammar</h4><p>${esc(gram[0].issues.join(", "))}</p>` : ""}
      ${x.section && ["experience", "projects", "leadership"].includes(x.section.type) && x.item.bullet && !/\d/.test(x.item.text) ? `<h4>Add a figure</h4><p class="sector">${esc(CVE.metricQuestion(x.item.text))}</p><div class="ask-row"><input id="metricIn" placeholder="Only if true, e.g. about 60 per shift"><button class="btn small ghost" id="metricAdd">Add</button></div>` : ""}`;
  }
  function bindSide() {
    const el = document.querySelector(".ed-right"); if (!el) return;
    const d = $("deselect"); if (d) d.onclick = () => { S.selected = null; S.action = null; renderEditor(); };
    el.querySelectorAll("[data-act]").forEach(b => b.onclick = () => runAction(b.dataset.act));
    const out = $("actOut"); if (out) out.oninput = () => { $("actDiff").innerHTML = diffHtml(itemOf(S.selected).item.text, out.value); };
    const acc = $("actAccept"); if (acc) acc.onclick = () => { setText(S.selected, $("actOut").value.trim()); S.action = null; renderEditor(); };
    const rej = $("actReject"); if (rej) rej.onclick = () => { S.action = null; el.innerHTML = sidePanel(); bindSide(); };
    const ma = $("metricAdd"); if (ma) ma.onclick = () => { const v = $("metricIn").value.trim(); if (!v) return $("metricIn").focus(); setText(S.selected, CVE.withMetric(itemOf(S.selected).item.text, v)); renderEditor(); };
  }
  async function runAction(kind) {
    const x = itemOf(S.selected); if (!x || !x.item.text.trim()) return;
    const id = x.item.id, text = x.item.text;
    const show = () => { const el = document.querySelector(".ed-right"); if (el && S.selected === id) { el.innerHTML = sidePanel(); bindSide(); } };
    if (kind === "tailor") {
      const k = CVE.jobKeywords(S.jd); const low = text.toLowerCase();
      const used = [...k.skills, ...k.terms].filter(t => low.includes(t));
      S.action = { id, text, unchanged: true, note: used.length ? `This line already uses the ad's terms: ${used.join(", ")}. Rule-based mode can't reword it to the ad — keep the facts and, where true, use the ad's words for the same thing.` : "This line doesn't use any of the ad's main terms. If the work relates to the ad, describe it using the ad's words — only where it's accurate." };
      return show();
    }
    const r = CVE.rewrite(text, kind, { variant: S.settings.variant, current: !!x.item.current });
    S.action = { id, text: r.text, unchanged: !r.changed, note: r.changed ? "Same facts — only the wording changed." : "", question: x.section && ["experience", "projects", "leadership"].includes(x.section.type) && !/\d/.test(text) ? CVE.metricQuestion(text) : "" };
    show();
  }

  /* ---------- JOB MATCH ---------- */
  function renderMatch() {
    const el = $("tab-match");
    const m = S.match;
    const progs = (Store.programs || []).slice().sort((a, b) => a.firm.localeCompare(b.firm));
    el.innerHTML = `
      <div class="grid2 match-in">
        <div class="card">
          <h3>Paste a job ad</h3>
          <p class="sector">Optional. Compares your CV with one role. This gives a separate Job Match score; it doesn't change your CV score.</p>
          <label class="lbl" for="jdTitle">Role title</label><input id="jdTitle" value="${esc(S.jdTitle)}" placeholder="e.g. Audit Vacation Program">
          <label class="lbl" for="jdText">Job ad or description</label><textarea id="jdText" rows="10" placeholder="Paste the full ad, including requirements">${esc(S.jd)}</textarea>
          <div class="factions"><button class="btn" id="matchBtn">Compare with my CV</button></div>
          <p class="err" id="matchErr" hidden></p>
        </div>
        <div class="card">
          <h3>Or start from a PerthTrack program</h3>
          <p class="sector">Fills in a general profile of that team from our guides. It's not the firm's actual ad, so paste the real one when it's published.</p>
          <label class="lbl" for="progSel">Program</label>
          <select id="progSel"><option value="">Choose a program…</option>${progs.map(p => `<option value="${esc(p.id)}">${esc(p.firm)} — ${esc(p.program)}</option>`).join("")}</select>
          <label class="lbl" for="teamSel">Team</label><select id="teamSel" disabled><option>Choose a program first</option></select>
          <div class="factions"><button class="btn small ghost" id="useProg" disabled>Use this team</button></div>
        </div>
      </div>
      ${m ? matchResults(m) : ""}`;
    $("jdText").oninput = e => { S.jd = e.target.value; };
    $("jdTitle").oninput = e => { S.jdTitle = e.target.value; };
    $("progSel").onchange = () => {
      const p = Store.byId && Store.byId[$("progSel").value];
      const ts = $("teamSel");
      if (!p) { ts.disabled = true; $("useProg").disabled = true; return; }
      const teams = (p.teamsList && p.teamsList.length ? p.teamsList : [p.program]);
      ts.innerHTML = teams.map(t => `<option>${esc(t)}</option>`).join(""); ts.disabled = false; $("useProg").disabled = false;
    };
    $("useProg").onclick = () => {
      const p = Store.byId[$("progSel").value], team = $("teamSel").value;
      const cat = PT.categoryOf(team, p.fields);
      const ov = (window.TEAM_OVERRIDES || []).find(([re]) => re.test(team));
      const info = (ov && ov[1]) || (window.TEAM_INFO || {})[cat] || null;
      S.jdTitle = `${p.firm} ${team}`.replace(/\(.*?\)/g, "").trim();
      S.jd = `${p.firm} — ${p.program}\nTeam: ${team}\nSector: ${p.sector || ""}\n${info ? `What the team does: ${info.does}\nTypical student tasks:\n${info.tasks.map(t => "• " + t).join("\n")}` : ""}\n${p.finalYear ? "Eligibility: " + p.finalYear : ""}\n(General team profile from PerthTrack, not the firm's actual ad.)`;
      renderMatch();
    };
    $("matchBtn").onclick = async () => {
      const err = $("matchErr"); err.hidden = true;
      if (S.jd.trim().length < 80) { err.hidden = false; err.textContent = "Paste the full job ad (at least a few lines)."; return; }
      const btn = $("matchBtn"); btn.disabled = true; btn.textContent = "Comparing…";
      try {
        S.match = null;
        if (!S.match) S.match = CVE.jobMatch(S.doc, S.jd);
        S.match.snapshot = CVE.toText(S.doc); S.targetPlan = null;
        renderMatch();
        document.querySelector(".match-out") && document.querySelector(".match-out").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) { err.hidden = false; err.textContent = e.message; }
      finally { btn.disabled = false; btn.textContent = "Compare with my CV"; }
    };
    if (m) bindMatch();
  }
  function matchResults(m) {
    const b = bandOf(m.score);
    const ev = r => r && r.text ? `<q>${esc(r.text.slice(0, 140))}</q>` : "";
    const stale = m.snapshot !== CVE.toText(S.doc);
    return `<div class="card match-out">
      <div class="score-card">
        ${ring(m.score, b.color, 130, `Job match ${m.score} out of 100`)}
        <div><div class="band">Job match: ${m.score}/100</div><p>${esc(m.summary || "")}</p><p class="disclaimer">${esc(m.note)} ${m.engine === "ai" ? "AI comparison." : "Rule-based comparison (no AI)."} Never add skills or experience you don't have to raise this number.</p>${stale ? `<p class="notice">Your CV has changed since this comparison. Run it again to update.</p>` : ""}</div>
      </div>
      ${m.requirements.length ? `<h3>Requirements</h3><table class="req"><thead><tr><th>The ad asks for</th><th>Your CV</th><th>Evidence</th></tr></thead><tbody>${m.requirements.map(r => `<tr><td>${esc(r.requirement)}</td><td><span class="rs rs-${r.status}">${r.status === "evidenced" ? "Shown" : r.status === "partial" ? "Partly shown" : "Not clearly shown"}</span></td><td>${r.evidence ? ev(r.evidence) : r.matched && r.matched.length ? `<span class="sector">Matching words: ${esc(r.matched.join(", "))}</span>` : ""}${r.advice ? `<p class="sector">${esc(r.advice)}</p>` : ""}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="grid2">
        <div><h3>Keywords from the ad</h3><div class="kw">${[...(m.skills || []), ...(m.keywords || [])].map(k => `<span class="kwc ${k.found ? "yes" : "no"}">${k.found ? "✓" : "✗"} ${esc(k.term)}</span>`).join("") || "<p class='sector'>No clear keywords found.</p>"}</div>
          <p class="sector">✗ means the exact term isn't in your CV. Only add it where it's true — keywords alone don't guarantee getting past an ATS.</p></div>
        <div><h3>Transferable skills</h3>${(m.transferable || []).length ? `<ul class="trans">${m.transferable.map(t => `<li><b>${esc(t.term)}</b> — ${t.found ? `shown in ${ev(t.found)}` : `<span class="sector">not clearly shown</span>`}${t.note ? `<br><span class="sector">${esc(t.note)}</span>` : ""}</li>`).join("")}</ul>` : "<p class='sector'>The ad doesn't list soft skills we can check.</p>"}</div>
      </div>
      ${(m.tips || []).length ? `<h3>How to present your existing experience</h3><ul class="tips">${m.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      ${(m.rewrites || []).length ? `<h3>Tailored wording</h3>${m.rewrites.map((w, i) => `<div class="sug"><div class="diff">${diffHtml(w.original, w.revised)}</div><p class="why">${esc(w.why)}</p><div class="factions"><button class="btn small" data-mrw="${i}">Accept</button></div></div>`).join("")}` : ""}
      <div class="card inner" id="targetCard">${targetCard()}</div>
    </div>`;
  }
  function bindMatch() {
    document.querySelectorAll("[data-mrw]").forEach(b => b.onclick = () => { const w = S.match.rewrites[+b.dataset.mrw]; const x = itemOf(w.itemId); if (!x) return; commit(() => { x.item.text = w.revised; }); b.disabled = true; b.textContent = "Accepted"; });
    bindTarget();
  }
  /* Targeted version: preview each proposed change, tick the ones to keep, then apply (one undo step). */
  function targetCard() {
    const plan = S.targetPlan;
    if (!plan) return `<h3>Targeted version</h3>
      <p>Tailors your CV to this ad using only what's already in it: adds skills your experience already shows, moves your most relevant bullet points to the top of each role, and names the role in your profile. You'll see every change before it's applied, and you can undo it.</p>
      <label class="lbl" for="tgtRole">Role you're applying for</label><input id="tgtRole" class="tgt-role" value="${esc(S.jdTitle || "")}" placeholder="e.g. Corporate Finance Analyst">
      <div class="factions"><button class="btn small" id="targetBtn">Preview targeted version</button></div>`;
    const missing = (S.match && S.match.requirements || []).filter(r => r.status === "missing");
    if (!plan.changes.length) return `<h3>Targeted version</h3>
      <p class="notice">Your CV is already arranged for this ad: your skills lead with its terms, your most relevant bullet points come first, and your profile names the role.</p>
      ${missing.length ? `<p>The rest is wording, and only you can add new facts. The ad asks for things your CV doesn't clearly show yet:</p><ul class="tips">${missing.map(r => `<li>${esc(r.requirement)}: if you've done this, add a bullet point about it (Editor tab). If you haven't, leave it out.</li>`).join("")}</ul>` : ""}
      <div class="factions"><button class="btn small ghost" id="targetBack">Back</button><button class="btn small ghost" data-goto-editor>Open the Editor</button></div>`;
    return `<h3>Targeted version: ${plan.changes.length} suggested change${plan.changes.length > 1 ? "s" : ""}</h3>
      <p class="sector">Untick anything you don't want. No new facts, numbers or skills you haven't shown are added.</p>
      ${plan.changes.map(c => `<label class="tgt"><input type="checkbox" data-tgt="${c.id}" checked><div><b>${esc(c.label)}</b><p class="why">${esc(c.why)}</p>
        ${Array.isArray(c.after) ? `<div class="ba"><div><span class="lbl">Current order</span><ol>${c.before.map(t => `<li>${esc(t)}</li>`).join("")}</ol></div><div><span class="lbl">New order</span><ol>${c.after.map(t => `<li>${esc(t)}</li>`).join("")}</ol></div></div>`
        : c.kind === "skills" ? `<div class="diff"><span class="lbl">New skills line</span><br>${skillsHtml(c)}</div>`
        : `<div class="diff">${c.before ? diffHtml(c.before, c.after) : `<ins>${esc(c.after)}</ins>`}</div>`}</div></label>`).join("")}
      ${missing.length ? `<p class="sector">Still not shown (only add these if they're true): ${missing.map(r => esc(r.requirement)).join("; ")}.</p>` : ""}
      <div class="factions"><button class="btn small" id="targetApply">Apply selected changes</button><button class="btn small ghost" id="targetBack">Cancel</button></div>`;
  }
  function skillsHtml(c) {
    const lab = (c.after.match(/^([A-Za-z &/-]{2,30}):\s*/) || [""])[0];
    const added = new Set((c.added || []).map(x => x.toLowerCase()));
    return esc(lab) + c.after.slice(lab.length).split(/,\s*/).map(t => added.has(t.toLowerCase()) ? `<ins>${esc(t)}</ins>` : esc(t)).join(", ");
  }
  function bindTarget() {
    const card = $("targetCard"); if (!card) return;
    const rerender = () => { card.innerHTML = targetCard(); bindTarget(); };
    const tb = $("targetBtn"); if (tb) tb.onclick = () => {
      const role = $("tgtRole").value.trim(); if (role) S.jdTitle = role;
      S.targetPlan = CVE.planTargeted(S.doc, S.jd, S.jdTitle, S.settings); rerender();
    };
    const back = $("targetBack"); if (back) back.onclick = () => { S.targetPlan = null; rerender(); };
    card.querySelectorAll("[data-goto-editor]").forEach(b => b.onclick = () => showTab("editor"));
    const ap = $("targetApply"); if (ap) ap.onclick = () => {
      const pick = new Set([...card.querySelectorAll("[data-tgt]:checked")].map(x => x.dataset.tgt));
      if (!pick.size) { S.targetPlan = null; return rerender(); }
      const next = CVE.applyTargeted(S.doc, S.targetPlan.changes, pick);
      commit(() => { S.doc = next; });
      S.targetPlan = null;
      toast(`Applied ${pick.size} change${pick.size > 1 ? "s" : ""}. Use Undo if you change your mind, then reanalyse.`);
      showTab("editor");
    };
  }

  /* ---------- EXPORT ---------- */
  function renderExport() {
    if (!S.doc) return;
    const el = $("tab-export");
    const changed = S.originalDoc && CVE.toText(S.doc) !== CVE.toText(S.originalDoc);
    const fname = (S.doc.header[0] ? S.doc.header[0].text : "CV").replace(/[^A-Za-z0-9 -]+/g, "").trim().replace(/\s+/g, "-") || "CV";
    el.innerHTML = `
      <div class="export">
        <div class="card ex-left">
          <h3>Template</h3>
          <div class="tpls" role="radiogroup" aria-label="Template">${Object.entries(CVIO.TEMPLATES).map(([k, t]) => `<label class="tpl ${S.template === k ? "on" : ""}"><input type="radio" name="tpl" value="${k}" ${S.template === k ? "checked" : ""}><b>${t.name}</b><span class="sector">${t.desc}</span></label>`).join("")}</div>
          <p class="notice">Your downloads are rebuilt in this template, so your original file's design isn't kept. All templates are single-column and ATS-friendly. To keep your own design, use “Copy text” and paste the changes into your original file.</p>
          <h3>Download</h3>
          <div class="factions col">
            <button class="btn" id="dlPdf">Download PDF</button>
            <button class="btn ghost" id="dlDocx">Download Word (.docx)</button>
            <button class="btn ghost" id="copyTxt">Copy text</button>
          </div>
          <p class="sector">${changed ? "Includes every change you've accepted or typed." : "You haven't changed anything yet — this is your original text in a new template."}</p>
          <h3>Compare versions</h3>
          <button class="btn small ghost" id="cmpBtn" ${changed ? "" : "disabled"}>${S.showCmp ? "Hide" : "Show"} original vs revised</button>
        </div>
        <div class="ex-right">
          ${S.showCmp && changed ? versionCompare() : `<div class="preview-wrap">${CVIO.previewHtml(S.doc, S.template, esc)}</div>`}
        </div>
      </div>`;
    el.querySelectorAll('input[name="tpl"]').forEach(r => r.onchange = () => { S.template = r.value; renderExport(); });
    $("dlPdf").onclick = () => { const p = CVIO.toPdf(S.doc, S.template); CVIO.download(p.bytes, `${fname}-CV.pdf`, "application/pdf"); S.dirty = false; };
    $("dlDocx").onclick = () => { CVIO.download(CVIO.toDocx(S.doc, S.template), `${fname}-CV.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); S.dirty = false; };
    $("copyTxt").onclick = async () => { try { await navigator.clipboard.writeText(CVE.toText(S.doc)); toast("Copied."); } catch (e) { $("tab-export").insertAdjacentHTML("beforeend", `<textarea class="raw" rows="12" aria-label="CV text">${esc(CVE.toText(S.doc))}</textarea>`); } };
    $("cmpBtn").onclick = () => { S.showCmp = !S.showCmp; renderExport(); };
  }
  function versionCompare() {
    const A = CVE.toText(S.originalDoc).split("\n"), B = CVE.toText(S.doc).split("\n");
    // line-level LCS so unchanged lines line up
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const rows = []; let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { rows.push(["eq", A[i], B[j]]); i++; j++; }
      else if (i < n && j < m && L[i + 1][j] === L[i][j + 1]) { rows.push(["chg", A[i], B[j]]); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { rows.push(["add", "", B[j]]); j++; }
      else { rows.push(["del", A[i], ""]); i++; }
    }
    return `<div class="vcmp card"><div class="vcmp-h"><b>Original</b><b>Revised</b></div>${rows.map(([t, a, b]) => t === "eq" ? `<div class="vrow"><div>${esc(a)}</div><div>${esc(b)}</div></div>` : t === "chg" ? `<div class="vrow chg"><div>${CVE.diff(a, b).filter(p => p.t !== "ins").map(p => p.t === "del" ? `<del>${esc(p.s)}</del>` : esc(p.s)).join("")}</div><div>${CVE.diff(a, b).filter(p => p.t !== "del").map(p => p.t === "ins" ? `<ins>${esc(p.s)}</ins>` : esc(p.s)).join("")}</div></div>` : t === "add" ? `<div class="vrow add"><div></div><div><ins>${esc(b)}</ins></div></div>` : `<div class="vrow del"><div><del>${esc(a)}</del></div><div></div></div>`).join("")}</div>`;
  }

  /* ---------- reset ---------- */
  $("newCv").onclick = () => { if (S.dirty && !confirm("Start again? Your edits will be lost unless you've downloaded them.")) return; S.dirty = false; S.doc = null; S.history = []; $("workspace").hidden = true; $("landing").hidden = false; $("upload").scrollIntoView({ behavior: "smooth" }); };
});
