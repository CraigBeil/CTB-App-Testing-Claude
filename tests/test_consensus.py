import consensus
import export
import xlrd


def test_parse_alternatives_orders_and_handles_parens_in_value():
    got = consensus.parse_alternatives("g (8); log (g/10 seed) (1); Measurement (31)")
    assert got[0] == {"value": "Measurement", "count": 31}
    assert {"value": "log (g/10 seed)", "count": 1} in got


def test_strong_consensus_autofills_top_option():
    t = consensus.get_trait("BICT:00001")  # plant height, 27 species
    assert t["fields"]["name"] == "PlantHeight"
    assert t["consensus"]["scale_class"]["level"] == "strong"
    assert t["fields"]["scale_class"] == "Numerical" and t["fields"]["units"] == "cm"


def test_contested_field_lists_most_likely_first():
    t = consensus.get_trait("BICT:00002")  # maturity time: method 39% agreement
    m = t["consensus"]["method_class"]
    assert m["level"] == "weak"
    counts = [o["count"] for o in m["options"]]
    assert counts == sorted(counts, reverse=True) and m["value"] == m["options"][0]["value"]


def test_single_source_is_limited_not_strong():
    row = consensus.db().execute("SELECT * FROM consensus_traits WHERE num_definitions=1 AND scale_alternatives!='' LIMIT 1").fetchone()
    assert consensus.suggest(row)["consensus"]["scale_class"]["level"] == "limited"


def test_search_ranks_exact_name_first():
    assert consensus.search("plant height")[0]["consensus_id"] == "BICT:00001"
    assert consensus.search("zzzzqqq") == []


def test_ordinal_without_categories_gets_presets():
    row = consensus.db().execute("SELECT * FROM consensus_traits WHERE scale_class='Ordinal' AND scale_categories='' LIMIT 1").fetchone()
    assert consensus.suggest(row)["consensus"]["scale_categories"]["options"]


def test_export_fills_data_sheet_and_forces_numerical_for_computation():
    f = consensus.get_trait("BICT:00010")["fields"] | {"scale_class": "Ordinal"}  # harvest index (Computation)
    open("/tmp/_t.xls", "wb").write(export.to_xls([f]))
    book = xlrd.open_workbook("/tmp/_t.xls")
    assert book.sheet_names() == ["README", "Data", "Example"]
    row = book.sheet_by_name("Data").row_values(1)
    assert row[0] == "HarvestIndex" and row[12] == "Numerical"
