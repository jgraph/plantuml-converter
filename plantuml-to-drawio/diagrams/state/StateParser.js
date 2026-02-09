/**
 * StateParser.js
 *
 * Line-by-line parser for PlantUML state diagrams.
 *
 * Uses a container stack for composite state nesting and a state machine
 * for multiline note collection. Regex patterns derived from the PlantUML
 * Java source (statediagram/command/*.java).
 *
 * Exports parseStateDiagram(text) → StateDiagram
 */

import {
	StateType,
	TransitionStyle,
	TransitionDirection,
	NotePosition,
	DiagramDirection,
	StateElement,
	StateTransition,
	StateNote,
	StateDiagram,
} from './StateModel.js';

// ── Parser states ────────────────────────────────────────────────────────────

const ParserState = Object.freeze({
	NORMAL:         'normal',
	MULTILINE_NOTE: 'multiline_note',
});

// ── Regex patterns ───────────────────────────────────────────────────────────

// State entity reference in transitions (from CommandLinkStateCommon.getStatePattern)
// Matches: plain ident, ident[H], ident[H*], [*], [H], [H*], ==barName==
const ENT = '([\\w.:]+\\[H\\*?\\]|\\[\\*\\]|\\[H\\*?\\]|==+[\\w.:]+==+|[\\w.:]+)';
const ENT_OPT_STEREO_COLOR = ENT + '(?:\\s*(<<[^>]+>>))?(?:\\s*(#\\w+))?';

// Arrow style options inside [...] (from CommandLinkElement.LINE_STYLE)
const ARROW_STYLE = '(?:#\\w+|dotted|dashed|plain|bold|hidden|norank|thickness=\\d+)(?:,(?:#\\w+|dotted|dashed|plain|bold|hidden|norank|thickness=\\d+))*';

// Direction hints
const DIR = '(?:left|right|up|down|le?|ri?|up?|do?)';

// ── Composite state patterns ─────────────────────────────────────────────────

// state "Display" as Code ... { OR state Code as "Display" ... { OR state Code ... {
const RE_COMPOSITE_STATE = new RegExp(
	'^state\\s+(?:' +
		'"([^"]+)"\\s+as\\s+([\\w.]+)' +         // "Display" as Code
		'|([\\w.]+)\\s+as\\s+"([^"]+)"' +         // Code as "Display"
		'|"([^"]+)"' +                             // "Quoted" only
		'|([\\w.]+)' +                             // plain Code
	')' +
	'(?:\\s*(<<[^>]+>>))?' +                       // stereotype
	'(?:\\s*(#\\w+))?' +                           // background color
	'(?:\\s*(##(?:\\[(?:dotted|dashed|bold)\\])?\\w*))?' + // line color
	'\\s*(?:\\{|\\bbegin)\\s*$', 'i'
);

// Non-composite state declaration
const RE_STATE_DECL = new RegExp(
	'^state\\s+(?:' +
		'"([^"]+)"\\s+as\\s+([\\w.]+)' +          // "Display" as Code
		'|([\\w.]+)\\s+as\\s+"([^"]+)"' +         // Code as "Display"
		'|"([^"]+)"' +                             // "Quoted" only
		'|([\\w.]+)' +                             // plain Code
	')' +
	'(?:\\s*(<<[^>]+>>))?' +                       // stereotype
	'(?:\\s*(#\\w+))?' +                           // background color
	'(?:\\s*(##(?:\\[(?:dotted|dashed|bold)\\])?\\w*))?' + // line color
	'(?:\\s*:\\s*(.*))?$', 'i'
);

// End of composite state
const RE_END_STATE = /^(?:end\s?state|\})$/;

// Frame container start
const RE_FRAME_START = new RegExp(
	'^frame\\s+(?:' +
		'"([^"]+)"\\s+as\\s+([\\w.]+)' +
		'|([\\w.]+)\\s+as\\s+"([^"]+)"' +
		'|"([^"]+)"' +
		'|([\\w.]+)' +
	')' +
	'(?:\\s*(<<[^>]+>>))?' +
	'(?:\\s*(#\\w+))?' +
	'\\s*\\{\\s*$', 'i'
);

// ── Transition patterns ──────────────────────────────────────────────────────

