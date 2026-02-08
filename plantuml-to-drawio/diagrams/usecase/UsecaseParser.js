/**
 * UsecaseParser.js
 *
 * Line-by-line parser for PlantUML usecase diagrams.
 * Populates a UsecaseDiagram model from raw PlantUML text.
 *
 * Parsing approach mirrors PlantUML's own command classes under
 * net/sourceforge/plantuml/descdiagram/command/.
 *
 * Usecase diagrams in PlantUML are handled by the "description diagram"
 * infrastructure, which also handles component and deployment diagrams.
 * The key usecase-specific features are:
 *   - :Actor Name: shorthand → creates actor
 *   - (Use Case Name) shorthand → creates usecase
 *   - actor / usecase keyword declarations
 *   - package/rectangle/frame containers for system boundaries
 */

import {
	ElementType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	DiagramDirection,
	CONTAINER_KEYWORD_MAP,
	UsecaseElement,
	UsecaseRelationship,
	UsecaseContainer,
	UsecaseNote,
	UsecaseDiagram,
} from './UsecaseModel.js';

// ── Identifier patterns ────────────────────────────────────────────────────

// Standard identifier: word chars with dots
const IDENT = '(?:[\\w][\\w.]*)';
// Quoted identifier: "..."
const QUOTED_IDENT = '(?:"[^"]+")';
// Actor shorthand: :Name: or :Name:/
const ACTOR_SHORTHAND_IDENT = '(?::[^:]+:/?)'
// Usecase shorthand: (Name) or (Name)/
const USECASE_SHORTHAND_IDENT = '(?:\\([^)]+\\)/?)'
// Any identifier form usable in links
const ANY_IDENT = `(?:${QUOTED_IDENT}|${ACTOR_SHORTHAND_IDENT}|${USECASE_SHORTHAND_IDENT}|${IDENT})`;

// ── Stereotype pattern ─────────────────────────────────────────────────────

const STEREO_PATTERN = /<<([^>]+)>>/g;

// ── Color pattern ──────────────────────────────────────────────────────────

const COLOR_PATTERN = /#([a-zA-Z0-9]+)/;

// ── Container keyword regex ────────────────────────────────────────────────

const CONTAINER_KEYWORDS_PATTERN = Object.keys(CONTAINER_KEYWORD_MAP)
	.sort((a, b) => b.length - a.length)
	.join('|');

// ── Left-side link decorators ──────────────────────────────────────────────
// Order matters: try longer patterns first (duplicated from ClassParser)
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

// ── Right-side link decorators ─────────────────────────────────────────────
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

// Build regex patterns for link decorators
const LEFT_DECOR_REGEX = LEFT_DECORS
	.map(([s]) => s.replace(/([|{}().*+?^$\\[\]])/g, '\\$1'))
	.join('|');

const RIGHT_DECOR_REGEX = RIGHT_DECORS
	.map(([s]) => s.replace(/([|{}().*+?^$\\[\]])/g, '\\$1'))
	.join('|');

// ── Parser states ──────────────────────────────────────────────────────────

const State = Object.freeze({
	NORMAL:         'normal',
	MULTILINE_NOTE: 'multiline_note',
});

// ── Parser class ───────────────────────────────────────────────────────────

class UsecaseParser {
	constructor() {
		this.diagram = null;
		this.state = State.NORMAL;
		this.containerStack = [];          // Stack for nested containers
		this.multiLineNote = null;         // Note being built
		this.multiLineNoteLines = [];      // Lines of multi-line note
		this.togetherGroup = null;         // Current together group
		this.lineNumber = 0;
	}

