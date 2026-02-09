/**
 * Parser for PlantUML activity diagrams (new syntax — ActivityDiagram3).
 *
 * Reads PlantUML text line-by-line and produces an ActivityDiagram model.
 * Uses a block stack to track nested control structures (if, while, repeat,
 * switch, fork, split, partition).
 *
 * Regex patterns are derived from the PlantUML Java source under
 * net/sourceforge/plantuml/activitydiagram3/command/.
 */

import {
	InstructionType,
	NotePosition,
	Instruction,
	SwimlaneDefinition,
	ActivityDiagram,
} from './ActivityModel.js';

// ── Parser state enums ─────────────────────────────────────────────────────

const LineState = Object.freeze({
	NORMAL:             'normal',
	MULTILINE_NOTE:     'multiline_note',
	MULTILINE_ACTIVITY: 'multiline_activity',
});

const BlockType = Object.freeze({
	IF_THEN:        'if_then',
	IF_ELSE:        'if_else',
	ELSEIF:         'elseif',
	WHILE_BODY:     'while_body',
	REPEAT_BODY:    'repeat_body',
	SWITCH_CASE:    'switch_case',
	FORK_BRANCH:    'fork_branch',
	SPLIT_BRANCH:   'split_branch',
	PARTITION_BODY: 'partition_body',
});

// ── Regex patterns ─────────────────────────────────────────────────────────
// Derived from PlantUML Java source Command*.java files.
// PlantUML [%s] → \s, [%g] → ", COLOR → #\w+[-\\|/]?\w*

// Color pattern used across many commands
const COLOR = '(?:#\\w+(?:[-\\\\|/]\\w+)?)';

// Line style inside arrow brackets: -[#red,dashed]->
const LINE_STYLE_INNER = '(?:#\\w+|dotted|dashed|plain|bold|hidden|norank|single|thickness=\\d+)(?:[,;](?:#\\w+|dotted|dashed|plain|bold|hidden|norank|single|thickness=\\d+))*';

// ── Tier 1: Core ───────────────────────────────────────────────────────────