// Forward: ENT1 (x)?(-+)([STYLE])?(dir)?([STYLE])?(-*)> (o)? ENT2 (: label)?
const RE_LINK_FORWARD = new RegExp(
	'^' + ENT_OPT_STEREO_COLOR + '\\s*' +
	'(x)?' +                                       // cross start
	'(-+)' +                                       // body1
	'(?:\\[(' + ARROW_STYLE + ')\\])?' +            // style1
	'(' + DIR + ')?' +                              // direction
	'(?:\\[(' + ARROW_STYLE + ')\\])?' +            // style2
	'(-*)' +                                        // body2
	'>' +                                           // arrow head
	'\\s*(o(?=\\s))?' +                             // circle end
	'\\s*' + ENT_OPT_STEREO_COLOR +
	'(?:\\s*:\\s*(.+))?' +                          // label
	'$'
);

// Reverse: ENT2 (o)? <(-*)([STYLE])?(dir)?([STYLE])?(-+)(x)? ENT1 (: label)?
const RE_LINK_REVERSE = new RegExp(
	'^' + ENT_OPT_STEREO_COLOR + '\\s*' +
	'(o(?=\\s))?' +                                 // circle end (at left)
	'\\s*<' +                                       // arrow head reversed
	'(-*)' +                                        // body2
	'(?:\\[(' + ARROW_STYLE + ')\\])?' +            // style2
	'(' + DIR + ')?' +                              // direction
	'(?:\\[(' + ARROW_STYLE + ')\\])?' +            // style1
	'(-+)' +                                        // body1
	'(x)?' +                                        // cross start (at right)
	'\\s*' + ENT_OPT_STEREO_COLOR +
	'(?:\\s*:\\s*(.+))?' +                          // label
	'$'
);

// Add field: CODE : text  or  "Display" : text
const RE_ADD_FIELD = /^(?:([\w.]+)|"([^"]+)")\s*:\s*(.*)$/;

// Concurrent region separator
const RE_CONCURRENT = /^(--+|\|\|+)$/;

// Direction
const RE_DIRECTION_LTR = /^left\s+to\s+right\s+direction$/i;
const RE_DIRECTION_TTB = /^top\s+to\s+bottom\s+direction$/i;

// Hide empty description
const RE_HIDE_EMPTY = /^hide\s+empty\s+description$/i;

// Title
const RE_TITLE = /^title\s+(.+)$/i;

