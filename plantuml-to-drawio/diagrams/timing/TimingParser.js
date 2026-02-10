/**
 * TimingParser.js
 *
 * Line-by-line parser for PlantUML timing diagrams.
 *
 * Timing diagrams have implicit context: a "current player" and "current time"
 * that change as lines are parsed. This is fundamentally different from other
 * diagram parsers which are mostly line-independent.
 *
 * Key ambiguities resolved:
 *   - @PLAYER vs @TIME: check if token matches a declared player code first
 *   - PLAYER is STATE vs TIME is STATE: check if LHS is a known player code
 *
 * Regex patterns derived from PlantUML Java source:
 *   net/sourceforge/plantuml/timingdiagram/command/Command*.java
 *
 * Exports parseTimingDiagram(text) → TimingDiagram
 */

import {
	PlayerType,
	NotePosition,
	TimingPlayer,
	StateChange,
	TimeConstraint,
	TimeMessage,
	TimingHighlight,
	TimingNote,
	TimingDiagram,
} from './TimingModel.js';

// ── Regex patterns ───────────────────────────────────────────────────────────

// Player declarations
// [compact] (robust|concise|rectangle) ["Name" as] CODE [<<stereo>>] [#color]
const RE_ROBUST_CONCISE = /^(?:(compact)\s+)?(robust|concise|rectangle)\s+(?:"([^"]+)"\s+as\s+)?(\w[\w.]*)\s*(?:<<([^>]+)>>)?\s*(?:(#\w+))?\s*$/i;

// [compact] clock ["Name" as] CODE with period N [pulse N] [offset N] [<<stereo>>]
const RE_CLOCK = /^(?:(compact)\s+)?clock\s+(?:"([^"]+)"\s+as\s+)?(\w[\w.]*)\s+with\s+period\s+(\d+(?:\.\d+)?)(?:\s+pulse\s+(\d+(?:\.\d+)?))?(?:\s+offset\s+(\d+(?:\.\d+)?))?\s*(?:<<([^>]+)>>)?\s*$/i;

// [compact] binary ["Name" as] CODE [<<stereo>>] [#color]
const RE_BINARY = /^(?:(compact)\s+)?binary\s+(?:"([^"]+)"\s+as\s+)?(\w[\w.]*)\s*(?:<<([^>]+)>>)?\s*(?:(#\w+))?\s*$/i;

// [compact] analog "Name" [<<stereo>>] [between|from START and|to END] as CODE [<<stereo>>] [#color]
const RE_ANALOG = /^(?:(compact)\s+)?analog\s+"([^"]+)"\s*(?:<<([^>]+)>>)?\s*(?:(?:between|from)\s+(-?[\d.]+)\s+(?:and|to)\s+(-?[\d.]+)\s+)?as\s+(\w[\w.]*)\s*(?:<<([^>]+)>>)?\s*(?:(#\w+))?\s*$/i;

// State definitions
// PLAYER has STATE1,STATE2,STATE3
const RE_DEFINE_STATES = /^(\w[\w.]*)\s+has\s+(.+)$/i;

// Time/player context
// @TIME [as :CODE]
const RE_AT_TIME = /^@(\+?)(-?[\d.]+)(?:\s+as\s+:(\w[\w.]*))?$/;

// Constraints: [PLAYER]@T1 <--> @T2 [: label]  OR  @T1 <--> @T2 [: label]
const RE_CONSTRAINT = /^(?:(\w[\w.]*))?@(\+?[\d.]+)\s*(<-+>)\s*@(\+?[\d.]+)\s*(?::\s*(.*))?$/;

// Constraint with named times: @:name1 <--> @:name2 [: label]
const RE_CONSTRAINT_NAMED = /^@:(\w[\w.]*)\s*(<-+>)\s*@:(\w[\w.]*)\s*(?::\s*(.*))?$/;

