# Trait Ontology Builder

Fast, consensus-driven creation of trait ontology files for crops without an established ontology.
Search (or paste a list of) trait names → each is autofilled from `data/consensus_traits.db`
(4,447 traits across 35 species) → export directly into the team's ontology template (`.xls`) or CSV.

## Run

    pip install -r requirements.txt
    python app.py          # http://localhost:5000
    python -m pytest

## How consensus drives autofill

For method class, scale class and units the DB stores every alternative with a count
(`Measurement (31); Computation (6)`). Each field gets a level:

| Level | Rule | Behaviour |
|---|---|---|
| **strong** (green) | ≥75% of definitions agree **and** ≥3 definitions | autofilled |
| **limited** (blue) | only 1–2 definitions, all agree | autofilled, flagged as thin evidence |
| **weak** (amber) | contested | prefilled with the most likely answer but must be confirmed; options ranked by count |
| none | no data | required field left for the user |

Thresholds live at the top of `consensus.py`. Contested fields are cleared fast via **Review N decisions**:
keys `1`–`9` choose, `Enter` takes the most likely, `S` skips. For ordinal/nominal traits with no
consensus categories (or low agreement), common category sets from traits with the same attribute are offered.

Validation follows the template README (name ≤16 chars/unique/no periods or brackets, description, entity,
attribute, method class required; formula for Computation; units for Numerical; categories for Ordinal/Nominal).
Computation methods force Scale Class = Numerical, as the template specifies. The export fills the real template's
`Data` sheet, leaving README/Example intact. Drafts persist in the browser (localStorage).

## The form

Each trait is shown as one "Ontology Term" form modelled on DeltaBreed's own (labels on the left, all fields on one screen):
Term Type, Name, Full Name, Description, Synonyms, Tags, Entity + Attribute, Method description + class (+ formula for
Computation), Scale class, Unit, Min/Max/Decimals, and Categories. The left list switches between traits; **Table** shows
all traits as a spreadsheet-style grid.

**Consensus match bar** — at the top of each form, an overall bar plus one bar each for Method, Scale, Units and Categories
shows how much the published definitions agree (colour = strong / few sources / contested). The same bar appears under each
key field, with the ranked options one click away.

## Editing consensus answers

Every field can be overridden.
- Option lists end with **Write your own…** (units, categories); method/scale class also list every other value the template accepts.
- In the review pop-up press `W` to write your own answer instead of choosing a listed one.
- Scale categories use a row editor (value = meaning, + add, ✕ remove) with an **Edit as text** switch.
- Anything you change turns purple (✎); each field has **↺** to return to the consensus value, and the form has **Reset everything to consensus**.
