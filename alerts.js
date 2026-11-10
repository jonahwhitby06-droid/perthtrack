App.boot(async () => {
  const { Store, esc, mark, toast } = App;
  const $ = id => document.getElementById(id);

  $("alertForm").elements.field.value = Store.field;
  $("sectors").innerHTML = PT.SECTORS.map(s => `<label><input type="checkbox" name="sectors" value="${esc(s)}"> ${esc(s)}</label>`).join("");
  $("seasons").innerHTML = PT.SEASONS.map(s => `<label><input type="checkbox" name="seasons" value="${s}"> ${s === "Part-time" ? "Part-time" : s}</label>`).join("");

  if (Store.mode === "server" && !Store.signedIn) {
    $("emailNote").innerHTML = `Alerts are emailed at 7am Perth time. <a href="signup.html">Create a free account</a> to get them; until then you can preview matches here.`;
  } else if (Store.mode !== "server") {
    $("emailNote").innerHTML = `Email alerts are coming soon. For now, save an alert and check back here to see what matches, or add every opening date to your phone with <a href="calendar.html">Calendar → Add to my calendar</a>.`;
  } else {
    $("emailNote").textContent = `Matches are emailed to ${Store.user.email} at 7am Perth time, along with any changes we spot on those firms' careers pages overnight.`;
  }

  function readForm() {
    const f = $("alertForm").elements;
    return {
      name: f.alertname.value.trim() || "My alert",
      field: f.field.value,
      sectors: [...$("alertForm").querySelectorAll("[name=sectors]:checked")].map(i => i.value),
      seasons: [...$("alertForm").querySelectorAll("[name=seasons]:checked")].map(i => i.value),
      keywords: f.keywords.value.trim(),
      finalYear: f.finalYear.checked,
      frequency: f.frequency.value
    };
  }
  function hitsHtml(a) {
    const hits = PT.alertHits(Store.allPrograms, a, null, 30);
    if (!hits.length) return `<p class="sector">Nothing open or opening in the next 30 days matches. You'll hear about it when something does.</p>`;
    return `<div class="feed">${hits.slice(0, 8).map(({ p, s }) => `<a class="item" href="tracker.html?open=${p.id}" style="text-decoration:none;color:inherit">${mark(p)}
      <span><b>${esc(p.firm)}</b> · ${esc(p.program)}</span><span class="when">${s.key === "open" ? `open · closes ${PT.fmtShort(s.win.cd)}` : `opens ~${PT.fmtShort(s.win.od)}${s.win.est ? " (est.)" : ""}`}</span></a>`).join("")}</div>`;
  }
  $("alertForm").oninput = () => { $("preview").innerHTML = hitsHtml(readForm()); };
  $("preview").innerHTML = hitsHtml(readForm());

  async function renderList() {
    if (Store.mode === "server" && !Store.signedIn) { $("list").innerHTML = ""; return; }
    const list = await Store.alerts.list();
    $("list").innerHTML = list.length ? list.map(a => {
      const parts = [a.field && a.field !== "All" ? a.field : "", a.sectors?.length ? a.sectors.join(", ") : "All sectors", a.seasons?.length ? a.seasons.join(", ") : "any intake",
        a.keywords ? `keywords: ${a.keywords}` : "", a.finalYear ? "final-year OK" : ""].filter(Boolean).join(" · ");
      return `<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start">
        <div><h3 style="font-size:17px">${esc(a.name)}</h3><p class="sector">${esc(parts)} · ${a.frequency === "weekly" ? "weekly (Mondays)" : "daily"}${a.last_sent ? ` · last sent ${esc(a.last_sent.slice(0, 10))}` : ""}</p></div>
        <button class="btn small ghost" data-del="${a.id}">Delete</button></div>${hitsHtml(a)}</div>`;
    }).join("") : `<p class="sector">No alerts yet.</p>`;
    $("list").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { await Store.alerts.remove(Number(b.dataset.del)); renderList(); });
  }

  $("alertForm").onsubmit = async e => {
    e.preventDefault();
    if (Store.mode === "server" && !Store.signedIn) { location.href = "signup.html?next=alerts.html"; return; }
    try { await Store.alerts.add(readForm()); toast("Alert saved."); $("alertForm").reset(); $("preview").innerHTML = hitsHtml(readForm()); renderList(); }
    catch (err) { toast(err.message); }
  };
  renderList();
});
