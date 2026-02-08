/**
 * ClassParser.js
 *
 * Line-by-line parser for PlantUML class diagrams.
 * Populates a ClassDiagram model from raw PlantUML text.
 *
 * Parsing approach mirrors PlantUML's own command classes under
 * net/sourceforge/plantuml/classdiagram/command/.
 */

import {
	EntityType,
	Visibility,
	MemberType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	SeparatorStyle,
	JsonNodeType,
	ClassEntity,
	Member,
	Separator,
	Relationship,
	Package,
	Note,
	MapEntry,
	JsonNode,
	ClassDiagram
} from './ClassModel.js';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Entity type keywords → EntityType enum.
 * Order matters for regex: "abstract class" must be tried before "abstract".
 */
const ENTITY_KEYWORD_MAP = {
	'abstract class': EntityType.ABSTRACT_CLASS,
	'static class':   EntityType.CLASS,
	'class':          EntityType.CLASS,
	'interface':      EntityType.INTERFACE,
	'enum':           EntityType.ENUM,
	'annotation':     EntityType.ANNOTATION,
	'entity':         EntityType.ENTITY,
	'protocol':       EntityType.PROTOCOL,
	'struct':         EntityType.STRUCT,
	'exception':      EntityType.EXCEPTION,
	'metaclass':      EntityType.METACLASS,
	'stereotype':     EntityType.STEREOTYPE_TYPE,
	'dataclass':      EntityType.DATACLASS,
	'record':         EntityType.RECORD,
	'abstract':       EntityType.ABSTRACT_CLASS,
	'circle':         EntityType.CIRCLE,
	'diamond':        EntityType.DIAMOND,
	'object':         EntityType.OBJECT,
	'map':            EntityType.MAP,
	'json':           EntityType.JSON
};

// Build a regex alternation from keywords (longest first to avoid prefix matches)
const ENTITY_KEYWORDS_PATTERN = Object.keys(ENTITY_KEYWORD_MAP)
	.sort((a, b) => b.length - a.length)
	.join('|');

// ── Regex patterns ─────────────────────────────────────────────────────────

// Identifier: word chars with dots/colons for namespaces, or a quoted string
const IDENT = '(?:[\\w][\\w.:]*)';
const QUOTED_IDENT = '(?:"[^"]+")';
const ANY_IDENT = `(?:${QUOTED_IDENT}|${IDENT})`;

// Stereotype: <<text>>
const STEREO_PATTERN = /<<([^>]+)>>/g;

