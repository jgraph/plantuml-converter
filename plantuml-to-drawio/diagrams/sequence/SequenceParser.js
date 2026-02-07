/**
 * SequenceParser.js
 *
 * Line-by-line parser for PlantUML sequence diagrams.
 * Converts raw PlantUML text into a SequenceDiagram model.
 *
 * Supports (Tier 1):
 *   - Participant declarations (all 8 types, aliases, ordering)
 *   - Messages with full arrow syntax (all arrow types, self-messages)
 *   - Inline activation: ++, --, **, !!
 *   - Explicit activate/deactivate/create/destroy
 *   - return keyword
 *   - Fragments: alt/else, loop, opt, break, par, critical, group
 *   - Notes: left/right/over, single and multi-line, across, on-arrow
 *   - Dividers, delays, hspace
 *   - Refs
 *   - Boxes
 *   - Autonumber (basic)
 *   - Title
 *
 * Supports (Tier 2):
 *   - Exo arrows ([-> and ->])
 *   - Multicast (A -> B & C & D)
 *   - hnote / rnote
 *   - note across
 *   - Arrow color/style modifiers
 *   - Parallel & prefix
 */

import { parseArrow } from './ArrowParser.js';
import {
	ParticipantType,
	ArrowHead,
	ArrowBody,
	LifeEventType,
	GroupingType,
	NotePosition,
	NoteStyle,
	NoteOnArrowPosition,
	ExoMessageType,
	Participant,
	ArrowConfig,
	Message,
	ExoMessage,
	LifeEvent,
	Fragment,
	FragmentSection,
	Note,
	NoteOnArrow,
	Divider,
	Delay,
	HSpace,
	Reference,
	Box,
	AutoNumber,
	SequenceDiagram
} from './SequenceModel.js';

// ── Constants ──────────────────────────────────────────────────────────────

const PARTICIPANT_TYPES = new Set([
	'participant', 'actor', 'boundary', 'control',
	'entity', 'queue', 'database', 'collections'
]);

const FRAGMENT_TYPES = new Set([
	'alt', 'else', 'also', 'loop', 'opt', 'par', 'par2',
	'break', 'critical', 'group', 'end'
]);

const NOTE_STYLES = new Set(['note', 'hnote', 'rnote']);

// ── Regex patterns ─────────────────────────────────────────────────────────

// Participant identifier: word chars, dots, @, or a quoted string
const IDENT = '(?:[\\w.@]+|"[^"]+")';

// Arrow body: one or more dashes, optionally with style in brackets
const ARROW_BODY = '(?:[ox])?(?:<?<?|\\/?\\/?|\\\\?\\\\?)?-+(?:\\[[^\\]]*\\])?-*(?:>>?|\\/?\\/?|\\\\?\\\\?)?(?:[ox])?';

// ── Parser class ───────────────────────────────────────────────────────────

export class SequenceParser {
	constructor() {
		this.diagram = null;
		this.lineNumber = 0;
		this.multiLineBuffer = null;  // For multi-line notes, refs
		this.multiLineType = null;    // 'note' | 'ref'
		this.multiLineData = null;    // Context for multi-line block
		this.fragmentStack = [];      // Stack for nested fragments
		this.currentBox = null;       // Current box being built
		this.lastElement = null;      // Last element added (for note-on-arrow)
		this.activationStack = [];    // Stack for tracking activations
	}

