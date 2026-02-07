# Sequence Diagram: Implementation Reference

This document is the single source of continuity for the PlantUML sequence diagram converter. Read `CLAUDE.md` first for the overall architecture — this covers everything specific to the sequence diagram implementation.

## File Map

| File | Role | Lines |
|---|---|---|
| `SequenceModel.js` | Enums + data classes | ~345 |
| `ArrowParser.js` | Arrow syntax → ArrowConfig | ~413 |
| `SequenceParser.js` | PlantUML text → SequenceDiagram model | ~888 |
| `SequenceEmitter.js` | Model → mxCell XML strings | ~1099 |
| `test.js` | 97 unit tests | ~540 |
| `generate-sample.js` | E-commerce sample + simple 2-message sample | ~110 |
| `generate-comprehensive-test.js` | All-feature visual test diagram | ~212 |

---

## 1. PlantUML Sequence Diagram Syntax

All syntax knowledge was extracted from the PlantUML Java source at `net/sourceforge/plantuml/sequencediagram/command/`. The official docs are incomplete. The Java source is the authority.

### 1.1 Participant Types

Eight types, parsed case-insensitively. The keyword both declares the participant and sets its visual shape:

```
participant Alice             — default rectangular box
actor Bob                     — stick figure
boundary FrontEnd             — UML boundary (line with circle)
control Controller            — UML control (circle with arrow)
entity UserEntity             — UML entity (circle with underline)
queue MessageQueue            — queue shape
database DB                   — cylinder
collections LogList           — stacked rectangles
```

**Declaration formats** (all types support all formats):

```
participant Alice                         — code = Alice, display = Alice
participant "Long Name" as LDN            — code = LDN, display = "Long Name"
participant LDN as "Long Name"            — same, reversed
participant "Display Only"                — code = display = "Display Only"
```

**Trailing modifiers** (all optional, parsed from the remainder after the name):

```
participant Alice order 10                — explicit ordering
participant Alice #lightblue              — background color
participant Alice <<stereotype>>          — stereotype annotation
```

**Auto-creation**: Participants not explicitly declared are auto-created as `participant` type when first mentioned in a message. The `getOrCreateParticipant(code)` method handles this.

**Ordering**: `getOrderedParticipants()` sorts by explicit `order` first, then falls back to declaration order. Participants without an order value come after all ordered ones.

### 1.2 Arrow Syntax

Arrows are the most complex parsing challenge. The full anatomy:

```
[left_decoration] [left_dressing] body [style] [right_dressing] [right_decoration]
```

**Decorations** (outermost, single character):
- `o` — circle (maps to `ArrowDecoration.CIRCLE`)
- `x` — cross/lost message (maps to `ArrowHead.CROSSX`)

