/**
 * Data model for PlantUML component and deployment diagrams.
 *
 * Both diagram types use PlantUML's DescriptionDiagram infrastructure.
 * This model captures components, nodes, interfaces, containers,
 * relationships, and notes.
 */

// ── Shared enums from the description diagram common module ───────────────

import {
	ElementType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	DiagramDirection,
	CONTAINER_KEYWORD_MAP,
} from '../../common/DescriptionModel.js';

// ── Model classes ──────────────────────────────────────────────────────────

class ComponentElement {
	constructor(code, displayName, type) {
		this.code = code;
		this.displayName = displayName || code;
		this.type = type || ElementType.COMPONENT;
		this.color = null;                 // Background color
		this.lineColor = null;             // Border/line color
		this.stereotypes = [];             // Array of stereotype strings
		this.containerPath = null;         // Path of parent container (if inside one)
	}
}

class ComponentRelationship {
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

class ComponentContainer {
	constructor(name, code, type, parentPath) {
		this.name = name;
		this.code = code || name;
		this.type = type || ElementType.PACKAGE;
		this.path = parentPath ? `${parentPath}.${code}` : code;
		this.color = null;
		this.stereotypes = [];
		this.elements = [];                // Element codes directly in this container
		this.subContainers = [];           // Nested ComponentContainer objects
	}
}

class ComponentNote {
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

class ComponentDiagram {
	constructor() {
		this.title = null;
		this.elements = new Map();         // code → ComponentElement
		this.links = [];                   // Ordered ComponentRelationship array
		this.containers = [];              // Top-level ComponentContainer array
		this.notes = [];                   // Array of ComponentNote objects
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
			this.addElement(new ComponentElement(code, displayName || code, type));
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
	// Enums (re-exported from common)
	ElementType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	DiagramDirection,
	CONTAINER_KEYWORD_MAP,

	// Model classes
	ComponentElement,
	ComponentRelationship,
	ComponentContainer,
	ComponentNote,
	ComponentDiagram,
};
