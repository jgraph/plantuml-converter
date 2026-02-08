/**
 * ClassEmitter.js
 *
 * Walks a ClassDiagram model and emits mxCell XML strings.
 * Uses a simple grid layout — ELK handles real layout on the draw.io side.
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
	Separator
} from './ClassModel.js';

import {
	buildCell,
	buildStyle,
	xmlEscape,
	geom,
	createIdGenerator,
	normalizeColor
} from '../../MxBuilder.js';

// ── Layout constants ───────────────────────────────────────────────────────

const LAYOUT = Object.freeze({
	CLASS_WIDTH:         160,
	CLASS_HEADER_HEIGHT:  26,
	MEMBER_ROW_HEIGHT:    26,
	SEPARATOR_HEIGHT:      8,
	H_GAP:               60,
	V_GAP:               80,
	MARGIN:              40,
	COLS_PER_ROW:         4,
	NOTE_WIDTH:          140,
	NOTE_MIN_HEIGHT:      40,
	NOTE_LINE_HEIGHT:     16,
	PACKAGE_PADDING:      30,
	PACKAGE_HEADER:       30,
	LOLLIPOP_SIZE:        20,
	DIAMOND_SIZE:         20,
});

// ── Style helpers ──────────────────────────────────────────────────────────

function classStyle(entity, headerHeight) {
	const style = {
		swimlane: 1,
		fontStyle: 1,       // bold header by default
		align: 'center',
		verticalAlign: 'top',
		childLayout: 'stackLayout',
		horizontal: 1,
		startSize: headerHeight || LAYOUT.CLASS_HEADER_HEIGHT,
		horizontalStack: 0,
		resizeParent: 1,
		resizeParentMax: 0,
		resizeLast: 0,
		collapsible: 1,
		marginBottom: 0,
		whiteSpace: 'wrap',
		html: 1,
	};

	// Abstract class → bold+italic
	if (entity.isAbstract || entity.type === EntityType.ABSTRACT_CLASS) {
		style.fontStyle = 3;
	}

	// Interface → italic
	if (entity.type === EntityType.INTERFACE) {
		style.fontStyle = 2;
	}

	// Apply custom color
	if (entity.color) {
		style.fillColor = normalizeColor(entity.color);
	}

	if (entity.lineColor) {
		style.strokeColor = normalizeColor(entity.lineColor);
	}

	return buildStyle(style);
}

function memberStyle(member) {
	const style = {
		text: 1,
		strokeColor: 'none',
		fillColor: 'none',
		align: 'left',
		verticalAlign: 'top',
		spacingLeft: 4,
		spacingRight: 4,
		overflow: 'hidden',
		rotatable: 0,
		points: '[[0,0.5],[1,0.5]]',
		portConstraint: 'eastwest',
		whiteSpace: 'wrap',
		html: 1,
		fontStyle: 0,
	};

	if (member.isStatic) {
		style.fontStyle = 4;  // underline
	} else if (member.isAbstract) {
		style.fontStyle = 2;  // italic
	}

	return buildStyle(style);
}

function separatorStyle() {
	return buildStyle({
		line: 1,
		strokeWidth: 1,
		fillColor: 'none',
		align: 'left',
		verticalAlign: 'middle',
		spacingTop: -1,
		spacingLeft: 3,
		spacingRight: 3,
		rotatable: 0,
		labelPosition: 'right',
		points: '[]',
		portConstraint: 'eastwest',
		strokeColor: 'inherit',
	});
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

function packageStyle(pkg) {
	const style = {
		shape: 'folder',
		fontStyle: 1,
		tabWidth: 80,
		tabHeight: 20,
		tabPosition: 'left',
		html: 1,
		whiteSpace: 'wrap',
		verticalAlign: 'top',
		fillColor: 'none',
		strokeColor: '#666666',
		fontSize: 12,
	};

	if (pkg.color) {
		style.fillColor = normalizeColor(pkg.color);
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

class ClassEmitter {
	constructor(parentId) {
		this.parentId = parentId;
		this.nextId = createIdGenerator('puml');
		this.cells = [];
		this.entityPositions = new Map();  // code → { x, y, width, height, id }
		this.entityCellIds = new Map();    // code → cell id
	}

	/**
	 * Emit the full diagram.
	 * @param {ClassDiagram} diagram
	 * @returns {string[]} Array of mxCell XML strings
	 */
	emit(diagram) {
		this.diagram = diagram;

		// 1. Calculate entity sizes
		const entitySizes = this._calculateEntitySizes(diagram);

		// 2. Grid layout
		this._layoutEntities(diagram, entitySizes);

		// 3. Emit packages (background, z-order first)
		this._emitPackages(diagram);

		// 4. Emit entities
		for (const [code, entity] of diagram.entities) {
			this._emitEntity(entity);
		}

		// 5. Emit notes
		this._emitNotes(diagram);

		// 6. Synthesize edges from extends/implements declarations
		this._emitInheritanceEdges(diagram);

		// 7. Emit explicit relationships (edges on top)
		for (const link of diagram.links) {
			this._emitLink(link);
		}

		return this.cells;
	}

	// ── Size calculation ─────────────────────────────────────────────────

	_calculateEntitySizes(diagram) {
		const sizes = new Map();

		for (const [code, entity] of diagram.entities) {
			const visibleMembers = this._getVisibleMembers(entity, diagram);
			const hh = this._headerHeight(entity);
			let bodyHeight = 0;
			for (const m of visibleMembers) {
				bodyHeight += (m instanceof Separator) ? LAYOUT.SEPARATOR_HEIGHT : LAYOUT.MEMBER_ROW_HEIGHT;
			}
			const height = hh + bodyHeight;
			sizes.set(code, {
				width: LAYOUT.CLASS_WIDTH,
				height: Math.max(height, hh + LAYOUT.MEMBER_ROW_HEIGHT),
			});
		}

		return sizes;
	}

	_headerHeight(entity) {
		let lines = 1;
		if (this._getTypePrefix(entity)) lines++;
		lines += entity.stereotypes.length;
		return LAYOUT.CLASS_HEADER_HEIGHT + (lines - 1) * 18;
	}

	_getVisibleMembers(entity, diagram) {
		const hidden = diagram.hiddenMembers;
		let members = entity.members;

		// Check entity-specific hide
		if (hidden.has(entity.code)) {
			const hiddenSet = hidden.get(entity.code);
			members = members.filter(m => {
				if (m instanceof Separator) return true;
				if (hiddenSet.has('members')) return false;
				if (hiddenSet.has('methods') && m.memberType === MemberType.METHOD) return false;
				if (hiddenSet.has('fields') && m.memberType === MemberType.FIELD) return false;
				return true;
			});
		}

		// Check global hide
		if (hidden.has('*')) {
			const hiddenSet = hidden.get('*');
			members = members.filter(m => {
				if (m instanceof Separator) return true;
				if (hiddenSet.has('members')) return false;
				if (hiddenSet.has('methods') && m.memberType === MemberType.METHOD) return false;
				if (hiddenSet.has('fields') && m.memberType === MemberType.FIELD) return false;
				return true;
			});
		}

		return members;
	}

	// ── Grid layout ──────────────────────────────────────────────────────

	_layoutEntities(diagram, entitySizes) {
		// Group entities by package
		const packagedEntities = new Set();
		for (const pkg of diagram.packages) {
			this._collectPackageEntities(pkg, packagedEntities);
		}

		// Root-level entities (not in any package)
		const rootEntities = [];
		for (const [code] of diagram.entities) {
			if (!packagedEntities.has(code)) {
				rootEntities.push(code);
			}
		}

		let currentY = LAYOUT.MARGIN;

		// Layout root entities first
		if (rootEntities.length > 0) {
			currentY = this._layoutEntityGrid(rootEntities, entitySizes, LAYOUT.MARGIN, currentY);
			currentY += LAYOUT.V_GAP;
		}

		// Layout package entities
		for (const pkg of diagram.packages) {
			currentY = this._layoutPackage(pkg, entitySizes, LAYOUT.MARGIN, currentY);
			currentY += LAYOUT.V_GAP;
		}
	}

	_collectPackageEntities(pkg, set) {
		for (const code of pkg.entities) {
			set.add(code);
		}
		for (const sub of pkg.subPackages) {
			this._collectPackageEntities(sub, set);
		}
	}

	_layoutEntityGrid(entityCodes, entitySizes, startX, startY) {
		let col = 0;
		let x = startX;
		let y = startY;
		let rowMaxHeight = 0;

		for (const code of entityCodes) {
			const size = entitySizes.get(code);
			if (!size) continue;

			this.entityPositions.set(code, {
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

	_layoutPackage(pkg, entitySizes, startX, startY) {
		const innerX = startX + LAYOUT.PACKAGE_PADDING;
		let innerY = startY + LAYOUT.PACKAGE_HEADER + LAYOUT.PACKAGE_PADDING;

		// Layout entities in this package
		if (pkg.entities.length > 0) {
			innerY = this._layoutEntityGrid(pkg.entities, entitySizes, innerX, innerY);
			innerY += LAYOUT.PACKAGE_PADDING;
		}

		// Layout sub-packages
		for (const sub of pkg.subPackages) {
			innerY = this._layoutPackage(sub, entitySizes, innerX, innerY);
			innerY += LAYOUT.V_GAP;
		}

		// Calculate package bounds
		let maxX = startX + LAYOUT.CLASS_WIDTH + 2 * LAYOUT.PACKAGE_PADDING;
		for (const code of pkg.entities) {
			const pos = this.entityPositions.get(code);
			if (pos) {
				maxX = Math.max(maxX, pos.x + pos.width + LAYOUT.PACKAGE_PADDING);
			}
		}
		for (const sub of pkg.subPackages) {
			// Sub-package bounds are tracked implicitly via entity positions
		}

		const pkgWidth = maxX - startX;
		const pkgHeight = innerY - startY;

		// Store package bounds for emission
		pkg._bounds = { x: startX, y: startY, width: pkgWidth, height: pkgHeight };

		return innerY;
	}

	// ── Entity emission ──────────────────────────────────────────────────

	_emitEntity(entity) {
		const pos = this.entityPositions.get(entity.code);
		if (!pos) return;

		const id = this.nextId();
		this.entityCellIds.set(entity.code, id);

		// Build header label
		let label = '';
		let headerLines = 1;  // at least the class name

		// Type prefix (for non-class types)
		const typePrefix = this._getTypePrefix(entity);
		if (typePrefix) {
			label += '&lt;&lt;' + xmlEscape(typePrefix) + '&gt;&gt;<br>';
			headerLines++;
		}

		// Stereotypes
		for (const stereo of entity.stereotypes) {
			label += '&lt;&lt;' + xmlEscape(stereo) + '&gt;&gt;<br>';
			headerLines++;
		}

		// Display name + generics
		label += xmlEscape(entity.displayName);
		if (entity.genericParams) {
			label += '&lt;' + xmlEscape(entity.genericParams) + '&gt;';
		}

		// Calculate dynamic header height (each extra line adds 18px)
		const headerHeight = LAYOUT.CLASS_HEADER_HEIGHT + (headerLines - 1) * 18;

		// Special shapes
		if (entity.type === EntityType.LOLLIPOP_FULL || entity.type === EntityType.LOLLIPOP_HALF) {
			this._emitLollipop(entity, pos, id);
			return;
		}

		if (entity.type === EntityType.DIAMOND) {
			this._emitDiamondShape(entity, pos, id);
			return;
		}

		if (entity.type === EntityType.CIRCLE) {
			this._emitCircleShape(entity, pos, id);
			return;
		}

		// Swimlane container
		const visibleMembers = this._getVisibleMembers(entity, this.diagram);
		let bodyHeight = 0;
		for (const m of visibleMembers) {
			bodyHeight += (m instanceof Separator) ? LAYOUT.SEPARATOR_HEIGHT : LAYOUT.MEMBER_ROW_HEIGHT;
		}
		const totalHeight = headerHeight + bodyHeight;

		this.cells.push(buildCell({
			id: id,
			value: label,
			style: classStyle(entity, headerHeight),
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, pos.y, pos.width, Math.max(totalHeight, headerHeight + LAYOUT.MEMBER_ROW_HEIGHT)),
		}));

		// Emit members as child cells
		let yOffset = headerHeight;
		for (const member of visibleMembers) {
			if (member instanceof Separator) {
				this.cells.push(buildCell({
					id: this.nextId(),
					value: member.label ? xmlEscape(member.label) : '',
					style: separatorStyle(),
					vertex: true,
					parent: id,
					geometry: geom(0, yOffset, pos.width, LAYOUT.SEPARATOR_HEIGHT),
				}));
				yOffset += LAYOUT.SEPARATOR_HEIGHT;
			} else {
				const memberLabel = this._formatMember(member);
				this.cells.push(buildCell({
					id: this.nextId(),
					value: memberLabel,
					style: memberStyle(member),
					vertex: true,
					parent: id,
					geometry: geom(0, yOffset, pos.width, LAYOUT.MEMBER_ROW_HEIGHT),
				}));
				yOffset += LAYOUT.MEMBER_ROW_HEIGHT;
			}
		}
	}

	_emitLollipop(entity, pos, id) {
		this.cells.push(buildCell({
			id: id,
			value: xmlEscape(entity.displayName),
			style: buildStyle({
				ellipse: 1,
				whiteSpace: 'wrap',
				html: 1,
				aspect: 'fixed',
				fillColor: 'none',
			}),
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, pos.y, LAYOUT.LOLLIPOP_SIZE, LAYOUT.LOLLIPOP_SIZE),
		}));
	}

	_emitDiamondShape(entity, pos, id) {
		this.cells.push(buildCell({
			id: id,
			value: '',
			style: buildStyle({
				rhombus: 1,
				whiteSpace: 'wrap',
				html: 1,
				fillColor: '#000000',
			}),
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, pos.y, LAYOUT.DIAMOND_SIZE, LAYOUT.DIAMOND_SIZE),
		}));
	}

	_emitCircleShape(entity, pos, id) {
		this.cells.push(buildCell({
			id: id,
			value: xmlEscape(entity.displayName),
			style: buildStyle({
				ellipse: 1,
				whiteSpace: 'wrap',
				html: 1,
			}),
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, pos.y, LAYOUT.LOLLIPOP_SIZE, LAYOUT.LOLLIPOP_SIZE),
		}));
	}

	_getTypePrefix(entity) {
		switch (entity.type) {
			case EntityType.INTERFACE:      return 'interface';
			case EntityType.ENUM:           return 'enumeration';
			case EntityType.ANNOTATION:     return 'annotation';
			case EntityType.ENTITY:         return 'entity';
			case EntityType.PROTOCOL:       return 'protocol';
			case EntityType.STRUCT:         return 'struct';
			case EntityType.EXCEPTION:      return 'exception';
			case EntityType.METACLASS:      return 'metaclass';
			case EntityType.STEREOTYPE_TYPE:return 'stereotype';
			case EntityType.DATACLASS:      return 'dataclass';
			case EntityType.RECORD:         return 'record';
			default: return null;
		}
	}

	_formatMember(member) {
		let label = '';

		// Visibility symbol
		if (member.visibility !== null) {
			switch (member.visibility) {
				case Visibility.PUBLIC:    label += '+ '; break;
				case Visibility.PRIVATE:   label += '- '; break;
				case Visibility.PROTECTED: label += '# '; break;
				case Visibility.PACKAGE:   label += '~ '; break;
			}
		}

		// Name
		label += xmlEscape(member.name);

		// Parameters (for methods)
		if (member.memberType === MemberType.METHOD && member.parameters !== null) {
			label += '(' + xmlEscape(member.parameters) + ')';
		}

		// Return type
		if (member.returnType) {
			label += ' : ' + xmlEscape(member.returnType);
		}

		return label;
	}

	// ── Package emission ─────────────────────────────────────────────────

	_emitPackages(diagram) {
		for (const pkg of diagram.packages) {
			this._emitPackage(pkg);
		}
	}

	_emitPackage(pkg) {
		if (!pkg._bounds) return;

		const bounds = pkg._bounds;
		this.cells.push(buildCell({
			id: this.nextId(),
			value: xmlEscape(pkg.name),
			style: packageStyle(pkg),
			vertex: true,
			parent: this.parentId,
			geometry: geom(bounds.x, bounds.y, bounds.width, bounds.height),
		}));

		// Emit sub-packages
		for (const sub of pkg.subPackages) {
			this._emitPackage(sub);
		}
	}

	// ── Note emission ────────────────────────────────────────────────────

	_emitNotes(diagram) {
		for (const note of diagram.notes) {
			this._emitNote(note);
		}
	}

	_emitNote(note) {
		const noteId = this.nextId();
		const lines = note.text.split('\n');
		const noteHeight = Math.max(
			LAYOUT.NOTE_MIN_HEIGHT,
			lines.length * LAYOUT.NOTE_LINE_HEIGHT + 16
		);

		// Position note relative to its entity
		let x = LAYOUT.MARGIN;
		let y = LAYOUT.MARGIN;

		if (note.entityCode) {
			const entityPos = this.entityPositions.get(note.entityCode);
			if (entityPos) {
				switch (note.position) {
					case NotePosition.LEFT:
						x = entityPos.x - LAYOUT.NOTE_WIDTH - 20;
						y = entityPos.y;
						break;
					case NotePosition.RIGHT:
						x = entityPos.x + entityPos.width + 20;
						y = entityPos.y;
						break;
					case NotePosition.TOP:
						x = entityPos.x;
						y = entityPos.y - noteHeight - 20;
						break;
					case NotePosition.BOTTOM:
						x = entityPos.x;
						y = entityPos.y + entityPos.height + 20;
						break;
				}
			}
		} else if (note.isOnLink && note.linkIndex !== null) {
			// Position near the midpoint of the link
			const link = this.diagram.links[note.linkIndex];
			if (link) {
				const fromPos = this.entityPositions.get(link.from);
				const toPos = this.entityPositions.get(link.to);
				if (fromPos && toPos) {
					x = (fromPos.x + toPos.x) / 2;
					y = (fromPos.y + toPos.y) / 2 - noteHeight - 10;
				}
			}
		}

		this.cells.push(buildCell({
			id: noteId,
			value: xmlEscape(note.text),
			style: noteStyle(note),
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, y, LAYOUT.NOTE_WIDTH, noteHeight),
		}));

		// Draw a dashed line from note to entity
		if (note.entityCode) {
			const entityId = this.entityCellIds.get(note.entityCode);
			if (entityId) {
				this.cells.push(buildCell({
					id: this.nextId(),
					value: '',
					style: buildStyle({
						html: 1,
						dashed: 1,
						dashPattern: '1 1',
						endArrow: 'none',
						startArrow: 'none',
					}),
					edge: true,
					parent: this.parentId,
					source: noteId,
					target: entityId,
				}));
			}
		}
	}

	// ── Inheritance edge synthesis ───────────────────────────────────────

	_emitInheritanceEdges(diagram) {
		for (const [code, entity] of diagram.entities) {
			const childId = this.entityCellIds.get(code);
			if (!childId) continue;

			// extends → solid line with hollow triangle on parent side
			for (const parentCode of entity.extends) {
				const parentId = this.entityCellIds.get(parentCode);
				if (!parentId) continue;

				this.cells.push(buildCell({
					id: this.nextId(),
					value: '',
					style: buildStyle({
						html: 1,
						rounded: 0,
						endArrow: 'block',
						endFill: 0,
						startArrow: 'none',
						startFill: 0,
					}),
					edge: true,
					parent: this.parentId,
					source: childId,
					target: parentId,
				}));
			}

			// implements → dashed line with hollow triangle on parent side
			for (const ifaceCode of entity.implements) {
				const ifaceId = this.entityCellIds.get(ifaceCode);
				if (!ifaceId) continue;

				this.cells.push(buildCell({
					id: this.nextId(),
					value: '',
					style: buildStyle({
						html: 1,
						rounded: 0,
						dashed: 1,
						endArrow: 'block',
						endFill: 0,
						startArrow: 'none',
						startFill: 0,
					}),
					edge: true,
					parent: this.parentId,
					source: childId,
					target: ifaceId,
				}));
			}
		}
	}

	// ── Link emission ────────────────────────────────────────────────────

	_emitLink(link) {
		const sourceId = this.entityCellIds.get(link.from);
		const targetId = this.entityCellIds.get(link.to);

		if (!sourceId || !targetId) return;

		const id = this.nextId();

		// Build label from link labels
		let label = '';
		if (link.label) {
			label = xmlEscape(link.label);
		}

		this.cells.push(buildCell({
			id: id,
			value: label,
			style: edgeStyle(link),
			edge: true,
			parent: this.parentId,
			source: sourceId,
			target: targetId,
		}));

		// Emit cardinality labels
		if (link.leftLabel) {
			this._emitEdgeLabel(id, link.leftLabel, -0.8);
		}
		if (link.rightLabel) {
			this._emitEdgeLabel(id, link.rightLabel, 0.8);
		}
	}

	_emitEdgeLabel(edgeId, text, position) {
		this.cells.push(buildCell({
			id: this.nextId(),
			value: xmlEscape(text),
			style: buildStyle({
				edgeLabel: 1,
				html: 1,
				align: 'center',
				verticalAlign: 'middle',
				resizable: 0,
				points: '[]',
			}),
			vertex: true,
			parent: edgeId,
			geometry: {
				x: position,
				y: 0,
				width: 40,
				height: 16,
				relative: true,
			},
		}));
	}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Emit a ClassDiagram model as mxCell XML strings.
 * @param {ClassDiagram} diagram - Parsed class diagram model
 * @param {string} parentId - Parent cell ID for all emitted cells
 * @returns {string[]} Array of mxCell XML strings
 */
export function emitClassDiagram(diagram, parentId) {
	const emitter = new ClassEmitter(parentId);
	return emitter.emit(diagram);
}

export { ClassEmitter, LAYOUT };
