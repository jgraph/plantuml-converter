# Timing Diagram — Converter Reference

## Scope

Converts PlantUML timing diagrams to draw.io mxGraph XML. Timing diagrams show state changes over a shared horizontal time axis with vertically stacked player lanes — a waveform-chart paradigm rather than graph layout.

## Supported Syntax

### Core (implemented)

| Feature | Syntax |
|---|---|
| Robust player | `[compact] robust "Name" as CODE [<<stereo>>] [#color]` |
| Concise player | `[compact] concise "Name" as CODE [<<stereo>>] [#color]` |
| Clock player | `[compact] clock "Name" as CODE with period N [pulse N] [offset N]` |
| Binary player | `[compact] binary "Name" as CODE [<<stereo>>] [#color]` |
| Analog player | `[compact] analog "Name" [between START and END] as CODE` |
| Rectangle player | `[compact] rectangle "Name" as CODE [<<stereo>>] [#color]` |
| State definitions | `PLAYER has S1, S2, S3` / `PLAYER has "Label" as S` |
| State change (by player) | `PLAYER is STATE [: comment]` |
| State change (by time) | `TIME is STATE [: comment]` (after `@PLAYER`) |
| Absolute time | `@N` (sets current time to N) |
| Relative time | `@+N` (adds N to current time) |
| Player context | `@PLAYER` (sets current player) |
| Named times | `@N as :name` |
| Time constraints | `@T1 <--> @T2 : label` |
| Named constraints | `@:name1 <--> @:name2 : label` |
| Messages | `P1@T1 --> P2@T2 : label` |
| Highlights | `highlight T1 to T2 [#color] [: caption]` |
| Notes | `note top\|bottom of PLAYER : text` |
| Multi-line notes | `note top\|bottom of PLAYER` / `end note` |
| Compact mode | `mode compact` (global) / `compact TYPE ...` (per-player) |
| Hide time axis | `hide time axis` |
| Title | `title text` |

### Deferred (not implemented)

- Date/hour time formats (`@2024/01/15`, `@10:30:00`)
- Clock multiples (`@clk*3`)
- Analog ticks (`PLAYER ticks every N`)
- Scale directive (`scale N as M pixels`)
- Pixel height customization
- Special states: `{hidden}`, `{...}`, `{-}`, `{?}`
- State transition pairs: `{STATE1,STATE2}`
- Arrow style modifiers on messages

## Player Type → draw.io Rendering

| Player Type | Rendering Approach |
|---|---|
| Robust | Stepped waveform: horizontal lines at state Y-levels, vertical/diagonal transitions |
| Concise | Horizontal colored bars per state period, with state name as text |
| Clock | Square wave from period/pulse/offset parameters |
| Binary | Two-level stepped waveform (high/low) |
| Analog | Polyline through (time, value) points |
| Rectangle | Colored boxes per state period, with state name as text |

## Detection Heuristic

Score-based, threshold ≥ 3:

| Pattern | Score |
|---|---|
| `@starttiming` | instant match |
| `robust\|concise` declaration | +3 |
| `clock ... with period` declaration | +3 |
| `binary` declaration | +3 |
| `analog` declaration | +3 |
| `rectangle` declaration | +1 (shared with component) |
| `highlight ... to ...` | +2 |
| `<--->` constraint | +1 |
| `N is STATE` pattern | +1 |

Registered **before** state in the handler map. Timing keywords (robust, concise, clock, binary, analog) are unique to timing diagrams and not shared with any other type.

## Layout Approach

Time-based horizontal axis with vertically stacked player lanes:

1. **Time axis**: Collect all referenced times, map to X pixel positions uniformly
2. **Players**: Stack top-to-bottom with gaps, label on the left
3. **Waveforms**: Rendered per player type using freestanding edges (polylines) and vertex cells (labels/bars)
4. **Overlays**: Highlights behind waveforms, constraints/messages on top

## Parser Context Model

Unlike other parsers, timing has implicit mutable context:

- `currentPlayer` — set by `@PLAYER` or inferred from `PLAYER is STATE`
- `currentTime` — set by `@TIME`, updated by `+OFFSET` relative times

The parser resolves ambiguity between `@PLAYER` and `@TIME` by checking if the token matches a declared player code. Same approach as PlantUML's Java source.

## Known Limitations

- No preprocessor support (`!include`, `!define`)
- No date/hour time formats
- No clock-relative time references (`@clk*3`)
- Analog bounds default to 0-100 if not specified
- Special states (`{hidden}`, etc.) not rendered with special styling
- Compact mode affects vertical spacing but not waveform style
- Note positioning is to the right of the waveform area, not inline

## Comparison Rubric

| Severity | Issue |
|---|---|
| Blocking | Missing players, missing state changes, no waveform rendered |
| Important | Missing constraints, messages, highlights, notes; wrong player type rendering |
| Cosmetic | Exact positioning, colors, label font sizes, waveform line thickness |