// Messages: PLAYER1[@TIME1] -+> PLAYER2[@TIME2] [: label]
const RE_TIME_MESSAGE = /^(\w[\w.]*)@(\+?[\d.]+)\s*(-+>)\s*(\w[\w.]*)@(\+?[\d.]+)\s*(?::\s*(.*))?$/;

// Highlights: highlight TIME1 to TIME2 [#color] [: caption]
const RE_HIGHLIGHT = /^highlight\s+(\+?[\d.]+)\s+to\s+(\+?[\d.]+)\s*(?:(#\w+))?\s*(?::\s*(.*))?$/i;

// Notes
const RE_NOTE = /^note\s+(top|bottom)\s+of\s+(\w[\w.]*)\s*:\s*(.+)$/i;
const RE_NOTE_MULTI_START = /^note\s+(top|bottom)\s+of\s+(\w[\w.]*)\s*$/i;
const RE_END_NOTE = /^end\s*note$/i;

// State changes
// PLAYER is STATE [: comment]
const RE_STATE_BY_PLAYER = /^(\w[\w.]*)\s+is\s+(?:"([^"]*)"|([-\w][-\w.]*))\s*(?:(#\w+)\s*)?(?::\s*(.*))?$/;

// TIME is STATE [: comment]  (when current player is set)
const RE_STATE_BY_TIME = /^(\+?[\d.]+)\s+is\s+(?:"([^"]*)"|([-\w][-\w.]*))\s*(?:(#\w+)\s*)?(?::\s*(.*))?$/;

// Global directives
const RE_MODE_COMPACT = /^mode\s+compact$/i;
const RE_HIDE_TIME_AXIS = /^(?:hide|manual)\s+time[\s.]?axis$/i;
const RE_TITLE = /^title\s+(.+)$/i;

// Skip patterns
const RE_SKIP = /^(?:@start|@end|skinparam|scale|!|hide\s+footbox)/i;
const RE_COMMENT = /^(?:'|\/'.*)$/;

// ── Parser class ─────────────────────────────────────────────────────────────

class TimingParser {
	constructor() {
		this.diagram = null;
		this.currentPlayer = null;     // current player code
		this.currentTime = 0;          // current absolute time
		this.parserState = 'normal';   // 'normal' | 'multiline_note'
		this.multiLineNoteLines = [];
		this.multiLineNotePosition = null;
		this.multiLineNotePlayer = null;
	}

