# PlantUML to draw.io Converter

## Purpose

One-way converter: PlantUML text in, draw.io-editable mxGraph XML out. Lives in the draw.io codebase extensions section alongside Lucid and Visio import. David Benson (david@draw.io) owns the draw.io integration — this code produces the XML; he handles ELK layout and codebase adaptation.

## Architecture: Parse → Model → Emit

Every diagram type follows a three-stage pipeline:

```
PlantUML text → Parser → Model → Emitter → mxCell XML strings → UserObject/Group wrapper → mxfile document
```

**Parser** reads PlantUML text line-by-line and populates a diagram-specific model. Each diagram type has its own parser (e.g. `SequenceParser.js`). The parser is a hand-written recursive descent / state machine — no external dependencies. Study the PlantUML Java source for exact regex patterns and parsing rules; the official docs are incomplete.

**Model** is a plain JS data structure with enums and classes representing the parsed diagram. It knows nothing about draw.io. Each diagram type defines its own model (e.g. `SequenceModel.js`). The model is the contract between parser and emitter.

**Emitter** walks the model and produces an array of mxCell XML strings with layout geometry. Each diagram type has its own emitter (e.g. `SequenceEmitter.js`). The emitter handles positioning, sizing, and style mapping. It uses `MxBuilder.js` utilities to construct the XML.

## Diagram Handler Registry

`PlantUmlImporter.js` maintains a `Map` of diagram type handlers. Each handler provides three functions:

```javascript
{
    detect(text) → boolean,   // Does this PlantUML text match this diagram type?
    parse(text) → model,      // Parse into diagram-specific model
    emit(model, parentId) → string[]  // Emit mxCell XML strings
}
```

To add a new diagram type, create its parser, model, and emitter, then register:

```javascript
diagramHandlers.set('class', {
    detect: detectClassDiagram,
    parse: parseClassDiagram,
    emit: emitClassDiagram
});
```

The `convert()` function iterates handlers to detect the type, then runs parse → emit → wrap.

## draw.io XML Format

### Document structure

```xml
<mxfile>
  <diagram name="PlantUML Import">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>           <!-- Root cell, always present -->
        <mxCell id="1" parent="0"/> <!-- Default layer -->
        <UserObject ...>           <!-- Group wrapper -->
          <mxCell style="group;editable=0;connectable=0;" vertex="1" parent="1">
            <mxGeometry ... />
          </mxCell>
        </UserObject>
        <!-- Child cells reference group id via parent attribute -->
        <mxCell id="puml-1" parent="puml-grp-1" ... />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

### Key concepts

**Vertices** are shapes/nodes. They have `vertex="1"` and an `mxGeometry` with absolute x, y, width, height.

**Edges** are connections/arrows. They have `edge="1"`. For freestanding edges (not connected to cell ports), use `sourcePoint` and `targetPoint` inside the geometry — not `source`/`target` attributes:

```xml
<mxCell id="e1" edge="1" parent="puml-grp-1" style="...">
  <mxGeometry relative="1" as="geometry">
    <mxPoint x="100" y="200" as="sourcePoint"/>
    <mxPoint x="300" y="200" as="targetPoint"/>
  </mxGeometry>
</mxCell>
```

**Styles** are semicolon-delimited key=value strings: `shape=mxgraph.basic.x;fillColor=#FF0000;strokeColor=#333;`. Use `buildStyle()` from MxBuilder to construct these from objects.

**Z-order** is determined by XML document order. Later elements render on top. The emitter must output cells in the right order: background boxes first, then vertices, then edges on top.

**UserObject** wraps ONLY the group cell's own mxCell. Children are XML siblings, not nested inside the UserObject. They reference the group via `parent="puml-grp-1"`. This is critical — nesting children inside UserObject breaks draw.io.

**Group locking**: `editable=0;connectable=0;` on the group cell style makes the imported diagram non-editable. The PlantUML source is stored as a `plantUml` attribute on the UserObject for re-generation.

### ID conventions

- Group cell: `puml-grp-1` (distinct prefix to avoid colliding with child IDs)
- Child cells: `puml-1`, `puml-2`, ... (sequential via `createIdGenerator('puml')`)
- The group ID prefix must differ from the child ID prefix

## PlantUML Format

### Parsing approach

PlantUML's Java source is the authority. The official documentation omits edge cases. When implementing a new diagram type:

1. Find the relevant parser class in the PlantUML repo (e.g. `net/sourceforge/plantuml/sequencediagram/command/`)
2. Extract the exact regex patterns from `CommandXxx.java` classes
3. Note the order of pattern matching — PlantUML tries patterns in a specific order

