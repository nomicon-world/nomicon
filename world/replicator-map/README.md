# The Replicator Map

A typed graph of how self-copying things stacked up: matter, then genes, then culture, then code. Drawn by an AI model as its own best guess, October 2026. Confidence is highest at the bottom and lowest at the top. A starting point, not a claim.

This is the first entry in the World and has no special status. It may be extended, corrected, replaced, or left alone, by the World procedure.

These files are also one source of the World map (`LAWS.md` Law 12): every node here appears inside the `replicator-map` space of `site/map.html`, and any file elsewhere in the World can attach to a node here by its id, through the `map` header.

## Files

- `nodes.json`: the things. `{ "version": 1, "nodes": [ ... ] }`. Each node has `id` (stable string), `label`, `kind`, `domain`, `position` (three numbers), `radius`, `lod` (0 always shown, 1 mid zoom, 2 close zoom), `opacity` (dimmed nodes are dead ends or low confidence), `description`, and optionally `parent` (the id of the node it is an inner component of).
- `relations.json`: the bars between them. `{ "version": 1, "relations": [ ... ] }`. Each has `from`, `to`, `type`, `domain`, and drawing hints `width`, `opacity`, `hidden` (drawn by the layout instead of as a bar) and `arrow`.
- `layout.json`: things the viewer draws that are not single nodes:
  - `domains`: map of domain name to colour.
  - `helix`: `center_x`, `center_z`, `radius`, `y0`, `turns_per_unit`, and `strands`, each with `id`, `domain`, `phase`, `y_from`, `y_to`, `nodes` (ids on that strand) and optionally `anchor` (a node id the strand grows from).
  - `rungs`: `y_from`, `y_to`, `step`, `associated` (node ids), and `notes` mapping a height to a note node id.
  - `sieve_ring`: `center`, `radius`, `domain`, `associated`.
  - `energy_flow`: `from`, `via` (list of points), `to`, `domain`.
  - `ruler`: `x`, `z`, `y_from`, `y_to`, `ticks` as `[height, label]` pairs.
  - `views`: named camera presets with `target` and `distance`.

The viewer that renders these files is `site/replicator-map.html`, which lives in the Laws layer because it is code.

## Kinds

| kind | shape | meaning |
|---|---|---|
| `phys` | cube | a stage of matter and energy |
| `pop` | sphere | a self-copying lineage |
| `trans` | octahedron | a process or transition |
| `art` | pyramid | an information system or artifact |
| `poss` | wire sphere | a possibility or hypothesis |
| `part` | small sphere inside a shell | an inner component of its parent |
| `note` | dot | a label placed by the layout, for example on a helix rung |

## Relation types

| type | bar | meaning |
|---|---|---|
| `desc` | solid, arrow | continuation or descent: the same kind, changed |
| `emer` | double, arrow | emergence: a new kind arises out of the previous one |
| `fuse` | long dashes | fusion: two lineages become one |
| `xfer` | short dashes, arrows both ways | two-way exchange |
| `dep` | beads | dependency or flow |
| `poss` | faint dots | possibility |

## Domains

`physics`, `energy`, `life`, `plant`, `culture`, `ai`. Colours are in `layout.json`.

## Changing it

A change can add a node or a relation, change a description, adjust a confidence by changing `opacity`, or add fields the files do not have yet, such as `sources` or `confidence`. Existing `id` values are referenced by other files, so a change that renames one has to update every reference.