	parse(text) {
		this.diagram = new TimingDiagram();
		this.currentPlayer = null;
		this.currentTime = 0;
		this.parserState = 'normal';

		const lines = text.split('\n');

		for (const rawLine of lines) {
			const line = rawLine.trim();

			// Skip empty lines
			if (line === '') continue;

			// Handle multiline note collection
			if (this.parserState === 'multiline_note') {
				if (RE_END_NOTE.test(line)) {
					const noteText = this.multiLineNoteLines.join('\n');
					const note = new TimingNote(
						this.multiLineNotePosition,
						this.multiLineNotePlayer,
						noteText
					);
					this.diagram.addNote(note);
					this.parserState = 'normal';
				} else {
					this.multiLineNoteLines.push(line);
				}
				continue;
			}

			// Skip comments
			if (RE_COMMENT.test(line)) continue;
			if (/^\//.test(line) && /'\s*$/.test(line)) continue; // multiline comment end

			// Skip directives we don't handle
			if (RE_SKIP.test(line)) continue;

			// Try each parser in priority order
			if (this._tryTitle(line)) continue;
			if (this._tryModeCompact(line)) continue;
			if (this._tryHideTimeAxis(line)) continue;
			if (this._tryPlayerDeclaration(line)) continue;
			if (this._tryStateDefinition(line)) continue;
			if (this._tryNote(line)) continue;
			if (this._tryHighlight(line)) continue;
			if (this._tryConstraintNamed(line)) continue;
			if (this._tryConstraint(line)) continue;
			if (this._tryTimeMessage(line)) continue;
			if (this._tryAtContext(line)) continue;
			if (this._tryStateChangeByPlayer(line)) continue;
			if (this._tryStateChangeByTime(line)) continue;
		}

		// Sort each player's state changes by time
		for (const player of this.diagram.players) {
			player.stateChanges.sort((a, b) => a.time - b.time);
		}

		return this.diagram;
	}

	// ── Title ─────────────────────────────────────────────────────────────

	_tryTitle(line) {
		const m = RE_TITLE.exec(line);
		if (m == null) return false;
		this.diagram.title = m[1].trim();
		return true;
	}

	// ── Mode compact ──────────────────────────────────────────────────────

	_tryModeCompact(line) {
		if (RE_MODE_COMPACT.test(line) === false) return false;
		this.diagram.compactMode = true;
		return true;
	}

	// ── Hide time axis ────────────────────────────────────────────────────

	_tryHideTimeAxis(line) {
		if (RE_HIDE_TIME_AXIS.test(line) === false) return false;
		this.diagram.hideTimeAxis = true;
		return true;
	}

	// ── Player declarations ───────────────────────────────────────────────

	_tryPlayerDeclaration(line) {
		return this._tryRobustConcise(line) ||
			this._tryClock(line) ||
			this._tryBinary(line) ||
			this._tryAnalog(line);
	}

	_tryRobustConcise(line) {
		const m = RE_ROBUST_CONCISE.exec(line);
		if (m == null) return false;

		const compact = m[1] != null;
		const type = m[2].toLowerCase();
		const displayName = m[3] || m[4];
		const code = m[4];
		const stereotype = m[5] || null;
		const color = m[6] || null;

		const playerType = type === 'robust' ? PlayerType.ROBUST
			: type === 'concise' ? PlayerType.CONCISE
				: PlayerType.RECTANGLE;

		const player = this.diagram.getOrCreatePlayer(code, displayName, playerType);
		player.compact = compact || this.diagram.compactMode;
		player.stereotype = stereotype;
		player.color = color;

		return true;
	}

	_tryClock(line) {
		const m = RE_CLOCK.exec(line);
		if (m == null) return false;

		const compact = m[1] != null;
		const displayName = m[2] || m[3];
		const code = m[3];
		const period = parseFloat(m[4]);
		const pulse = m[5] ? parseFloat(m[5]) : period / 2;
		const offset = m[6] ? parseFloat(m[6]) : 0;
		const stereotype = m[7] || null;

		const player = this.diagram.getOrCreatePlayer(code, displayName, PlayerType.CLOCK);
		player.compact = compact || this.diagram.compactMode;
		player.stereotype = stereotype;
		player.clockPeriod = period;
		player.clockPulse = pulse;
		player.clockOffset = offset;

		return true;
	}

	_tryBinary(line) {
		const m = RE_BINARY.exec(line);
		if (m == null) return false;

		const compact = m[1] != null;
		const displayName = m[2] || m[3];
		const code = m[3];
		const stereotype = m[4] || null;
		const color = m[5] || null;

		const player = this.diagram.getOrCreatePlayer(code, displayName, PlayerType.BINARY);
		player.compact = compact || this.diagram.compactMode;
		player.stereotype = stereotype;
		player.color = color;

		return true;
	}

	_tryAnalog(line) {
		const m = RE_ANALOG.exec(line);
		if (m == null) return false;

		const compact = m[1] != null;
		const displayName = m[2];
		const stereo1 = m[3] || null;
		const analogStart = m[4] != null ? parseFloat(m[4]) : null;
		const analogEnd = m[5] != null ? parseFloat(m[5]) : null;
		const code = m[6];
		const stereo2 = m[7] || null;
		const color = m[8] || null;

		const player = this.diagram.getOrCreatePlayer(code, displayName, PlayerType.ANALOG);
		player.compact = compact || this.diagram.compactMode;
		player.stereotype = stereo1 || stereo2;
		player.color = color;
		player.analogStart = analogStart;
		player.analogEnd = analogEnd;

		return true;
	}

	// ── State definitions ─────────────────────────────────────────────────

	_tryStateDefinition(line) {
		const m = RE_DEFINE_STATES.exec(line);
		if (m == null) return false;

		const playerCode = m[1];
		const player = this.diagram.getPlayer(playerCode);
		if (player == null) return false;

		const statesPart = m[2].trim();

		// Check for long form: "Label" as CODE
		const longMatch = /^"([^"]+)"\s+as\s+(\w[\w.]*)$/.exec(statesPart);
		if (longMatch) {
			const label = longMatch[1];
			const stateCode = longMatch[2];
			player.stateAliases.set(stateCode, label);
			if (player.states.indexOf(stateCode) < 0) {
				player.states.push(stateCode);
			}
			return true;
		}

