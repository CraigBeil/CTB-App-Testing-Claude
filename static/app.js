"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STORE = "ctb-ontology-rows-v1";
const TERM_TYPES = ["Phenotype", "germplasm attribute", "germplasm passport"];
const LABELS = { method_class: "Method class", scale_class: "Scale class", units: "Units", scale_categories: "Scale categories" };
const CONSENSUS_KEYS = ["method_class", "scale_class", "units", "scale_categories"];

let meta = { method_classes: [], scale_classes: [] };
let rows = [];
let selected = null;      // uid of the trait shown in the form
let view = (() => { try { return localStorage.getItem("ctb-view") || "form"; } catch (e) { return "form"; } })();
let replaceUid = null;    // row being re-matched via the search box
let hits = [], hitIdx = 0;
const presetCache = {};

/* ---------- persistence ---------- */
function save() { try { localStorage.setItem(STORE, JSON.stringify(rows)); } catch (e) { /* private mode */ } }
function load() { try { rows = JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { rows = []; } }

/* ---------- row model ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const val = (r, k) => (r.fields[k] ?? "");
const cleanName = s => String(s || "").replace(/[.\[\]{}]/g, "").replace(/\s+/g, "").slice(0, 16);

function uniqueName(base, ignoreUid) {
  const taken = new Set(rows.filter(r => r.uid !== ignoreUid).map(r => val(r, "name").toLowerCase()));
  let n = cleanName(base) || "Trait", cand = n, i = 2;
  while (taken.has(cand.toLowerCase())) { const suf = String(i++); cand = n.slice(0, 16 - suf.length) + suf; }
  return cand;
}

function blankFields(text = "") {
  return { name: "", full_name: text, term_type: "Phenotype", description: "", synonyms: "", status: "active", tags: "",
    trait_entity: "", trait_attribute: "", method_description: "", method_class: "", method_formula: "", scale_class: "",
    units: "", scale_decimal_places: "", scale_lower_limit: "", scale_upper_limit: "", scale_categories: "" };
}

function makeRow(sugg, match, fallbackText) {
  const r = { uid: uid(), consensus_id: sugg?.consensus_id || null, source: sugg?.source || null,
    consensus: sugg?.consensus || null, fields: sugg ? { ...sugg.fields } : blankFields(fallbackText),
    confirmed: {}, match: match || null };
  r.fields.name = uniqueName(r.fields.name || fallbackText);
  r.original = sugg ? { ...r.fields } : null;  // what consensus suggested, for "edited" markers and reset
  return r;
}

const isNumeric = r => val(r, "scale_class") === "Numerical" || val(r, "method_class") === "Computation";
const needsCats = r => ["Ordinal", "Nominal"].includes(val(r, "scale_class")) && val(r, "method_class") !== "Computation";
function relevant(r, k) {
  if (k === "units") return isNumeric(r);
  if (k === "scale_categories") return needsCats(r);
  return true;
}

/* Has the user changed this field away from what consensus suggested? */
function isEdited(r, k) {
  if (!r.original) return false;
  if (k === "scale_class" && val(r, "method_class") === "Computation") return false;  // forced by the template
  return String(val(r, k)).trim() !== String(r.original[k] ?? "").trim();
}
const editedKeys = r => Object.keys(r.original || {}).filter(k => isEdited(r, k));

/* A consensus field the user still has to decide on: contested and not yet confirmed. */
function decisions(r) {
  if (!r.consensus) return [];
  return CONSENSUS_KEYS.filter(k => relevant(r, k) && r.consensus[k].level === "weak"
    && !r.confirmed[k] && r.consensus[k].options.length > 1);
}

function validate(r) {
  const e = {}, f = k => String(val(r, k)).trim();
  const name = f("name");
  if (!name) e.name = "Required";
  else if (name.length > 16) e.name = "Max 16 characters";
  else if (/[.\[\]{}]/.test(name)) e.name = "No periods or brackets";
  else if (rows.some(o => o.uid !== r.uid && val(o, "name").trim().toLowerCase() === name.toLowerCase())) e.name = "Must be unique";
  if (!f("description")) e.description = "Required";
  if (!f("trait_entity")) e.trait_entity = "Required";
  if (!f("trait_attribute")) e.trait_attribute = "Required";
  if (!f("method_class")) e.method_class = "Required";
  if (f("method_class") === "Computation" && !f("method_formula")) e.method_formula = "Required for computations";
  if (!f("scale_class") && f("method_class") !== "Computation") e.scale_class = "Required";
  if (isNumeric(r) && !f("units")) e.units = "Required for numerical scales";
  if (needsCats(r)) {
    const c = f("scale_categories");
    if (!c) e.scale_categories = "Required for ordinal / nominal scales";
    else if (val(r, "scale_class") === "Ordinal" && c.split(";").some(p => !p.includes("=")))
      e.scale_categories = "Ordinal needs label=meaning pairs separated by ;";
  }
  for (const k of ["scale_lower_limit", "scale_upper_limit"]) {
    const v = f(k); if (v !== "" && !Number.isInteger(Number(v))) e[k] = "Whole numbers only";
  }
  return e;
}

/* Visual state of one cell: strong/limited/weak (consensus-backed, unconfirmed), missing, or "" */
function cellState(r, k, errs) {
  if (errs[k]) return "missing";
  if (isEdited(r, k)) return "edited";
  const c = r.consensus?.[k];
  if (c && relevant(r, k) && !r.confirmed[k] && val(r, k) !== "" && val(r, k) === c.value) return c.level === "none" ? "" : c.level;
  return "";
}

function rowStatus(r) {
  const errs = validate(r);
  if (Object.keys(errs).length) return "missing";
  if (decisions(r).length) return "weak";
  return "ready";
}

/* ---------- adding traits ---------- */
async function addById(id, match) {
  const s = await (await fetch(`/api/trait/${encodeURIComponent(id)}`)).json();
  if (replaceUid) {
    const r = rows.find(x => x.uid === replaceUid);
    const fresh = makeRow(s, null);
    r.consensus_id = fresh.consensus_id; r.source = fresh.source; r.consensus = fresh.consensus;
    r.fields = fresh.fields; r.fields.name = uniqueName(fresh.fields.name, r.uid); r.original = { ...r.fields }; r.confirmed = {}; r.match = null;
    replaceUid = null; $("#q").placeholder = defaultPlaceholder;
    toast(`Re-matched to “${s.fields.full_name}”`);
    save(); renderAll();
    return r;
  }
  const r = makeRow(s, match);
  rows.push(r); selected = r.uid; save(); renderAll();
  const d = decisions(r).length;
  toast(`Added “${s.fields.full_name}” — ${d ? d + (d > 1 ? " decisions" : " decision") + " needed" : "autofilled"}`);
  return r;
}

function addBlank(text) {
  const r = makeRow(null, null, text || "");
  rows.push(r); selected = r.uid; save(); renderAll();
}

/* ---------- search box ---------- */
const defaultPlaceholder = $("#q").placeholder;
let searchTimer;
$("#q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = $("#q").value.trim();
  if (!q) return hideResults();
  searchTimer = setTimeout(async () => {
    hits = await (await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`)).json();
    hitIdx = 0; renderResults(q);
  }, 140);
});
$("#q").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { hitIdx = Math.min(hitIdx + 1, hits.length - 1); renderResults(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { hitIdx = Math.max(hitIdx - 1, 0); renderResults(); e.preventDefault(); }
  else if (e.key === "Escape") { hideResults(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (hits[hitIdx]) pick(hits[hitIdx]);
    else if ($("#q").value.trim()) { addBlank($("#q").value.trim()); $("#q").value = ""; }
  }
});
document.addEventListener("click", e => { if (!e.target.closest(".searchbox")) hideResults(); });
function hideResults() { $("#results").hidden = true; }
function pick(h) { hideResults(); $("#q").value = ""; hits = []; addById(h.consensus_id).then(() => $("#q").focus()); }

function renderResults(q) {
  const box = $("#results");
  if (!hits.length) {
    box.innerHTML = `<div class="res"><span class="meta">No consensus match for “${esc($("#q").value)}”. Press Enter to add it as a blank trait.</span></div>`;
    box.hidden = false; return;
  }
  box.innerHTML = hits.map((h, i) => `
    <div class="res ${i === hitIdx ? "on" : ""}" data-i="${i}">
      <div><b>${esc(h.full_name)}</b> <span class="meta">${esc(h.name)}</span>
        <div class="meta">${esc(h.trait_entity)} · ${esc(h.trait_attribute)}${h.tags ? " · " + esc(h.tags) : ""}</div></div>
      <div class="badges">
        <span class="pill">${h.num_species} species · ${h.num_definitions} defs</span>
        <span class="pill ${h.method_level}" title="Method class consensus">${esc(h.method_class || "?")}</span>
        <span class="pill ${h.scale_level}" title="Scale class consensus">${esc(h.scale_class || "?")}</span>
      </div></div>`).join("");
  box.hidden = false;
  box.querySelectorAll(".res").forEach(el => el.addEventListener("mousedown", e => { e.preventDefault(); pick(hits[+el.dataset.i]); }));
}

/* ---------- tabs & bulk ---------- */
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === t));
  $("#tab-one").hidden = t.dataset.tab !== "one"; $("#tab-bulk").hidden = t.dataset.tab !== "bulk";
}));
$("#blankBtn").addEventListener("click", () => addBlank($("#q").value.trim()));
$("#bulkBtn").addEventListener("click", async () => {
  const lines = $("#bulk").value.split("\n").map(s => s.trim()).filter(Boolean);
  if (!lines.length) return;
  $("#bulkBtn").disabled = true; $("#bulkMsg").textContent = "Matching…";
  const res = await (await fetch("/api/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }) })).json();
  let exact = 0, check = 0, blank = 0; const firstNew = rows.length;
  for (const m of res) {
    if (!m.suggestion) { rows.push(makeRow(null, null, m.query)); blank++; continue; }
    const isExact = m.candidates[0].exact; isExact ? exact++ : check++;
    rows.push(makeRow(m.suggestion, { query: m.query, exact: isExact, candidates: m.candidates }));
  }
  if (rows[firstNew]) selected = rows[firstNew].uid;
  save(); renderAll();
  $("#bulk").value = ""; $("#bulkBtn").disabled = false;
  document.querySelector('[data-tab="one"]').click();  // collapse back to the one-line search so the form stays on screen
  const msg = `${exact} exact · ${check} to double-check (⚠) · ${blank} not found (blank rows)`;
  $("#bulkMsg").textContent = msg; toast(`Matched ${res.length} traits — ${msg}`);
  if (reviewQueue().length) startReview();
});

/* ---------- grid ---------- */
const COLS = [["name", "text"], ["full_name", "text"], ["trait_entity", "text"], ["trait_attribute", "text"],
  ["method_class", "select"], ["scale_class", "select"], ["units", "text"]];

function cellHtml(r, [k, type], errs) {
  const st = cellState(r, k, errs), v = val(r, k), title = errs[k] ? ` title="${esc(errs[k])}"` : "";
  if (type === "select") {
    const choices = k === "method_class" ? meta.method_classes : meta.scale_classes;
    const locked = k === "scale_class" && val(r, "method_class") === "Computation";
    return `<select class="cell ${st}" data-k="${k}"${title}${locked ? " disabled" : ""}><option value=""></option>${
      choices.map(c => `<option ${c === (locked ? "Numerical" : v) ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  }
  const off = k === "units" && !isNumeric(r);
  return `<input class="cell ${off ? "" : st}" data-k="${k}" value="${esc(off ? "" : v)}"${title}${off ? ' readonly placeholder="n/a"' : ""}${k === "name" ? ' maxlength="40"' : ""}>`;
}

function stateIcon(r) {
  const s = rowStatus(r), why = { ready: "Ready", weak: "Needs a decision", missing: "Missing required fields" }[s];
  const ed = editedKeys(r).length ? `<span title="${editedKeys(r).length} field(s) customised by you" style="color:var(--edited)">✎</span>` : "";
  const fuzzy = r.match && !r.match.exact ? `<span title="Matched “${esc(r.match.query)}” loosely — click the row to check or change the match">⚠</span>` : "";
  return `<i class="dot ${s === "ready" ? "strong" : s}" title="${why}"></i>${ed}${fuzzy}`;
}

function renderGrid() {
  const tb = $("#grid tbody");
  tb.innerHTML = rows.map(r => {
    const errs = validate(r);
    return `<tr data-uid="${r.uid}" class="${r.uid === selected ? "sel" : ""}"><td class="rowstate">${stateIcon(r)}</td>${
      COLS.map(c => `<td>${cellHtml(r, c, errs)}</td>`).join("")}
      <td style="white-space:nowrap"><button class="iconbtn" data-act="open" title="All fields">✎ Edit all ›</button><button class="iconbtn" data-act="del" title="Remove">✕</button></td></tr>`;
  }).join("");
}

function syncRow(r) {  // refresh classes/values of one row without stealing focus
  const tr = $(`tr[data-uid="${r.uid}"]`);
  if (!tr) { renderSummary(); renderSidebar(); return; }
  const errs = validate(r);
  tr.querySelector(".rowstate").innerHTML = stateIcon(r);
  tr.querySelectorAll(".cell").forEach(el => {
    const k = el.dataset.k, off = k === "units" && !isNumeric(r), st = off ? "" : cellState(r, k, errs);
    el.className = `cell ${st}`; el.title = errs[k] || "";
    if (document.activeElement !== el) el.value = off ? "" : (k === "scale_class" && val(r, "method_class") === "Computation" ? "Numerical" : val(r, k));
    if (k === "units") { el.readOnly = off; el.placeholder = off ? "n/a" : ""; }
    if (k === "scale_class") el.disabled = val(r, "method_class") === "Computation";
  });
  renderSummary(); renderSidebar();
}

$("#grid tbody").addEventListener("input", e => {
  const el = e.target.closest(".cell"); if (!el) return;
  const r = rows.find(x => x.uid === el.closest("tr").dataset.uid);
  setField(r, el.dataset.k, el.value);
});
$("#grid tbody").addEventListener("change", e => {
  const el = e.target.closest(".cell"); if (!el) return;
  const r = rows.find(x => x.uid === el.closest("tr").dataset.uid);
  if (["method_class", "scale_class"].includes(el.dataset.k)) renderGrid();
  renderAll(false);
});
$("#grid tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr"); if (!tr) return;
  const id = tr.dataset.uid, act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "del") { rows = rows.filter(r => r.uid !== id); if (selected === id) selected = null; save(); renderAll(); }
  else if (act === "open" || !e.target.closest("input,select,button")) showRow(id);
});

/* Single place that applies a user edit. */
function setField(r, k, v) {
  r.fields[k] = v;
  if (CONSENSUS_KEYS.includes(k)) r.confirmed[k] = true;
  if (k === "method_class" && v === "Computation") r.fields.scale_class = "Numerical";
  if (k === "name") r.fields.name = v;  // validated, not rewritten, so the user sees the problem
  save(); syncRow(r);
}

function renderSummary() {
  const n = rows.length, st = rows.map(rowStatus);
  const ready = st.filter(s => s === "ready").length, dec = st.filter(s => s === "weak").length, bad = st.filter(s => s === "missing").length;
  $("#summary").textContent = n ? `${n} trait${n > 1 ? "s" : ""} · ${ready} ready${dec ? ` · ${dec} need a decision` : ""}${bad ? ` · ${bad} incomplete` : ""}` : "";
  const q = reviewQueue().length, b = $("#reviewBtn");
  b.hidden = !q; b.textContent = `Review ${q} decision${q > 1 ? "s" : ""}`;
}

function renderAll(grid = true) {
  $("#empty").hidden = rows.length > 0; $("#gridwrap").hidden = !rows.length;
  if (rows.length && !rows.some(r => r.uid === selected)) selected = rows[0].uid;
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  $("#formview").hidden = view !== "form"; $("#tableview").hidden = view !== "table";
  if (rows.length && grid) { if (view === "table") renderGrid(); else openDrawer(selected); }
  else if (rows.length) renderSidebar();
  renderSummary();
}

/* ---------- form pane ---------- */
/* ---------- consensus similarity ---------- */
const KEY_LABELS = { method_class: "Method", scale_class: "Scale", units: "Units", scale_categories: "Categories" };
const STRUCTURAL = ["method_class", "scale_class"];  // changing these changes which fields exist
const openState = new Map();                         // "uid:key" -> options list expanded?
const cur = () => rows.find(x => x.uid === selected);

function similarity(r) {
  if (!r.consensus) return null;
  const parts = CONSENSUS_KEYS.filter(k => relevant(r, k)).map(k => {
    const c = r.consensus[k];
    return { key: k, label: KEY_LABELS[k], pct: c.agreement, level: c.level, total: c.total, edited: isEdited(r, k) };
  });
  const known = parts.filter(p => p.pct != null);
  const overall = known.length ? known.reduce((a, p) => a + p.pct, 0) / known.length : null;
  const levels = known.map(p => p.level);
  const level = levels.includes("weak") ? "weak" : levels.includes("limited") ? "limited" : levels.length ? "strong" : "none";
  return { parts, overall, level };
}
const pctOf = v => (v == null ? 0 : Math.round(v * 100));

function simHtml(r) {
  const sim = similarity(r);
  if (!sim) return `<div class="sim none" data-sim><b>No consensus match</b><span class="mtext"> — this trait is all yours to define. Use “find a match” above to pull in consensus answers.</span></div>`;
  return `<div class="sim ${sim.level}" data-sim>
    <div class="simtop"><b>Consensus match</b><div class="mbar big"><i style="width:${pctOf(sim.overall)}%"></i></div>
      <span class="simpct">${sim.overall == null ? "—" : pctOf(sim.overall) + "%"}</span></div>
    <div class="simparts">${sim.parts.map(p => `
      <div class="part ${p.level}" title="${esc(p.label)}: ${p.pct == null ? "no consensus data" : pctOf(p.pct) + "% of " + p.total + " definitions agree"}">
        <span class="plabel">${p.label}${p.edited ? ' <span class="edmark">✎</span>' : ""}</span>
        <div class="mbar"><i style="width:${pctOf(p.pct)}%"></i></div>
        <span class="ppct">${p.pct == null ? "no data" : pctOf(p.pct) + "%"}</span></div>`).join("")}</div>
  </div>`;
}

/* ---------- per-field consensus meter + options ---------- */
function bannerText(c, key) {
  const pctTxt = c.agreement != null ? Math.round(c.agreement * 100) + "%" : "";
  if (c.level === "strong") return `Strong consensus — ${pctTxt} of ${c.total} definitions agree`;
  if (c.level === "limited") return `Only ${c.total} source${c.total > 1 ? "s" : ""}, and they agree — autofilled; check it fits your trait`;
  if (c.level === "weak") return `Contested — the top answer is used by only ${pctTxt} of ${c.total} definitions. Please choose`;
  return key === "scale_categories" ? "No consensus categories — pick a common scale below or write your own" : "No consensus data — enter a value";
}
function meterText(r, key, c) {
  const p = c.agreement != null ? Math.round(c.agreement * 100) + "%" : "";
  if (isEdited(r, key)) return `✎ Your answer · consensus suggested “${esc(String(r.original[key]).slice(0, 60))}”`;
  if (c.level === "strong") return `Strong · ${p} of ${c.total} definitions agree`;
  if (c.level === "limited") return `${c.total} source${c.total > 1 ? "s" : ""}, all agree · worth a glance`;
  if (c.level === "weak") return `Contested · top answer ${p} of ${c.total} — please choose`;
  return key === "scale_categories" ? "No consensus categories — pick one or write your own" : "No consensus data";
}

/* Every choice offered for a field: consensus alternatives (ranked), then any other valid values. */
function optionList(r, key) {
  const c = r.consensus?.[key]; if (!c) return [];
  let o = c.options.slice();
  if (key === "scale_categories" && !o.length) o = (presetCache[`${val(r, "trait_attribute")}|${val(r, "scale_class")}`] || []).slice();
  if (key === "method_class" || key === "scale_class") {  // the template only accepts these values, so offer all of them
    const have = new Set(o.map(x => x.value));
    for (const v of key === "method_class" ? meta.method_classes : meta.scale_classes)
      if (!have.has(v)) o.push({ value: v, count: 0, source: "not used in consensus" });
  }
  return o;
}

function optionsHtml(r, key, options, c) {
  const max = Math.max(...options.map(o => o.count), 1), current = val(r, key);
  const own = key === "units" || key === "scale_categories" ? `<div class="opt own" data-own="${key}">✎ Write your own…</div>` : "";
  return `<div class="opts" data-opts="${key}">` + options.map((o, i) => {
    const n = !o.count ? o.source : o.source === "consensus" ? `${c.agreement != null ? Math.round(c.agreement * 100) + "% agree" : "consensus"}`
      : o.source ? `${o.count} trait${o.count > 1 ? "s" : ""} · ${o.source}` : `${o.count} of ${c.total}`;
    return `<div class="opt ${o.value === current ? "sel" : ""}" data-k="${key}" data-i="${i}">
      <div class="bar" style="width:${Math.round(o.count / max * 100)}%"></div>
      <span class="v">${esc(o.value)}</span>${i === 0 && o.count ? '<span class="top1">Most likely</span>' : ""}<span class="n">${esc(n)}</span></div>`;
  }).join("") + own + `</div>`;
}

function meterHtml(r, key) {
  const c = r.consensus?.[key]; if (!c || !relevant(r, key)) return "";
  const options = optionList(r, key), edited = isEdited(r, key), sk = r.uid + ":" + key;
  const open = openState.has(sk) ? openState.get(sk)
    : !edited && ((c.level === "weak" && !r.confirmed[key]) || (c.level === "none" && options.length > 0));
  return `<div class="cmeter ${edited ? "edited" : c.level}" data-meter="${key}">
    <div class="mline"><div class="mbar"><i style="width:${pctOf(c.agreement)}%"></i></div><span class="mtext">${meterText(r, key, c)}</span>
      ${edited ? `<button class="link" data-reset="${key}">↺ reset</button>` : ""}
      ${options.length ? `<button class="link" data-toggle-opts="${key}">${open ? "▴ hide" : "▾ " + options.length + " option" + (options.length > 1 ? "s" : "")}</button>` : ""}</div>
    ${open && options.length ? optionsHtml(r, key, options, c) : ""}</div>`;
}
function refreshMeter(r, key) { const el = $(`#drawer [data-meter="${key}"]`); if (el) el.outerHTML = meterHtml(r, key); }

/* ---------- the Ontology Term form ---------- */
function frow(r, key, label, errs, o = {}) {
  const v = val(r, key), ed = isEdited(r, key) ? " edited" : "";
  const ctl = o.type === "select"
    ? `<select class="${ed}" data-f="${key}">${o.choices.map(c => `<option ${c === v ? "selected" : ""} value="${esc(c)}">${esc(c || o.placeholder || "")}</option>`).join("")}</select>`
    : o.type === "area" ? `<textarea class="${ed}" rows="${o.rows || 2}" data-f="${key}" placeholder="${esc(o.placeholder || "")}">${esc(v)}</textarea>`
    : `<input class="${ed}" data-f="${key}" type="${o.type || "text"}" value="${esc(v)}" placeholder="${esc(o.placeholder || "")}"${o.list ? ` list="${o.list}"` : ""}>`;
  const reset = CONSENSUS_KEYS.includes(key) ? "" : `<button class="resetbtn" tabindex="-1" data-reset="${key}" ${isEdited(r, key) ? "" : "hidden"} title="Reset to the consensus value">↺</button>`;
  return `<div class="frow"><label>${esc(label)}${o.req ? '<span class="req">*</span>' : ""}</label><div class="fctl">
    <div class="ctlrow">${ctl}${o.suffix || ""}${reset}</div>
    <div class="err" data-err="${key}" ${errs[key] ? "" : "hidden"}>${esc(errs[key] || "")}</div>${o.below || ""}${o.hint ? `<div class="hint">${o.hint}</div>` : ""}</div></div>`;
}

const COMMON_UNITS = ["cm", "m", "mm", "g", "kg", "kg/ha", "t/ha", "%", "day", "count", "index", "ppm", "mg/g", "°C", "mL", "L", "score"];
const parseCats = str => String(str || "").split(";").map(x => x.trim()).filter(Boolean).map(p => { const i = p.indexOf("="); return i < 0 ? [p, ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()]; });
const joinCats = pairs => pairs.filter(([l, m]) => l || m).map(([l, m]) => l && m ? `${l}=${m}` : (l || m)).join("; ");
let catsText = false, catsBlank = 0;  // editor mode and pending empty rows (form-local UI state)

function catsEditor(r, errs) {
  const ordinal = val(r, "scale_class") === "Ordinal", ed = isEdited(r, "scale_categories");
  const err = `<div class="err" data-err="scale_categories" ${errs.scale_categories ? "" : "hidden"}>${esc(errs.scale_categories || "")}</div>`;
  let body;
  if (catsText)
    body = `<textarea class="${ed ? "edited" : ""}" rows="4" data-f="scale_categories">${esc(val(r, "scale_categories"))}</textarea>${err}
      <div class="hint">${ordinal ? "Format: 1=Low; 2=Medium; 3=High" : "Format: Red; Green; Yellow"} · <button class="link" data-cats-mode="rows">Edit as rows</button></div>`;
  else {
    const pairs = parseCats(val(r, "scale_categories")); for (let i = 0; i < catsBlank; i++) pairs.push(["", ""]);
    body = `<div class="catrows ${ed ? "edited" : ""}">${pairs.map((p, i) => `
      <div class="catrow"><input data-cat="l" value="${esc(p[0])}" placeholder="${ordinal ? "1" : "value"}" aria-label="Category value">
        <span class="eq">=</span><input data-cat="m" value="${esc(p[1])}" placeholder="${ordinal ? "meaning" : "meaning (optional)"}" aria-label="Category meaning">
        <button class="iconbtn" data-cat-del="${i}" title="Remove">✕</button></div>`).join("")}
      <div class="catfoot"><button class="btn" data-cat-add>+ Add category</button> <button class="link" data-cats-mode="text">Edit as text</button></div></div>${err}
      <div class="hint">“=” and “;” can't be used inside a category.</div>`;
  }
  return `<div class="frow"><label>Categories<span class="req">*</span></label><div class="fctl">${meterHtml(r, "scale_categories")}${body}</div></div>`;
}

async function loadPresets(r) {
  if (!needsCats(r) || r.consensus?.scale_categories.options.length) return;
  const attr = val(r, "trait_attribute"), sc = val(r, "scale_class"), key = `${attr}|${sc}`;
  if (presetCache[key]) return;
  presetCache[key] = await (await fetch(`/api/categories?attribute=${encodeURIComponent(attr)}&scale_class=${sc}`)).json();
  if (selected === r.uid && !document.activeElement?.closest("#drawer")) openDrawer(r.uid);
}

function numRow(r, errs) {
  const n = (k, label, hint) => `<div class="numcell"><label>${label}</label><input class="${isEdited(r, k) ? "edited" : ""}" data-f="${k}" type="number" step="1" value="${esc(val(r, k))}" placeholder="${hint}"></div>`;
  return `<div class="frow"><label></label><div class="fctl"><div class="nums">${n("scale_lower_limit", "Min", "Minimum")}${n("scale_upper_limit", "Max", "Maximum")}${n("scale_decimal_places", "Decimals", "Places")}</div>
    <div class="err" data-err="scale_lower_limit" ${errs.scale_lower_limit ? "" : "hidden"}>${esc(errs.scale_lower_limit || "")}</div>
    <div class="err" data-err="scale_upper_limit" ${errs.scale_upper_limit ? "" : "hidden"}>${esc(errs.scale_upper_limit || "")}</div>
    <div class="hint">Optional. Min/Max: whole numbers only. Decimals: leave blank for integers.</div></div></div>`;
}

const composeTrait = r => `${val(r, "trait_entity")} ${val(r, "trait_attribute")}`.trim();
const composeMethod = r => `${val(r, "method_description")} ${val(r, "method_class")}`.trim();

function formHtml(r, errs) {
  const cand = r.match && !r.match.exact ? `<div class="banner weak">⚠ “${esc(r.match.query)}” was matched loosely. Better match? ${
    r.match.candidates.filter(c => c.consensus_id !== r.consensus_id).map(c => `<button class="link" data-cand="${c.consensus_id}">${esc(c.full_name)}</button>`).join(" · ") || "—"}</div>` : "";
  const nEd = editedKeys(r).length, comp = val(r, "method_class") === "Computation";
  const nameLen = String(val(r, "name")).length;
  return `
    <div class="fhead"><div><h2>Ontology Term</h2>
      <div class="species">${r.consensus_id ? `Based on <b>${esc(r.consensus_id)}</b> · ${r.source.num_species} species, ${r.source.num_definitions} definitions
        · <button class="link" data-rematch>Change match</button>` : `No consensus match — <button class="link" data-rematch>find a match</button>`}</div></div>
      <label class="toggle"><span>${val(r, "status") === "archived" ? "Archived" : "Active"}</span><input type="checkbox" data-status ${val(r, "status") === "archived" ? "" : "checked"}><i></i></label></div>
    ${r.source?.species?.length ? `<details class="speciesbox"><summary>Species using this trait (${r.source.species.length})</summary><div class="species">${esc(r.source.species.join(", "))}</div></details>` : ""}
    ${simHtml(r)}
    ${cand}
    <div class="banner edited" data-edcount ${nEd ? "" : "hidden"}>✎ <span>${nEd} field${nEd > 1 ? "s" : ""}</span> customised by you · <button class="link" data-reset-all>Reset everything to consensus</button></div>
    <div class="fcols">
      <div class="fcol">
        ${frow(r, "term_type", "Term Type", errs, { req: 1, type: "select", choices: TERM_TYPES })}
        ${frow(r, "name", "Name", errs, { req: 1, placeholder: "Ontology Term Name", suffix: `<span class="count ${nameLen > 16 ? "over" : ""}" data-count>${nameLen}/16</span>` })}
        ${frow(r, "full_name", "Full Name", errs, { placeholder: "Full Name" })}
        ${frow(r, "description", "Description", errs, { req: 1, type: "area", rows: 2, placeholder: "Ontology Term Description" })}
        ${frow(r, "synonyms", "Synonyms", errs, { placeholder: "Separate with ;" })}
        ${frow(r, "tags", "Tags", errs, { placeholder: "Separate with ;" })}
        <div class="fsec">Trait = Entity + Attribute = <span data-compose="trait">${esc(composeTrait(r))}</span></div>
        ${frow(r, "trait_entity", "Entity", errs, { req: 1, placeholder: "e.g. plant, leaf, grain" })}
        ${frow(r, "trait_attribute", "Attribute", errs, { req: 1, placeholder: "e.g. height, color" })}
      </div>
      <div class="fcol">
        <div class="fsec">Method = Description + Class = <span data-compose="method">${esc(composeMethod(r))}</span></div>
        ${frow(r, "method_description", "Description", errs, { type: "area", rows: 2, placeholder: "How the trait is collected" })}
        ${frow(r, "method_class", "Class", errs, { req: 1, type: "select", choices: ["", ...meta.method_classes], placeholder: "Select a class", below: meterHtml(r, "method_class") })}
        ${comp ? frow(r, "method_formula", "Formula", errs, { req: 1, type: "area", rows: 2, placeholder: "e.g. a / b * 100" }) : ""}
        <div class="fsec">Scale</div>
        ${comp ? `<div class="frow"><label>Class<span class="req">*</span></label><div class="fctl"><div class="hint" style="margin-top:7px">Numerical — set automatically for Computation methods.</div></div></div>`
          : frow(r, "scale_class", "Class", errs, { req: 1, type: "select", choices: ["", ...meta.scale_classes], placeholder: "Select a scale class", below: meterHtml(r, "scale_class") })}
        ${isNumeric(r) ? frow(r, "units", "Unit", errs, { req: 1, list: "units-list", placeholder: "Can be any measurable unit", below: meterHtml(r, "units") +
          `<datalist id="units-list">${[...new Set([...(r.consensus?.units.options || []).map(o => o.value), ...COMMON_UNITS])].map(u => `<option value="${esc(u)}">`).join("")}</datalist>` }) : ""}
        ${isNumeric(r) ? numRow(r, errs) : ""}
        ${needsCats(r) ? catsEditor(r, errs) : ""}
      </div>
    </div>`;
}

function openDrawer(id, o = {}) {
  const r = rows.find(x => x.uid === id); if (!r) return;
  if (selected !== id) { catsBlank = 0; catsText = false; }
  selected = id;
  const d = $("#drawer"), y = window.scrollY;
  d.innerHTML = formHtml(r, validate(r));
  window.scrollTo(0, y);
  if (o.focus) d.querySelector(`[data-f="${o.focus}"]`)?.focus();
  renderSidebar(); loadPresets(r);
}

/* Update the parts of the form that depend on the current values, without replacing any input (keeps focus). */
function refreshLive(r) {
  if (selected !== r.uid) return;
  const d = $("#drawer"), errs = validate(r), nEd = editedKeys(r).length;
  d.querySelectorAll("[data-f]").forEach(el => el.classList.toggle("edited", isEdited(r, el.dataset.f)));
  d.querySelectorAll(".resetbtn").forEach(b => { b.hidden = !isEdited(r, b.dataset.reset); });
  d.querySelectorAll("[data-err]").forEach(el => { const m = errs[el.dataset.err]; el.hidden = !m; el.textContent = m || ""; });
  CONSENSUS_KEYS.forEach(k => refreshMeter(r, k));
  const sim = $("#drawer [data-sim]"); if (sim) sim.outerHTML = simHtml(r);
  const b = $("#drawer [data-edcount]"); if (b) { b.hidden = !nEd; b.querySelector("span").textContent = `${nEd} field${nEd > 1 ? "s" : ""}`; }
  const t = $("#drawer [data-compose=trait]"), m = $("#drawer [data-compose=method]");
  if (t) t.textContent = composeTrait(r); if (m) m.textContent = composeMethod(r);
  const c = $("#drawer [data-count]"); if (c) { const n = String(val(r, "name")).length; c.textContent = `${n}/16`; c.classList.toggle("over", n > 16); }
}

function readCats() {
  return [...document.querySelectorAll("#drawer .catrow")].map(row => [...row.querySelectorAll("input")].map(i => i.value));
}
$("#drawer").addEventListener("input", e => {
  const r = cur(); if (!r) return;
  if (e.target.dataset.cat) {  // structured category rows → "label=meaning; …"
    e.target.value = e.target.value.replace(/[=;]/g, "");
    setField(r, "scale_categories", joinCats(readCats())); return refreshLive(r);
  }
  const k = e.target.dataset.f; if (!k || e.target.tagName === "SELECT") return;
  setField(r, k, e.target.value); refreshLive(r);
});
$("#drawer").addEventListener("change", e => {
  const r = cur(); if (!r) return;
  if (e.target.matches("[data-status]")) {
    setField(r, "status", e.target.checked ? "active" : "archived");
    e.target.closest(".toggle").querySelector("span").textContent = e.target.checked ? "Active" : "Archived"; return refreshLive(r);
  }
  const k = e.target.dataset.f; if (!k || e.target.tagName !== "SELECT") return;
  setField(r, k, e.target.value);
  if (STRUCTURAL.includes(k)) { renderGrid(); openDrawer(r.uid, { focus: k }); }  // other fields appear/disappear
  else refreshLive(r);
});
$("#drawer").addEventListener("click", e => {
  const r = cur(); if (!r) return;
  if (e.target.closest("[data-rematch]")) { replaceUid = r.uid; $("#q").placeholder = `Search for the right match for “${val(r, "full_name") || val(r, "name")}”…`; $("#q").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const cand = e.target.closest("[data-cand]"); if (cand) { replaceUid = r.uid; addById(cand.dataset.cand); return; }
  const tog = e.target.closest("[data-toggle-opts]");
  if (tog) { const k = tog.dataset.toggleOpts, sk = r.uid + ":" + k; openState.set(sk, !(openState.has(sk) ? openState.get(sk) : !!$(`#drawer [data-meter="${k}"] .opts`))); return refreshMeter(r, k); }
  const reset = e.target.closest("[data-reset]");
  if (reset) { resetField(r, reset.dataset.reset); renderGrid(); return openDrawer(r.uid); }
  if (e.target.closest("[data-reset-all]")) { r.fields = { ...r.original }; r.confirmed = {}; save(); renderGrid(); renderSummary(); return openDrawer(r.uid); }
  const mode = e.target.closest("[data-cats-mode]");
  if (mode) { catsText = mode.dataset.catsMode === "text"; catsBlank = 0; return openDrawer(r.uid); }
  const del = e.target.closest("[data-cat-del]");
  if (del) { const p = readCats(); p.splice(+del.dataset.catDel, 1); catsBlank = 0; setField(r, "scale_categories", joinCats(p)); return openDrawer(r.uid); }
  if (e.target.closest("[data-cat-add]")) {
    const p = readCats(), ordinal = val(r, "scale_class") === "Ordinal";
    if (ordinal) { const nums = p.map(x => parseFloat(x[0])).filter(Number.isFinite); p.push([String((nums.length ? Math.max(...nums) : 0) + 1), ""]); setField(r, "scale_categories", joinCats(p)); }
    else catsBlank++;
    openDrawer(r.uid);
    const rowsEls = document.querySelectorAll("#drawer .catrow"), last = rowsEls[rowsEls.length - 1];
    return last?.querySelector(ordinal ? '[data-cat="m"]' : '[data-cat="l"]').focus();
  }
  const own = e.target.closest("[data-own]");
  if (own) {
    if (own.dataset.own === "scale_categories") { catsBlank++; openDrawer(r.uid); const rs = document.querySelectorAll("#drawer .catrow"); return rs[rs.length - 1]?.querySelector("input").focus(); }
    const inp = $(`#drawer [data-f="${own.dataset.own}"]`); inp.focus(); inp.select(); return;
  }
  const opt = e.target.closest(".opt"); if (!opt) return;
  const k = opt.dataset.k;
  choose(r, k, optionList(r, k)[+opt.dataset.i].value);
  catsBlank = 0; renderGrid(); openDrawer(r.uid);
});

/* ---------- trait list (left) and view switch ---------- */
function renderSidebar() {
  const sb = $("#sidebar"); if (!sb || view !== "form") return;
  sb.innerHTML = `<div class="shead">Traits <span>${rows.length}</span></div>` + rows.map(r => {
    const s = rowStatus(r), sim = similarity(r), pct = sim?.overall != null ? pctOf(sim.overall) : null;
    return `<div class="sitem ${r.uid === selected ? "sel" : ""}" data-uid="${r.uid}"><i class="dot ${s === "ready" ? "strong" : s}" title="${{ ready: "Ready", weak: "Needs a decision", missing: "Missing required fields" }[s]}"></i>
      <div class="stxt"><b>${esc(val(r, "name") || "(unnamed)")}</b><small>${esc(val(r, "full_name"))}</small>
        ${pct != null ? `<div class="mbar tiny ${sim.level}"><i style="width:${pct}%"></i></div>` : ""}</div>
      ${editedKeys(r).length ? '<span class="edmark" title="Customised by you">✎</span>' : ""}<span class="spct">${pct != null ? pct + "%" : "—"}</span>
      <button class="iconbtn" data-del title="Remove">✕</button></div>`;
  }).join("");
}
$("#sidebar").addEventListener("click", e => {
  const it = e.target.closest(".sitem"); if (!it) return;
  const id = it.dataset.uid;
  if (e.target.closest("[data-del]")) { rows = rows.filter(r => r.uid !== id); if (selected === id) selected = null; save(); return renderAll(); }
  openDrawer(id);
});
document.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
  view = b.dataset.view; try { localStorage.setItem("ctb-view", view); } catch (e) { /* ignore */ }
  renderAll();
}));
function showRow(id) { selected = id; view = "form"; renderAll(); }

function choose(r, k, v) { setField(r, k, v); }
function resetField(r, k) { r.fields[k] = r.original[k]; delete r.confirmed[k]; save(); renderSummary(); }

/* ---------- decision review (keyboard-first) ---------- */
let skipped = new Set();
function reviewQueue() {
  const q = [];
  for (const r of rows) for (const k of decisions(r)) if (!skipped.has(r.uid + k)) q.push({ r, k });
  return q;
}
$("#reviewBtn").addEventListener("click", () => { skipped = new Set(); startReview(); });
function startReview() { skipped = new Set(); stepReview(); }

function stepReview() {
  const q = reviewQueue(), m = $("#modal");
  if (!q.length) { m.hidden = true; document.removeEventListener("keydown", reviewKeys); renderAll(); toast("All decisions made"); return; }
  const { r, k } = q[0], c = r.consensus[k];
  const total = q.length;
  const opts = c.options.slice(0, 9);
  m.innerHTML = `<div class="mbox">
    <small>${total} left · ${esc(val(r, "full_name") || val(r, "name"))}</small>
    <h2>${esc(LABELS[k])}</h2>
    <div class="banner weak">${bannerText(c, k)}</div>
    ${opts.map((o, i) => `<div class="opt" data-i="${i}"><span class="kbd">${i + 1}</span><div class="bar" style="width:${Math.round(o.count / Math.max(...opts.map(x => x.count)) * 100)}%"></div>
      <span class="v" style="white-space:pre-wrap">${esc(o.value)}</span>${i === 0 ? '<span class="top1">Most likely</span>' : ""}
      <span class="n">${o.source ? esc(o.source) : `${o.count} of ${c.total}`}</span></div>`).join("")}
    <div id="ownbox">${ownRow(r, k)}</div>
    <div class="mfoot"><span class="hint"><span class="kbd">1</span>–<span class="kbd">${opts.length}</span> choose · <span class="kbd">Enter</span> most likely · <span class="kbd">W</span> write your own · <span class="kbd">S</span> skip · <span class="kbd">Esc</span> close</span>
      <button class="btn" data-skip>Skip</button></div></div>`;
  m.hidden = false;
  document.removeEventListener("keydown", reviewKeys); document.addEventListener("keydown", reviewKeys);
  m.onclick = e => {
    if (e.target === m) return endReview();
    if (e.target.closest("[data-skip]")) return skip(r, k);
    if (e.target.closest("[data-own]")) return openOwn(r, k);
    if (e.target.closest("[data-own-save]")) return saveOwn(r, k);
    const o = e.target.closest(".opt"); if (o) take(r, k, opts[+o.dataset.i].value);
  };
}
const FIXED = { method_class: () => meta.method_classes, scale_class: () => meta.scale_classes };
const ownRow = () => `<div class="opt own" data-own>✎ Write your own… <span class="kbd">W</span></div>`;
function openOwn(r, k) {
  const cur = esc(val(r, k));
  const ctl = FIXED[k] ? `<select id="ownval">${FIXED[k]().map(v => `<option ${v === val(r, k) ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`
    : k === "scale_categories" ? `<textarea id="ownval" rows="4" placeholder="1=Low; 2=Medium; 3=High">${cur}</textarea>`
    : `<input id="ownval" value="${cur}" placeholder="e.g. kg/ha">`;
  $("#ownbox").innerHTML = `<div class="ownform">${ctl}<button class="btn primary" data-own-save>Use this</button></div>
    <div class="hint">${FIXED[k] ? "The template only accepts these values." : k === "scale_categories" ? "Separate categories with ; and use = between value and meaning." : "Any unit is accepted."}</div>`;
  $("#ownval").focus();
  $("#ownval").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveOwn(r, k); } });
}
function saveOwn(r, k) { const v = $("#ownval").value.trim(); if (v) take(r, k, v); }
function reviewKeys(e) {
  if ($("#modal").hidden) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) { if (e.key === "Escape") endReview(); return; }
  const q = reviewQueue(); if (!q.length) return;
  const { r, k } = q[0], opts = r.consensus[k].options.slice(0, 9);
  if (e.key === "Escape") endReview();
  else if (e.key === "Enter") { e.preventDefault(); take(r, k, opts[0].value); }
  else if (/^[1-9]$/.test(e.key) && opts[+e.key - 1]) take(r, k, opts[+e.key - 1].value);
  else if (e.key.toLowerCase() === "s") skip(r, k);
  else if (e.key.toLowerCase() === "w") { e.preventDefault(); openOwn(r, k); }
}
function take(r, k, v) { setField(r, k, v); renderGrid(); stepReview(); }
function skip(r, k) { skipped.add(r.uid + k); stepReview(); }
function endReview() { $("#modal").hidden = true; document.removeEventListener("keydown", reviewKeys); skipped = new Set(); renderAll(); }

/* ---------- export ---------- */
$("#exportBtn").addEventListener("click", e => { e.stopPropagation(); $("#exportMenu").hidden = !$("#exportMenu").hidden; });
document.addEventListener("click", () => { $("#exportMenu").hidden = true; });
$("#exportMenu").addEventListener("click", async e => {
  const fmt = e.target.dataset.fmt; if (!fmt) return;
  if (!rows.length) return toast("Add at least one trait first");
  const bad = rows.filter(r => Object.keys(validate(r)).length);
  if (bad.length) { toast(`${bad.length} trait${bad.length > 1 ? "s are" : " is"} missing required fields — see the red cells`); openDrawer(bad[0].uid); return; }
  const open = rows.reduce((n, r) => n + decisions(r).length, 0);
  if (open && !confirm(`${open} contested field${open > 1 ? "s still use" : " still uses"} the most likely answer without your confirmation. Export anyway?`)) return;
  const res = await fetch(`/api/export/${fmt}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: rows.map(r => r.fields) }) });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: `trait_ontology.${fmt}` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} trait${rows.length > 1 ? "s" : ""}`);
});

/* ---------- misc ---------- */
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200); }

(async function init() {
  meta = await (await fetch("/api/meta")).json();
  $("#dbstats").textContent = `${meta.traits.toLocaleString()} consensus traits from ${meta.species} species`;
  load(); renderAll();
  $("#q").focus();
})();
