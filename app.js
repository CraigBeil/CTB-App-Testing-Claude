"use strict";
const L = window.OntologyLogic;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trunc = (s, n) => (s = String(s ?? ""), s.length > n ? s.slice(0, n - 1) + "…" : s);
const same = (a, b) => L.norm(a) === L.norm(b);

const TRAITS = L.loadTraits(window.CONSENSUS_DATA);
const TEXT_KEYS = ["full_name", "description", "tags", "trait_entity", "trait_attribute", "method_description"];
const CLASS_KEYS = ["method_class", "scale_class"];
const SCALE_LABEL = { "Date YYYY-MM-DD": "Date" };
const COMMON_UNITS = ["cm", "m", "mm", "g", "kg", "kg/ha", "t/ha", "%", "day", "count", "index", "ppm", "mg/g", "°C", "mL", "L", "score"];

const S = {
  results: [],   // ranked matches for the typed name
  hi: 0,         // keyboard-highlighted match
  selected: null,
  cons: {},      // field -> consensus { all:[{value,count}], total, kind }
  auto: {},      // field -> value the app filled in (to detect edits)
  scale: null,   // options for the chosen scale class
};

/* ---------- consensus helpers ---------- */
/* Turn logic.js results into one list of every value seen, with counts. */
function asDistribution(c) {
  if (!c) return null;
  const all = [];
  if (c.value && c.agreement != null) all.push({ value: c.value, count: Math.round(c.agreement * c.total) });
  all.push(...c.options.map(o => ({ value: o.value, count: o.count })));
  return { all, total: c.total, kind: c.kind, traits: c.traits };
}

/* Bar + % for the CURRENT value of a field, other options as chips, and an edited marker. */
function meterHtml(key, dist, current, autoValue) {
  if (!dist) return { cls: "", html: "" };
  const entry = dist.all.find(o => same(o.value, current));
  const share = dist.total ? (entry ? entry.count / dist.total : 0) : null;
  let lvl = L.level(share, dist.total), pct = share == null ? null : Math.round(share * 100), what;
  if (!dist.total) { lvl = current ? "limited" : "none"; what = current ? "single source — no alternatives recorded" : "no consensus data"; }
  else if (!entry && current) { lvl = "none"; what = "your own value — not used by the matching traits"; }
  else what = dist.kind === "similar"
    ? `of definitions across ${dist.traits} matching trait${dist.traits > 1 ? "s" : ""}`
    : `of ${dist.total} definitions agree`;
  const others = dist.all.filter(o => !same(o.value, current)).sort((a, b) => b.count - a.count);
  const chips = others.slice(0, 4).map(o => `<button class="chip" data-chip="${key}" data-v="${esc(o.value)}" title="${esc(o.value)} — ${o.count} definition${o.count > 1 ? "s" : ""}">${esc(trunc(SCALE_LABEL[o.value] || o.value, 42))}<small>${o.count}</small></button>`).join("");
  const edited = !same(current, autoValue);
  return {
    cls: lvl,
    html: `<div class="bar"><i style="width:${pct ?? 0}%"></i></div><span class="pct">${pct == null ? "—" : pct + "%"}</span><span class="what">${what}</span>
      ${others.length ? `<span class="others"><span>Others:</span>${chips}${others.length > 4 ? `<span>+${others.length - 4} more</span>` : ""}</span>` : ""}
      ${edited ? `<span class="ed">✎ edited</span><button class="link" data-reset="${key}">↺ use consensus</button>` : ""}`,
  };
}

function setMeter(el, m) { if (!el) return; el.className = `meter ${m.cls}`; el.innerHTML = m.html; }
function refreshMeter(key) {
  if (!S.selected) return;
  setMeter($(`[data-meter="${key}"]`), meterHtml(key, S.cons[key], $(`#${key}`).value, S.auto[key]));
}

/* ---------- matches (left) ---------- */
let searchTimer;
function runSearch() {
  S.results = L.searchTraits(TRAITS, $("#name").value, 15);
  S.hi = Math.max(0, S.results.findIndex(r => r.trait === S.selected));
  renderMatches();
}

function howCollected(t) {
  const scale = SCALE_LABEL[t.scale_class] || t.scale_class || "—";
  return `${esc(t.method_class || "—")} · ${esc(scale)}${t.scale_class === "Numerical" && t.units ? ` (${esc(t.units)})` : ""}`;
}