	/**
	 * Parse a PlantUML sequence diagram string into a SequenceDiagram model.
	 * @param {string} text - The full PlantUML text
	 * @returns {SequenceDiagram}
	 */
	parse(text) {
		this.diagram = new SequenceDiagram();
		this.lineNumber = 0;
		this.multiLineBuffer = null;
		this.multiLineType = null;
		this.multiLineData = null;
		this.fragmentStack = [];
		this.currentBox = null;
		this.lastElement = null;
		this.activationStack = [];

		const lines = text.split('\n');

		for (const rawLine of lines) {
			this.lineNumber++;
			const line = rawLine.trim();

			// Skip empty lines
			if (line === '') continue;

			// Skip @startuml / @enduml
			if (/^@start(uml|sequence)/.test(line)) continue;
			if (/^@end(uml|sequence)/.test(line)) continue;

			// Skip single-line comments
			if (line.startsWith("'") || line.startsWith("/'")) continue;

			// Handle multi-line block (note, ref)
			if (this.multiLineBuffer !== null) {
				if (this._handleMultiLineEnd(line)) continue;
				this.multiLineBuffer.push(line);
				continue;
			}

			// Try each parser in order of specificity
			if (this._parseTitle(line)) continue;
			if (this._parseAutoNumber(line)) continue;
			if (this._parseBoxStart(line)) continue;
			if (this._parseBoxEnd(line)) continue;
			if (this._parseParticipant(line)) continue;
			if (this._parseDivider(line)) continue;
			if (this._parseDelay(line)) continue;
			if (this._parseHSpace(line)) continue;
			if (this._parseActivation(line)) continue;
			if (this._parseReturn(line)) continue;
			if (this._parseGrouping(line)) continue;
			if (this._parseNoteMultiLine(line)) continue;
			if (this._parseNoteSingleLine(line)) continue;
			if (this._parseNoteOnArrow(line)) continue;
			if (this._parseNoteAcross(line)) continue;
			if (this._parseRefMultiLine(line)) continue;
			if (this._parseRefSingleLine(line)) continue;
			if (this._parseExoArrow(line)) continue;
			if (this._parseArrow(line)) continue;

			// Unknown line — silently skip
		}

		return this.diagram;
	}

	// ── Title ────────────────────────────────────────────────────────────

	_parseTitle(line) {
		const m = line.match(/^title\s+(.+)$/i);
		if (!m) return false;
		this.diagram.title = m[1].trim();
		return true;
	}

	// ── Autonumber ───────────────────────────────────────────────────────

	_parseAutoNumber(line) {
		// autonumber stop
		if (/^autonumber\s+stop$/i.test(line)) {
			this.diagram.autoNumber = null;
			return true;
		}
		// autonumber resume
		if (/^autonumber\s+resume$/i.test(line)) {
			// Resume previous numbering — if none was set, start at 1
			if (!this.diagram.autoNumber) {
				this.diagram.autoNumber = new AutoNumber(1, 1, null);
			}
			return true;
		}
		// autonumber [start] [step] ["format"]
		const m = line.match(/^autonumber(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+"([^"]*)")?$/i);
		if (!m) return false;
		const start = m[1] ? parseInt(m[1], 10) : 1;
		const step = m[2] ? parseInt(m[2], 10) : 1;
		const format = m[3] || null;
		this.diagram.autoNumber = new AutoNumber(start, step, format);
		return true;
	}

	// ── Box ──────────────────────────────────────────────────────────────

	_parseBoxStart(line) {
		const m = line.match(/^box(?:\s+"([^"]*)"|\s+([^#\s][^#]*))?(?:\s+(#\w+))?$/i);
		if (!m) return false;
		const title = (m[1] || m[2] || '').trim();
		const color = m[3] || null;
		this.currentBox = new Box(title, color);
		return true;
	}

	_parseBoxEnd(line) {
		if (!/^end\s*box$/i.test(line)) return false;
		if (this.currentBox) {
			this.diagram.boxes.push(this.currentBox);
			this.currentBox = null;
		}
		return true;
	}

	// ── Participant ──────────────────────────────────────────────────────

	_parseParticipant(line) {
		// Format 1: type "Display Name" as code
		// Format 2: type code as "Display Name"
		// Format 3: type code
		// Format 4: create type code  (or just create code)

		let isCreate = false;
		let workLine = line;

		// Check for 'create' prefix
		const createMatch = workLine.match(/^create\s+(.+)$/i);
		if (createMatch) {
			isCreate = true;
			workLine = createMatch[1].trim();
		}

		// Try: type "Display" as code
		let m = workLine.match(
			new RegExp(`^(${[...PARTICIPANT_TYPES].join('|')})\\s+"([^"]+)"\\s+as\\s+([\\w.@]+)(.*)$`, 'i')
		);
		if (m) {
			return this._addParticipant(m[1], m[3], m[2], isCreate, m[4]);
		}

		// Try: type code as "Display"
		m = workLine.match(
			new RegExp(`^(${[...PARTICIPANT_TYPES].join('|')})\\s+([\\w.@]+)\\s+as\\s+"([^"]+)"(.*)$`, 'i')
		);
		if (m) {
			return this._addParticipant(m[1], m[2], m[3], isCreate, m[4]);
		}

		// Try: type "Display Name" (code = display name)
		m = workLine.match(
			new RegExp(`^(${[...PARTICIPANT_TYPES].join('|')})\\s+"([^"]+)"(.*)$`, 'i')
		);
		if (m) {
			return this._addParticipant(m[1], m[2], m[2], isCreate, m[3]);
		}

		// Try: type code
		m = workLine.match(
			new RegExp(`^(${[...PARTICIPANT_TYPES].join('|')})\\s+([\\w.@]+)(.*)$`, 'i')
		);
		if (m) {
			return this._addParticipant(m[1], m[2], null, isCreate, m[3]);
		}

		// Bare 'create code' without a type keyword
		if (isCreate) {
			m = workLine.match(/^([\w.@]+)(.*)$/);
			if (m) {
				return this._addParticipant('participant', m[1], null, true, m[2]);
			}
		}

		return false;
	}

