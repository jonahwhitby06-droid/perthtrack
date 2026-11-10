App.boot(() => {
  const { Store, esc, mark, pill, toast } = App;
  const $ = id => document.getElementById(id);
  const state = { q: "", sector: "All", following: false, net: false };

  /* group programs by firm (some firms run several programs) */
  function firmKey(p) { return p.firm.replace(/\s*\(.*\)/, "").replace(/\s+(WA|Perth)$/i, "").trim(); }
  const firms = {};
  Store.programs.forEach(p => { const k = firmKey(p); (firms[k] = firms[k] || { name: k, sector: p.sector, color: p.color, firm: p.firm, programs: [] }).programs.push(p); });
  const list = Object.values(firms).sort((a, b) => a.name.localeCompare(b.name));

  $("sector").innerHTML = ["All", ...PT.SECTORS].map(s => `<option>${esc(s)}</option>`).join("");
  $("sector").onchange = e => { state.sector = e.target.value; render(); };
  $("q").oninput = e => { state.q = e.target.value.trim().toLowerCase(); render(); };
  $("netF").onclick = e => { state.net = !state.net; e.currentTarget.setAttribute("aria-pressed", state.net); render(); };
  $("following").onclick = e => { state.following = !state.following; e.currentTarget.setAttribute("aria-pressed", state.following); render(); };

  function render() {
    const rows = list.filter(f => (state.sector === "All" || f.programs.some(p => p.sector === state.sector))
      && (!state.q || (f.name + " " + f.programs.map(p => p.teams).join(" ")).toLowerCase().includes(state.q))
      && (!state.following || f.programs.some(p => Store.watch.has(p.id)))
      && (!state.net || (window.Net && Net.atPrograms(f.programs).length)));
    $("count").textContent = `${rows.length} firms`;
    $("cos").innerHTML = rows.map(f => {
      const watching = f.programs.every(p => Store.watch.has(p.id));
      return `<article class="co">
        <div class="top">${mark(f.programs[0])}<div><div class="firm-name">${esc(f.name)}</div><div class="sector">${esc(f.sector)} · ${f.programs.length} program${f.programs.length > 1 ? "s" : ""}</div></div></div>
        ${window.Net && Net.has ? (cs => cs.length ? `<details class="conn"><summary>👥 You know ${cs.length} ${cs.length === 1 ? "person" : "people"} here</summary>${App.networkBlock(f.programs, f.name)}</details>` : "")(Net.atPrograms(f.programs)) : ""}
        <ul>${f.programs.map(p => `<li><a href="tracker.html?open=${p.id}">${esc(p.program)}</a>${pill(PT.statusOf(p))}</li>`).join("")}</ul>
        <div class="foot-row"><button class="btn small${watching ? "" : " ghost"}" data-follow="${esc(f.name)}">${watching ? "★ Following" : "☆ Follow"}</button>
        <a class="btn small ghost" href="${esc(f.programs[0].url)}" target="_blank" rel="noopener">Careers page ↗</a>
        ${window.Net ? `<a class="btn small ghost" href="${esc(Net.secondDegreeUrl(f.name))}" target="_blank" rel="noopener" title="Opens LinkedIn's search of your 2nd-degree connections at this firm">2nd-degree on LinkedIn ↗</a>` : ""}</div>
      </article>`;
    }).join("") || `<p class="empty">No firms match.</p>`;
    $("cos").querySelectorAll("[data-follow]").forEach(b => b.onclick = async () => {
      const f = firms[b.dataset.follow];
      const all = f.programs.every(p => Store.watch.has(p.id));
      for (const p of f.programs) if (Store.watch.has(p.id) === all) await Store.toggle("watch", p.id);
      toast(all ? `Stopped following ${f.name}.` : `Following ${f.name}. Its programs are on your watchlist.`);
      render();
    });
  }
  render();
});
