/**
 * UsecaseEmitter.js
 *
 * Walks a UsecaseDiagram model and emits mxCell XML strings.
 * Uses a simple grid layout — ELK handles real layout on the draw.io side.
 */

import {
	ElementType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	DiagramDirection,
} from './UsecaseModel.js';

import {
	buildCell,
	buildStyle,
	xmlEscape,
	geom,
	createIdGenerator,
	normalizeColor,
} from '../../MxBuilder.js';

// ── Layout constants ───────────────────────────────────────────────────────

const LAYOUT = Object.freeze({
	ACTOR_WIDTH:          40,
	ACTOR_HEIGHT:         80,
	USECASE_WIDTH:        140,
	USECASE_HEIGHT:       60,
	H_GAP:                80,
	V_GAP:                80,
	MARGIN:               40,
	COLS_PER_ROW:         4,
	NOTE_WIDTH:           140,
	NOTE_MIN_HEIGHT:      40,
	NOTE_LINE_HEIGHT:     16,
	CONTAINER_PADDING:    30,
	CONTAINER_HEADER:     30,
});

// ── Style helpers ──────────────────────────────────────────────────────────

function actorStyle(element) {
	const style = {
		shape: 'umlActor',
		verticalLabelPosition: 'bottom',
		verticalAlign: 'top',
		html: 1,
		outlineConnect: 0,
	};

	if (element.color) {
		style.fillColor = normalizeColor(element.color);
	}
	if (element.lineColor) {
		style.strokeColor = normalizeColor(element.lineColor);
	}

	return buildStyle(style);
}

function usecaseStyle(element) {
	const style = {
		ellipse: 1,
		whiteSpace: 'wrap',
		html: 1,
		align: 'center',
		verticalAlign: 'middle',
	};

	if (element.color) {
		style.fillColor = normalizeColor(element.color);
	}
	if (element.lineColor) {
		style.strokeColor = normalizeColor(element.lineColor);
	}

	return buildStyle(style);
}

function containerStyle(container) {
	const baseStyle = {
		html: 1,
		whiteSpace: 'wrap',
		verticalAlign: 'top',
		fontStyle: 1,
		fillColor: 'none',
		strokeColor: '#666666',
		fontSize: 12,
		container: 1,
		collapsible: 0,
	};

	switch (container.type) {
		case ElementType.PACKAGE:
			baseStyle.shape = 'folder';
			baseStyle.tabWidth = 80;
			baseStyle.tabHeight = 20;
			baseStyle.tabPosition = 'left';
			break;
		case ElementType.RECTANGLE:
			baseStyle.rounded = 0;
			break;
		case ElementType.FRAME:
			baseStyle.shape = 'mxgraph.sysml.package';
			break;
		case ElementType.CLOUD:
			baseStyle.shape = 'cloud';
			break;
		case ElementType.NODE:
			baseStyle.shape = 'mxgraph.flowchart.display';
			break;
		case ElementType.FOLDER:
			baseStyle.shape = 'folder';
			baseStyle.tabWidth = 80;
			baseStyle.tabHeight = 20;
			baseStyle.tabPosition = 'left';
			break;
		case ElementType.DATABASE:
			baseStyle.shape = 'mxgraph.flowchart.database';
			break;
		case ElementType.COMPONENT:
			baseStyle.shape = 'component';
			break;
		default:
			baseStyle.rounded = 0;
			break;
	}

	if (container.color) {
		baseStyle.fillColor = normalizeColor(container.color);
	}

	return buildStyle(baseStyle);
}

function noteStyle(note) {
	const style = {
		shape: 'note',
		whiteSpace: 'wrap',
		html: 1,
		size: 14,
		verticalAlign: 'top',
		align: 'left',
		spacingLeft: 4,
		fillColor: '#FFF2CC',
		strokeColor: '#D6B656',
	};

	if (note.color) {
		style.fillColor = normalizeColor(note.color);
	}

	return buildStyle(style);
}

