"""Consensus-trait lookups: search, per-field consensus scoring, and autofill suggestions."""
import math
import re
import sqlite3
from functools import lru_cache
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "consensus_traits.db"

# A field is "strong" when this share of definitions agree AND enough definitions back it up.
STRONG_AGREEMENT = 0.75
STRONG_MIN_DEFINITIONS = 3

METHOD_CLASSES = ["Observation", "Measurement", "Counting", "Estimation", "Computation"]
SCALE_CLASSES = ["Date YYYY-MM-DD", "Nominal", "Numerical", "Ordinal", "Text"]

_ALT_RE = re.compile(r"^(.*?)\s*\((\d+)\)$")


def connect():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


_conn = None


def db():
    global _conn
    if _conn is None:
        _conn = connect()
    return _conn


def parse_alternatives(text):
    """'Measurement (31); Computation (6)' -> [{'value': 'Measurement', 'count': 31}, ...]"""
    out = []
    for part in (text or "").split("; "):
        part = part.strip()
        if not part:
            continue
        m = _ALT_RE.match(part)
        if m:
            out.append({"value": m.group(1).strip(), "count": int(m.group(2))})
    out.sort(key=lambda o: -o["count"])
    return out


def pct(text):
    try:
        return float(str(text).strip().rstrip("%")) / 100
    except (ValueError, AttributeError):
        return None


def _level(agreement, total):
    """strong: clear majority with enough sources; limited: 1-2 sources, all agree;
    weak: contested, the user should choose."""
    if agreement is None or not total:
        return "none"
    if agreement >= STRONG_AGREEMENT and total >= STRONG_MIN_DEFINITIONS:
        return "strong"
    if agreement >= 1 and total < STRONG_MIN_DEFINITIONS:
        return "limited"
    if agreement >= STRONG_AGREEMENT and total < STRONG_MIN_DEFINITIONS:
        return "limited"
    return "weak"


def _option_field(alternatives_text, fallback_value, fixed_choices=None):
    options = parse_alternatives(alternatives_text)
    if fixed_choices:  # method/scale class: keep only values the template accepts
        options = [o for o in options if o["value"] in fixed_choices] or []
    total = sum(o["count"] for o in options)
    if options:
        agreement = options[0]["count"] / total
        level = _level(agreement, total)
        value = options[0]["value"]
    else:
        agreement, level, value = None, ("none" if not fallback_value else "limited"), fallback_value or ""
        if fallback_value:
            options = [{"value": fallback_value, "count": 1}]
            total, agreement = 1, 1.0
    return {"value": value, "options": options, "total": total, "agreement": agreement, "level": level}


def _to_int(v):
    if v is None or v == "":
        return ""
    return int(v) if float(v).is_integer() else v


def categories_presets(attribute, scale_class, exclude=None, limit=6):
    """Most common category sets used by similar traits (same attribute first, then overall)."""
    seen, out = set(), []
    if exclude:
        seen.add(exclude)
    queries = []
    if attribute:
        queries.append(("same attribute", "AND lower(trait_attribute)=lower(?)", [attribute]))
    queries.append(("commonly used", "", []))
    for label, extra, args in queries:
        rows = db().execute(
            f"""SELECT scale_categories AS cats, COUNT(*) AS n FROM consensus_traits
                WHERE scale_class=? AND scale_categories!='' {extra}
                GROUP BY scale_categories ORDER BY n DESC LIMIT 12""",
            [scale_class] + args,
        ).fetchall()
        for r in rows:
            if r["cats"] in seen:
                continue
            seen.add(r["cats"])
            out.append({"value": r["cats"], "count": r["n"], "source": label})
            if len(out) >= limit:
                return out
    return out


def _display_name(row):
    """The DB clips names to 16 chars mid-word (e.g. 'DroughtToleranc'); rebuild a clean CamelCase
    name from the full name when it fits, otherwise keep the stored one."""
    words = re.findall(r"[A-Za-z0-9]+", row["full_name"] or "")
    camel = "".join(w[0].upper() + w[1:] for w in words)
    return camel if camel and len(camel) <= 16 else row["name"]