**Dressings** (next to body, indicate head type):
- `>` / `<` — solid arrowhead (`ArrowHead.NORMAL`)
- `>>` / `<<` — open arrowhead (`ArrowHead.ASYNC`)
- `/` `//` `\` `\\` — partial arrows (`ArrowPart.TOP_PART` / `BOTTOM_PART`)

**Body** (the dashes):
- `-` — solid line (`ArrowBody.NORMAL`)
- `--` (2+ dashes) — dotted line (`ArrowBody.DOTTED`)

**Style modifiers** (inline, in brackets):
- `[#red]` or `[#FF0000]` — color
- `[dashed]` — force dotted
- `[bold]` — bold line

**Critical parsing order bug we fixed**: When `->x` is parsed, the `x` decoration sets `head2 = CROSSX`. Then the `>` dressing tries to set `head2 = NORMAL`, overwriting it. Fix: the dressing step guards with `if (result.head2 === ArrowHead.NONE)` before setting from dressing.

**Common combinations and their parse results**:

```
->     head1=NONE     head2=NORMAL   body=NORMAL    — sync call
-->    head1=NONE     head2=NORMAL   body=DOTTED    — return/response
->>    head1=NONE     head2=ASYNC    body=NORMAL    — async call
-->>   head1=NONE     head2=ASYNC    body=DOTTED    — async return
<-     head1=NORMAL   head2=NONE     body=NORMAL    — reverse sync
<->    head1=NORMAL   head2=NORMAL   body=NORMAL    — bidirectional
->x    head1=NONE     head2=CROSSX   body=NORMAL    — lost message
o->    decoration1=CIRCLE head2=NORMAL               — circle start
o->o   decoration1=CIRCLE decoration2=CIRCLE         — circle both
x->    head1=CROSSX   head2=NORMAL                   — found message
```

**`ArrowConfig.direction` is a computed getter**, not a stored field. It derives from head1/head2:
- head1=NONE, head2≠NONE → `LEFT_TO_RIGHT`
- head1≠NONE, head2=NONE → `RIGHT_TO_LEFT`
- both ≠ NONE → `BOTH`

Do NOT try to assign `config.direction = ...`. It will silently fail.

### 1.3 Messages

**Standard messages**:
```
Alice -> Bob : hello                      — basic
Alice -> Alice : self call                — self message (from === to)
Alice -> Bob : msg & Carol & Dave         — multicast (not yet emitted)
& Alice -> Bob : parallel                 — parallel message (not yet emitted)
```

Parser regex for standard arrows is intentionally broad — the arrow portion is extracted by matching the pattern `identifier arrow identifier` where the arrow body contains at least one dash.

**Reverse arrows**: `Alice <- Bob : msg` — the parser detects that `head1 ≠ NONE && head2 === NONE` and swaps from/to so that `from=Bob, to=Alice`.

**Return keyword**:
```
return result
```
Creates a `Message` with `_isReturn = true`, `from = '__return_source__'`, `to = '__return_target__'`. The emitter currently just advances Y for returns — no arrow is drawn. The proper implementation would need an activation stack to resolve the actual source/target.

### 1.4 Activation / Deactivation Lifecycle

Two forms — explicit and inline.

**Explicit**:
```
activate Bob                  → LifeEvent(Bob, ACTIVATE)
activate Bob #yellow          → LifeEvent(Bob, ACTIVATE, #yellow)
deactivate Bob                → LifeEvent(Bob, DEACTIVATE)
destroy Bob                   → LifeEvent(Bob, DESTROY)
```

**Inline** (suffixed on messages):
```
Alice -> Bob ++ : call        → Message + LifeEvent(target=Bob, ACTIVATE)
Bob --> Alice -- : return     → Message + LifeEvent(source=Bob, DEACTIVATE)
Alice -> Bob ** : new         → Message + LifeEvent(target=Bob, CREATE)
Alice -> Bob !! : kill        → Message + LifeEvent(target=Bob, DESTROY)
Alice -> Bob ++-- : combo     → Message + LifeEvent(target, ACTIVATE) + LifeEvent(source, DEACTIVATE)
Alice -> Bob --++ : reverse   → Message + LifeEvent(source, DEACTIVATE) + LifeEvent(target, ACTIVATE)
```

Color for inline activation: `Alice -> Bob ++ #gold : call` — the `#gold` after `++` colors the activation bar.

The `_applyActivation(spec, from, to, color)` method in the parser handles the suffix mapping. Note the `from`/`to` mapping: `++` activates the target, `--` deactivates the source.

### 1.5 Create / Destroy

**Create** makes a participant appear mid-diagram instead of at the top:

```
create UserEntity                         — standalone create declaration
create entity UserEntity                  — with explicit type
Alice -> Bob ** : new()                   — inline create via **
```

The standalone `create` form:
1. Parser matches `create <rest>` and sets `isCreate = true`
2. Delegates `<rest>` to the participant parser
3. Sets `p.isCreated = true` on the Participant
4. Adds a `LifeEvent(code, CREATE)` to elements

**Edge case we fixed**: If the participant was already declared (e.g. `entity UserEntity` at the top), then `create UserEntity` later, the `addParticipant()` silently ignores the duplicate. Fix: after `addParticipant`, check `if (isCreate && existing !== p) { existing.isCreated = true; }`.

**Destroy** renders an X on the lifeline:
```
destroy Bob
```

### 1.6 Fragments

```
alt condition text       — starts fragment, first section gets the condition
  Alice -> Bob : msg
else other condition     — new section with condition
  Alice -> Bob : other
end                      — closes the innermost fragment
```

**All fragment types**: `alt`, `loop`, `opt`, `par`, `par2`, `break`, `critical`, `group`.

**Nesting**: Uses a `fragmentStack` array. Opening a fragment pushes; `end` pops and adds the fragment to the current context (which may be another fragment's section, enabling nesting).

**`else` / `also`**: Both keywords start a new `FragmentSection` on the current (top-of-stack) fragment. The condition text follows the keyword.

**Color**: `alt #LightBlue condition` — color parsed from the fragment start line.

**Section structure**: A `Fragment` has `sections: FragmentSection[]`. Each `FragmentSection` has `condition: string` and `elements: []`. The first section's condition is the fragment's label. Subsequent sections are created by `else`.

### 1.7 Notes

**Single-line**:
```
note right of Alice : text                — right of participant
note left of Bob : text                   — left
note over Alice : text                    — centered over
note over Alice, Bob : spanning           — spans between two participants
note across : full width                  — spans all participants
hnote right of Alice : hexagonal          — hexagon shape
rnote right of Bob : rounded              — rounded rectangle shape
```

**Multi-line** (terminated by `end note`):
```
note right of Alice
  Line one
  Line two
end note
```

**Note on arrow** (attaches to the previous message):
```
Alice -> Bob : message
note right : annotation                   — right of the arrow
note left : annotation                    — left
note top : above                          — above
note bottom : below                       — below
```

The parser tracks `this.lastElement`. `_parseNoteOnArrow` checks that `lastElement` is a `Message` or `ExoMessage`, then sets `lastElement.noteOnArrow = new NoteOnArrow(...)`.

**Parsing order matters**: The parser tries `_parseNoteMultiLine` before `_parseNoteSingleLine` before `_parseNoteOnArrow` before `_parseNoteAcross`. This is because multi-line note syntax (no colon on the line) must be caught before single-line (has colon).

**Typo tolerance**: PlantUML accepts both `across` and `accross` (sic). Our regex handles both.

### 1.8 Dividers

```
== Section Title ==
```

Regex: `/^==\s*(.*?)\s*==$/` — captures the text between the `==` markers.

### 1.9 Delays

```
...                           — blank delay
... 5 minutes later ...       — labeled delay
```

Regex: `/^(?:\.\.\.|\u2026)\s*(.*?)\s*(?:\.\.\.|\u2026)?$/` — also accepts the `…` Unicode ellipsis.

### 1.10 HSpace

```
||20||                        — 20 pixel vertical spacer
||||                          — default spacer
```

Regex: `/^\|\|\s*(\d+)?\s*\|+$/`

**Gotcha**: `|| 20 ||` (with spaces around the number) causes a syntax error on PlantUML's official server. PlantUML's Java regex has no whitespace allowance inside the pipes. Our parser is lenient and accepts spaces, but test `.puml` files should use the strict form `||20||`.

### 1.11 References

```
ref over Alice, Bob : See other diagram
```

Multi-line form:
```
ref over Alice, Bob
  Multi-line reference
  description
end ref
```

### 1.12 Boxes

```
box "Internal Services" #LightBlue
  participant SvcA
  participant SvcB
end box
```

The parser tracks `this.currentBox`. When a participant is declared inside a box block, its code is added to `currentBox.participants[]`. On `end box`, the box is pushed to `diagram.boxes[]`.

### 1.13 Autonumber

```
autonumber                    — start at 1, step 1
autonumber 10                 — start at 10
autonumber 10 5               — start at 10, step 5
autonumber 1 1 "##"           — with format string
autonumber stop               — stop numbering
autonumber resume             — resume from where stopped
```

Stored in `diagram.autoNumber` as an `AutoNumber(start, step, format)` object. **Not yet emitted** — the emitter ignores autonumber. It would need to prefix message labels with the computed number.

### 1.14 Exo Arrows (Tier 2)

Arrows from/to the diagram boundary:
```
[-> Alice : from left
Alice ->] : to right
[<- Alice : to left (confusing but valid)
```

These create `ExoMessage` objects with an `exoType`: `FROM_LEFT`, `TO_LEFT`, `FROM_RIGHT`, `TO_RIGHT`. The parser has two regex branches — one for left-boundary arrows and one for right-boundary arrows.

### 1.15 Title

```
title My Diagram Title
```

Stored as `diagram.title`. **Not emitted** — the emitter doesn't currently render the title. It could be added as a text cell above the diagram.

---

## 2. The Data Model (SequenceModel.js)

### Enums (all `Object.freeze`)

| Enum | Values |
|---|---|
| `ParticipantType` | `participant`, `actor`, `boundary`, `control`, `entity`, `queue`, `database`, `collections` |
| `ArrowHead` | `normal`, `async`, `crossx`, `none` |
| `ArrowBody` | `normal`, `dotted`, `hidden`, `bold` |
| `ArrowPart` | `full`, `top`, `bottom` |
| `ArrowDecoration` | `none`, `circle` |
| `ArrowDirection` | `left_to_right`, `right_to_left`, `self`, `both` |
| `NotePosition` | `left`, `right`, `over` |
| `NoteStyle` | `note`, `hnote`, `rnote` |
| `NoteOnArrowPosition` | `left`, `right`, `top`, `bottom` |
| `LifeEventType` | `activate`, `deactivate`, `create`, `destroy` |
| `GroupingType` | `alt`, `else`, `loop`, `opt`, `par`, `break`, `critical`, `group`, `end` |
| `ExoMessageType` | `from_left`, `to_left`, `from_right`, `to_right` |

### Classes

**`Participant`**: `{ code, displayName, type, order, color, stereotype, isCreated }`

**`ArrowConfig`**: `{ head1, head2, body, part, decoration1, decoration2, color, style }` — plus computed getter `direction`.

**`Message`**: `{ from, to, label, arrow: ArrowConfig, noteOnArrow, isParallel, multicast[] }` — computed getter `isSelf` returns `from === to`.

**`ExoMessage`**: `{ participant, label, arrow, exoType, noteOnArrow, isParallel }`

**`LifeEvent`**: `{ participant, type: LifeEventType, color }`

**`Fragment`**: `{ type: GroupingType, label, color, color2, sections: FragmentSection[] }`

**`FragmentSection`**: `{ condition, elements[] }`

**`Note`**: `{ participants[], position, text, style: NoteStyle, color, isAcross, isParallel }`

**`NoteOnArrow`**: `{ position: NoteOnArrowPosition, text, style, color }`

**`Divider`**: `{ label }`

**`Delay`**: `{ label }`

**`HSpace`**: `{ size }` — null means default

**`Reference`**: `{ participants[], text, color, url }`

**`Box`**: `{ title, color, stereotype, participants[] }`

**`AutoNumber`**: `{ start, step, format }`

**`SequenceDiagram`**: `{ title, participants: Map, participantOrder[], elements[], boxes[], autoNumber }`

---

## 3. draw.io / mxGraph Mapping Decisions

### 3.1 Participant Type → Shape Style

| PlantUML type | draw.io `shape` value | Current style string |
|---|---|---|
| `participant` | *(none — default rectangle)* | `rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;` |
| `actor` | `mxgraph.basic.person` | `shape=mxgraph.basic.person;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;` |
| `boundary` | `mxgraph.sysml.port` | `shape=mxgraph.sysml.port;...` |
| `control` | `mxgraph.flowchart.on-page_reference` | `shape=mxgraph.flowchart.on-page_reference;...` |
| `entity` | `mxgraph.er.entity` | `shape=mxgraph.er.entity;...` |
| `database` | `mxgraph.flowchart.database` | `shape=mxgraph.flowchart.database;...` |
| `queue` | `mxgraph.flowchart.delay` | `shape=mxgraph.flowchart.delay;...` |
| `collections` | `mxgraph.basic.layered_rect` | `shape=mxgraph.basic.layered_rect;...` |

**Known issue**: These shapes are approximations. `boundary`, `control`, and `entity` don't match the standard UML robustness icons (circle-on-line, circle-with-arrow, circle-with-underline). This is issue #3 in the open issues list. The current shapes are the closest things available in draw.io's built-in shape libraries, but they don't look like the PlantUML rendering. David may need to provide custom stencils or we need to find better shape matches.

All participant styles share `fillColor=#dae8fc;strokeColor=#6c8ebf` (light blue fill, dark blue border). User-specified colors override via string replacement: `style.replace(/fillColor=[^;]+/, ...)`.

### 3.2 Arrow → Edge Style

Arrows are freestanding edges (not connected to cell ports). They use `sourcePoint` and `targetPoint` inside the geometry:

```xml
<mxCell id="puml-5" value="hello" style="html=1;verticalAlign=bottom;endFill=1;rounded=0;endArrow=block;" edge="1" parent="puml-grp-1">
    <mxGeometry relative="1" as="geometry">
        <mxPoint x="100" y="90" as="sourcePoint"/>
        <mxPoint x="260" y="90" as="targetPoint"/>
    </mxGeometry>
</mxCell>
```

**Base message style** (all messages start from this, then add properties):
```javascript
messageBase: {
    html: 1,
    verticalAlign: 'bottom',  // label above arrow line
    endFill: 0,
    rounded: 0
}
```

**Arrow head mapping**:

| ArrowHead | endArrow / startArrow | endFill / startFill |
|---|---|---|
| `NORMAL` | `block` | `1` |
| `ASYNC` | `open` | `0` |
| `CROSSX` | `cross` | `0` |
| `NONE` | `none` | — |

**Decorations**: `ArrowDecoration.CIRCLE` → `startArrow='oval'` / `endArrow='oval'` with `Fill=0`.

**Dotted body**: `ArrowBody.DOTTED` → `dashed=1` on the style.

**Arrow color**: `arrow.color` → `strokeColor=<color>;fontColor=<color>`.

### 3.3 Self-Message

Self-messages (`from === to`) use waypoints to draw a loop that goes right and comes back:

```
sourcePoint: (centerX, y)
waypoint: (centerX + 30, y)           — right
waypoint: (centerX + 30, y + 20)      — down
targetPoint: (centerX, y + 20)        — back to lifeline
```

Consumes `ROW_HEIGHT + SELF_MESSAGE_HEIGHT` (40 + 20 = 60px) of vertical space.

### 3.4 Lifelines

Dashed vertical edges from bottom of participant header to bottom of diagram:

```
style: endArrow=none;dashed=1;strokeColor=#999999;dashPattern=4 4;
sourcePoint: (centerX, lifelineStartY)
targetPoint: (centerX, diagramBottomY)
```

For created participants, `lifelineStartYOverrides` stores a per-participant override for the start Y (bottom of the mid-diagram header box instead of the default top).

### 3.5 Activation Bars

Rectangle vertices centered on the lifeline:

```
x: centerX - 6    (ACTIVATION_WIDTH/2 = 6)
y: startY
width: 12          (ACTIVATION_WIDTH)
height: endY - startY, min 10px
style: fillColor=#e6e6e6;strokeColor=#999999;
```

Activations are tracked in `activeActivations: Map<code, [{id, startY, color}]>`. It's a stack per participant to support nested activations (e.g. recursive calls). `_startActivation` pushes, `_endActivation` pops and emits the cell.

`_closeAllActivations()` runs at the end to close any activations that were never explicitly deactivated.

### 3.6 Created Participants (Mid-Diagram)

When `LifeEventType.CREATE` is processed:

1. Participant header emitted at `this.currentY` instead of `LAYOUT.MARGIN_TOP`
2. Style gets `labelPosition=center;verticalLabelPosition=bottom;align=center;verticalAlign=top;` appended so the name label renders below the box
3. `lifelineStartYOverrides.set(code, headerY + height)` so the lifeline starts from the bottom of the mid-diagram header
4. `justCreatedParticipants.add(code)` so the next message targeting it terminates at the box edge

The first message after creation (`Alice -> UserEntity : new()`) gets its target X adjusted from `toPos.centerX` to `toPos.x` (left edge) or `toPos.x + toPos.width` (right edge), depending on arrow direction. After emitting that message, the participant is removed from `justCreatedParticipants`.

### 3.7 Destroy

An X symbol at the current Y position on the lifeline:

```
shape: mxgraph.basic.x
size: 16x16
position: (centerX - 8, currentY)
fillColor=#FF0000;strokeColor=#FF0000
```

`_emitDestroy` also calls `_endActivation` first to close any open activation bar.

### 3.8 Fragments

Three cells per fragment:

1. **Container**: dashed rectangle spanning the full diagram width
   ```
   style: rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#666666;dashed=1;verticalAlign=top;align=left;spacingTop=0;spacingLeft=5;
   x: MARGIN_LEFT - FRAGMENT_PADDING
   width: diagramWidth - 2*MARGIN_LEFT + 2*FRAGMENT_PADDING
   ```

2. **Label tag**: small rectangle at top-left corner showing "ALT [condition]"
   ```
   style: fillColor=#e6e6e6;strokeColor=#666666;rounded=0;html=1;verticalAlign=middle;align=center;
   width: max(80, labelText.length * 7 + 20)
   height: FRAGMENT_HEADER_HEIGHT (20)
   ```
   **Known issue #2**: This is a plain rectangle. PlantUML renders it as a pentagon/tab shape (rectangle with a diagonal cut on the bottom-right corner). draw.io may need a custom shape or we could use a triangle clip.

3. **Separators** (for `else` sections): dashed horizontal edges
   ```
   style: shape=line;strokeWidth=1;strokeColor=#666666;dashed=1;html=1;
   sourcePoint: (x, sepY)
   targetPoint: (x + width, sepY)
   value: "[condition]" if present
   ```

Fragment sections are processed recursively via `_emitElements(section.elements)`, which enables nesting.

### 3.9 Notes

Three visual styles:

| NoteStyle | draw.io style |
|---|---|
| `NOTE` | `shape=note;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;size=10;` |
| `HNOTE` | `shape=hexagon;...fillColor=#fff2cc;strokeColor=#d6b656;size=10;perimeter=hexagonPerimeter2;` |
| `RNOTE` | `rounded=1;...fillColor=#fff2cc;strokeColor=#d6b656;` |

**Positioning logic** in `_emitNote`:

- `isAcross`: x = MARGIN_LEFT, width = full diagram
- 2 participants: x spans from pos1.centerX to pos2.centerX
- 1 participant, LEFT: x = centerX - NOTE_WIDTH - NOTE_MARGIN
- 1 participant, RIGHT: x = centerX + NOTE_MARGIN
- 1 participant, OVER: x = centerX - NOTE_WIDTH/2

**Height estimation**: `max(NOTE_HEIGHT, lineCount * 16 + 10)` — 16px per line of text.

**Known issue #4**: Notes cluster on the left side of the diagram because the positioning is relative to `centerX` of the target participant, but doesn't account for the participant's width or the note potentially overlapping other participants.

**Note on arrow** positioning: relative to the midpoint between source and target participants. RIGHT/LEFT offset by NOTE_MARGIN (10px). TOP/BOTTOM offset by NOTE_HEIGHT. **Known issue #5**: arrow labels overlap lifelines because label positioning doesn't account for the distance between participants.

### 3.10 Dividers

Full-width dashed line with centered label:

```
style: shape=line;strokeWidth=1;strokeColor=#999999;dashed=1;labelPosition=center;align=center;verticalAlign=middle;html=1;
height: DIVIDER_HEIGHT (20)
```

### 3.11 Delays

Label-only element (no visible line when strokeWidth=0):

```
style: shape=line;strokeWidth=0;dashed=1;strokeColor=#999999;fillColor=none;html=1;verticalAlign=middle;align=center;
height: DELAY_HEIGHT (30)
```

Delay always consumes DELAY_HEIGHT vertical space regardless of whether it has a label.

### 3.12 References

```
style: rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;verticalAlign=middle;align=center;
height: REF_HEIGHT (30)
```

Width spans from first to last referenced participant (with FRAGMENT_PADDING).

### 3.13 Boxes

Background rectangles drawn behind everything else (first in z-order):

```
style: rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#cccccc;dashed=1;verticalAlign=top;align=center;spacingTop=2;
x: minX - padding
height: full diagram height
y: MARGIN_TOP - 15
```

**Known issue #6**: PlantUML renders boxes as colored background columns behind the participants. Our current implementation draws a dashed outlined box with no fill, which doesn't match the PlantUML visual.

---

## 4. Layout Algorithm

### 4.1 Overview

Simple top-down sequential layout. No overlap detection. No ELK.

```
emit(parentId):
  1. _layoutParticipants()         — assign X positions
  2. _emitParticipantHeaders()     — draw header boxes at top (skip isCreated)
  3. currentY += PARTICIPANT_HEIGHT + LIFELINE_TOP_MARGIN
  4. _emitElements(diagram.elements)  — process everything, advancing currentY
  5. currentY += ROW_HEIGHT          — bottom margin
  6. _emitLifelines(startY, endY)    — vertical dashed lines
  7. _closeAllActivations()          — close unclosed bars
  8. _emitBoxes()                    — background boxes
  9. Sort: [...boxCells, ...vertices, ...edges]  — z-order
```

### 4.2 Layout Constants

```javascript
PARTICIPANT_WIDTH: 120      // Default participant box width
PARTICIPANT_HEIGHT: 40      // Default participant box height
PARTICIPANT_GAP: 40         // Horizontal gap between participants
LIFELINE_TOP_MARGIN: 10    // Gap between header and first element
ROW_HEIGHT: 40              // Vertical space per message/element
ACTIVATION_WIDTH: 12        // Activation bar width
NOTE_WIDTH: 120             // Note width
NOTE_HEIGHT: 30             // Minimum note height
NOTE_MARGIN: 10             // Gap between note and lifeline
FRAGMENT_PADDING: 10        // Fragment inset
FRAGMENT_HEADER_HEIGHT: 20  // Fragment label tag height
DIVIDER_HEIGHT: 20
DELAY_HEIGHT: 30
REF_HEIGHT: 30
MARGIN_LEFT: 40             // Left edge of diagram
MARGIN_TOP: 20              // Top edge of diagram
EXO_ARROW_LENGTH: 60
SELF_MESSAGE_WIDTH: 30      // Self-message loop width
SELF_MESSAGE_HEIGHT: 20     // Self-message loop height
ACTOR_WIDTH: 40
ACTOR_HEIGHT: 50
```

### 4.3 Participant Width Calculation

```javascript
_participantWidth(p):
  if actor: ACTOR_WIDTH (40)
  else: max(PARTICIPANT_WIDTH, displayName.length * 8 + 20)
```

Uses a rough `8px per character` estimate. No actual text measurement.

### 4.4 Vertical Space Consumption

Each element type consumes vertical space:

| Element | Space consumed |
|---|---|
| Message | ROW_HEIGHT (40) |
| Self-message | ROW_HEIGHT + SELF_MESSAGE_HEIGHT (60) |
| ExoMessage | ROW_HEIGHT (40) |
| LifeEvent (any) | 0 (no Y advance) |
| Fragment | HEADER_HEIGHT + contents + PADDING |
| Note | max(NOTE_HEIGHT, lineCount*16+10) + 5 |
| Divider | DIVIDER_HEIGHT (20) |
| Delay | DELAY_HEIGHT (30) |
| HSpace | `size` or ROW_HEIGHT (40 default) |
| Reference | REF_HEIGHT + 5 (35) |
| Return message | ROW_HEIGHT (40) — but no arrow drawn |

---

## 5. Known Issues and Open Work Items

### Active Issues (in priority order)

1. **~~Created participants render at top~~** — FIXED. Created participants now emit mid-diagram at the CREATE event point, with lifeline starting from the header bottom and the first message arrow terminating at the box edge.

2. **Fragment label shape is wrong** — The label tag is a plain rectangle. PlantUML uses a pentagon/tab shape (rectangle with diagonal bottom-right corner). Need to find or create a draw.io shape that matches.

3. **Participant type shapes don't match UML convention** — `boundary` (`mxgraph.sysml.port`), `control` (`mxgraph.flowchart.on-page_reference`), `entity` (`mxgraph.er.entity`) are visual approximations, not the standard UML robustness analysis icons. The standard icons are: boundary = line with circle, control = circle with arrow, entity = circle with underline.

4. **Notes cluster on the left** — Note positioning doesn't properly account for participant widths and can overlap lifelines. Notes on the left of the leftmost participant can go off-screen. Notes over two participants work but the width calculation uses centerX rather than accounting for box widths.

5. **Arrow labels overlap lifelines** — Message labels use `verticalAlign=bottom` which places them above the arrow, but they can overlap with intermediate participant lifelines. No logic to detect or avoid this.

6. **Box grouping visual treatment** — Current: dashed outline with no fill. PlantUML: colored column background. Need to use a filled rectangle with the box's color and appropriate opacity.

### Incomplete / Not Yet Emitted Features

| Feature | Parser | Model | Emitter | Notes |
|---|---|---|---|---|
| Autonumber | ✅ | ✅ | ❌ | Need to prefix labels with computed numbers |
| Return messages | ✅ (partial) | ✅ | ❌ (just advances Y) | Need activation stack to resolve source/target |
| Multicast | ✅ | ✅ (stored) | ❌ | `msg.multicast[]` populated but not emitted as extra arrows |
| Parallel `&` | ✅ | ✅ (flag) | ❌ | `msg.isParallel` set but no Y-sharing logic |
| Title | ✅ | ✅ | ❌ | `diagram.title` stored but not rendered |
| Participant stereotypes | ✅ | ✅ | ❌ | `p.stereotype` stored but not rendered |
| Arrow `bold` / `hidden` | ✅ (parsed) | ✅ | ❌ | `ArrowBody.BOLD`/`HIDDEN` not mapped to styles |
| Arrow part (top/bottom) | ✅ | ✅ | ❌ | `ArrowPart.TOP_PART`/`BOTTOM_PART` not visually distinct |
| Exo arrow direction | ✅ | ✅ | ⚠️ (partial) | Direction logic for `[<-` and `->]` variants may be wrong — needs visual testing |

### Deferred Features (Tier 3 — not parsed)

- Angle specifications on arrows
- Partial arrows (top/bottom half)
- Link anchors
- `autoactivate`
- `newpage`
- Complex autonumber formats with `resume`/`inc`
- `!include` / preprocessor directives
- `skinparam` (style customization)
- `header` / `footer` / `caption`
- Creole markup in labels
- URL links on participants

---

## 6. Test Coverage

### Unit Tests (test.js — 97 tests)

**Arrow Parser** (11 tests):
- `->`, `-->`, `->>`, `-->>`, `<-`, `<->`, `->x`, `o->`, `o->o` — head/body/decoration parsing
- `parseStyle('#red')` — color extraction
- `parseStyle('dashed')` — lineStyle extraction

**Sequence Parser** (19 tests):
- Basic participants (3 types)
- Participant aliases (`"Display" as Code`)
- Simple messages (from/to/label)
- Self message (`isSelf` flag)
- Auto-declare participants
- Inline activation (`++`, `--`)
- Explicit activation/deactivation
- Divider (label extraction)
- Delay (label extraction)
- Fragment alt/else (section count, nested elements)
- Nested fragments (loop containing alt)
- Note on participant (position, text)
- Multi-line note
- Note over two participants
- Reference
- Box (title, participant membership)
- Title
- Autonumber
- Destroy

**Full Pipeline** (7 tests):
- Basic conversion (mxfile structure, plantUml attribute, participant labels)
- Complex diagram (title, message labels, group editability)
- Extract PlantUML from output
- Regenerate from existing XML
- Regenerate with new PlantUML text
- Diagram type detection
- No-wrap mode (wrapInDocument=false, wrapInGroup=false)

### Test Gaps

- No tests for exo arrows parsing
- No tests for multicast parsing
- No tests for `hnote`/`rnote` style parsing
- No tests for note across
- No tests for note on arrow
- No tests for `create` (standalone or inline `**`)
- No tests for color modifiers on arrows (`-[#red]>`)
- No tests for participant ordering
- No tests for combined activation specs (`++--`, `--++`)
- No tests for `autonumber stop`/`resume`
- No tests for ref multi-line
- No tests that verify emitter output geometry/positions
- No tests that verify z-order in output

### Visual Test (generate-comprehensive-test.js)

The comprehensive test `.puml` exercises every feature in one diagram:
- All 8 participant types + alias + box grouping
- Arrow types: `->`, `-->`, `->>`, `-->>`, `<-`, `<--`, `<->`, `->x`, `o->`, `o->o`, `x->`
- Self message
- Dividers between sections
- Explicit activate/deactivate
- Inline `++`, `--`, `++--`
- Create + destroy lifecycle
- Return keyword
- All fragment types: alt/else, loop, opt, par, break, critical, group, nested
- Notes: right, left, over, over-two, multi-line, across, hnote, rnote, on-arrow
- Delay, HSpace, Reference
- Autonumber (start/stop)
- Messages to every participant type
- Colored arrow
- Box grouping with color

To test: paste the `.puml` file at http://www.plantuml.com/plantuml/uml/ and open the `.drawio` in draw.io. Compare side-by-side.

---

## 7. Bugs Fixed (History)

These are documented so you don't reintroduce them:

1. **`ArrowPart.WHOLE` vs `ArrowPart.FULL`** — ArrowParser referenced `WHOLE`, model defined `FULL`. All occurrences replaced.

2. **`ArrowConfig.direction` is a getter** — Attempted `config.direction = parsed.direction` silently failed. `direction` is derived from head1/head2. Removed the assignment.

3. **Arrow `->x` CROSSX overwritten** — The `x` decoration set `head2=CROSSX`, then the `>` dressing set `head2=NORMAL`. Added guard: `if (result.head2 === ArrowHead.NONE)` in the dressing step.

4. **Duplicate cell IDs** — Group cell and first child both got `puml-1` because they used separate ID generators starting at 1. Fixed by using `puml-grp-1` prefix for the group.

5. **Hardcoded VM paths in generators** — Used absolute `/sessions/...` paths. Fixed with `import.meta.url` + `dirname`/`join`.

6. **UserObject structure** — Children were nested inside `<UserObject>` tag. draw.io requires children as XML siblings referencing the group's id via `parent`. Fixed in `buildUserObject`.

7. **Edges not rendering** — Used `<Array as="points">`. draw.io requires `<mxPoint ... as="sourcePoint"/>` and `<mxPoint ... as="targetPoint"/>` for freestanding edges.

8. **Z-order wrong** — Edges rendered behind vertices. Fixed by partitioning output into `[...boxCells, ...vertices, ...edges]`.

9. **HSpace `|| 20 ||` syntax** — PlantUML server rejects spaces inside pipes. Official regex allows no whitespace. Fixed test data to `||20||`.

10. **`create` on pre-declared participant** — `addParticipant` silently discards duplicates, so `isCreated=true` was lost. Fixed: `if (isCreate && existing !== p) { existing.isCreated = true; }`.
