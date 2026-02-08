/**
 * Data model for PlantUML class diagrams.
 *
 * This intermediate representation captures the parsed structure of a
 * class diagram. It is consumed by the emitter to produce mxGraph XML.
 */

// ── Enums ──────────────────────────────────────────────────────────────────

const EntityType = Object.freeze({
	CLASS:          'class',
	ABSTRACT_CLASS: 'abstract_class',
	INTERFACE:      'interface',
	ANNOTATION:     'annotation',
	ENUM:           'enum',
	ENTITY:         'entity',
	PROTOCOL:       'protocol',
	STRUCT:         'struct',
	EXCEPTION:      'exception',
	METACLASS:      'metaclass',
	STEREOTYPE_TYPE:'stereotype_type',
	DATACLASS:      'dataclass',
	RECORD:         'record',
	CIRCLE:         'circle',
	DIAMOND:        'diamond',
	LOLLIPOP_FULL:  'lollipop_full',
	LOLLIPOP_HALF:  'lollipop_half'
});

const Visibility = Object.freeze({
	PUBLIC:    'public',     // +
	PRIVATE:   'private',    // -
	PROTECTED: 'protected',  // #
	PACKAGE:   'package'     // ~
});

const MemberType = Object.freeze({
	FIELD:  'field',
	METHOD: 'method'
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
	HALF_ARROW_DOWN: 'half_arrow_down'   // //
});

const LineStyle = Object.freeze({
	SOLID:  'solid',   // -
	DASHED: 'dashed',  // .
	BOLD:   'bold'     // =
});

const Direction = Object.freeze({
	LEFT:  'left',
	RIGHT: 'right',
	UP:    'up',
	DOWN:  'down',
	NONE:  'none'
});

const NotePosition = Object.freeze({
	LEFT:   'left',
	RIGHT:  'right',
	TOP:    'top',
	BOTTOM: 'bottom'
});

const SeparatorStyle = Object.freeze({
	SOLID:  'solid',   // --
	DOTTED: 'dotted',  // ..
	DOUBLE: 'double',  // ==
	THICK:  'thick'    // __
});

// ── Model classes ──────────────────────────────────────────────────────────

class ClassEntity {
	constructor(code, displayName, type) {
		this.code = code;
		this.displayName = displayName || code;
		this.type = type || EntityType.CLASS;
		this.genericParams = null;         // e.g. "T, K extends Comparable"
		this.stereotypes = [];             // Array of stereotype strings
		this.color = null;                 // Background color
		this.lineColor = null;             // Border/line color
		this.extends = [];                 // Array of parent entity codes
		this.implements = [];              // Array of interface codes
		this.members = [];                 // Array of Member objects
		this.isAbstract = false;           // Explicit abstract modifier
		this.url = null;
		this.packagePath = null;           // Package this entity belongs to
	}
}

class Member {
	constructor(rawText) {
		this.rawText = rawText;            // Original text as written
		this.name = '';                    // Parsed name
		this.returnType = null;            // Return type (field type or method return)
		this.visibility = null;            // Visibility enum, or null if not specified
		this.isStatic = false;
		this.isAbstract = false;
		this.memberType = MemberType.FIELD;
		this.parameters = null;            // For methods: parameter string
	}
}

class Separator {
	constructor(label, style) {
		this.label = label || '';
		this.style = style || SeparatorStyle.SOLID;
	}
}

class Relationship {
	constructor(from, to) {
		this.from = from;                  // Source entity code
		this.to = to;                      // Target entity code
		this.leftDecor = RelationDecor.NONE;
		this.rightDecor = RelationDecor.NONE;
		this.lineStyle = LineStyle.SOLID;
		this.label = null;                 // Center label (: label)
		this.leftLabel = null;             // Source-side label ("label" before arrow)
		this.rightLabel = null;            // Target-side label ("label" after arrow)
		this.leftQualifier = null;         // [qualifier] at source
		this.rightQualifier = null;        // [qualifier] at target
		this.direction = Direction.NONE;   // Layout hint
		this.color = null;
	}
}

class Package {
	constructor(name, parentPath) {
		this.name = name;
		this.path = parentPath ? `${parentPath}.${name}` : name;
		this.color = null;
		this.entities = [];                // Entity codes in this package
		this.subPackages = [];             // Nested Package objects
	}
}

class Note {
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

class ClassDiagram {
	constructor() {
		this.title = null;
		this.entities = new Map();         // code → ClassEntity
		this.links = [];                   // Ordered Relationship array
		this.packages = [];                // Top-level Package array
		this.notes = [];                   // Array of Note objects
		this.togetherGroups = [];           // Array of arrays of entity codes
		this.hiddenMembers = new Map();     // entityCode → Set of hidden categories
	}

	addEntity(entity) {
		if (!this.entities.has(entity.code)) {
			this.entities.set(entity.code, entity);
		}
		return this.entities.get(entity.code);
	}

	getOrCreateEntity(code, displayName) {
		if (!this.entities.has(code)) {
			this.addEntity(new ClassEntity(code, displayName || code));
		}
		return this.entities.get(code);
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
	EntityType,
	Visibility,
	MemberType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	SeparatorStyle,

	// Model classes
	ClassEntity,
	Member,
	Separator,
	Relationship,
	Package,
	Note,
	ClassDiagram
};