### Common PlantUML conventions across diagram types

- `@startuml` / `@enduml` delimiters (optional, often omitted)
- `@start<type>` / `@end<type>` for explicit typing (e.g. `@startsequence`)
- Single-line comments: `'comment` or `/'comment'/`
- `title`, `header`, `footer`, `caption` directives
- `skinparam` styling (we largely ignore these — map to draw.io styles instead)
- Color notation: `#RRGGBB` or `#colorname` after elements
- Stereotypes: `<<stereotype>>` after declarations
- `!include`, `!define`, preprocessor directives (not supported — would need a preprocessor pass)

## Shared Utilities: MxBuilder.js

All diagram emitters use these shared functions:

- `buildCell({id, value, style, vertex, edge, parent, geometry, sourcePoint, targetPoint, waypoints})` — the core cell generator
- `buildStyle(styleMap)` — object → style string
- `xmlEscape(str)` — safe attribute values
- `buildUserObject({id, plantUml, children, width, height})` — group wrapper
- `buildDocument(cells)` — full mxfile wrapper
- `createIdGenerator(prefix)` — sequential ID factory
- `geom(x, y, width, height)` — geometry shorthand

## Adding a New Diagram Type

1. **Research**: Read the PlantUML Java source for the diagram type's command classes. Extract regex patterns. Identify the feature set and tier it (core vs. advanced vs. deferred).

2. **Model** (`<Type>Model.js`): Define enums and data classes for the parsed structure. Keep it pure data — no draw.io or PlantUML knowledge. This is the interface between parser and emitter.

3. **Parser** (`<Type>Parser.js`): Line-by-line parser that populates the model. Handle multi-line constructs with a state machine. Export a convenience `parse<Type>Diagram(text)` function.

4. **Emitter** (`<Type>Emitter.js`): Walk the model and emit mxCell XML strings via MxBuilder. Handle layout (positioning, sizing), style mapping, and z-order. Export a convenience `emit<Type>Diagram(model, parentId)` function.

5. **Register** in `PlantUmlImporter.js`: Add `detect`, `parse`, `emit` to the handler map.

6. **Test**: Write unit tests covering parser, emitter, and full pipeline. Create a comprehensive test generator that exercises every supported feature for visual comparison against PlantUML's own rendering.

## Conventions

- **ES modules** with import/export — David will adapt the module system for draw.io's ES3 build
- **No external dependencies** — hand-written parsers, no npm packages
- **Tabs for indentation** in source files
- **Test with `node test.js`** — plain assert-based test runner, no framework
- **Generator scripts** output both `.drawio` and `.puml` files side-by-side for visual comparison
- Test the `.puml` on PlantUML's server (http://www.plantuml.com/plantuml/uml/) and the `.drawio` in draw.io, then compare

## Re-generation Flow

The converter supports re-generating from embedded PlantUML source:

1. `extractPlantUml(xml)` pulls the PlantUML text from the UserObject's `plantUml` attribute
2. `regenerate(existingXml, newPlantUml, options)` re-runs the pipeline, preserving the group ID
3. This works as long as the user hasn't manually edited the draw.io cells in the UI — once they have, the embedded PlantUML becomes a dead artifact

## File Layout

```
plantuml-to-drawio/
├── CLAUDE.md                          — This file: architecture, cross-cutting decisions
├── PlantUmlImporter.js                — Entry point, registry, convert/regenerate API
├── MxBuilder.js                       — Shared mxGraph XML utilities
├── common/                            — Shared utilities extracted when patterns emerge
├── diagrams/
│   └── sequence/
│       ├── CLAUDE.md                  — Sequence-specific semantics, drawio quirks, comparison rubric
│       ├── SequenceParser.js          — Sequence diagram parser
│       ├── SequenceModel.js           — Sequence diagram data model
│       ├── SequenceEmitter.js         — Sequence diagram → mxCell emitter
│       └── ArrowParser.js            — Arrow syntax parser (sequence-specific)
├── tests/
│   └── sequence/
│       ├── comprehensive.puml         — Full-feature test (visual comparison target)
│       ├── cases/                     — Small focused test files (one per feature)
│       └── regression/                — Cases that previously broke (never removed)
├── harness/
│   ├── compare.js                     — Orchestrator: run converter, run plantuml, compare
│   ├── svg-compare.js                 — Structural comparison entry point (generic)
│   ├── normalize-sequence.js          — Sequence diagram normalized types + matching/diffing
│   ├── extract-plantuml-svg-sequence.js — PlantUML SVG → NormalizedDiagram (sequence)
│   ├── extract-drawio-xml-sequence.js — draw.io XML → NormalizedDiagram (sequence)
│   ├── export-drawio.sh               — draw.io CLI export wrapper (PNG or SVG)
│   ├── vision-compare.js              — Anthropic API vision comparison call
│   └── iteration-log.js               — Iteration tracking for fix loops
├── outputs/                           — Generated PNGs, diff reports (gitignored)
├── test.js                            — Unit tests
├── generate-sample.js                 — Sample diagram generator
└── generate-comprehensive-test.js     — Full-feature test diagram generator
```