def suggest(row):
    """Build the autofill payload for one consensus_traits row."""
    method = _option_field(row["method_alternatives"], row["method_class"], METHOD_CLASSES)
    scale = _option_field(row["scale_alternatives"], row["scale_class"], SCALE_CLASSES)
    units = _option_field(row["units_alternatives"], row["units"])
    if not units["options"] and row["units"]:
        units = _option_field("", row["units"])

    n_def = row["num_definitions"] or 0
    cat_agree = pct(row["categories_agreement"])
    cats_value = row["scale_categories"] or ""
    if cats_value:
        cat_level = _level(cat_agree if cat_agree is not None else 1.0, n_def)
    else:
        cat_level = "none"
    categories = {
        "value": cats_value,
        "agreement": cat_agree,
        "total": n_def,
        "level": cat_level,
        "options": categories_presets(row["trait_attribute"], scale["value"], exclude=cats_value)
        if scale["value"] in ("Ordinal", "Nominal")
        else [],
    }
    if cats_value:
        categories["options"].insert(0, {"value": cats_value, "count": n_def, "source": "consensus"})

    fields = {
        "name": _display_name(row),
        "full_name": row["full_name"] or "",
        "term_type": row["term_type"] or "Phenotype",
        "description": row["description"] or "",
        "synonyms": row["synonyms"] or "",
        "status": row["status"] or "active",
        "tags": row["tags"] or "",
        "trait_entity": row["trait_entity"] or "",
        "trait_attribute": row["trait_attribute"] or "",
        "method_description": (row["method_description"] or "").replace("​", "").strip(),
        "method_class": method["value"],
        "method_formula": row["method_formula"] or "",
        "scale_class": scale["value"],
        "units": units["value"],
        "scale_decimal_places": _to_int(row["scale_decimal_places"]),
        "scale_lower_limit": _to_int(row["scale_lower_limit"]),
        "scale_upper_limit": _to_int(row["scale_upper_limit"]),
        "scale_categories": cats_value,
    }
    return {
        "consensus_id": row["consensus_id"],
        "source": {
            "num_species": row["num_species"],
            "species": [s for s in (row["species_list"] or "").split("; ") if s],
            "num_definitions": n_def,
        },
        "fields": fields,
        "consensus": {
            "method_class": method,
            "scale_class": scale,
            "units": units,
            "scale_categories": categories,
        },
    }


def get_trait(consensus_id):
    row = db().execute("SELECT * FROM consensus_traits WHERE consensus_id=?", (consensus_id,)).fetchone()
    return suggest(row) if row else None


def summary(row, score=None):
    method = parse_alternatives(row["method_alternatives"])
    scale = parse_alternatives(row["scale_alternatives"])
    return {
        "consensus_id": row["consensus_id"],
        "name": row["name"],
        "full_name": row["full_name"],
        "trait_entity": row["trait_entity"],
        "trait_attribute": row["trait_attribute"],
        "tags": row["tags"],
        "description": row["description"],
        "num_species": row["num_species"],
        "num_definitions": row["num_definitions"],
        "method_class": row["method_class"],
        "scale_class": row["scale_class"],
        "method_level": _level(method[0]["count"] / sum(o["count"] for o in method), sum(o["count"] for o in method)) if method else "none",
        "scale_level": _level(scale[0]["count"] / sum(o["count"] for o in scale), sum(o["count"] for o in scale)) if scale else "none",
        "score": score,
    }


def _tokens(q):
    return re.findall(r"[A-Za-z0-9]+", q.lower())


def search(q, limit=8):
    """Rank consensus traits for a free-text query (name, synonym, entity, attribute...)."""
    q = (q or "").strip()
    toks = _tokens(q)
    if not toks:
        return []
    cols = "bm25(traits_fts, 0, 10, 6, 2, 3, 1, 1)"
    found = {}
    for joiner in (" AND ", " OR "):
        match = joiner.join(f'"{t}"*' for t in toks)
        rows = db().execute(
            f"""SELECT c.*, {cols} AS rank FROM traits_fts
                JOIN consensus_traits c ON c.rowid = traits_fts.rowid
                WHERE traits_fts MATCH ? ORDER BY rank LIMIT 60""",
            (match,),
        ).fetchall()
        for r in rows:
            found.setdefault(r["consensus_id"], (r, -r["rank"]))
        if len(found) >= limit:
            break
    squashed = "".join(toks)
    for r in db().execute(
        "SELECT * FROM consensus_traits WHERE lower(name) LIKE ? LIMIT 20", (f"%{squashed}%",)
    ):
        found.setdefault(r["consensus_id"], (r, 1.0))

    scored = []
    for r, base in found.values():
        full = " ".join(_tokens(r["full_name"] or ""))
        syns = [" ".join(_tokens(s)) for s in (r["synonyms"] or "").split(";")]
        norm_q = " ".join(toks)
        bonus = 0
        if full == norm_q or r["name"].lower() == squashed:
            bonus = 100
        elif norm_q in syns:
            bonus = 80
        elif full.startswith(norm_q):
            bonus = 25
        elif set(toks) <= set(full.split()):
            bonus = 15
        # popular traits are better-evidenced, so prefer them among near-equal matches
        score = base + bonus + 3 * math.log1p(r["num_species"] or 1)
        scored.append((score, r))
    scored.sort(key=lambda x: -x[0])
    return [dict(summary(r, round(s, 1)), exact=(s >= 100)) for s, r in scored[:limit]]


def stats():
    r = db().execute("SELECT COUNT(*) n, MAX(num_species) m FROM consensus_traits").fetchone()
    species = set()
    for (s,) in db().execute("SELECT DISTINCT species_list FROM consensus_traits"):
        species.update(x for x in (s or "").split("; ") if x)
    return {"traits": r["n"], "species": len(species)}
