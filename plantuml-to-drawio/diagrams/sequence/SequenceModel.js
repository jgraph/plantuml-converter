/**
 * Data model for PlantUML sequence diagrams.
 *
 * This intermediate representation captures the parsed structure of a
 * sequence diagram. It is consumed by the emitter to produce mxGraph XML.
 */

// ── Enums ──────────────────────────────────────────────────────────────────

const ParticipantType = Object.freeze({
	PARTICIPANT: 'participant',
	ACTOR:       'actor',
	BOUNDARY:    'boundary',
	CONTROL:     'control',
	ENTITY:      'entity',
	QUEUE:       'queue',
	DATABASE:    'database',
	COLLECTIONS: 'collections'
});

const ArrowHead = Object.freeze({
	NORMAL: 'normal',   // Filled triangle (>)
	ASYNC:  'async',    // Open arrowhead (>>)
	CROSSX: 'crossx',  // X mark
	NONE:   'none'      // No head
});

const ArrowBody = Object.freeze({
	NORMAL: 'normal',   // Solid line (-)
	DOTTED: 'dotted',   // Dashed line (--)
	HIDDEN: 'hidden',
	BOLD:   'bold'
});

const ArrowPart = Object.freeze({
	FULL:        'full',
	TOP_PART:    'top',
	BOTTOM_PART: 'bottom'
});

const ArrowDecoration = Object.freeze({
	NONE:   'none',
	CIRCLE: 'circle'
});

const ArrowDirection = Object.freeze({
	LEFT_TO_RIGHT: 'left_to_right',
	RIGHT_TO_LEFT: 'right_to_left',
	SELF:          'self',
	BOTH:          'both'
});

const NotePosition = Object.freeze({
	LEFT:  'left',
	RIGHT: 'right',
	OVER:  'over'
});

const NoteStyle = Object.freeze({
	NOTE:  'note',    // Standard rectangle with folded corner
	HNOTE: 'hnote',   // Hexagonal
	RNOTE: 'rnote'    // Rounded box
});

const NoteOnArrowPosition = Object.freeze({
	LEFT:   'left',
	RIGHT:  'right',
	TOP:    'top',
	BOTTOM: 'bottom'
});

const LifeEventType = Object.freeze({
	ACTIVATE:   'activate',
	DEACTIVATE: 'deactivate',
	CREATE:     'create',
	DESTROY:    'destroy'
});

const GroupingType = Object.freeze({
	ALT:      'alt',
	ELSE:     'else',
	LOOP:     'loop',
	OPT:      'opt',
	PAR:      'par',
	BREAK:    'break',
	CRITICAL: 'critical',
	GROUP:    'group',
	END:      'end'
});

const ExoMessageType = Object.freeze({
	FROM_LEFT:  'from_left',
	TO_LEFT:    'to_left',
	FROM_RIGHT: 'from_right',
	TO_RIGHT:   'to_right'
});

// ── Model classes ──────────────────────────────────────────────────────────

class Participant {
	constructor(code, displayName, type) {
		this.code = code;
		this.displayName = displayName || code;
		this.type = type || ParticipantType.PARTICIPANT;
		this.order = null;
		this.color = null;
		this.stereotype = null;
		this.isCreated = false; // true if declared via 'create'
	}
}

class ArrowConfig {
	constructor() {
		this.head1 = ArrowHead.NONE;      // Left/source end
		this.head2 = ArrowHead.NORMAL;    // Right/target end
		this.body = ArrowBody.NORMAL;
		this.part = ArrowPart.FULL;
		this.decoration1 = ArrowDecoration.NONE;
		this.decoration2 = ArrowDecoration.NONE;
		this.color = null;
		this.style = null;  // [dashed], [bold], etc.
	}

	get direction() {
		if (this.head1 === ArrowHead.NONE && this.head2 !== ArrowHead.NONE) {
			return ArrowDirection.LEFT_TO_RIGHT;
		}
		if (this.head1 !== ArrowHead.NONE && this.head2 === ArrowHead.NONE) {
			return ArrowDirection.RIGHT_TO_LEFT;
		}
		if (this.head1 !== ArrowHead.NONE && this.head2 !== ArrowHead.NONE) {
			return ArrowDirection.BOTH;
		}
		return ArrowDirection.LEFT_TO_RIGHT; // default
	}
}

class Message {
	constructor(from, to, label, arrowConfig) {
		this.from = from;          // Participant code
		this.to = to;              // Participant code
		this.label = label || '';
		this.arrow = arrowConfig || new ArrowConfig();
		this.noteOnArrow = null;   // NoteOnArrow, if any
		this.isParallel = false;   // & prefix
		this.multicast = [];       // Additional target participant codes
	}