function renderMatches() {
  const q = $("#name").value.trim(), list = $("#matchList");
  $("#matchCount").textContent = S.results.length ? `(${S.results.length})` : "";
  if (!q) { list.innerHTML = `<p class="mempty">Start typing a trait name in <b>Name</b> to see matching traits from the consensus database.</p>`; return; }
  if (!S.results.length) { list.innerHTML = `<p class="mempty">No consensus trait matches “${esc(q)}”. You can still fill in every field yourself.</p>`; return; }
  list.innerHTML = S.results.map((r, i) => {
    const t = r.trait, m = Math.round(r.match * 100);
    const fit = r.exact ? `<span class="badge exact">Exact name match</span>`
      : `<div class="bar ${m >= 75 ? "strong" : m >= 50 ? "limited" : "weak"}"><i style="width:${m}%"></i></div><span>${m}% name match</span>${r.partial ? `<span class="badge partial">Partial</span>` : ""}`;
    return `<div class="match ${t === S.selected ? "sel" : ""} ${i === S.hi ? "hi" : ""}" data-i="${i}" role="button" tabindex="-1">
      <div class="mtop"><b>${esc(t.full_name)}</b><span class="species" title="${esc(t.species_list)}">${t.num_species} species</span></div>
      <div class="msub">${esc(t.name)} · ${t.num_definitions} definition${t.num_definitions > 1 ? "s" : ""}</div>
      <div class="mfit">${fit}</div>
      <div class="mhow"><b>How it's collected:</b> ${howCollected(t)}</div>
      ${t.method_description ? `<div class="mdesc">${esc(t.method_description)}</div>` : ""}
    </div>`;
  }).join("");
  $(".match.hi", list)?.scrollIntoView({ block: "nearest" });
}

$("#matchList").addEventListener("click", e => { const m = e.target.closest(".match"); if (m) select(+m.dataset.i); });