## Adding a New Diagram Type — Full Process

Adding support for a new diagram type (e.g. class, activity, state) follows a proven multi-phase process. Each phase builds on the previous one.

### Prerequisites

- PlantUML jar built: `./gradlew jar` (from repo root)
- draw.io installed at `/Applications/draw.io.app` (or set `DRAWIO_CMD`)
- `ANTHROPIC_API_KEY` set in environment (only needed for Phase 5 vision comparison)

### Phase 1 — Analyse & Create Comprehensive Test

Study the PlantUML diagram type thoroughly before writing any converter code.

1. **Read the PlantUML Java source** for the diagram type's command classes (under `net/sourceforge/plantuml/<type>diagram/command/`). Extract regex patterns, identify every supported feature.
2. **Tier the features**: core (must have for a useful diagram), advanced (common but not essential), deferred (rare or complex, handle later).
3. **Create a comprehensive test `.puml`** at `tests/<type>/comprehensive.puml` that exercises every core and advanced feature. This is the visual comparison target — it should cover all the syntax variants, edge cases, and combinations that a real user would write.
4. **Create smaller focused test cases** under `tests/<type>/cases/` — one per feature area. These are faster to iterate on than the comprehensive test.
5. **Verify the test files render correctly** on PlantUML's server (http://www.plantuml.com/plantuml/uml/) before proceeding.

### Phase 2 — Build Initial Importer

Implement the three-stage pipeline for the new diagram type:

1. **Model** (`diagrams/<type>/<Type>Model.js`) — data classes for the parsed structure
2. **Parser** (`diagrams/<type>/<Type>Parser.js`) — line-by-line parser populating the model
3. **Emitter** (`diagrams/<type>/<Type>Emitter.js`) — model → mxCell XML via MxBuilder
4. **Register** in `PlantUmlImporter.js` — add detect/parse/emit to the handler map
5. **Write a diagram-type CLAUDE.md** (`diagrams/<type>/CLAUDE.md`) documenting semantics, style mappings, known issues, and the comparison rubric

Start with core features only. Get a basic version rendering before worrying about completeness.

### Phase 3 — Add Functional Tests

Add unit tests to `test.js` covering:

- Parser: every syntax variant parsed correctly into the model
- Emitter: expected mxCell output structure for key scenarios
- Full pipeline: `.puml` text → `.drawio` XML round-trip

Run with `node plantuml-to-drawio/test.js`. All tests must pass before proceeding.

### Phase 4 — Build Visual Comparison Support

The comparison harness (`harness/compare.js`) is generic and supports `--type <type>` already. But the **structural extractors** are diagram-type-specific and need new implementations.

1. **Create `harness/normalize-<type>.js`** — normalized element classes for the new diagram type (e.g. `NClass`, `NAssociation`, `NAttribute` for class diagrams) plus matching/diffing logic. Can reuse the matching infrastructure pattern from `normalize-sequence.js`.
2. **Create `harness/extract-plantuml-svg-<type>.js`** — extracts NormalizedDiagram from PlantUML's SVG output. PlantUML SVGs have semantic attributes (`class=`, `data-entity-uid=`, etc.) that vary by diagram type — study the actual SVG output to understand the patterns.
3. **Create `harness/extract-drawio-xml-<type>.js`** — extracts NormalizedDiagram from the converter's `.drawio` XML output. Since we generate this XML, we know the exact style patterns.
4. **Wire into `svg-compare.js`** — add a diagram-type router so the right extractor pair is selected.
5. **Do NOT modify the existing sequence extractors.** Each diagram type gets its own files.

The generic files that work unchanged for all diagram types:
- `harness/compare.js` — orchestrator (already parameterized by `--type`)
- `harness/svg-compare.js` — comparison entry point (needs router for extractor selection)
- `harness/export-drawio.sh` — draw.io CLI wrapper
- `harness/vision-compare.js` — Anthropic Vision API call

