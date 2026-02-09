/**
 * ComponentParser.js
 *
 * Line-by-line parser for PlantUML component and deployment diagrams.
 * Populates a ComponentDiagram model from raw PlantUML text.
 *
 * Both component and deployment diagrams use PlantUML's DescriptionDiagram
 * infrastructure. The key extensions beyond usecase are:
 *   - [Component Name] bracket shorthand → creates component
 *   - () Interface shorthand → creates interface
 *   - Unified keyword declarations for 30+ element types
 *   - Ports (portin, portout, port) inside component containers
 *   - Multi-line element declarations
 */

import {
	ElementType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	DiagramDirection,
	CONTAINER_KEYWORD_MAP,
	LEFT_DECORS,
	RIGHT_DECORS,
} from '../../common/DescriptionModel.js';

import {
	ComponentElement,
	ComponentRelationship,
	ComponentContainer,
	ComponentNote,
	ComponentDiagram,
} from './ComponentModel.js';

// ── Element keyword map ───────────────────────────────────────────────────

/**
 * Maps PlantUML element keywords to ElementType values.
 * Sorted longest-first at regex construction time.
 */
const ELEMENT_KEYWORD_MAP = Object.freeze({
	'person':      ElementType.PERSON,
	'artifact':    ElementType.ARTIFACT,
	'actor/':      ElementType.ACTOR_BUSINESS,
	'actor':       ElementType.ACTOR,
	'folder':      ElementType.FOLDER,
	'card':        ElementType.CARD,
	'file':        ElementType.FILE,
	'package':     ElementType.PACKAGE,
	'rectangle':   ElementType.RECTANGLE,
	'hexagon':     ElementType.HEXAGON,
	'label':       ElementType.LABEL,
	'node':        ElementType.NODE,
	'frame':       ElementType.FRAME,
	'cloud':       ElementType.CLOUD,
	'database':    ElementType.DATABASE,
	'queue':       ElementType.QUEUE,
	'stack':       ElementType.STACK,
	'storage':     ElementType.STORAGE,
	'agent':       ElementType.AGENT,
	'usecase/':    ElementType.USECASE_BUSINESS,
	'usecase':     ElementType.USECASE,
	'component':   ElementType.COMPONENT,
	'boundary':    ElementType.BOUNDARY,
	'control':     ElementType.CONTROL,
	'entity':      ElementType.ENTITY_DESC,
	'interface':   ElementType.INTERFACE,
	'circle':      ElementType.INTERFACE,
	'collections': ElementType.COLLECTIONS,
	'port':        ElementType.PORT,
	'portin':      ElementType.PORTIN,
	'portout':     ElementType.PORTOUT,
});

const ELEMENT_KEYWORDS_PATTERN = Object.keys(ELEMENT_KEYWORD_MAP)
	.sort((a, b) => b.length - a.length)
	.join('|');

// ── Identifier patterns ────────────────────────────────────────────────────

const IDENT = '(?:[\\w][\\w.]*)';
const QUOTED_IDENT = '(?:"[^"]+")';
const COMPONENT_SHORTHAND_IDENT = '(?:\\[[^\\[\\]]+\\])';
const ACTOR_SHORTHAND_IDENT = '(?::[^:]+:/?)';
const USECASE_SHORTHAND_IDENT = '(?:\\([^)]+\\)/?)';
const INTERFACE_SHORTHAND_IDENT = '(?:\\(\\)\\s*[\\w][\\w.]*)';
const INTERFACE_SHORTHAND_QUOTED_IDENT = '(?:\\(\\)\\s*"[^"]+")';
const ANY_IDENT = `(?:${QUOTED_IDENT}|${COMPONENT_SHORTHAND_IDENT}|${ACTOR_SHORTHAND_IDENT}|${USECASE_SHORTHAND_IDENT}|${INTERFACE_SHORTHAND_QUOTED_IDENT}|${INTERFACE_SHORTHAND_IDENT}|${IDENT})`;

// ── Container keyword regex ────────────────────────────────────────────────

const CONTAINER_KEYWORDS_PATTERN = Object.keys(CONTAINER_KEYWORD_MAP)
	.sort((a, b) => b.length - a.length)
	.join('|');

// ── Build decorator regex patterns ─────────────────────────────────────────

const LEFT_DECOR_REGEX = LEFT_DECORS
	.map(([s]) => s.replace(/([|{}().*+?^$\\[\]])/g, '\\$1'))
	.join('|');

const RIGHT_DECOR_REGEX = RIGHT_DECORS
	.map(([s]) => s.replace(/([|{}().*+?^$\\[\]])/g, '\\$1'))
	.join('|');

// ── Parser states ──────────────────────────────────────────────────────────

