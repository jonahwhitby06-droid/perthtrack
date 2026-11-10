App.boot(async () => {
  const { Store, esc, mark, pill, toast, download } = App;
  const $ = id => document.getElementById(id);
  let apps = await Store.apps.list();

  function renderWatch() {
    const list = Store.allPrograms.filter(p => Store.watch.has(p.id)).sort((a, b) => PT.sortKey(a) - PT.sortKey(b));
    $("watchCount").textContent = list.length;
    $("watchGrid").innerHTML = list.length ? list.map(p => { const s = PT.statusOf(p);
      const line = s.win ? (s.key === "open" ? `Open · closes ${PT.fmt(s.win.cd)}` : `Opens ~${PT.fmt(s.win.od)}${s.win.est ? " (est.)" : ""}`) : s.label;
      const tracked = apps.some(a => a.program_id === p.id);
      return `<div class="wcard"><div class="firm-cell">${mark(p)}<div><h3>${esc(p.firm)}</h3><p>${esc(p.program)}</p></div></div>
        <p class="mono" style="color:var(--ink);margin-top:8px">${pill(s)} ${esc(line)}</p>
        <div class="detail-actions" style="margin-top:10px">
          ${tracked ? '<span class="sector">In your pipeline</span>' : `<button class="btn small" data-track="${p.id}">+ Track application</button>`}
          <button class="btn small ghost" data-unwatch="${p.id}">Remove</button></div></div>`; }).join("")
      : `<p class="empty">Nothing saved yet. Star programs in the <a href="tracker.html">tracker</a> or follow firms on the <a href="companies.html">companies</a> page.</p>`;
    $("watchGrid").querySelectorAll("[data-track]").forEach(b => b.onclick = async () => { apps.unshift(await Store.apps.add({ program_id: b.dataset.track })); renderAll(); toast("Added to your pipeline."); });
    $("watchGrid").querySelectorAll("[data-unwatch]").forEach(b => b.onclick = async () => { await Store.toggle("watch", b.dataset.unwatch); renderAll(); });
  }

  function renderBoard() {
    $("board").innerHTML = PT.PIPELINE.map(stage => {
      const items = apps.filter(a => a.status === stage);
      return `<section class="col" aria-label="${stage}"><h3>${stage}<span class="mono">${items.length}</span></h3>
        ${items.map(a => { const p = Store.byId[a.program_id]; if (!p) return "";
          const teams = p.teamsList || [];
          return `<div class="app" data-id="${a.id}">
            <div class="firm-cell">${mark(p)}<div><div class="t">${esc(p.firm)}</div><div class="sector">${esc(p.program)}</div></div></div>
            <label class="sector">Team <select data-f="team"><option value="">Any / not sure</option>${teams.map(t => `<option ${t === a.team ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
            <div class="row2"><label class="sector">Stage <select data-f="status">${PT.PIPELINE.map(s => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
            <label class="sector">Applied on <input type="date" data-f="applied_on" value="${esc(a.applied_on || "")}"></label>
            <textarea data-f="notes" placeholder="Notes: contacts, interview dates, questions asked">${esc(a.notes || "")}</textarea>
            <div class="row2"><a class="sector" href="${esc(p.url)}" target="_blank" rel="noopener">Careers page ↗</a><button class="x" data-del="${a.id}">Delete</button></div>
          </div>`; }).join("")}</section>`;
    }).join("");
    $("board").querySelectorAll(".app").forEach(card => {
      const id = Number(card.dataset.id);
      card.querySelectorAll("[data-f]").forEach(el => el.onchange = async () => {
        const patch = { [el.dataset.f]: el.value };
        try { const row = await Store.apps.update(id, patch); apps = apps.map(a => a.id === id ? { ...a, ...row } : a); }
        catch (e) { return toast(e.message); }
        if (el.dataset.f === "status") renderBoard(); else toast("Saved.");
      });
      card.querySelector("[data-del]").onclick = async () => {
        if (!confirm("Delete this application from your pipeline?")) return;
        await Store.apps.remove(id); apps = apps.filter(a => a.id !== id); renderAll();
      };
    });
    const c = s => apps.filter(a => a.status === s).length;
    $("pipeStats").innerHTML = [[apps.length, "tracked"], [c("Applied") + c("Online test") + c("Interview") + c("Offer") + c("Rejected"), "submitted"], [c("Interview"), "at interview"], [c("Offer"), "offers"]]
      .map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");
  }

  /* add any program, not just watched ones */
  $("addProg").innerHTML = `<option value="">Add a program…</option>` + Store.allPrograms.slice().sort((a, b) => a.firm.localeCompare(b.firm))
    .map(p => `<option value="${p.id}">${esc(p.firm)} – ${esc(p.program)}</option>`).join("");
  $("addProg").onchange = async e => { if (!e.target.value) return; apps.unshift(await Store.apps.add({ program_id: e.target.value })); e.target.value = ""; renderAll(); toast("Added to Interested."); };

  $("csvBtn").onclick = () => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Firm", "Program", "Team", "Stage", "Applied on", "Notes", "Next window", "Careers page"]].concat(apps.map(a => {
      const p = Store.byId[a.program_id] || {}; const s = p.id ? PT.statusOf(p) : {};
      return [p.firm, p.program, a.team, a.status, a.applied_on, a.notes, s.win ? `${PT.fmt(s.win.od)} – ${PT.fmt(s.win.cd)}` : s.label, p.url];
    }));
    download("perthtrack-applications.csv", rows.map(r => r.map(q).join(",")).join("\n"), "text/csv");
  };

  function renderAll() { renderWatch(); renderBoard(); }
  if (Store.mode !== "server") { $("localNote").textContent = "Your watchlist and pipeline are saved in this browser. Use Export CSV to keep a copy."; $("localNote").hidden = false; }
  else if (!Store.signedIn) $("localNote").hidden = false;
  renderAll();
});
