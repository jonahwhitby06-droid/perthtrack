/* PerthTrack CV Score engine.
   Runs in the browser and on the server. It does four jobs:
   1. parse CV text into sections and lines,
   2. score it against a transparent rubric (rule-based mode),
   3. suggest rewrites that never add facts or numbers,
   4. validate AI results so totals are always computed here, not by the model. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CVE = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "1.0";
  const CATEGORIES = [
    { key: "experience", name: "Work experience and achievements", max: 25 },
    { key: "writing", name: "Writing quality and clarity", max: 20 },
    { key: "structure", name: "Structure and organisation", max: 15 },
    { key: "ats", name: "ATS readability and compatibility", max: 15 },
    { key: "relevance", name: "Career relevance and targeting", max: 15 },
    { key: "professionalism", name: "Professionalism and consistency", max: 10 }
  ];
  const CAT = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

  function band(score) {
    if (score >= 85) return { label: "Strong CV", tone: "strong", color: "#1f7a4a" };
    if (score >= 70) return { label: "Good Foundation", tone: "good", color: "#6a8f1f" };
    if (score >= 50) return { label: "Needs Improvement", tone: "mid", color: "#c26a00" };
    return { label: "Major Improvements Needed", tone: "low", color: "#b3261e" };
  }

  /* ---------------- parsing ---------------- */
  const HEADINGS = [
    ["summary", /^(professional |career |personal )?(summary|profile|objective|about me|overview)$|^career objective$/],
    ["education", /^(education|academic (background|qualifications|history|record)|qualifications|education (and|&) (training|qualifications))$/],
    ["experience", /^((relevant |professional |work |employment |industry |career |other |additional |part-time |practical )?(experience|history)|employment|work history|internships?( experience)?|(relevant |professional )?work experience|work|jobs|employment experience)$/],
    ["skills", /^((key |technical |core |relevant |professional |notable |other |additional |transferable |computer |it )?(skills|competencies|capabilities)( (and|&) (interests|certifications|tools|languages))?|technical proficiencies|tools( (and|&) technologies)?|software)$/],
    ["projects", /^((academic |personal |key |university |engineering |selected )?projects)$/],
    ["certifications", /^(certifications?|licen[cs]es( (and|&) certifications)?|certifications (and|&) licen[cs]es|courses|professional development|training)$/],
    ["achievements", /^(achievements|awards( (and|&) (achievements|scholarships|honours))?|honours( (and|&) awards)?|scholarships( (and|&) awards)?|awards (and|&) recognition)$/],
    ["leadership", /^(leadership( (and|&) (involvement|activities|extracurriculars?|volunteering))?|extra-?curricular( activities)?|volunteer(ing)?( experience| work)?|community (involvement|service)|activities|involvement|co-?curricular( activities)?)$/],
    ["interests", /^(interests|hobbies( (and|&) interests)?|interests (and|&) hobbies)$/],
    ["references", /^(referees?|references)( available (up)?on request)?$/],
    ["languages", /^languages$/],
    ["additional", /^(additional information|other information|personal information|additional details|extra information)$/]
  ];
  const LOCATION_RE = /^[A-Z][A-Za-z .'-]{1,30},?\s+(WA|NSW|VIC|QLD|SA|TAS|NT|ACT|Western Australia|Australia)\.?$/i;
  const EXP_TYPES = new Set(["experience", "projects", "leadership"]);
  const BULLET_RE = /^\s*([•●▪◦‣∙·‧■□►➢➤✓✔\-–—*]|o(?=\s)|\d{1,2}[.)](?=\s))\s*/;
  const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
  const DATE_RE = new RegExp(`\\b${MONTH}\\s+(?:19|20)\\d{2}\\b|\\b(?:19|20)\\d{2}\\s+${MONTH}(?![a-z])|\\b(?:0?[1-9]|1[0-2])\\/(?:19|20)\\d{2}\\b|\\b(?:19|20)\\d{2}\\b`, "gi");
  const CURRENT_RE = /\b(present|current|now|ongoing|to date)\b/i;

  function normHeading(line) {
    return line.toLowerCase().replace(/[:|_•*]+/g, " ").replace(/[^a-z& -]/g, "").replace(/\s+/g, " ").trim();
  }
  function headingType(line, seenKnown) {
    const t = line.trim();
    if (!t || t.length > 120 || /[.@]\s*$/.test(t) || /@|https?:|www\./i.test(t)) return null;
    const n = normHeading(t);
    for (const [type, re] of HEADINGS) if (re.test(n)) return type;
    const segs = t.split(/\s{2,}|\t|\|/).map(x => x.trim()).filter(Boolean);
    if (segs.length > 1) { const first = normHeading(segs[0]); for (const [type, re] of HEADINGS) if (re.test(first)) return type; }
    const words = n.split(" ").filter(Boolean);
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (t.length > 48) return null;
    if (seenKnown && letters.length >= 4 && letters === letters.toUpperCase() && words.length <= 4 && !DATE_RE.test(t)) { DATE_RE.lastIndex = 0; return "other"; }
    DATE_RE.lastIndex = 0;
    return null;
  }

  let uid = 0;
  const nid = p => `${p}${(++uid).toString(36)}`;

  /* Turn raw text into { header:[item], sections:[{id,title,type,items:[item]}] }.
     item = { id, text, bullet, marker, kind: "bullet"|"entry"|"statement"|"line", current } */
  function parse(raw) {
    const text = String(raw || "").replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/\t/g, "  ");
    let lines = text.split("\n").map(l => l.replace(/\s+$/, ""));
    // join lone bullet characters with the following line
    const joined = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*[•●▪◦‣∙·‧■►➢➤✓✔]\s*$/.test(lines[i]) && i + 1 < lines.length) { joined.push(lines[i].trim() + " " + lines[i + 1].trim()); i++; }
      else joined.push(lines[i]);
    }
    lines = joined;
    const doc = { header: [], sections: [] };
    let cur = null, seenKnown = false, lastEntryCurrent = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const isPlace = LOCATION_RE.test(line);
      if (isPlace && cur && !cur.items.length) continue; // e.g. "PERTH, WA" printed under a heading
      let ht = isPlace ? null : headingType(line, seenKnown);
      if (ht === "other" && cur && !cur.items.length && cur.type !== "other") continue; // decoration under a real heading
      if (ht) {
        if (ht !== "other") seenKnown = true;
        cur = { id: nid("s"), title: line.split(/\s{2,}|\t|\|/)[0].replace(/[:\s]+$/, "").trim(), type: ht, items: [] };
        doc.sections.push(cur); lastEntryCurrent = false;
        continue;
      }
      const m = line.match(BULLET_RE);
      const isBullet = !!m && line.length > m[0].length;
      const body = isBullet ? line.slice(m[0].length).trim() : line;
      const target = cur ? cur.items : doc.header;
      const prev = target[target.length - 1];
      // wrapped continuation of the previous bullet (PDF line breaks)
      if (!isBullet && prev && prev.bullet && /^[a-z(]/.test(body) && !/[.!?]$/.test(prev.text)) { prev.text += " " + body; continue; }
      const item = { id: nid("i"), text: body, bullet: isBullet, marker: isBullet ? m[1] : "" };
      if (cur && EXP_TYPES.has(cur.type)) {
        if (isBullet) { item.kind = "bullet"; item.current = lastEntryCurrent; }
        else {
          const hasDate = DATE_RE.test(body); DATE_RE.lastIndex = 0;
          const wc = body.split(/\s+/).length;
          if (hasDate || (wc <= 8 && !verbInfo(body).verb)) { item.kind = "entry"; lastEntryCurrent = hasDate && CURRENT_RE.test(body); item.current = lastEntryCurrent; }
          else { item.kind = "statement"; item.current = lastEntryCurrent; }
        }
      } else item.kind = isBullet ? "bullet" : "line";
      target.push(item);
    }
    return doc;
  }

  function toText(doc, opts = {}) {
    const out = [];
    for (const h of doc.header) out.push(h.text);
    for (const s of doc.sections) {
      out.push("", opts.upper ? s.title.toUpperCase() : s.title);
      for (const it of s.items) out.push(it.bullet ? `• ${it.text}` : it.text);
    }
    return out.join("\n").trim();
  }
  const allItems = doc => [...doc.header.map(i => ({ item: i, section: null })), ...doc.sections.flatMap(s => s.items.map(i => ({ item: i, section: s })))];
  function findItem(doc, id) { return allItems(doc).find(x => x.item.id === id) || null; }
  function clone(doc) { return JSON.parse(JSON.stringify(doc)); }

  /* ---------------- verbs ---------------- */
  const BASE = ("stock accelerate achieve administer advise allocate analyse analyze answer arrange assemble assess assist attend audit balance book boost brief budget build calculate chair champion check clean close coach collaborate collect communicate compile complete conduct construct consult contribute coordinate count create cut debug decrease define deliver demonstrate design develop direct display document double draft drive edit educate engage engineer enhance ensure enter establish evaluate examine exceed execute expand facilitate file forecast found generate greet grow guide handle help host identify implement improve increase induct input inspect install interview introduce investigate invoice launch lead liaise lift load lower maintain manage map market maximise maximize measure mentor merchandise minimise minimize model monitor motivate negotiate onboard open operate optimise optimize organise organize outperform oversee pack participate perform pitch plan prepare present price prioritise prioritize process produce program promote propose provide publish quote raise rebuild recommend reconcile record recruit redesign reduce refine renovate report represent research resolve respond restock restructure review revise run save scan schedule secure sell serve shorten simplify solve sort source spearhead standardise standardize steer streamline strengthen structure summarise summarize supervise support survey teach test track train transform translate triple troubleshoot tutor unload update upgrade use value verify volunteer win work write coordinate deliver model test").split(" ");
  const BASESET = new Set(BASE);
  const IRREG = { lead: "led", run: "ran", write: "wrote", build: "built", teach: "taught", sell: "sold", win: "won", cut: "cut", oversee: "oversaw", drive: "drove", forecast: "forecast", grow: "grew", spearhead: "spearheaded", undertake: "undertook", hold: "held", make: "made", deal: "dealt", do: "did", get: "got", speak: "spoke", seek: "sought", bring: "brought", find: "found", set: "set", put: "put", send: "sent", spend: "spent", keep: "kept", meet: "met", give: "gave", take: "took", draw: "drew" };
  const DOUBLE_AU = new Set(["plan", "scan", "map", "ship", "stop", "drop", "log", "tag", "step", "chat", "travel", "model", "label", "cancel", "control", "refer", "transfer", "prefer", "commit", "submit", "admit", "permit", "occur", "equip", "fulfil", "program", "audit"]);
  const US_NO_DOUBLE = new Set(["travel", "model", "label", "cancel", "audit"]);
  const AU_NO_DOUBLE = new Set(["audit"]);
  function past(v, variant) {
    v = v.toLowerCase();
    if (IRREG[v]) return IRREG[v];
    if (/e$/.test(v)) return v + "d";
    if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ied";
    const noDouble = variant === "en-US" ? US_NO_DOUBLE : AU_NO_DOUBLE;
    if (DOUBLE_AU.has(v) && !noDouble.has(v)) return v + v.slice(-1) + "ed";
    return v + "ed";
  }
  function gerund(v) {
    v = v.toLowerCase();
    if (/ie$/.test(v)) return v.slice(0, -2) + "ying";
    if (/[^e]e$/.test(v)) return v.slice(0, -1) + "ing";
    if (DOUBLE_AU.has(v) && !AU_NO_DOUBLE.has(v) && !US_NO_DOUBLE.has(v)) return v + v.slice(-1) + "ing";
    return v + "ing";
  }
  const PAST2BASE = new Map();
  for (const b of BASE) { PAST2BASE.set(past(b), b); PAST2BASE.set(past(b, "en-US"), b); }
  function baseOfGerund(w) {
    w = w.toLowerCase();
    if (!/ing$/.test(w)) return null;
    const stem = w.slice(0, -3);
    if (BASESET.has(stem)) return stem;
    if (BASESET.has(stem + "e")) return stem + "e";
    if (stem.length > 2 && stem.slice(-1) === stem.slice(-2, -1) && BASESET.has(stem.slice(0, -1))) return stem.slice(0, -1);
    if (/y$/.test(stem) && BASESET.has(stem.slice(0, -1) + "ie")) return stem.slice(0, -1) + "ie";
    return null;
  }
  const WEAK_OPEN = [
    [/^(?:i\s+)?(?:was\s+|am\s+)?responsible\s+for\b/i, "responsible"],
    [/^(?:my\s+)?(?:main\s+|key\s+)?(?:duties|tasks|responsibilities)\s+(?:included|include|were|involved)\b/i, "duties"],
    [/^(?:i\s+)?helped\b/i, "helped"],
    [/^(?:i\s+)?worked\s+(?:on|with|at|in|for|as)\b/i, "worked"],
    [/^(?:i\s+)?(?:participated|was\s+involved|involved)\s+in\b/i, "participated"],
    [/^(?:i\s+)?(?:was\s+)?(?:in\s+charge\s+of|tasked\s+with)\b/i, "incharge"],
    [/^(?:i\s+)?dealt\s+with\b/i, "dealt"],
    [/^(?:i\s+)?(?:did|got|made)\b/i, "did"]
  ];
  /* What a line opens with: { verb: base|null, form: "past"|"base"|"gerund"|null, weak: key|null, pronoun } */
  function verbInfo(text) {
    const t = String(text).trim();
    const pronoun = /^(i|we|my)\b/i.test(t);
    for (const [re, key] of WEAK_OPEN) if (re.test(t)) return { verb: key, form: "weak", weak: key, pronoun };
    const w = (t.replace(/^(i|we)\s+/i, "").match(/^[A-Za-z-]+/) || [""])[0].toLowerCase();
    if (!w) return { verb: null, form: null, weak: null, pronoun };
    if (PAST2BASE.has(w)) return { verb: PAST2BASE.get(w), form: "past", weak: null, pronoun, word: w };
    if (BASESET.has(w)) return { verb: w, form: "base", weak: null, pronoun, word: w };
    const g = baseOfGerund(w);
    if (g) return { verb: g, form: "gerund", weak: null, pronoun, word: w };
    if (/^[a-z]+ed$/.test(w) && w.length > 5) return { verb: w, form: "past", weak: null, pronoun, word: w };
    return { verb: null, form: null, weak: null, pronoun, word: w };
  }

  /* ---------------- dictionaries ---------------- */
  const HARD_SKILLS = ["advanced excel", "excel", "vba", "python", "sql", "power bi", "tableau", "matlab", "autocad", "civil 3d", "revit", "solidworks", "ansys", "sap", "xero", "myob", "quickbooks", "bloomberg", "capital iq", "factset", "refinitiv", "financial modelling", "financial modeling", "dcf", "valuation", "accounting", "bookkeeping", "reconciliation", "reconciliations", "budgeting", "forecasting", "financial analysis", "financial reporting", "data analysis", "statistics", "econometrics", "powerpoint", "microsoft word", "microsoft office", "ms office", "google sheets", "java", "c++", "c#", "javascript", "html", "css", "git", "arduino", "plc", "labview", "project management", "risk assessment", "hazop", "gis", "arcgis", "qgis", "microstation", "primavera", "ms project", "legal research", "legal writing", "drafting", "contract review", "lexisnexis", "westlaw", "jade", "due diligence", "conveyancing", "case management", "first aid", "white card", "rsa", "forklift licence", "salesforce", "hubspot", "crm", "canva", "adobe", "photoshop", "stata", "spss", "eviews", "alteryx", "jira", "agile", "scrum", "lean", "six sigma", "point of sale", "pos", "cash handling", "stock control", "inventory management", "customer service", "sales", "negotiation", "research", "report writing", "microsoft excel", "excel modelling", "outlook", "microsoft outlook", "social media management", "change management", "database management", "power query", "pivot tables", "property analysis", "real estate"];
  const SOFT_SKILLS = ["communication", "teamwork", "leadership", "time management", "problem solving", "problem-solving", "attention to detail", "adaptability", "work ethic", "interpersonal", "organisation", "organization", "critical thinking", "creativity", "initiative", "reliability", "collaboration", "resilience", "multitasking"];
  const FIELDS = {
    finance: /\b(financ\w*|accounting|accountant|audit\w*|tax|taxation|invest\w*|banking|bank|valuation\w*|equity|corporate|economics?|commerce|m&a|deals?|modelling|modeling|analyst|treasury|credit|portfolio|wealth|advisory|capital|markets?|bcom)\b/gi,
    engineering: /\b(engineer\w*|civil|mechanical|electrical|chemical|mining|structural|geotechnical|cad|autocad|construction|site|infrastructure|beng|metallurg\w*|process|maintenance|design)\b/gi,
    law: /\b(law|legal|juris\w*|clerkship|paralegal|litigation|court|contracts?|advocacy|moot\w*|llb|jd|solicitor|barrister|conveyancing|counsel)\b/gi
  };
  const VAGUE_RE = /\b(various|etc\.?|hard[- ]?working|team player|detail[- ]oriented|passionate|highly motivated|self[- ]motivated|go[- ]getter|results[- ]driven|dynamic|synergy|think outside the box|above and beyond|excellent communication skills|good communication skills|fast learner|quick learner|people person|stuff|things|a lot of|lots of)\b/gi;
  const IMPACT_RE = /\b(result(?:ing|ed)? in|leading to|led to|so that|improv\w*|reduc\w*|increas\w*|sav(?:ed|ing)|achiev\w*|exceed\w*|grew|growth|faster|accura\w*|on time|ahead of|award\w*|recogni[sz]ed|promoted|selected|ranked|top \d+|won|record|first)\b/i;
  const NUM_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|hundreds|thousand|thousands|dozen|dozens|million)\b/i;
  const PERSONAL_RE = /\b(date of birth|d\.?o\.?b\.?|age:? ?\d{2}|marital status|married|single|nationality|religion|gender:|photo)\b/i;

  /* Spelling: Australian/British vs US */
  const IZ_STEMS = ["organi", "analy", "optimi", "prioriti", "utili", "recogni", "summari", "speciali", "minimi", "maximi", "customi", "standardi", "finali", "reali", "categori", "mobili", "emphasi", "authori", "visuali", "digiti", "moderni", "capitali", "monetis", "synchroni", "criticis", "apologi"];
  const WORD_PAIRS = [["colour", "color"], ["colours", "colors"], ["behaviour", "behavior"], ["behaviours", "behaviors"], ["labour", "labor"], ["favour", "favor"], ["honour", "honor"], ["honours", "honors"], ["centre", "center"], ["centres", "centers"], ["modelling", "modeling"], ["modelled", "modeled"], ["travelled", "traveled"], ["travelling", "traveling"], ["labelled", "labeled"], ["cancelled", "canceled"], ["catalogue", "catalog"], ["defence", "defense"], ["enrolment", "enrollment"], ["fulfil", "fulfill"], ["maths", "math"], ["programme", "program"], ["licence", "license"], ["practise", "practice"], ["cheque", "check"], ["neighbour", "neighbor"], ["endeavour", "endeavor"], ["counselling", "counseling"]];
  function spellingIssues(text, variant) {
    const wantUS = variant === "en-US";
    const out = [];
    const re = new RegExp(`\\b(${IZ_STEMS.join("|")})([sz])(e|ed|es|ing|ation|ations|er|ers|able)\\b`, "gi");
    let m;
    while ((m = re.exec(text))) {
      const isZ = m[2].toLowerCase() === "z";
      if (isZ !== wantUS) {
        const fixed = m[1] + (wantUS ? (m[2] === "S" ? "Z" : "z") : (m[2] === "Z" ? "S" : "s")) + m[3];
        if (!(m[1].toLowerCase() === "analy" && /^(e|ed|es|ing)$/i.test(m[3]) === false && /ation/i.test(m[3]))) out.push({ word: m[0], fix: fixed });
      }
    }
    for (const [au, us] of WORD_PAIRS) {
      if (au === "programme" || au === "licence" || au === "practise" || au === "cheque") continue; // usage-dependent; don't auto-flag
      const wrong = wantUS ? au : us, right = wantUS ? us : au;
      const r = new RegExp(`\\b${wrong}\\b`, "gi");
      let x;
      while ((x = r.exec(text))) out.push({ word: x[0], fix: matchCase(x[0], right) });
    }
    return out;
  }
  function matchCase(src, word) {
    if (src === src.toUpperCase()) return word.toUpperCase();
    if (src[0] === src[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  /* ---------------- rewriting (never adds facts) ---------------- */
  const CONCISE = [
    [/\bin order to\b/gi, "to"], [/\bon a daily basis\b/gi, "daily"], [/\bon a weekly basis\b/gi, "weekly"], [/\bon a monthly basis\b/gi, "monthly"],
    [/\bon a regular basis\b/gi, "regularly"], [/\bdue to the fact that\b/gi, "because"], [/\ba large number of\b/gi, "many"],
    [/\b(?:was|were) able to\s+/gi, ""], [/\bsuccessfully\s+/gi, ""], [/\beffectively\s+/gi, ""], [/\b(?:very|really|basically|actually)\s+/gi, ""],
    [/\butili[sz](e|es)\b/gi, "use$1"], [/\butili[sz]ed\b/gi, "used"], [/\butili[sz]ing\b/gi, "using"], [/\bwith regards? to\b/gi, "on"],
    [/\bin a timely manner\b/gi, "promptly"], [/\bat this point in time\b/gi, "now"], [/,?\s*etc\.?(?=\s|$)/gi, ""], [/\bvarious\s+/gi, ""],
    [/\bthe majority of\b/gi, "most"], [/\bprior to\b/gi, "before"], [/\bin addition to\b/gi, "as well as"]
  ];
  const PROFESSIONAL = [
    [/\bkids\b/gi, "children"], [/\bguys\b/gi, "colleagues"], [/\bboss(es)?\b/gi, "manager$1"], [/\bthru\b/gi, "through"], [/\bw\/\s?/gi, "with "],
    [/\bdidn't\b/gi, "did not"], [/\bdon't\b/gi, "do not"], [/\bcan't\b/gi, "cannot"], [/\bwasn't\b/gi, "was not"], [/\bwon't\b/gi, "will not"],
    [/\bcouldn't\b/gi, "could not"], [/\bI'm\b/g, "I am"], [/\bI've\b/g, "I have"], [/\bit's\b/gi, "it is"], [/ & /g, " and "]
  ];
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  function verbAs(base, current, variant) { return current ? cap(base) : cap(past(base, variant)); }

  function fixVerbs(t, o) {
    let s = t;
    const pm = s.match(/^(i|we)\s+(?:have\s+|had\s+)?([a-z-]+)/i);
    if (pm && (PAST2BASE.has(pm[2].toLowerCase()) || BASESET.has(pm[2].toLowerCase()) || /^(was|am|helped|worked|dealt|did)$/i.test(pm[2]))) s = s.replace(/^(i|we)\s+(have\s+|had\s+)?/i, "");
    s = cap(s);
    let m;
    if ((m = s.match(/^(?:was\s+|am\s+)?responsible\s+for\s+([a-z-]+ing)\b\s*/i)) && baseOfGerund(m[1])) return verbAs(baseOfGerund(m[1]), o.current, o.variant) + " " + s.slice(m[0].length);
    if ((m = s.match(/^(?:was\s+|am\s+)?responsible\s+for\s+/i))) return (o.current ? "Manage " : "Managed ") + s.slice(m[0].length);
    if ((m = s.match(/^(?:my\s+)?(?:main\s+|key\s+)?(?:duties|tasks|responsibilities)\s+(?:included|include|were|involved):?\s*/i))) {
      const rest = s.slice(m[0].length); const g = rest.match(/^([a-z-]+ing)\b/i);
      return g && baseOfGerund(g[1]) ? verbAs(baseOfGerund(g[1]), o.current, o.variant) + rest.slice(g[1].length) : cap(rest);
    }
    if ((m = s.match(/^(?:was\s+)?(?:in\s+charge\s+of|tasked\s+with)\s+([a-z-]+ing)\b/i)) && baseOfGerund(m[1])) return verbAs(baseOfGerund(m[1]), o.current, o.variant) + s.slice(m[0].length);
    if ((m = s.match(/^(?:was\s+)?in\s+charge\s+of\s+/i))) return (o.current ? "Lead " : "Led ") + s.slice(m[0].length);
    if ((m = s.match(/^worked\s+(?:as\s+an?\s+[^,]+?\s+)?(at|in|for)\s+(.+?),?\s+and\s+(.+)$/i))) {
      const clause = fixVerbs(m[3], o).replace(/[.\s]+$/, "");
      return `${clause} ${m[1].toLowerCase()} ${m[2]}${/\.$/.test(s) ? "." : ""}`;
    }
    if ((m = s.match(/^helped\s+(?:to\s+)?([a-z-]+)\b/i))) {
      const w = m[1].toLowerCase();
      if (BASESET.has(w) && !/^(customers?|clients?|staff|students?|the|a|an|with|out)$/.test(w)) return (o.current ? "Assist with " : "Assisted with ") + gerund(w) + s.slice(m[0].length);
      if (w === "with") return (o.current ? "Assist with" : "Assisted with") + s.slice(m[0].length);
      if (w === "out") return (o.current ? "Assist" : "Assisted") + s.slice(m[0].length).replace(/^\s+with\b/i, " with");
      return (o.current ? "Assist " : "Assisted ") + s.slice("helped ".length);
    }
    if ((m = s.match(/^worked\s+on\s+/i))) return (o.current ? "Contribute to " : "Contributed to ") + s.slice(m[0].length);
    if ((m = s.match(/^worked\s+with\s+/i))) return (o.current ? "Collaborate with " : "Collaborated with ") + s.slice(m[0].length);
    if ((m = s.match(/^(?:participated|was\s+involved|involved)\s+in\s+/i))) return (o.current ? "Contribute to " : "Contributed to ") + s.slice(m[0].length);
    if ((m = s.match(/^dealt\s+with\s+/i))) return (o.current ? "Handle " : "Handled ") + s.slice(m[0].length);
    if ((m = s.match(/^did\s+/i))) return (o.current ? "Complete " : "Completed ") + s.slice(m[0].length);
    const g = s.match(/^([A-Za-z-]+ing)\b/);
    if (g && baseOfGerund(g[1])) return verbAs(baseOfGerund(g[1]), o.current, o.variant) + s.slice(g[1].length);
    return s;
  }
  function fixGrammar(t, o) {
    let s = t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/,(?=[A-Za-z])/g, ", ").replace(/\.{2,}$/g, ".")
      .replace(/\b(\w+)\s+\1\b/gi, (all, w) => /^(that|had|is)$/i.test(w) ? all : w).replace(/(^|\s)i(\s|'|$)/g, "$1I$2");
    s = cap(s.trim());
    if (o.period === true && !/[.!?]$/.test(s)) s += ".";
    if (o.period === false) s = s.replace(/\.$/, "");
    return s;
  }
  function fixSpelling(t, o) {
    let s = t;
    for (const x of spellingIssues(t, o.variant)) s = s.replace(new RegExp(`\\b${x.word}\\b`), x.fix);
    return s;
  }
  function apply(t, list) { let s = t; for (const [re, rep] of list) s = s.replace(re, rep); return s.replace(/\s{2,}/g, " ").trim(); }
  function readability(t) {
    const words = t.split(/\s+/).length;
    if (words <= 32) return t;
    if (/;\s/.test(t)) return t.split(/;\s+/).map(cap).join(". ").replace(/\.\./g, ".");
    const i = t.search(/,\s+(?:and|while|which)\s+/i);
    if (i > 40) return t.slice(0, i) + ". " + cap(t.slice(i).replace(/^,\s+(?:and|while|which)\s+/i, ""));
    return t;
  }
  const ACTIONS = {
    improve: ["verbs", "concise", "professional", "grammar", "spelling"],
    tidy: ["concise", "professional", "grammar", "spelling"],
    concise: ["concise", "grammar"],
    professional: ["professional", "verbs", "grammar"],
    verbs: ["verbs", "grammar"],
    grammar: ["grammar", "spelling"],
    readability: ["readability", "concise", "grammar"]
  };
  /* Rewrite one line. Returns { text, changed, notes } — never introduces new numbers. */
  function rewrite(text, action, o = {}) {
    const steps = ACTIONS[action] || ACTIONS.improve;
    const opts = { variant: o.variant || "en-AU", current: !!o.current, period: o.period };
    let s = String(text).trim();
    const notes = [];
    for (const step of steps) {
      const before = s;
      if (step === "verbs") s = fixVerbs(s, opts);
      if (step === "concise") s = apply(s, CONCISE);
      if (step === "professional") s = apply(s, PROFESSIONAL);
      if (step === "grammar") s = fixGrammar(s, opts);
      if (step === "spelling") s = fixSpelling(s, opts);
      if (step === "readability") s = readability(s);
      if (s !== before) notes.push(step);
    }
    if (!newNumbers(text, s).ok) s = text; // safety: never add a figure
    return { text: s, changed: s.trim() !== String(text).trim(), notes };
  }
  function numbersIn(s) { return (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map(n => n.replace(/,/g, "")); }
  function newNumbers(before, after) {
    const have = numbersIn(before); const pool = [...have];
    const added = [];
    for (const n of numbersIn(after)) { const i = pool.indexOf(n); if (i >= 0) pool.splice(i, 1); else if (!have.includes(n)) added.push(n); }
    return { ok: added.length === 0, added };
  }

  /* Ask for a figure instead of inventing one. */
  function metricQuestion(text) {
    const t = text.toLowerCase();
    if (/customer|client|guest|patient|caller/.test(t)) return "How many customers or clients did you typically deal with per shift or week?";
    if (/increas|improv|grew|boost|raise/.test(t)) return "By how much did it increase or improve (%, $ or time), and over what period?";
    if (/reduc|cut|sav|lower|decreas|faster/.test(t)) return "By how much was it reduced or how much time/money was saved?";
    if (/team|staff|volunteer|members|students|people/.test(t)) return "How many people were involved, or how many did you lead or train?";
    if (/event|workshop|session|open house|inspection/.test(t)) return "How many events did you run, or how many people attended?";
    if (/report|model|reconcil|invoice|transaction|account|file|case/.test(t)) return "How many (reports, models, accounts, cases) did you handle, how often, or of what value?";
    if (/sale|sold|revenue|budget|fund/.test(t)) return "What was the dollar value or the target you met?";
    if (/project|design|build|develop/.test(t)) return "What was the size, budget, timeframe or result of the project?";
    return "Can you add a figure — how many, how often, how much or how long?";
  }
  function withMetric(text, answer) {
    const a = String(answer || "").trim();
    if (!a) return text;
    return text.replace(/[.\s]+$/, "") + ` (${a.replace(/^\(|\)$/g, "")})` + (/\.$/.test(text) ? "." : "");
  }

  /* Is the extracted text good enough to score? */
  function checkText(raw) {
    const t = String(raw || "");
    const words = wordsOf(t).length;
    const garbage = (t.match(/[\uFFFD\u0000-\u0008]|\(cid:\d+\)/g) || []).length;
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    if (garbage > 20 || (garbage && garbage > words / 4)) return { ok: false, reason: "garbled", words, message: "The text in this file came out garbled. This usually means the PDF uses unusual fonts or is a scanned image. Export a fresh PDF from Word or Google Docs, or upload the .docx." };
    if (words < 40 || letters < 200) return { ok: false, reason: "short", words, message: words < 5 ? "We couldn't find any text in this file. It's probably a scanned image. Upload a text-based PDF (exported from Word or Google Docs) or a .docx file." : `We only found ${words} words, which isn't enough to score reliably. If this is a scanned PDF, upload a text-based PDF or a .docx instead.` };
    return { ok: true, words };
  }

  /* ---------------- analysis ---------------- */
  const wordsOf = s => (String(s).match(/[A-Za-z][A-Za-z'’-]*/g) || []);
  const isQuantified = s => { const t = String(s).replace(DATE_RE, " "); DATE_RE.lastIndex = 0; return /\d|%|\$/.test(t) || NUM_WORDS.test(t); };
  function hits(text, list) {
    const low = " " + text.toLowerCase().replace(/[^a-z0-9+#&/ ]+/g, " ").replace(/\s+/g, " ") + " ";
    return list.filter(k => low.includes(" " + k + " "));
  }
  function dateFormats(text) {
    const kinds = new Set();
    const re = new RegExp(`\\b(${MONTH})\\s+(?:19|20)\\d{2}\\b|\\b(?:19|20)\\d{2}\\s+(${MONTH})(?![a-z])|\\b(?:0?[1-9]|1[0-2])\\/(?:19|20)\\d{2}\\b`, "gi");
    let m;
    while ((m = re.exec(text))) {
      if (m[2]) kinds.add("YYYY Mon");
      else if (m[1]) kinds.add(m[1].replace(/\.$/, "").length <= 4 && !/^(may|june|july)$/i.test(m[1]) ? "Mon YYYY" : "Month YYYY");
      else kinds.add("MM/YYYY");
    }
    return kinds;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r1 = v => Math.round(v * 2) / 2;
  const short = (s, n = 90) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  function analyse(doc, o = {}) {
    const mode = o.mode === "experienced" ? "experienced" : "graduate";
    const variant = o.variant || "en-AU";
    const items = allItems(doc);
    const fullText = toText(doc);
    const wordCount = (fullText.match(/\S+/g) || []).filter(w => /[A-Za-z0-9]/.test(w)).length;
    const secOf = type => doc.sections.filter(s => s.type === type);
    const has = type => secOf(type).some(s => s.items.length);
    const expTypes = mode === "graduate" ? ["experience", "projects", "leadership"] : ["experience"];
    const expSections = doc.sections.filter(s => (mode === "graduate" ? EXP_TYPES : new Set(["experience"])).has(s.type));
    const expLines = expSections.flatMap(s => s.items.filter(i => i.kind === "bullet" || i.kind === "statement").map(i => ({ item: i, section: s })));
    const bulletsAll = items.filter(x => x.item.bullet);
    const findings = [], suggestions = [], strengths = [];
    const cats = Object.fromEntries(CATEGORIES.map(c => [c.key, { ...c, score: 0, reasons: [] }]));
    const add = (k, pts, text, sign) => { cats[k].score += pts; cats[k].reasons.push({ sign: sign ?? (pts > 0 ? 1 : -1), text }); };
    const finding = f => { f.id = f.id || nid("f"); findings.push(f); return f; };
    const loc = x => x ? (x.section ? x.section.title : "Header / contact details") : "Whole CV";
    const header = doc.header.map(h => h.text).join("\n");
    const email = (fullText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || "";
    const phone = (fullText.match(/(?:\+?61\s?|\(?0)[2-478]\)?[\s-]?\d{2,4}[\s-]?\d{3}[\s-]?\d{3}|\b04\d{2}\s?\d{3}\s?\d{3}\b/) || [])[0] || "";
    const linkedin = /linkedin\.com\/in\//i.test(fullText);

    /* ===== 1. Experience and achievements (25) ===== */
    const nExp = expLines.length;
    const vi = expLines.map(x => ({ ...x, v: verbInfo(x.item.text) }));
    const strong = vi.filter(x => x.v.verb && !x.v.weak);
    const weak = vi.filter(x => x.v.weak);
    const quant = expLines.filter(x => isQuantified(x.item.text));
    const impact = expLines.filter(x => IMPACT_RE.test(x.item.text));
    if (expSections.some(s => s.items.length)) add("experience", 5, mode === "graduate" ? `Has an experience-type section (${expSections.map(s => s.title).join(", ")}).` : `Has a work experience section.`);
    else {
      add("experience", 0, mode === "graduate" ? "No experience, projects or leadership section found." : "No work experience section found.", -1);
      finding({ category: "experience", severity: "High", kind: "objective", impact: 8, title: mode === "graduate" ? "No experience, projects or involvement section" : "No work experience section",
        location: "Missing section", original: "", why: "Recruiters look for evidence of what you've done. Without it, the CV relies on your education alone.",
        recommendation: mode === "graduate" ? "Add a section for part-time work, internships, uni projects, volunteering or club roles — any of these count for students." : "Add a 'Work Experience' section with each role, employer, dates and 3–5 bullet points.",
        example: "", needsFacts: true, question: "What jobs, projects, volunteering or club roles have you done?" });
    }
    if (nExp) {
      const vr = strong.length / nExp;
      const vp = r1(6 * clamp(vr / 0.8, 0, 1));
      add("experience", vp, `${strong.length} of ${nExp} experience bullet points start with an action verb.`, vr >= 0.6 ? 1 : -1);
      const target = mode === "graduate" ? 0.25 : 0.4;
      const qr = quant.length / nExp;
      add("experience", r1(6 * clamp(qr / target, 0, 1)), `${quant.length} of ${nExp} bullet points include a number, amount or frequency.`, qr >= target ? 1 : -1);
      const ir = impact.length / nExp;
      add("experience", r1(4 * clamp(ir / 0.3, 0, 1)), `${impact.length} of ${nExp} bullet points describe a result or outcome.`, ir >= 0.3 ? 1 : -1);
      const wp = clamp(4 - weak.length, 0, 4);
      add("experience", wp, weak.length ? `${weak.length} bullet point${weak.length > 1 ? "s" : ""} describe duties ("responsible for", "helped", "worked on") rather than actions.` : "No duty-style openers like \"responsible for\".", weak.length ? -1 : 1);
    } else if (expSections.some(s => s.items.length)) {
      add("experience", 0, "Experience section has role titles but no bullet points describing what you did.", -1);
      finding({ category: "experience", severity: "High", kind: "objective", impact: 10, title: "Roles have no description", location: expSections[0].title,
        original: short(expSections[0].items[0].text), itemId: expSections[0].items[0].id, why: "A title and dates alone don't show what you did or how well.",
        recommendation: "Under each role, add 2–5 bullet points that start with an action verb and describe tasks and results.", example: "", needsFacts: true,
        question: "For each role: what did you do day to day, what did you improve, and who did you work with?" });
    }
    if (weak.length) {
      const first = weak[0];
      const rw = rewrite(first.item.text, "verbs", { variant, current: first.item.current });
      finding({ category: "experience", severity: weak.length >= 3 ? "High" : "Medium", kind: "objective", impact: Math.min(4, weak.length) + 1,
        title: "Bullet points describe duties, not actions", location: `${first.section.title}${weak.length > 1 ? ` (and ${weak.length - 1} more)` : ""}`,
        original: first.item.text, itemId: first.item.id, why: "Openers like \"responsible for\" or \"helped\" hide what you actually did. Recruiters skim the first two or three words of each line.",
        recommendation: "Start each bullet point with a specific action verb (Prepared, Reconciled, Coordinated, Designed).", example: rw.changed ? rw.text : "", needsFacts: false });
    }
    const unq = expLines.filter(x => !isQuantified(x.item.text) && verbInfo(x.item.text).verb && !/\[/.test(x.item.text));
    if (nExp && quant.length / nExp < (mode === "graduate" ? 0.25 : 0.4) && unq.length) {
      const first = unq[0];
      finding({ category: "experience", severity: "Medium", kind: "subjective", impact: 3, title: "Few results or figures", location: `${first.section.title}`,
        original: first.item.text, itemId: first.item.id, why: "Numbers (how many, how often, how much) make claims concrete and easier to believe.",
        recommendation: "Where you genuinely know a figure, add it. Don't estimate figures you can't back up in an interview.", example: "", needsFacts: true, question: metricQuestion(first.item.text), metric: true });
    }
    const gerunds = vi.filter(x => x.v.form === "gerund" && !x.item.current);
    if (gerunds.length >= 2) {
      const g = gerunds[0];
      const rw = rewrite(g.item.text, "verbs", { variant, current: false });
      finding({ category: "writing", severity: "Low", kind: "objective", impact: 1, title: "Bullet points start with -ing words", location: `${g.section.title}${gerunds.length > 1 ? ` (and ${gerunds.length - 1} more)` : ""}`,
        original: g.item.text, itemId: g.item.id, why: "Past roles read most clearly in the past tense (\"Prepared\", not \"Preparing\").", recommendation: "Use past tense for finished roles and present tense for your current role.",
        example: rw.changed ? rw.text : "", needsFacts: false });
    }

    /* ===== 2. Writing quality (20) ===== */
    const proseItems = items.filter(x => x.section && x.section.type !== "skills" && x.section.type !== "references" && wordsOf(x.item.text).length >= 3);
    const vagueHits = [];
    for (const x of proseItems) { const m = x.item.text.match(VAGUE_RE); if (m) vagueHits.push({ x, words: [...new Set(m.map(w => w.toLowerCase()))] }); }
    const vagueCount = vagueHits.reduce((a, b) => a + b.words.length, 0);
    add("writing", clamp(5 - vagueCount, 0, 5), vagueCount ? `${vagueCount} vague or cliché phrase${vagueCount > 1 ? "s" : ""} (e.g. "${vagueHits[0].words[0]}").` : "No vague filler phrases like \"hard-working team player\".", vagueCount ? -1 : 1);
    if (vagueHits.length) {
      const v = vagueHits[0];
      const rw = rewrite(v.x.item.text, "concise", { variant });
      finding({ category: "writing", severity: vagueCount >= 3 ? "Medium" : "Low", kind: "subjective", impact: Math.min(3, vagueCount),
        title: "Vague or cliché wording", location: `${loc(v.x)}${vagueHits.length > 1 ? ` (and ${vagueHits.length - 1} more)` : ""}`, original: v.x.item.text, itemId: v.x.item.id,
        why: `Words like "${v.words.join("\", \"")}" are used on most CVs, so they don't tell the reader anything about you.`,
        recommendation: "Replace claims about yourself with a short example that shows the quality.", example: rw.changed && rw.text !== v.x.item.text ? rw.text : "", needsFacts: !rw.changed,
        question: rw.changed ? "" : "What's one specific example that shows this quality?" });
    }
    const lens = expLines.map(x => wordsOf(x.item.text).length);
    const longOnes = expLines.filter((x, i) => lens[i] > 32), shortOnes = expLines.filter((x, i) => lens[i] < 4);
    if (lens.length) {
      const okR = (lens.length - longOnes.length - shortOnes.length) / lens.length;
      add("writing", r1(5 * okR), `${lens.length - longOnes.length - shortOnes.length} of ${lens.length} bullet points are a readable length (4–32 words).`, okR >= 0.8 ? 1 : -1);
    } else add("writing", 2, "Not enough bullet points to judge length.", -1);
    if (longOnes.length) {
      const l = longOnes[0]; const rw = rewrite(l.item.text, "readability", { variant });
      finding({ category: "writing", severity: "Low", kind: "objective", impact: 1, title: "Long bullet points", location: `${l.section.title}${longOnes.length > 1 ? ` (and ${longOnes.length - 1} more)` : ""}`,
        original: l.item.text, itemId: l.item.id, why: "Bullet points over about 30 words are hard to skim.", recommendation: "Keep each bullet point to one idea, or split it into two.",
        example: rw.changed ? rw.text : "", needsFacts: false });
    }
    const opens = {};
    for (const x of vi) if (x.v.word) (opens[x.v.word] = opens[x.v.word] || []).push(x);
    const repeated = Object.entries(opens).filter(([w, l]) => l.length >= 3 && !/^(and|the|a)$/.test(w));
    add("writing", clamp(4 - repeated.length * 2, 0, 4), repeated.length ? `"${cap(repeated[0][0])}" starts ${repeated[0][1].length} bullet points.` : "Bullet points use varied opening verbs.", repeated.length ? -1 : 1);
    if (repeated.length) {
      const [w, l] = repeated[0];
      finding({ category: "writing", severity: "Low", kind: "subjective", impact: 2, title: `"${cap(w)}" is repeated`, location: `${l.length} bullet points`, original: l[1].item.text, itemId: l[1].item.id,
        why: "Repeating the same verb makes different tasks sound the same.", recommendation: `Vary the verb to match the task — e.g. Prepared, Reconciled, Coordinated, Presented, Analysed — without changing what you did.`, example: "", needsFacts: false });
    }
    const pron = items.filter(x => x.section && (x.item.bullet || x.item.kind === "statement") && /^(i|my|we)\b|\s(i|my|me)\s/i.test(x.item.text));
    add("writing", clamp(3 - pron.length, 0, 3), pron.length ? `${pron.length} bullet point${pron.length > 1 ? "s" : ""} use "I", "me" or "my".` : "Bullet points avoid \"I\" and \"my\".", pron.length ? -1 : 1);
    if (pron.length) {
      const p = pron[0]; const rw = rewrite(p.item.text, "verbs", { variant, current: p.item.current });
      finding({ category: "writing", severity: "Low", kind: "objective", impact: 1, title: "First person in bullet points", location: loc(p), original: p.item.text, itemId: p.item.id,
        why: "Australian CVs normally drop \"I\" in bullet points; it's implied.", recommendation: "Start the bullet point with the verb.", example: rw.changed ? rw.text : "", needsFacts: false });
    }
    const gram = [];
    for (const x of items) {
      const t = x.item.text;
      const issues = [];
      const layoutLine = x.item.kind === "entry" || /(?:19|20)\d{2}/.test(t);
      if (/\S {2,3}(?! )\S/.test(t) && !layoutLine && !/\S {4,}\S/.test(t)) issues.push("double space");
      if (x.item.bullet && /^[a-z]/.test(t)) issues.push("starts with a lowercase letter");
      const rep = t.match(/\b(\w{2,})\s+\1\b/i); if (rep && !/^(that|had)$/i.test(rep[1])) issues.push(`repeated word "${rep[1]}"`);
      if (/\s[,.;:](?!\d)/.test(t)) issues.push("space before punctuation");
      if (/,[A-Za-z]/.test(t) && !/\S+@\S+/.test(t)) issues.push("missing space after a comma");
      if (/(^|\s)i(\s|')/.test(t)) issues.push('lowercase "i"');
      if (issues.length) gram.push({ x, issues });
    }
    const spell = spellingIssues(fullText, variant);
    add("writing", clamp(3 - Math.ceil((gram.length + spell.length) / 2), 0, 3), gram.length + spell.length ? `${gram.length} line${gram.length === 1 ? "" : "s"} with grammar or spacing issues; ${spell.length} spelling${spell.length === 1 ? "" : "s"} not in ${variantName(variant)}.` : `No grammar, spacing or ${variantName(variant)} spelling issues found.`, gram.length + spell.length ? -1 : 1);
    if (gram.length) {
      const g = gram[0]; const rw = rewrite(g.x.item.text, "grammar", { variant });
      finding({ category: "writing", severity: gram.length >= 4 ? "Medium" : "Low", kind: "objective", impact: 1, title: "Grammar and spacing", location: `${loc(g.x)}${gram.length > 1 ? ` (and ${gram.length - 1} more lines)` : ""}`,
        original: g.x.item.text, itemId: g.x.item.id, why: `Found: ${g.issues.join(", ")}. Small errors suggest a lack of attention to detail — a common reason CVs are set aside.`,
        recommendation: "Fix each flagged line. Use 'Correct grammar' in the editor to tidy them.", example: rw.changed ? rw.text : "", needsFacts: false });
    }
    if (spell.length) {
      const uniq = [...new Map(spell.map(s => [s.word.toLowerCase(), s])).values()];
      const it = items.find(x => new RegExp(`\\b${uniq[0].word}\\b`).test(x.item.text));
      finding({ category: "writing", severity: "Low", kind: "objective", impact: 1, title: `Spelling isn't ${variantName(variant)}`, location: it ? loc(it) : "Whole CV",
        original: it ? it.item.text : uniq[0].word, itemId: it ? it.item.id : null, why: `${uniq.slice(0, 5).map(s => `"${s.word}" → "${s.fix}"`).join(", ")}. Perth employers expect Australian spelling.`,
        recommendation: `Switch to ${variantName(variant)} spelling throughout (you can change the variant in Settings).`, example: it ? rewrite(it.item.text, "grammar", { variant }).text : "", needsFacts: false });
    }

    /* ===== 3. Structure (15) ===== */
    const contactOk = !!(email || phone);
    const essentials = [["Contact details", contactOk], ["Education", has("education")], [mode === "graduate" ? "Experience, projects or involvement" : "Work experience", expSections.some(s => s.items.length)], ["Skills", has("skills")]];
    for (const [name, ok] of essentials) add("structure", ok ? 2 : 0, `${name}: ${ok ? "present" : "missing"}.`, ok ? 1 : -1);
    for (const [name, ok] of essentials) if (!ok && name !== essentials[2][0]) finding({ category: "structure", severity: name === "Skills" ? "Medium" : "High", kind: "objective", impact: 2,
      title: name === "Contact details" ? "No contact details found" : `No ${name} section found`, location: "Missing section", original: "", why: name === "Contact details" ? "Employers can't reach you, and applicant tracking systems may reject the CV." : `Recruiters and ATS software expect a clear ${name} section. If it's already in your CV, give it a standard heading on its own line so it's recognised.`,
      recommendation: name === "Contact details" ? "Put your name, mobile, email, LinkedIn URL and suburb (e.g. Perth WA) at the top." : name === "Education" ? "Add your degree, university, expected completion date and major(s); add your WAM/GPA if it helps." : "Add a Skills section listing specific tools and skills you can back up with an example.",
      example: "", needsFacts: true, question: name === "Contact details" ? "What email address and phone number should employers use?" : name === "Education" ? "What are you studying, where, and when do you finish?" : "Which tools or technical skills have you used (e.g. Excel, Python, AutoCAD, Xero)?" });
    const iEdu = doc.sections.findIndex(s => s.type === "education"), iExp = doc.sections.findIndex(s => s.type === "experience");
    if (mode === "experienced" && iEdu >= 0 && iExp >= 0 && iEdu < iExp) {
      add("structure", 0, "Education appears before work experience.", -1);
      finding({ category: "structure", severity: "Low", kind: "subjective", impact: 2, title: "Education comes before experience", location: doc.sections[iEdu].title, original: "", why: "For experienced applicants, recent work is usually the strongest evidence.", recommendation: "Move Work Experience above Education.", example: "", needsFacts: false });
    } else add("structure", 2, mode === "graduate" ? "Section order suits a student or graduate CV." : "Sections are in a sensible order.");
    let lp = wordCount < 120 ? 0.5 : wordCount < 200 ? 2 : wordCount <= 900 ? 3 : wordCount <= 1200 ? 2 : 1;
    add("structure", lp, `About ${wordCount} words (${wordCount < 200 ? "short" : wordCount <= 900 ? "about 1–2 pages" : "long"}).`, lp >= 3 ? 1 : -1);
    if (wordCount < 200) finding({ category: "structure", severity: wordCount < 120 ? "High" : "Medium", kind: "subjective", impact: 3 - lp, title: "The CV is short", location: "Whole CV", original: "", why: "There's little evidence for a recruiter to assess.", recommendation: "Add bullet points for each role and project, and a skills section. Aim for a full page.", example: "", needsFacts: true, question: "What else have you done — part-time jobs, uni projects, clubs, volunteering, awards?" });
    if (wordCount > 1200) finding({ category: "structure", severity: "Medium", kind: "subjective", impact: 3 - lp, title: "The CV is long", location: "Whole CV", original: "", why: "Most Perth student and graduate CVs are 1–2 pages; recruiters skim.", recommendation: "Cut older or less relevant bullet points and keep 3–5 per role.", example: "", needsFacts: false });
    const expAll = expSections.flatMap(s => s.items.filter(i => i.kind !== "entry"));
    const bulletShare = expAll.length ? expAll.filter(i => i.bullet).length / expAll.length : 0;
    add("structure", expAll.length ? r1(2 * bulletShare) : 0, expAll.length ? `${Math.round(bulletShare * 100)}% of experience descriptions are bullet points.` : "No experience descriptions to check.", bulletShare >= 0.7 ? 1 : -1);
    const stmts = expLines.filter(x => x.item.kind === "statement");
    if (stmts.length >= 2 && bulletShare < 0.7) finding({ category: "structure", severity: "Medium", kind: "objective", impact: 2, title: "Experience written as paragraphs", location: stmts[0].section.title, original: stmts[0].item.text, itemId: stmts[0].item.id,
      why: "Paragraphs are slow to skim and harder for ATS software to split into achievements.", recommendation: "Break each role's description into 3–5 bullet points, one idea each.", example: "", needsFacts: false });

    /* ===== 4. ATS (15) ===== */
    const known = doc.sections.filter(s => s.type !== "other").length, totalH = doc.sections.length;
    const hr = totalH ? known / totalH : 0;
    add("ats", r1(4 * hr), totalH ? `${known} of ${totalH} section headings are standard names ATS software recognises.` : "No section headings detected.", hr >= 0.8 ? 1 : -1);
    if (!totalH) finding({ category: "ats", severity: "High", kind: "objective", impact: 4, title: "No section headings detected", location: "Whole CV", original: "", why: "ATS software uses headings like Education and Experience to sort your CV. Without them, information can be misfiled or missed.", recommendation: "Use standard headings on their own lines: Profile, Education, Experience, Skills, Leadership & Volunteering.", example: "", needsFacts: false });
    else if (hr < 0.8) { const odd = doc.sections.filter(s => s.type === "other"); finding({ category: "ats", severity: "Low", kind: "objective", impact: 1, title: "Non-standard headings", location: odd.map(s => s.title).join(", "), original: odd[0].title, why: "Creative headings may not be recognised by ATS software.", recommendation: "Rename them to standard headings (e.g. Experience, Projects, Skills).", example: "", needsFacts: false }); }
    add("ats", (email ? 2 : 0) + (phone ? 1 : 0), `Email ${email ? "found" : "not found"}; phone ${phone ? "found" : "not found"}.`, email && phone ? 1 : -1);
    if (contactOk && (!email || !phone)) finding({ category: "ats", severity: "Medium", kind: "objective", impact: 1, title: `No ${!email ? "email address" : "phone number"} found`, location: "Header / contact details", original: header.split("\n")[0] || "", why: "Recruiters need both to contact you, and ATS forms read them from the CV.", recommendation: `Add your ${!email ? "email address" : "mobile number"} in plain text at the top.`, example: "", needsFacts: true, question: !email ? "What email address should employers use?" : "What's your mobile number?" });
    const lines = fullText.split("\n");
    const odd = (fullText.match(/[�\u0000-\u0008]|\(cid:\d+\)/g) || []).length;
    const pipes = (fullText.match(/\|/g) || []).length;
    const columnish = items.filter(x => x.item.kind !== "entry" && /\S {3,}\S/.test(x.item.text) && !/(?:19|20)\d{2}|present|current/i.test(x.item.text)).length;
    const art = odd + (pipes > 6 ? 1 : 0) + (columnish / Math.max(1, items.length) > 0.15 ? 1 : 0);
    add("ats", clamp(3 - art, 0, 3), art ? "Some text came out jumbled or in columns, which suggests tables, text boxes or unusual fonts." : "Text extracted cleanly (no table or column artefacts).", art ? -1 : 1);
    if (art) finding({ category: "ats", severity: "Medium", kind: "objective", impact: art, title: "Layout may confuse ATS software", location: "Whole CV", original: (lines.find(l => /\S {3,}\S|\||�|\(cid:/.test(l)) || "").trim().slice(0, 120),
      why: "Tables, columns, text boxes and icons are often read out of order or dropped by applicant tracking systems.", recommendation: "Use a single-column layout with plain text headings and standard bullet points. The templates on the Download tab are ATS-friendly.", example: "", needsFacts: false });
    const dates = (fullText.match(DATE_RE) || []).length; DATE_RE.lastIndex = 0;
    const fmts = dateFormats(fullText);
    const dp = (dates >= 2 ? 2 : dates ? 1 : 0) + (fmts.size <= 1 ? 1 : 0);
    add("ats", dp, dates ? `${dates} dates found${fmts.size > 1 ? `, in ${fmts.size} formats (${[...fmts].join(", ")})` : ""}.` : "No dates found for education or roles.", dp >= 3 ? 1 : -1);
    if (!dates) finding({ category: "ats", severity: "Medium", kind: "objective", impact: 2, title: "No dates", location: "Education and experience", original: "", why: "Recruiters and ATS software use dates to work out how recent and how long each role was.", recommendation: "Add month and year for each role and your expected graduation date (e.g. Mar 2024 – Present).", example: "", needsFacts: true, question: "When did each role start and finish, and when do you graduate?" });
    const longLine = lines.some(l => l.length > 400 && /\S {4,}\S/.test(l));
    const ep = (wordCount >= 120 ? 1 : 0) + (longLine ? 0 : 1);
    add("ats", ep, longLine ? "Some lines are very long, which suggests text from columns was merged." : wordCount >= 120 ? "Enough text was extracted to read the CV reliably." : "Very little text was extracted.", ep === 2 ? 1 : -1);

    /* ===== 5. Relevance and targeting (15) ===== */
    const sumSec = secOf("summary").find(s => s.items.length);
    const sumText = sumSec ? sumSec.items.map(i => i.text).join(" ") : "";
    const fieldCounts = Object.fromEntries(Object.entries(FIELDS).map(([k, re]) => [k, (fullText.match(re) || []).length]));
    const fieldTotal = Object.values(fieldCounts).reduce((a, b) => a + b, 0);
    const topField = Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])[0];
    const specificSummary = sumText && (Object.values(FIELDS).some(re => { re.lastIndex = 0; const r = re.test(sumText); re.lastIndex = 0; return r; }) || /\b(intern\w*|graduate|role|position|vacation)\b/i.test(sumText));
    if (sumText && wordsOf(sumText).length >= 12) add("relevance", specificSummary ? 4 : 2, specificSummary ? "Has a profile that names a field or target role." : "Has a profile, but it doesn't say what role or field you're targeting.", specificSummary ? 1 : -1);
    else add("relevance", 1, sumText ? "Profile is very short." : "No profile or career objective.", -1);
    if (!sumText) finding({ category: "relevance", severity: "Medium", kind: "subjective", impact: 3, title: "No profile or career objective", location: "Missing section", original: "", why: "Two or three lines at the top tell the reader what you're studying, what you're good at and what role you want.",
      recommendation: "Add a short profile built only from what's already in your CV. Use 'Write my profile' on the Improve tab for a draft.", example: summaryDraft(doc, { mode }), needsFacts: false, kind2: "summary" });
    else if (!specificSummary) finding({ category: "relevance", severity: "Low", kind: "subjective", impact: 2, title: "Profile doesn't name a target", location: sumSec.title, original: sumText, itemId: sumSec.items[0].id, why: "A generic profile could be anyone's.", recommendation: "Name your degree and the kind of role you want (e.g. 'seeking a 2027 audit vacation program').", example: "", needsFacts: true, question: "What kind of role are you applying for?" });
    const skillSecs = secOf("skills");
    const skillText = skillSecs.flatMap(s => s.items.map(i => i.text)).join(", ");
    const hard = [...new Set(hits(skillText, HARD_SKILLS))];
    const soft = [...new Set(hits(skillText, SOFT_SKILLS))];
    const sp = hard.length >= 6 ? 4 : hard.length >= 4 ? 3 : hard.length >= 2 ? 2 : hard.length ? 1 : 0;
    add("relevance", sp, skillText ? `${hard.length} specific tools or technical skills listed${soft.length ? `, plus ${soft.length} soft skills` : ""}.` : "No skills listed.", sp >= 3 ? 1 : -1);
    if (skillText && hard.length < 3) finding({ category: "relevance", severity: "Medium", kind: "subjective", impact: 4 - sp, title: "Skills are mostly general", location: skillSecs[0].title, original: short(skillText, 140), itemId: skillSecs[0].items[0] && skillSecs[0].items[0].id,
      why: "Soft skills like \"communication\" are hard to verify from a list. Specific tools (Excel, Xero, Python, AutoCAD) are what recruiters and ATS filters search for.", recommendation: "List the specific software and techniques you've actually used, and show soft skills through your bullet points instead.", example: "", needsFacts: true, question: "Which software or technical skills have you used at work, uni or in projects?" });
    const restText = doc.sections.filter(s => s.type !== "skills").flatMap(s => s.items.map(i => i.text)).join(" ");
    const evidenced = hard.filter(k => hits(restText, [k]).length);
    const ep2 = hard.length ? r1(4 * evidenced.length / hard.length) : 0;
    add("relevance", ep2, hard.length ? `${evidenced.length} of ${hard.length} listed technical skills are backed up elsewhere in the CV.` : "No listed skills to check.", hard.length && evidenced.length / hard.length >= 0.5 ? 1 : -1);
    const unbacked = hard.filter(k => !evidenced.includes(k));
    if (hard.length && unbacked.length >= 2) finding({ category: "relevance", severity: "Low", kind: "subjective", impact: 2, title: "Skills not shown in your experience", location: skillSecs[0].title, original: unbacked.slice(0, 6).join(", "),
      why: "A skill in a list carries more weight when a bullet point shows you using it.", recommendation: `Where it's true, mention ${unbacked.slice(0, 3).join(", ")} in the bullet point where you used it.`, example: "", needsFacts: true, question: `Where have you used ${unbacked[0]}?` });
    const unlisted = [...new Set(hits(restText, HARD_SKILLS))].filter(k => !hard.includes(k) && !["sales", "research", "customer service", "accounting", "real estate"].includes(k) && !hard.some(h => h.includes(k) || k.includes(h)));
    if (skillText && unlisted.length) {
      const where = items.find(x => x.section && x.section.type !== "skills" && hits(x.item.text, [unlisted[0]]).length);
      finding({ category: "relevance", severity: "Medium", kind: "objective", impact: 1, title: "Skills you use but haven't listed", location: skillSecs[0].title,
        original: where ? where.item.text : "", itemId: where ? where.item.id : null,
        why: `Your CV shows you using ${unlisted.slice(0, 5).join(", ")}, but they're not in your skills list. Recruiters and ATS filters often search the skills list for these exact terms.`,
        recommendation: `Add ${unlisted.slice(0, 5).join(", ")} to your skills section, since your experience already backs them up.`, example: "", needsFacts: false });
    }
    const share = fieldTotal ? topField[1] / fieldTotal : 0;
    const fp = !fieldTotal ? 1 : share >= 0.6 ? 3 : share >= 0.4 ? 2 : 1;
    add("relevance", fp, fieldTotal ? `Clearest field: ${topField[0]} (${Math.round(share * 100)}% of field-specific terms).` : "No field-specific terms found.", fp >= 2 ? 1 : -1);

    /* ===== 6. Professionalism (10) ===== */
    const local = email.split("@")[0] || "";
    const badEmail = /\b(sexy|babe|hot|420|69|xx+|lol|princess|killer|baller|swag|cutie|bigdog)\b/i.test(local.replace(/[._-]+/g, " ") + " " + local.replace(/[._\d-]+/g, " "));
    add("professionalism", !email ? 1 : badEmail ? 0 : 2, !email ? "No email to check." : badEmail ? "The email address may come across as informal." : "Email address looks professional.", email && !badEmail ? 1 : -1);
    if (badEmail) finding({ category: "professionalism", severity: "Medium", kind: "subjective", impact: 2, title: "Informal email address", location: "Header / contact details", original: email, why: "An informal address can make a poor first impression.", recommendation: "Use a firstname.lastname style address (your uni email is fine).", example: "", needsFacts: true, question: "Do you have a firstname.lastname style address?" });
    add("professionalism", fmts.size > 1 ? 1 : 2, fmts.size > 1 ? `Dates use ${fmts.size} different formats.` : "Dates use one format.", fmts.size > 1 ? -1 : 1);
    if (fmts.size > 1) finding({ category: "professionalism", severity: "Low", kind: "objective", impact: 1, title: "Inconsistent date formats", location: "Education and experience", original: [...fmts].join(" / "), why: "Mixed formats look untidy and can confuse ATS date parsing.", recommendation: "Pick one format and use it everywhere, e.g. \"Mar 2024 – Present\".", example: "", needsFacts: false });
    const markers = new Set(bulletsAll.map(x => x.item.marker).filter(Boolean));
    const ends = bulletsAll.map(x => /\.$/.test(x.item.text));
    const periodShare = ends.length ? ends.filter(Boolean).length / ends.length : 0;
    const mixedEnds = ends.length >= 4 && periodShare > 0.2 && periodShare < 0.8;
    const bp = 2 - (markers.size > 1 ? 1 : 0) - (mixedEnds ? 1 : 0);
    add("professionalism", bp, bp === 2 ? "Bullet style and full stops are consistent." : `${markers.size > 1 ? `${markers.size} different bullet symbols` : ""}${markers.size > 1 && mixedEnds ? "; " : ""}${mixedEnds ? "some bullet points end with a full stop and some don't" : ""}.`, bp === 2 ? 1 : -1);
    if (bp < 2) finding({ category: "professionalism", severity: "Low", kind: "objective", impact: 2 - bp, title: "Inconsistent bullet formatting", location: "Bullet points", original: mixedEnds ? (bulletsAll.find(x => /\.$/.test(x.item.text) !== (periodShare >= 0.5)) || bulletsAll[0]).item.text : "",
      why: "Small inconsistencies are noticed by detail-focused recruiters (especially in audit, law and engineering).", recommendation: `Use one bullet symbol, and ${periodShare >= 0.5 ? "end every bullet point with a full stop" : "leave full stops off every bullet point"}.`, example: "", needsFacts: false });
    const pastN = vi.filter(x => x.v.form === "past" && !x.item.current).length, gerN = vi.filter(x => x.v.form === "gerund").length;
    const tenseMixed = pastN >= 2 && gerN >= 2;
    add("professionalism", tenseMixed ? 1 : 2, tenseMixed ? "Bullet points mix past tense and -ing forms." : "Verb tense is consistent.", tenseMixed ? -1 : 1);
    const wrongVar = spell.length;
    add("professionalism", wrongVar >= 3 ? 0 : wrongVar ? 1 : 2, wrongVar ? `${wrongVar} word${wrongVar > 1 ? "s" : ""} not in ${variantName(variant)} spelling.` : `Spelling is consistently ${variantName(variant)}.`, wrongVar ? -1 : 1);
    const personal = items.find(x => PERSONAL_RE.test(x.item.text));
    if (personal) finding({ category: "professionalism", severity: "Low", kind: "subjective", impact: 0, title: "Personal details you can leave out", location: loc(personal), original: personal.item.text, itemId: personal.item.id,
      why: "Australian CVs don't usually include date of birth, age, marital status or a photo, and employers shouldn't use them. This doesn't affect your score.", recommendation: "Consider removing it.", example: "", needsFacts: false });
    if (!linkedin && contactOk) finding({ category: "professionalism", severity: "Low", kind: "subjective", impact: 0, title: "No LinkedIn URL", location: "Header / contact details", original: "", why: "Perth recruiters often check LinkedIn. This doesn't affect your score.", recommendation: "Add your LinkedIn profile URL (linkedin.com/in/yourname) to your contact line.", example: "", needsFacts: true, question: "What's your LinkedIn URL?" });

    const ph = items.filter(x => /\[[^\]]{0,60}\]|\bX{1,3}\b(?=\s*(?:prospective|properties|people|customers|clients|staff|per|%))/.test(x.item.text)
      || (x.section && x.section.type !== "interests" && wordsOf(x.item.text).length <= 5 && /\w\s*[-–:]\s*$/.test(x.item.text)));
    if (ph.length) {
      cats.professionalism.score -= Math.min(4, ph.length);
      cats.professionalism.reasons.push({ sign: -1, text: `${ph.length} line${ph.length > 1 ? "s" : ""} still contain placeholders or blank fields, e.g. "${short(ph[0].item.text, 60)}".` });
      finding({ category: "professionalism", severity: "High", kind: "objective", impact: Math.min(4, ph.length) + 2, title: "Unfinished placeholders or blank fields", location: `${loc(ph[0])}${ph.length > 1 ? ` (and ${ph.length - 1} more)` : ""}`,
        original: ph[0].item.text, itemId: ph[0].item.id, why: "Brackets like [X] or [client/sector], or a label with nothing after it (e.g. \"Course Weighted Average-\"), tell a recruiter the CV wasn't finished. This is one of the quickest ways to be screened out.",
        recommendation: "Replace each placeholder with the real detail, or delete it. Don't guess a figure you can't back up in an interview.", example: "", needsFacts: true,
        question: "What should go in the brackets? If you don't know, remove that part of the sentence.", placeholder: true });
    }

    /* ===== totals ===== */
    const categories = CATEGORIES.map(c => { const x = cats[c.key]; return { key: c.key, name: c.name, max: c.max, score: Math.round(clamp(x.score, 0, c.max)), reasons: x.reasons }; });
    const total = categories.reduce((a, c) => a + c.score, 0);

    /* ===== strengths (only ones the CV supports) ===== */
    if (nExp && quant.length / nExp >= 0.3) strengths.push({ title: "Quantified accomplishments", detail: `${quant.length} bullet points include figures, e.g. "${short(quant[0].item.text, 110)}"`, itemId: quant[0].item.id });
    if (nExp >= 3 && strong.length / nExp >= 0.7) strengths.push({ title: "Strong action verbs", detail: `${strong.length} of ${nExp} bullet points start with an action, e.g. "${short(strong[0].item.text, 90)}"`, itemId: strong[0].item.id });
    const edu = secOf("education").flatMap(s => s.items);
    const eduText = edu.map(i => i.text).join(" ");
    if (edu.length && /\b(bachelor|master|diploma|degree|bcom|beng|llb|jd|bsc|ba|certificate|honours|phd)\b/i.test(eduText) && /\b(university|college|institute|tafe|school)\b/i.test(eduText)) strengths.push({ title: "Clear education section", detail: `Lists your qualification and institution: "${short(edu[0].text, 90)}"`, itemId: edu[0].id });
    if (hard.length >= 4) strengths.push({ title: "Specific technical skills", detail: `Lists ${hard.length} concrete tools or skills (${hard.slice(0, 5).join(", ")})${evidenced.length ? `, ${evidenced.length} of them backed up in your experience` : ""}.` });
    if (totalH >= 4 && hr >= 0.8) strengths.push({ title: "Clear, standard structure", detail: `${totalH} sections with standard headings (${doc.sections.slice(0, 5).map(s => s.title).join(", ")}).` });
    const lead = items.find(x => x.section && /\b(led|lead|president|captain|coordinated|mentored|trained|supervised|treasurer|secretary|committee|organised|organized)\b/i.test(x.item.text));
    if (lead) strengths.push({ title: "Evidence of leadership and transferable skills", detail: `e.g. "${short(lead.item.text, 110)}"`, itemId: lead.item.id });
    if (fieldTotal >= 8 && share >= 0.6 && expLines.some(x => { const re = FIELDS[topField[0]]; re.lastIndex = 0; const r = re.test(x.item.text); re.lastIndex = 0; return r; })) strengths.push({ title: `Relevant ${topField[0]} focus`, detail: `Your experience and education consistently point to ${topField[0]}.` });

    /* ===== before/after suggestions for every line that can be improved without new facts ===== */
    const majorityPeriod = ends.length ? periodShare >= 0.5 : undefined;
    for (const x of items) {
      if (!x.section || x.section.type === "skills" || x.section.type === "references" || x.item.kind === "entry") continue;
      if (wordsOf(x.item.text).length < 3) continue;
      if (x.item.kind === "line" && /(?:19|20)\d{2}/.test(x.item.text) && wordsOf(x.item.text).length < 14) continue; // dated heading-style lines
      const isExp = EXP_TYPES.has(x.section.type) && (x.item.kind === "bullet" || x.item.kind === "statement");
      const rw = rewrite(x.item.text, isExp ? "improve" : "tidy", { variant, current: x.item.current, period: isExp && x.item.bullet ? majorityPeriod : undefined });
      if (!rw.changed || rw.text.replace(/\s+/g, " ").trim() === x.item.text.replace(/\s+/g, " ").trim()) continue; // layout spacing only
      suggestions.push({ id: nid("g"), itemId: x.item.id, section: x.section.title, original: x.item.text, revised: rw.text, why: explain(rw.notes), needsFacts: false, kind: "wording" });
    }
    for (const x of expLines) {
      if (isQuantified(x.item.text) || !verbInfo(x.item.text).verb) continue;
      suggestions.push({ id: nid("g"), itemId: x.item.id, section: x.section.title, original: x.item.text, revised: "", why: "Adding a real figure would make this bullet point more concrete. We won't guess it for you.", needsFacts: true, question: metricQuestion(x.item.text), kind: "metric" });
    }
    // link findings to suggestions so the dashboard can jump between them
    for (const f of findings) { const sg = suggestions.find(s => s.itemId && s.itemId === f.itemId); if (sg) f.suggestionId = sg.id; }

    const sevRank = { High: 0, Medium: 1, Low: 2 };
    findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.impact - a.impact);
    const plan = findings.filter(f => f.impact > 0).slice().sort((a, b) => b.impact - a.impact || sevRank[a.severity] - sevRank[b.severity]).slice(0, 5).map(f => f.id);
    const sectionScores = sectionScore(doc, { categories, sumText, specificSummary, edu: eduText, hard, evidenced });
    const weakest = categories.slice().sort((a, b) => a.score / a.max - b.score / b.max)[0];
    const strongest = categories.slice().sort((a, b) => b.score / b.max - a.score / a.max)[0];

    return {
      engine: "rules", engineLabel: "Rule-based check (no AI)", version: VERSION, mode, variant, created: new Date().toISOString(),
      total, band: band(total), categories, strengths: strengths.slice(0, 5), findings, suggestions, plan, sectionScores,
      summary: `Strongest area: ${strongest.name.toLowerCase()} (${strongest.score}/${strongest.max}). Weakest area: ${weakest.name.toLowerCase()} (${weakest.score}/${weakest.max}).`,
      stats: { words: wordCount, sections: totalH, bullets: bulletsAll.length, experienceLines: nExp, quantified: quant.length, email: !!email, phone: !!phone, linkedin },
      grammar: gram.map(g => ({ itemId: g.x.item.id, text: g.x.item.text, issues: g.issues })), spelling: spell
    };
  }
  function explain(notes) {
    const m = { verbs: "starts with a clear action verb instead of a duty phrase", concise: "removes filler words", professional: "uses more formal wording", grammar: "fixes spacing, capitals and punctuation", spelling: "uses the selected English spelling", readability: "splits a long sentence" };
    const parts = notes.map(n => m[n]).filter(Boolean);
    return parts.length ? cap(parts.join(", ")) + ". No facts, figures or claims were added." : "";
  }
  function variantName(v) { return v === "en-US" ? "US English" : v === "en-GB" ? "British English" : "Australian English"; }
  function sectionScore(doc, c) {
    const out = {};
    out.summary = !c.sumText ? 0 : clamp((wordsOf(c.sumText).length >= 20 && wordsOf(c.sumText).length <= 90 ? 4 : 2) + (c.specificSummary ? 3 : 0) + (VAGUE_RE.test(c.sumText) ? 1 : 3), 0, 10); VAGUE_RE.lastIndex = 0;
    out.education = !c.edu ? 0 : 3 + (/\b(bachelor|master|diploma|degree|bcom|beng|llb|jd|bsc|ba|certificate|honours|atar)\b/i.test(c.edu) ? 3 : 0) + (/(?:19|20)\d{2}/.test(c.edu) ? 2 : 0) + (/\b(university|college|institute|tafe|school)\b/i.test(c.edu) ? 2 : 0);
    const ex = c.categories.find(x => x.key === "experience"); out.experience = Math.round(ex.score / ex.max * 10);
    out.skills = !c.hard.length ? 0 : clamp(Math.min(6, c.hard.length) + (c.hard.length ? Math.round(4 * c.evidenced.length / c.hard.length) : 0), 0, 10);
    return out;
  }

  /* Draft profile from facts already in the CV. */
  function summaryDraft(doc, o = {}) {
    const segs = t => t.split(/\s{2,}|\t|\||,|\s[–—-]\s/).map(x => x.trim()).filter(Boolean);
    const stripDates = t => t.replace(new RegExp(`\\s*(?:${MONTH}\\s+)?(?:19|20)\\d{2}.*$`, "i"), "").replace(/\s*(present|expected.*)$/i, "").trim();
    const edu = doc.sections.filter(s => s.type === "education").flatMap(s => s.items.map(i => i.text));
    let deg = "", uni = "", eduLine = "";
    for (const line of edu) for (const sg of segs(line)) {
      if (!deg && /\b(bachelor|master|diploma|b\.?\s?com|beng|llb|juris doctor|bsc|honours|degree)\b/i.test(sg)) { deg = stripDates(sg); eduLine = line; }
      if (!uni && /\b(university|curtin|uwa|ecu|murdoch|notre dame|tafe|institute|college)\b/i.test(sg)) { uni = stripDates(sg); eduLine = eduLine || line; }
    }
    if (deg && uni && deg.includes(uni)) uni = "";
    const current = /present|expected|current|20(2[6-9]|3\d)/i.test(edu.join(" "));
    const roleSecs = doc.sections.filter(s => s.type === "experience" || s.type === "leadership");
    const roles = [...new Set(roleSecs.flatMap(s => s.items.filter(i => i.kind === "entry").map(i => stripDates(segs(i.text)[0] || ""))))]
      .filter(t => t && t.length < 45 && /[A-Za-z]/.test(t)).slice(0, 2);
    const skillText = doc.sections.filter(s => s.type === "skills").flatMap(s => s.items.map(i => i.text)).join(", ");
    const orig = k => { const m = skillText.match(new RegExp(k.replace(/[+#.]/g, "\\$&"), "i")); return m ? m[0] : k; };
    const hard = [...new Set(hits(skillText, HARD_SKILLS))].filter(k => !["accounting", "research", "sales"].includes(k)).slice(0, 4).map(orig);
    if (!deg && !roles.length && !hard.length) return "";
    let s = `${deg ? cap(deg) : "University"} ${current ? "student" : "graduate"}${uni ? ` at ${/^the\s/i.test(uni) || /^university of/i.test(uni) ? "the " + uni.replace(/^the\s+/i, "") : uni}` : ""}`;
    if (roles.length) {
      const TITLE = /\b(analyst|assistant|intern|associate|engineer|clerk|consultant|officer|manager|tutor|treasurer|president|volunteer|accountant|cadet|graduate|coordinator|representative|barista|supervisor|lead|developer|researcher|paralegal|advisor|adviser|director|secretary|captain|mentor|technician)\b/i;
      const asTitle = roles.filter(r => TITLE.test(r)), atFirm = roles.filter(r => !TITLE.test(r)).map(r => r.replace(/\s*\((?:(?:part|full)[- ]time|casual|internship)\)\s*$/i, "").trim());
      const bits = [];
      if (asTitle.length) bits.push("as " + asTitle.map(r => (/^[aeiou]/i.test(r) ? "an " : "a ") + r).join(" and "));
      if (atFirm.length) bits.push("at " + atFirm.join(" and "));
      s += ` with experience ${bits.join(" and ")}`;
    }
    s += ".";
    if (hard.length) s += ` Skilled in ${hard.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
    if (o.target) s += ` Seeking ${o.target}.`;
    return s.replace(/\s+/g, " ");
  }

  /* ---------------- job matching (rule-based) ---------------- */
  const STOP = new Set("a an and are as at be by for from has have in is it its of on or our the to we will with you your this that who what they their about able across all also any can into more must other per such than through up use using well work working including include role position team strong excellent good great new within based ability experience skills knowledge understanding required preferred desirable candidate applicants opportunity apply year years s".split(" "));
  function jobKeywords(jd) {
    const text = String(jd);
    const low = text.toLowerCase();
    const skills = [...new Set(hits(low, HARD_SKILLS))];
    const softs = [...new Set(hits(low, SOFT_SKILLS))];
    const REQ = /\b(experience (in|with)|knowledge of|ability to|skills? in|skills|proficien\w+|degree|studying|understanding of|familiar\w*|exposure to|must|essential|desirable|required|you will|you'll|you have|interest in|strong|proven|demonstrated)\b/i;
    const reqLines = text.split(/\n|;/).map(l => { const m = l.match(BULLET_RE); return { t: (m ? l.slice(m[0].length) : l).trim(), b: !!m }; })
      .filter(x => x.t.length > 12 && x.t.length < 260 && (x.b || REQ.test(x.t))).map(x => x.t).slice(0, 15);
    const tokens = (low.match(/[a-z][a-z+#&-]{2,}/g) || []).filter(w => !STOP.has(w));
    const freq = {};
    for (let i = 0; i < tokens.length; i++) {
      freq[tokens[i]] = (freq[tokens[i]] || 0) + 1;
      if (i + 1 < tokens.length) { const bg = tokens[i] + " " + tokens[i + 1]; if (low.includes(bg)) freq[bg] = (freq[bg] || 0) + 1.5; }
    }
    const terms = Object.entries(freq).filter(([k, v]) => v >= 2 && !skills.includes(k)).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const picked = [];
    for (const t of terms) { if (picked.length >= 12) break; if (!picked.some(p => p.includes(t) || t.includes(p))) picked.push(t); }
    return { skills, softs, terms: picked, reqLines };
  }
  const SYN = { communication: ["communicat", "present", "liais", "report", "wrote", "write"], teamwork: ["team", "collaborat", "with colleagues", "committee", "group"], leadership: ["led", "lead", "captain", "president", "supervis", "mentor", "coordinat"], "attention to detail": ["reconcil", "check", "accura", "review", "audit"], "problem solving": ["solv", "resolv", "troubleshoot", "improv", "fix"], "time management": ["deadline", "while studying", "full-time stud", "part-time", "prioritis", "prioritiz"], "customer service": ["customer", "client", "guest"], adaptability: ["adapt", "range of", "different"], initiative: ["initiat", "proposed", "introduced", "started", "founded"] };
  function jobMatch(doc, jd) {
    const cvText = toText(doc).toLowerCase();
    const k = jobKeywords(jd);
    const where = term => { for (const s of doc.sections) for (const i of s.items) if (i.text.toLowerCase().includes(term)) return { section: s.title, itemId: i.id, text: i.text }; return null; };
    const skillRows = k.skills.map(t => ({ term: t, type: "skill", found: where(t) }));
    const termRows = k.terms.map(t => ({ term: t, type: "keyword", found: where(t) }));
    const transferable = k.softs.map(t => { const syn = SYN[t] || [t]; let ev = null; for (const s of doc.sections.filter(x => x.type !== "summary" && x.type !== "skills")) for (const i of s.items) if (!ev && syn.some(w => i.text.toLowerCase().includes(w))) ev = { section: s.title, itemId: i.id, text: i.text }; return { term: t, found: ev }; });
    const reqs = k.reqLines.map(line => {
      const ws = (line.toLowerCase().match(/[a-z][a-z+#&-]{3,}/g) || []).filter(w => !STOP.has(w));
      const got = ws.filter(w => cvText.includes(stem(w)) || (SYN[w] || []).some(x => cvText.includes(x)));
      const ratio = ws.length ? got.length / ws.length : 0;
      return { requirement: line, status: ratio >= 0.6 ? "evidenced" : ratio >= 0.3 ? "partial" : "missing", matched: got.slice(0, 6) };
    });
    const w = (rows, wt) => rows.reduce((a, r) => a + (r.found ? wt : 0), 0);
    const possible = skillRows.length * 2 + termRows.length * 1 + transferable.length * 1;
    const kwScore = possible ? (w(skillRows, 2) + w(termRows, 1) + w(transferable, 1)) / possible : 0;
    const reqScore = reqs.length ? reqs.reduce((a, r) => a + (r.status === "evidenced" ? 1 : r.status === "partial" ? 0.5 : 0), 0) / reqs.length : kwScore;
    const score = Math.round(100 * (0.6 * kwScore + 0.4 * reqScore));
    const tips = [];
    for (const r of skillRows.filter(r => !r.found)) tips.push(`"${r.term}" isn't in your CV. If you've used it, add it to Skills and to the bullet point where you used it. If you haven't, don't add it.`);
    for (const r of transferable.filter(r => r.found)) tips.push(`The ad asks for ${r.term}; your line "${short(r.found.text, 80)}" shows it — consider making that bullet point more explicit.`);
    return { engine: "rules", score, skills: skillRows, keywords: termRows, transferable, requirements: reqs, tips: tips.slice(0, 8),
      note: "Keyword and requirement overlap only. It doesn't predict ATS results or interviews, and it can't tell if you have a skill you haven't written down." };
  }
  /* Targeted version: same facts, with the job's matched skills moved to the front of the skills list and a profile line that names the role. */
  /* Targeted version: a list of proposed changes that use only facts already in the CV.
     - skills: add skills the ad wants that the CV already shows elsewhere, then lead with the ad's terms
     - bullets: within each role, move the bullet points that match the ad to the top
     - profile: name the target role */
  const stem = w => w.toLowerCase().slice(0, Math.max(4, Math.min(6, w.length - 2)));
  function adWords(jd) {
    const k = jobKeywords(jd);
    const words = new Set();
    for (const line of [...k.reqLines, ...k.terms, ...k.skills]) for (const w of (line.toLowerCase().match(/[a-z][a-z&+#-]{3,}/g) || [])) if (!STOP.has(w)) words.add(stem(w));
    return { k, words };
  }
  const matchScore = (text, words) => { let n = 0; for (const w of new Set((text.toLowerCase().match(/[a-z][a-z&+#-]{3,}/g) || []).map(stem))) if (words.has(w)) n++; return n; };
  function guessTitle(jd) {
    const first = String(jd).split("\n").map(l => l.trim()).find(l => l && l.length < 80 && !/[.!?]$/.test(l)) || "";
    return first.replace(/\s*[-–—|].*$/, "").replace(/^(job title|role|position)\s*:\s*/i, "").trim();
  }
  function planTargeted(doc, jd, title, o = {}) {
    const { k, words } = adWords(jd);
    const changes = [];
    const role = (title || guessTitle(jd)).replace(/\b(role|position)\b\.?$/i, "").trim();
    // 1. skills
    const body = doc.sections.filter(s => s.type !== "skills").flatMap(s => s.items.map(i => i.text)).join(" ");
    const skillSec = doc.sections.find(s => s.type === "skills");
    const listed = skillSec ? skillSec.items.map(i => i.text).join(", ").toLowerCase() : "";
    const wanted = [...new Set([...k.skills, ...hits(String(jd).toLowerCase(), HARD_SKILLS)])];
    const evidenced = wanted.filter(t => !listed.includes(t) && hits(body, [t]).length && !["sales", "accounting"].includes(t)).slice(0, 6);
    const cased = t => { const m = body.match(new RegExp(t.replace(/[+#.]/g, "\\$&"), "i")); const v = m ? m[0] : t; return v[0].toUpperCase() + v.slice(1); };
    if (skillSec && skillSec.items.length) {
      const items = skillSec.items.filter(i => i.text.trim());
      const it = items.slice().sort((a, b) => hits(b.text, HARD_SKILLS).length - hits(a.text, HARD_SKILLS).length)[0] || skillSec.items[0];
      const lab = (it.text.match(/^([A-Za-z &/-]{2,30}):\s*/) || ["", ""]);
      const parts = it.text.slice(lab[0].length).split(/\s*[,;|]\s*/).filter(Boolean);
      const all = [...evidenced.map(cased), ...parts];
      const sc = p => matchScore(p, words) > 0 || wanted.some(w => p.toLowerCase().includes(w)) ? 0 : 1;
      const after = lab[0] + all.map((p, i) => [p, i]).sort((a, b) => sc(a[0]) - sc(b[0]) || a[1] - b[1]).map(x => x[0]).join(", ");
      if (after !== it.text) changes.push({ id: "skills", kind: "skills", itemId: it.id, label: evidenced.length ? `Add ${evidenced.length} skill${evidenced.length > 1 ? "s" : ""} your experience already shows, and lead with the ad's terms` : "Lead your skills list with the ad's terms",
        why: evidenced.length ? `Your experience already shows ${evidenced.map(cased).join(", ")}, and the ad asks for ${evidenced.length > 1 ? "them" : "it"}. Moved up: the skills that match the ad.` : "Recruiters skim the first few skills.", before: it.text, after, added: evidenced.map(cased) });
    } else if (evidenced.length) {
      changes.push({ id: "skills", kind: "skills-new", label: "Add a Skills section with skills your experience already shows", why: `Your CV mentions ${evidenced.join(", ")}, and the ad asks for them.`, before: "", after: evidenced.map(cased).join(", ") });
    }
    // 2. bullet order within each role
    for (const s of doc.sections.filter(s => EXP_TYPES.has(s.type))) {
      let group = [], head = null;
      const flush = () => {
        if (group.length >= 2) {
          // only clearly relevant bullet points (2+ of the ad's words) move up; the rest keep their order
          const ranked = group.map((it, i) => { const n = matchScore(it.text, words); return { it, i, n: n >= 2 ? n : 0 }; }).sort((a, b) => b.n - a.n || a.i - b.i);
          if (ranked.some((r, i) => r.i !== i))
            changes.push({ id: "order-" + group[0].id, kind: "order", sectionId: s.id, ids: ranked.map(r => r.it.id), label: `Reorder bullet points under “${short(head ? head.text.replace(/\s{2,}.*/, "") : s.title, 60)}”`,
              why: "Puts the experience most relevant to this ad first.", before: group.map(g => g.text), after: ranked.map(r => r.it.text) });
        }
        group = [];
      };
      for (const it of s.items) { if (it.kind === "entry") { flush(); head = it; } else if (it.bullet || it.kind === "statement") group.push(it); }
      flush();
    }
    // 3. profile names the role
    const sum = doc.sections.find(s => s.type === "summary" && s.items.length);
    if (role) {
      const line = `Seeking ${/^(a|an|the)\s/i.test(role) ? role : (/^[aeiou]/i.test(role) ? "an " : "a ") + role} role.`;
      if (sum) {
        const it = sum.items[0];
        if (!it.text.toLowerCase().includes(role.toLowerCase())) {
          const sentences = it.text.match(/[^.!?]+[.!?]*/g) || [it.text];
          const idx = sentences.findIndex(x => /^\s*(seeking|looking for|aspiring|interested in|hoping to|eager to secure)/i.test(x));
          const after = idx >= 0 ? sentences.map((x, i) => i === idx ? " " + line : x).join("").trim() : `${it.text.replace(/\s+$/, "")}${/[.!?]$/.test(it.text.trim()) ? "" : "."} ${line}`;
          changes.push({ id: "profile", kind: "profile", itemId: it.id, label: "Name this role in your profile", why: "Shows the reader straight away that the CV is written for this job.", before: it.text, after });
        }
      } else {
        const draft = summaryDraft(doc, { target: line.replace(/^Seeking /, "").replace(/\.$/, ""), mode: o.mode });
        if (draft) changes.push({ id: "profile", kind: "profile-new", label: "Add a profile that names this role", why: "Built only from your degree, roles and skills.", before: "", after: draft });
      }
    }
    return { changes, role };
  }
  function applyTargeted(doc, changes, pick) {
    const d = clone(doc);
    const find = id => { for (const s of d.sections) { const i = s.items.find(x => x.id === id); if (i) return i; } return null; };
    for (const c of changes) {
      if (pick && !pick.has(c.id)) continue;
      if (c.kind === "skills" || c.kind === "profile") { const it = find(c.itemId); if (it) it.text = c.after; }
      if (c.kind === "skills-new") d.sections.push({ id: nid("s"), title: "Skills", type: "skills", items: [{ id: nid("i"), text: c.after, bullet: false, kind: "line" }] });
      if (c.kind === "profile-new") d.sections.unshift({ id: nid("s"), title: "Profile", type: "summary", items: [{ id: nid("i"), text: c.after, bullet: false, kind: "line" }] });
      if (c.kind === "order") {
        const s = d.sections.find(x => x.id === c.sectionId); if (!s) continue;
        const idxs = c.ids.map(id => s.items.findIndex(x => x.id === id)).filter(i => i >= 0).sort((a, b) => a - b);
        if (idxs.length !== c.ids.length) continue;
        const moved = c.ids.map(id => s.items.find(x => x.id === id));
        idxs.forEach((pos, j) => { s.items[pos] = moved[j]; });
      }
    }
    return d;
  }
  function targetedVersion(doc, jd, title, o = {}) {
    const plan = planTargeted(doc, jd, title, o);
    return { doc: applyTargeted(doc, plan.changes), changes: plan.changes };
  }

  /* ---------------- diff ---------------- */
  function diff(a, b) {
    const A = String(a).match(/\s+|[^\s]+/g) || [], B = String(b).match(/\s+|[^\s]+/g) || [];
    const n = A.length, m = B.length;
    if (n * m > 250000) return [{ t: "del", s: a }, { t: "ins", s: b }];
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    const push = (t, s) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += s; else out.push({ t, s }); };
    while (i < n && j < m) { if (A[i] === B[j]) { push("eq", A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push("del", A[i++]); else push("ins", B[j++]); }
    while (i < n) push("del", A[i++]); while (j < m) push("ins", B[j++]);
    return out;
  }

  /* ---------------- AI result validation ---------------- */
  const normForMatch = s => String(s || "").toLowerCase().replace(/[•●▪◦‣∙·‧■►➢➤✓✔]/g, " ").replace(/[“”"’']/g, "").replace(/\s+/g, " ").trim();
  function str(v, n) { return typeof v === "string" ? v.slice(0, n).trim() : ""; }
  /* Turns an AI response into the same shape as analyse(), dropping anything that isn't grounded in the CV. */
  function fromAI(raw, doc, o = {}) {
    if (!raw || typeof raw !== "object") throw new Error("The AI response wasn't valid JSON.");
    const cvNorm = normForMatch(toText(doc));
    const items = allItems(doc);
    const catIn = Array.isArray(raw.categories) ? raw.categories : [];
    const categories = CATEGORIES.map(c => {
      const x = catIn.find(y => y && y.key === c.key);
      if (!x || typeof x.score !== "number" || !isFinite(x.score)) throw new Error(`The AI response is missing a score for ${c.name}.`);
      const reasons = (Array.isArray(x.reasons) ? x.reasons : []).slice(0, 8).map(r => ({ sign: r && r.sign === "plus" ? 1 : -1, text: str(r && r.text, 300) })).filter(r => r.text);
      return { key: c.key, name: c.name, max: c.max, score: Math.round(clamp(x.score, 0, c.max)), reasons };
    });
    const total = categories.reduce((a, c) => a + c.score, 0);
    const itemFor = orig => { const n = normForMatch(orig); if (!n) return null; return items.find(x => normForMatch(x.item.text) === n) || items.find(x => normForMatch(x.item.text).includes(n) || (n.length > 20 && n.includes(normForMatch(x.item.text)))) || null; };
    const findings = [], suggestions = [];
    let dropped = 0;
    for (const f of (Array.isArray(raw.findings) ? raw.findings : []).slice(0, 25)) {
      if (!f || !CAT[f.category]) { dropped++; continue; }
      const byId = typeof f.itemId === "string" ? items.find(x => x.item.id === f.itemId) : null;
      let original = str(f.original, 600);
      if (byId && (!original || !cvNorm.includes(normForMatch(original)))) original = byId.item.text;
      if (original && !cvNorm.includes(normForMatch(original))) { dropped++; continue; } // must quote the CV
      let suggestion = str(f.suggestion, 600), needsFacts = !!f.needsFacts;
      let note = "";
      if (suggestion && original && !newNumbers(original, suggestion).ok) { suggestion = ""; needsFacts = true; note = " (A suggested rewrite added a figure that isn't in your CV, so it was removed.)"; }
      const it = byId || (original ? itemFor(original) : null);
      const sev = ["High", "Medium", "Low"].includes(f.severity) ? f.severity : "Medium";
      const fo = { id: nid("f"), category: f.category, severity: sev, kind: f.kind === "objective" ? "objective" : "subjective", impact: { High: 4, Medium: 2, Low: 1 }[sev],
        title: str(f.title, 120) || "Issue", location: str(f.location, 120) || (it && it.section ? it.section.title : "Whole CV"), original, itemId: it ? it.item.id : null,
        why: str(f.explanation, 600) + note, recommendation: str(f.recommendation, 400), example: suggestion, needsFacts, question: str(f.question, 200), benefit: str(f.benefit, 200) };
      findings.push(fo);
      if (it && suggestion && normForMatch(suggestion) !== normForMatch(it.item.text)) {
        const sg = { id: nid("g"), itemId: it.item.id, section: it.section ? it.section.title : "Header", original: it.item.text, revised: suggestion, why: fo.benefit || fo.recommendation, needsFacts: false, kind: "wording" };
        suggestions.push(sg); fo.suggestionId = sg.id;
      } else if (it && needsFacts && fo.question) suggestions.push({ id: nid("g"), itemId: it.item.id, section: it.section ? it.section.title : "Header", original: it.item.text, revised: "", why: fo.recommendation, needsFacts: true, question: fo.question, kind: "metric" });
    }
    const strengths = (Array.isArray(raw.strengths) ? raw.strengths : []).slice(0, 5).map(s => ({ title: str(s && s.title, 100), detail: str(s && s.evidence, 300) })).filter(s => s.title);
    const sevRank = { High: 0, Medium: 1, Low: 2 };
    findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
    const weakest = categories.slice().sort((a, b) => a.score / a.max - b.score / b.max)[0];
    const strongest = categories.slice().sort((a, b) => b.score / b.max - a.score / a.max)[0];
    const rules = analyse(doc, o);
    return {
      engine: "ai", engineLabel: "AI analysis", model: o.model || "", version: VERSION, mode: o.mode || "graduate", variant: o.variant || "en-AU", created: new Date().toISOString(),
      total, band: band(total), categories, strengths, findings, suggestions, plan: findings.filter(f => f.severity !== "Low").slice(0, 5).map(f => f.id),
      summary: str(raw.summary, 600) || `Strongest area: ${strongest.name.toLowerCase()}. Weakest area: ${weakest.name.toLowerCase()}.`,
      sectionScores: rules.sectionScores, stats: rules.stats, grammar: rules.grammar, spelling: rules.spelling, dropped
    };
  }

  return { VERSION, CATEGORIES, band, checkText, parse, toText, clone, findItem, allItems, analyse, rewrite, newNumbers, metricQuestion, withMetric, summaryDraft, jobMatch, jobKeywords, targetedVersion, planTargeted, applyTargeted, diff, fromAI, verbInfo, past, spellingIssues, variantName, ACTIONS };
});