const State = Object.freeze({
	NORMAL:                    'normal',
	MULTILINE_NOTE:            'multiline_note',
	MULTILINE_ELEMENT_QUOTE:   'multiline_element_quote',
	MULTILINE_ELEMENT_BRACKET: 'multiline_element_bracket',
});

// ── Parser class ───────────────────────────────────────────────────────────

class ComponentParser {
	constructor() {
		this.diagram = null;
		this.state = State.NORMAL;
		this.containerStack = [];
		this.multiLineNote = null;
		this.multiLineNoteLines = [];
		this.multiLineElement = null;       // Element being built in multi-line mode
		this.multiLineDesc = [];            // Accumulated description lines
		this.togetherGroup = null;
		this.lineNumber = 0;
	}

	/**
	 * Parse PlantUML component/deployment diagram text into a ComponentDiagram model.
	 * @param {string} text - Raw PlantUML text
	 * @returns {ComponentDiagram}
	 */
	parse(text) {
		this.diagram = new ComponentDiagram();
		this.state = State.NORMAL;
		this.containerStack = [];
		this.multiLineNote = null;
		this.multiLineNoteLines = [];
		this.multiLineElement = null;
		this.multiLineDesc = [];
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
			if (this.state === State.MULTILINE_ELEMENT_QUOTE) {
				if (this._handleMultiLineElementQuoteEnd(line)) continue;
				this.multiLineDesc.push(rawLine.trimEnd());
				continue;
			}
			if (this.state === State.MULTILINE_ELEMENT_BRACKET) {
				if (this._handleMultiLineElementBracketEnd(line)) continue;
				this.multiLineDesc.push(rawLine.trimEnd());
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
			if (this._parseKeywordDeclaration(line)) continue;
			if (this._parseNoteSingleLine(line)) continue;
			if (this._parseFloatingNote(line)) continue;
			if (this._parseNoteOnLink(line)) continue;
			if (this._parseNoteMultiLine(line)) continue;
			if (this._parseLink(line)) continue;
			if (this._parseComponentShorthandStandalone(line)) continue;
			if (this._parseInterfaceShorthandStandalone(line)) continue;
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
				'(\\w[\\w.]*)\\s+as\\s+"([^"]+)"' +   // Code as "Display Name"
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
		const displayName = m[2] || m[5] || m[6] || m[7];
		const code = m[3] || m[4] || m[7] || this._nameToCode(displayName);
		const stereotype = m[8] || null;
		const color = m[9] || null;

		const parentPath = this.containerStack.length > 0
			? this.containerStack[this.containerStack.length - 1].path
			: null;

		const container = new ComponentContainer(displayName, code, type, parentPath);
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
		if (/^(hide|show|remove)\s+/i.test(line)) {
			return true;
		}
		return false;
	}

	// ── Unified keyword declarations ─────────────────────────────────────

	_parseKeywordDeclaration(line) {
		// Match: keyword "Display" as Code | keyword Code as "Display" | keyword Code as Code2 | keyword "Code" | keyword Code
		// Also check for multi-line start (ending with " or [)
		const re = new RegExp(
			'^(' + ELEMENT_KEYWORDS_PATTERN + ')\\s+' +
			'(?:' +
				'"([^"]+)"\\s+as\\s+(\\w[\\w.]*)' +   // "Display Name" as Code
				'|' +
				'(\\w[\\w.]*)\\s+as\\s+"([^"]+)"' +   // Code as "Display Name"
				'|' +
				'(\\w[\\w.]*)\\s+as\\s+(\\w[\\w.]*)' + // DisplayName as Code
				'|' +
				'"([^"]+)"' +                           // "Quoted Name" alone
				'|' +
				'(\\w[\\w.]*)' +                        // Code alone
			')' +
			'(?:\\s*(<<[^>]+>>))?' +                   // Optional stereotype
			'(?:\\s*(#[a-zA-Z0-9]+))?' +               // Optional color
			'\\s*$',
			'i'
		);

		const m = line.match(re);
		if (m === null) return false;

		const keyword = m[1].toLowerCase();

		// If this keyword is a container keyword and line ends with {, let container parser handle it
		// (shouldn't reach here because container parser runs first, but guard anyway)

		const type = ELEMENT_KEYWORD_MAP[keyword];
		if (!type) return false;

		let displayName, code;
		if (m[2] && m[3]) {
			displayName = m[2];
			code = m[3];
		} else if (m[4] && m[5]) {
			code = m[4];
			displayName = m[5];
		} else if (m[6] && m[7]) {
			displayName = m[6];
			code = m[7];
		} else if (m[8]) {
			displayName = m[8];
			code = this._nameToCode(m[8]);
		} else if (m[9]) {
			code = m[9];
			displayName = m[9];
		} else {
			return false;
		}

		const element = new ComponentElement(code, displayName, type);

		if (m[10]) {
			const stereoMatch = m[10].match(/<<([^>]+)>>/);
			if (stereoMatch) {
				element.stereotypes.push(stereoMatch[1]);
			}
		}

		if (m[11]) {
			element.color = m[11];
		}

		this._assignToContainer(element);
		this.diagram.addElement(element);

		if (this.togetherGroup !== null) {
			this.togetherGroup.push(code);
		}

		return true;
	}

	// ── Standalone shorthands ────────────────────────────────────────────

	_parseComponentShorthandStandalone(line) {
		// [Component Name] or ["Display Name"] as Code
		// Also: [Component Name] <<stereotype>> #color
		const m = line.match(/^\[([^\[\]]+)\](?:\s+as\s+(\w[\w.]*))?(?:\s*(<<[^>]+>>))?(?:\s*(#[a-zA-Z0-9]+))?\s*$/);
		if (m === null) return false;

		let displayName = m[1].trim();
		// Handle quoted display inside brackets: ["Display Name"]
		if (displayName.startsWith('"') && displayName.endsWith('"')) {
			displayName = displayName.slice(1, -1);
		}

		const code = m[2] || this._nameToCode(displayName);
		const element = new ComponentElement(code, displayName, ElementType.COMPONENT);

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

	_parseInterfaceShorthandStandalone(line) {
		// () InterfaceName or () "Display Name" as Code
		const m = line.match(/^\(\)\s+(?:"([^"]+)"\s+as\s+(\w[\w.]*)|"([^"]+)"|(\w[\w.]*)\s+as\s+(\w[\w.]*)|(\w[\w.]*))(?:\s*(<<[^>]+>>))?(?:\s*(#[a-zA-Z0-9]+))?\s*$/);
		if (m === null) return false;

		let displayName, code;
		if (m[1] && m[2]) {
			displayName = m[1];
			code = m[2];
		} else if (m[3]) {
			displayName = m[3];
			code = this._nameToCode(m[3]);
		} else if (m[4] && m[5]) {
			displayName = m[4];
			code = m[5];
		} else if (m[6]) {
			code = m[6];
			displayName = m[6];
		} else {
			return false;
		}

		const element = new ComponentElement(code, displayName, ElementType.INTERFACE);

		if (m[7]) {
			const stereoMatch = m[7].match(/<<([^>]+)>>/);
			if (stereoMatch) {
				element.stereotypes.push(stereoMatch[1]);
			}
		}
		if (m[8]) {
			element.color = m[8];
		}

		this._assignToContainer(element);
		this.diagram.addElement(element);

		if (this.togetherGroup !== null) {
			this.togetherGroup.push(code);
		}

		return true;
	}

	_parseActorShorthandStandalone(line) {
		// :Actor Name: or :Actor Name:/
		const m = line.match(/^:([^:]+):(\/)?(?:\s*(<<[^>]+>>))?(?:\s*(#[a-zA-Z0-9]+))?\s*$/);
		if (m === null) return false;

		const displayName = m[1].trim();
		const code = this._nameToCode(displayName);
		const isBusiness = m[2] === '/';
		const type = isBusiness ? ElementType.ACTOR_BUSINESS : ElementType.ACTOR;

		const element = new ComponentElement(code, displayName, type);

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

		const element = new ComponentElement(code, displayName, type);

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

		const entity1Code = this._resolveEntityRef(entity1Raw);
		const entity2Code = this._resolveEntityRef(entity2Raw);

		const link = new ComponentRelationship(entity1Code, entity2Code);
		link.leftDecor = this._mapLeftDecor(leftDecorStr);
		link.rightDecor = this._mapRightDecor(rightDecorStr);
		link.lineStyle = this._mapLineStyle(bodyChars1);
		link.label = label;
		link.leftLabel = leftLabel;
		link.rightLabel = rightLabel;

		if (directionStr) {
			link.direction = this._mapDirection(directionStr);
		}

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
		const m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(.+?)\s*:\s*(.+)$/i);
		if (m === null) return false;

		const entityRef = m[2].trim();
		const entityCode = this._resolveEntityRef(entityRef, false);

		const note = new ComponentNote(this._mapNotePosition(m[1]), m[3].trim());
		note.entityCode = entityCode;
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteMultiLine(line) {
		const m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(.+?)(?:\s+(#\w+))?\s*$/i);
		if (m === null) return false;

		const entityRef = m[2].trim();
		const entityCode = this._resolveEntityRef(entityRef, false);

		this.multiLineNote = new ComponentNote(this._mapNotePosition(m[1]), '');
		this.multiLineNote.entityCode = entityCode;
		if (m[3]) this.multiLineNote.color = m[3];
		this.multiLineNoteLines = [];
		this.state = State.MULTILINE_NOTE;
		return true;
	}

	_parseFloatingNote(line) {
		const m = line.match(/^note\s+"([^"]+)"\s+as\s+(\w+)(?:\s+(#\w+))?\s*$/i);
		if (m === null) return false;

		const note = new ComponentNote(NotePosition.RIGHT, m[1]);
		note.alias = m[2];
		if (m[3]) note.color = m[3];
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteOnLink(line) {
		const m = line.match(/^note\s+on\s+link\s*:\s*(.+)$/i);
		if (m === null) return false;

		const note = new ComponentNote(NotePosition.RIGHT, m[1].trim());
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

	// ── Multi-line element handling ──────────────────────────────────────

	_handleMultiLineElementQuoteEnd(line) {
		// Ends when we see a closing quote at end of line
		const m = line.match(/^(.*)"$/);
		if (m === null) {
			return false;
		}

		this.multiLineDesc.push(m[1]);
		this.multiLineElement.displayName = this.multiLineDesc.join('\n');
		this._assignToContainer(this.multiLineElement);
		this.diagram.addElement(this.multiLineElement);
		this.multiLineElement = null;
		this.multiLineDesc = [];
		this.state = State.NORMAL;
		return true;
	}

	_handleMultiLineElementBracketEnd(line) {
		// Ends when we see a closing bracket at end of line
		const m = line.match(/^([^\[\]]*)\]$/);
		if (m === null) {
			return false;
		}

		this.multiLineDesc.push(m[1]);
		this.multiLineElement.displayName = this.multiLineDesc.join('\n');
		this._assignToContainer(this.multiLineElement);
		this.diagram.addElement(this.multiLineElement);
		this.multiLineElement = null;
		this.multiLineDesc = [];
		this.state = State.NORMAL;
		return true;
	}

	// ── Entity reference resolution ──────────────────────────────────────

	/**
	 * Resolve an entity reference string to a code, auto-creating the
	 * element if it doesn't exist.
	 *
	 * Handles:
	 *   [Component Name]  → code "ComponentName", type COMPONENT
	 *   () InterfaceName   → code "InterfaceName", type INTERFACE
	 *   () "Display"       → code "Display", type INTERFACE
	 *   :Actor Name:       → code "ActorName", type ACTOR
	 *   :Actor Name:/      → code "ActorName", type ACTOR_BUSINESS
	 *   (Use Case)         → code "UseCase", type USECASE
	 *   "Quoted Name"      → code "QuotedName", type COMPONENT (default)
	 *   PlainName          → code "PlainName", type COMPONENT (default)
	 */
	_resolveEntityRef(raw, autoCreate) {
		if (autoCreate === undefined) autoCreate = true;

		// [Component Name]
		const compMatch = raw.match(/^\[([^\[\]]+)\]$/);
		if (compMatch) {
			let displayName = compMatch[1].trim();
			if (displayName.startsWith('"') && displayName.endsWith('"')) {
				displayName = displayName.slice(1, -1);
			}
			const code = this._nameToCode(displayName);
			if (autoCreate) {
				this.diagram.getOrCreateElement(code, displayName, ElementType.COMPONENT);
			}
			return code;
		}

		// () "Display Name" or () InterfaceName
		const ifaceQuotedMatch = raw.match(/^\(\)\s*"([^"]+)"$/);
		if (ifaceQuotedMatch) {
			const displayName = ifaceQuotedMatch[1];
			const code = this._nameToCode(displayName);
			if (autoCreate) {
				this.diagram.getOrCreateElement(code, displayName, ElementType.INTERFACE);
			}
			return code;
		}
		const ifaceMatch = raw.match(/^\(\)\s*([\w][\w.]*)$/);
		if (ifaceMatch) {
			const code = ifaceMatch[1];
			if (autoCreate) {
				this.diagram.getOrCreateElement(code, code, ElementType.INTERFACE);
			}
			return code;
		}

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
				this.diagram.getOrCreateElement(code, displayName, ElementType.COMPONENT);
			}
			return code;
		}

		// Plain identifier → default to COMPONENT
		if (autoCreate) {
			this.diagram.getOrCreateElement(raw, raw, ElementType.COMPONENT);
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
 * Parse PlantUML component/deployment diagram text into a ComponentDiagram model.
 * @param {string} text - Raw PlantUML text
 * @returns {ComponentDiagram}
 */
export function parseComponentDiagram(text) {
	const parser = new ComponentParser();
	return parser.parse(text);
}

export { ComponentParser };
