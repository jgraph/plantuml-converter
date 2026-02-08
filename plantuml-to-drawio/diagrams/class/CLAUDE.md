# Class Diagram Converter — Implementation Notes

## Architecture

Same three-stage pipeline as sequence diagrams:
```
PlantUML text → ClassParser → ClassDiagram model → ClassEmitter → mxCell XML
```

## Swimlane Style (Critical)

Class boxes use draw.io's swimlane style. **`verticalAlign=top` is required** — without it,
class name headers are invisible in draw.io PNG export.

Full swimlane base style:
```
swimlane=1;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;
horizontal=1;startSize=<dynamic>;horizontalStack=0;resizeParent=1;
resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;whiteSpace=wrap;html=1;
```

### Dynamic header height

`startSize` is computed per entity: **26px base + 18px per extra header line**.

Extra lines come from:
- Type prefix (`<<interface>>`, `<<enumeration>>`, `<<annotation>>`, etc.)
- Stereotypes (`<<service>>`, `<<controller>>`, etc.)

Multi-line headers use `<br>` (not `\n`) for line breaks since `html=1` is set.

## Entity Type → draw.io Style Mapping

| PlantUML Type | draw.io Shape | Header Style |
|---|---|---|
| class | swimlane | bold |
| abstract class | swimlane | bold+italic (fontStyle=3) |
| interface | swimlane | italic, «interface» prefix |
| enum | swimlane | «enumeration» prefix |
| annotation | swimlane | «annotation» prefix |
| entity / struct / record | swimlane | type prefix in header |
| object | swimlane | underline (fontStyle=4) |
| map | swimlane | bold, key=>value rows |
| json | swimlane | bold, flattened JSON rows |
| circle | ellipse | -- |
| diamond | rhombus (filled black) | -- |
| lollipop | ellipse (no fill) | -- |

## Relationship → Edge Style Mapping

| PlantUML | RelationDecor | draw.io Arrow | Fill |
|---|---|---|---|
| `<\|--` / `--\|>` | EXTENDS | block | 0 (hollow) |
| `*--` / `--*` | COMPOSITION | diamond | 1 (filled) |
| `o--` / `--o` | AGGREGATION | diamond | 0 (hollow) |
| `<--` / `-->` | ARROW | open | 1 |
| `x--` / `--x` | NOT_NAVIGABLE | cross | 1 |
| `<<--` / `-->>` | ARROW_TRIANGLE | block | 1 (filled) |
| `}--` / `--{` | CROWFOOT | ERmany | 0 |

Line styles: `-` = solid, `..` = dashed, `==` = bold (strokeWidth=2)

### Inheritance edge synthesis

`_emitInheritanceEdges()` synthesizes edges from `extends`/`implements` arrays on each
`ClassEntity`. These are **separate from `diagram.links`** (which come from explicit
relationship lines like `A --|> B` in PUML).

- Extends: solid line, `endArrow=block;endFill=0` (hollow triangle)
- Implements: dashed line, `dashed=1;endArrow=block;endFill=0`

## Member Rendering

Members are child cells of the swimlane container (26px row height).

Member style:
```
text=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;
spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;
points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;
```

- Visibility: `+` public, `-` private, `#` protected, `~` package
- Static: `fontStyle=4` (underline)
- Abstract: `fontStyle=2` (italic)

### Separators

Separator style (8px height, distinct from member row):
```
line=1;strokeWidth=1;fillColor=none;strokeColor=inherit;
align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;
rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;
```

## Layout

Simple grid layout — ELK handles real positioning on the draw.io side.

### Constants
```
CLASS_WIDTH: 160, CLASS_HEADER_HEIGHT: 26, MEMBER_ROW_HEIGHT: 26,
SEPARATOR_HEIGHT: 8, H_GAP: 60, V_GAP: 80, MARGIN: 40, COLS_PER_ROW: 4
```

### Grid algorithm
- Entities in rows of COLS_PER_ROW (4)
- Packages as folder shapes containing their entities
- Notes positioned relative to their target entity