function edgeStyle(link) {
	const style = {
		html: 1,
		rounded: 0,
		endArrow: 'none',
		endFill: 0,
		startArrow: 'none',
		startFill: 0,
	};

	// Line style
	if (link.lineStyle === LineStyle.DASHED) {
		style.dashed = 1;
	} else if (link.lineStyle === LineStyle.BOLD) {
		style.strokeWidth = 2;
	} else if (link.lineStyle === LineStyle.DOTTED) {
		style.dashed = 1;
		style.dashPattern = '1 2';
	}

	// Right decorator (target end)
	applyDecorToEnd(link.rightDecor, style, 'end');

	// Left decorator (source end)
	applyDecorToEnd(link.leftDecor, style, 'start');

	// Link color
	if (link.color) {
		style.strokeColor = normalizeColor(link.color);
	}

	return buildStyle(style);
}

function applyDecorToEnd(decor, style, prefix) {
	const arrowKey = prefix + 'Arrow';
	const fillKey = prefix + 'Fill';

	switch (decor) {
		case RelationDecor.EXTENDS:
			style[arrowKey] = 'block';
			style[fillKey] = 0;
			break;
		case RelationDecor.COMPOSITION:
			style[arrowKey] = 'diamond';
			style[fillKey] = 1;
			break;
		case RelationDecor.AGGREGATION:
			style[arrowKey] = 'diamond';
			style[fillKey] = 0;
			break;
		case RelationDecor.ARROW:
			style[arrowKey] = 'open';
			style[fillKey] = 1;
			break;
		case RelationDecor.ARROW_TRIANGLE:
			style[arrowKey] = 'block';
			style[fillKey] = 1;
			break;
		case RelationDecor.NOT_NAVIGABLE:
			style[arrowKey] = 'cross';
			style[fillKey] = 1;
			break;
		case RelationDecor.CROWFOOT:
			style[arrowKey] = 'ERmany';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE_CROWFOOT:
			style[arrowKey] = 'ERmandOne';
			style[fillKey] = 0;
			break;
		case RelationDecor.DOUBLE_LINE:
			style[arrowKey] = 'ERmandOne';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE_LINE:
			style[arrowKey] = 'ERzeroToOne';
			style[fillKey] = 0;
			break;
		case RelationDecor.LINE_CROWFOOT:
			style[arrowKey] = 'ERoneToMany';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE:
			style[arrowKey] = 'oval';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE_FILL:
			style[arrowKey] = 'oval';
			style[fillKey] = 1;
			break;
		case RelationDecor.SQUARE:
			style[arrowKey] = 'box';
			style[fillKey] = 1;
			break;
		case RelationDecor.PLUS:
			style[arrowKey] = 'cross';
			style[fillKey] = 0;
			break;
		case RelationDecor.NONE:
		default:
			// leave as none
			break;
	}
}

// ── Emitter class ──────────────────────────────────────────────────────────

class UsecaseEmitter {
	constructor(parentId) {
		this.parentId = parentId;
		this.nextId = createIdGenerator('puml');
		this.cells = [];
		this.elementPositions = new Map();  // code → { x, y, width, height }
		this.elementCellIds = new Map();    // code → cell id
		this.containerBounds = new Map();   // container code → { x, y, width, height, id }
	}

	/**
	 * Emit the full diagram.
	 * @param {UsecaseDiagram} diagram
	 * @returns {string[]} Array of mxCell XML strings
	 */
	emit(diagram) {
		this.diagram = diagram;

		// 1. Calculate element sizes
		const elementSizes = this._calculateElementSizes(diagram);

		// 2. Grid layout
		this._layoutElements(diagram, elementSizes);

		// 3. Emit containers (background, z-order first)
		this._emitContainers(diagram.containers);

		// 4. Emit elements (actors, usecases)
		for (const [code, element] of diagram.elements) {
			this._emitElement(element);
		}

		// 5. Emit notes
		this._emitNotes(diagram);

		// 6. Emit relationships (edges on top)
		for (const link of diagram.links) {
			this._emitLink(link);
		}

		return this.cells;
	}

	// ── Size calculation ─────────────────────────────────────────────────

