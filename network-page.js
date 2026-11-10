App.boot(() => {
  const { Store, esc, mark, toast } = App;
  const $ = id => document.getElementById(id);

  function firmKey(p) { return p.firm.replace(/\s*\(.*\)/, "").replace(/\s+(WA|Perth)$/i, "").trim(); }

  function render() {
    $("loaded").hidden = !Net.has;
    $("emptyState").hidden = Net.has;
    if (!Net.has) return;
    /* group all programs (both fields) by firm, then match */
    const firms = {};
    Store.allPrograms.forEach(p => { const k = firmKey(p); (firms[k] = firms[k] || []).push(p); });
    const rows = Object.entries(firms).map(([name, ps]) => ({ name, ps, people: Net.atPrograms(ps) })).filter(r => r.people.length)
      .sort((a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name));
    const matched = new Set(rows.flatMap(r => r.people.map(c => c.url || c.name)));
    const when = Net.imported ? new Date(Net.imported).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";
    $("netStats").innerHTML = [[Net.count, `connections imported${when ? ` (${when})` : ""}`], [matched.size, "work at a firm we track"], [rows.length, "firms where you know someone"]]
      .map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");
    const q = $("netQ").value.trim().toLowerCase();
    const shown = rows.filter(r => !q || (r.name + " " + r.people.map(c => c.name + " " + c.position).join(" ")).toLowerCase().includes(q));
    $("netList").innerHTML = shown.length ? shown.map(r => `<article class="co">
        <div class="top">${mark(r.ps[0])}<div><div class="firm-name">${esc(r.name)}</div><div class="sector">${esc(r.ps[0].sector)} · ${r.people.length} ${r.people.length === 1 ? "connection" : "connections"}</div></div>
          <a class="btn small ghost" href="tracker.html?open=${r.ps[0].id}">Programs</a></div>
        ${App.networkBlock(r.ps, r.name)}
      </article>`).join("")
      : `<p class="empty">No matches${q ? " for that search" : ""}.</p>`;
  }

  async function handle(file) {
    if (!file) return;
    try {
      const n = await Net.importFile(file);
      toast(`Imported ${n} connections. They stay on this device.`);
      render();
    } catch (e) { toast(e.message); }
  }
  $("file").onchange = e => handle(e.target.files[0]);
  const dz = $("drop");
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); handle(e.dataTransfer.files[0]); };
  $("connectBtn").onclick = () => App.openLinkedIn();
  $("clearNet").onclick = () => { if (confirm("Remove your imported connections from this browser?")) { Net.clear(); render(); toast("Removed."); } };
  $("netQ").oninput = render;
  render();
});
