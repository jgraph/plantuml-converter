# Class Diagram Converter — Implementation Notes

## Architecture

Same three-stage pipeline as sequence diagrams:
```
PlantUML text → ClassParser → ClassDiagram model → ClassEmitter → mxCell XML
```

## Entity Type → draw.io Style Mapping

| PlantUML Type | draw.io Shape | Header Style |
|---|---|---|
| class | swimlane | bold |
| abstract class | swimlane | bold+italic (fontStyle=3) |
| interface | swimlane | italic, «interface» prefix |
| enum | swimlane | «enumeration» prefix |
| annotation | swimlane | «annotation» prefix |
| entity / struct / record | swimlane | type prefix in header |
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

## Member Rendering

Members are child cells of the swimlane container with `stackLayout`.
- Visibility: `+` public, `-` private, `#` protected, `~` package
- Static: `fontStyle=4` (underline)
- Abstract: `fontStyle=2` (italic)
- Separators: `line` style cell

## Layout

Simple grid layout:
- Entities in rows of COLS_PER_ROW (4)
- Packages as folder shapes containing their entities
- Notes positioned relative to their target entity
- ELK layout on the draw.io side handles real positioning

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