// Notes
const RE_NOTE_SINGLE = /^note\s+(left|right|top|bottom)\s+of\s+(?:([\w.]+)|"([^"]+)")\s*(?:(#\w+)\s*)?:\s*(.+)$/i;
const RE_NOTE_MULTI_START = /^note\s+(left|right|top|bottom)\s+of\s+(?:([\w.]+)|"([^"]+)")\s*(?:(#\w+)\s*)?$/i;
const RE_NOTE_FLOATING = /^note\s+"([^"]+)"\s+as\s+([\w.]+)(?:\s*(#\w+))?$/i;
const RE_NOTE_ON_LINK = /^note\s+(?:(left|right|top|bottom)\s+)?on\s+link\s*(?:(#\w+)\s*)?:\s*(.+)$/i;
const RE_NOTE_ON_LINK_MULTI_START = /^note\s+(?:(left|right|top|bottom)\s+)?on\s+link\s*(?:(#\w+))?$/i;
const RE_END_NOTE = /^end\s*note$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map stereotype text to StateType, or null if not a known pseudostate stereotype.
 */
function typeFromStereotype(stereo) {
	if (stereo == null) return null;
	const inner = stereo.replace(/^<<|>>$/g, '').trim().toLowerCase();
	switch (inner) {
		case 'choice':   return StateType.CHOICE;
		case 'fork':     return StateType.FORK_JOIN;
		case 'join':     return StateType.FORK_JOIN;
		case 'start':    return StateType.INITIAL;
		case 'end':      return StateType.FINAL;
		case 'history':  return StateType.HISTORY;
		case 'history*': return StateType.DEEP_HISTORY;
		default:         return null;
	}
}

/**
 * Parse arrow style string (e.g. "#red,dashed") into {lineStyle, color}.
 */
function parseArrowStyle(styleStr) {
	const result = { lineStyle: null, color: null };
	if (styleStr == null) return result;
	const parts = styleStr.split(',');
	for (const part of parts) {
		const p = part.trim();
		if (p.startsWith('#')) {
			result.color = p;
		} else if (p === 'dashed') {
			result.lineStyle = TransitionStyle.DASHED;
		} else if (p === 'dotted') {
			result.lineStyle = TransitionStyle.DOTTED;
		} else if (p === 'bold') {
			result.lineStyle = TransitionStyle.BOLD;
		} else if (p === 'hidden') {
			result.lineStyle = TransitionStyle.HIDDEN;
		} else if (p === 'plain') {
			result.lineStyle = TransitionStyle.SOLID;
		}
	}
	return result;
}

/**
 * Resolve direction hint abbreviation to TransitionDirection.
 */
function resolveDirection(dir) {
	if (dir == null) return TransitionDirection.NONE;
	const d = dir.toLowerCase();
	if (d === 'left' || d === 'le' || d === 'l') return TransitionDirection.LEFT;
	if (d === 'right' || d === 'ri' || d === 'r') return TransitionDirection.RIGHT;
	if (d === 'up' || d === 'u') return TransitionDirection.UP;
	if (d === 'down' || d === 'do' || d === 'd') return TransitionDirection.DOWN;
	return TransitionDirection.NONE;
}

/**
 * Parse ##[style]color into {lineColor, lineStyle}.
 */
function parseLineColor(raw) {
	if (raw == null) return { lineColor: null, lineStyle: null };
	// Strip leading ##
	let s = raw.replace(/^##/, '');
	let lineStyle = null;
	const styleMatch = s.match(/^\[(dotted|dashed|bold)\]/i);
	if (styleMatch) {
		lineStyle = styleMatch[1].toLowerCase();
		s = s.slice(styleMatch[0].length);
	}
	const lineColor = s || null;
	return { lineColor, lineStyle };
}

/**
 * Generate a stable code from a quoted display name.
 */
function nameToCode(name) {
	return name.replace(/[^\w]/g, '');
}

// ── Parser class ─────────────────────────────────────────────────────────────

class StateParser {
	constructor() {
		this.diagram = null;
		this.state = ParserState.NORMAL;
		this.compositeStack = [];
		this.multiLineNoteLines = [];
		this.multiLineNoteTarget = null;
	}

	parse(text) {
		this.diagram = new StateDiagram();
		this.state = ParserState.NORMAL;
		this.compositeStack = [];
		this.multiLineNoteLines = [];
		this.multiLineNoteTarget = null;

		const lines = text.split('\n');

		for (const rawLine of lines) {
			const line = rawLine.trim();

			// Skip empties, comments, preprocessor directives
			if (line === '' || line.startsWith("'") || line.startsWith("/'")) continue;
			if (/^@start/i.test(line) || /^@end/i.test(line)) continue;
			if (/^skinparam\b/i.test(line)) continue;
			if (/^hide\s+/i.test(line) && !RE_HIDE_EMPTY.test(line)) continue;
			if (/^show\s+/i.test(line)) continue;
			if (/^scale\b/i.test(line)) continue;

			if (this.state === ParserState.MULTILINE_NOTE) {
				if (RE_END_NOTE.test(line)) {
					this._finishMultiLineNote();
				} else {
					this.multiLineNoteLines.push(rawLine.trimEnd());
				}
				continue;
			}

			// Normal state: try parsers in priority order
			if (this._parseTitle(line)) continue;
			if (this._parseDirection(line)) continue;
			if (this._parseHideEmpty(line)) continue;
			if (this._parseCompositeStateStart(line)) continue;
			if (this._parseCompositeStateEnd(line)) continue;
			if (this._parseFrameStart(line)) continue;
			if (this._parseConcurrentSeparator(line)) continue;
			if (this._parseStateDeclaration(line)) continue;
			if (this._parseNoteSingle(line)) continue;
			if (this._parseNoteFloating(line)) continue;
			if (this._parseNoteOnLink(line)) continue;
			if (this._parseNoteOnLinkMultiStart(line)) continue;
			if (this._parseNoteMultiStart(line)) continue;
			if (this._parseLinkForward(line)) continue;
			if (this._parseLinkReverse(line)) continue;
			if (this._parseAddField(line)) continue;
		}

		return this.diagram;
	}

	// ── Scope management ─────────────────────────────────────────────────────

	/**
	 * Get the current scope code for [*] pseudostate scoping.
	 * Top-level scope is '__top__'.
	 */
	_currentScopeCode() {
		if (this.compositeStack.length === 0) return '__top__';
		const parent = this.compositeStack[this.compositeStack.length - 1];
		// Inside concurrent regions, scope [*] to each region independently
		if (parent.element.concurrentRegions.length > 0) {
			const regionIdx = parent.element.concurrentRegions.length - 1;
			return parent.code + '_r' + regionIdx;
		}
		return parent.code;
	}

	/**
	 * Get the current transition list (top-level or inside composite).
	 */
	_currentTransitions() {
		if (this.compositeStack.length === 0) return this.diagram.transitions;
		return this.compositeStack[this.compositeStack.length - 1].element.childTransitions;
	}

	/**
	 * Register a child element in the current composite (if any).
	 */
	_registerChild(code) {
		if (this.compositeStack.length > 0) {
			const parent = this.compositeStack[this.compositeStack.length - 1];
			const el = this.diagram.elements.get(code);
			if (el && el.parentCode == null) {
				el.parentCode = parent.code;
				if (parent.element.children.indexOf(code) === -1) {
					parent.element.children.push(code);
				}
			}
		}
	}

	// ── Entity resolution ────────────────────────────────────────────────────

	/**
	 * Resolve a raw entity reference from a transition to a state code.
	 * Handles [*], [H], [H*], ==bar==, Parent[H], plain idents.
	 * isSource: true if this entity is the source of a transition (affects [*] type).
	 */
	_resolveEntity(raw, isSource) {
		const trimmed = raw.trim();

		// [*] start/end pseudostate
		if (trimmed === '[*]') {
			const scope = this._currentScopeCode();
			if (isSource) {
				const code = '__initial_' + scope + '__';
				this.diagram.getOrCreateElement(code, '[*]', StateType.INITIAL);
				this._registerChild(code);
				return code;
			} else {
				const code = '__final_' + scope + '__';
				this.diagram.getOrCreateElement(code, '[*]', StateType.FINAL);
				this._registerChild(code);
				return code;
			}
		}

		// [H] standalone shallow history
		if (/^\[H\]$/i.test(trimmed)) {
			const scope = this._currentScopeCode();
			const code = '__history_' + scope + '__';
			this.diagram.getOrCreateElement(code, 'H', StateType.HISTORY);
			this._registerChild(code);
			return code;
		}

		// [H*] standalone deep history
		if (/^\[H\*\]$/i.test(trimmed)) {
			const scope = this._currentScopeCode();
			const code = '__deephistory_' + scope + '__';
			this.diagram.getOrCreateElement(code, 'H*', StateType.DEEP_HISTORY);
			this._registerChild(code);
			return code;
		}

		// Parent[H] — shallow history in named state
		const histMatch = trimmed.match(/^([\w.:]+)\[H\]$/i);
		if (histMatch) {
			const parentCode = histMatch[1];
			const code = '__history_' + parentCode + '__';
			const histEl = this.diagram.getOrCreateElement(code, 'H', StateType.HISTORY);
			// Ensure parent exists and register as child
			const parentEl = this.diagram.getOrCreateElement(parentCode, parentCode, StateType.STATE);
			if (histEl.parentCode == null) {
				histEl.parentCode = parentCode;
				if (parentEl.children.indexOf(code) === -1) {
					parentEl.children.push(code);
				}
			}
			return code;
		}

		// Parent[H*] — deep history in named state
		const deepHistMatch = trimmed.match(/^([\w.:]+)\[H\*\]$/i);
		if (deepHistMatch) {
			const parentCode = deepHistMatch[1];
			const code = '__deephistory_' + parentCode + '__';
			const histEl = this.diagram.getOrCreateElement(code, 'H*', StateType.DEEP_HISTORY);
			// Ensure parent exists and register as child
			const parentEl = this.diagram.getOrCreateElement(parentCode, parentCode, StateType.STATE);
			if (histEl.parentCode == null) {
				histEl.parentCode = parentCode;
				if (parentEl.children.indexOf(code) === -1) {
					parentEl.children.push(code);
				}
			}
			return code;
		}

		// ==barName== synchro bar
		const synchroMatch = trimmed.match(/^==+(.+?)==+$/);
		if (synchroMatch) {
			const barName = synchroMatch[1];
			this.diagram.getOrCreateElement(barName, barName, StateType.SYNCHRO_BAR);
			this._registerChild(barName);
			return barName;
		}

		// Plain identifier — auto-create as STATE
		this.diagram.getOrCreateElement(trimmed, trimmed, StateType.STATE);
		this._registerChild(trimmed);
		return trimmed;
	}

	// ── Parse methods ────────────────────────────────────────────────────────

	_parseTitle(line) {
		const m = line.match(RE_TITLE);
		if (m == null) return false;
		this.diagram.title = m[1].trim();
		return true;
	}

	_parseDirection(line) {
		if (RE_DIRECTION_LTR.test(line)) {
			this.diagram.direction = DiagramDirection.LEFT_TO_RIGHT;
			return true;
		}
		if (RE_DIRECTION_TTB.test(line)) {
			this.diagram.direction = DiagramDirection.TOP_TO_BOTTOM;
			return true;
		}
		return false;
	}

	_parseHideEmpty(line) {
		if (RE_HIDE_EMPTY.test(line)) {
			this.diagram.hideEmptyDescription = true;
			return true;
		}
		return false;
	}

	_parseCompositeStateStart(line) {
		const m = line.match(RE_COMPOSITE_STATE);
		if (m == null) return false;

		// Extract code and display name from the 6 alternation groups
		let code, displayName;
		if (m[1] && m[2]) {
			// "Display" as Code
			displayName = m[1];
			code = m[2];
		} else if (m[3] && m[4]) {
			// Code as "Display"
			code = m[3];
			displayName = m[4];
		} else if (m[5]) {
			// "Quoted" only
			displayName = m[5];
			code = nameToCode(m[5]);
		} else if (m[6]) {
			// plain Code
			code = m[6];
			displayName = m[6];
		} else {
			return false;
		}

		const stereotype = m[7] || null;
		const color = m[8] || null;
		const lineColorRaw = m[9] || null;

		const specialType = typeFromStereotype(stereotype);
		const el = this.diagram.getOrCreateElement(code, displayName, specialType || StateType.STATE);
		if (color) el.color = color;
		if (lineColorRaw) {
			const lc = parseLineColor(lineColorRaw);
			if (lc.lineColor) el.lineColor = lc.lineColor;
			if (lc.lineStyle) el.lineStyle = lc.lineStyle;
		}
		if (stereotype && specialType == null) {
			const stereoText = stereotype.replace(/^<<|>>$/g, '').trim();
			if (el.stereotypes.indexOf(stereoText) === -1) {
				el.stereotypes.push(stereoText);
			}
		}

		this._registerChild(code);
		this.compositeStack.push({ code, element: el });
		return true;
	}

	_parseCompositeStateEnd(line) {
		if (RE_END_STATE.test(line) === false) return false;
		if (this.compositeStack.length === 0) return false;
		this.compositeStack.pop();
		return true;
	}

	_parseFrameStart(line) {
		const m = line.match(RE_FRAME_START);
		if (m == null) return false;

		let code, displayName;
		if (m[1] && m[2]) {
			displayName = m[1];
			code = m[2];
		} else if (m[3] && m[4]) {
			code = m[3];
			displayName = m[4];
		} else if (m[5]) {
			displayName = m[5];
			code = nameToCode(m[5]);
		} else if (m[6]) {
			code = m[6];
			displayName = m[6];
		} else {
			return false;
		}

		const color = m[8] || null;
		const el = this.diagram.getOrCreateElement(code, displayName, StateType.STATE);
		if (color) el.color = color;

		this._registerChild(code);
		this.compositeStack.push({ code, element: el });
		return true;
	}

	_parseConcurrentSeparator(line) {
		const m = line.match(RE_CONCURRENT);
		if (m == null) return false;
		if (this.compositeStack.length === 0) return false;

		const parent = this.compositeStack[this.compositeStack.length - 1];
		const el = parent.element;
		const sepType = m[1].charAt(0); // '-' or '|'

		if (el.concurrentRegions.length === 0) {
			// First separator: move existing children and transitions into region 0
			el.concurrentRegions.push({
				separator: sepType,
				elements: [...el.children],
				transitions: [...el.childTransitions],
			});
			// Clear the main children/transitions — they now live in regions
			el.children = [];
			el.childTransitions = [];
		}

		// Start a new region
		el.concurrentRegions.push({
			separator: sepType,
			elements: [],
			transitions: [],
		});

		return true;
	}

	_parseStateDeclaration(line) {
		const m = line.match(RE_STATE_DECL);
		if (m == null) return false;

		let code, displayName;
		if (m[1] && m[2]) {
			displayName = m[1];
			code = m[2];
		} else if (m[3] && m[4]) {
			code = m[3];
			displayName = m[4];
		} else if (m[5]) {
			displayName = m[5];
			code = nameToCode(m[5]);
		} else if (m[6]) {
			code = m[6];
			displayName = m[6];
		} else {
			return false;
		}

		const stereotype = m[7] || null;
		const color = m[8] || null;
		const lineColorRaw = m[9] || null;
		const inlineDesc = m[10] || null;

		const specialType = typeFromStereotype(stereotype);
		const el = this.diagram.getOrCreateElement(code, displayName, specialType || StateType.STATE);
		if (color) el.color = color;
		if (lineColorRaw) {
			const lc = parseLineColor(lineColorRaw);
			if (lc.lineColor) el.lineColor = lc.lineColor;
			if (lc.lineStyle) el.lineStyle = lc.lineStyle;
		}
		if (stereotype && specialType == null) {
			const stereoText = stereotype.replace(/^<<|>>$/g, '').trim();
			if (el.stereotypes.indexOf(stereoText) === -1) {
				el.stereotypes.push(stereoText);
			}
		}
		if (inlineDesc) {
			el.descriptions.push(inlineDesc.trim());
		}

		this._registerChild(code);
		return true;
	}

	_parseAddField(line) {
		// Must not match lines starting with 'state' (already handled)
		if (/^state\s+/i.test(line)) return false;
		// Must not match lines starting with 'note' (handled elsewhere)
		if (/^note\s+/i.test(line)) return false;

		const m = line.match(RE_ADD_FIELD);
		if (m == null) return false;

		const code = m[1] || nameToCode(m[2]);
		const fieldText = m[3].trim();

		const el = this.diagram.getOrCreateElement(code, m[2] || code, StateType.STATE);
		el.descriptions.push(fieldText);
		this._registerChild(code);
		return true;
	}

	_parseNoteSingle(line) {
		const m = line.match(RE_NOTE_SINGLE);
		if (m == null) return false;

		const position = m[1].toLowerCase();
		const entityCode = m[2] || nameToCode(m[3]);
		const color = m[4] || null;
		const text = m[5].trim();

		const note = new StateNote(NotePosition[position.toUpperCase()], text);
		note.entityCode = entityCode;
		if (color) note.color = color;
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteMultiStart(line) {
		const m = line.match(RE_NOTE_MULTI_START);
		if (m == null) return false;

		const position = m[1].toLowerCase();
		const entityCode = m[2] || nameToCode(m[3]);
		const color = m[4] || null;

		this.multiLineNoteTarget = {
			position: NotePosition[position.toUpperCase()],
			entityCode,
			color,
			isOnLink: false,
		};
		this.multiLineNoteLines = [];
		this.state = ParserState.MULTILINE_NOTE;
		return true;
	}

	_parseNoteFloating(line) {
		const m = line.match(RE_NOTE_FLOATING);
		if (m == null) return false;

		const text = m[1];
		const alias = m[2];
		const color = m[3] || null;

		const note = new StateNote(NotePosition.RIGHT, text);
		note.alias = alias;
		if (color) note.color = color;
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteOnLink(line) {
		const m = line.match(RE_NOTE_ON_LINK);
		if (m == null) return false;

		const position = m[1] ? m[1].toLowerCase() : 'right';
		const color = m[2] || null;
		const text = m[3].trim();

		const note = new StateNote(NotePosition[position.toUpperCase()], text);
		note.isOnLink = true;
		// Attach to the most recent transition
		const transitions = this._currentTransitions();
		if (transitions.length > 0) {
			note.linkIndex = transitions.length - 1;
		}
		if (color) note.color = color;
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteOnLinkMultiStart(line) {
		const m = line.match(RE_NOTE_ON_LINK_MULTI_START);
		if (m == null) return false;

		const position = m[1] ? m[1].toLowerCase() : 'right';
		const color = m[2] || null;

		this.multiLineNoteTarget = {
			position: NotePosition[position.toUpperCase()],
			entityCode: null,
			color,
			isOnLink: true,
			linkIndex: this._currentTransitions().length - 1,
		};
		this.multiLineNoteLines = [];
		this.state = ParserState.MULTILINE_NOTE;
		return true;
	}

	_finishMultiLineNote() {
		const target = this.multiLineNoteTarget;
		// Trim common leading whitespace from note lines
		const lines = this.multiLineNoteLines;
		let minIndent = Infinity;
		for (const l of lines) {
			if (l.trim().length === 0) continue;
			const indent = l.match(/^\s*/)[0].length;
			if (indent < minIndent) minIndent = indent;
		}
		if (minIndent === Infinity) minIndent = 0;
		const trimmedLines = lines.map(l => l.slice(minIndent));
		const text = trimmedLines.join('\n').trim();

		const note = new StateNote(target.position, text);
		note.entityCode = target.entityCode;
		if (target.color) note.color = target.color;
		note.isOnLink = target.isOnLink || false;
		if (target.linkIndex != null) note.linkIndex = target.linkIndex;
		this.diagram.addNote(note);

		this.state = ParserState.NORMAL;
		this.multiLineNoteTarget = null;
		this.multiLineNoteLines = [];
	}

	_parseLinkForward(line) {
		const m = line.match(RE_LINK_FORWARD);
		if (m == null) return false;

		// Groups: 1=ent1, 2=ent1Stereo, 3=ent1Color,
		//         4=crossStart, 5=body1, 6=style1, 7=dir, 8=style2, 9=body2,
		//         10=circleEnd,
		//         11=ent2, 12=ent2Stereo, 13=ent2Color,
		//         14=label
		const ent1Raw = m[1];
		const ent1Stereo = m[2] || null;
		const ent1Color = m[3] || null;
		const crossStart = m[4] != null;
		const body1 = m[5] || '';
		const style1Str = m[6] || null;
		const dirStr = m[7] || null;
		const style2Str = m[8] || null;
		const body2 = m[9] || '';
		const circleEnd = m[10] != null;
		const ent2Raw = m[11];
		const ent2Stereo = m[12] || null;
		const ent2Color = m[13] || null;
		const label = m[14] ? m[14].trim() : null;

		const fromCode = this._resolveEntity(ent1Raw, true);
		const toCode = this._resolveEntity(ent2Raw, false);

		// Apply inline stereotypes/colors to entities if present
		this._applyEntityStereoColor(fromCode, ent1Stereo, ent1Color);
		this._applyEntityStereoColor(toCode, ent2Stereo, ent2Color);

		const transition = new StateTransition(fromCode, toCode);
		transition.label = label;
		transition.direction = resolveDirection(dirStr);
		transition.crossStart = crossStart;
		transition.circleEnd = circleEnd;
		transition.arrowLength = body1.length + body2.length;

		// Merge style from both style slots
		const s1 = parseArrowStyle(style1Str);
		const s2 = parseArrowStyle(style2Str);
		if (s1.lineStyle || s2.lineStyle) {
			transition.lineStyle = s1.lineStyle || s2.lineStyle;
		}
		if (s1.color || s2.color) {
			transition.color = s1.color || s2.color;
		}

		// Add to current scope's transition list
		const transitions = this._currentTransitions();
		transitions.push(transition);

		// Also add to diagram-level transitions for top-level access
		if (this.compositeStack.length > 0) {
			this.diagram.addTransition(transition);
		} else {
			// Already pushed to diagram.transitions via _currentTransitions()
		}

		return true;
	}

	_parseLinkReverse(line) {
		const m = line.match(RE_LINK_REVERSE);
		if (m == null) return false;

		// Groups: 1=ent2, 2=ent2Stereo, 3=ent2Color,
		//         4=circleEnd, 5=body2, 6=style2, 7=dir, 8=style1, 9=body1,
		//         10=crossStart,
		//         11=ent1, 12=ent1Stereo, 13=ent1Color,
		//         14=label
		const ent2Raw = m[1];
		const ent2Stereo = m[2] || null;
		const ent2Color = m[3] || null;
		const circleEnd = m[4] != null;
		const body2 = m[5] || '';
		const style2Str = m[6] || null;
		const dirStr = m[7] || null;
		const style1Str = m[8] || null;
		const body1 = m[9] || '';
		const crossStart = m[10] != null;
		const ent1Raw = m[11];
		const ent1Stereo = m[12] || null;
		const ent1Color = m[13] || null;
		const label = m[14] ? m[14].trim() : null;

		// Reverse: ent1 is the actual source, ent2 is the actual target
		const fromCode = this._resolveEntity(ent1Raw, true);
		const toCode = this._resolveEntity(ent2Raw, false);

		this._applyEntityStereoColor(fromCode, ent1Stereo, ent1Color);
		this._applyEntityStereoColor(toCode, ent2Stereo, ent2Color);

		const transition = new StateTransition(fromCode, toCode);
		transition.label = label;
		transition.direction = resolveDirection(dirStr);
		transition.crossStart = crossStart;
		transition.circleEnd = circleEnd;
		transition.arrowLength = body1.length + body2.length;

		const s1 = parseArrowStyle(style1Str);
		const s2 = parseArrowStyle(style2Str);
		if (s1.lineStyle || s2.lineStyle) {
			transition.lineStyle = s1.lineStyle || s2.lineStyle;
		}
		if (s1.color || s2.color) {
			transition.color = s1.color || s2.color;
		}

		const transitions = this._currentTransitions();
		transitions.push(transition);

		if (this.compositeStack.length > 0) {
			this.diagram.addTransition(transition);
		}

		return true;
	}

	_applyEntityStereoColor(code, stereo, color) {
		if (stereo == null && color == null) return;
		const el = this.diagram.elements.get(code);
		if (el == null) return;
		if (stereo) {
			const specialType = typeFromStereotype(stereo);
			if (specialType) {
				el.type = specialType;
			} else {
				const text = stereo.replace(/^<<|>>$/g, '').trim();
				if (el.stereotypes.indexOf(text) === -1) {
					el.stereotypes.push(text);
				}
			}
		}
		if (color && el.color == null) {
			el.color = color;
		}
	}
}

// ── Concurrent region child tracking ─────────────────────────────────────────

// Override _registerChild to handle concurrent regions
const origRegisterChild = StateParser.prototype._registerChild;
StateParser.prototype._registerChild = function(code) {
	if (this.compositeStack.length > 0) {
		const parent = this.compositeStack[this.compositeStack.length - 1];
		const el = this.diagram.elements.get(code);
		if (el && el.parentCode == null) {
			el.parentCode = parent.code;
		}

		// If the parent has concurrent regions, add to the last region
		if (parent.element.concurrentRegions.length > 0) {
			const lastRegion = parent.element.concurrentRegions[parent.element.concurrentRegions.length - 1];
			if (lastRegion.elements.indexOf(code) === -1) {
				lastRegion.elements.push(code);
			}
			return;
		}

		// Otherwise, add to the parent's children list
		if (parent.element.children.indexOf(code) === -1) {
			parent.element.children.push(code);
		}
	}
};

// Override _currentTransitions to handle concurrent regions
const origCurrentTransitions = StateParser.prototype._currentTransitions;
StateParser.prototype._currentTransitions = function() {
	if (this.compositeStack.length === 0) return this.diagram.transitions;
	const parent = this.compositeStack[this.compositeStack.length - 1];
	if (parent.element.concurrentRegions.length > 0) {
		return parent.element.concurrentRegions[parent.element.concurrentRegions.length - 1].transitions;
	}
	return parent.element.childTransitions;
};

// ── Public API ───────────────────────────────────────────────────────────────

export function parseStateDiagram(text) {
	const parser = new StateParser();
	return parser.parse(text);
}

export { StateParser };