	/**
	 * Parse PlantUML usecase diagram text into a UsecaseDiagram model.
	 * @param {string} text - Raw PlantUML text
	 * @returns {UsecaseDiagram}
	 */
	parse(text) {
		this.diagram = new UsecaseDiagram();
		this.state = State.NORMAL;
		this.containerStack = [];
		this.multiLineNote = null;
		this.multiLineNoteLines = [];
		this.togetherGroup = null;
		this.lineNumber = 0;

		const lines = text.split('\n');

		for (const rawLine of lines) {
			this.lineNumber++;
			const line = rawLine.trim();

			// Skip empty lines
			if (line === '') continue;

			// Skip single-line comments
			if (line.startsWith("'")) continue;
			if (/^\/'.+'\/\s*$/.test(line)) continue;

			// Skip @start/@end delimiters
			if (/^@start/i.test(line)) continue;
			if (/^@end/i.test(line)) continue;

			// Skip skinparam
			if (/^skinparam\b/i.test(line)) continue;

			// State-specific handling
			if (this.state === State.MULTILINE_NOTE) {
				if (this._handleMultiLineNoteEnd(line)) continue;
				this.multiLineNoteLines.push(rawLine.trimEnd());
				continue;
			}

			// Top-level parsing (priority order)
			if (this._parseTitle(line)) continue;
			if (this._parseDirection(line)) continue;
			if (this._parseTogetherStart(line)) continue;
			if (this._parseTogetherEnd(line)) continue;
			if (this._parseContainerStart(line)) continue;
			if (this._parseContainerEnd(line)) continue;
			if (this._parseHideShow(line)) continue;
			if (this._parseActorDeclaration(line)) continue;
			if (this._parseUsecaseDeclaration(line)) continue;
			if (this._parseNoteSingleLine(line)) continue;
			if (this._parseFloatingNote(line)) continue;
			if (this._parseNoteOnLink(line)) continue;
			if (this._parseNoteMultiLine(line)) continue;
			if (this._parseLink(line)) continue;
			if (this._parseActorShorthandStandalone(line)) continue;
			if (this._parseUsecaseShorthandStandalone(line)) continue;
		}

		return this.diagram;
	}

	// ── Title ────────────────────────────────────────────────────────────

	_parseTitle(line) {
		const m = line.match(/^title\s+(.+)$/i);
		if (m === null) return false;
		this.diagram.title = m[1].trim();
		return true;
	}

	// ── Direction ────────────────────────────────────────────────────────

	_parseDirection(line) {
		if (/^left\s+to\s+right\s+direction$/i.test(line)) {
			this.diagram.direction = DiagramDirection.LEFT_TO_RIGHT;
			return true;
		}
		if (/^top\s+to\s+bottom\s+direction$/i.test(line)) {
			this.diagram.direction = DiagramDirection.TOP_TO_BOTTOM;
			return true;
		}
		return false;
	}

	// ── Together grouping ────────────────────────────────────────────────

