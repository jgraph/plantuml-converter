/**
 * Shared enums and constants for PlantUML "description diagram" types.
 *
 * Component, deployment, and usecase diagrams all share the same
 * underlying DescriptionDiagram infrastructure in PlantUML. These
 * shared enums are the common vocabulary for parsers and emitters.
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
	INTERFACE:         'interface',
	ARTIFACT:          'artifact',
	PORT:              'port',
	PORTIN:            'portin',
	PORTOUT:           'portout',
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
 * These keywords can appear as grouping containers with { }.
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
	'artifact':   ElementType.ARTIFACT,
});

// ── Link decorator tables ──────────────────────────────────────────────────

/**
 * Left-side (source) link decorators, ordered longest-first for matching.
 */
const LEFT_DECORS = [
	['<|',  RelationDecor.EXTENDS],
	['<<',  RelationDecor.ARROW_TRIANGLE],
	['}o',  RelationDecor.CIRCLE_CROWFOOT],
	['}|',  RelationDecor.LINE_CROWFOOT],
	['}',   RelationDecor.CROWFOOT],
	['|o',  RelationDecor.CIRCLE_LINE],
	['||',  RelationDecor.DOUBLE_LINE],
	['0)',  RelationDecor.CIRCLE_CONNECT],
	['0',   RelationDecor.CIRCLE],
	['@',   RelationDecor.CIRCLE_FILL],
	[')',   RelationDecor.PARENTHESIS],
	['<',   RelationDecor.ARROW],
	['*',   RelationDecor.COMPOSITION],
	['o',   RelationDecor.AGGREGATION],
	['x',   RelationDecor.NOT_NAVIGABLE],
	['#',   RelationDecor.SQUARE],
	['+',   RelationDecor.PLUS],
	['^',   RelationDecor.EXTENDS],
];

/**
 * Right-side (target) link decorators, ordered longest-first for matching.
 */
const RIGHT_DECORS = [
	['|>',  RelationDecor.EXTENDS],
	['>>',  RelationDecor.ARROW_TRIANGLE],
	['o{',  RelationDecor.CIRCLE_CROWFOOT],
	['|{',  RelationDecor.LINE_CROWFOOT],
	['{',   RelationDecor.CROWFOOT],
	['o|',  RelationDecor.CIRCLE_LINE],
	['||',  RelationDecor.DOUBLE_LINE],
	['(0',  RelationDecor.CIRCLE_CONNECT],
	['0',   RelationDecor.CIRCLE],
	['@',   RelationDecor.CIRCLE_FILL],
	['(',   RelationDecor.PARENTHESIS],
	['>',   RelationDecor.ARROW],
	['*',   RelationDecor.COMPOSITION],
	['o',   RelationDecor.AGGREGATION],
	['x',   RelationDecor.NOT_NAVIGABLE],
	['#',   RelationDecor.SQUARE],
	['+',   RelationDecor.PLUS],
	['^',   RelationDecor.EXTENDS],
	['//',  RelationDecor.HALF_ARROW_DOWN],
	['\\\\', RelationDecor.HALF_ARROW_UP],
];

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

	// Decorator tables
	LEFT_DECORS,
	RIGHT_DECORS,
};