	_calculateElementSizes(diagram) {
		const sizes = new Map();

		for (const [code, element] of diagram.elements) {
			if (element.type === ElementType.ACTOR || element.type === ElementType.ACTOR_BUSINESS) {
				sizes.set(code, {
					width: LAYOUT.ACTOR_WIDTH,
					height: LAYOUT.ACTOR_HEIGHT,
				});
			} else {
				// Usecase ellipse — wider for longer names
				const nameLen = element.displayName.length;
				const width = Math.max(LAYOUT.USECASE_WIDTH, nameLen * 8 + 40);
				sizes.set(code, {
					width: width,
					height: LAYOUT.USECASE_HEIGHT,
				});
			}
		}

		return sizes;
	}

	// ── Grid layout ──────────────────────────────────────────────────────

	_layoutElements(diagram, elementSizes) {
		// Collect elements by container
		const containeredElements = new Set();
		for (const container of diagram.containers) {
			this._collectContainerElements(container, containeredElements);
		}

		// Root-level elements (not in any container)
		const rootElements = [];
		for (const [code] of diagram.elements) {
			if (!containeredElements.has(code)) {
				rootElements.push(code);
			}
		}

		let currentY = LAYOUT.MARGIN;

		// Layout root elements first
		if (rootElements.length > 0) {
			currentY = this._layoutGrid(rootElements, elementSizes, LAYOUT.MARGIN, currentY);
			currentY += LAYOUT.V_GAP;
		}

		// Layout container elements
		for (const container of diagram.containers) {
			currentY = this._layoutContainer(container, elementSizes, LAYOUT.MARGIN, currentY);
			currentY += LAYOUT.V_GAP;
		}
	}

	_collectContainerElements(container, set) {
		for (const code of container.elements) {
			set.add(code);
		}
		for (const sub of container.subContainers) {
			this._collectContainerElements(sub, set);
		}
	}

	_layoutGrid(elementCodes, elementSizes, startX, startY) {
		let col = 0;
		let x = startX;
		let y = startY;
		let rowMaxHeight = 0;

		for (const code of elementCodes) {
			const size = elementSizes.get(code);
			if (!size) continue;

			this.elementPositions.set(code, {
				x, y,
				width: size.width,
				height: size.height,
			});

			rowMaxHeight = Math.max(rowMaxHeight, size.height);
			col++;

			if (col >= LAYOUT.COLS_PER_ROW) {
				col = 0;
				x = startX;
				y += rowMaxHeight + LAYOUT.V_GAP;
				rowMaxHeight = 0;
			} else {
				x += size.width + LAYOUT.H_GAP;
			}
		}

		return y + rowMaxHeight;
	}

	_layoutContainer(container, elementSizes, startX, startY) {
		const innerX = startX + LAYOUT.CONTAINER_PADDING;
		let innerY = startY + LAYOUT.CONTAINER_HEADER + LAYOUT.CONTAINER_PADDING;

		// Layout elements in this container
		if (container.elements.length > 0) {
			innerY = this._layoutGrid(container.elements, elementSizes, innerX, innerY);
			innerY += LAYOUT.CONTAINER_PADDING;
		}

		// Layout sub-containers
		for (const sub of container.subContainers) {
			innerY = this._layoutContainer(sub, elementSizes, innerX, innerY);
			innerY += LAYOUT.V_GAP;
		}

		// Calculate container bounds
		let maxX = startX + LAYOUT.USECASE_WIDTH + 2 * LAYOUT.CONTAINER_PADDING;
		for (const code of container.elements) {
			const pos = this.elementPositions.get(code);
			if (pos) {
				maxX = Math.max(maxX, pos.x + pos.width + LAYOUT.CONTAINER_PADDING);
			}
		}
		// Also check sub-container bounds
		for (const sub of container.subContainers) {
			const subBounds = this.containerBounds.get(sub.code);
			if (subBounds) {
				maxX = Math.max(maxX, subBounds.x + subBounds.width + LAYOUT.CONTAINER_PADDING);
			}
		}

		const containerWidth = maxX - startX;
		const containerHeight = innerY - startY;

		this.containerBounds.set(container.code, {
			x: startX,
			y: startY,
			width: containerWidth,
			height: containerHeight,
		});

		return innerY;
	}

	// ── Container emission ───────────────────────────────────────────────

	_emitContainers(containers) {
		for (const container of containers) {
			this._emitContainer(container);
		}
	}