### Phase 5 — Automated Iteration Loop (PNG Vision)

Use the **PNG vision comparison** to rapidly iterate on the converter. This phase catches big-picture issues: missing elements, wrong shapes, broken layout, incorrect connections.

```bash
node plantuml-to-drawio/harness/compare.js --type <type> --vision --no-structural --verbose
```

Repeat until diminishing returns:

1. **Run the harness** — generates PNGs and vision comparison report
2. **Read the report** — `outputs/reports/summary.json` and per-case reports
3. **Fix blocking issues first**, then important. Target the root cause, not symptoms.
4. **Run unit tests** — `node plantuml-to-drawio/test.js` — all must pass
5. **Commit** — `fix-loop iteration N: <summary>`
6. **Loop back to step 1**

**Stop conditions:**
- 10 iterations reached
- Same issue persists for 3 consecutive iterations with no improvement
- Vision model keeps reporting the same cosmetic differences that aren't real problems

**Important constraints:**
- Never fix a single case in isolation — always re-run the full suite
- Cosmetic issues are not fix targets during this phase
- Read the vision report critically — the model can hallucinate differences
- Prefer the simplest fix — do not refactor mid-loop

### Phase 6 — Manual Refinement (SVG Structural + Visual Review)

Once the PNG vision loop plateaus, switch to precise structural comparison combined with human visual review.

```bash
# Structural comparison + PNG export for visual review
node plantuml-to-drawio/harness/compare.js --type <type> --png --verbose
```

This mode:
- Runs the **SVG structural comparison** (free, deterministic, precise)
- Exports **PNGs** for the user to visually inspect side-by-side

The structural comparison catches element-level issues (missing participants, wrong connections, missing fragments) but can be too literal about text matching (HTML entities, aliases, stereotypes). The user's visual review catches layout and styling issues that structural comparison doesn't measure.

Workflow:
1. Run the harness with `--png`
2. Review the structural report for real issues (ignore false positives from text encoding differences)
3. Open the reference and candidate PNGs — compare visually
4. The user identifies specific issues to fix
5. Make targeted fixes, run tests, commit
6. Repeat

This phase continues until the user is satisfied with the visual quality.

### Files You Will Typically Modify

| Priority | File pattern | When |
|---|---|---|
| Most common | `diagrams/<type>/<Type>Emitter.js` | Style fixes, layout fixes, missing visual elements |
| Common | `diagrams/<type>/<Type>Parser.js` | Missing or incorrectly parsed features |
| Occasional | `diagrams/<type>/<Type>Model.js` | New model fields needed for a fix |
| Occasional | `MxBuilder.js` | New XML generation patterns needed |
| After fixes | `test.js` | Update tests for changed behavior |
| After fixes | `diagrams/<type>/CLAUDE.md` | Document what you fixed/learned |

### Harness Tools Reference

| Command | Purpose |
|---|---|
| `node harness/compare.js --type <type> --verbose` | Structural comparison only (default, free) |
| `node harness/compare.js --type <type> --png --verbose` | Structural + PNG export for visual review |
| `node harness/compare.js --type <type> --vision --verbose` | Structural + PNG + Vision API comparison |
| `node harness/compare.js --type <type> --vision --no-structural` | Vision API only (for automated loop) |
| `node harness/compare.js --type <type> --png` | PNG export only (no comparison) |
| `node harness/iteration-log.js --description "..."` | Log current iteration results |
| `node harness/iteration-log.js --reset` | Start a fresh iteration log |

## Common Pitfalls

- **UserObject wrapping**: Children go outside the UserObject as siblings, not nested inside. They reference the group ID via `parent=`.
- **Freestanding edges**: Use `sourcePoint`/`targetPoint` mxPoints, not `source`/`target` cell references. Using an `<Array as="points">` for the main geometry doesn't work.
- **Z-order**: Emit boxes first, then vertices, then edges. Edges must come last to render on top.
- **ID collisions**: The group cell ID must use a different prefix from child cell IDs.
- **PlantUML vs docs**: The Java source is authoritative. The docs miss syntax variants, optional spaces, edge cases. Always verify against the regex in `Command*.java`.
- **Style string format**: Must end with `;`. Use `buildStyle()` which handles this.
- **Participant/node auto-creation**: PlantUML auto-creates participants/nodes on first use in a message. The parser must handle both explicit declarations and implicit creation.