		// Short form: comma-separated state names
		const stateNames = statesPart.split(/\s*,\s*/);
		for (const name of stateNames) {
			const trimmed = name.trim();
			if (trimmed && player.states.indexOf(trimmed) < 0) {
				player.states.push(trimmed);
			}
		}

		return true;
	}

	// ── Notes ─────────────────────────────────────────────────────────────

	_tryNote(line) {
		// Single-line note
		const m = RE_NOTE.exec(line);
		if (m) {
			const position = m[1].toLowerCase() === 'top' ? NotePosition.TOP : NotePosition.BOTTOM;
			const playerCode = m[2];
			const text = m[3].trim();
			const note = new TimingNote(position, playerCode, text);
			this.diagram.addNote(note);
			return true;
		}

		// Multi-line note start
		const ms = RE_NOTE_MULTI_START.exec(line);
		if (ms) {
			this.parserState = 'multiline_note';
			this.multiLineNotePosition = ms[1].toLowerCase() === 'top' ? NotePosition.TOP : NotePosition.BOTTOM;
			this.multiLineNotePlayer = ms[2];
			this.multiLineNoteLines = [];
			return true;
		}

		return false;
	}

	// ── Highlights ────────────────────────────────────────────────────────

	_tryHighlight(line) {
		const m = RE_HIGHLIGHT.exec(line);
		if (m == null) return false;

		const startTime = this._resolveTime(m[1]);
		const endTime = this._resolveTime(m[2]);
		const color = m[3] || null;
		const caption = m[4] ? m[4].trim() : null;

		const hl = new TimingHighlight(startTime, endTime);
		hl.color = color;
		hl.caption = caption;
		this.diagram.addHighlight(hl);

		return true;
	}

	// ── Constraints ───────────────────────────────────────────────────────

	_tryConstraintNamed(line) {
		const m = RE_CONSTRAINT_NAMED.exec(line);
		if (m == null) return false;

		const name1 = m[1];
		const name2 = m[3];
		const label = m[4] ? m[4].trim() : null;

		const time1 = this.diagram.timeAliases.get(name1);
		const time2 = this.diagram.timeAliases.get(name2);

		if (time1 == null || time2 == null) return false;

		const constraint = new TimeConstraint(time1, time2);
		constraint.label = label;
		this.diagram.addConstraint(constraint);

		return true;
	}

	_tryConstraint(line) {
		const m = RE_CONSTRAINT.exec(line);
		if (m == null) return false;

		const playerCode = m[1] || null;
		const time1 = this._resolveTime(m[2]);
		const time2 = this._resolveTime(m[4]);
		const label = m[5] ? m[5].trim() : null;

		const constraint = new TimeConstraint(time1, time2);
		constraint.playerCode = playerCode;
		constraint.label = label;
		this.diagram.addConstraint(constraint);

		return true;
	}

	// ── Time messages ─────────────────────────────────────────────────────

	_tryTimeMessage(line) {
		const m = RE_TIME_MESSAGE.exec(line);
		if (m == null) return false;

		const fromPlayer = m[1];
		const fromTime = this._resolveTime(m[2]);
		const toPlayer = m[4];
		const toTime = this._resolveTime(m[5]);
		const label = m[6] ? m[6].trim() : null;

		const msg = new TimeMessage(fromPlayer, fromTime, toPlayer, toTime);
		msg.label = label;
		this.diagram.addMessage(msg);

		return true;
	}

	// ── @PLAYER / @TIME context ───────────────────────────────────────────

	_tryAtContext(line) {
		// Must start with @
		if (line.charAt(0) !== '@') return false;

		const rest = line.substring(1);

		// Try @TIME first for numeric values
		const timeMatch = RE_AT_TIME.exec(line);
		if (timeMatch) {
			const isRelative = timeMatch[1] === '+';
			const value = parseFloat(timeMatch[2]);
			const alias = timeMatch[3] || null;

			if (isRelative) {
				this.currentTime += value;
			} else {
				this.currentTime = value;
			}

			if (alias) {
				this.diagram.timeAliases.set(alias, this.currentTime);
			}

			return true;
		}

		// Try @PLAYER — must be a known player code
		const playerMatch = /^(\w[\w.]*)$/.exec(rest);
		if (playerMatch) {
			const code = playerMatch[1];
			if (this.diagram.hasPlayer(code)) {
				this.currentPlayer = code;
				return true;
			}
		}

		return false;
	}

	// ── State changes ─────────────────────────────────────────────────────

	_tryStateChangeByPlayer(line) {
		const m = RE_STATE_BY_PLAYER.exec(line);
		if (m == null) return false;

		const playerCode = m[1];

		// Only match if it's a known player code (otherwise it might be a time)
		if (this.diagram.hasPlayer(playerCode) === false) return false;

		const state = m[2] || m[3]; // quoted or bare
		const color = m[4] || null;
		const comment = m[5] ? m[5].trim() : null;

		const sc = new StateChange(this.currentTime, state);
		sc.color = color;
		sc.comment = comment;

		const player = this.diagram.getPlayer(playerCode);
		player.stateChanges.push(sc);

		// Track state if not yet declared
		if (player.states.indexOf(state) < 0 && player.type !== PlayerType.CLOCK) {
			player.states.push(state);
		}

		// Update current player context
		this.currentPlayer = playerCode;

		return true;
	}

	_tryStateChangeByTime(line) {
		const m = RE_STATE_BY_TIME.exec(line);
		if (m == null) return false;

		if (this.currentPlayer == null) return false;

		const timeStr = m[1];
		const state = m[2] || m[3]; // quoted or bare
		const color = m[4] || null;
		const comment = m[5] ? m[5].trim() : null;

		const time = this._resolveTime(timeStr);

		const sc = new StateChange(time, state);
		sc.color = color;
		sc.comment = comment;

		const player = this.diagram.getPlayer(this.currentPlayer);
		if (player == null) return false;

		player.stateChanges.push(sc);

		// Track state if not yet declared
		if (player.states.indexOf(state) < 0 && player.type !== PlayerType.CLOCK) {
			player.states.push(state);
		}

		// Update current time to this time point
		this.currentTime = time;

		return true;
	}

	// ── Time resolution ───────────────────────────────────────────────────

	_resolveTime(timeStr) {
		if (timeStr == null) return this.currentTime;

		const str = timeStr.trim();

		// Relative time: +N
		if (str.charAt(0) === '+') {
			const delta = parseFloat(str.substring(1));
			return this.currentTime + delta;
		}

		// Named time alias
		if (this.diagram.timeAliases.has(str)) {
			return this.diagram.timeAliases.get(str);
		}

		// Absolute numeric time
		const val = parseFloat(str);
		if (isNaN(val) === false) return val;

		return this.currentTime;
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

export function parseTimingDiagram(text) {
	const parser = new TimingParser();
	return parser.parse(text);
}

export { TimingParser };