/* ---------- Name ---------- */
$("#name").addEventListener("input", () => { updateNameHint(); clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
$("#name").addEventListener("keydown", e => {
  if (!S.results.length) return;
  if (e.key === "ArrowDown") { S.hi = Math.min(S.hi + 1, S.results.length - 1); renderMatches(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { S.hi = Math.max(S.hi - 1, 0); renderMatches(); e.preventDefault(); }
  else if (e.key === "Enter") { e.preventDefault(); select(S.hi); }
});

function updateNameHint() {
  const v = $("#name").value, h = $("#nameHint"), msgs = [];
  let bad = false;
  if (v.length > 16) { msgs.push("Name must be 16 characters or fewer"); bad = true; }
  if (/[.\[\]{}()]/.test(v)) { msgs.push("No periods or brackets"); bad = true; }
  let html = `${v.length}/16 characters${msgs.length ? " · " + msgs.join(" · ") : ""}`;
  const short = S.selected && L.shortName(S.selected);
  if (short && v !== short) html += ` · Suggested short name: <b>${esc(short)}</b> <button class="link" data-usename>use it</button>`;
  h.innerHTML = v || S.selected ? html : "";
  h.classList.toggle("err", bad);
}

/* ---------- selecting a trait fills the form ---------- */
function select(i) {
  const r = S.results[i]; if (!r) return;
  const t = r.trait;
  S.selected = t; S.hi = i;
  // agreement for free-text fields is measured across the traits that contain every typed word
  const pool = S.results.filter(x => !x.partial).map(x => x.trait);
  if (!pool.includes(t)) pool.unshift(t);
  S.cons = {}; S.auto = {};
  for (const k of TEXT_KEYS) { S.cons[k] = asDistribution(L.textConsensus(t, pool, k)); S.auto[k] = t[k] || ""; }
  for (const k of CLASS_KEYS) { const c = L.classConsensus(t, k); S.cons[k] = asDistribution(c); S.auto[k] = c.value || t[k] || ""; }
  S.auto.method_formula = t.method_formula || "";
  for (const k of [...TEXT_KEYS, ...CLASS_KEYS, "method_formula"]) { const el = $(`#${k}`); el.value = S.auto[k]; markEdited(el, k); }
  $("#synonyms").textContent = t.synonyms || "—";
  S.scale = null;
  onMethodChange(false);
  if ($("#method_class").value !== "Computation") setScale(S.auto.scale_class);
  $$("textarea").forEach(autosize);
  [...TEXT_KEYS, ...CLASS_KEYS].forEach(refreshMeter);
  renderMatches(); updateNameHint(); updateCompose();
}

/* ---------- method class rules ---------- */
function onMethodChange(applyScale = true) {
  const comp = $("#method_class").value === "Computation";
  $("#formulaRow").hidden = !comp;
  $("#scale_class").disabled = comp;
  $("#scaleNote").textContent = comp ? "Set to Numerical automatically for Computation methods" : "Note: additional options for this field will appear after selection";
  if (comp && (applyScale || !S.scale || S.scale.cls !== "Numerical")) setScale("Numerical");
  refreshMeter("method_class"); refreshMeter("scale_class"); updateCompose();
}

/* ---------- scale class and its options ---------- */
const numStr = v => (v === "" || v == null ? "" : String(Number.isInteger(+v) ? +v : v));

/* Fill the options for a scale class from the best-matched trait that uses that class. */
function setScale(cls) {
  $("#scale_class").value = cls || "";
  const pool = S.results.filter(r => !r.partial).map(r => r.trait);  // only traits that contain every typed word
  const src = cls ? L.scaleSource(S.selected, pool, cls) : null;
  const sc = { cls, src, dateMode: "calendar", units: "", min: "", max: "", decimals: "", cats: [], nominal: [], unitsDist: null, catsInfo: null };
  if (src) {
    if (cls === "Numerical") {
      const u = L.classConsensus(src, "units");
      sc.unitsDist = asDistribution(u); sc.units = u.value || src.units || "";
      sc.min = numStr(src.scale_lower_limit); sc.max = numStr(src.scale_upper_limit); sc.decimals = numStr(src.scale_decimal_places);
    }
    if (cls === "Ordinal") sc.cats = L.parseCategories(src.scale_categories);
    if (cls === "Nominal") sc.nominal = L.nominalCategories(src.scale_categories);
    if (cls === "Ordinal" || cls === "Nominal") {
      const a = L.pct(src.categories_agreement) ?? (src.num_definitions <= 1 ? 1 : null);
      sc.catsInfo = { agreement: a, total: src.num_definitions, level: L.level(a, src.num_definitions) };
    }
    if (cls === "Date YYYY-MM-DD") sc.dateMode = L.dateMode(src);
  }
  if (cls === "Ordinal" && !sc.cats.length) sc.cats = [["", ""]];
  if (cls === "Nominal" && !sc.nominal.length) sc.nominal = [""];
  sc.auto = JSON.parse(JSON.stringify({ units: sc.units, cats: sc.cats, nominal: sc.nominal, dateMode: sc.dateMode }));
  S.scale = sc;
  renderScaleExtra(); refreshMeter("scale_class");
}

function srcNote(sc) {
  if (!S.selected) return "";
  if (!sc.src) return `<div class="src">No matching trait uses this scale — enter the details yourself.</div>`;
  if (sc.src === S.selected) return `<div class="src">Filled from <b>${esc(sc.src.full_name)}</b>.</div>`;
  return `<div class="src">Filled from a similar trait that uses this scale: <b>${esc(sc.src.full_name)}</b> (${sc.src.num_species} species).</div>`;
}

function catsMeter(sc) {
  const c = sc.catsInfo; if (!c) return "";
  const p = c.agreement == null ? null : Math.round(c.agreement * 100);
  const edited = JSON.stringify(sc.cls === "Ordinal" ? sc.cats : sc.nominal) !== JSON.stringify(sc.cls === "Ordinal" ? sc.auto.cats : sc.auto.nominal);
  return `<div class="meter ${c.level}" data-catsmeter><div class="bar"><i style="width:${p ?? 0}%"></i></div><span class="pct">${p == null ? "—" : p + "%"}</span>
    <span class="what">${p == null ? "no agreement data" : `of ${c.total} definition${c.total > 1 ? "s" : ""} use these categories`}</span>
    ${edited ? `<span class="ed">✎ edited</span><button class="link" data-reset="cats">↺ use consensus</button>` : ""}</div>`;
}

function renderScaleExtra() {
  const sc = S.scale, box = $("#scaleExtra");
  if (!sc || !sc.cls) { box.innerHTML = ""; return; }
  if (sc.cls === "Text") { box.innerHTML = `<div class="row"><label></label><div class="ctl"><div class="hint">Text scales take free text — no extra options needed.</div></div></div>`; return; }
  if (sc.cls === "Date YYYY-MM-DD") {
    const r = (v, title, sub) => `<label class="radio"><input type="radio" name="datemode" value="${v}" ${sc.dateMode === v ? "checked" : ""}><span>${title}<small>${sub}</small></span></label>`;
    box.innerHTML = `<div class="row"><label>Format<span class="req">*</span></label><div class="ctl">${srcNote(sc)}
      <div class="radios">${r("calendar", "Calendar date", "Recorded as YYYY-MM-DD, e.g. 2026-06-15")}${r("julian", "Julian day", "Day of the year, 1–366")}</div></div></div>`;
    return;
  }
  if (sc.cls === "Numerical") {
    const units = [...new Set([...(sc.unitsDist?.all || []).map(o => o.value), ...COMMON_UNITS])];
    box.innerHTML = `<div class="row"><label for="units">Unit<span class="req">*</span></label><div class="ctl">${srcNote(sc)}
        <input class="scale-in" id="units" data-s="units" list="dl-units" value="${esc(sc.units)}" placeholder="Can be any measurable unit">
        <datalist id="dl-units">${units.map(u => `<option value="${esc(u)}">`).join("")}</datalist>
        <div class="meter" data-meter="units"></div></div></div>
      <div class="row"><label></label><div class="ctl"><div class="nums">
        <div><label for="smin">Min</label><input class="scale-in" id="smin" data-s="min" type="number" step="1" value="${esc(sc.min)}" placeholder="Minimum Valid Value"><div class="hint">Enter integer value only.</div></div>
        <div><label for="smax">Max</label><input class="scale-in" id="smax" data-s="max" type="number" step="1" value="${esc(sc.max)}" placeholder="Maximum Valid Value"><div class="hint">Enter integer value only.</div></div>
        <div><label for="sdec">Decimals</label><input class="scale-in" id="sdec" data-s="decimals" type="number" min="0" step="1" value="${esc(sc.decimals)}" placeholder="Decimal Places"><div class="hint">Leave blank for integer type.</div></div>
      </div></div></div>`;
    refreshUnitsMeter();
    return;
  }
  const ordinal = sc.cls === "Ordinal";
  const rows = ordinal
    ? sc.cats.map((c, i) => `<div class="cat"><input class="scale-in" data-ci="${i}" data-part="0" value="${esc(c[0])}" placeholder="Value"><span class="eq">=</span><input class="scale-in" data-ci="${i}" data-part="1" value="${esc(c[1])}" placeholder="Category"><button class="del" data-delcat="${i}" title="Remove">✕</button></div>`)
    : sc.nominal.map((c, i) => `<div class="cat nominal"><input class="scale-in" data-ni="${i}" value="${esc(c)}" placeholder="Category"><button class="del" data-delcat="${i}" title="Remove">✕</button></div>`);
  box.innerHTML = `<div class="row"><label>Categories<span class="req">*</span></label><div class="ctl">${srcNote(sc)}${catsMeter(sc)}
    <div class="cats" style="margin-top:6px">${rows.join("")}</div>
    <button class="link addcat" data-addcat>+ Add category</button>
    <div class="hint">${ordinal ? "Each category needs a value and its meaning, e.g. 1 = Very low." : "List each allowed category."} “=” and “;” can't be used.</div></div></div>`;
}

function refreshUnitsMeter() {
  const sc = S.scale; if (!sc || sc.cls !== "Numerical") return;
  setMeter($('[data-meter="units"]'), sc.unitsDist ? meterHtml("units", sc.unitsDist, sc.units, sc.auto.units) : { cls: "", html: "" });
}
function refreshCatsMeter() { const el = $("[data-catsmeter]"); if (el) el.outerHTML = catsMeter(S.scale); }

/* ---------- editing ---------- */
function autosize(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; }

function updateCompose() {
  const t = `${$("#trait_entity").value} ${$("#trait_attribute").value}`.trim();
  const m = `${$("#method_description").value} ${$("#method_class").value}`.trim();
  $("#traitCompose").textContent = t ? ` = ${trunc(t, 90)}` : "";
  $("#methodCompose").textContent = m ? ` = ${trunc(m, 90)}` : "";
}

function markEdited(el, key) { el.classList.toggle("edited-field", !!S.selected && key in S.auto && !same(el.value, S.auto[key])); }

document.addEventListener("input", e => {
  const el = e.target;
  if (el.tagName === "TEXTAREA") autosize(el);
  const k = el.dataset.f;
  if (k) { markEdited(el, k); refreshMeter(k); updateCompose(); return; }
  const sc = S.scale; if (!sc) return;
  if (el.dataset.s) { sc[el.dataset.s] = el.value; if (el.dataset.s === "units") refreshUnitsMeter(); return; }
  if (el.dataset.ci != null) { el.value = el.value.replace(/[=;]/g, ""); sc.cats[+el.dataset.ci][+el.dataset.part] = el.value; return refreshCatsMeter(); }
  if (el.dataset.ni != null) { el.value = el.value.replace(/[=;]/g, ""); sc.nominal[+el.dataset.ni] = el.value; return refreshCatsMeter(); }
});

document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "method_class") { markEdited(el, "method_class"); return onMethodChange(true); }
  if (el.id === "scale_class") { markEdited(el, "scale_class"); return setScale(el.value); }
  if (el.name === "datemode") S.scale.dateMode = el.value;
  if (el.id === "active") el.previousElementSibling.textContent = el.checked ? "Active" : "Archived";
});

function setFieldValue(key, v) {
  const el = $(`#${key}`); el.value = v; markEdited(el, key);
  if (el.tagName === "TEXTAREA") autosize(el);
  if (key === "method_class") return onMethodChange(true);
  if (key === "scale_class") return setScale(v);
  refreshMeter(key); updateCompose();
}

document.addEventListener("click", e => {
  const chip = e.target.closest("[data-chip]");
  if (chip) {
    if (chip.dataset.chip === "units") { S.scale.units = chip.dataset.v; $("#units").value = chip.dataset.v; return refreshUnitsMeter(); }
    return setFieldValue(chip.dataset.chip, chip.dataset.v);
  }
  const reset = e.target.closest("[data-reset]");
  if (reset) {
    const k = reset.dataset.reset, sc = S.scale;
    if (k === "units") { sc.units = sc.auto.units; $("#units").value = sc.units; return refreshUnitsMeter(); }
    if (k === "cats") { sc.cats = JSON.parse(JSON.stringify(sc.auto.cats)); sc.nominal = [...sc.auto.nominal]; return renderScaleExtra(); }
    return setFieldValue(k, S.auto[k]);
  }
  if (e.target.closest("[data-addcat]")) {
    const sc = S.scale, ordinal = sc.cls === "Ordinal";
    if (ordinal) {
      const nums = sc.cats.map(c => parseFloat(c[0])).filter(Number.isFinite);
      sc.cats.push([nums.length ? String(Math.max(...nums) + 1) : "", ""]);
    } else sc.nominal.push("");
    renderScaleExtra();
    const rows = $$("#scaleExtra .cat"), last = rows[rows.length - 1];
    return last?.querySelector(ordinal ? '[data-part="1"]' : "input")?.focus();
  }
  const del = e.target.closest("[data-delcat]");
  if (del) { const sc = S.scale; (sc.cls === "Ordinal" ? sc.cats : sc.nominal).splice(+del.dataset.delcat, 1); return renderScaleExtra(); }
  if (e.target.closest("[data-usename]")) { $("#name").value = L.shortName(S.selected); updateNameHint(); }
});

/* ---------- start ---------- */
(function init() {
  const species = new Set();
  for (const t of TRAITS) for (const s of String(t.species_list || "").split("; ")) if (s) species.add(s);
  $("#dbstats").textContent = `${TRAITS.length.toLocaleString()} consensus traits from ${species.size} species`;
  const fill = (id, values) => { $(id).innerHTML = [...values].sort().map(v => `<option value="${esc(v)}">`).join(""); };
  fill("#dl-tags", new Set(TRAITS.flatMap(t => String(t.tags || "").split(";").map(s => s.trim()).filter(Boolean))));
  fill("#dl-entity", new Set(TRAITS.map(t => t.trait_entity).filter(Boolean)));
  fill("#dl-attribute", new Set(TRAITS.map(t => t.trait_attribute).filter(Boolean)));
  $("#name").focus();
})();