// Activity (single-line): [#color]:label;
const RE_ACTIVITY = /^(?:(#\w+(?:[-\\|/]\w+)?)\s*)?:(.+);$/;

// Activity (multiline start): [#color]:text (no trailing ;)
const RE_ACTIVITY_START = /^(?:(#\w+(?:[-\\|/]\w+)?)\s*)?:(.*)$/;

// Activity (multiline end): text;
const RE_ACTIVITY_END = /^(.*);$/;

// Arrow: -> or -[style]->  with optional label ending in ;
const RE_ARROW = new RegExp(
	'^(?:' +
		'->|' +
		'-\\[(' + LINE_STYLE_INNER + ')\\]->' +
	')\\s*(?:(.+?)\\s*;|(.+))?\\s*$'
);

// Start
const RE_START = /^start\s*$/i;

// Stop
const RE_STOP = /^stop\s*$/i;

// End
const RE_END = /^end\s*$/i;

// Kill / Detach
const RE_KILL = /^(?:kill|detach)\s*$/i;

// If: [#color:]if (test) then [(yes)]
const RE_IF = new RegExp(
	'^(?:(' + COLOR.slice(3, -1) + ')\\s*:)?\\s*if\\s*\\((.+?)\\)\\s*then\\s*(?:\\((.+?)\\))?\\s*;?\\s*$',
	'i'
);

// If with is/equals: [#color:]if (test) is|equals (val) then
const RE_IF_IS = new RegExp(
	'^(?:(' + COLOR.slice(3, -1) + ')\\s*:)?\\s*if\\s*\\((.+?)\\)\\s*(?:is|equals?)\\s*\\((.+?)\\)\\s*then\\s*;?\\s*$',
	'i'
);

// ElseIf: [(incoming)] elseif (test) then [(label)]
const RE_ELSEIF = /^(?:\((.+?)\)\s*)?else\s*if\s*\((.+?)\)\s*then\s*(?:\((.+?)\))?\s*;?\s*$/i;

// Else: else [(label)]
const RE_ELSE = /^else\s*(?:\((.+?)\))?\s*;?\s*$/i;

// Endif
const RE_ENDIF = /^end\s*if\s*$|^endif\s*$/i;

// ── Tier 2: Control Flow ───────────────────────────────────────────────────

// While: [#color:]while (test) [is (yes)]
const RE_WHILE = new RegExp(
	'^(?:(' + COLOR.slice(3, -1) + ')\\s*:)?\\s*while\\s*\\((.+?)\\)\\s*(?:(?:is|equals?)\\s*\\((.+?)\\))?\\s*;?\\s*$',
	'i'
);

// End while: endwhile [(label)] or end while [(label)]
const RE_ENDWHILE = /^(?:end\s*while|endwhile|while\s*end)\s*(?:\((.+?)\))?\s*;?\s*$/i;

// Repeat: [#color:]repeat [:label;]
const RE_REPEAT = new RegExp(
	'^(?:(' + COLOR.slice(3, -1) + ')\\s*:)?\\s*repeat\\s*(?::(.+?);)?\\s*$',
	'i'
);

// Repeat while: repeat while (test) [is (yes)] [not (no)]
// This is complex in PlantUML — multiple alternate forms.
// Simplified: capture condition, optional is-label, optional not-label.
const RE_REPEAT_WHILE = /^repeat\s*while\s*(?:\((.+?)\)\s*(?:(?:is|equals?)\s*\((.+?)\)\s*(?:not\s*\((.+?)\))?\s*|not\s*\((.+?)\)\s*)?)?(?:(?:->|-\[[^\]]+\]->)\s*(.+?))?\s*;?\s*$/i;

// Switch: [#color:]switch (test)
const RE_SWITCH = new RegExp(
	'^(?:(' + COLOR.slice(3, -1) + ')\\s*:)?\\s*switch\\s*\\((.+?)\\)\\s*$',
	'i'
);

// Case: case (value)
const RE_CASE = /^case\s*\((.+?)\)\s*$/i;

// End switch
const RE_ENDSWITCH = /^end\s*switch\s*$|^endswitch\s*$/i;

// Break
const RE_BREAK = /^break\s*$/i;

// ── Tier 3: Layout ─────────────────────────────────────────────────────────

// Fork
const RE_FORK = /^fork\s*;?\s*$/i;

// Fork again
const RE_FORK_AGAIN = /^fork\s+again\s*;?\s*$/i;

// End fork
const RE_END_FORK = /^end\s*fork\s*$|^endfork\s*$/i;

// Split
const RE_SPLIT = /^split\s*;?\s*$/i;

// Split again
const RE_SPLIT_AGAIN = /^split\s+again\s*;?\s*$/i;

// End split
const RE_END_SPLIT = /^end\s*split\s*$|^endsplit\s*$/i;

// Partition / package / rectangle / card / group
const RE_PARTITION = /^(partition|package|rectangle|card|group)\s+(?:(#\w+(?:[-\\|/]\w+)?)\s+)?(?:"([^"]+)"|(\S+))\s*(?:(#\w+(?:[-\\|/]\w+)?)\s*)?(?:\{)?\s*$/i;

// Close group: }
const RE_CLOSE_GROUP = /^\}\s*$/;

// Swimlane: |[#color]name|[label]
const RE_SWIMLANE = /^\|(?:(#\w+(?:[-\\|/]\w+)?)\|)?([^|]+)\|(.+)?\s*$/;

// Note (single-line): [floating ]note left|right [#color]: text
const RE_NOTE = /^(floating\s+)?note\s+(left|right)\s*(?:(#\w+(?:[-\\|/]\w+)?)\s*)?:\s*(.+)$/i;

// Note (multiline start): [floating ]note left|right [#color]
const RE_NOTE_START = /^(floating\s+)?note\s+(left|right)\s*(?:(#\w+(?:[-\\|/]\w+)?)\s*)?$/i;

// End note
const RE_END_NOTE = /^end\s*note\s*$/i;

// Backward activity: backward :label;
const RE_BACKWARD = /^backward\s*:(.+?);$/i;

// Title
const RE_TITLE = /^title\s+(.+)$/i;

// ── Parser class ───────────────────────────────────────────────────────────

class ActivityParser {
	constructor() {
		this.diagram = null;
		this.lineState = LineState.NORMAL;
		this.blockStack = [];
		this.currentSwimlane = null;
		this.pendingArrow = null;
		this.multiLineBuffer = [];
		this.multiLineContext = null;
	}

	/**
	 * Parse PlantUML activity diagram text into an ActivityDiagram model.
	 * @param {string} text
	 * @returns {ActivityDiagram}
	 */
	parse(text) {
		this.diagram = new ActivityDiagram();
		this.lineState = LineState.NORMAL;
		this.blockStack = [];
		this.currentSwimlane = null;
		this.pendingArrow = null;
		this.multiLineBuffer = [];
		this.multiLineContext = null;

		const lines = text.split('\n');

		for (const rawLine of lines) {
			const line = rawLine.trim();

			// Skip empty lines
			if (line === '') continue;

			// Skip comments
			if (line.startsWith("'")) continue;
			if (/^\/'.+'\/\s*$/.test(line)) continue;

			// Skip directives
			if (/^@start/i.test(line)) continue;
			if (/^@end/i.test(line)) continue;
			if (/^skinparam\b/i.test(line)) continue;
			if (/^scale\s/i.test(line)) continue;
			if (/^hide\s/i.test(line)) continue;

			// ── Multiline state handlers ──
			if (this.lineState === LineState.MULTILINE_NOTE) {
				if (this._handleEndNote(line)) continue;
				this.multiLineBuffer.push(rawLine.trimEnd());
				continue;
			}
			if (this.lineState === LineState.MULTILINE_ACTIVITY) {
				if (this._handleActivityEnd(line)) continue;
				this.multiLineBuffer.push(rawLine.trimEnd());
				continue;
			}

			// ── Single-line parsers (priority order) ──
			// Title and swimlane first (they don't create flow instructions)
			if (this._parseTitle(line)) continue;
			if (this._parseSwimlane(line)) continue;

			// Terminal nodes
			if (this._parseStart(line)) continue;
			if (this._parseStop(line)) continue;
			if (this._parseKill(line)) continue;
			if (this._parseBreak(line)) continue;

			// Block closers before openers (prevents "end" matching RE_END
			// when we meant "endif" or "endwhile")
			if (this._parseEndif(line)) continue;
			if (this._parseElseIf(line)) continue;
			if (this._parseElse(line)) continue;
			if (this._parseEndwhile(line)) continue;
			if (this._parseRepeatWhile(line)) continue;
			if (this._parseEndswitch(line)) continue;
			if (this._parseEndFork(line)) continue;
			if (this._parseEndSplit(line)) continue;
			if (this._parseCloseGroup(line)) continue;

			// "end" as stop synonym — must come after all "end X" patterns
			if (this._parseEnd(line)) continue;

			// Block openers
			if (this._parseIf(line)) continue;
			if (this._parseWhile(line)) continue;
			if (this._parseRepeat(line)) continue;
			if (this._parseSwitch(line)) continue;
			if (this._parseCase(line)) continue;
			if (this._parseForkAgain(line)) continue;
			if (this._parseFork(line)) continue;
			if (this._parseSplitAgain(line)) continue;
			if (this._parseSplit(line)) continue;
			if (this._parsePartition(line)) continue;

			// Notes
			if (this._parseNoteSingleLine(line)) continue;
			if (this._parseNoteStart(line)) continue;

			// Backward activity
			if (this._parseBackward(line)) continue;

			// Activities (must come after block keywords that might start with ":")
			if (this._parseActivity(line)) continue;
			if (this._parseActivityStart(line)) continue;

			// Arrow (last — catches standalone -> lines)
			if (this._parseArrow(line)) continue;
		}

		return this.diagram;
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	/**
	 * Get the instruction array where new instructions should be added.
	 */
	_currentTarget() {
		if (this.blockStack.length === 0) {
			return this.diagram.instructions;
		}
		return this.blockStack[this.blockStack.length - 1].targetArray;
	}

	/**
	 * Add an instruction to the current target, inserting any pending arrow
	 * before it.
	 */
	_addInstruction(instr) {
		instr.swimlane = this.currentSwimlane;
		if (this.pendingArrow !== null) {
			this.pendingArrow.swimlane = this.currentSwimlane;
			this._currentTarget().push(this.pendingArrow);
			this.pendingArrow = null;
		}
		this._currentTarget().push(instr);
	}

	/**
	 * Normalize a color string — ensure it starts with '#'.
	 */
	_normalizeColor(color) {
		if (color === null || color === undefined) return null;
		return color.startsWith('#') ? color : '#' + color;
	}

	// ── Title ──────────────────────────────────────────────────────────────

	_parseTitle(line) {
		const m = line.match(RE_TITLE);
		if (m === null) return false;
		this.diagram.title = m[1].trim();
		return true;
	}

	// ── Terminal nodes ─────────────────────────────────────────────────────

	_parseStart(line) {
		if (RE_START.test(line) === false) return false;
		this._addInstruction(new Instruction(InstructionType.START));
		return true;
	}

	_parseStop(line) {
		if (RE_STOP.test(line) === false) return false;
		this._addInstruction(new Instruction(InstructionType.STOP));
		return true;
	}

	_parseEnd(line) {
		if (RE_END.test(line) === false) return false;
		this._addInstruction(new Instruction(InstructionType.END));
		return true;
	}

	_parseKill(line) {
		if (RE_KILL.test(line) === false) return false;
		this._addInstruction(new Instruction(InstructionType.KILL));
		return true;
	}

	_parseBreak(line) {
		if (RE_BREAK.test(line) === false) return false;
		this._addInstruction(new Instruction(InstructionType.BREAK));
		return true;
	}

	// ── Activity ───────────────────────────────────────────────────────────

	_parseActivity(line) {
		const m = line.match(RE_ACTIVITY);
		if (m === null) return false;
		const instr = new Instruction(InstructionType.ACTION);
		instr.color = this._normalizeColor(m[1]);
		instr.label = m[2];
		this._addInstruction(instr);
		return true;
	}

	_parseActivityStart(line) {
		const m = line.match(RE_ACTIVITY_START);
		if (m === null) return false;
		// Only match if we haven't already matched single-line activity
		// (single-line has trailing ;  — RE_ACTIVITY_START matches lines without ;)
		if (line.endsWith(';')) return false;
		this.multiLineContext = {
			color: m[1] || null,
			firstLine: m[2],
		};
		this.multiLineBuffer = [];
		this.lineState = LineState.MULTILINE_ACTIVITY;
		return true;
	}

	_handleActivityEnd(line) {
		const m = line.match(RE_ACTIVITY_END);
		if (m === null) return false;
		const allLines = [this.multiLineContext.firstLine, ...this.multiLineBuffer, m[1]];
		const label = allLines.join('\n');
		const instr = new Instruction(InstructionType.ACTION);
		instr.label = label;
		instr.color = this._normalizeColor(this.multiLineContext.color);
		this._addInstruction(instr);
		this.lineState = LineState.NORMAL;
		this.multiLineContext = null;
		return true;
	}

	// ── Backward activity ──────────────────────────────────────────────────

	_parseBackward(line) {
		const m = line.match(RE_BACKWARD);
		if (m === null) return false;
		const instr = new Instruction(InstructionType.ACTION);
		instr.label = m[1];
		this._addInstruction(instr);
		return true;
	}

	// ── Arrow ──────────────────────────────────────────────────────────────

	_parseArrow(line) {
		const m = line.match(RE_ARROW);
		if (m === null) return false;
		const instr = new Instruction(InstructionType.ARROW);
		// m[1] = style inside brackets (e.g., "#red,dashed")
		// m[2] = label when ending with ;
		// m[3] = label without ;
		const label = m[2] || m[3] || null;
		instr.arrowLabel = label ? label.trim() : null;

		if (m[1]) {
			// Extract color from style string
			const colorMatch = m[1].match(/#\w+/);
			if (colorMatch) {
				instr.arrowColor = colorMatch[0];
			}
		}

		this.pendingArrow = instr;
		return true;
	}

	// ── If / ElseIf / Else / Endif ─────────────────────────────────────────

	_parseIf(line) {
		let m = line.match(RE_IF);
		if (m === null) {
			m = line.match(RE_IF_IS);
		}
		if (m === null) return false;

		const instr = new Instruction(InstructionType.IF);
		instr.color = this._normalizeColor(m[1]);
		instr.condition = m[2];
		instr.thenLabel = m[3] || null;

		this._addInstruction(instr);
		this.blockStack.push({
			blockType: BlockType.IF_THEN,
			instruction: instr,
			targetArray: instr.thenBranch,
		});
		return true;
	}

	_parseElseIf(line) {
		const m = line.match(RE_ELSEIF);
		if (m === null) return false;

		// Pop current branch (IF_THEN or ELSEIF)
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.IF_THEN &&
			frame.blockType !== BlockType.ELSEIF) return false;
		this.blockStack.pop();

		// Store the incoming label on the parent IF's else edge
		const ifInstr = frame.instruction;
		if (m[1]) {
			ifInstr.elseLabel = m[1];
		}

		// Create a new elseIf branch
		const branch = {
			condition: m[2],
			label: m[3] || null,
			instructions: [],
		};
		ifInstr.elseIfBranches.push(branch);

		this.blockStack.push({
			blockType: BlockType.ELSEIF,
			instruction: ifInstr,
			targetArray: branch.instructions,
		});
		return true;
	}

	_parseElse(line) {
		const m = line.match(RE_ELSE);
		if (m === null) return false;

		// Pop current branch (IF_THEN or ELSEIF)
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.IF_THEN &&
			frame.blockType !== BlockType.ELSEIF) return false;
		this.blockStack.pop();

		const ifInstr = frame.instruction;
		ifInstr.elseLabel = m[1] || ifInstr.elseLabel || null;

		this.blockStack.push({
			blockType: BlockType.IF_ELSE,
			instruction: ifInstr,
			targetArray: ifInstr.elseBranch,
		});
		return true;
	}

	_parseEndif(line) {
		if (RE_ENDIF.test(line) === false) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.IF_THEN &&
			frame.blockType !== BlockType.IF_ELSE &&
			frame.blockType !== BlockType.ELSEIF) return false;
		this.blockStack.pop();
		return true;
	}

	// ── While / Endwhile ───────────────────────────────────────────────────

	_parseWhile(line) {
		const m = line.match(RE_WHILE);
		if (m === null) return false;

		const instr = new Instruction(InstructionType.WHILE);
		instr.color = this._normalizeColor(m[1]);
		instr.whileCondition = m[2];
		instr.whileYesLabel = m[3] || null;

		this._addInstruction(instr);
		this.blockStack.push({
			blockType: BlockType.WHILE_BODY,
			instruction: instr,
			targetArray: instr.whileBody,
		});
		return true;
	}

	_parseEndwhile(line) {
		const m = line.match(RE_ENDWHILE);
		if (m === null) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.WHILE_BODY) return false;

		frame.instruction.whileNoLabel = m[1] || null;
		this.blockStack.pop();
		return true;
	}

	// ── Repeat / Repeat while ──────────────────────────────────────────────

	_parseRepeat(line) {
		const m = line.match(RE_REPEAT);
		if (m === null) return false;

		const instr = new Instruction(InstructionType.REPEAT);
		instr.color = this._normalizeColor(m[1]);
		instr.repeatStartLabel = m[2] || null;

		this._addInstruction(instr);
		this.blockStack.push({
			blockType: BlockType.REPEAT_BODY,
			instruction: instr,
			targetArray: instr.repeatBody,
		});
		return true;
	}

	_parseRepeatWhile(line) {
		const m = line.match(RE_REPEAT_WHILE);
		if (m === null) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.REPEAT_BODY) return false;

		const instr = frame.instruction;
		instr.repeatCondition = m[1] || null;
		// is (yes) label
		instr.repeatYesLabel = m[2] || null;
		// not (no) label — can be in m[3] or m[4] depending on form
		instr.repeatNoLabel = m[3] || m[4] || null;

		this.blockStack.pop();
		return true;
	}

	// ── Switch / Case / Endswitch ──────────────────────────────────────────

	_parseSwitch(line) {
		const m = line.match(RE_SWITCH);
		if (m === null) return false;

		const instr = new Instruction(InstructionType.SWITCH);
		instr.color = this._normalizeColor(m[1]);
		instr.switchCondition = m[2];

		this._addInstruction(instr);
		// Don't push a stack frame yet — wait for first case
		// But we need to remember the switch instruction
		this.blockStack.push({
			blockType: BlockType.SWITCH_CASE,
			instruction: instr,
			targetArray: null, // no instructions allowed before first case
		});
		return true;
	}

	_parseCase(line) {
		const m = line.match(RE_CASE);
		if (m === null) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.SWITCH_CASE) return false;

		// Create a new case entry
		const caseEntry = {
			label: m[1],
			instructions: [],
		};
		frame.instruction.switchCases.push(caseEntry);

		// Update the target array to point to this case's instructions
		frame.targetArray = caseEntry.instructions;
		return true;
	}

	_parseEndswitch(line) {
		if (RE_ENDSWITCH.test(line) === false) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.SWITCH_CASE) return false;
		this.blockStack.pop();
		return true;
	}

	// ── Fork / Fork again / End fork ───────────────────────────────────────

	_parseFork(line) {
		if (RE_FORK.test(line) === false) return false;
		// Make sure it's not "fork again"
		if (/^fork\s+again/i.test(line)) return false;

		const instr = new Instruction(InstructionType.FORK);
		const firstBranch = [];
		instr.branches.push(firstBranch);

		this._addInstruction(instr);
		this.blockStack.push({
			blockType: BlockType.FORK_BRANCH,
			instruction: instr,
			targetArray: firstBranch,
		});
		return true;
	}

	_parseForkAgain(line) {
		if (RE_FORK_AGAIN.test(line) === false) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.FORK_BRANCH) return false;

		// Create a new branch
		const newBranch = [];
		frame.instruction.branches.push(newBranch);
		frame.targetArray = newBranch;
		return true;
	}

	_parseEndFork(line) {
		if (RE_END_FORK.test(line) === false) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.FORK_BRANCH) return false;
		this.blockStack.pop();
		return true;
	}

	// ── Split / Split again / End split ────────────────────────────────────

	_parseSplit(line) {
		if (RE_SPLIT.test(line) === false) return false;
		if (/^split\s+again/i.test(line)) return false;

		const instr = new Instruction(InstructionType.SPLIT);
		const firstBranch = [];
		instr.branches.push(firstBranch);

		this._addInstruction(instr);
		this.blockStack.push({
			blockType: BlockType.SPLIT_BRANCH,
			instruction: instr,
			targetArray: firstBranch,
		});
		return true;
	}

	_parseSplitAgain(line) {
		if (RE_SPLIT_AGAIN.test(line) === false) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.SPLIT_BRANCH) return false;

		const newBranch = [];
		frame.instruction.branches.push(newBranch);
		frame.targetArray = newBranch;
		return true;
	}

	_parseEndSplit(line) {
		if (RE_END_SPLIT.test(line) === false) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.SPLIT_BRANCH) return false;
		this.blockStack.pop();
		return true;
	}

	// ── Partition / Close group ────────────────────────────────────────────

	_parsePartition(line) {
		const m = line.match(RE_PARTITION);
		if (m === null) return false;

		const instr = new Instruction(InstructionType.PARTITION);
		instr.partitionName = m[3] || m[4]; // quoted or unquoted name
		instr.partitionColor = this._normalizeColor(m[2] || m[5]);

		this._addInstruction(instr);
		this.blockStack.push({
			blockType: BlockType.PARTITION_BODY,
			instruction: instr,
			targetArray: instr.partitionBody,
		});
		return true;
	}

	_parseCloseGroup(line) {
		if (RE_CLOSE_GROUP.test(line) === false) return false;
		if (this.blockStack.length === 0) return false;
		const frame = this.blockStack[this.blockStack.length - 1];
		if (frame.blockType !== BlockType.PARTITION_BODY) return false;
		this.blockStack.pop();
		return true;
	}

	// ── Swimlane ───────────────────────────────────────────────────────────

	_parseSwimlane(line) {
		const m = line.match(RE_SWIMLANE);
		if (m === null) return false;

		const name = m[2].trim();
		const label = m[3] ? m[3].trim() : null;
		const color = this._normalizeColor(m[1]);

		if (this.diagram.swimlanes.has(name) === false) {
			const def = new SwimlaneDefinition(name);
			def.color = color;
			def.label = label;
			this.diagram.swimlanes.set(name, def);
		}

		this.currentSwimlane = name;
		return true;
	}

	// ── Notes ──────────────────────────────────────────────────────────────

	_parseNoteSingleLine(line) {
		const m = line.match(RE_NOTE);
		if (m === null) return false;

		const instr = new Instruction(InstructionType.NOTE);
		instr.noteFloating = m[1] !== undefined;
		instr.notePosition = m[2].toLowerCase() === 'left' ? NotePosition.LEFT : NotePosition.RIGHT;
		instr.color = this._normalizeColor(m[3]);
		instr.noteText = m[4];
		this._addInstruction(instr);
		return true;
	}

	_parseNoteStart(line) {
		const m = line.match(RE_NOTE_START);
		if (m === null) return false;

		this.multiLineContext = {
			floating: m[1] !== undefined,
			position: m[2].toLowerCase() === 'left' ? NotePosition.LEFT : NotePosition.RIGHT,
			color: m[3] || null,
		};
		this.multiLineBuffer = [];
		this.lineState = LineState.MULTILINE_NOTE;
		return true;
	}

	_handleEndNote(line) {
		if (RE_END_NOTE.test(line) === false) return false;

		const instr = new Instruction(InstructionType.NOTE);
		instr.noteFloating = this.multiLineContext.floating;
		instr.notePosition = this.multiLineContext.position;
		instr.color = this._normalizeColor(this.multiLineContext.color);
		instr.noteText = this.multiLineBuffer.join('\n');
		this._addInstruction(instr);

		this.lineState = LineState.NORMAL;
		this.multiLineContext = null;
		return true;
	}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse PlantUML activity diagram text into an ActivityDiagram model.
 * @param {string} text
 * @returns {ActivityDiagram}
 */
export function parseActivityDiagram(text) {
	const parser = new ActivityParser();
	return parser.parse(text);
}

export { ActivityParser };