	get isSelf() {
		return this.from === this.to;
	}
}

class ExoMessage {
	constructor(participant, label, arrowConfig, exoType) {
		this.participant = participant;  // Participant code
		this.label = label || '';
		this.arrow = arrowConfig || new ArrowConfig();
		this.exoType = exoType;         // ExoMessageType
		this.noteOnArrow = null;
		this.isParallel = false;
	}
}

class LifeEvent {
	constructor(participant, type, color) {
		this.participant = participant;  // Participant code
		this.type = type;               // LifeEventType
		this.color = color || null;
	}
}

class Fragment {
	constructor(type, label) {
		this.type = type;               // GroupingType (alt, loop, opt, etc.)
		this.label = label || '';
		this.color = null;
		this.color2 = null;
		this.sections = [];             // Array of FragmentSection
	}
}

class FragmentSection {
	constructor(condition) {
		this.condition = condition || '';  // 'else' condition text
		this.elements = [];               // Array of diagram elements
	}
}

class Note {
	constructor(participants, position, text, style) {
		this.participants = participants;  // Array of participant codes (1 or 2)
		this.position = position;         // NotePosition
		this.text = text || '';
		this.style = style || NoteStyle.NOTE;
		this.color = null;
		this.isAcross = false;
		this.isParallel = false;
	}
}

class NoteOnArrow {
	constructor(position, text, style) {
		this.position = position;   // NoteOnArrowPosition
		this.text = text || '';
		this.style = style || NoteStyle.NOTE;
		this.color = null;
	}
}

class Divider {
	constructor(label) {
		this.label = label || '';
	}
}

class Delay {
	constructor(label) {
		this.label = label || '';
	}
}

class HSpace {
	constructor(size) {
		this.size = size || null;  // null = default spacing
	}
}

class Reference {
	constructor(participants, text, color) {
		this.participants = participants; // Array of participant codes
		this.text = text || '';
		this.color = color || null;
		this.url = null;
	}
}

class Box {
	constructor(title, color) {
		this.title = title || '';
		this.color = color || null;
		this.stereotype = null;
		this.participants = [];  // Participant codes in this box
	}
}

class AutoNumber {
	constructor(start, step, format) {
		this.start = start || 1;
		this.step = step || 1;
		this.format = format || null;
	}
}

/**
 * Top-level model for a parsed sequence diagram.
 */
class SequenceDiagram {
	constructor() {
		this.title = null;
		this.participants = new Map();  // code → Participant
		this.participantOrder = [];     // Ordered list of codes
		this.elements = [];             // Ordered list of diagram elements
		this.boxes = [];                // Box groupings
		this.autoNumber = null;         // AutoNumber config, if enabled
	}

	addParticipant(participant) {
		if (!this.participants.has(participant.code)) {
			this.participants.set(participant.code, participant);
			this.participantOrder.push(participant.code);
		}

		return this.participants.get(participant.code);
	}

	/**
	 * Get or auto-create a participant by code.
	 * Used when a participant is first seen in a message rather than
	 * an explicit declaration.
	 */
	getOrCreateParticipant(code) {
		if (!this.participants.has(code)) {
			this.addParticipant(new Participant(code));
		}

		return this.participants.get(code);
	}

	addElement(element) {
		this.elements.push(element);
	}

	getOrderedParticipants() {
		// Respect explicit ordering if set, otherwise use declaration order.
		// Participants without an explicit order keep their declaration index.
		// Participants with an explicit order are placed at their specified position.
		const ordered = this.participantOrder.map(code => this.participants.get(code));

		const hasAnyOrder = ordered.some(p => p.order !== null);
		if (hasAnyOrder === false) {
			return ordered;
		}

		// Assign implicit order to unordered participants based on declaration
		// index, leaving gaps so explicitly ordered ones can slot in.
		const result = ordered.map((p, i) => ({
			participant: p,
			sortKey: p.order !== null ? p.order : i
		}));
		result.sort((a, b) => a.sortKey - b.sortKey);
		return result.map(r => r.participant);
	}
}

// ── Exports ────────────────────────────────────────────────────────────────

export {
	// Enums
	ParticipantType,
	ArrowHead,
	ArrowBody,
	ArrowPart,
	ArrowDecoration,
	ArrowDirection,
	NotePosition,
	NoteStyle,
	NoteOnArrowPosition,
	LifeEventType,
	GroupingType,
	ExoMessageType,

	// Model classes
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
};
