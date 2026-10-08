"""Export data/consensus_traits.db to data/traits.js so the app runs in any browser with no server.

Run again whenever the database is updated:  python3 tools/build_data.py
"""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COLUMNS = [
    "consensus_id", "name", "full_name", "description", "synonyms", "tags", "trait_entity", "trait_attribute",
    "method_description", "method_class", "method_formula", "scale_class", "units", "scale_decimal_places",
    "scale_lower_limit", "scale_upper_limit", "scale_categories", "num_species", "species_list", "num_definitions",
    "method_agreement", "method_alternatives", "scale_agreement", "scale_alternatives", "units_alternatives",
    "categories_agreement",
]


def main():
    conn = sqlite3.connect(ROOT / "data" / "consensus_traits.db")
    rows = conn.execute(f"SELECT {', '.join(COLUMNS)} FROM consensus_traits ORDER BY num_species DESC, consensus_id").fetchall()
    clean = [[("" if v is None else v.replace("​", "").strip() if isinstance(v, str) else v) for v in r] for r in rows]
    payload = json.dumps({"columns": COLUMNS, "rows": clean}, ensure_ascii=False, separators=(",", ":"))
    out = ROOT / "data" / "traits.js"
    out.write_text(f"// Generated from consensus_traits.db by tools/build_data.py. Do not edit by hand.\nwindow.CONSENSUS_DATA = {payload};\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(rows)} traits, {out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
