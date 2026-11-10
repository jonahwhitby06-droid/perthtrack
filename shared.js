/* Shared logic used by both the browser and the Node server.
   Status, team categories, fit/competition scoring and alert matching live here so both sides agree. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PT = factory();
})(typeof self !== "undefined" ? self : this, function () {

  /* ---------- dates (all Perth time, UTC+8, no daylight saving) ---------- */
  function perthToday(now) {
    const t = now ? new Date(now) : new Date();
    const p = new Date(t.getTime() + 8 * 3600e3);
    return new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()));
  }
  function d(s) { const [y, m, dd] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmt(dt) { return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`; }
  function fmtShort(dt) { return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`; }
  const DAY = 864e5;

  /* ---------- status ---------- */
  function statusOf(p, now) {
    const today = perthToday(now);
    if (p.adhoc) return { key: "adhoc", label: "Apply any time", rank: 3 };
    const wins = (p.windows || []).map(w => ({ ...w, od: d(w.o), cd: d(w.c) })).sort((a, b) => a.od - b.od);
    for (const w of wins) {
      if (today >= w.od && today <= w.cd) {
        const days = Math.round((w.cd - today) / DAY);
        return { key: "open", label: w.rolling ? "Open, rolling" : "Open now", win: w, days, rank: 0 };
      }
    }
    const next = wins.find(w => w.od > today);
    if (next) {
      const days = Math.round((next.od - today) / DAY);
      return days <= 90 ? { key: "soon", label: "Opens soon", win: next, days, rank: 1 }
                        : { key: "closed", label: "Closed", win: next, days, rank: 2 };
    }
    if (p.tbc) return { key: "tbc", label: "Dates TBC", rank: 4 };
    return { key: "closed", label: "Closed", rank: 5 };
  }
  function sortKey(p, now) {
    const s = statusOf(p, now);
    return s.rank * 1e6 + (s.days ?? 9e5);
  }

  /* ---------- team categories ---------- */
  /* Engineering categories are checked first, then finance ones. "other" = neither. */
  const CATEGORIES = [
    { id: "transport",  field: "Engineering", label: "Transport, traffic & rail",              re: /transport|traffic|\brail|highway|\broads?\b|pavement/i },
    { id: "water",      field: "Engineering", label: "Water, coastal & dams",                   re: /water|hydrolog|hydraulic|\bdams?\b|wastewater|coastal|stormwater/i },
    { id: "geotech",    field: "Engineering", label: "Geotechnical & tunnelling",               re: /geotech|tunnel/i },
    { id: "surveying",  field: "Engineering", label: "Surveying & spatial",                     re: /surveying|\bspatial|geospatial|geomatic/i },
    { id: "civil",      field: "Engineering", label: "Civil & structural",                      re: /civil|structural|bridge|facade|network operations/i },
    { id: "aero",       field: "Engineering", label: "Aerospace, defence & systems",          re: /aerospace|aeronaut|avionic|aviation|aircraft|defence|systems engineering|naval architecture|shipbuild/i },
    { id: "biomed",     field: "Engineering", label: "Biomedical engineering",                re: /biomedical|medical device|bioengineering|clinical engineering|medical technology/i },
    { id: "mechanical", field: "Engineering", label: "Mechanical & mechatronic",               re: /mechanical|mechatronic|robotic|naval|ocean|subsea|pipeline|piping|fire|manufacturing|materials|corrosion/i },
    { id: "projects",   field: "Engineering", label: "Project & construction management",      re: /project management|project engineering|construction management|project controls|estimating|contracts|asset management|site engineer/i },
    { id: "electrical", field: "Engineering", label: "Electrical, power & controls",           re: /electrical|electronic|instrumentation|control|automation|power systems|energy\)|renewable/i },
    { id: "chemical",   field: "Engineering", label: "Chemical, process & metallurgy",         re: /chemical|process engineering|process control|process &|processing|metallurg|petroleum|reservoir|wells|refin/i },
    { id: "mining",     field: "Engineering", label: "Mining, geology & geoscience",           re: /mining|geolog|geoscience|hydrogeolog|subsurface/i },
    { id: "enviro",     field: "Engineering", label: "Environmental & sustainability",         re: /environment|sustainab/i },
    { id: "software",   field: "Engineering", label: "Software, data & technology",            re: /software|data|cyber|technology|computer|\bai\b|autonomy|firmware/i },
    { id: "paralegal",  field: "Law", label: "Paralegal & law clerk roles",        re: /paralegal|law clerk|legal assistant/i },
    { id: "taxlaw",     field: "Law", label: "Tax & private client",               re: /\btax|private client|trusts/i },
    { id: "famlaw",     field: "Law", label: "Family law, wills & estates",        re: /family|wills|estates|succession/i },
    { id: "inslaw",     field: "Law", label: "Insurance & personal injury",        re: /insurance|personal injury|workers comp|compensation|medical negligence|class action|professional indemnity|motor accident/i },
    { id: "projlaw",    field: "Law", label: "Construction & infrastructure",      re: /construction|projects|infrastructure/i },
    { id: "proplaw",    field: "Law", label: "Property, planning & environment",   re: /property|real estate|planning|environment|land/i },
    { id: "resourceslaw", field: "Law", label: "Energy & resources",               re: /energy|resources|mining|native title|climate/i },
    { id: "finlaw",     field: "Law", label: "Banking, finance & insolvency",      re: /banking|finance|restructuring|insolvency/i },
    { id: "disputes",   field: "Law", label: "Disputes & litigation",              re: /dispute|litigation|arbitration|state counsel|shipping|civil law|community|court/i },
    { id: "corplaw",    field: "Law", label: "Corporate, M&A & funds",             re: /corporate|m&a|commercial|funds|capital markets|equity/i },
    { id: "workplace",  field: "Law", label: "Employment & workplace",             re: /employment|workplace|industrial/i },
    { id: "techlaw",    field: "Law", label: "Technology, IP & privacy",           re: /technology|\bip\b|intellectual|privacy|data/i },
    { id: "criminal",   field: "Law", label: "Criminal law & prosecutions",        re: /criminal|prosecution|confiscation/i },
    { id: "publaw",     field: "Law", label: "Government, public & regulatory law",re: /public|government|policy|advice|administrative|regulatory|competition|consumer|investigations|ombudsman|human rights|associate/i },
    { id: "deals",      field: "Finance", label: "M&A, corporate finance & advisory", re: /m&a|corporate finance|deal|transaction|corporate advisory|capital raising|ecm|dcm|equity capital|investment bank|private equity|due diligence|acquisition|financing|infrastructure|restructuring|turnaround|insolvency|valuation|financial modelling/i },
    { id: "markets",    field: "Finance", label: "Markets, research & investments",   re: /research|sales|trading|markets|broking|stockbroking|capital markets|investment|funds management|venture|treasury|wealth|financial planning/i },
    { id: "banking",    field: "Finance", label: "Banking & credit",                   re: /bank|credit|lending|private bank|institutional/i },
    { id: "audit",      field: "Finance", label: "Audit & assurance",                  re: /audit|assurance/i },
    { id: "tax",        field: "Finance", label: "Tax & accounting",                   re: /tax|accounting|business services/i },
    { id: "commercial", field: "Finance", label: "Corporate finance teams & commercial", re: /financ|commercial|strategy|planning|business|corporate|rotation/i },
    { id: "property",   field: "Finance", label: "Property & real estate",             re: /property|real estate|leasing|development/i },
    { id: "consulting", field: "Finance", label: "Consulting & risk",                  re: /consult|risk|forensic|advisory|actuarial|insurance|super/i },
    { id: "policy",     field: "Finance", label: "Economics & policy",                 re: /econom|policy|fiscal|budget/i }
  ];
  const OTHER = /^marketing$|payroll|procurement|supply chain|member services|^law$|corporate affairs|human resources/i;
  const FIELD_OF = Object.fromEntries(CATEGORIES.map(c => [c.id, c.field]));
  const FINANCE_FIRST = /investment bank|advisory|m&a|corporate finance|valuation|finance systems/i;
  const ENG_GENERAL = /engineer|technical/i;
  /* fields: the program's fields, so "Banking & Finance" at a law firm is a law team, not a bank team */
  function categoryOf(role, fields) {
    if (OTHER.test(role)) return "other";
    const lawFirst = fields && fields.length === 1 && fields[0] === "Law";
    const nonLaw = CATEGORIES.filter(c => c.field !== "Law");
    let list = FINANCE_FIRST.test(role) && !/engineer/i.test(role)
      ? [...nonLaw.filter(c => c.field === "Finance"), ...nonLaw.filter(c => c.field !== "Finance")] : nonLaw;
    list = lawFirst ? [...CATEGORIES.filter(c => c.field === "Law"), ...list] : [...list, ...CATEGORIES.filter(c => c.field === "Law")];
    for (const c of list) if (c.re.test(role)) return c.id;
    if (ENG_GENERAL.test(role)) return "eng";   /* "Engineering", "Technical streams": any engineering discipline */
    return "other";
  }
  /* Related categories: a near miss scores 3 rather than 2. */
  const NEAR = {
    deals: ["markets", "banking", "commercial", "consulting"], markets: ["deals", "banking", "commercial"],
    banking: ["markets", "deals", "commercial"], audit: ["tax", "consulting"], tax: ["audit", "commercial"],
    commercial: ["deals", "banking", "markets", "policy"], property: ["markets", "deals"],
    consulting: ["deals", "commercial", "policy"], policy: ["commercial", "consulting"],
    civil: ["projects", "transport", "water", "geotech", "enviro", "mining"], transport: ["civil", "projects"], water: ["civil", "enviro"], geotech: ["civil", "mining"], surveying: ["civil", "mining"], mechanical: ["electrical", "chemical", "projects"], electrical: ["mechanical", "software"],
    chemical: ["mechanical", "mining", "enviro"], mining: ["civil", "chemical"], enviro: ["civil", "chemical"],
    software: ["electrical", "aero"], projects: ["civil", "mechanical"], aero: ["mechanical", "electrical", "software"], biomed: ["mechanical", "electrical", "chemical"],
    corplaw: ["finlaw", "resourceslaw", "publaw"], finlaw: ["corplaw", "disputes"], disputes: ["finlaw", "criminal", "workplace"],
    resourceslaw: ["corplaw", "projlaw", "proplaw", "publaw"], projlaw: ["resourceslaw", "disputes", "proplaw"], proplaw: ["projlaw", "corplaw", "resourceslaw"],
    inslaw: ["disputes", "workplace"], famlaw: ["disputes", "criminal", "taxlaw"], taxlaw: ["corplaw", "famlaw", "finlaw"], workplace: ["disputes", "publaw"], publaw: ["criminal", "resourceslaw", "workplace"],
    criminal: ["publaw", "disputes", "famlaw"], techlaw: ["corplaw", "publaw"], paralegal: ["corplaw", "disputes", "finlaw", "resourceslaw", "workplace", "publaw", "criminal", "techlaw", "inslaw", "famlaw", "proplaw", "projlaw"], other: []
  };
  const FIELDS = ["Finance", "Engineering", "Law"];
  const DEFAULT_INTERESTS = { Finance: ["deals", "banking", "markets"], Engineering: ["civil", "mechanical", "electrical"], Law: ["corplaw", "disputes", "resourceslaw"] };
  const DEFAULT_PREFS = { interests: ["deals", "banking", "markets"], fitWeight: 0.6, finalYear: false, field: "All", city: "Perth", spec: "" };
  const CITIES = ["Perth", "Melbourne", "Sydney", "Brisbane", "Adelaide", "Hobart"];
  const STATE_OF = { Perth: "WA", Melbourne: "VIC", Sydney: "NSW", Brisbane: "QLD", Adelaide: "SA", Hobart: "TAS" };
  function inCity(p, city) { return !city || city === "All" || (p.cities || ["Perth"]).includes(city); }
  /* Does the program have a team in this specialty? "eng" (general engineering intake) counts for every engineering specialty. */
  function hasSpec(p, spec) {
    if (!spec) return true;
    const roles = p.teamsList && p.teamsList.length ? p.teamsList : [p.program];
    return roles.some(r => { const c = categoryOf(r, p.fields); return c === spec || (c === "eng" && FIELD_OF[spec] === "Engineering"); });
  }

  function fitOf(role, prefs, fields) {
    const cat = categoryOf(role, fields);
    const ints = (prefs && prefs.interests && prefs.interests.length) ? prefs.interests : DEFAULT_PREFS.interests;
    if (cat === "other") return 1;
    if (cat === "eng") return ints.some(x => FIELD_OF[x] === "Engineering") ? 3 : 1;
    if (cat === "paralegal" && !ints.includes("paralegal")) return ints.some(x => FIELD_OF[x] === "Law") ? 4 : 1;
    const i = ints.indexOf(cat);
    if (i === 0 || i === 1) return 5;
    if (i > 1) return 4;
    if (ints.some(x => (NEAR[x] || []).includes(cat))) return 3;
    /* a team in a field the user has no interests in at all */
    if (!ints.some(x => FIELD_OF[x] === FIELD_OF[cat])) return 1;
    return 2;
  }
  function inField(p, field) { return !field || field === "All" || (p.fields || ["Finance"]).includes(field); }

  /* Competition = estimated applicants per place, 1 (very low) to 5 (very high).
     No firm publishes applicant numbers; this blends brand pull, intake size and team popularity. */
  const SECTOR_BASE = { "Law firms": 4, "Government & community legal": 3, "Engineering consulting": 3, "Construction & contracting": 2, "Big 4": 4, "Mid-tier accounting": 2, "Boutique & advisory": 3, "Consulting": 3, "Investment banking": 4,
    "Banking": 4, "Insurance": 2, "Property & real estate": 3, "Funds & super": 3, "Resources & energy": 3, "Government": 3, "Defence & aerospace": 3, "Technology": 5 };
  function compOf(p, role) {
    let c = p.brand ?? SECTOR_BASE[p.sector] ?? 3;
    if (p.adhoc) c -= 1;
    if (/m&a|corporate finance|deal|investment bank|ecm|dcm|private equity|capital markets|transaction/i.test(role)) c += 1;
    else if (/audit|assurance|accounting|tax/i.test(role)) c -= 1;
    return Math.max(1, Math.min(5, c));
  }
  const COMP_LABEL = ["", "Very low", "Low", "Medium", "High", "Very high"];
  function scoreOf(fit, comp, w) {
    const fw = w ?? DEFAULT_PREFS.fitWeight;
    return Math.round(100 * (fw * (fit - 1) / 4 + (1 - fw) * (5 - comp) / 4));
  }
  function rolesFor(p, prefs) {
    const w = prefs && prefs.fitWeight != null ? prefs.fitWeight : DEFAULT_PREFS.fitWeight;
    return (p.teamsList && p.teamsList.length ? p.teamsList : [p.teams]).map(role => {
      const fit = fitOf(role, prefs, p.fields), comp = compOf(p, role);
      return { p, role, cat: categoryOf(role, p.fields), fit, comp, score: scoreOf(fit, comp, w) };
    });
  }

  /* ---------- alerts ---------- */
  function matchesAlert(p, a) {
    if (a.field && a.field !== "All" && !inField(p, a.field)) return false;
    if (a.city && a.city !== "All" && !inCity(p, a.city)) return false;
    if (a.spec && !hasSpec(p, a.spec)) return false;
    if (a.sectors && a.sectors.length && !a.sectors.includes(p.sector)) return false;
    if (a.seasons && a.seasons.length && !p.season.some(s => a.seasons.includes(s))) return false;
    if (a.finalYear && !(p.finalYear || p.adhoc)) return false;
    if (a.keywords && a.keywords.trim()) {
      const hay = [p.firm, p.program, p.teams, ...(p.teamsList || [])].join(" ").toLowerCase();
      const kws = a.keywords.toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
      if (!kws.some(k => hay.includes(k))) return false;
    }
    return true;
  }
  /* What an alert should tell you about today: programs that are open, or open within `days`. */
  function alertHits(programs, a, now, days) {
    const horizon = days ?? 7;
    return programs.filter(p => matchesAlert(p, a)).map(p => ({ p, s: statusOf(p, now) }))
      .filter(x => x.s.key === "open" || (x.s.win && x.s.days <= horizon))
      .sort((x, y) => (x.s.rank - y.s.rank) || ((x.s.days ?? 0) - (y.s.days ?? 0)));
  }

  /* ---------- calendar export ---------- */
  function ics(programs, title) {
    const esc = s => String(s).replace(/[\\,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const day = s => s.replace(/-/g, "");
    const plus1 = s => { const x = d(s); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ""); };
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PerthTrack//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(title || "PerthTrack")}`];
    for (const p of programs) for (const [i, w] of (p.windows || []).entries()) {
      const est = w.est ? " (estimated)" : "";
      lines.push("BEGIN:VEVENT", `UID:${p.id}-${i}-open@perthtrack`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day(w.o)}`, `DTEND;VALUE=DATE:${plus1(w.o)}`,
        `SUMMARY:${esc(`Opens: ${p.firm} – ${p.program}${est}`)}`, `DESCRIPTION:${esc(`${w.label}. Closes ${w.c}. ${p.url}`)}`, `URL:${p.url}`, "END:VEVENT");
      lines.push("BEGIN:VEVENT", `UID:${p.id}-${i}-close@perthtrack`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day(w.c)}`, `DTEND;VALUE=DATE:${plus1(w.c)}`,
        `SUMMARY:${esc(`Closes: ${p.firm} – ${p.program}${est}`)}`, `DESCRIPTION:${esc(p.url)}`, `URL:${p.url}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  const SECTORS = ["Law firms","Government & community legal","Engineering consulting","Construction & contracting","Big 4","Mid-tier accounting","Boutique & advisory","Consulting","Investment banking","Banking","Insurance","Property & real estate","Funds & super","Resources & energy","Defence & aerospace","Technology","Government"];
  const SEASONS = ["Summer","Winter","Part-time","Graduate","Paralegal","Pathway"];
  const PIPELINE = ["Interested","Applied","Online test","Interview","Offer","Rejected"];

  return { perthToday, d, fmt, fmtShort, statusOf, sortKey, CATEGORIES, categoryOf, fitOf, compOf, COMP_LABEL, scoreOf, rolesFor,
    DEFAULT_PREFS, DEFAULT_INTERESTS, FIELDS, FIELD_OF, inField, CITIES, STATE_OF, inCity, hasSpec, matchesAlert, alertHits, ics, SECTORS, SEASONS, PIPELINE };
});
