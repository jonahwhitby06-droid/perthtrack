App.boot(() => {
  const { Store, esc, mark } = App;
  const $ = id => document.getElementById(id);
  const P = Store.programs;
  const withS = P.map(p => ({ p, s: PT.statusOf(p) }));

  const F = Store.field;
  $("fieldWord").textContent = F === "Engineering" ? "engineering" : F === "Finance" ? "finance" : "finance and engineering";
  $("quick").innerHTML = "Most searched: " + (F === "Engineering"
    ? [["civil", "Civil & structural"], ["mechanical", "Mechanical"], ["electrical", "Electrical"], ["mining", "Mining"], ["process", "Chemical & process"]].map(([q, t]) => `<a class="chip" href="tracker.html?q=${q}">${t}</a>`).join("") + `<a class="chip" href="tracker.html?season=Winter">Winter internships</a>`
    : [["corporate%20finance", "Corporate Finance"], ["deal", "Deals / M&amp;A"], ["research", "Equity Research"], ["civil", "Civil engineering"], ["mechanical", "Mechanical engineering"]].map(([q, t]) => `<a class="chip" href="tracker.html?q=${q}">${t}</a>`).join("") + `<a class="chip" href="tracker.html?season=Winter">Winter internships</a>`);
  $("searchForm").onsubmit = e => { e.preventDefault(); location.href = `tracker.html?q=${encodeURIComponent($("q").value.trim())}`; };

  /* next opening card */
  const upcoming = withS.filter(x => x.s.key === "soon" || (x.s.key === "closed" && x.s.win)).sort((a, b) => a.s.days - b.s.days);
  const n = upcoming[0];
  $("nextCard").innerHTML = n ? `<div class="eyebrow">Next window to open</div>
    <div class="firm">${esc(n.p.firm)}</div><div class="prog">${esc(n.p.program)}</div>
    <div class="count">${n.s.days}<small>days · ${PT.fmt(n.s.win.od)}${n.s.win.est ? " (est.)" : ""}</small></div>
    <p style="margin:14px 0 0"><a class="btn small" href="tracker.html?open=${n.p.id}">See the details</a></p>` : "";

  /* stats */
  const cnt = k => withS.filter(x => x.s.key === k).length;
  const firms = new Set(P.map(p => p.firm.replace(/\s*\(.*\)/, ""))).size;
  $("stats").innerHTML = [[P.length, "programs tracked"], [firms, "Perth firms"], [cnt("open"), "open right now"], [cnt("soon"), "open within 90 days"]]
    .map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join("");

  /* ticker */
  const items = upcoming.slice(0, 14).map(x => `<span><b>${esc(x.p.firm)}</b> ${esc(x.p.program)} · opens ~${PT.fmtShort(x.s.win.od)} · ${x.s.days} days</span>`).join("");
  $("ticker").innerHTML = items + items;

  /* live feed: real page-change events when the server is running, otherwise open programs */
  const ev = Store.events || [];
  if (ev.length) {
    $("feedTitle").textContent = "Latest changes spotted on careers pages";
    $("feed").innerHTML = ev.slice(0, 6).map(e => { const p = Store.byId[e.program_id]; if (!p) return "";
      return `<a class="item" href="tracker.html?open=${p.id}" style="text-decoration:none;color:inherit">${mark(p)}<span>${esc(e.detail)}</span><span class="when">${esc(e.created.slice(0, 16))}</span></a>`; }).join("");
  } else {
    const open = withS.filter(x => x.s.key === "open").sort((a, b) => a.s.days - b.s.days).slice(0, 6);
    $("feed").innerHTML = open.length ? open.map(({ p, s }) => `<a class="item" href="tracker.html?open=${p.id}" style="text-decoration:none;color:inherit">${mark(p)}
      <span><b>${esc(p.firm)}</b> · ${esc(p.program)}</span><span class="when">closes ${PT.fmtShort(s.win.cd)}</span></a>`).join("")
      : `<p class="sector">Nothing is open right now. Check the calendar for what opens next.</p>`;
  }

  /* taxonomy */
  $("taxSector").innerHTML = PT.SECTORS.filter(s => P.some(p => p.sector === s)).map(s =>
    `<a href="tracker.html?sector=${encodeURIComponent(s)}">${esc(s)} <b>${P.filter(p => p.sector === s).length}</b></a>`).join("");
  $("taxSeason").innerHTML = PT.SEASONS.filter(s => P.some(p => p.season.includes(s))).map(s =>
    `<a href="tracker.html?season=${encodeURIComponent(s)}">${s === "Part-time" ? "Part-time during semester" : s === "Graduate" ? "Graduate programs" : s + " internships"} <b>${P.filter(p => p.season.includes(s)).length}</b></a>`).join("")
    + `<a href="tracker.html?final=1">Open to final-year students <b>${P.filter(p => p.finalYear || p.adhoc).length}</b></a>`;

  if (Store.mode === "server" && !Store.signedIn) $("ctaBtn").href = "signup.html";
  if (Store.signedIn) { $("ctaBtn").textContent = "Set up an alert"; $("ctaBtn").href = "alerts.html"; }
});