// Color: #colorname or #RRGGBB
const COLOR_PATTERN = /(#[a-zA-Z0-9]+)/;

// Generic parameters: <...> (greedy but balanced)
const GENERIC_PATTERN = /<([^>]+)>/;

// ── Left-side link decorators ──────────────────────────────────────────────
// Order matters: try longer patterns first
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

// Direction keywords in link bodies
const DIRECTION_KEYWORDS = /^(?:left|right|up|down|le?|ri?|up?|do?)$/i;

// ── Parser states ──────────────────────────────────────────────────────────

const State = Object.freeze({
	NORMAL:         'normal',
	ENTITY_BODY:    'entity_body',
	MULTILINE_NOTE: 'multiline_note',
	TOGETHER:       'together',
	MAP_BODY:       'map_body',
	JSON_BODY:      'json_body',
});

// ── Parser class ───────────────────────────────────────────────────────────

class ClassParser {
	constructor() {
		this.diagram = null;
		this.state = State.NORMAL;
		this.currentEntity = null;          // Entity being built (body mode)
		this.packageStack = [];             // Stack for nested packages
		this.multiLineNote = null;          // Note being built
		this.multiLineNoteLines = [];       // Lines of multi-line note
		this.togetherGroup = null;          // Current together group
		this.lineNumber = 0;
		this.jsonBraceDepth = 0;            // Brace nesting depth for JSON body
		this.jsonBodyLines = [];            // Collected JSON body lines
	}

	/**
	 * Parse PlantUML class diagram text into a ClassDiagram model.
	 * @param {string} text - Raw PlantUML text
	 * @returns {ClassDiagram}
	 */
	parse(text) {
		this.diagram = new ClassDiagram();
		this.state = State.NORMAL;
		this.currentEntity = null;
		this.packageStack = [];
		this.multiLineNote = null;
		this.multiLineNoteLines = [];
		this.togetherGroup = null;
		this.lineNumber = 0;
		this.jsonBraceDepth = 0;
		this.jsonBodyLines = [];

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

			if (this.state === State.MAP_BODY) {
				if (this._parseMapBodyEnd(line)) continue;
				this._parseMapBodyLine(line);
				continue;
			}

			if (this.state === State.JSON_BODY) {
				this._parseJsonBodyLine(line);
				continue;
			}

			if (this.state === State.ENTITY_BODY) {
				if (this._parseEntityBodyEnd(line)) continue;
				this._parseBodyLine(line);
				continue;
			}

			// Top-level parsing (priority order)
			if (this._parseTitle(line)) continue;
			if (this._parseHideShow(line)) continue;
			if (this._parseRemove(line)) continue;
			if (this._parseAllowMixing(line)) continue;
			if (this._parseTogetherStart(line)) continue;
			if (this._parseTogetherEnd(line)) continue;
			if (this._parsePackageStart(line)) continue;
			if (this._parsePackageEnd(line)) continue;
			if (this._parseDiamond(line)) continue;
			if (this._parseLollipop(line)) continue;
			if (this._parseEntityDeclaration(line)) continue;
			if (this._parseLink(line)) continue;
			if (this._parseShorthandMember(line)) continue;
			if (this._parseNoteMultiLine(line)) continue;
			if (this._parseNoteSingleLine(line)) continue;
			if (this._parseFloatingNote(line)) continue;
			if (this._parseNoteOnLink(line)) continue;
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

	// ── Hide / Show / Remove ─────────────────────────────────────────────

	_parseHideShow(line) {
		const m = line.match(/^(hide|show)\s+(.+)$/i);
		if (m === null) return false;

		const action = m[1].toLowerCase();
		const what = m[2].trim();

		// Parse what is being hidden/shown
		// Could be: "ClassName methods", "ClassName fields", "members", "methods", "fields"
		// Or: "<<stereotype>> methods"
		// For now, store as a simple map entry
		const parts = what.split(/\s+/);
		if (parts.length >= 2) {
			const entityRef = parts[0];
			const category = parts.slice(1).join(' ');
			const key = entityRef;
			if (action === 'hide') {
				if (!this.diagram.hiddenMembers.has(key)) {
					this.diagram.hiddenMembers.set(key, new Set());
				}
				this.diagram.hiddenMembers.get(key).add(category);
			}
		} else {
			// Global hide/show
			if (action === 'hide') {
				if (!this.diagram.hiddenMembers.has('*')) {
					this.diagram.hiddenMembers.set('*', new Set());
				}
				this.diagram.hiddenMembers.get('*').add(what);
			}
		}
		return true;
	}

	_parseRemove(line) {
		const m = line.match(/^remove\s+(.+)$/i);
		if (m === null) return false;
		// Mark for removal — for now just track it
		return true;
	}

	// ── Allow mixing ─────────────────────────────────────────────────────

	_parseAllowMixing(line) {
		if (/^allow_?mixing$/i.test(line)) {
			this.diagram.allowMixing = true;
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

	// ── Packages ─────────────────────────────────────────────────────────

	_parsePackageStart(line) {
		const m = line.match(/^(package|namespace)\s+("([^"]+)"|(\S+))(?:\s+(#\w+))?\s*\{?\s*$/i);
		if (m === null) return false;

		const name = m[3] || m[4];
		const color = m[5] || null;
		const parentPath = this.packageStack.length > 0
			? this.packageStack[this.packageStack.length - 1].path
			: null;

		const pkg = new Package(name, parentPath);
		pkg.color = color;

		if (this.packageStack.length > 0) {
			this.packageStack[this.packageStack.length - 1].subPackages.push(pkg);
		} else {
			this.diagram.packages.push(pkg);
		}

		this.packageStack.push(pkg);
		return true;
	}

	_parsePackageEnd(line) {
		if (line === '}' && this.packageStack.length > 0) {
			this.packageStack.pop();
			return true;
		}
		return false;
	}

	// ── Diamond association ──────────────────────────────────────────────

	_parseDiamond(line) {
		const m = line.match(/^<>\s+(\w+)\s*$/);
		if (m === null) return false;

		const entity = new ClassEntity(m[1], m[1], EntityType.DIAMOND);
		this.diagram.addEntity(entity);
		return true;
	}

	// ── Lollipop notation ────────────────────────────────────────────────

	_parseLollipop(line) {
		// () "Name" as alias
		const m = line.match(/^\(\)\s+"([^"]+)"\s+as\s+(\w+)\s*$/);
		if (m === null) return false;

		const entity = new ClassEntity(m[2], m[1], EntityType.LOLLIPOP_FULL);
		this.diagram.addEntity(entity);
		return true;
	}

	// ── Entity declarations ──────────────────────────────────────────────

	_parseEntityDeclaration(line) {
		// Build pattern:
		// [abstract] (keyword) ["]name["]] [as alias] | ["name"] as alias [<generic>] [extends ...] [implements ...] [<<stereo>>] [#color] [{]
		const re = new RegExp(
			'^(' + ENTITY_KEYWORDS_PATTERN + ')\\s+' +
			'(?:' +
				'"([^"]+)"\\s+as\\s+(\\w[\\w.]*)' +   // "Display Name" as Code
				'|' +
				'(\\w[\\w.]*)' +                        // Code alone
			')' +
			'(?:\\s*<([^>]+)>)?' +                     // <generic>
			'(?:\\s+extends\\s+([\\w.,\\s"]+))?' +     // extends list
			'(?:\\s+implements\\s+([\\w.,\\s"]+))?' +   // implements list
			'(?:\\s+(' + STEREO_PATTERN.source.replace(/\/g$/, '') + '))?' + // stereotype (recomputed below)
			'(?:\\s*(#[a-zA-Z0-9]+))?' +               // color
			'(?:\\s*\\{\\s*)?$',                        // optional opening brace
			'i'
		);

		// Simpler approach: regex in stages
		return this._tryParseEntity(line);
	}

	_tryParseEntity(line) {
		// Try to match entity keyword at start
		const keywordMatch = line.match(
			new RegExp('^(' + ENTITY_KEYWORDS_PATTERN + ')\\s+', 'i')
		);
		if (keywordMatch === null) return false;

		const keyword = keywordMatch[1].toLowerCase();
		let entityType = ENTITY_KEYWORD_MAP[keyword];
		const rest = line.slice(keywordMatch[0].length);

		// Parse name: "Display Name" as Code  |  Code  |  Code as "Display Name"
		let code, displayName;
		let remaining = rest;

		const quotedAsMatch = remaining.match(/^"([^"]+)"\s+as\s+(\w[\w.]*)/);
		const codeAsQuotedMatch = remaining.match(/^(\w[\w.]*)\s+as\s+"([^"]+)"/);
		const codeOnlyMatch = remaining.match(/^(\w[\w.]*)/);

		if (quotedAsMatch) {
			displayName = quotedAsMatch[1];
			code = quotedAsMatch[2];
			remaining = remaining.slice(quotedAsMatch[0].length);
		} else if (codeAsQuotedMatch) {
			code = codeAsQuotedMatch[1];
			displayName = codeAsQuotedMatch[2];
			remaining = remaining.slice(codeAsQuotedMatch[0].length);
		} else if (codeOnlyMatch) {
			code = codeOnlyMatch[1];
			displayName = code;
			remaining = remaining.slice(codeOnlyMatch[0].length);
		} else {
			return false;
		}

		remaining = remaining.trim();

		const entity = new ClassEntity(code, displayName, entityType);

		// Parse generic parameters <T, K> — but not stereotypes <<...>>
		const genericMatch = remaining.match(/^<(?!<)([^>]+)>/);
		if (genericMatch) {
			entity.genericParams = genericMatch[1];
			remaining = remaining.slice(genericMatch[0].length).trim();
		}

		// Parse extends
		const extendsMatch = remaining.match(/^extends\s+([\w.,\s"]+?)(?=\s+implements|\s+<<|\s+#|\s*\{|\s*$)/i);
		if (extendsMatch) {
			entity.extends = extendsMatch[1].split(',').map(s => this._stripQuotes(s.trim())).filter(Boolean);
			remaining = remaining.slice(extendsMatch[0].length).trim();
		}

		// Parse implements
		const implMatch = remaining.match(/^implements\s+([\w.,\s"]+?)(?=\s+<<|\s+#|\s*\{|\s*$)/i);
		if (implMatch) {
			entity.implements = implMatch[1].split(',').map(s => this._stripQuotes(s.trim())).filter(Boolean);
			remaining = remaining.slice(implMatch[0].length).trim();
		}

		// Parse stereotypes <<stereo>>
		let stereoMatch;
		const stereoRe = /<<([^>]+)>>/g;
		while ((stereoMatch = stereoRe.exec(remaining)) !== null) {
			entity.stereotypes.push(stereoMatch[1]);
		}
		remaining = remaining.replace(/<<[^>]+>>/g, '').trim();

		// Parse color
		const colorMatch = remaining.match(/#([a-zA-Z0-9]+)/);
		if (colorMatch) {
			entity.color = '#' + colorMatch[1];
			remaining = remaining.replace(/#[a-zA-Z0-9]+/, '').trim();
		}

		// Abstract keyword also sets isAbstract
		if (keyword === 'abstract' || keyword === 'abstract class') {
			entity.isAbstract = true;
		}

		// Assign to current package
		if (this.packageStack.length > 0) {
			const currentPkg = this.packageStack[this.packageStack.length - 1];
			entity.packagePath = currentPkg.path;
			currentPkg.entities.push(code);
		}

		// Check if body follows
		const hasBody = remaining.endsWith('{') || remaining === '{';
		if (hasBody) {
			this.currentEntity = entity;
			if (entityType === EntityType.MAP) {
				this.state = State.MAP_BODY;
			} else if (entityType === EntityType.JSON) {
				this.state = State.JSON_BODY;
				this.jsonBraceDepth = 1;
				this.jsonBodyLines = [];
			} else {
				this.state = State.ENTITY_BODY;
			}
		} else {
			// Handle single-line JSON values: json name true/42/null/"str"/[arr]
			if (entityType === EntityType.JSON && remaining.length > 0) {
				entity.jsonNode = this._parseJsonText(remaining);
			}
			this.diagram.addEntity(entity);
			if (this.togetherGroup !== null) {
				this.togetherGroup.push(code);
			}
		}

		return true;
	}

	// ── Entity body parsing ──────────────────────────────────────────────

	_parseEntityBodyEnd(line) {
		if (line !== '}') return false;

		this.diagram.addEntity(this.currentEntity);
		if (this.togetherGroup !== null) {
			this.togetherGroup.push(this.currentEntity.code);
		}
		this.currentEntity = null;
		this.state = State.NORMAL;
		return true;
	}

	_parseBodyLine(line) {
		// Try separator first
		if (this._parseSeparator(line)) return;

		// Parse as member
		this._parseMemberLine(line);
	}

	_parseSeparator(line) {
		// Separators: --, .., ==, __ (with optional label text between)
		const m = line.match(/^(--|\.\.|\=\=|__)\s*(.*?)\s*(--|\.\.|\=\=|__)?$/);
		if (m === null) return false;

		const styleChar = m[1];
		const label = m[2] || '';

		let style;
		switch (styleChar) {
			case '--': style = SeparatorStyle.SOLID; break;
			case '..': style = SeparatorStyle.DOTTED; break;
			case '==': style = SeparatorStyle.DOUBLE; break;
			case '__': style = SeparatorStyle.THICK; break;
			default:   style = SeparatorStyle.SOLID;
		}

		this.currentEntity.members.push(new Separator(label, style));
		return true;
	}

	_parseMemberLine(line) {
		const member = new Member(line);

		let text = line;

		// Extract {static}, {abstract}, {field}, {method} classifiers
		const classifierMatch = text.match(/\{(static|abstract|field|method)\}/i);
		if (classifierMatch) {
			const classifier = classifierMatch[1].toLowerCase();
			if (classifier === 'static') member.isStatic = true;
			if (classifier === 'abstract') member.isAbstract = true;
			if (classifier === 'field') member.memberType = MemberType.FIELD;
			if (classifier === 'method') member.memberType = MemberType.METHOD;
			text = text.replace(/\{(?:static|abstract|field|method)\}\s*/gi, '').trim();
		}

		// Extract visibility prefix
		const visMatch = text.match(/^([+\-#~])\s*/);
		if (visMatch) {
			member.visibility = this._mapVisibility(visMatch[1]);
			text = text.slice(visMatch[0].length);
		}

		// Detect method vs field: contains ()
		if (text.includes('(')) {
			member.memberType = MemberType.METHOD;

			// Parse method: name(params) : ReturnType
			const methodMatch = text.match(/^(.+?)\(([^)]*)\)\s*(?::\s*(.+))?$/);
			if (methodMatch) {
				member.name = methodMatch[1].trim();
				member.parameters = methodMatch[2].trim();
				member.returnType = methodMatch[3] ? methodMatch[3].trim() : null;
			} else {
				member.name = text;
			}
		} else {
			member.memberType = MemberType.FIELD;

			// Parse field: name : Type
			const fieldMatch = text.match(/^(.+?)\s*:\s*(.+)$/);
			if (fieldMatch) {
				member.name = fieldMatch[1].trim();
				member.returnType = fieldMatch[2].trim();
			} else {
				member.name = text.trim();
			}
		}

		this.currentEntity.members.push(member);
	}

	// ── Map body parsing ─────────────────────────────────────────────────

	_parseMapBodyEnd(line) {
		if (line !== '}') return false;

		this.diagram.addEntity(this.currentEntity);
		if (this.togetherGroup !== null) {
			this.togetherGroup.push(this.currentEntity.code);
		}
		this.currentEntity = null;
		this.state = State.NORMAL;
		return true;
	}

	_parseMapBodyLine(line) {
		// Check for linked entry: key *--> Target or key *---> Target
		const linkedMatch = line.match(/^(.+?)\s*(\*-+>)\s*(\w[\w.]*)$/);
		if (linkedMatch) {
			const entry = new MapEntry(linkedMatch[1].trim(), null);
			entry.linkedTarget = linkedMatch[3];
			this.currentEntity.mapEntries.push(entry);

			// Auto-create target entity and add a link
			this.diagram.getOrCreateEntity(entry.linkedTarget);
			const link = new Relationship(this.currentEntity.code, entry.linkedTarget);
			link.rightDecor = RelationDecor.ARROW;
			link.lineStyle = LineStyle.SOLID;
			this.diagram.addLink(link);
			return;
		}

		// Check for key => value
		const kvMatch = line.match(/^(.+?)\s*=>\s*(.*)$/);
		if (kvMatch) {
			const entry = new MapEntry(kvMatch[1].trim(), kvMatch[2].trim());
			this.currentEntity.mapEntries.push(entry);
			return;
		}
	}

	// ── JSON body parsing ────────────────────────────────────────────────

	_parseJsonBodyLine(line) {
		// Track brace depth
		for (const ch of line) {
			if (ch === '{') this.jsonBraceDepth++;
			if (ch === '}') this.jsonBraceDepth--;
		}

		if (this.jsonBraceDepth <= 0) {
			// End of JSON body — parse collected lines
			const jsonText = '{' + this.jsonBodyLines.join('\n') + '}';
			this.currentEntity.jsonNode = this._parseJsonText(jsonText);
			this.diagram.addEntity(this.currentEntity);
			if (this.togetherGroup !== null) {
				this.togetherGroup.push(this.currentEntity.code);
			}
			this.currentEntity = null;
			this.state = State.NORMAL;
			this.jsonBodyLines = [];
			this.jsonBraceDepth = 0;
		} else {
			this.jsonBodyLines.push(line);
		}
	}

	/**
	 * Parse a JSON text string into a JsonNode tree.
	 * Handles objects, arrays, strings, numbers, booleans, and null.
	 */
	_parseJsonText(text) {
		const trimmed = text.trim();
		try {
			const parsed = JSON.parse(trimmed);
			return this._jsonValueToNode(parsed);
		} catch (e) {
			// If parsing fails, store as a primitive with the raw text
			return new JsonNode(JsonNodeType.PRIMITIVE, trimmed);
		}
	}

	_jsonValueToNode(value) {
		if (value === null) {
			return new JsonNode(JsonNodeType.PRIMITIVE, 'null');
		}
		if (typeof value === 'boolean') {
			return new JsonNode(JsonNodeType.PRIMITIVE, String(value));
		}
		if (typeof value === 'number') {
			return new JsonNode(JsonNodeType.PRIMITIVE, String(value));
		}
		if (typeof value === 'string') {
			return new JsonNode(JsonNodeType.PRIMITIVE, value);
		}
		if (Array.isArray(value)) {
			const node = new JsonNode(JsonNodeType.ARRAY);
			for (const item of value) {
				node.items.push(this._jsonValueToNode(item));
			}
			return node;
		}
		if (typeof value === 'object') {
			const node = new JsonNode(JsonNodeType.OBJECT);
			for (const [k, v] of Object.entries(value)) {
				node.entries.push({ key: k, value: this._jsonValueToNode(v) });
			}
			return node;
		}
		return new JsonNode(JsonNodeType.PRIMITIVE, String(value));
	}

	// ── Link parsing ─────────────────────────────────────────────────────

	_parseLink(line) {
		// Strategy: find the arrow body in the line, then parse entities on each side.
		// Arrow structure: Entity1 ["label"] [leftDecor] bodyChars [style] [direction] bodyChars [rightDecor] ["label"] Entity2 [: label]
		// Style brackets [#color] or [dashed] can appear anywhere in the body.
		// Body chars: one or more of -, ., =

		// Full link regex — arrow body is flexible to handle [style] anywhere
		// Arrow patterns: -->, ..|>, -[#red]->, -left->, -[#red]left->, etc.
		const linkRegex = new RegExp(
			'^' +
			'(' + ANY_IDENT + ')' +                // Entity 1
			'(?:\\s+"([^"]+)")?' +                  // Optional left label
			'(?:\\s*\\[([^\\]]+)\\])?' +            // Optional left qualifier
			'\\s*' +
			'(' + LEFT_DECOR_REGEX + ')?' +         // Optional left decorator
			'(-+|\\.+|=+)' +                        // First body chars (mandatory)
			'(?:\\[([^\\]]+)\\])?' +                 // Optional style [#color]
			'(?:' +
				'(' +                                 // Optional direction
					'left|right|up|down|le?|ri?|up?|do?' +
				')' +
				'(?:\\[([^\\]]+)\\])?' +               // Optional style after direction
			')?' +
			'(-+|\\.+|=+)?' +                        // Optional second body chars
			'(' + RIGHT_DECOR_REGEX + ')?' +         // Optional right decorator
			'\\s*' +
			'(?:"([^"]+)"\\s*)?' +                   // Optional right label
			'(?:\\[([^\\]]+)\\])?' +                  // Optional right qualifier
			'\\s*' +
			'(' + ANY_IDENT + ')' +                  // Entity 2
			'(?:\\s*:\\s*(.+))?' +                    // Optional : label
			'$'
		);

		const m = line.match(linkRegex);
		if (m === null) return false;

		const entity1Str = this._stripQuotes(m[1]);
		const leftLabel = m[2] || null;
		const leftQualifier = m[3] || null;
		const leftDecorStr = m[4] || '';
		const bodyChars1 = m[5];
		const styleStr1 = m[6] || null;
		const directionStr = m[7] || null;
		const styleStr2 = m[8] || null;
		const bodyChars2 = m[9] || null;
		const rightDecorStr = m[10] || '';
		const rightLabel = m[11] || null;
		const rightQualifier = m[12] || null;
		const entity2Str = this._stripQuotes(m[13]);
		const label = m[14] ? m[14].trim() : null;

		// Auto-create entities
		this.diagram.getOrCreateEntity(entity1Str);
		this.diagram.getOrCreateEntity(entity2Str);

		const link = new Relationship(entity1Str, entity2Str);
		link.leftDecor = this._mapLeftDecor(leftDecorStr);
		link.rightDecor = this._mapRightDecor(rightDecorStr);
		link.lineStyle = this._mapLineStyle(bodyChars1);
		link.label = label;
		link.leftLabel = leftLabel;
		link.rightLabel = rightLabel;
		link.leftQualifier = leftQualifier;
		link.rightQualifier = rightQualifier;

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

	// ── Shorthand member ─────────────────────────────────────────────────

	_parseShorthandMember(line) {
		// EntityName : memberText
		const m = line.match(/^(\w[\w.]*)\s*:\s+(.+)$/);
		if (m === null) return false;

		const entityCode = m[1];
		const memberText = m[2].trim();

		// Only match if the entity already exists (avoid matching label-like syntax)
		if (!this.diagram.entities.has(entityCode)) return false;

		const entity = this.diagram.entities.get(entityCode);

		// Parse as a member
		const savedEntity = this.currentEntity;
		this.currentEntity = entity;
		this._parseMemberLine(memberText);
		this.currentEntity = savedEntity;

		return true;
	}

	// ── Notes ────────────────────────────────────────────────────────────

	_parseNoteSingleLine(line) {
		// note left of Entity : text
		const m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(\w[\w.]*)\s*:\s*(.+)$/i);
		if (m === null) return false;

		const note = new Note(this._mapNotePosition(m[1]), m[3].trim());
		note.entityCode = m[2];
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteMultiLine(line) {
		// note left of Entity
		const m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(\w[\w.]*)(?:\s+(#\w+))?\s*$/i);
		if (m === null) return false;

		this.multiLineNote = new Note(this._mapNotePosition(m[1]), '');
		this.multiLineNote.entityCode = m[2];
		if (m[3]) this.multiLineNote.color = m[3];
		this.multiLineNoteLines = [];
		this.state = State.MULTILINE_NOTE;
		return true;
	}

	_parseFloatingNote(line) {
		// note "text" as Alias
		const m = line.match(/^note\s+"([^"]+)"\s+as\s+(\w+)(?:\s+(#\w+))?\s*$/i);
		if (m === null) return false;

		const note = new Note(NotePosition.RIGHT, m[1]);
		note.alias = m[2];
		if (m[3]) note.color = m[3];
		this.diagram.addNote(note);
		return true;
	}

	_parseNoteOnLink(line) {
		// note on link : text
		const m = line.match(/^note\s+on\s+link\s*:\s*(.+)$/i);
		if (m === null) return false;

		const note = new Note(NotePosition.RIGHT, m[1].trim());
		note.isOnLink = true;
		// Associate with the most recently added link
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

	// ── Utility methods ──────────────────────────────────────────────────

	_stripQuotes(str) {
		if (str && str.startsWith('"') && str.endsWith('"')) {
			return str.slice(1, -1);
		}
		return str;
	}

	_mapVisibility(char) {
		switch (char) {
			case '+': return Visibility.PUBLIC;
			case '-': return Visibility.PRIVATE;
			case '#': return Visibility.PROTECTED;
			case '~': return Visibility.PACKAGE;
			default:  return null;
		}
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
 * Parse PlantUML class diagram text into a ClassDiagram model.
 * @param {string} text - Raw PlantUML text
 * @returns {ClassDiagram}
 */
export function parseClassDiagram(text) {
	const parser = new ClassParser();
	return parser.parse(text);
}

export { ClassParser };
