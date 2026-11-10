/* PerthTrack CV Score: reading CV files and writing PDF / Word files.
   Everything here runs on the user's device. Files are never uploaded. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CVIO = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MAX_BYTES = 5 * 1024 * 1024;
  const enc = new TextEncoder();
  const dec = new TextDecoder("utf-8", { fatal: false });

  /* ---------------- zip ---------------- */
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open Word files. Save the CV as a PDF and upload that instead.");
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function zipEntries(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.byteLength - 22; i >= Math.max(0, u8.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("This file isn't a valid Word document.");
    let off = dv.getUint32(eocd + 16, true);
    const n = dv.getUint16(eocd + 10, true), out = [];
    for (let k = 0; k < n && off + 46 <= u8.byteLength; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), usize = dv.getUint32(off + 24, true);
      const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
      const local = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nl));
      out.push({ name, method, csize, usize, local });
      off += 46 + nl + el + cl;
    }
    return { u8, dv, out };
  }
  async function zipRead(buf, name) {
    const z = zipEntries(buf);
    const e = z.out.find(x => x.name === name);
    if (!e) return null;
    if (e.usize > 30 * 1024 * 1024) throw new Error("This Word file is unusually large inside. Save it again from Word and retry.");
    const start = e.local + 30 + z.dv.getUint16(e.local + 26, true) + z.dv.getUint16(e.local + 28, true);
    const data = z.u8.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRaw(data);
    throw new Error("This Word file uses compression we can't read. Save it again from Word and retry.");
  }

  /* ---------------- reading ---------------- */
  const xmlText = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
  /* Walk document.xml tags in order. Paragraph = line; list paragraphs get a bullet; tabs kept as spacing. */
  function docxXmlToText(xml) {
    const re = /<(\/?)([\w:]+)([^>]*?)(\/?)>|([^<]+)/g;
    const lines = [];
    let cur = null, inText = false, skip = 0, depthP = 0;
    let m;
    while ((m = re.exec(xml))) {
      if (m[5] !== undefined) { if (inText && cur && !skip) cur.text += xmlText(m[5]); continue; }
      const close = m[1] === "/", tag = m[2], selfClose = m[4] === "/";
      if (tag === "mc:Fallback") { if (!selfClose) skip += close ? -1 : 1; continue; }
      if (skip) continue;
      if (tag === "w:p") {
        if (!close && !selfClose) { depthP++; if (depthP === 1) cur = { text: "", list: false }; }
        else if (close) { depthP--; if (depthP === 0 && cur) { const t = cur.text.replace(/[ \t]+$/, ""); lines.push((cur.list && t.trim() ? "• " : "") + t); cur = null; } }
        else if (selfClose && depthP === 0) lines.push("");
        continue;
      }
      if (!cur) continue;
      if (tag === "w:t") { inText = !close && !selfClose; continue; }
      if (tag === "w:tab" && !close) { cur.text += "    "; continue; }
      if ((tag === "w:br" || tag === "w:cr") && !close) { cur.text += "\n"; continue; }
      if (tag === "w:numPr" && !close) { cur.list = true; continue; }
      if (tag === "w:pStyle" && /w:val="(List|Bullet)[^"]*"/i.test(m[3])) { cur.list = true; continue; }
    }
    return lines;
  }
  /* Tables: put each row's cells on one line so "Role | Dates" layouts stay together. */
  function docxToText(xml) {
    const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, tbl => {
      const rows = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || [];
      return rows.map(r => {
        const cells = (r.match(/<w:tc>[\s\S]*?<\/w:tc>|<w:tc [\s\S]*?<\/w:tc>/g) || []).map(c => docxXmlToText(c).filter(l => l.trim()));
        // single-line cells side by side; multi-line cells listed after
        const one = cells.filter(c => c.length === 1).map(c => c[0].trim()), many = cells.filter(c => c.length > 1).flat();
        const line = one.join("    ");
        return `<w:p><w:r><w:t>${escXml(line)}</w:t></w:r></w:p>` + many.map(l => `<w:p><w:r><w:t>${escXml(l)}</w:t></w:r></w:p>`).join("");
      }).join("");
    });
    return docxXmlToText(body).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  async function readDocx(buf) {
    const xml = await zipRead(buf, "word/document.xml");
    if (!xml) throw new Error("This doesn't look like a Word (.docx) document.");
    return { text: docxToText(dec.decode(xml)), pages: null, method: "docx" };
  }

  let pdfjsPromise = null;
  function assetBase() {
    if (typeof document === "undefined") return "";
    const s = [...document.scripts].find(x => /cv-io\.js(\?|$)/.test(x.src));
    return s ? s.src.replace(/cv-io\.js.*$/, "") : "";
  }
  function loadPdfJs() {
    if (typeof window !== "undefined" && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = assetBase() + "pdf.min.js";
      s.onload = () => { if (!window.pdfjsLib) return reject(new Error("The PDF reader didn't load.")); window.pdfjsLib.GlobalWorkerOptions.workerSrc = assetBase() + "pdf.worker.min.js"; resolve(window.pdfjsLib); };
      s.onerror = () => { pdfjsPromise = null; reject(new Error("The PDF reader couldn't load. Check your connection and try again, or upload a .docx.")); };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }
  /* Rebuild lines from positioned text: group by baseline, order left to right, keep wide gaps as column spacing. */
  function pdfItemsToLines(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str && !it.hasEOL) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, h * 0.35));
      if (!row) { row = { y, h, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: it.str, h });
    }
    rows.sort((a, b) => b.y - a.y);
    const out = [];
    let lastY = null, lastH = 10;
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "", end = null;
      for (const p of r.parts) {
        if (!p.s) continue;
        if (!p.s.trim()) { if (p.w > p.h * 1.5 && !/ {4}$/.test(line)) line = line.replace(/\s+$/, "") + "    "; else if (!/\s$/.test(line)) line += " "; end = p.x + p.w; continue; }
        if (end !== null) { const gap = p.x - end; if (gap > p.h * 1.6) line += "    "; else if (gap > p.h * 0.15 && !/\s$/.test(line) && !/^\s/.test(p.s)) line += " "; }
        line += p.s; end = p.x + p.w;
      }
      if (lastY !== null && lastY - r.y > lastH * 1.9) out.push("");
      out.push(line.replace(/\s+$/, "").replace(/^\s*[\uF000-\uF0FF]\s*/, "• "));
      lastY = r.y; lastH = r.h;
    }
    return out;
  }
  async function readPdf(buf) {
    const pdfjs = await loadPdfJs();
    // isEvalSupported:false closes the font-code execution path (CVE-2024-4367); the page CSP also blocks eval.
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false }).promise;
    if (pdf.numPages > 10) throw new Error(`This PDF has ${pdf.numPages} pages. CVs are usually 1–3 pages — check you've uploaded the right file.`);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      pages.push(pdfItemsToLines(tc.items).join("\n"));
    }
    const text = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    const chars = text.replace(/\s/g, "").length;
    return { text, pages: pdf.numPages, method: "pdf", scanned: chars < 60 * pdf.numPages };
  }

  function kindOf(name, u8) {
    const ext = (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
    const head = u8.subarray(0, 8);
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
    if (ext === "pdf") return isPdf ? "pdf" : "bad";
    if (ext === "docx") return isZip ? "docx" : isOle ? "doc" : "bad";
    if (ext === "doc") return "doc";
    if (ext === "txt" || ext === "md") return isPdf || isZip || isOle ? "bad" : "txt";
    if (["pages", "odt", "rtf"].includes(ext)) return "other";
    return "unknown";
  }
  /* Validate and extract. Returns { text, method, pages, scanned, name, size } or throws a friendly Error. */
  async function readFile(file) {
    if (!file) throw new Error("No file selected.");
    if (file.size === 0) throw new Error("That file is empty.");
    if (file.size > MAX_BYTES) throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB — CVs are usually well under 1 MB.`);
    const buf = await readBuffer(file);
    const u8 = new Uint8Array(buf);
    const kind = kindOf(file.name, u8);
    if (kind === "doc") throw new Error("Old .doc files aren't supported. In Word, use File → Save As → Word Document (.docx) or PDF, then upload that.");
    if (kind === "other") throw new Error("That format isn't supported. Export your CV as a PDF or Word (.docx) file and upload that.");
    if (kind === "unknown") throw new Error("Upload a PDF, Word (.docx) or plain text (.txt) file.");
    if (kind === "bad") throw new Error("That file's contents don't match its extension, so we haven't opened it. Re-export it from Word or Google Docs.");
    let r;
    if (kind === "pdf") r = await readPdf(buf);
    else if (kind === "docx") r = await readDocx(buf);
    else {
      const t = dec.decode(u8);
      if ((t.match(/\u0000/g) || []).length > 5) throw new Error("That text file contains binary data. Upload a PDF or .docx instead.");
      r = { text: t.replace(/\r\n?/g, "\n").trim(), method: "txt", pages: null };
    }
    return { ...r, name: file.name, size: file.size };
  }
  function readBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("Couldn't read that file.")); fr.readAsArrayBuffer(file); });
  }

  /* ---------------- export model ---------------- */
  const TEMPLATES = {
    classic: { name: "Classic", desc: "Centred name, ruled headings. Suits finance, law and government.", align: "center", nameSize: 20, head: 11, body: 10.5, gap: 1.0, rule: true, upper: true, font: "Calibri" },
    modern: { name: "Modern", desc: "Left-aligned with an accent bar. Suits engineering, consulting and corporate roles.", align: "left", nameSize: 22, head: 11.5, body: 10.5, gap: 1.0, rule: false, bar: true, upper: false, font: "Arial" },
    compact: { name: "Compact", desc: "Tighter spacing to keep a full CV to one page.", align: "left", nameSize: 17, head: 10.5, body: 9.75, gap: 0.8, rule: true, upper: true, font: "Arial" }
  };
  /* Split "Title, Company    Mar 2024 – Present" into left text and right-aligned dates. */
  function splitEntry(text) {
    const m = String(text).match(/^(.*?\S)\s{2,}((?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2}.*|(?:\d{1,2}\/)?(?:19|20)\d{2}.*|Present|Current)$/);
    if (m) return { left: m[1], right: m[2] };
    const D = "(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?\\s+|\\d{1,2}\\/)?(?:19|20)\\d{2}";
    const k = String(text).match(new RegExp(`^(.*?\\S)\\s*[|,–—-]\\s*(${D}\\s*[–—-]\\s*(?:${D}|Present|Current|Now))$`, "i"));
    if (k) return { left: k[1], right: k[2] };
    const n = String(text).match(/^(.*?\S)\s*[|,–—-]\s*((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*[–—-]\s*(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}|Present|Current|Now))$/i);
    if (n) return { left: n[1], right: n[2] };
    return { left: String(text).replace(/\s{2,}/g, "  "), right: "" };
  }
  function model(doc) {
    const header = doc.header.map(h => h.text.trim()).filter(Boolean);
    const name = header[0] || "Your Name";
    const contact = header.slice(1).join(" · ").replace(/\s*[|·•]\s*/g, " · ");
    const sections = doc.sections.filter(s => s.items.length || s.title).map(s => ({ title: s.title, items: s.items.map(it => {
      if (it.bullet) return { type: "bullet", text: it.text };
      const e = splitEntry(it.text);
      if (it.kind === "entry" || (e.right && it.text.length < 140)) return { type: "entry", text: e.left, right: e.right };
      return { type: "line", text: it.text.replace(/\s{2,}/g, "  ") };
    }) }));
    return { name, contact, sections };
  }

  /* ---------------- PDF writer (Helvetica, A4, no dependencies) ---------------- */
  const HV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const HB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  const WIN = { "•": [0x95, 350], "–": [0x96, 556], "—": [0x97, 1000], "‘": [0x91, 222], "’": [0x92, 222], "“": [0x93, 333], "”": [0x94, 333], "…": [0x85, 1000], "€": [0x80, 556], "·": [0xb7, 278] };
  function winCodes(str) {
    const out = [];
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c < 127) out.push([c, null]);
      else if (WIN[ch]) out.push([WIN[ch][0], WIN[ch][1]]);
      else if (c >= 0xa0 && c <= 0xff) out.push([c, 556]);
      else if (ch === "\t") out.push([32, null]);
      else out.push([63, null]);
    }
    return out;
  }
  function textWidth(str, size, bold) {
    const t = bold ? HB : HV;
    return winCodes(str).reduce((a, [c, w]) => a + (w ?? (t[c - 32] || 556)), 0) * size / 1000;
  }
  function pdfStr(str) {
    return "(" + winCodes(str).map(([c]) => c === 40 || c === 41 || c === 92 ? "\\" + String.fromCharCode(c) : c < 32 || c > 126 ? "\\" + c.toString(8).padStart(3, "0") : String.fromCharCode(c)).join("") + ")";
  }
  function wrap(text, size, bold, width) {
    const words = String(text).split(/\s+/).filter(Boolean), lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (textWidth(test, size, bold) <= width || !line) line = test; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }
  function toPdf(doc, templateKey = "classic") {
    const T = TEMPLATES[templateKey] || TEMPLATES.classic, M = model(doc);
    const W = 595.28, H = 841.89, mx = 54, top = 54, bottom = 54, cw = W - mx * 2;
    const pages = [[]];
    let y = H - top;
    const ink = "0.06 0.11 0.16 rg", mute = "0.33 0.40 0.47 rg", acc = "0.72 0.31 0.10";
    const ops = () => pages[pages.length - 1];
    const need = h => { if (y - h < bottom) { pages.push([]); y = H - top; } };
    const text = (x, yy, s, size, bold, color) => ops().push(`BT ${color || ink} /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td ${pdfStr(s)} Tj ET`);
    // name + contact
    const nw = textWidth(M.name, T.nameSize, true);
    text(T.align === "center" ? (W - nw) / 2 : mx, y - T.nameSize, M.name, T.nameSize, true);
    y -= T.nameSize + 6;
    if (T.bar) { ops().push(`${acc} rg ${mx} ${(y - 2).toFixed(2)} 36 2.5 re f`); y -= 8; }
    for (const ln of wrap(M.contact, 9.5, false, cw)) {
      const lw = textWidth(ln, 9.5, false);
      text(T.align === "center" ? (W - lw) / 2 : mx, y - 9.5, ln, 9.5, false, mute); y -= 13;
    }
    y -= 6 * T.gap;
    const lh = T.body * 1.38;
    for (const s of M.sections) {
      need(T.head + lh * 2 + 10);
      y -= 8 * T.gap;
      const title = T.upper ? s.title.toUpperCase() : s.title;
      text(mx, y - T.head, title, T.head, true, T.bar ? `${acc} rg` : ink);
      y -= T.head + 4;
      if (T.rule) { ops().push(`0.75 w 0.6 0.65 0.7 RG ${mx} ${y.toFixed(2)} m ${(W - mx).toFixed(2)} ${y.toFixed(2)} l S`); }
      y -= 6 * T.gap;
      for (const it of s.items) {
        if (it.type === "entry") {
          const rw = it.right ? textWidth(it.right, T.body, false) + 12 : 0;
          const lines = wrap(it.text, T.body, true, cw - rw);
          need(lines.length * lh + 2);
          y -= 2 * T.gap;
          lines.forEach((ln, i) => { text(mx, y - T.body, ln, T.body, true); if (i === 0 && it.right) text(W - mx - textWidth(it.right, T.body, false), y - T.body, it.right, T.body, false, mute); y -= lh; });
        } else if (it.type === "bullet") {
          const ind = 14, lines = wrap(it.text, T.body, false, cw - ind);
          need(lines.length * lh);
          lines.forEach((ln, i) => { if (i === 0) text(mx + 3, y - T.body, "•", T.body, false); text(mx + ind, y - T.body, ln, T.body, false); y -= lh; });
        } else {
          const lines = wrap(it.text, T.body, false, cw);
          need(lines.length * lh);
          for (const ln of lines) { text(mx, y - T.body, ln, T.body, false); y -= lh; }
        }
      }
    }
    // assemble
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids = [];
    for (const p of pages) {
      const stream = p.join("\n");
      const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const info = add(`<< /Producer (PerthTrack CV Score) /Title ${pdfStr(M.name + " - CV")} >>`);
    let out = "%PDF-1.4\n%âãÏÓ\n";
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff; // all content is ASCII/Latin-1
    return { bytes, pages: pages.length };
  }

  /* ---------------- DOCX writer (zip, store method) ---------------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files) {
    const parts = [], central = [];
    let off = 0;
    for (const [name, content] of files) {
      const data = typeof content === "string" ? enc.encode(content) : content, nm = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  function escXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""); }
  function toDocx(doc, templateKey = "classic") {
    const T = TEMPLATES[templateKey] || TEMPLATES.classic, M = model(doc);
    const hp = pt => Math.round(pt * 2), twip = pt => Math.round(pt * 20);
    const run = (t, o = {}) => `<w:r><w:rPr>${o.b ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}<w:sz w:val="${hp(o.size || T.body)}"/></w:rPr><w:t xml:space="preserve">${escXml(t)}</w:t></w:r>`;
    const para = (inner, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.tabs ? `<w:tabs><w:tab w:val="right" w:pos="${o.tabs}"/></w:tabs>` : ""}<w:spacing w:before="${twip(o.before || 0)}" w:after="${twip(o.after ?? 2)}"/>${o.ind ? `<w:ind w:left="${o.ind}" w:hanging="${o.hang || 0}"/>` : ""}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}${o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9AA6B2"/></w:pBdr>' : ""}${o.keep ? "<w:keepNext/>" : ""}</w:pPr>${inner}</w:p>`;
    const rightTab = 11906 - 2 * 1080;
    const body = [];
    body.push(para(run(M.name, { b: true, size: T.nameSize }), { jc: T.align === "center" ? "center" : "left", after: 2, style: "Title" }));
    if (M.contact) body.push(para(run(M.contact, { size: 9.5, color: "5A6B7B" }), { jc: T.align === "center" ? "center" : "left", after: 6 }));
    for (const s of M.sections) {
      body.push(para(run(T.upper ? s.title.toUpperCase() : s.title, { b: true, size: T.head, color: T.bar ? "B8501A" : "0F1C29" }), { before: 10 * T.gap, after: 4, border: T.rule, keep: true, style: "Heading1" }));
      for (const it of s.items) {
        if (it.type === "entry") body.push(para(run(it.text, { b: true }) + (it.right ? `<w:r><w:tab/></w:r>${run(it.right, { color: "5A6B7B" })}` : ""), { tabs: rightTab, before: 4 * T.gap, after: 1, keep: true }));
        else if (it.type === "bullet") body.push(para(`${run("•")}<w:r><w:tab/></w:r>${run(it.text)}`, { ind: 360, hang: 260, after: 1 }));
        else body.push(para(run(it.text), { after: 2 }));
      }
    }
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${T.font}" w:hAnsi="${T.font}" w:cs="${T.font}"/><w:sz w:val="${hp(T.body)}"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`;
    const files = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
      ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escXml(M.name)} - CV</dc:title><dc:creator>${escXml(M.name)}</dc:creator></cp:coreProperties>`],
      ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["word/document.xml", document],
      ["word/styles.xml", styles]
    ];
    return zip(files);
  }

  /* HTML preview of a template (escaped). */
  function previewHtml(doc, templateKey, esc) {
    const T = TEMPLATES[templateKey] || TEMPLATES.classic, M = model(doc);
    return `<div class="cvdoc t-${templateKey}"><div class="cvdoc-name">${esc(M.name)}</div>${T.bar ? '<div class="cvdoc-bar"></div>' : ""}<div class="cvdoc-contact">${esc(M.contact)}</div>${M.sections.map(s => `<div class="cvdoc-sec"><div class="cvdoc-h">${esc(s.title)}</div>${s.items.map(it => it.type === "entry" ? `<div class="cvdoc-entry"><b>${esc(it.text)}</b><span>${esc(it.right || "")}</span></div>` : it.type === "bullet" ? `<div class="cvdoc-bullet">${esc(it.text)}</div>` : `<div class="cvdoc-line">${esc(it.text)}</div>`).join("")}</div>`).join("")}</div>`;
  }

  function download(bytes, name, type) {
    const blob = new Blob([bytes], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  return { MAX_BYTES, TEMPLATES, readFile, readDocx, docxToText, pdfItemsToLines, kindOf, toPdf, toDocx, zip, crc32, previewHtml, model, splitEntry, download, textWidth };
});
