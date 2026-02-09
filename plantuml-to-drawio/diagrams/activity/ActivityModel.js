/**
 * Data model for PlantUML activity diagrams (new syntax — ActivityDiagram3).
 *
 * This intermediate representation captures the parsed structure of an
 * activity diagram. It is consumed by the emitter to produce mxGraph XML.
 *
 * Activity diagrams are inherently hierarchical: if-blocks contain branches,
 * while-blocks contain loop bodies, etc. The model uses a recursive tree of
 * Instruction objects rather than the flat element lists used by class/usecase.
 */

// ── Enums ──────────────────────────────────────────────────────────────────

const InstructionType = Object.freeze({
	ACTION:    'action',
	START:     'start',
	STOP:      'stop',
	END:       'end',
	KILL:      'kill',
	IF:        'if',
	WHILE:     'while',
	REPEAT:    'repeat',
	SWITCH:    'switch',
	FORK:      'fork',
	SPLIT:     'split',
	PARTITION: 'partition',
	NOTE:      'note',
	ARROW:     'arrow',
	BREAK:     'break',
});

const NotePosition = Object.freeze({
	LEFT:  'left',
	RIGHT: 'right',
});

// ── Model classes ──────────────────────────────────────────────────────────

/**
 * Single flat instruction class with a `type` discriminator and type-specific
 * fields.  Unused fields remain null.  This avoids inheritance complexity and
 * keeps switch-based dispatch in the parser/emitter straightforward.
 */
class Instruction {
	constructor(type) {
		this.type = type;

		// ── ACTION fields ──
		this.label = null;           // string (multiline joined with \n)
		this.color = null;           // '#RRGGBB' or '#colorname'

		// ── ARROW fields ──
		this.arrowLabel = null;      // label text
		this.arrowColor = null;      // '#color'
		this.arrowDashed = false;    // boolean — dashed/dotted line style

		// ── IF fields ──
		this.condition = null;       // string — the test expression
		this.thenLabel = null;       // string — "(yes)" label on then-branch
		this.elseLabel = null;       // string — "(no)" label on else-branch
		this.thenBranch = [];        // Instruction[]
		this.elseBranch = [];        // Instruction[]
		this.elseIfBranches = [];    // Array<{condition: string, label: string, instructions: Instruction[]}>

		// ── WHILE fields ──
		this.whileCondition = null;  // string
		this.whileYesLabel = null;   // string — label on the loop-back arrow
		this.whileNoLabel = null;    // string — label on the exit arrow
		this.whileBody = [];         // Instruction[]

		// ── REPEAT fields ──
		this.repeatStartLabel = null;  // optional label from "repeat :label;"
		this.repeatBody = [];          // Instruction[]
		this.repeatCondition = null;   // string
		this.repeatYesLabel = null;    // string
		this.repeatNoLabel = null;     // string

		// ── SWITCH fields ──
		this.switchCondition = null;   // string
		this.switchCases = [];         // Array<{label: string, instructions: Instruction[]}>

		// ── FORK / SPLIT fields ──
		this.branches = [];            // Array<Instruction[]>

		// ── PARTITION fields ──
		this.partitionName = null;     // string
		this.partitionColor = null;    // '#color'
		this.partitionBody = [];       // Instruction[]

		// ── NOTE fields ──
		this.notePosition = null;      // NotePosition
		this.noteText = null;          // string
		this.noteFloating = false;     // boolean

		// ── Cross-cutting ──
		this.swimlane = null;          // string — set by parser for every instruction
	}
}

/**
 * Swimlane definition — one per named lane in the diagram.
 */
class SwimlaneDefinition {
	constructor(name) {
		this.name = name;
		this.color = null;   // '#color'
		this.label = null;   // display label (if different from name)
	}
}

/**
 * Root model for a parsed activity diagram.
 */
class ActivityDiagram {
	constructor() {
		this.title = null;              // string
		this.instructions = [];         // Instruction[] — top-level sequence
		this.swimlanes = new Map();     // name → SwimlaneDefinition
	}
}

// ── Exports ────────────────────────────────────────────────────────────────

export {
	InstructionType,
	NotePosition,
	Instruction,
	SwimlaneDefinition,
	ActivityDiagram,
};
