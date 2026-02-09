# State Diagram — Semantics Reference

## Scope

Covers PlantUML state diagrams (statediagram/). Detection triggers on `@startstate` or heuristic scoring of state-specific patterns.

## Supported Syntax (tiered)

### Core
- `state Name`, `state "Display" as Code`, `state Code as "Display"`
- `[*] --> A` (start), `A --> [*]` (end) — context-sensitive pseudostates
- `A --> B : label` transitions with direction hints (`-left->`, `-right->`, etc.)
- `state Name { ... }` composite/nested states (arbitrary depth)
- `state Name begin ... end state` composite alternate syntax
- `state Name : description` (multiple lines via repeated declarations)
- Notes: single-line, multi-line, floating, on-link
- Colors: `#BackColor`, `##LineColor`, `##[dashed]LineColor`
- Stereotypes: `<<choice>>`, `<<fork>>`, `<<join>>`, `<<start>>`, `<<end>>`, `<<history>>`, `<<history*>>`
- `left to right direction`, `top to bottom direction`
- `hide empty description`

### Advanced
- Concurrent regions: `--` (horizontal separator), `||` (vertical separator)
- History states: `[H]`, `[H*]`, `ParentState[H]`, `ParentState[H*]`
- Synchronization bars: `==barName==`
- Arrow styles: `[#color]`, `[dashed]`, `[dotted]`, `[bold]`, `[hidden]`
- Arrow decorators: `x-->` (cross start), `-->o` (circle end)
- Arrow length: more dashes = greater rank distance
- `frame Name { ... }` containers

### Deferred
- `remove` / `restore`
- `skinparam StateDiagramEdgeLabelStyle node` (intermediate box labels)
- URL attachments
- Stereotags (`$tag`)

## Shape Mapping

| StateType | draw.io Shape |
|---|---|
| STATE (no desc) | `rounded=1;arcSize=20` |
| STATE (with desc) | `shape=swimlane;rounded=1;startSize=26` |
| INITIAL | `ellipse;fillColor=#000000` (24x24) |
| FINAL | Outer `ellipse;strokeWidth=2` + inner `ellipse;fillColor=#000000` |
| CHOICE | `rhombus;fillColor=#FFFDE7` |
| FORK_JOIN / SYNCHRO_BAR | `fillColor=#000000;rounded=1;arcSize=50` (60x5) |
| HISTORY | `ellipse;fillColor=none` with value "H" |
| DEEP_HISTORY | `ellipse;fillColor=none` with value "H*" |
| Composite | `rounded=1;container=1;verticalAlign=top;fontStyle=1` |

## Detection Heuristic

- Explicit: `@startstate`
- Score-based: `[*]` +3, `state` keyword +2, `<<choice|fork|join>>` +2, `hide empty description` +2, `-->` +1, concurrent separators +1
- Threshold: >= 3
- Registration order: class → component → usecase → **state** → activity → sequence

## Layout Approach

- Hybrid model: states as tree (nested composites), transitions as flat lists per scope
- Three-pass recursive emitter: measure (bottom-up) → place (top-down) → emit
- Top-level: topological sort by transitions, sequential placement along main axis
- Inside composites: children centered vertically within parent bounds
- Concurrent regions: stacked vertically with dashed separators

## Known Limitations

- No preprocessor support (`!include`, `!define`)
- Ports/entry-exit points not visually rendered on composite edges
- Concurrent region layout is simple vertical stacking (no side-by-side for `||`)
- Arrow length hints affect rank distance in PlantUML but not in this emitter
- `skinparam` ignored (mapped to draw.io defaults)

## Comparison Rubric

### Blocking
- Missing states
- Missing transitions
- Wrong pseudostate types (start rendered as end, etc.)

### Important
- Missing composite containers
- Missing notes
- Wrong direction (LTR vs TTB)

### Cosmetic
- Exact positioning differences
- Color variations
- Font/text size differences