### Emit order
packages → entities → notes → inheritance edges (`extends`/`implements`) → explicit link edges

## Object Diagram Entity Types

Object diagrams are part of the class diagram handler. Three additional entity types
are supported on top of standard class entities:

### Object (`EntityType.OBJECT`)

- Keyword: `object`
- Same swimlane rendering as classes
- Header uses `fontStyle=4` (underline) — UML convention for instance names
- No type prefix (objects don't show `<<object>>` in PlantUML)
- Body uses the same member parsing as classes (`name = value` fields)
- Syntax: `object Name`, `object "Display" as Code`, `object Code { ... }`

### Map (`EntityType.MAP`)

- Keyword: `map`
- Swimlane header (bold) + single child cell containing an **HTML table**
- Body uses `key => value` syntax (parsed as `MapEntry` objects, not `Member`)
- Rendered as two-column HTML table with vertical separator between key and value
- Supports linked entries: `key *--> TargetEntity` — auto-creates target entity
  and generates a `Relationship` edge
- Parser uses `State.MAP_BODY` (distinct from `State.ENTITY_BODY`)
- Syntax: `map Name { key => value }`, `map "Display" as Code { ... }`

### JSON (`EntityType.JSON`)

- Keyword: `json`
- Swimlane header (bold) + single child cell containing an **HTML table**
- Body is actual JSON — parsed using `JSON.parse()` into a `JsonNode` tree
- `JsonNode` types: OBJECT (key-value entries), ARRAY (indexed items), PRIMITIVE
- Rendered as two-column HTML table with nested sub-tables:
  - Object entries: `key | value` (primitives), `key | <nested table>` (objects/arrays)
  - Array items: single-column cells for each element
  - Nested objects/arrays rendered recursively as sub-tables in value column
- Height calculation uses `_countJsonRows()` which counts visible rows (nested entries
  don't add extra rows — the key cell shares the same row space as the sub-table)
- Parser uses `State.JSON_BODY` with brace depth tracking
- Supports single-line form: `json name true`, `json name 42`, `json name "str"`
- Syntax: `json Name { ... }`, `json "Display" as Code { ... }`

### HTML Table Rendering (Maps & JSON)

Maps and JSON entities use a different rendering approach than regular class swimlanes.
Instead of `childLayout=stackLayout` with individual child cells per row, they use a
**single child cell** containing an HTML `<table>` element. This enables two-column
key|value layout with borders matching PlantUML's visual output.

Key implementation details:
- The swimlane container still provides the header (entity name)
- A single child cell with `overflow=fill` contains the HTML table
- `buildCell()` XML-escapes the HTML, and draw.io unescapes it for rendering
- Inner text content is escaped with `xmlEscape()` before embedding in the HTML
- Table styling uses inline CSS: `border-collapse:collapse`, `border-bottom/right`
- The harness extractor parses HTML table `<td>` elements to count members

### Detection

The class handler's `detect()` in PlantUmlImporter.js recognizes `object`, `map`,
and `json` keywords alongside class/interface/enum/etc. Object diagrams are detected
as type `'class'` (matching PlantUML's own behavior — there is no `@startobject`).

## Known Limitations

- Link qualifiers `[qualifier]` are parsed but not yet rendered
- Note-on-link positioning is approximate
- No support for `skinparam` styling
- `!include` and preprocessor directives not supported
- Creole markup in labels not rendered
- Together groups parsed but don't affect grid layout
- Hide/show partially implemented (entity-specific + global)

## Comparison Rubric

### Blocking (must fix)
- Missing entities (classes, interfaces, enums)
- Missing relationships
- Wrong relationship type (e.g. composition shown as association)

### Important (should fix)
- Missing members (fields/methods)
- Wrong visibility symbols
- Missing packages
- Missing notes

### Cosmetic (defer)
- Layout differences (expected — we use grid, PlantUML uses Graphviz)
- Font style differences
- Color shade differences
- Note positioning