	_parseTogetherStart(line) {
		if (/^together\s*\{/.test(line)) {
			this.togetherGroup = [];
			return true;
		}
		return false;
	}

	_parseTogetherEnd(line) {
		if (this.togetherGroup !== null && line === '}') {
			if (this.togetherGroup.length > 0) {
				this.diagram.togetherGroups.push(this.togetherGroup);
			}
			this.togetherGroup = null;
			return true;
		}
		return false;
	}

	// ── Containers ───────────────────────────────────────────────────────

	_parseContainerStart(line) {
		const re = new RegExp(
			'^(' + CONTAINER_KEYWORDS_PATTERN + ')\\s+' +
			'(?:' +
				'"([^"]+)"\\s+as\\s+(\\w[\\w.]*)' +   // "Display Name" as Code
				'|' +
				'"([^"]+)"' +                           // "Display Name" (code = cleaned name)
				'|' +
				'(\\w[\\w.]*)' +                        // Code alone
			')' +
			'(?:\\s*(<<[^>]+>>))?' +                   // Optional stereotype
			'(?:\\s*(#[a-zA-Z0-9]+))?' +               // Optional color
			'\\s*\\{\\s*$',                            // Opening brace required
			'i'
		);

		const m = line.match(re);
		if (m === null) return false;

		const keyword = m[1].toLowerCase();
		const type = CONTAINER_KEYWORD_MAP[keyword] || ElementType.PACKAGE;
		const displayName = m[2] || m[4] || m[5];
		const code = m[3] || m[5] || this._nameToCode(displayName);
		const stereotype = m[6] || null;
		const color = m[7] || null;

		const parentPath = this.containerStack.length > 0
			? this.containerStack[this.containerStack.length - 1].path
			: null;

		const container = new UsecaseContainer(displayName, code, type, parentPath);
		container.color = color;
		if (stereotype) {
			const stereoMatch = stereotype.match(/<<([^>]+)>>/);
			if (stereoMatch) {
				container.stereotypes.push(stereoMatch[1]);
			}
		}

		if (this.containerStack.length > 0) {
			this.containerStack[this.containerStack.length - 1].subContainers.push(container);
		} else {
			this.diagram.containers.push(container);
		}

		this.containerStack.push(container);
		return true;
	}

	_parseContainerEnd(line) {
		if (line === '}' && this.containerStack.length > 0) {
			this.containerStack.pop();
			return true;
		}
		return false;
	}

	// ── Hide / Show ──────────────────────────────────────────────────────

	_parseHideShow(line) {
		if (/^(hide|show)\s+/i.test(line)) {
			// Parsed but not acted upon (deferred feature)
			return true;
		}
		return false;
	}

	// ── Actor declarations ───────────────────────────────────────────────

	_parseActorDeclaration(line) {
		// actor/ "Display" as Code | actor/ Code | actor "Display" as Code | actor Code
		const re = /^(actor\/|actor)\s+(?:"([^"]+)"\s+as\s+(\w[\w.]*)|(\w[\w.]*)(?:\s+as\s+"([^"]+)")?)(?:\s*(<<[^>]+>>))?(?:\s*(#[a-zA-Z0-9]+))?\s*$/i;
		const m = line.match(re);
		if (m === null) return false;

		const keyword = m[1].toLowerCase();
		const isBusiness = keyword === 'actor/';
		const type = isBusiness ? ElementType.ACTOR_BUSINESS : ElementType.ACTOR;

		let displayName, code;
		if (m[2] && m[3]) {
			// "Display Name" as Code
			displayName = m[2];
			code = m[3];
		} else if (m[4] && m[5]) {
			// Code as "Display Name"
			code = m[4];
			displayName = m[5];
		} else if (m[4]) {
			// Code alone
			code = m[4];
			displayName = m[4];
		} else {
			return false;
		}

		const element = new UsecaseElement(code, displayName, type);

		// Parse stereotype
		if (m[6]) {
			const stereoMatch = m[6].match(/<<([^>]+)>>/);
			if (stereoMatch) {
				element.stereotypes.push(stereoMatch[1]);
			}
		}

		// Parse color
		if (m[7]) {
			element.color = m[7];
		}

		// Assign to current container
		this._assignToContainer(element);

		this.diagram.addElement(element);
		if (this.togetherGroup !== null) {
			this.togetherGroup.push(code);
		}

		return true;
	}

	// ── Usecase declarations ─────────────────────────────────────────────

	_parseUsecaseDeclaration(line) {
		// usecase/ "Display" as Code | usecase/ Code | usecase "Display" as Code | usecase Code
		// Also handle: usecase (Display Name) as Code
		const re = /^(usecase\/|usecase)\s+(?:"([^"]+)"\s+as\s+(\w[\w.]*)|(\w[\w.]*)(?:\s+as\s+"([^"]+)")?|\(([^)]+)\)\s+as\s+(\w[\w.]*))(?:\s*(<<[^>]+>>))?(?:\s*(#[a-zA-Z0-9]+))?\s*$/i;
		const m = line.match(re);
		if (m === null) return false;

		const keyword = m[1].toLowerCase();
		const isBusiness = keyword === 'usecase/';
		const type = isBusiness ? ElementType.USECASE_BUSINESS : ElementType.USECASE;

		let displayName, code;
		if (m[2] && m[3]) {
			// "Display Name" as Code
			displayName = m[2];
			code = m[3];
		} else if (m[4] && m[5]) {
			// Code as "Display Name"
			code = m[4];
			displayName = m[5];
		} else if (m[6] && m[7]) {
			// (Display Name) as Code
			displayName = m[6];
			code = m[7];
		} else if (m[4]) {
			// Code alone
			code = m[4];
			displayName = m[4];
		} else {
			return false;
		}

		const element = new UsecaseElement(code, displayName, type);

		// Parse stereotype
		if (m[8]) {
			const stereoMatch = m[8].match(/<<([^>]+)>>/);
			if (stereoMatch) {
				element.stereotypes.push(stereoMatch[1]);
			}
		}

		// Parse color
		if (m[9]) {
			element.color = m[9];
		}

		// Assign to current container
		this._assignToContainer(element);

		this.diagram.addElement(element);
		if (this.togetherGroup !== null) {
			this.togetherGroup.push(code);
		}

		return true;
	}

	// ── Standalone shorthand (not in a link) ─────────────────────────────

	_parseActorShorthandStandalone(line) {
		// :Actor Name: or :Actor Name:/
		const m = line.match(/^:([^:]+):(\/)?(?:\s*(<<[^>]+>>))?(?:\s*(#[a-zA-Z0-9]+))?\s*$/);
		if (m === null) return false;

		const displayName = m[1].trim();
		const code = this._nameToCode(displayName);
		const isBusiness = m[2] === '/';
		const type = isBusiness ? ElementType.ACTOR_BUSINESS : ElementType.ACTOR;

		const element = new UsecaseElement(code, displayName, type);

		if (m[3]) {
			const stereoMatch = m[3].match(/<<([^>]+)>>/);
			if (stereoMatch) {
				element.stereotypes.push(stereoMatch[1]);
			}
		}
		if (m[4]) {
			element.color = m[4];
		}

		this._assignToContainer(element);
		this.diagram.addElement(element);
		if (this.togetherGroup !== null) {
			this.togetherGroup.push(code);
		}

		return true;
	}

	_parseUsecaseShorthandStandalone(line) {
		// (Use Case Name) or (Use Case Name)/
		const m = line.match(/^\(([^)]+)\)(\/)?(?:\s*(<<[^>]+>>))?(?:\s*(#[a-zA-Z0-9]+))?\s*$/);
		if (m === null) return false;

		const displayName = m[1].trim();
		const code = this._nameToCode(displayName);
		const isBusiness = m[2] === '/';
		const type = isBusiness ? ElementType.USECASE_BUSINESS : ElementType.USECASE;

		const element = new UsecaseElement(code, displayName, type);

		if (m[3]) {
			const stereoMatch = m[3].match(/<<([^>]+)>>/);
			if (stereoMatch) {
				element.stereotypes.push(stereoMatch[1]);
			}
		}
		if (m[4]) {
			element.color = m[4];
		}

		this._assignToContainer(element);
		this.diagram.addElement(element);
		if (this.togetherGroup !== null) {
			this.togetherGroup.push(code);
		}

		return true;
	}

	// ── Link parsing ─────────────────────────────────────────────────────

	_parseLink(line) {
		// Strategy: find the arrow body in the line, then parse entities on each side.
		// Entity patterns include :Actor:, (UseCase), "Quoted", and plain identifiers.
		// Arrow structure: Entity1 ["label"] [leftDecor] bodyChars [style] [direction] bodyChars [rightDecor] ["label"] Entity2 [: label]
		const linkRegex = new RegExp(
			'^' +
			'(' + ANY_IDENT + ')' +                // Entity 1
			'(?:\\s+"([^"]+)")?' +                  // Optional left label
			'\\s*' +
			'(' + LEFT_DECOR_REGEX + ')?' +         // Optional left decorator
			'(-+|\\.+|=+|~+)' +                    // First body chars (mandatory)
			'(?:\\[([^\\]]+)\\])?' +                 // Optional style [#color]
			'(?:' +
				'(' +                                 // Optional direction
					'left|right|up|down|le?|ri?|up?|do?' +
				')' +
				'(?:\\[([^\\]]+)\\])?' +               // Optional style after direction
			')?' +
			'(-+|\\.+|=+|~+)?' +                    // Optional second body chars
			'(' + RIGHT_DECOR_REGEX + ')?' +         // Optional right decorator
			'\\s*' +
			'(?:"([^"]+)"\\s*)?' +                   // Optional right label
			'\\s*' +
			'(' + ANY_IDENT + ')' +                  // Entity 2
			'(?:\\s*:\\s*(.+))?' +                    // Optional : label
			'$'
		);

		const m = line.match(linkRegex);
		if (m === null) return false;

		const entity1Raw = m[1];
		const leftLabel = m[2] || null;
		const leftDecorStr = m[3] || '';
		const bodyChars1 = m[4];
		const styleStr1 = m[5] || null;
		const directionStr = m[6] || null;
		const styleStr2 = m[7] || null;
		const bodyChars2 = m[8] || null;
		const rightDecorStr = m[9] || '';
		const rightLabel = m[10] || null;
		const entity2Raw = m[11];
		const label = m[12] ? m[12].trim() : null;

		// Resolve entity references (strip shorthand delimiters, auto-create)
		const entity1Code = this._resolveEntityRef(entity1Raw);
		const entity2Code = this._resolveEntityRef(entity2Raw);

		const link = new UsecaseRelationship(entity1Code, entity2Code);
		link.leftDecor = this._mapLeftDecor(leftDecorStr);
		link.rightDecor = this._mapRightDecor(rightDecorStr);
		link.lineStyle = this._mapLineStyle(bodyChars1);
		link.label = label;
		link.leftLabel = leftLabel;
		link.rightLabel = rightLabel;

		// Direction
		if (directionStr) {
			link.direction = this._mapDirection(directionStr);
		}

		// Color from style brackets
		const styleStr = styleStr1 || styleStr2;
		if (styleStr) {
			const colorMatch = styleStr.match(/#([a-zA-Z0-9]+)/);
			if (colorMatch) {
				link.color = '#' + colorMatch[1];
			}
			if (/dashed/i.test(styleStr)) {
				link.lineStyle = LineStyle.DASHED;
			}
			if (/bold/i.test(styleStr)) {
				link.lineStyle = LineStyle.BOLD;
			}
		}

		this.diagram.addLink(link);
		return true;
	}

	// ── Notes ────────────────────────────────────────────────────────────

	_parseNoteSingleLine(line) {
		// note left of Entity : text
		// Entity can be :Actor:, (UseCase), "Quoted", or plain identifier
		const m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(.+?)\s*:\s*(.+)$/i);
		if (m === null) return false;

		const entityRef = m[2].trim();
		const entityCode = this._resolveEntityRef(entityRef, false);

		const note = new UsecaseNote(this._mapNotePosition(m[1]), m[3].trim());
		note.entityCode = entityCode;
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteMultiLine(line) {
		// note left of Entity [#color]
		const m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(.+?)(?:\s+(#\w+))?\s*$/i);
		if (m === null) return false;

		const entityRef = m[2].trim();
		const entityCode = this._resolveEntityRef(entityRef, false);

		this.multiLineNote = new UsecaseNote(this._mapNotePosition(m[1]), '');
		this.multiLineNote.entityCode = entityCode;
		if (m[3]) this.multiLineNote.color = m[3];
		this.multiLineNoteLines = [];
		this.state = State.MULTILINE_NOTE;
		return true;
	}

	_parseFloatingNote(line) {
		// note "text" as Alias [#color]
		const m = line.match(/^note\s+"([^"]+)"\s+as\s+(\w+)(?:\s+(#\w+))?\s*$/i);
		if (m === null) return false;

		const note = new UsecaseNote(NotePosition.RIGHT, m[1]);
		note.alias = m[2];
		if (m[3]) note.color = m[3];
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteOnLink(line) {
		// note on link : text
		const m = line.match(/^note\s+on\s+link\s*:\s*(.+)$/i);
		if (m === null) return false;

		const note = new UsecaseNote(NotePosition.RIGHT, m[1].trim());
		note.isOnLink = true;
		if (this.diagram.links.length > 0) {
			note.linkIndex = this.diagram.links.length - 1;
		}
		this.diagram.addNote(note);
		return true;
	}

	_handleMultiLineNoteEnd(line) {
		if (!/^end\s*note$/i.test(line)) return false;

		this.multiLineNote.text = this.multiLineNoteLines.join('\n');
		this.diagram.addNote(this.multiLineNote);
		this.multiLineNote = null;
		this.multiLineNoteLines = [];
		this.state = State.NORMAL;
		return true;
	}

	// ── Entity reference resolution ──────────────────────────────────────

	/**
	 * Resolve an entity reference string to a code, auto-creating the
	 * element if it doesn't exist.
	 *
	 * Handles:
	 *   :Actor Name:   → code "ActorName", type ACTOR
	 *   :Actor Name:/  → code "ActorName", type ACTOR_BUSINESS
	 *   (Use Case)     → code "UseCase", type USECASE
	 *   (Use Case)/    → code "UseCase", type USECASE_BUSINESS
	 *   "Quoted Name"  → code "QuotedName"
	 *   PlainName      → code "PlainName"
	 *
	 * @param {string} raw - Raw entity reference from the link regex
	 * @param {boolean} [autoCreate=true] - Whether to auto-create the element
	 * @returns {string} The resolved code
	 */
	_resolveEntityRef(raw, autoCreate) {
		if (autoCreate === undefined) autoCreate = true;

		// :Actor Name: or :Actor Name:/
		const actorMatch = raw.match(/^:([^:]+):(\/)?$/);
		if (actorMatch) {
			const displayName = actorMatch[1].trim();
			const code = this._nameToCode(displayName);
			const isBusiness = actorMatch[2] === '/';
			const type = isBusiness ? ElementType.ACTOR_BUSINESS : ElementType.ACTOR;
			if (autoCreate) {
				this.diagram.getOrCreateElement(code, displayName, type);
			}
			return code;
		}

		// (Use Case) or (Use Case)/
		const ucMatch = raw.match(/^\(([^)]+)\)(\/)?$/);
		if (ucMatch) {
			const displayName = ucMatch[1].trim();
			const code = this._nameToCode(displayName);
			const isBusiness = ucMatch[2] === '/';
			const type = isBusiness ? ElementType.USECASE_BUSINESS : ElementType.USECASE;
			if (autoCreate) {
				this.diagram.getOrCreateElement(code, displayName, type);
			}
			return code;
		}

		// "Quoted Name"
		const quotedMatch = raw.match(/^"([^"]+)"$/);
		if (quotedMatch) {
			const displayName = quotedMatch[1];
			const code = this._nameToCode(displayName);
			if (autoCreate) {
				this.diagram.getOrCreateElement(code, displayName);
			}
			return code;
		}

		// Plain identifier
		if (autoCreate) {
			this.diagram.getOrCreateElement(raw, raw);
		}
		return raw;
	}

	// ── Container assignment ─────────────────────────────────────────────

	_assignToContainer(element) {
		if (this.containerStack.length > 0) {
			const currentContainer = this.containerStack[this.containerStack.length - 1];
			element.containerPath = currentContainer.path;
			currentContainer.elements.push(element.code);
		}
	}

	// ── Utility methods ──────────────────────────────────────────────────

	/**
	 * Convert a display name to a code identifier.
	 * Strips spaces and special characters, keeping word characters.
	 */
	_nameToCode(name) {
		return name.replace(/\s+/g, '').replace(/[^\w.]/g, '');
	}

	_stripQuotes(str) {
		if (str && str.startsWith('"') && str.endsWith('"')) {
			return str.slice(1, -1);
		}
		return str;
	}

	_mapLeftDecor(str) {
		if (!str) return RelationDecor.NONE;
		for (const [pattern, decor] of LEFT_DECORS) {
			if (str === pattern) return decor;
		}
		return RelationDecor.NONE;
	}

	_mapRightDecor(str) {
		if (!str) return RelationDecor.NONE;
		for (const [pattern, decor] of RIGHT_DECORS) {
			if (str === pattern) return decor;
		}
		return RelationDecor.NONE;
	}

	_mapLineStyle(bodyChars) {
		if (!bodyChars) return LineStyle.SOLID;
		const first = bodyChars[0];
		if (first === '.') return LineStyle.DASHED;
		if (first === '=') return LineStyle.BOLD;
		if (first === '~') return LineStyle.DOTTED;
		return LineStyle.SOLID;
	}

	_mapDirection(str) {
		if (!str) return Direction.NONE;
		const lower = str.toLowerCase();
		if (lower === 'left'  || lower === 'l'  || lower === 'le') return Direction.LEFT;
		if (lower === 'right' || lower === 'r'  || lower === 'ri') return Direction.RIGHT;
		if (lower === 'up'    || lower === 'u'  || lower === 'up') return Direction.UP;
		if (lower === 'down'  || lower === 'd'  || lower === 'do') return Direction.DOWN;
		return Direction.NONE;
	}

	_mapNotePosition(str) {
		switch (str.toLowerCase()) {
			case 'left':   return NotePosition.LEFT;
			case 'right':  return NotePosition.RIGHT;
			case 'top':    return NotePosition.TOP;
			case 'bottom': return NotePosition.BOTTOM;
			default:       return NotePosition.RIGHT;
		}
	}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse PlantUML usecase diagram text into a UsecaseDiagram model.
 * @param {string} text - Raw PlantUML text
 * @returns {UsecaseDiagram}
 */
export function parseUsecaseDiagram(text) {
	const parser = new UsecaseParser();
	return parser.parse(text);
}

export { UsecaseParser };
