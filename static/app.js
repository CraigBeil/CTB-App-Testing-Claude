"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STORE = "ctb-ontology-rows-v1";
const TERM_TYPES = ["Phenotype", "germplasm attribute", "germplasm passport"];
const LABELS = { method_class: "Method class", scale_class: "Scale class", units: "Units", scale_categories: "Scale categories" };
const CONSENSUS_KEYS = ["method_class", "scale_class", "units", "scale_categories"];

let meta = { method_classes: [], scale_classes: [] };
let rows = [];
let selected = null;      // uid of row open in drawer
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
  return r;
}

const isNumeric = r => val(r, "scale_class") === "Numerical" || val(r, "method_class") === "Computation";
const needsCats = r => ["Ordinal", "Nominal"].includes(val(r, "scale_class")) && val(r, "method_class") !== "Computation";
function relevant(r, k) {
  if (k === "units") return isNumeric(r);
  if (k === "scale_categories") return needsCats(r);
  return true;
}

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
    r.fields = fresh.fields; r.fields.name = uniqueName(fresh.fields.name, r.uid); r.confirmed = {}; r.match = null;
    replaceUid = null; $("#q").placeholder = defaultPlaceholder;
    toast(`Re-matched to “${s.fields.full_name}”`);
    save(); renderAll(); if (selected === r.uid) openDrawer(r.uid);
    return r;
  }
  const r = makeRow(s, match);
  rows.push(r); save(); renderAll();
  const d = decisions(r).length;
  toast(`Added “${s.fields.full_name}” — ${d ? d + (d > 1 ? " decisions" : " decision") + " needed" : "autofilled"}`);
  return r;
}

function addBlank(text) {
  const r = makeRow(null, null, text || "");
  rows.push(r); save(); renderAll(); openDrawer(r.uid);
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
  let exact = 0, check = 0, blank = 0;
  for (const m of res) {
    if (!m.suggestion) { rows.push(makeRow(null, null, m.query)); blank++; continue; }
    const isExact = m.candidates[0].exact; isExact ? exact++ : check++;
    rows.push(makeRow(m.suggestion, { query: m.query, exact: isExact, candidates: m.candidates }));
  }
  save(); renderAll();
  $("#bulk").value = ""; $("#bulkBtn").disabled = false;
  $("#bulkMsg").textContent = `${exact} exact · ${check} to double-check (⚠) · ${blank} not found (blank rows)`;
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
  const fuzzy = r.match && !r.match.exact ? `<span title="Matched “${esc(r.match.query)}” loosely — click the row to check or change the match">⚠</span>` : "";
  return `<i class="dot ${s === "ready" ? "strong" : s}" title="${why}"></i>${fuzzy}`;
}

function renderGrid() {
  const tb = $("#grid tbody");
  tb.innerHTML = rows.map(r => {
    const errs = validate(r);
    return `<tr data-uid="${r.uid}" class="${r.uid === selected ? "sel" : ""}"><td class="rowstate">${stateIcon(r)}</td>${
      COLS.map(c => `<td>${cellHtml(r, c, errs)}</td>`).join("")}
      <td style="white-space:nowrap"><button class="iconbtn" data-act="open" title="All fields">Details ›</button><button class="iconbtn" data-act="del" title="Remove">✕</button></td></tr>`;
  }).join("");
}

function syncRow(r) {  // refresh classes/values of one row without stealing focus
  const tr = $(`tr[data-uid="${r.uid}"]`); if (!tr) return;
  const errs = validate(r);
  tr.querySelector(".rowstate").innerHTML = stateIcon(r);
  tr.querySelectorAll(".cell").forEach(el => {
    const k = el.dataset.k, off = k === "units" && !isNumeric(r), st = off ? "" : cellState(r, k, errs);
    el.className = `cell ${st}`; el.title = errs[k] || "";
    if (document.activeElement !== el) el.value = off ? "" : (k === "scale_class" && val(r, "method_class") === "Computation" ? "Numerical" : val(r, k));
    if (k === "units") { el.readOnly = off; el.placeholder = off ? "n/a" : ""; }
    if (k === "scale_class") el.disabled = val(r, "method_class") === "Computation";
  });
  renderSummary();
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
  if (selected === r.uid) openDrawer(r.uid);
  renderAll(false);
});
$("#grid tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr"); if (!tr) return;
  const id = tr.dataset.uid, act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "del") { rows = rows.filter(r => r.uid !== id); if (selected === id) closeDrawer(); save(); renderAll(); }
  else if (act === "open" || e.target.classList.contains("rowstate") || e.target.closest(".rowstate")) openDrawer(id);
});
$("#grid tbody").addEventListener("focusin", e => { if (e.target.closest(".cell")) { const id = e.target.closest("tr").dataset.uid; if (selected && selected !== id) openDrawer(id); } });

/* Single place that applies a user edit. */
function setField(r, k, v, opts = {}) {
  r.fields[k] = v;
  if (CONSENSUS_KEYS.includes(k)) r.confirmed[k] = true;
  if (k === "method_class" && v === "Computation") r.fields.scale_class = "Numerical";
  if (k === "name") r.fields.name = v;  // validated, not rewritten, so the user sees the problem
  save(); syncRow(r);
  if (opts.refreshDrawer && selected === r.uid) openDrawer(r.uid);
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
  if (grid) renderGrid();
  renderSummary();
}

