# Component / Deployment Diagram — Semantics & Reference

## Scope

This handler covers both **component diagrams** and **deployment diagrams**. In PlantUML's Java source, both are implemented by the same `DescriptionDiagram` class. The `component` key in the handler registry covers both `@startcomponent` and `@startdeployment` triggers.

## Supported Syntax

### Element Declaration

**Bracket shorthand** (component-specific):
```
[Component Name]
[Component Name] as alias
["Display Name"] as alias
[Component] <<stereotype>> #color
```

**Interface shorthand**:
```
() InterfaceName
() "Display Name" as alias
```

**Keyword declarations** (all 30+ description diagram types):
```
component "Name" as alias
node "Server" as srv
cloud "AWS" as aws
database "DB" as db
storage "S3" as s3
artifact "app.war" as war
...
```

**Actor shorthand**: `:Actor Name:`
**Usecase shorthand**: `(Use Case Name)`

### Containers

Any element keyword followed by `{` creates a container:
```
node "Server" {
    component "App" as app
    database "Cache" as cache
}
```

Containers nest arbitrarily. Supported container types: package, rectangle, frame, cloud, node, folder, database, component, card, file, hexagon, storage, queue, stack, agent, artifact.

### Relationships

Same link syntax as all description diagrams:
- Arrow bodies: `-` (solid), `.` (dashed), `=` (bold), `~` (dotted)
- Arrow heads: `>`, `|>`, `*`, `o`, `<<`, `>>`, `#`, `+`, etc.
- Direction hints: `-left->`, `-up->`, `-right->`, `-down->`
- Labels: `A --> B : label` or `A "left" --> "right" B`
- Styles: `-[#red]->`, `-[bold]->`

### Notes

```
note left of [Component] : text
note right of entity
    multi-line
end note
note "text" as N1
note on link : text
```

## Shape Mapping (draw.io styles)

| ElementType | draw.io shape |
|---|---|
| COMPONENT | `shape=component;` |
| NODE | `shape=box3d;size=10;` |
| CLOUD | `shape=cloud;` |
| DATABASE | `shape=cylinder3;size=15;` |
| STORAGE | `shape=mxgraph.eip.dataStore;` |
| ARTIFACT | `shape=mxgraph.sysml.package;` |
| FOLDER | `shape=folder;tabWidth=80;tabHeight=20;` |
| FILE | `shape=note;size=15;` |
| FRAME | `shape=mxgraph.sysml.package;` |
| INTERFACE | `shape=ellipse;` (30x30, label below) |
| ACTOR | `shape=umlActor;` |
| AGENT | rectangle (no special shape) |
| PERSON | `shape=mxgraph.basic.person;` |
| BOUNDARY | `shape=mxgraph.sysml.boundary;` |
| CONTROL | `shape=mxgraph.sysml.control;` |
| ENTITY_DESC | `shape=mxgraph.sysml.entity;` |
| HEXAGON | `shape=hexagon;` |
| CARD | `shape=card;size=18;` |
| QUEUE | `shape=mxgraph.sysml.queue;` |
| STACK | `shape=process;` |
| LABEL | no border/fill (text only) |
| COLLECTIONS | rectangle with shadow |
| PORT/PORTIN/PORTOUT | small black ellipse (8x8) |

## Detection Heuristic

Triggers on `@startcomponent` or `@startdeployment`, or when the text scores >= 3 points:
- `[bracket]` shorthand: +2 per occurrence
- `component`/`interface` keyword: +2
- Deployment container keywords with `{`: +2
- Deployment element keywords: +1
- `()` interface shorthand: +2

This avoids false positives with usecase diagrams (which use `(parens)` and `:colons:`, not `[brackets]`).

## Layout

Uses a **topology-aware layered layout**:
- Connected elements are arranged top-to-bottom following relationship direction (longest-path layering)
- Orphan elements (no relationships) are placed in a 4-column grid below
- Containers are arranged in a 3-column grid
- Stereotypes render with proper guillemets (`«Service»`)

## Known Limitations

- **Ports**: Parsed but rendered as standalone small circles inside containers, not positioned on container edges.
- **Archimate**: Not supported.
- **Domain/Requirement**: Not supported.
- **Tags**: `$tag` syntax parsed but not acted upon.
- **Preprocessor**: `!include`, `!define`, etc. not supported.

## Comparison Rubric

When comparing PlantUML output vs draw.io output:

**Blocking**: Missing elements, wrong element types, missing relationships, broken connections
**Important**: Wrong shapes, missing stereotypes, missing labels, wrong arrow decorators
**Cosmetic**: Exact positioning, font sizes, padding, color shades
