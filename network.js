/* "My network": matches the user's own LinkedIn connections export (Connections.csv) to firms and teams.
   Everything happens in the browser. The file and the matches are stored only on this device
   (localStorage) and are never sent to the PerthTrack server. */
(function () {
  const KEY = "pt-network-v1";

  /* Extra names firms go by on LinkedIn. Keys are program ids. */
  const ALIASES = {
    pwc: ["pricewaterhousecoopers"], ey: ["ernst & young", "ernst and young"], gt: ["grant thornton"],
    cba: ["commonwealth bank", "commbank"], nab: ["national australia bank"], anz: ["anz bank", "australia and new zealand banking"],
    rio: ["rio tinto"], woodside: ["woodside energy"], fortescue: ["fortescue metals", "fortescue future industries"],
    treasury: ["department of treasury", "treasury and finance", "treasury wa"], dtfgrad: ["department of treasury", "treasury and finance"],
    oag: ["office of the auditor general", "auditor general"], watercorp: ["water corporation", "water corp"],
    pta: ["public transport authority", "transperth"], mainroads: ["main roads western australia", "main roads wa"],
    hlb: ["hlb mann judd"], hlbgrad: ["hlb mann judd"], pkfperth: ["pkf perth", "pkf"], swperth: ["sw accountants", "sw audit"],
    am: ["alvarez & marsal", "alvarez and marsal"], fti: ["fti consulting"], mcgrathnicol: ["mcgrathnicol", "mcgrath nicol"],
    macquarie: ["macquarie group", "macquarie capital", "macquarie bank"], macqwinter: ["macquarie group", "macquarie bank"],
    goldman: ["goldman sachs"], ubs: ["ubs"], ubschallenge: ["ubs"], ubsgrad: ["ubs"], wesbd: ["wesfarmers"], wescef: ["wesfarmers chemicals", "csbp"],
    findex: ["findex", "crowe"], watc: ["western australian treasury corporation", "watc"], icwa: ["insurance commission of western australia", "icwa"],
    devwa: ["developmentwa", "development wa"], gesb: ["gesb"], hbf: ["hbf health"], rac: ["rac wa", "royal automobile club"],
    westernpower: ["western power"], synergy: ["synergy"], horizonpower: ["horizon power"], minres: ["mineral resources"],
    northernstar: ["northern star resources"], hancock: ["hancock prospecting", "roy hill"], inpex: ["inpex"], cbh: ["cbh group", "co-operative bulk handling"],
    bhptech: ["bhp"], chevroneng: ["chevron"], alcoaeng: ["alcoa"], glencoremmo: ["glencore", "murrin murrin"],
    goldfields: ["gold fields"], perthmint: ["the perth mint", "perth mint", "gold corporation"], capitalpartners: ["capital partners"],
    euroz: ["euroz hartleys", "euroz"], argonaut: ["argonaut"], argograd: ["argonaut"], canaccord: ["canaccord genuity"],
    rsmcf: ["rsm"], azuregrad: ["azure capital"], azure: ["azure capital"], stateone: ["state one"], ordminnett: ["ord minnett"],
    shaw: ["shaw and partners", "shaw & partners"], wilsons: ["wilsons advisory", "wilsons"], dfk: ["dfk gooding", "dfk"],
    knightfrank: ["knight frank"], cbre: ["cbre"], htw: ["herron todd white"], australiansuper: ["australiansuper", "australian super"],
    lgt: ["lgt crestone", "crestone", "lgt wealth"], tattarang: ["tattarang", "minderoo"], mitsuiiod: ["mitsui"], dof: ["dof group", "dof subsea", "dof"],
    hsf: ["herbert smith freehills", "hsf kramer", "hsf"], kwm: ["king and wood mallesons", "kwm"], gtlaw: ["gilbert tobin"], gtparalegal: ["gilbert tobin"],
    corrs: ["corrs chambers westgarth", "corrs"], aoshearman: ["a and o shearman", "allen and overy"], jws: ["johnson winter slattery", "johnson winter"],
    hwle: ["hwl ebsworth", "hwle"], nrf: ["norton rose fulbright", "norton rose"], minterellison: ["minterellison", "minter ellison"],
    claytonutz: ["clayton utz"], dlapiper: ["dla piper"], klgates: ["k and l gates"], squire: ["squire patton boggs"], hallwilcox: ["hall and wilcox"],
    sso: ["state solicitor s office", "state solicitors office", "state solicitor"], odpp: ["office of the director of public prosecutions", "odpp", "director of public prosecutions"],
    ombudsmanwa: ["ombudsman western", "ombudsman"], legalaidwa: ["legal aid western", "legal aid"], jacksonmcdonald: ["jackson mcdonald"], steinepreis: ["steinepreis paganin"],
    lycopodium: ["lycopodium"], monadelphous: ["monadelphous"], civmec: ["civmec"], thiess: ["thiess"], newmont: ["newmont"]
  };
  const STOP = /\b(pty|ltd|limited|inc|llc|plc|group|holdings|australia|australian|wa|perth|the|co)\b/g;

  function norm(s) { return " " + String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() + " "; }
  function core(s) { return norm(s).replace(STOP, " ").replace(/\s+/g, " "); }

  function aliasesFor(p) {
    const base = p.firm.replace(/\(.*?\)/g, "").split("/").map(s => s.trim()).filter(Boolean);
    const paren = (p.firm.match(/\((.*?)\)/) || [])[1];
    if (paren && !/^(perth|wa|ecm|perpetual|general)$/i.test(paren)) base.push(paren);
    if (p.id === "lawparalegal") return [];
    return [...new Set([...base, ...(ALIASES[p.id] || [])].map(a => core(a).trim()).filter(a => a.length >= 2))];
  }
  /* A connection's company matches when an alias appears as whole words in it.
     Very short aliases (ey, ubs, bdo) must be the whole company name or its first word. */
  function companyMatches(company, aliases, headline) {
    /* for pasted headlines like "Analyst | BDO | UWA", try each part */
    if (headline) return String(company).split(/\s[|·•–-]\s|\|/).some(part => companyMatches(part, aliases, false))
      || companyMatches(company, aliases, false);
    const c = core(company);
    if (c.trim().length < 2) return false;
    return aliases.some(a => a.length <= 3 ? (c.trim() === a || c.trim().startsWith(a + " ")) : c.includes(" " + a + " "));
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  /* LinkedIn's Connections.csv starts with a few "Notes" lines before the header row. */
  function parseConnections(text) {
    const rows = parseCSV(text.replace(/^﻿/, ""));
    const h = rows.findIndex(r => r.some(c => /^first name$/i.test(c.trim())) && r.some(c => /^company$/i.test(c.trim())));
    if (h < 0) throw new Error("This doesn't look like LinkedIn's Connections.csv. It needs First Name, Last Name, Company and Position columns.");
    const head = rows[h].map(c => c.trim().toLowerCase());
    const col = n => head.indexOf(n);
    const out = [];
    for (const r of rows.slice(h + 1)) {
      const first = (r[col("first name")] || "").trim(), last = (r[col("last name")] || "").trim();
      if (!first && !last) continue;
      out.push({ name: `${first} ${last}`.trim(), url: (r[col("url")] || "").trim(), company: (r[col("company")] || "").trim(),
        position: (r[col("position")] || "").trim(), connectedOn: (r[col("connected on")] || "").trim() });
    }
    return out;
  }

  /* ---------- pasted text from linkedin.com/mynetwork/.../connections ----------
     Copying that page gives blocks like:  [Member's name] Jane Smith / [Member's occupation] Graduate at Deloitte /
     Connected on 3 November 2026 / Message.  We anchor on the "Connected on" lines. */
  const LABEL = /^(member.?s (name|occupation)|message|remove connection|more actions|connections?|sort by.*|search with filters|manage synced and imported contacts|\d+ connections?)$/i;
  function companyFromHeadline(h) {
    const m = h.match(/(?:\bat\b|@)\s+([^|·•,(]+)/i);
    if (m) return m[1].trim();
    return h.split(/\s[|·•–-]\s|\|/)[1]?.trim() || h;
  }
  function parsePasted(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !LABEL.test(l));
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^connected\s/i.test(lines[i])) continue;
      const headline = lines[i - 1], name = lines[i - 2];
      if (!name || !headline || /^connected\s/i.test(name) || /^connected\s/i.test(headline)) continue;
      out.push({ name, url: "", company: companyFromHeadline(headline), position: headline, headline: true,
        connectedOn: lines[i].replace(/^connected\s+(on\s+)?/i, "") });
    }
    if (!out.length) throw new Error("Couldn't find any connections in that text. Copy the whole LinkedIn connections page (Ctrl/Cmd+A, then Ctrl/Cmd+C) and paste it again.");
    return out;
  }

  /* ---------- LinkedIn's zip download, read in the browser ---------- */
  async function connectionsFromZip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("That file isn't a zip file.");
    let off = dv.getUint32(eocd + 16, true);
    const n = dv.getUint16(eocd + 10, true);
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
      const local = dv.getUint32(off + 42, true);
      const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nl));
      if (/(^|\/)connections\.csv$/i.test(name)) {
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const data = u8.subarray(start, start + csize);
        if (method === 0) return new TextDecoder().decode(data);
        if (method !== 8) throw new Error("Unsupported zip compression. Unzip it and add Connections.csv instead.");
        if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open zip files. Unzip it and add Connections.csv instead.");
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      }
      off += 46 + nl + el + cl;
    }
    throw new Error("Connections.csv isn't in that zip. In LinkedIn's data download, make sure Connections is ticked.");
  }

  /* ---------- storage ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(list, source) { const v = { imported: new Date().toISOString(), source, list }; try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} return v; }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* ---------- matching ---------- */
  const WORD_STOP = new Set(["and", "the", "of", "for", "intern", "internship", "graduate", "vacation", "student", "senior", "junior", "associate", "analyst", "manager", "director", "partner", "consultant", "assistant", "lead", "head", "team", "program", "engineer", "engineering"]);
  const words = s => String(s).toLowerCase().replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !WORD_STOP.has(w));
  /* Best team for a connection's job title: shared words first, then the same category of work. */
  function teamFor(position, teams) {
    if (!position || !teams || !teams.length) return null;
    const pw = new Set(words(position));
    let best = null, bestScore = 0;
    for (const t of teams) {
      const score = words(t).filter(w => pw.has(w)).length;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    if (best) return best;
    const cat = window.PT ? PT.categoryOf(position) : null;
    if (cat && cat !== "other") return teams.find(t => PT.categoryOf(t) === cat) || null;
    return null;
  }

  let cache = null;
  function data() { if (cache === null) cache = load() || { list: [] }; return cache; }
  const memo = new Map();
  function atProgram(p) {
    if (memo.has(p.id)) return memo.get(p.id);
    const r = atProgramRaw(p); memo.set(p.id, r); return r;
  }
  function atProgramRaw(p) {
    const al = aliasesFor(p);
    const teams = p.teamsList || [];
    return data().list.filter(c => companyMatches(c.company, al) || (c.headline && companyMatches(c.position, al, true))).map(c => ({ ...c, team: teamFor(c.position, teams) }));
  }
  /* Same, but for a set of programs belonging to one firm (no duplicates). */
  function atPrograms(programs) {
    const seen = new Map();
    for (const p of programs) for (const c of atProgram(p)) {
      const k = c.url || c.name;
      if (!seen.has(k) || (!seen.get(k).team && c.team)) seen.set(k, c);
    }
    return [...seen.values()];
  }
  function secondDegreeUrl(firm) {
    const name = firm.replace(/\(.*?\)/g, "").split("/")[0].trim();
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}&network=%5B%22S%22%5D&origin=FACETED_SEARCH`;
  }
  function firstDegreeUrl(firm) {
    const name = firm.replace(/\(.*?\)/g, "").split("/")[0].trim();
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}&network=%5B%22F%22%5D&origin=FACETED_SEARCH`;
  }

  window.Net = {
    parseConnections, parseCSV, parsePasted, connectionsFromZip, companyFromHeadline, aliasesFor, companyMatches, teamFor, atProgram, atPrograms, secondDegreeUrl, firstDegreeUrl,
    get has() { return data().list.length > 0; },
    get count() { return data().list.length; },
    get imported() { return data().imported; },
    importText(text) { const list = parseConnections(text); cache = save(list, "file"); memo.clear(); return list.length; },
    importPaste(text) { const list = parsePasted(text); cache = save(list, "paste"); memo.clear(); return list.length; },
    async importFile(file) {
      const read = () => file.text ? file.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
      const buf = () => file.arrayBuffer ? file.arrayBuffer() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });
      const text = /\.zip$/i.test(file.name) ? await connectionsFromZip(await buf()) : await read();
      return this.importText(text);
    },
    get source() { return data().source; },
    clear() { clear(); cache = { list: [] }; memo.clear(); },
    all() { return data().list; }
  };
})();
