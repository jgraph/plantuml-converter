# Usecase Diagram Converter — Implementation Notes

## Architecture

Same three-stage pipeline as sequence and class diagrams:
```
PlantUML text → UsecaseParser → UsecaseDiagram model → UsecaseEmitter → mxCell XML
```

## PlantUML Source Reference

Usecase diagrams are handled by PlantUML's **Description Diagram** infrastructure (`net/sourceforge/plantuml/descdiagram/`), not a dedicated usecase package. Key command classes:

- `CommandCreateElementFull` — main element creation (actor, usecase, containers)
- `CommandLinkElement` — relationships (same as class diagrams)
- `CommandPackageWithUSymbol` — package/rectangle/frame/cloud containers
- `CommandRankDir` — `left to right direction` / `top to bottom direction`

## Element Type → draw.io Style Mapping

| PlantUML Type | draw.io Style | Notes |
|---|---|---|
| `actor` | `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;` | Stick figure, label below |
| `actor/` | Same as actor | Business actor (visual distinction deferred) |
| `usecase` / `(Name)` | `ellipse=1;whiteSpace=wrap;html=1;` | Ellipse, label centered |
| `usecase/` / `(Name)/` | Same as usecase | Business usecase (visual distinction deferred) |
| `package` | `shape=folder;tabWidth=80;tabHeight=20;container=1;collapsible=0;` | Folder tab style |
| `rectangle` | `rounded=0;container=1;collapsible=0;` | Plain rectangle |
| `frame` | `shape=mxgraph.sysml.package;container=1;collapsible=0;` | SysML package |
| `cloud` | `shape=cloud;container=1;collapsible=0;` | Cloud shape |
| Note | `shape=note;fillColor=#FFF2CC;strokeColor=#D6B656;` | Yellow note |

## Relationship → Edge Style Mapping

Same decorator enums as class diagrams (duplicated, not shared):

| Arrow | Decorators | draw.io Style |
|---|---|---|
| `-->` | right=ARROW | `endArrow=open;endFill=1;` |
| `..>` | right=ARROW, dashed | `endArrow=open;dashed=1;` |
| `--|>` | right=EXTENDS | `endArrow=block;endFill=0;` |
| `<|--` | left=EXTENDS | `startArrow=block;startFill=0;` |
| `--` | none | `endArrow=none;startArrow=none;` |
| `==>` | right=ARROW, bold | `endArrow=open;strokeWidth=2;` |

## Shorthand Syntax

| Syntax | Element Type | Code | Display Name |
|---|---|---|---|
| `:Actor Name:` | ACTOR | `ActorName` | `Actor Name` |
| `:Actor Name:/` | ACTOR_BUSINESS | `ActorName` | `Actor Name` |
| `(Use Case Name)` | USECASE | `UseCaseName` | `Use Case Name` |
| `(Use Case Name)/` | USECASE_BUSINESS | `UseCaseName` | `Use Case Name` |

Code is derived by stripping spaces and non-word characters from the display name.

## Parser Notes

- Parse order matters: single-line notes must be tried before multi-line notes
- Actor/usecase shorthand in link entities auto-creates the element
- Container nesting uses a stack (like class parser's package stack)
- `actor` keyword is shared with sequence diagrams — detection heuristic distinguishes by requiring usecase-specific patterns (`:shorthand:`, `(shorthand)`, `usecase` keyword)
- Link regex is duplicated from ClassParser (same decorator tables)

## Layout

Grid-based layout (like class diagrams):
- Elements placed in a grid with COLS_PER_ROW = 4
- Containers rendered as background boxes with children positioned inside
- Default direction: top-to-bottom
- `left to right direction` parsed but grid layout doesn't change orientation (ELK handles this)

## Comparison Rubric

### Blocking (must fix)
- Missing actors or usecases
- Missing relationships
- Wrong relationship type (arrow vs triangle vs diamond)
- Missing containers

### Important (should fix)
- Missing notes
- Wrong shapes (actor vs usecase)
- Missing stereotypes or labels
- Wrong line style (solid vs dashed)

### Cosmetic (defer)
- Layout differences (grid vs GraphViz)
- Actor stick figure style differences
- Font/text alignment
- Exact positioning of notes
- Business variant visual markers

## Known Limitations

- Business actor/usecase visual distinction not implemented (both render as standard actor/usecase)
- Actor style variants (awesome, hollow) not supported — these are skinparam-driven
- `together { ... }` grouping parsed but has no layout effect
- `hide`/`show`/`remove` parsed but not acted upon
- Component/interface shorthand (`[comp]`, `() intf`) not implemented
- URL attachment not supported
- Grid layout doesn't respect `left to right direction` (ELK handles this)
- Actors are not automatically placed outside containers
