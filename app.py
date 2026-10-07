from flask import Flask, jsonify, request, send_from_directory, Response

import consensus
import export

app = Flask(__name__, static_folder="static", static_url_path="")


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/meta")
def meta():
    return jsonify(consensus.stats() | {"method_classes": consensus.METHOD_CLASSES,
                                        "scale_classes": consensus.SCALE_CLASSES})


@app.get("/api/search")
def search():
    return jsonify(consensus.search(request.args.get("q", ""), int(request.args.get("limit", 8))))


@app.get("/api/trait/<consensus_id>")
def trait(consensus_id):
    t = consensus.get_trait(consensus_id)
    return (jsonify(t), 200) if t else (jsonify({"error": "not found"}), 404)


@app.get("/api/categories")
def categories():
    return jsonify(consensus.categories_presets(request.args.get("attribute", ""),
                                                request.args.get("scale_class", "Ordinal")))


@app.post("/api/match")
def match():
    """Bulk: match each pasted line to its best consensus trait and return full suggestions."""
    lines = [l.strip() for l in (request.get_json(force=True).get("lines") or []) if l.strip()][:300]
    results = []
    for line in lines:
        cands = consensus.search(line, limit=4)
        results.append({
            "query": line,
            "candidates": cands,
            "suggestion": consensus.get_trait(cands[0]["consensus_id"]) if cands else None,
        })
    return jsonify(results)


@app.post("/api/export/<fmt>")
def do_export(fmt):
    rows = request.get_json(force=True).get("rows") or []
    if fmt == "xls":
        return Response(export.to_xls(rows), mimetype="application/vnd.ms-excel",
                        headers={"Content-Disposition": "attachment; filename=trait_ontology.xls"})
    if fmt == "csv":
        return Response(export.to_csv(rows), mimetype="text/csv",
                        headers={"Content-Disposition": "attachment; filename=trait_ontology.csv"})
    return jsonify({"error": "format must be xls or csv"}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
