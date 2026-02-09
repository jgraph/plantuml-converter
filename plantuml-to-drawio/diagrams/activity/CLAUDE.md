# Activity Diagram — Implementation Notes

## Syntax Scope

Supports **ActivityDiagram3** (new syntax) only — the `:action;` style.
Legacy activity diagram syntax (`activity "label"`) is **not** supported.

PlantUML Java source: `net/sourceforge/plantuml/activitydiagram3/command/`

## Supported Features

### Tier 1 — Core
- Actions: `:label;` (single-line), `:text\nmore;` (multiline), `#color:label;` (colored)
- Arrows: `->`, `-> label;`, `-[#color]-> label;`
- Start: `start`
- Stop: `stop`
- End: `end`
- Kill/Detach: `kill`, `detach`
- If/Else: `if (test) then (yes)` ... `elseif (test) then (label)` ... `else (no)` ... `endif`
- Title: `title text`

### Tier 2 — Control Flow
- While: `while (test) is (yes)` ... `endwhile (no)`
- Repeat: `repeat [:label;]` ... `repeat while (test) is (yes) not (no)`
- Switch/Case: `switch (test)` ... `case (val)` ... `endswitch`
- Break: `break`

### Tier 3 — Layout
- Fork/Join: `fork` ... `fork again` ... `end fork`
- Split: `split` ... `split again` ... `end split`
- Partitions: `partition "Name" [#color] { ... }`
- Swimlanes: `|[#color]Name|`
- Notes: `note left|right: text`, multiline `note left` ... `end note`, `floating note`
- Backward: `backward :label;`

## Not Supported (Deferred)
- Box styles / stereotypes on actions (`<<input>>`, `<<output>>`)
- Goto/Label
- Circle spots
- URLs on actions
- Skinparam styling
- Preprocessor directives

## Architecture

### Model (`ActivityModel.js`)

Uses a **recursive tree** of `Instruction` objects. Each instruction has a `type` field
(from `InstructionType` enum) and type-specific fields. Branching instructions (IF, WHILE,
REPEAT, SWITCH, FORK, SPLIT, PARTITION) contain nested `Instruction[]` arrays for their
branches/bodies.

Single flat `Instruction` class — no inheritance. Matches the pattern of other diagram models.

### Parser (`ActivityParser.js`)

**Stack-based** line-by-line parser. The block stack tracks which nested structure we're
inside, so new instructions are added to the correct parent's body array.

Key mechanisms:
- **Block stack**: Frames of `{blockType, instruction, targetArray}`. When a block opener
  (if, while, fork, etc.) is parsed, a frame is pushed. When a closer (endif, endwhile, etc.)
  is parsed, the frame is popped.
- **`_currentTarget()`**: Returns the `Instruction[]` where new instructions go — either
  the top-level `diagram.instructions` or the innermost block's body.
- **Pending arrow**: Standalone `->` lines become ARROW instructions inserted before the
  next flow instruction.
- **Multiline state**: Activities starting with `:` without `;` enter multiline mode,
  accumulating lines until `;` is found. Same for `note left/right` ... `end note`.

### Emitter (`ActivityEmitter.js`)

**Three-pass recursive layout**:

1. **Measure** (bottom-up): Compute `{width, height}` bounding box for each instruction
   and subtree. Branching structures sum branch widths + gaps.
2. **Place** (top-down): Assign `(x, y)` coordinates. Sequential instructions stack
   vertically. Branching places branches side-by-side.
3. **Emit**: Walk placed instructions, generate mxCell XML.

Edge strategy: `source`/`target` cell ID references for connected edges. Loop back-arrows
also use source/target (ELK handles routing on the draw.io side).

## Shape Mapping

| PlantUML Element | draw.io Style |
|---|---|
| Action (`:label;`) | `rounded=1;whiteSpace=wrap;` |
| Start | `ellipse;fillColor=#000000;` |
| Stop | `shape=doubleCircle;fillColor=#000000;` |
| End | `shape=doubleCircle;fillColor=#000000;` |
| Kill/Detach | `shape=mxgraph.flowchart.terminate;fillColor=#000000;` |
| Decision diamond | `rhombus;fillColor=#FFFDE7;strokeColor=#FBC02D;` |
| Merge diamond | Same as decision, smaller |
| Fork/Join bar | `fillColor=#000000;` (thin rectangle) |
| Partition | Dashed rectangle container |
| Note | `shape=note;fillColor=#FFF2CC;strokeColor=#D6B656;` |
| Swimlane | `shape=swimlane;container=1;` |
| Break | `rounded=1;fillColor=#F8CECC;strokeColor=#B85450;dashed=1;` |

## Comparison Rubric

### Blocking Issues
- Missing elements (actions, diamonds, bars not rendered)
- Wrong flow connections (edges to wrong targets)
- Missing branches in if/switch/fork

### Important Issues
- Incorrect branch direction (then/else swapped)
- Missing labels on edges
- Wrong colors on elements
- Missing notes

### Cosmetic Issues
- Diamond size differences
- Action box sizing
- Exact edge routing differences
- Spacing/gap differences
- Font styling differences

## Files

```
diagrams/activity/
├── CLAUDE.md              — This file
├── ActivityModel.js       — Enums + Instruction class + ActivityDiagram
├── ActivityParser.js      — Stack-based line parser (~500 lines)
└── ActivityEmitter.js     — Recursive layout + mxCell emission (~700 lines)
```

## Parser Pattern Priority

Critical ordering (derived from Java command registration):
1. Title, swimlane (non-flow)
2. Terminal nodes: start, stop, kill, break
3. Block closers: endif, elseif, else, endwhile, repeat while, endswitch, end fork, end split, }
4. `end` (as stop synonym) — **after** all `end X` patterns
5. Block openers: if, while, repeat, switch, case, fork, fork again, split, split again, partition
6. Notes
7. Activities (`:text;` and multiline `:text`)
8. Arrows (`->`) — last