	_addParticipant(typeStr, code, displayName, isCreate, trailing) {
		const type = typeStr.toLowerCase();
		if (!PARTICIPANT_TYPES.has(type)) return false;

		const p = new Participant(code, displayName, type);
		p.isCreated = isCreate;

		// Parse trailing: order, color, stereotype
		if (trailing) {
			const orderMatch = trailing.match(/order\s+(\d+)/i);
			if (orderMatch) p.order = parseInt(orderMatch[1], 10);

			const colorMatch = trailing.match(/(#\w+)/);
			if (colorMatch) p.color = colorMatch[1];

			const stereoMatch = trailing.match(/<<\s*(.+?)\s*>>/);
			if (stereoMatch) p.stereotype = stereoMatch[1];
		}

		const existing = this.diagram.addParticipant(p);

		// If 'create' is used on an already-declared participant,
		// update its isCreated flag on the canonical instance
		if (isCreate && existing !== p) {
			existing.isCreated = true;
		}

		// Track box membership
		if (this.currentBox) {
			this.currentBox.participants.push(code);
		}

		// If created, add a create life event
		if (isCreate) {
			this._addElement(new LifeEvent(code, LifeEventType.CREATE, null));
		}

		return true;
	}

	// ── Divider ──────────────────────────────────────────────────────────

	_parseDivider(line) {
		const m = line.match(/^==\s*(.*?)\s*==$/);
		if (!m) return false;
		this._addElement(new Divider(m[1]));
		return true;
	}

	// ── Delay ────────────────────────────────────────────────────────────

	_parseDelay(line) {
		const m = line.match(/^(?:\.\.\.|\u2026)\s*(.*?)\s*(?:\.\.\.|\u2026)?$/);
		if (!m) return false;
		// Must start with ... or …
		if (!line.startsWith('...') && !line.startsWith('\u2026')) return false;
		this._addElement(new Delay(m[1]));
		return true;
	}

	// ── HSpace ───────────────────────────────────────────────────────────

	_parseHSpace(line) {
		const m = line.match(/^\|\|\s*(\d+)?\s*\|+$/);
		if (!m) return false;
		const size = m[1] ? parseInt(m[1], 10) : null;
		this._addElement(new HSpace(size));
		return true;
	}

	// ── Explicit activation ──────────────────────────────────────────────

	_parseActivation(line) {
		const m = line.match(/^(activate|deactivate|destroy)\s+([\w.@]+|"[^"]+")\s*(?:(#\w+))?$/i);
		if (!m) return false;

		const typeStr = m[1].toLowerCase();
		const code = m[2].replace(/"/g, '');
		const color = m[3] || null;

		let type;
		switch (typeStr) {
			case 'activate': type = LifeEventType.ACTIVATE; break;
			case 'deactivate': type = LifeEventType.DEACTIVATE; break;
			case 'destroy': type = LifeEventType.DESTROY; break;
		}

		this.diagram.getOrCreateParticipant(code);
		this._addElement(new LifeEvent(code, type, color));
		return true;
	}

	// ── Return ───────────────────────────────────────────────────────────

	_parseReturn(line) {
		const m = line.match(/^return(?:\s+(.*))?$/i);
		if (!m) return false;

		const label = (m[1] || '').trim();

		// Return creates a dotted arrow back to the caller of the last activation.
		// We model it as a message + deactivation. The emitter will resolve
		// the source/target from the activation stack.
		const arrow = new ArrowConfig();
		arrow.body = ArrowBody.DOTTED;
		arrow.head2 = ArrowHead.NORMAL;

		// We don't know source/target here; the emitter resolves from context.
		// Use special marker.
		const msg = new Message('__return_source__', '__return_target__', label, arrow);
		msg._isReturn = true;
		this._addElement(msg);

		return true;
	}

	// ── Grouping (fragments) ─────────────────────────────────────────────

	_parseGrouping(line) {
		// end
		if (/^end$/i.test(line)) {
			if (this.fragmentStack.length > 0) {
				const fragment = this.fragmentStack.pop();
				this._addElement(fragment);
			}
			return true;
		}

		// else / also
		const elseMatch = line.match(/^(?:else|also)(?:\s+(.*))?$/i);
		if (elseMatch) {
			if (this.fragmentStack.length > 0) {
				const fragment = this.fragmentStack[this.fragmentStack.length - 1];
				const section = new FragmentSection(elseMatch[1] || '');
				fragment.sections.push(section);
			}
			return true;
		}

		// Fragment start: alt, loop, opt, par, break, critical, group
		const fragMatch = line.match(
			/^(alt|loop|opt|par|par2|break|critical|group)(?:\s+(#\w+))?(?:\s+(.*))?$/i
		);
		if (!fragMatch) return false;

		const type = fragMatch[1].toLowerCase();
		const color = fragMatch[2] || null;
		const label = (fragMatch[3] || '').trim();

		let groupType;
		switch (type) {
			case 'alt': groupType = GroupingType.ALT; break;
			case 'loop': groupType = GroupingType.LOOP; break;
			case 'opt': groupType = GroupingType.OPT; break;
			case 'par': case 'par2': groupType = GroupingType.PAR; break;
			case 'break': groupType = GroupingType.BREAK; break;
			case 'critical': groupType = GroupingType.CRITICAL; break;
			case 'group': groupType = GroupingType.GROUP; break;
			default: groupType = GroupingType.GROUP;
		}

		const fragment = new Fragment(groupType, label);
		fragment.color = color;
		// Start with first section
		fragment.sections.push(new FragmentSection(label));

		this.fragmentStack.push(fragment);
		return true;
	}

	// ── Notes ────────────────────────────────────────────────────────────

	_parseNoteSingleLine(line) {
		// note left/right/over [of] participant [, participant2] : text
		const m = line.match(
			/^(note|hnote|rnote)\s+(left|right|over)\s+(?:of\s+)?([\w.@]+|"[^"]+")\s*(?:,\s*([\w.@]+|"[^"]+"))?\s*(?:(#\w+)\s*)?:\s*(.*)$/i
		);
		if (!m) return false;

		const styleStr = m[1].toLowerCase();
		const posStr = m[2].toLowerCase();
		const code1 = m[3].replace(/"/g, '');
		const code2 = m[4] ? m[4].replace(/"/g, '') : null;
		const color = m[5] || null;
		const text = m[6].trim();

		const style = this._noteStyleFromStr(styleStr);
		const position = this._notePositionFromStr(posStr);

		this.diagram.getOrCreateParticipant(code1);
		if (code2) this.diagram.getOrCreateParticipant(code2);

		const participants = code2 ? [code1, code2] : [code1];
		const note = new Note(participants, position, text, style);
		note.color = color;
		this._addElement(note);

		return true;
	}

	_parseNoteMultiLine(line) {
		// note left/right/over [of] participant [#color]
		// Also: note over P1, P2
		const m = line.match(
			/^(note|hnote|rnote)\s+(left|right|over)\s+(?:of\s+)?([\w.@]+|"[^"]+")\s*(?:,\s*([\w.@]+|"[^"]+"))?\s*(?:(#\w+))?$/i
		);
		if (!m) return false;

		const styleStr = m[1].toLowerCase();
		const posStr = m[2].toLowerCase();
		const code1 = m[3].replace(/"/g, '');
		const code2 = m[4] ? m[4].replace(/"/g, '') : null;
		const color = m[5] || null;

		this.diagram.getOrCreateParticipant(code1);
		if (code2) this.diagram.getOrCreateParticipant(code2);

		this.multiLineType = 'note';
		this.multiLineBuffer = [];
		this.multiLineData = {
			style: this._noteStyleFromStr(styleStr),
			position: this._notePositionFromStr(posStr),
			participants: code2 ? [code1, code2] : [code1],
			color: color
		};

		return true;
	}

	_parseNoteAcross(line) {
		// note across : text
		const m = line.match(
			/^(note|hnote|rnote)\s+(?:accross|across)\s*(?:(#\w+)\s*)?:\s*(.*)$/i
		);
		if (m) {
			const style = this._noteStyleFromStr(m[1].toLowerCase());
			const color = m[2] || null;
			const text = m[3].trim();
			const note = new Note([], NotePosition.OVER, text, style);
			note.isAcross = true;
			note.color = color;
			this._addElement(note);
			return true;
		}

		// Multi-line across
		const m2 = line.match(
			/^(note|hnote|rnote)\s+(?:accross|across)\s*(?:(#\w+))?$/i
		);
		if (m2) {
			this.multiLineType = 'note';
			this.multiLineBuffer = [];
			this.multiLineData = {
				style: this._noteStyleFromStr(m2[1].toLowerCase()),
				position: NotePosition.OVER,
				participants: [],
				color: m2[2] || null,
				isAcross: true
			};
			return true;
		}

		return false;
	}

	_parseNoteOnArrow(line) {
		// note left/right/top/bottom : text
		// (Attaches to the last message)
		const m = line.match(
			/^(note|hnote|rnote)\s+(left|right|top|bottom)\s*(?:(#\w+)\s*)?:\s*(.*)$/i
		);
		if (!m) return false;

		// Only valid if there's a previous message
		if (!this.lastElement || (!(this.lastElement instanceof Message) && !(this.lastElement instanceof ExoMessage))) {
			return false;
		}

		const style = this._noteStyleFromStr(m[1].toLowerCase());
		const posStr = m[2].toLowerCase();
		const color = m[3] || null;
		const text = m[4].trim();

		let position;
		switch (posStr) {
			case 'left': position = NoteOnArrowPosition.LEFT; break;
			case 'right': position = NoteOnArrowPosition.RIGHT; break;
			case 'top': position = NoteOnArrowPosition.TOP; break;
			case 'bottom': position = NoteOnArrowPosition.BOTTOM; break;
		}

		const noteOnArrow = new NoteOnArrow(position, text, style);
		noteOnArrow.color = color;
		this.lastElement.noteOnArrow = noteOnArrow;

		return true;
	}

	// ── References ───────────────────────────────────────────────────────

	_parseRefSingleLine(line) {
		// ref over P1, P2 : text
		const m = line.match(
			/^ref\s+(?:(#\w+)\s+)?over\s+([\w.@",\s]+)\s*:\s*(.*)$/i
		);
		if (!m) return false;

		const color = m[1] || null;
		const participantStr = m[2];
		const text = m[3].trim();

		const participants = this._parseParticipantList(participantStr);
		const ref = new Reference(participants, text, color);
		this._addElement(ref);

		return true;
	}

	_parseRefMultiLine(line) {
		const m = line.match(
			/^ref\s+(?:(#\w+)\s+)?over\s+([\w.@",\s]+)$/i
		);
		if (!m) return false;

		const color = m[1] || null;
		const participants = this._parseParticipantList(m[2]);

		this.multiLineType = 'ref';
		this.multiLineBuffer = [];
		this.multiLineData = { participants, color };

		return true;
	}

	// ── Exo arrows ───────────────────────────────────────────────────────

	_parseExoArrow(line) {
		// Arrows from/to diagram boundary:
		// [-> P : text  (from left)
		// P ->] : text  (to right)
		// [<- P : text  (to left — incoming from right conceptually)
		// etc.

		// From left: [<decorations>arrow participant
		const fromLeftMatch = line.match(
			/^(&\s*)?\[?([ox]?)(\]?)\s*(<?<?|\/?\/?|\\?\\?)(-+(?:\[[^\]]*\])?-*)(>>?|\/?\/?|\\?\\?)\s*([\w.@]+|"[^"]+")\s*(?:(\+\+|\*\*|!!|--|--\+\+|\+\+--))?(?:\s*(#\w+))?\s*(?::\s*(.*))?$/
		);
		if (fromLeftMatch) {
			return this._buildExoArrow(fromLeftMatch, true);
		}

		// To right: participant arrow [>decorations>]
		const toRightMatch = line.match(
			/^(&\s*)?([\w.@]+|"[^"]+")\s*(?:([ox])\s*)?(<?<?|\/?\/?|\\?\\?)(-+(?:\[[^\]]*\])?-*)(>>?|\/?\/?|\\?\\?)(?:\s*([ox]))?\s*(\[?\]?)\s*(?:(\+\+|\*\*|!!|--|--\+\+|\+\+--))?(?:\s*(#\w+))?\s*(?::\s*(.*))?$/
		);
		if (toRightMatch && (toRightMatch[8] === ']' || toRightMatch[8] === '[')) {
			return this._buildExoArrowRight(toRightMatch);
		}

		return false;
	}

	_buildExoArrow(m, fromLeft) {
		const isParallel = !!m[1];
		const bracketChar = m[3]; // ] means reversed direction
		const leftDressing = m[4];
		const body = m[5];
		const rightDressing = m[6];
		const code = m[7].replace(/"/g, '');
		const activation = m[8] || null;
		const color = m[9] || null;
		const label = (m[10] || '').trim();

		this.diagram.getOrCreateParticipant(code);

		const arrowStr = (leftDressing || '') + body + (rightDressing || '');
		const arrow = parseArrow(arrowStr);

		let exoType;
		if (bracketChar === ']') {
			exoType = rightDressing ? ExoMessageType.FROM_RIGHT : ExoMessageType.TO_RIGHT;
		} else {
			exoType = rightDressing ? ExoMessageType.FROM_LEFT : ExoMessageType.TO_LEFT;
		}

		const msg = new ExoMessage(code, label, arrow, exoType);
		msg.isParallel = isParallel;

		this._addElement(msg);
		this._applyActivation(activation, code, color);

		return true;
	}

	_buildExoArrowRight(m) {
		const isParallel = !!m[1];
		const code = m[2].replace(/"/g, '');
		const leftDressing = m[4];
		const body = m[5];
		const rightDressing = m[6];
		const bracketChar = m[8];
		const activation = m[9] || null;
		const color = m[10] || null;
		const label = (m[11] || '').trim();

		this.diagram.getOrCreateParticipant(code);

		const arrowStr = (leftDressing || '') + body + (rightDressing || '');
		const arrow = parseArrow(arrowStr);

		let exoType;
		if (bracketChar === '[') {
			exoType = leftDressing ? ExoMessageType.TO_LEFT : ExoMessageType.FROM_LEFT;
		} else {
			exoType = rightDressing ? ExoMessageType.TO_RIGHT : ExoMessageType.FROM_RIGHT;
		}

		const msg = new ExoMessage(code, label, arrow, exoType);
		msg.isParallel = isParallel;

		this._addElement(msg);
		this._applyActivation(activation, code, color);

		return true;
	}

	// ── Standard arrow (message) ─────────────────────────────────────────

	_parseArrow(line) {
		// Pattern: [&] participant1 arrow participant2 [& multicast...] [activation] [#color] : label
		//
		// The tricky part is identifying the arrow in the middle.
		// Strategy: find the arrow by looking for the dash pattern between identifiers.

		const m = line.match(
			/^(&\s*)?([\w.@]+|"[^"]+")\s*(<?<?[ox]?(?:\/?\/?|\\?\\?)?-+(?:\[[^\]]*\])?-*(?:\/?\/?|\\?\\?)?>>?[ox]?|<?<?[ox]?(?:\/?\/?|\\?\\?)?-+(?:\[[^\]]*\])?-*[ox]?|[ox]?(?:\/?\/?|\\?\\?)?-+(?:\[[^\]]*\])?-*(?:\/?\/?|\\?\\?)?>>?[ox]?|[ox]?-+(?:\[[^\]]*\])?-*[ox]?)\s*([\w.@]+|"[^"]+")((?:\s*&\s*(?:[\w.@]+|"[^"]+"))*)\s*(?:(\+\+|\*\*|!!|--|--\+\+|\+\+--))?(?:\s*(#\w+))?\s*(?::\s*(.*))?$/
		);

		if (!m) return false;

		const isParallel = !!m[1];
		const part1 = m[2].replace(/"/g, '');
		const arrowStr = m[3].trim();
		const part2 = m[4].replace(/"/g, '');
		const multicastStr = m[5] || '';
		const activation = m[6] || null;
		const color = m[7] || null;
		const label = (m[8] || '').trim();

		// Parse the arrow
		const arrow = parseArrow(arrowStr);
		if (color) arrow.color = color;

		// Determine actual from/to based on arrow direction
		let from, to;
		if (arrow.head1 !== ArrowHead.NONE && arrow.head2 === ArrowHead.NONE) {
			// Reverse arrow: part2 → part1
			from = part2;
			to = part1;
		} else {
			from = part1;
			to = part2;
		}

		// Auto-create participants
		this.diagram.getOrCreateParticipant(from);
		this.diagram.getOrCreateParticipant(to);

		const msg = new Message(from, to, label, arrow);
		msg.isParallel = isParallel;

		// Parse multicast
		if (multicastStr) {
			const multicastParts = multicastStr.split('&').filter(s => s.trim());
			for (const mc of multicastParts) {
				const mcCode = mc.trim().replace(/"/g, '');
				if (mcCode) {
					this.diagram.getOrCreateParticipant(mcCode);
					msg.multicast.push(mcCode);
				}
			}
		}

		this._addElement(msg);
		this._applyActivation(activation, from, to, color);

		return true;
	}

	// ── Multi-line end handling ───────────────────────────────────────────

	_handleMultiLineEnd(line) {
		if (this.multiLineType === 'note' && /^end\s*note$/i.test(line)) {
			const text = this.multiLineBuffer.join('\n');
			const data = this.multiLineData;

			const note = new Note(
				data.participants,
				data.position,
				text,
				data.style
			);
			note.color = data.color;
			note.isAcross = data.isAcross || false;
			this._addElement(note);

			this.multiLineBuffer = null;
			this.multiLineType = null;
			this.multiLineData = null;
			return true;
		}

		if (this.multiLineType === 'ref' && /^end\s*ref$/i.test(line)) {
			const text = this.multiLineBuffer.join('\n');
			const data = this.multiLineData;

			const ref = new Reference(data.participants, text, data.color);
			this._addElement(ref);

			this.multiLineBuffer = null;
			this.multiLineType = null;
			this.multiLineData = null;
			return true;
		}

		return false;
	}

	// ── Helpers ──────────────────────────────────────────────────────────

	/**
	 * Add an element to the current context (either the top fragment section
	 * or the top-level diagram).
	 */
	_addElement(element) {
		if (this.fragmentStack.length > 0) {
			const topFragment = this.fragmentStack[this.fragmentStack.length - 1];
			const currentSection = topFragment.sections[topFragment.sections.length - 1];
			currentSection.elements.push(element);
		} else {
			this.diagram.addElement(element);
		}

		// Track last element for note-on-arrow
		if (element instanceof Message || element instanceof ExoMessage) {
			this.lastElement = element;
		}
	}

	/**
	 * Apply inline activation markers (++, --, **, !!) after a message.
	 */
	_applyActivation(spec, from, to, color) {
		if (!spec) return;

		// Handle 2-character specs: ++, --, **, !!
		// Handle 4-character specs: --++, ++--
		const chars = spec.split('');

		if (spec === '++') {
			this._addElement(new LifeEvent(to, LifeEventType.ACTIVATE, color));
		} else if (spec === '--') {
			this._addElement(new LifeEvent(from, LifeEventType.DEACTIVATE, null));
		} else if (spec === '**') {
			this._addElement(new LifeEvent(to, LifeEventType.CREATE, null));
		} else if (spec === '!!') {
			this._addElement(new LifeEvent(to, LifeEventType.DESTROY, null));
		} else if (spec === '--++') {
			this._addElement(new LifeEvent(from, LifeEventType.DEACTIVATE, null));
			this._addElement(new LifeEvent(to, LifeEventType.ACTIVATE, color));
		} else if (spec === '++--') {
			this._addElement(new LifeEvent(to, LifeEventType.ACTIVATE, color));
			this._addElement(new LifeEvent(from, LifeEventType.DEACTIVATE, null));
		}
	}

	/**
	 * Parse a comma-separated list of participant identifiers.
	 */
	_parseParticipantList(str) {
		return str.split(',')
			.map(s => s.trim().replace(/"/g, ''))
			.filter(s => s.length > 0)
			.map(code => {
				this.diagram.getOrCreateParticipant(code);
				return code;
			});
	}

	_noteStyleFromStr(str) {
		switch (str) {
			case 'hnote': return NoteStyle.HNOTE;
			case 'rnote': return NoteStyle.RNOTE;
			default: return NoteStyle.NOTE;
		}
	}

	_notePositionFromStr(str) {
		switch (str) {
			case 'left': return NotePosition.LEFT;
			case 'right': return NotePosition.RIGHT;
			case 'over': return NotePosition.OVER;
			default: return NotePosition.RIGHT;
		}
	}
}

/**
 * Convenience function: parse PlantUML text to a SequenceDiagram model.
 */
export function parseSequenceDiagram(text) {
	const parser = new SequenceParser();
	return parser.parse(text);
}