/* ---------- drawer ---------- */
function bannerText(c, key) {
  const pctTxt = c.agreement != null ? Math.round(c.agreement * 100) + "%" : "";
  if (c.level === "strong") return `Strong consensus — ${pctTxt} of ${c.total} definitions agree`;
  if (c.level === "limited") return `Only ${c.total} source${c.total > 1 ? "s" : ""}, and they agree — autofilled; check it fits your trait`;
  if (c.level === "weak") return `Contested — the top answer is used by only ${pctTxt} of ${c.total} definitions. Please choose`;
  return key === "scale_categories" ? "No consensus categories — pick a common scale below or write your own" : "No consensus data — enter a value";
}

function optsBlock(r, key) {
  const c = r.consensus?.[key]; if (!c) return "";
  let options = c.options;
  if (key === "scale_categories" && !options.length && presetCache[`${val(r, "trait_attribute")}|${val(r, "scale_class")}`])
    options = presetCache[`${val(r, "trait_attribute")}|${val(r, "scale_class")}`];
  if (!relevant(r, key) || (!options.length && c.level === "none" && key !== "scale_categories")) return c.level === "none" ? `<div class="banner none">${bannerText(c, key)}</div>` : "";
  const max = Math.max(...options.map(o => o.count), 1), current = val(r, key);
  const list = options.map((o, i) => {
    const n = o.source === "consensus" ? `${c.agreement != null ? Math.round(c.agreement * 100) + "% agree" : "consensus"}`
      : o.source ? `${o.count} trait${o.count > 1 ? "s" : ""} · ${o.source}` : `${o.count} of ${c.total}`;
    return `<div class="opt ${o.value === current ? "sel" : ""}" data-k="${key}" data-i="${i}">
      <div class="bar" style="width:${Math.round(o.count / max * 100)}%"></div>
      <span class="v">${esc(o.value)}</span>${i === 0 ? '<span class="top1">Most likely</span>' : ""}<span class="n">${esc(n)}</span></div>`;
  }).join("") + (key === "units" || key === "scale_categories" ? `<div class="opt own" data-own="${key}">✎ Write your own…</div>` : "");
  const open = c.level === "weak" && !r.confirmed[key] || c.level === "none";
  const state = c.level === "none" ? "none" : c.level;
  return `<div class="banner ${state}">${bannerText(c, key)}</div>${options.length ? (open || options.length === 1 ? `<div class="opts" data-opts="${key}">${list}</div>`
    : `<details><summary>See ${options.length} option${options.length > 1 ? "s" : ""}</summary><div class="opts" data-opts="${key}">${list}</div></details>`) : ""}`;
}

function inputField(r, key, label, errs, o = {}) {
  const v = val(r, key), req = o.req ? '<span class="req">*</span>' : "";
  const ctl = o.type === "select"
    ? `<select data-f="${key}">${o.choices.map(c => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`
    : o.type === "area" ? `<textarea rows="${o.rows || 2}" data-f="${key}">${esc(v)}</textarea>`
    : `<input data-f="${key}" type="${o.type || "text"}" value="${esc(v)}">`;
  return `<div class="field"><label>${esc(label)}${req}</label>${o.before || ""}${ctl}${errs[key] ? `<div class="err">${esc(errs[key])}</div>` : ""}${o.after || ""}${o.hint ? `<div class="hint">${o.hint}</div>` : ""}</div>`;
}

async function loadPresets(r) {
  if (!needsCats(r) || r.consensus?.scale_categories.options.length) return;
  const attr = val(r, "trait_attribute"), sc = val(r, "scale_class"), key = `${attr}|${sc}`;
  if (presetCache[key]) return;
  presetCache[key] = await (await fetch(`/api/categories?attribute=${encodeURIComponent(attr)}&scale_class=${sc}`)).json();
  if (selected === r.uid) openDrawer(r.uid);
}

