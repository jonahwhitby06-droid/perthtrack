App.boot(() => {
  const { Store, esc, mark, windowText, pill, detailBlock, bindDetailActions, qs } = App;
  const COMBO = "Boutique + mid-tier", COMBO_SET = ["Boutique & advisory", "Mid-tier accounting"];
  const q0 = qs();
  const state = {
    q: q0.q || "", sector: q0.sector || "All", status: q0.status || "all", season: q0.season || "all",
    watchOnly: q0.watch === "1", finalOnly: q0.final === "1", contactsOnly: false,
    open: new Set(q0.open ? [q0.open] : [])
  };
  const $ = id => document.getElementById(id);
  $("q").value = state.q; $("statusSel").value = state.status; $("seasonSel").value = state.season;
  $("finalOnly").setAttribute("aria-pressed", state.finalOnly);
  $("watchOnly").setAttribute("aria-pressed", state.watchOnly);

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.sector !== "All") p.set("sector", state.sector);
    if (state.status !== "all") p.set("status", state.status);
    if (state.season !== "all") p.set("season", state.season);
    if (state.finalOnly) p.set("final", "1");
    if (state.watchOnly) p.set("watch", "1");
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
  }

  function matches(p) {
    if (state.sector === COMBO ? !COMBO_SET.includes(p.sector) : (state.sector !== "All" && p.sector !== state.sector)) return false;
    if (state.watchOnly && !Store.watch.has(p.id)) return false;
    if (state.finalOnly && !(p.finalYear || p.adhoc)) return false;
    if (state.contactsOnly && !Store.contacts.has(p.id) && !(window.Net && Net.atProgram(p).length)) return false;
    if (state.season !== "all" && !p.season.includes(state.season)) return false;
    const s = PT.statusOf(p);
    if (state.status !== "all" && s.key !== state.status) return false;
    if (state.q) {
      const hay = [p.firm, p.program, p.teams, p.sector, ...(p.teamsList || [])].join(" ").toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }

  function renderStats() {
    const ss = Store.programs.map(p => PT.statusOf(p));
    const n = k => ss.filter(s => s.key === k).length;
    $("stats").innerHTML = [
      [Store.programs.length, "programs tracked"], [n("open"), "open right now"],
      [n("soon"), "open within 90 days"], [Store.watch.size, "on your watchlist"]
    ].map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");
  }

  function renderFilters() {
    const hasCombo = Store.programs.some(p => COMBO_SET.includes(p.sector));
    const sectors = ["All", ...(hasCombo ? [COMBO] : []), ...PT.SECTORS.filter(s => Store.programs.some(p => p.sector === s))];
    const count = s => s === COMBO ? Store.programs.filter(p => COMBO_SET.includes(p.sector)).length : Store.programs.filter(p => p.sector === s).length;
    $("sectorFilters").innerHTML = sectors.map(s => `<button class="chip${s === COMBO ? " combo" : ""}" data-sector="${esc(s)}" aria-pressed="${state.sector === s}">${esc(s)}${s !== "All" ? ` <span class="mono" style="opacity:.6">${count(s)}</span>` : ""}</button>`).join("");
    $("sectorFilters").querySelectorAll("button").forEach(b => b.onclick = () => { state.sector = b.dataset.sector; renderFilters(); render(); });
  }

  function render() {
    syncUrl();
    const rows = Store.programs.filter(matches).sort((a, b) => PT.sortKey(a) - PT.sortKey(b));
    $("count").textContent = `${rows.length} of ${Store.programs.length} programs`;
    const tb = $("tbody");
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="8" class="empty">No programs match these filters. Clear the search or pick “All”.</td></tr>`; return; }
    tb.innerHTML = rows.map(p => {
      const { s, next, count } = windowText(p);
      const isOpen = state.open.has(p.id);
      return `<tr class="row" data-id="${p.id}" aria-expanded="${isOpen}" tabindex="0">
        <td><button class="star" data-star="${p.id}" aria-pressed="${Store.watch.has(p.id)}" aria-label="${Store.watch.has(p.id) ? "Remove from" : "Add to"} watchlist: ${esc(p.firm)}">${Store.watch.has(p.id) ? "★" : "☆"}</button></td>
        <td><div class="firm-cell">${mark(p)}<div><div class="firm-name">${esc(p.firm)}</div><div class="sector">${esc(p.sector)}</div></div></div></td>
        <td>${esc(p.program)}${p.finalYear ? ' <span class="fy">Final-year OK</span>' : ""}${(n => n ? ` <span class="fy net">👥 ${n} connection${n > 1 ? "s" : ""}</span>` : Store.contacts.has(p.id) ? ' <span class="fy net">You know someone</span>' : "")(window.Net ? Net.atProgram(p).length : 0)}<div class="sector">${esc(p.teams)}</div></td>
        <td>${esc(p.season.join(" / "))}</td>
        <td>${pill(s)}</td>
        <td class="mono" style="font-size:13px">${next}</td>
        <td style="font-size:13px;white-space:nowrap">${count}</td>
        <td><a class="apply" href="${esc(p.url)}" target="_blank" rel="noopener">Careers page ↗</a></td>
      </tr>${isOpen ? `<tr class="detail"><td colspan="8">${detailBlock(p)}</td></tr>` : ""}`;
    }).join("");
    tb.querySelectorAll("tr.row").forEach(r => {
      const toggle = () => { const id = r.dataset.id; state.open.has(id) ? state.open.delete(id) : state.open.add(id); render(); };
      r.onclick = e => { if (!e.target.closest("a,button")) toggle(); };
      r.onkeydown = e => { if (e.key === "Enter" && e.target === r) toggle(); };
    });
    tb.querySelectorAll("[data-star]").forEach(b => b.onclick = async e => {
      e.stopPropagation(); await Store.toggle("watch", b.dataset.star); render(); renderStats();
    });
    bindDetailActions(tb, () => { render(); renderStats(); });
  }

  $("q").oninput = e => { state.q = e.target.value.trim(); render(); };
  $("statusSel").onchange = e => { state.status = e.target.value; render(); };
  $("seasonSel").onchange = e => { state.season = e.target.value; render(); };
  for (const [id, key] of [["watchOnly", "watchOnly"], ["finalOnly", "finalOnly"], ["contactsOnly", "contactsOnly"]]) {
    $(id).onclick = e => { state[key] = !state[key]; e.currentTarget.setAttribute("aria-pressed", state[key]); render(); };
  }
  renderStats(); renderFilters(); render();
  if (q0.open) { const r = document.querySelector(`tr.row[data-id="${CSS.escape(q0.open)}"]`); if (r && r.scrollIntoView) r.scrollIntoView({ block: "center" }); }
});