	_emitContainer(container) {
		const bounds = this.containerBounds.get(container.code);
		if (!bounds) return;

		const id = this.nextId();

		// Build label
		let label = xmlEscape(container.name);
		for (const stereo of container.stereotypes) {
			label = '&lt;&lt;' + xmlEscape(stereo) + '&gt;&gt;<br>' + label;
		}

		this.cells.push(buildCell({
			id: id,
			value: label,
			style: containerStyle(container),
			vertex: true,
			parent: this.parentId,
			geometry: geom(bounds.x, bounds.y, bounds.width, bounds.height),
		}));

		// Emit sub-containers
		for (const sub of container.subContainers) {
			this._emitContainer(sub);
		}
	}

	// ── Element emission ─────────────────────────────────────────────────

	_emitElement(element) {
		const pos = this.elementPositions.get(element.code);
		if (!pos) return;

		const id = this.nextId();
		this.elementCellIds.set(element.code, id);

		// Build label
		let label = '';

		// Stereotypes above name
		for (const stereo of element.stereotypes) {
			label += '&lt;&lt;' + xmlEscape(stereo) + '&gt;&gt;<br>';
		}

		label += xmlEscape(element.displayName);

		// Choose shape based on type
		const isActor = element.type === ElementType.ACTOR || element.type === ElementType.ACTOR_BUSINESS;

		this.cells.push(buildCell({
			id: id,
			value: label,
			style: isActor ? actorStyle(element) : usecaseStyle(element),
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, pos.y, pos.width, pos.height),
		}));
	}

	// ── Note emission ────────────────────────────────────────────────────

	_emitNotes(diagram) {
		for (const note of diagram.notes) {
			if (note.isOnLink) {
				this._emitNoteOnLink(note);
			} else {
				this._emitNote(note);
			}
		}
	}

	_emitNote(note) {
		const id = this.nextId();

		// Calculate position relative to target entity
		let x = LAYOUT.MARGIN;
		let y = LAYOUT.MARGIN;

		if (note.entityCode) {
			const pos = this.elementPositions.get(note.entityCode);
			if (pos) {
				const offset = 20;
				switch (note.position) {
					case NotePosition.LEFT:
						x = pos.x - LAYOUT.NOTE_WIDTH - offset;
						y = pos.y;
						break;
					case NotePosition.RIGHT:
						x = pos.x + pos.width + offset;
						y = pos.y;
						break;
					case NotePosition.TOP:
						x = pos.x;
						y = pos.y - LAYOUT.NOTE_MIN_HEIGHT - offset;
						break;
					case NotePosition.BOTTOM:
						x = pos.x;
						y = pos.y + pos.height + offset;
						break;
				}
			}
		} else {
			// Floating note — place below all elements
			let maxY = 0;
			for (const [, pos] of this.elementPositions) {
				maxY = Math.max(maxY, pos.y + pos.height);
			}
			y = maxY + LAYOUT.V_GAP;
		}

		// Calculate note height from text lines
		const textLines = note.text.split('\n').length;
		const noteHeight = Math.max(LAYOUT.NOTE_MIN_HEIGHT, textLines * LAYOUT.NOTE_LINE_HEIGHT + 16);

		const noteText = xmlEscape(note.text).replace(/\n/g, '<br>');

		this.cells.push(buildCell({
			id: id,
			value: noteText,
			style: noteStyle(note),
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, y, LAYOUT.NOTE_WIDTH, noteHeight),
		}));

		// If attached to an entity, add a dashed edge
		if (note.entityCode) {
			const targetId = this.elementCellIds.get(note.entityCode);
			if (targetId) {
				this.cells.push(buildCell({
					id: this.nextId(),
					style: buildStyle({ html: 1, dashed: 1, endArrow: 'none', endFill: 0, startArrow: 'none', startFill: 0 }),
					edge: true,
					parent: this.parentId,
					source: id,
					target: targetId,
				}));
			}
		}
	}

	_emitNoteOnLink(note) {
		// Place note near the midpoint of the associated link
		const linkIndex = note.linkIndex;
		if (linkIndex === null || linkIndex === undefined) return;

		const link = this.diagram.links[linkIndex];
		if (!link) return;

		const fromPos = this.elementPositions.get(link.from);
		const toPos = this.elementPositions.get(link.to);
		if (!fromPos || !toPos) return;

		// Midpoint
		const midX = (fromPos.x + fromPos.width / 2 + toPos.x + toPos.width / 2) / 2;
		const midY = (fromPos.y + fromPos.height / 2 + toPos.y + toPos.height / 2) / 2;

		const noteText = xmlEscape(note.text).replace(/\n/g, '<br>');
		const textLines = note.text.split('\n').length;
		const noteHeight = Math.max(LAYOUT.NOTE_MIN_HEIGHT, textLines * LAYOUT.NOTE_LINE_HEIGHT + 16);

		this.cells.push(buildCell({
			id: this.nextId(),
			value: noteText,
			style: noteStyle(note),
			vertex: true,
			parent: this.parentId,
			geometry: geom(midX + 20, midY - noteHeight / 2, LAYOUT.NOTE_WIDTH, noteHeight),
		}));
	}

	// ── Link emission ────────────────────────────────────────────────────

	_emitLink(link) {
		const fromId = this.elementCellIds.get(link.from);
		const toId = this.elementCellIds.get(link.to);

		// Build label
		let label = '';
		if (link.label) {
			label = xmlEscape(link.label);
		}

		if (fromId && toId) {
			// Connected edge (source/target references)
			this.cells.push(buildCell({
				id: this.nextId(),
				value: label,
				style: edgeStyle(link),
				edge: true,
				parent: this.parentId,
				source: fromId,
				target: toId,
			}));
		} else {
			// Freestanding edge (sourcePoint/targetPoint)
			const fromPos = this.elementPositions.get(link.from);
			const toPos = this.elementPositions.get(link.to);

			const sx = fromPos ? fromPos.x + fromPos.width / 2 : 0;
			const sy = fromPos ? fromPos.y + fromPos.height / 2 : 0;
			const tx = toPos ? toPos.x + toPos.width / 2 : 100;
			const ty = toPos ? toPos.y + toPos.height / 2 : 100;

			this.cells.push(buildCell({
				id: this.nextId(),
				value: label,
				style: edgeStyle(link),
				edge: true,
				parent: this.parentId,
				sourcePoint: { x: sx, y: sy },
				targetPoint: { x: tx, y: ty },
			}));
		}

		// Emit left/right labels as separate label cells if present
		if (link.leftLabel || link.rightLabel) {
			this._emitLinkLabels(link, fromId, toId);
		}
	}

	_emitLinkLabels(link, fromId, toId) {
		// Left label (source side)
		if (link.leftLabel) {
			const fromPos = this.elementPositions.get(link.from);
			if (fromPos) {
				this.cells.push(buildCell({
					id: this.nextId(),
					value: xmlEscape(link.leftLabel),
					style: buildStyle({
						edgeLabel: 1,
						html: 1,
						align: 'left',
						verticalAlign: 'bottom',
						resizable: 0,
						points: '[]',
					}),
					vertex: true,
					connectable: false,
					parent: this.parentId,
					geometry: geom(fromPos.x + fromPos.width + 5, fromPos.y - 15, 30, 15),
				}));
			}
		}

		// Right label (target side)
		if (link.rightLabel) {
			const toPos = this.elementPositions.get(link.to);
			if (toPos) {
				this.cells.push(buildCell({
					id: this.nextId(),
					value: xmlEscape(link.rightLabel),
					style: buildStyle({
						edgeLabel: 1,
						html: 1,
						align: 'left',
						verticalAlign: 'bottom',
						resizable: 0,
						points: '[]',
					}),
					vertex: true,
					connectable: false,
					parent: this.parentId,
					geometry: geom(toPos.x - 35, toPos.y - 15, 30, 15),
				}));
			}
		}
	}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Emit a UsecaseDiagram model as mxCell XML strings.
 * @param {UsecaseDiagram} diagram - Parsed usecase diagram model
 * @param {string} parentId - Parent cell ID for all emitted cells
 * @returns {string[]} Array of mxCell XML strings
 */
export function emitUsecaseDiagram(diagram, parentId) {
	const emitter = new UsecaseEmitter(parentId);
	return emitter.emit(diagram);
}

export { UsecaseEmitter };