function openDrawer(id) {
  const r = rows.find(x => x.uid === id); if (!r) return;
  selected = id;
  const errs = validate(r), d = $("#drawer"), scrollTop = d.scrollTop;
  const cand = r.match && !r.match.exact ? `<div class="banner weak">⚠ “${esc(r.match.query)}” was matched loosely. Better match? ${
    r.match.candidates.filter(c => c.consensus_id !== r.consensus_id).map(c => `<button class="link" data-cand="${c.consensus_id}">${esc(c.full_name)}</button>`).join(" · ") || "—"}</div>` : "";
  d.innerHTML = `
    <h2><span>${esc(val(r, "full_name") || val(r, "name") || "New trait")}</span><button class="iconbtn" data-close>✕</button></h2>
    <div class="species">${r.consensus_id ? `Based on <b>${esc(r.consensus_id)}</b> · ${r.source.num_species} species, ${r.source.num_definitions} definitions
      · <button class="link" data-rematch>Change match</button>` : `No consensus match — <button class="link" data-rematch>find a match</button>`}</div>
    ${r.source?.species?.length ? `<details><summary>Species using this trait</summary><div class="species">${esc(r.source.species.join(", "))}</div></details>` : ""}
    ${cand}
    <div class="two">${inputField(r, "name", "Name", errs, { req: 1, hint: "≤16 chars, unique, no periods/brackets" })}${inputField(r, "full_name", "Full name", errs)}</div>
    ${inputField(r, "description", "Description", errs, { req: 1, type: "area", rows: 3 })}
    <div class="two">${inputField(r, "trait_entity", "Trait entity", errs, { req: 1 })}${inputField(r, "trait_attribute", "Trait attribute", errs, { req: 1 })}</div>
    <div class="two">${inputField(r, "tags", "Tags", errs, { hint: "separate with ;" })}${inputField(r, "synonyms", "Synonyms", errs, { hint: "separate with ;" })}</div>
    <div class="two">${inputField(r, "term_type", "Term type", errs, { type: "select", choices: TERM_TYPES })}${inputField(r, "status", "Status", errs, { type: "select", choices: ["active", "archived"] })}</div>
    <hr style="border:0;border-top:1px solid var(--line)">
    ${inputField(r, "method_class", "Method class", errs, { req: 1, type: "select", choices: ["", ...meta.method_classes], before: optsBlock(r, "method_class") })}
    ${inputField(r, "method_description", "Method description", errs, { type: "area", hint: "How the trait is collected" })}
    ${val(r, "method_class") === "Computation" ? inputField(r, "method_formula", "Method formula", errs, { req: 1, type: "area" }) : ""}
    ${val(r, "method_class") === "Computation" ? `<div class="hint">Scale class is set to Numerical for computations.</div>`
      : inputField(r, "scale_class", "Scale class", errs, { req: 1, type: "select", choices: ["", ...meta.scale_classes], before: optsBlock(r, "scale_class") })}
    ${isNumeric(r) ? inputField(r, "units", "Units", errs, { req: 1, before: optsBlock(r, "units") }) : ""}
    ${isNumeric(r) ? `<div class="two">${inputField(r, "scale_decimal_places", "Decimal places", errs, { type: "number" })}</div>
      <div class="two">${inputField(r, "scale_lower_limit", "Lower limit", errs, { type: "number" })}${inputField(r, "scale_upper_limit", "Upper limit", errs, { type: "number" })}</div>` : ""}
    ${needsCats(r) ? inputField(r, "scale_categories", "Scale categories", errs, { req: 1, type: "area", rows: 4, before: optsBlock(r, "scale_categories"),
      hint: val(r, "scale_class") === "Ordinal" ? "Format: 1=Low; 2=Medium; 3=High" : "Format: Red; Green; Yellow" }) : ""}`;
  d.hidden = false; d.scrollTop = scrollTop;
  document.querySelectorAll("#grid tr.sel").forEach(t => t.classList.remove("sel"));
  $(`tr[data-uid="${id}"]`)?.classList.add("sel");
  loadPresets(r);
}
function closeDrawer() { selected = null; $("#drawer").hidden = true; document.querySelectorAll("#grid tr.sel").forEach(t => t.classList.remove("sel")); }

$("#drawer").addEventListener("input", e => {
  const k = e.target.dataset.f; if (!k || e.target.tagName === "SELECT") return;
  setField(rows.find(x => x.uid === selected), k, e.target.value);
});
$("#drawer").addEventListener("change", e => {
  const k = e.target.dataset.f; if (!k) return;
  const r = rows.find(x => x.uid === selected);
  setField(r, k, e.target.value);
  if (["method_class", "scale_class"].includes(k)) {  // these change which fields apply
    renderGrid(); openDrawer(r.uid); $(`#drawer [data-f="${k}"]`)?.focus();
  }
});
$("#drawer").addEventListener("click", e => {
  const r = rows.find(x => x.uid === selected);
  if (e.target.closest("[data-close]")) return closeDrawer();
  if (e.target.closest("[data-rematch]")) { replaceUid = r.uid; $("#q").placeholder = `Search for the right match for “${val(r, "full_name") || val(r, "name")}”…`; $("#q").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const cand = e.target.closest("[data-cand]"); if (cand) { replaceUid = r.uid; addById(cand.dataset.cand); return; }
  const own = e.target.closest("[data-own]");
  if (own) { const box = $(`#drawer [data-f="${own.dataset.own}"]`); box.focus(); box.select?.(); return; }
  const opt = e.target.closest(".opt"); if (!opt) return;
  const k = opt.dataset.k, c = r.consensus[k];
  const list = c.options.length ? c.options : presetCache[`${val(r, "trait_attribute")}|${val(r, "scale_class")}`] || [];
  choose(r, k, list[+opt.dataset.i].value);
  renderGrid(); openDrawer(r.uid);
});
function choose(r, k, v) { setField(r, k, v); }

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
    <div id="ownbox"><div class="opt own" data-own>✎ Write your own… <span class="kbd">W</span></div></div>
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
