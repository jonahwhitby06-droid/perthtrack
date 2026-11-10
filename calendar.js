App.boot(() => {
  const { Store, esc, download, toast } = App;
  const $ = id => document.getElementById(id);
  const state = { only: Store.watch.size ? "watch" : "all" };
  $("which").value = state.only;
  $("which").onchange = e => { state.only = e.target.value; render(); };

  function render() {
    const today = PT.perthToday();
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
    const months = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1)));
    const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 14, 1);
    const span = end - start;
    const pos = t => Math.max(0, Math.min(100, (t - start) / span * 100));
    let rows = Store.programs.filter(p => (p.windows || []).some(w => PT.d(w.c) >= start && PT.d(w.o) < end));
    if (state.only === "watch") rows = rows.filter(p => Store.watch.has(p.id));
    rows.sort((a, b) => Math.min(...a.windows.map(w => PT.d(w.o))) - Math.min(...b.windows.map(w => PT.d(w.o))));
    $("calTitle").textContent = `${PT.fmt(months[0]).slice(2)} to ${PT.fmt(months[13]).slice(2)}`;
    const grid = `<div class="gridlines">${months.map(() => "<div></div>").join("")}</div>`;
    const head = `<div class="cal-row" style="min-height:0"><div class="cal-label"></div><div class="cal-months">${months.map((m, i) =>
      `<div class="${i === 0 || m.getUTCMonth() === 0 ? "yr" : ""}">${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m.getUTCMonth()]}${i === 0 || m.getUTCMonth() === 0 ? " " + String(m.getUTCFullYear()).slice(2) : ""}</div>`).join("")}</div></div>`;
    const body = rows.map(p => `<div class="cal-row"><div class="cal-label" title="${esc(p.firm)} – ${esc(p.program)}"><a href="tracker.html?open=${p.id}" style="color:inherit;text-decoration:none">${esc(p.firm)}</a></div>
      <div class="cal-track">${grid}${p.windows.map(w => { const o = PT.d(w.o), c = PT.d(w.c); const l = pos(o), r = pos(c.getTime() + 864e5);
        return r > l ? `<div class="bar${w.rolling ? " rolling" : w.est ? " est" : ""}" style="left:${l}%;width:${Math.max(r - l, 1.2)}%" title="${esc(w.label)}: ${PT.fmt(o)} to ${PT.fmt(c)}${w.est ? " (est.)" : ""}">${esc(w.label)}</div>` : ""; }).join("")}
      </div></div>`).join("");
    const tpos = pos(today.getTime());
    $("cal").innerHTML = rows.length ? head + body + `<div class="today" style="left:calc(200px + (100% - 200px) * ${tpos / 100})"><span>Today</span></div>`
      : `<p class="empty">${state.only === "watch" ? "Nothing on your watchlist has a dated window. Star programs in the tracker, or show all programs." : "No dated windows in this period."}</p>`;
  }
  render();

  $("icsBtn").onclick = () => {
    const progs = state.only === "watch" ? Store.programs.filter(p => Store.watch.has(p.id)) : Store.programs;
    if (!progs.length) return toast("Your watchlist is empty.");
    download("perthtrack.ics", PT.ics(progs, state.only === "watch" ? "PerthTrack – my watchlist" : "PerthTrack"), "text/calendar");
    toast("Calendar file downloaded. Open it to add the dates to your calendar.");
  };
});
