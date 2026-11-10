App.boot(() => {
  const { Store, esc, mark, meter } = App;
  const $ = id => document.getElementById(id);
  const bb = { netOnly: false, season: "all", final: !!Store.prefs.finalYear, noAdhoc: false, hideLow: true, showAll: false };

  /* interests picker */
  $("interests").innerHTML = App.interestChecks(Store.prefs, Store.field);
  $("interests").onchange = async () => {
    const order = App.readInterests($("interests"), Store.prefs);
    await Store.setPrefs({ interests: order.length ? order : PT.DEFAULT_PREFS.interests });
    render();
  };
  $("fitW").value = Math.round(Store.prefs.fitWeight * 100);
  const label = () => $("fitWLabel").textContent = `${$("fitW").value}% fit / ${100 - $("fitW").value}% low competition`;
  label();
  $("fitW").oninput = () => { label(); Store.prefs.fitWeight = $("fitW").value / 100; render(); };
  $("fitW").onchange = () => Store.setPrefs({ fitWeight: $("fitW").value / 100 });
  $("bbSeason").onchange = e => { bb.season = e.target.value; render(); };
  $("bbFinal").setAttribute("aria-pressed", bb.final);
  for (const [el, k] of [["bbFinal", "final"], ["bbNoAdhoc", "noAdhoc"], ["bbHideLow", "hideLow"], ["bbNet", "netOnly"]]) {
    $(el).onclick = e => { bb[k] = !bb[k]; e.currentTarget.setAttribute("aria-pressed", bb[k]); render(); };
  }
  $("bbMore").onclick = () => { bb.showAll = !bb.showAll; render(); };

  function render() {
    const rows = Store.programs.filter(p => {
      if (bb.netOnly && !(window.Net && Net.atProgram(p).length)) return false;
      if (bb.season !== "all" && !p.season.includes(bb.season)) return false;
      if (bb.final && !(p.finalYear || p.adhoc)) return false;
      if (bb.noAdhoc && p.adhoc) return false;
      return true;
    }).flatMap(p => PT.rolesFor(p, Store.prefs)).filter(r => !(bb.hideLow && r.fit <= 2))
      .sort((a, b) => b.score - a.score || a.comp - b.comp || b.fit - a.fit);
    const shown = bb.showAll ? rows : rows.slice(0, 30);
    $("bbBody").innerHTML = shown.length ? shown.map((r, i) => {
      const s = PT.statusOf(r.p);
      const next = s.win ? (s.key === "open" ? `<span class="pill open">Open</span> closes ${PT.fmtShort(s.win.cd)}` : `${PT.fmtShort(s.win.od)}${s.win.est ? '<span class="est">est.</span>' : ""}`) : `<span class="pill ${s.key}">${esc(s.label)}</span>`;
      return `<tr class="bb" data-id="${r.p.id}" tabindex="0">
        <td class="mono">${i + 1}</td>
        <td><b>${esc(r.role)}</b>${r.p.adhoc ? '<span class="da">Approach directly</span>' : ""}${(cs => { const t = cs.filter(c => c.team === r.role); return t.length ? ` <span class="fy net" title="${esc(t.map(c => c.name + " – " + c.position).join("; "))}">👥 ${esc(t[0].name)}${t.length > 1 ? ` +${t.length - 1}` : ""} in this team</span>` : cs.length ? ` <span class="fy net">👥 ${cs.length} at this firm</span>` : Store.contacts.has(r.p.id) ? ' <span class="fy net">You know someone</span>' : ""; })(window.Net ? Net.atProgram(r.p) : [])}</td>
        <td><div class="firm-cell">${mark(r.p)}<div><div class="firm-name">${esc(r.p.firm)}</div><div class="sector">${esc(r.p.program)}</div></div></div></td>
        <td>${meter(r.fit, "fit")} <span class="mono" style="font-size:12px">${r.fit}/5</span></td>
        <td>${meter(r.comp, "comp")} <span style="font-size:12px">${PT.COMP_LABEL[r.comp]}</span></td>
        <td class="score">${r.score}</td>
        <td style="font-size:13px">${next}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty">No teams match. Loosen a filter.</td></tr>`;
    $("bbMore").style.display = rows.length > 30 ? "" : "none";
    $("bbMore").textContent = bb.showAll ? "Show top 30" : `Show all ${rows.length} teams`;
    $("bbBody").querySelectorAll("tr.bb").forEach(tr => {
      const go = () => location.href = `tracker.html?open=${encodeURIComponent(tr.dataset.id)}`;
      tr.onclick = go; tr.onkeydown = e => { if (e.key === "Enter") go(); };
    });
  }
  render();
});
