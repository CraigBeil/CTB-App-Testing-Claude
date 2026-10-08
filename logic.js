/* Matching and consensus logic. No DOM here, so it runs in the browser and under `node --test`. */
(function (root) {
  "use strict";

  // A field is "strong" when this share of definitions agree AND enough definitions back it up.
  const STRONG_AGREEMENT = 0.75;
  const STRONG_MIN_DEFINITIONS = 3;

  function loadTraits(data) {
    return data.rows.map(r => Object.fromEntries(data.columns.map((c, i) => [c, r[i]])));
  }

  const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
  const tokens = s => norm(s).split(" ").filter(Boolean);
  const splitCamel = s => String(s ?? "").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2");
  const synonymsOf = t => String(t.synonyms || "").split(";").map(s => s.trim()).filter(Boolean);

  /* 'Measurement (31); Computation (6)' -> [{value:'Measurement', count:31}, ...] sorted by count */
  function parseAlternatives(text) {
    const out = [];
    for (const part of String(text || "").split("; ")) {
      const m = part.trim().match(/^(.*?)\s*\((\d+)\)$/);
      if (m) out.push({ value: m[1].trim(), count: +m[2] });
    }
    return out.sort((a, b) => b.count - a.count);
  }

  const pct = text => { const n = parseFloat(String(text ?? "").replace("%", "")); return Number.isFinite(n) ? n / 100 : null; };

  /* strong: clear majority with enough sources; limited: 1-2 sources; weak: contested */
  function level(agreement, total) {
    if (agreement == null || !total) return "none";
    if (total < STRONG_MIN_DEFINITIONS) return agreement >= STRONG_AGREEMENT ? "limited" : "weak";
    return agreement >= STRONG_AGREEMENT ? "strong" : "weak";
  }

  /* Dice similarity of two token lists; a query token also matches a word it is a prefix of. */
  function tokenSimilarity(q, t) {
    if (!q.length || !t.length) return 0;
    const used = new Set(); let hit = 0;
    for (const a of q) {
      const i = t.findIndex((b, j) => !used.has(j) && (b === a || b.startsWith(a)));
      if (i >= 0) { used.add(i); hit++; }
    }
    return (2 * hit) / (q.length + t.length);
  }

  function isExact(t, q) {
    const nq = norm(q), squashed = nq.replace(/ /g, "");
    if (!nq) return false;
    return norm(t.full_name) === nq || String(t.name).toLowerCase() === squashed || synonymsOf(t).some(s => norm(s) === nq);
  }

  /* How well the trait's name (full name, short name or a synonym) matches what the user typed, 0..1. */
  function nameMatch(t, q) {
    if (isExact(t, q)) return 1;
    const qt = tokens(splitCamel(q));
    return Math.max(...[t.full_name, splitCamel(t.name), ...synonymsOf(t)].map(s => tokenSimilarity(qt, tokens(s))));
  }

  /* Rank: exact name match first, then by number of species (desc), then by name match.
     Traits containing every typed word come before traits containing only some of them. */
  function searchTraits(traits, query, limit = 12) {
    const qt = tokens(splitCamel(query));
    if (!qt.length) return [];
    const full = [], partial = [];
    for (const t of traits) {
      const words = tokens([t.full_name, splitCamel(t.name), t.synonyms].join(" "));
      const hits = qt.filter(a => words.some(w => w === a || w.startsWith(a))).length;
      if (hits === qt.length) full.push(t);
      else if (qt.length > 1 && hits >= Math.ceil(qt.length / 2)) partial.push(t);
    }
    const rank = list => list
      .map(t => ({ trait: t, exact: isExact(t, query), match: nameMatch(t, query) }))
      .sort((a, b) => (b.exact - a.exact) || (b.trait.num_species - a.trait.num_species) || (b.match - a.match));
    const out = rank(full);
    if (out.length < limit) out.push(...rank(partial).map(r => ({ ...r, partial: true })));
    return out.slice(0, limit);
  }

  /* Agreement for a free-text field across the matching traits, weighted by how many definitions each has. */
  function textConsensus(selected, candidates, key) {
    const groups = new Map();
    let total = 0;
    for (const t of candidates) {
      const v = String(t[key] ?? "").trim(); if (!v) continue;
      const w = Math.max(1, t.num_definitions || 1), k = norm(v) || v;
      total += w;
      const g = groups.get(k) || { value: v, count: 0, traits: 0 };
      g.count += w; g.traits++; groups.set(k, g);
    }
    const value = String(selected[key] ?? "").trim();
    const mine = groups.get(norm(value) || value);
    const agreement = value && total ? (mine ? mine.count : 0) / total : null;
    const options = [...groups.values()].filter(g => g !== mine).sort((a, b) => b.count - a.count);
    return { value, agreement, total, traits: candidates.length, options, level: level(agreement, total), kind: "similar" };
  }

  /* Agreement for method class / scale class / units, straight from the database's alternatives. */
  function classConsensus(t, key) {
    const alt = { method_class: "method_alternatives", scale_class: "scale_alternatives", units: "units_alternatives" }[key];
    const options = parseAlternatives(t[alt]);
    const total = options.reduce((a, o) => a + o.count, 0);
    if (!options.length) {
      const v = String(t[key] ?? "").trim();
      return { value: v, agreement: null, total: 0, options: [], level: v ? "limited" : "none", kind: "definitions" };
    }
    return { value: options[0].value, agreement: options[0].count / total, total, options: options.slice(1), level: level(options[0].count / total, total), kind: "definitions" };
  }

  /* "1=Low; 2=High" -> [["1","Low"],["2","High"]] */
  function parseCategories(text) {
    return String(text || "").split(";").map(s => s.trim()).filter(Boolean).map(p => {
      const i = p.indexOf("="); return i < 0 ? [p, ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    });
  }

  /* Nominal scales need only the category names; use the label when the source stored "1=White". */
  function nominalCategories(text) {
    const pairs = parseCategories(text), anyLabel = pairs.some(p => p[1]);
    return pairs.filter(p => p[1] || !anyLabel).map(p => p[1] || p[0]);
  }

  /* Where to take units / categories / limits from for a scale class: the selected trait if it uses
     that class, otherwise the best-ranked matching trait that does. */
  function scaleSource(selected, candidates, scaleClass) {
    const has = t => t.scale_class === scaleClass && (
      scaleClass === "Numerical" ? !!t.units : (scaleClass === "Ordinal" || scaleClass === "Nominal") ? !!t.scale_categories : true);
    if (selected && has(selected)) return selected;
    return candidates.find(has) || null;
  }

  /* The database clips names to 16 characters mid-word (e.g. "DroughtToleranc"); rebuild a clean
     CamelCase name from the full name when it fits, otherwise keep the stored one. */
  function shortName(t) {
    const camel = String(t.full_name || "").split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join("");
    return camel && camel.length <= 16 ? camel : t.name;
  }

  /* Date traits default to a calendar date unless their units mention Julian days. */
  const dateMode = t => /julian/i.test(`${t?.units || ""} ${t?.units_alternatives || ""}`) ? "julian" : "calendar";

  const api = { STRONG_AGREEMENT, STRONG_MIN_DEFINITIONS, loadTraits, norm, tokens, parseAlternatives, pct, level, nameMatch, isExact,
    searchTraits, shortName, textConsensus, classConsensus, parseCategories, nominalCategories, scaleSource, dateMode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OntologyLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
