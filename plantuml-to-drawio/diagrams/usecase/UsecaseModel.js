/**
 * Data model for PlantUML usecase diagrams.
 *
 * This intermediate representation captures the parsed structure of a
 * usecase diagram. It is consumed by the emitter to produce mxGraph XML.
 */

// ── Enums ──────────────────────────────────────────────────────────────────

const ElementType = Object.freeze({
	ACTOR:             'actor',
	ACTOR_BUSINESS:    'actor_business',
	USECASE:           'usecase',
	USECASE_BUSINESS:  'usecase_business',
	PACKAGE:           'package',
	RECTANGLE:         'rectangle',
	FRAME:             'frame',
	CLOUD:             'cloud',
	NODE:              'node',
	FOLDER:            'folder',
	DATABASE:          'database',
	COMPONENT:         'component',
	BOUNDARY:          'boundary',
	CONTROL:           'control',
	ENTITY_DESC:       'entity_desc',
	CARD:              'card',
	FILE:              'file',
	AGENT:             'agent',
	STORAGE:           'storage',
	QUEUE:             'queue',
	STACK:             'stack',
	HEXAGON:           'hexagon',
	PERSON:            'person',
	LABEL:             'label',
	COLLECTIONS:       'collections',
});

const RelationDecor = Object.freeze({
	NONE:            'none',
	EXTENDS:         'extends',          // <|  |>  ^
	COMPOSITION:     'composition',      // *
	AGGREGATION:     'aggregation',      // o
	ARROW:           'arrow',            // <  >
	ARROW_TRIANGLE:  'arrow_triangle',   // <<  >>
	NOT_NAVIGABLE:   'not_navigable',    // x
	CROWFOOT:        'crowfoot',         // }  {
	CIRCLE_CROWFOOT: 'circle_crowfoot',  // }o  o{
	DOUBLE_LINE:     'double_line',      // ||
	CIRCLE_LINE:     'circle_line',      // |o  o|
	LINE_CROWFOOT:   'line_crowfoot',    // }|  |{
	CIRCLE:          'circle',           // 0
	CIRCLE_FILL:     'circle_fill',      // @
	CIRCLE_CONNECT:  'circle_connect',   // 0)  (0
	PARENTHESIS:     'parenthesis',      // )  (
	SQUARE:          'square',           // #
	PLUS:            'plus',             // +
	HALF_ARROW_UP:   'half_arrow_up',    // \\
	HALF_ARROW_DOWN: 'half_arrow_down',  // //
});

const LineStyle = Object.freeze({
	SOLID:  'solid',   // -
	DASHED: 'dashed',  // .
	BOLD:   'bold',    // =
	DOTTED: 'dotted',  // ~
});

const Direction = Object.freeze({
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

// ── Container type keywords ────────────────────────────────────────────────

/**
 * Maps container keyword strings to ElementType values.
 */
const CONTAINER_KEYWORD_MAP = Object.freeze({
	'package':    ElementType.PACKAGE,
	'rectangle':  ElementType.RECTANGLE,
	'frame':      ElementType.FRAME,
	'cloud':      ElementType.CLOUD,
	'node':       ElementType.NODE,
	'folder':     ElementType.FOLDER,
	'database':   ElementType.DATABASE,
	'component':  ElementType.COMPONENT,
	'card':       ElementType.CARD,
	'file':       ElementType.FILE,
	'hexagon':    ElementType.HEXAGON,
	'storage':    ElementType.STORAGE,
	'queue':      ElementType.QUEUE,
	'stack':      ElementType.STACK,
	'agent':      ElementType.AGENT,
});

// ── Model classes ──────────────────────────────────────────────────────────

class UsecaseElement {
	constructor(code, displayName, type) {
		this.code = code;
		this.displayName = displayName || code;
		this.type = type || ElementType.USECASE;
		this.color = null;                 // Background color
		this.lineColor = null;             // Border/line color
		this.stereotypes = [];             // Array of stereotype strings
		this.containerPath = null;         // Path of parent container (if inside one)
	}
}

class UsecaseRelationship {
	constructor(from, to) {
		this.from = from;                  // Source element code
		this.to = to;                      // Target element code
		this.leftDecor = RelationDecor.NONE;
		this.rightDecor = RelationDecor.NONE;
		this.lineStyle = LineStyle.SOLID;
		this.label = null;                 // Center label (: label)
		this.leftLabel = null;             // Source-side label ("label" before arrow)
		this.rightLabel = null;            // Target-side label ("label" after arrow)
		this.direction = Direction.NONE;   // Layout hint
		this.color = null;
	}
}

class UsecaseContainer {
	constructor(name, code, type, parentPath) {
		this.name = name;
		this.code = code || name;
		this.type = type || ElementType.PACKAGE;
		this.path = parentPath ? `${parentPath}.${code}` : code;
		this.color = null;
		this.stereotypes = [];
		this.elements = [];                // Element codes directly in this container
		this.subContainers = [];           // Nested UsecaseContainer objects
	}
}

class UsecaseNote {
	constructor(position, text) {
		this.position = position;          // NotePosition enum
		this.text = text || '';
		this.entityCode = null;            // null for floating notes
		this.alias = null;                 // For "note ... as Alias"
		this.color = null;
		this.isOnLink = false;             // note on link
		this.linkIndex = null;             // Index in diagram.links[]
	}
}

class UsecaseDiagram {
	constructor() {
		this.title = null;
		this.elements = new Map();         // code → UsecaseElement
		this.links = [];                   // Ordered UsecaseRelationship array
		this.containers = [];              // Top-level UsecaseContainer array
		this.notes = [];                   // Array of UsecaseNote objects
		this.direction = DiagramDirection.TOP_TO_BOTTOM;
		this.togetherGroups = [];          // Array of arrays of element codes
	}

	addElement(element) {
		if (!this.elements.has(element.code)) {
			this.elements.set(element.code, element);
		}
		return this.elements.get(element.code);
	}

	getOrCreateElement(code, displayName, type) {
		if (!this.elements.has(code)) {
			this.addElement(new UsecaseElement(code, displayName || code, type));
		}
		return this.elements.get(code);
	}

	addLink(link) {
		this.links.push(link);
		return this.links.length - 1;
	}

	addNote(note) {
		this.notes.push(note);
	}
}

// ── Exports ────────────────────────────────────────────────────────────────

export {
	// Enums
	ElementType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	DiagramDirection,
	CONTAINER_KEYWORD_MAP,

	// Model classes
	UsecaseElement,
	UsecaseRelationship,
	UsecaseContainer,
	UsecaseNote,
	UsecaseDiagram,
};
