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
  PlantUmlImporter.js    — Entry point, registry, convert/regenerate API
  MxBuilder.js           — Shared mxGraph XML utilities
  SequenceModel.js       — Sequence diagram data model
  SequenceParser.js      — Sequence diagram parser
  ArrowParser.js         — Arrow syntax parser (sequence-specific)
  SequenceEmitter.js     — Sequence diagram → mxCell emitter
  test.js                — Unit tests
  generate-sample.js     — Sample diagram generator
  generate-comprehensive-test.js — Full-feature test diagram generator
  CLAUDE.md              — This file
```

## Common Pitfalls

- **UserObject wrapping**: Children go outside the UserObject as siblings, not nested inside. They reference the group ID via `parent=`.
- **Freestanding edges**: Use `sourcePoint`/`targetPoint` mxPoints, not `source`/`target` cell references. Using an `<Array as="points">` for the main geometry doesn't work.
- **Z-order**: Emit boxes first, then vertices, then edges. Edges must come last to render on top.
- **ID collisions**: The group cell ID must use a different prefix from child cell IDs.
- **PlantUML vs docs**: The Java source is authoritative. The docs miss syntax variants, optional spaces, edge cases. Always verify against the regex in `Command*.java`.
- **Style string format**: Must end with `;`. Use `buildStyle()` which handles this.
- **Participant/node auto-creation**: PlantUML auto-creates participants/nodes on first use in a message. The parser must handle both explicit declarations and implicit creation.
