# Trait Ontology Builder

A lightweight, browser-only app (plain JavaScript, no server, no install) that helps breeders fill in a DeltaBreed
**Ontology Term** using `data/consensus_traits.db` (4,447 consensus traits from 35 species).

## Run

Open `index.html` in any modern browser (double-click works), or host the folder on any static web server.

## How it works

1. **Name** — type the trait name. Matching traits appear on the left:
   exact name match first, then by number of species (most first). Traits that contain only some of the typed
   words are listed after those that contain all of them and marked *Partial*. Each card shows species count,
   definitions, how well it matches the typed name, and how the trait is collected (method · scale · units).
   Use ↑/↓ and Enter, or click, to pick one.
2. The form fills in: Full Name, Description, Synonyms, Tags, Entity, Attribute, Method Description,
   Method Class and Scale Class. **Term Type** is always Phenotype.
3. Under each filled field a bar shows agreement for the current value, with the other values people used
   as clickable chips (most used first):
   - **Method class, Scale class, Units, Categories** — agreement straight from the database.
   - **Full Name, Description, Tags, Entity, Attribute, Method Description** — the database stores a single
     value for these, so agreement is measured across the matching traits in the left list (traits containing
     every typed word), weighted by their number of definitions.
   - Green = strong (≥75% and ≥3 definitions), blue = few sources, orange = contested.
4. **Scale class** brings up what that class needs, filled from the selected trait, or from the best-ranked
   matching trait that uses that class:
   - Date → Calendar date (YYYY-MM-DD) or Julian day
   - Nominal → category list
   - Numerical → Unit, Min, Max, Decimals
   - Ordinal → Value = Category rows
   - Text → nothing extra
   Choosing **Computation** as the method shows Formula and fixes the scale to Numerical, as DeltaBreed does.
5. Everything is editable. Edited fields are marked and can be reset to the consensus value.

Nothing is saved or exported yet — the app only fills in the form.

## Updating the data

The browser reads `data/traits.js`, generated from the database:

    python3 tools/build_data.py

## Tests

    node --test tests/logic.test.js
