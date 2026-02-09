/**
 * StateModel.js
 *
 * Data model for PlantUML state diagrams.
 *
 * Hybrid model: states form a tree via children[] (for composite states),
 * while transitions are flat lists at each scope level (diagram.transitions
 * for top-level, element.childTransitions for inside composites).
 *
 * [*] tokens get scope-unique codes: __initial_<parentCode>__ / __final_<parentCode>__
 */

// ── Enums ────────────────────────────────────────────────────────────────────

const StateType = Object.freeze({
	STATE:        'state',
	INITIAL:      'initial',
	FINAL:        'final',
	CHOICE:       'choice',
	FORK_JOIN:    'fork_join',
	HISTORY:      'history',
	DEEP_HISTORY: 'deep_history',
	SYNCHRO_BAR:  'synchro_bar',
});

const TransitionStyle = Object.freeze({
	SOLID:  'solid',
	DASHED: 'dashed',
	DOTTED: 'dotted',
	BOLD:   'bold',
	HIDDEN: 'hidden',
});

const TransitionDirection = Object.freeze({
	LEFT:  'left',
	RIGHT: 'right',
	UP:    'up',
	DOWN:  'down',
	NONE:  'none',
});

const NotePosition = Object.freeze({
	LEFT:   'left',
	RIGHT:  'right',
	TOP:    'top',
	BOTTOM: 'bottom',
});

const DiagramDirection = Object.freeze({
	TOP_TO_BOTTOM: 'ttb',
	LEFT_TO_RIGHT: 'ltr',
});

// ── Model Classes ────────────────────────────────────────────────────────────

class StateElement {
	constructor(code, displayName, type) {
		this.code = code;
		this.displayName = displayName || code;
		this.type = type || StateType.STATE;
		this.color = null;
		this.lineColor = null;
		this.lineStyle = null;
		this.stereotypes = [];
		this.descriptions = [];
		this.children = [];
		this.childTransitions = [];
		this.concurrentRegions = [];
		this.parentCode = null;
	}
}

class StateTransition {
	constructor(from, to) {
		this.from = from;
		this.to = to;
		this.label = null;
		this.direction = TransitionDirection.NONE;
		this.lineStyle = TransitionStyle.SOLID;
		this.color = null;
		this.crossStart = false;
		this.circleEnd = false;
		this.arrowLength = 2;
	}
}

class StateNote {
	constructor(position, text) {
		this.position = position || NotePosition.RIGHT;
		this.text = text || '';
		this.entityCode = null;
		this.alias = null;
		this.color = null;
		this.isOnLink = false;
		this.linkIndex = null;
	}
}

class StateDiagram {
	constructor() {
		this.title = null;
		this.elements = new Map();
		this.transitions = [];
		this.notes = [];
		this.direction = DiagramDirection.TOP_TO_BOTTOM;
		this.hideEmptyDescription = false;
	}

	addElement(element) {
		this.elements.set(element.code, element);
		return element;
	}

	getOrCreateElement(code, displayName, type) {
		if (this.elements.has(code)) {
			const el = this.elements.get(code);
			if (type && el.type === StateType.STATE && type !== StateType.STATE) {
				el.type = type;
			}
			if (displayName && el.displayName === el.code && displayName !== code) {
				el.displayName = displayName;
			}
			return el;
		}
		const el = new StateElement(code, displayName, type);
		this.elements.set(code, el);
		return el;
	}

	addTransition(transition) {
		this.transitions.push(transition);
		return this.transitions.length - 1;
	}

	addNote(note) {
		this.notes.push(note);
	}
}

// ── Exports ──────────────────────────────────────────────────────────────────

export {
	StateType,
	TransitionStyle,
	TransitionDirection,
	NotePosition,
	DiagramDirection,
	StateElement,
	StateTransition,
	StateNote,
	StateDiagram,
};
