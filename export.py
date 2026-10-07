"""Write rows into the team's ontology template (.xls) or CSV."""
import csv
import io
from pathlib import Path

import xlrd
from xlutils.copy import copy as copy_workbook

TEMPLATE = Path(__file__).parent / "data" / "ontology_template.xls"

# (template header, field key) in template column order
COLUMNS = [
    ("Name", "name"), ("Full Name", "full_name"), ("Term Type", "term_type"),
    ("Description", "description"), ("Synonyms", "synonyms"), ("Status", "status"),
    ("Tags", "tags"), ("Trait Entity", "trait_entity"), ("Trait Attribute", "trait_attribute"),
    ("Method Description", "method_description"), ("Method Class", "method_class"),
    ("Method Formula", "method_formula"), ("Scale Class", "scale_class"), ("Units", "units"),
    ("Scale Decimal Places", "scale_decimal_places"), ("Scale Lower Limit", "scale_lower_limit"),
    ("Scale Upper Limit", "scale_upper_limit"), ("Scale Categories", "scale_categories"),
]
NUMERIC = {"scale_decimal_places", "scale_lower_limit", "scale_upper_limit"}


def _cell(key, value):
    if value is None or value == "":
        return ""
    if key in NUMERIC:
        try:
            f = float(value)
            return int(f) if f.is_integer() else f
        except (TypeError, ValueError):
            return str(value)
    return str(value).strip()


def prepare(rows):
    out = []
    for r in rows:
        r = dict(r)
        if r.get("method_class") == "Computation":  # template: scale is forced to Numerical
            r["scale_class"] = "Numerical"
        out.append([_cell(k, r.get(k)) for _, k in COLUMNS])
    return out


def to_csv(rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([h for h, _ in COLUMNS])
    w.writerows(prepare(rows))
    return buf.getvalue().encode("utf-8-sig")


def to_xls(rows):
    """Fill the 'Data' sheet of the real template so README/Example sheets stay intact."""
    book = xlrd.open_workbook(TEMPLATE, formatting_info=True)
    names = book.sheet_names()
    out = copy_workbook(book)
    sheet = out.get_sheet(names.index("Data"))
    for i, values in enumerate(prepare(rows), start=1):
        for j, v in enumerate(values):
            if v != "":
                sheet.write(i, j, v)
    buf = io.BytesIO()
    out.save(buf)
    return buf.getvalue()
