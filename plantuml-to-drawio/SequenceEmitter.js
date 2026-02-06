/**
 * SequenceEmitter.js
 *
 * Converts a SequenceDiagram model into draw.io mxGraph cells.
 *
 * This emitter produces the cell definitions with geometry — performing a
 * basic sequential layout internally. The layout positions participants in
 * columns and processes elements top-to-bottom.
 *
 * The output is an array of cell definition objects that can be passed to
 * MxBuilder to generate XML.
 */

import {
	ParticipantType,
	ArrowHead,
	ArrowBody,
	ArrowPart,
	ArrowDecoration,
	ArrowDirection,
	NotePosition,
	NoteStyle,
	NoteOnArrowPosition,
	LifeEventType,
	GroupingType,
	ExoMessageType,
	Message,
	ExoMessage,
	LifeEvent,
	Fragment,
	Note,
	NoteOnArrow,
	Divider,
	Delay,
	HSpace,
	Reference,
	Box
} from './SequenceModel.js';

import {
	buildCell,
	buildStyle,
	createIdGenerator,
	geom,
	xmlEscape
} from './MxBuilder.js';

// ── Layout constants ───────────────────────────────────────────────────────

const LAYOUT = {
	PARTICIPANT_WIDTH: 120,
	PARTICIPANT_HEIGHT: 40,
	PARTICIPANT_GAP: 40,       // Horizontal gap between participants
	LIFELINE_TOP_MARGIN: 10,   // Gap between participant box and first element
	ROW_HEIGHT: 40,            // Vertical step per message/element
	ACTIVATION_WIDTH: 12,      // Width of activation bar
	NOTE_WIDTH: 120,
	NOTE_HEIGHT: 30,
	NOTE_MARGIN: 10,
	FRAGMENT_PADDING: 10,
	FRAGMENT_HEADER_HEIGHT: 20,
	DIVIDER_HEIGHT: 20,
	DELAY_HEIGHT: 30,
	REF_HEIGHT: 30,
	MARGIN_LEFT: 40,           // Left margin of entire diagram
	MARGIN_TOP: 20,            // Top margin
	EXO_ARROW_LENGTH: 60,     // Length of exo arrows from boundary
	SELF_MESSAGE_WIDTH: 30,   // Width of self-message loop
	SELF_MESSAGE_HEIGHT: 20,  // Height of self-message loop
	ACTOR_WIDTH: 40,
	ACTOR_HEIGHT: 50
};

// ── Style definitions ──────────────────────────────────────────────────────

const STYLES = {
	participant: buildStyle({
		rounded: 1,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	actor: buildStyle({
		shape: 'mxgraph.basic.person',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	boundary: buildStyle({
		shape: 'mxgraph.sysml.port',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	control: buildStyle({
		shape: 'mxgraph.flowchart.on-page_reference',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	entity: buildStyle({
		shape: 'mxgraph.er.entity',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	database: buildStyle({
		shape: 'mxgraph.flowchart.database',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	queue: buildStyle({
		shape: 'mxgraph.flowchart.delay',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	collections: buildStyle({
		shape: 'mxgraph.basic.layered_rect',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#dae8fc',
		strokeColor: '#6c8ebf'
	}),

	lifeline: buildStyle({
		endArrow: 'none',
		dashed: 1,
		strokeColor: '#999999',
		dashPattern: '4 4'
	}),

	activation: buildStyle({
		fillColor: '#e6e6e6',
		strokeColor: '#999999'
	}),

	// Message arrow base styles — specific endArrow/dashed set per message
	messageBase: {
		html: 1,
		verticalAlign: 'bottom',
		endFill: 0,
		rounded: 0
	},

	note: buildStyle({
		shape: 'note',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#fff2cc',
		strokeColor: '#d6b656',
		size: 10
	}),

	hnote: buildStyle({
		shape: 'hexagon',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#fff2cc',
		strokeColor: '#d6b656',
		size: 10,
		perimeter: 'hexagonPerimeter2'
	}),

	rnote: buildStyle({
		rounded: 1,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#fff2cc',
		strokeColor: '#d6b656'
	}),

	divider: buildStyle({
		shape: 'line',
		strokeWidth: 1,
		strokeColor: '#999999',
		dashed: 1,
		labelPosition: 'center',
		align: 'center',
		verticalAlign: 'middle',
		html: 1
	}),

	delay: buildStyle({
		shape: 'line',
		strokeWidth: 0,
		dashed: 1,
		strokeColor: '#999999',
		fillColor: 'none',
		html: 1,
		verticalAlign: 'middle',
		align: 'center'
	}),

	fragment: buildStyle({
		rounded: 0,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: 'none',
		strokeColor: '#666666',
		dashed: 1,
		verticalAlign: 'top',
		align: 'left',
		spacingTop: 0,
		spacingLeft: 5
	}),

	fragmentLabel: buildStyle({
		fillColor: '#e6e6e6',
		strokeColor: '#666666',
		rounded: 0,
		html: 1,
		verticalAlign: 'middle',
		align: 'center'
	}),

	fragmentSeparator: buildStyle({
		shape: 'line',
		strokeWidth: 1,
		strokeColor: '#666666',
		dashed: 1,
		html: 1
	}),

	reference: buildStyle({
		rounded: 0,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#f5f5f5',
		strokeColor: '#666666',
		verticalAlign: 'middle',
		align: 'center'
	}),

	box: buildStyle({
		rounded: 1,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: 'none',
		strokeColor: '#cccccc',
		dashed: 1,
		verticalAlign: 'top',
		align: 'center',
		spacingTop: 2
	}),

	destroy: buildStyle({
		shape: 'mxgraph.basic.x',
		fillColor: '#FF0000',
		strokeColor: '#FF0000'
	})
};

// ── Emitter ────────────────────────────────────────────────────────────────

export class SequenceEmitter {
	constructor(diagram) {
		this.diagram = diagram;
		this.nextId = createIdGenerator('puml');
		this.cells = [];

		// Layout state
		this.participantPositions = new Map(); // code → { x, centerX }
		this.currentY = LAYOUT.MARGIN_TOP;
		this.diagramWidth = 0;
		this.diagramHeight = 0;

		// Lifeline tracking
		this.lifelineIds = new Map(); // code → lifeline cell id
		this.participantHeaderIds = new Map(); // code → header cell id
		this.lifelineStartYOverrides = new Map(); // code → Y for created participants

		// Created participant tracking — so the next message targeting
		// a just-created participant can terminate at the box edge
		this.justCreatedParticipants = new Set();

		// Activation tracking
		this.activeActivations = new Map(); // code → [{id, startY}]
	}

	/**
	 * Emit all cells for the sequence diagram.
	 * Returns an array of XML cell strings.
	 *
	 * Z-order: boxes → vertices (participants, activations, notes,
	 * fragments, etc.) → edges (lifelines, messages, separators).
	 * Edges must come last so they render on top of vertices.
	 */
	emit(parentId) {
		this.parentId = parentId || '1';

		// 1. Calculate participant positions
		this._layoutParticipants();

		// 2. Emit participant headers
		this._emitParticipantHeaders();

		// Start below participant headers
		this.currentY += LAYOUT.PARTICIPANT_HEIGHT + LAYOUT.LIFELINE_TOP_MARGIN;
		const lifelineStartY = this.currentY;

		// 3. Process elements in order
		this._emitElements(this.diagram.elements);

		// 4. Add some bottom margin
		this.currentY += LAYOUT.ROW_HEIGHT;
		this.diagramHeight = this.currentY;

		// 5. Emit lifelines (from header bottom to current Y)
		this._emitLifelines(lifelineStartY, this.currentY);

		// 6. Close any remaining activations
		this._closeAllActivations();

		// 7. Emit boxes (behind everything else)
		const boxCells = this._emitBoxes();

		// 8. Sort for z-order: vertices first, then edges on top
		const isEdge = (xml) => /\bedge="1"/.test(xml);
		const vertices = this.cells.filter(xml => !isEdge(xml));
		const edges = this.cells.filter(xml => isEdge(xml));

		return [...boxCells, ...vertices, ...edges];
	}

	// ── Participant layout ───────────────────────────────────────────────

	_layoutParticipants() {
		const participants = this.diagram.getOrderedParticipants();
		let x = LAYOUT.MARGIN_LEFT;

		for (const p of participants) {
			const width = this._participantWidth(p);
			const centerX = x + width / 2;

			this.participantPositions.set(p.code, {
				x: x,
				centerX: centerX,
				width: width
			});

			x += width + LAYOUT.PARTICIPANT_GAP;
		}

		this.diagramWidth = x - LAYOUT.PARTICIPANT_GAP + LAYOUT.MARGIN_LEFT;
	}

	_participantWidth(p) {
		if (p.type === ParticipantType.ACTOR) {
			return LAYOUT.ACTOR_WIDTH;
		}
		// Estimate width from display name length
		const textWidth = (p.displayName || p.code).length * 8 + 20;
		return Math.max(LAYOUT.PARTICIPANT_WIDTH, textWidth);
	}

	_participantHeight(p) {
		if (p.type === ParticipantType.ACTOR) {
			return LAYOUT.ACTOR_HEIGHT;
		}
		return LAYOUT.PARTICIPANT_HEIGHT;
	}

	// ── Emit participant headers ─────────────────────────────────────────

	_emitParticipantHeaders() {
		for (const [code, p] of this.diagram.participants) {
			// Skip created participants — they will be emitted when
			// the CREATE life event is processed
			if (p.isCreated) continue;

			this._emitSingleParticipantHeader(code, p, LAYOUT.MARGIN_TOP);
		}
	}

	/**
	 * Emit a single participant header box at the given Y position.
	 * For created participants (mid-diagram), the label is placed below
	 * the vertex so the arrow can cleanly terminate at the box edge.
	 */
	_emitSingleParticipantHeader(code, participant, y) {
		const pos = this.participantPositions.get(code);
		const id = this.nextId();
		const height = this._participantHeight(participant);

		let style = this._getParticipantStyle(participant);

		// For created participants, put label below the shape
		if (participant.isCreated) {
			style += 'labelPosition=center;verticalLabelPosition=bottom;align=center;verticalAlign=top;';
		}

		this.cells.push(buildCell({
			id: id,
			value: participant.displayName || participant.code,
			style: style,
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, y, pos.width, height)
		}));

		this.participantHeaderIds.set(code, id);
	}

	_getParticipantStyle(p) {
		let style = STYLES[p.type] || STYLES.participant;
		if (p.color) {
			style = style.replace(/fillColor=[^;]+/, `fillColor=${p.color}`);
		}
		return style;
	}

	// ── Lifelines ────────────────────────────────────────────────────────

	_emitLifelines(startY, endY) {
		for (const [code] of this.diagram.participants) {
			const pos = this.participantPositions.get(code);
			const id = this.nextId();

			// Created participants start their lifeline from below their header
			const lineStartY = this.lifelineStartYOverrides.get(code) || startY;

			this.cells.push(buildCell({
				id: id,
				style: STYLES.lifeline,
				edge: true,
				parent: this.parentId,
				sourcePoint: { x: pos.centerX, y: lineStartY },
				targetPoint: { x: pos.centerX, y: endY }
			}));

			this.lifelineIds.set(code, id);
		}
	}

	// ── Element processing ───────────────────────────────────────────────

	_emitElements(elements) {
		for (const el of elements) {
			if (el instanceof Message) {
				this._emitMessage(el);
			} else if (el instanceof ExoMessage) {
				this._emitExoMessage(el);
			} else if (el instanceof LifeEvent) {
				this._emitLifeEvent(el);
			} else if (el instanceof Fragment) {
				this._emitFragment(el);
			} else if (el instanceof Note) {
				this._emitNote(el);
			} else if (el instanceof Divider) {
				this._emitDivider(el);
			} else if (el instanceof Delay) {
				this._emitDelay(el);
			} else if (el instanceof HSpace) {
				this._emitHSpace(el);
			} else if (el instanceof Reference) {
				this._emitReference(el);
			}
		}
	}

	// ── Messages ─────────────────────────────────────────────────────────

	_emitMessage(msg) {
		if (msg._isReturn) {
			// Return messages: for now, just advance Y
			this.currentY += LAYOUT.ROW_HEIGHT;
			return;
		}

		const fromPos = this.participantPositions.get(msg.from);
		const toPos = this.participantPositions.get(msg.to);

		if (!fromPos || !toPos) return;

		const id = this.nextId();
		const y = this.currentY + LAYOUT.ROW_HEIGHT / 2;

		if (msg.isSelf) {
			this._emitSelfMessage(msg, id, fromPos, y);
		} else {
			const style = this._getMessageStyle(msg.arrow);

			let targetX = toPos.centerX;
			let sourceX = fromPos.centerX;

			// If the target was just created, terminate the arrow at
			// the near edge of the participant box instead of its center
			if (this.justCreatedParticipants.has(msg.to)) {
				targetX = (fromPos.centerX < toPos.centerX)
					? toPos.x               // arrow from left → hit left edge
					: toPos.x + toPos.width; // arrow from right → hit right edge
				this.justCreatedParticipants.delete(msg.to);
			}

			this.cells.push(buildCell({
				id: id,
				value: msg.label,
				style: style,
				edge: true,
				parent: this.parentId,
				sourcePoint: { x: sourceX, y: y },
				targetPoint: { x: targetX, y: y }
			}));
		}

		// Note on arrow
		if (msg.noteOnArrow) {
			this._emitNoteOnArrow(msg.noteOnArrow, fromPos, toPos, y);
		}

		this.currentY += LAYOUT.ROW_HEIGHT;
	}

	_emitSelfMessage(msg, id, pos, y) {
		const style = this._getMessageStyle(msg.arrow);
		const cx = pos.centerX;

		// Self-message: loop that goes right and back
		this.cells.push(buildCell({
			id: id,
			value: msg.label,
			style: style,
			edge: true,
			parent: this.parentId,
			sourcePoint: { x: cx, y: y },
			targetPoint: { x: cx, y: y + LAYOUT.SELF_MESSAGE_HEIGHT },
			waypoints: [
				{ x: cx + LAYOUT.SELF_MESSAGE_WIDTH, y: y },
				{ x: cx + LAYOUT.SELF_MESSAGE_WIDTH, y: y + LAYOUT.SELF_MESSAGE_HEIGHT }
			]
		}));

		// Self messages take extra vertical space
		this.currentY += LAYOUT.SELF_MESSAGE_HEIGHT;
	}

	_emitExoMessage(msg) {
		const pos = this.participantPositions.get(msg.participant);
		if (!pos) return;

		const id = this.nextId();
		const y = this.currentY + LAYOUT.ROW_HEIGHT / 2;

		const style = this._getMessageStyle(msg.arrow);
		let startX, endX;

		switch (msg.exoType) {
			case ExoMessageType.FROM_LEFT:
				startX = 0;
				endX = pos.centerX;
				break;
			case ExoMessageType.TO_LEFT:
				startX = pos.centerX;
				endX = 0;
				break;
			case ExoMessageType.FROM_RIGHT:
				startX = this.diagramWidth;
				endX = pos.centerX;
				break;
			case ExoMessageType.TO_RIGHT:
				startX = pos.centerX;
				endX = this.diagramWidth;
				break;
		}

		this.cells.push(buildCell({
			id: id,
			value: msg.label,
			style: style,
			edge: true,
			parent: this.parentId,
			sourcePoint: { x: startX, y: y },
			targetPoint: { x: endX, y: y }
		}));

		this.currentY += LAYOUT.ROW_HEIGHT;
	}

	_getMessageStyle(arrow) {
		const parts = { ...STYLES.messageBase };

		// Body: solid or dashed
		if (arrow.body === ArrowBody.DOTTED) {
			parts.dashed = 1;
		}

		// Color
		if (arrow.color) {
			parts.strokeColor = arrow.color;
			parts.fontColor = arrow.color;
		}

		// End arrow head
		switch (arrow.head2) {
			case ArrowHead.NORMAL:
				parts.endArrow = 'block';
				parts.endFill = 1;
				break;
			case ArrowHead.ASYNC:
				parts.endArrow = 'open';
				parts.endFill = 0;
				break;
			case ArrowHead.CROSSX:
				parts.endArrow = 'cross';
				parts.endFill = 0;
				break;
			default:
				parts.endArrow = 'none';
		}

		// Start arrow head (for bidirectional or reverse)
		switch (arrow.head1) {
			case ArrowHead.NORMAL:
				parts.startArrow = 'block';
				parts.startFill = 1;
				break;
			case ArrowHead.ASYNC:
				parts.startArrow = 'open';
				parts.startFill = 0;
				break;
			case ArrowHead.CROSSX:
				parts.startArrow = 'cross';
				parts.startFill = 0;
				break;
			default:
				// No start arrow
				break;
		}

		// Circle decorations
		if (arrow.decoration1 === 'circle') {
			parts.startArrow = 'oval';
			parts.startFill = 0;
		}
		if (arrow.decoration2 === 'circle') {
			parts.endArrow = 'oval';
			parts.endFill = 0;
		}

		return buildStyle(parts);
	}

	// ── Life events ──────────────────────────────────────────────────────

	_emitLifeEvent(event) {
		switch (event.type) {
			case LifeEventType.ACTIVATE:
				this._startActivation(event.participant, event.color);
				break;
			case LifeEventType.DEACTIVATE:
				this._endActivation(event.participant);
				break;
			case LifeEventType.DESTROY:
				this._emitDestroy(event.participant);
				break;
			case LifeEventType.CREATE: {
				// Emit the participant header at the current Y position
				const p = this.diagram.participants.get(event.participant);
				if (p) {
					const headerY = this.currentY;
					this._emitSingleParticipantHeader(event.participant, p, headerY);
					// Record where this participant's lifeline should start
					const height = this._participantHeight(p);
					this.lifelineStartYOverrides.set(event.participant, headerY + height);
					// Mark as just-created so the next message targeting it
					// can terminate at the box edge instead of the lifeline center
					this.justCreatedParticipants.add(event.participant);
				}
				break;
			}
		}
	}

	_startActivation(code, color) {
		if (!this.activeActivations.has(code)) {
			this.activeActivations.set(code, []);
		}

		this.activeActivations.get(code).push({
			id: this.nextId(),
			startY: this.currentY,
			color: color
		});
	}

	_endActivation(code) {
		const stack = this.activeActivations.get(code);
		if (!stack || stack.length === 0) return;

		const activation = stack.pop();
		const pos = this.participantPositions.get(code);
		if (!pos) return;

		const x = pos.centerX - LAYOUT.ACTIVATION_WIDTH / 2;
		const height = this.currentY - activation.startY;

		let style = STYLES.activation;
		if (activation.color) {
			style = style.replace(/fillColor=[^;]+/, `fillColor=${activation.color}`);
		}

		this.cells.push(buildCell({
			id: activation.id,
			style: style,
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, activation.startY, LAYOUT.ACTIVATION_WIDTH, Math.max(height, 10))
		}));
	}

	_emitDestroy(code) {
		this._endActivation(code); // Close any activation

		const pos = this.participantPositions.get(code);
		if (!pos) return;

		const id = this.nextId();
		const size = 16;

		this.cells.push(buildCell({
			id: id,
			style: STYLES.destroy,
			vertex: true,
			parent: this.parentId,
			geometry: geom(
				pos.centerX - size / 2,
				this.currentY,
				size,
				size
			)
		}));
	}

	_closeAllActivations() {
		for (const [code, stack] of this.activeActivations) {
			while (stack.length > 0) {
				this._endActivation(code);
			}
		}
	}

	// ── Notes ────────────────────────────────────────────────────────────

	_emitNote(note) {
		const id = this.nextId();

		let style;
		switch (note.style) {
			case NoteStyle.HNOTE: style = STYLES.hnote; break;
			case NoteStyle.RNOTE: style = STYLES.rnote; break;
			default: style = STYLES.note;
		}

		if (note.color) {
			style = style.replace(/fillColor=[^;]+/, `fillColor=${note.color}`);
		}

		let x, y, width, height;
		y = this.currentY;
		height = LAYOUT.NOTE_HEIGHT;
		width = LAYOUT.NOTE_WIDTH;

		if (note.isAcross) {
			// Note across all participants
			x = LAYOUT.MARGIN_LEFT;
			width = this.diagramWidth - 2 * LAYOUT.MARGIN_LEFT;
		} else if (note.participants.length === 2) {
			// Note over two participants
			const pos1 = this.participantPositions.get(note.participants[0]);
			const pos2 = this.participantPositions.get(note.participants[1]);
			if (pos1 && pos2) {
				const left = Math.min(pos1.centerX, pos2.centerX);
				const right = Math.max(pos1.centerX, pos2.centerX);
				x = left;
				width = right - left;
			} else {
				x = LAYOUT.MARGIN_LEFT;
			}
		} else if (note.participants.length === 1) {
			const pos = this.participantPositions.get(note.participants[0]);
			if (pos) {
				switch (note.position) {
					case NotePosition.LEFT:
						x = pos.centerX - LAYOUT.NOTE_WIDTH - LAYOUT.NOTE_MARGIN;
						break;
					case NotePosition.RIGHT:
						x = pos.centerX + LAYOUT.NOTE_MARGIN;
						break;
					case NotePosition.OVER:
						x = pos.centerX - LAYOUT.NOTE_WIDTH / 2;
						break;
				}
			} else {
				x = LAYOUT.MARGIN_LEFT;
			}
		} else {
			x = LAYOUT.MARGIN_LEFT;
		}

		// Estimate height from text lines
		const lineCount = (note.text.match(/\n/g) || []).length + 1;
		height = Math.max(height, lineCount * 16 + 10);

		this.cells.push(buildCell({
			id: id,
			value: note.text.replace(/\n/g, '<br>'),
			style: style,
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, y, width, height)
		}));

		this.currentY += height + 5;
	}

	_emitNoteOnArrow(noteOnArrow, fromPos, toPos, y) {
		const id = this.nextId();

		let style;
		switch (noteOnArrow.style) {
			case NoteStyle.HNOTE: style = STYLES.hnote; break;
			case NoteStyle.RNOTE: style = STYLES.rnote; break;
			default: style = STYLES.note;
		}

		if (noteOnArrow.color) {
			style = style.replace(/fillColor=[^;]+/, `fillColor=${noteOnArrow.color}`);
		}

		// Position relative to the arrow midpoint
		const midX = (fromPos.centerX + (toPos || fromPos).centerX) / 2;
		let x, noteY;

		switch (noteOnArrow.position) {
			case NoteOnArrowPosition.RIGHT:
				x = midX + LAYOUT.NOTE_MARGIN;
				noteY = y - LAYOUT.NOTE_HEIGHT / 2;
				break;
			case NoteOnArrowPosition.LEFT:
				x = midX - LAYOUT.NOTE_WIDTH - LAYOUT.NOTE_MARGIN;
				noteY = y - LAYOUT.NOTE_HEIGHT / 2;
				break;
			case NoteOnArrowPosition.TOP:
				x = midX - LAYOUT.NOTE_WIDTH / 2;
				noteY = y - LAYOUT.NOTE_HEIGHT - 5;
				break;
			case NoteOnArrowPosition.BOTTOM:
				x = midX - LAYOUT.NOTE_WIDTH / 2;
				noteY = y + 5;
				break;
			default:
				x = midX + LAYOUT.NOTE_MARGIN;
				noteY = y - LAYOUT.NOTE_HEIGHT / 2;
		}

		this.cells.push(buildCell({
			id: id,
			value: noteOnArrow.text,
			style: style,
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, noteY, LAYOUT.NOTE_WIDTH, LAYOUT.NOTE_HEIGHT)
		}));
	}

	// ── Fragments ────────────────────────────────────────────────────────

	_emitFragment(fragment) {
		const startY = this.currentY;
		const fragmentId = this.nextId();

		// Determine x span: from leftmost to rightmost participant in content
		// For now, span the full diagram width
		const x = LAYOUT.MARGIN_LEFT - LAYOUT.FRAGMENT_PADDING;
		const width = this.diagramWidth - 2 * LAYOUT.MARGIN_LEFT + 2 * LAYOUT.FRAGMENT_PADDING;

		// Add header space
		this.currentY += LAYOUT.FRAGMENT_HEADER_HEIGHT;

		// Process sections
		const separatorYs = [];
		for (let i = 0; i < fragment.sections.length; i++) {
			const section = fragment.sections[i];

			if (i > 0) {
				// Record separator Y position
				separatorYs.push(this.currentY);
				this.currentY += 5; // Small gap after separator
			}

			// Process section elements
			this._emitElements(section.elements);
		}

		// End fragment
		this.currentY += LAYOUT.FRAGMENT_PADDING;
		const height = this.currentY - startY;

		// Fragment container
		let style = STYLES.fragment;
		if (fragment.color) {
			style = style.replace(/strokeColor=[^;]+/, `strokeColor=${fragment.color}`);
		}

		this.cells.push(buildCell({
			id: fragmentId,
			value: '',
			style: style,
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, startY, width, height)
		}));

		// Fragment label (top-left tag)
		const labelText = fragment.type.toUpperCase() +
			(fragment.label ? ` [${fragment.label}]` : '');

		this.cells.push(buildCell({
			id: this.nextId(),
			value: labelText,
			style: STYLES.fragmentLabel,
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, startY, Math.max(80, labelText.length * 7 + 20), LAYOUT.FRAGMENT_HEADER_HEIGHT)
		}));

		// Emit separators for else/also sections
		for (let i = 0; i < separatorYs.length; i++) {
			const sepY = separatorYs[i];
			const sectionLabel = fragment.sections[i + 1]?.condition || '';

			this.cells.push(buildCell({
				id: this.nextId(),
				value: sectionLabel ? `[${sectionLabel}]` : '',
				style: STYLES.fragmentSeparator,
				edge: true,
				parent: this.parentId,
				sourcePoint: { x: x, y: sepY },
				targetPoint: { x: x + width, y: sepY }
			}));
		}
	}

	// ── Divider ──────────────────────────────────────────────────────────

	_emitDivider(divider) {
		const id = this.nextId();
		const y = this.currentY;

		this.cells.push(buildCell({
			id: id,
			value: divider.label,
			style: STYLES.divider,
			vertex: true,
			parent: this.parentId,
			geometry: geom(
				LAYOUT.MARGIN_LEFT,
				y,
				this.diagramWidth - 2 * LAYOUT.MARGIN_LEFT,
				LAYOUT.DIVIDER_HEIGHT
			)
		}));

		this.currentY += LAYOUT.DIVIDER_HEIGHT;
	}

	// ── Delay ────────────────────────────────────────────────────────────

	_emitDelay(delay) {
		if (delay.label) {
			const id = this.nextId();
			this.cells.push(buildCell({
				id: id,
				value: delay.label,
				style: STYLES.delay,
				vertex: true,
				parent: this.parentId,
				geometry: geom(
					LAYOUT.MARGIN_LEFT,
					this.currentY,
					this.diagramWidth - 2 * LAYOUT.MARGIN_LEFT,
					LAYOUT.DELAY_HEIGHT
				)
			}));
		}

		this.currentY += LAYOUT.DELAY_HEIGHT;
	}

	// ── HSpace ───────────────────────────────────────────────────────────

	_emitHSpace(hspace) {
		this.currentY += hspace.size || LAYOUT.ROW_HEIGHT;
	}

	// ── Reference ────────────────────────────────────────────────────────

	_emitReference(ref) {
		const id = this.nextId();

		// Span from first to last referenced participant
		let x = LAYOUT.MARGIN_LEFT;
		let width = this.diagramWidth - 2 * LAYOUT.MARGIN_LEFT;

		if (ref.participants.length >= 2) {
			const pos1 = this.participantPositions.get(ref.participants[0]);
			const pos2 = this.participantPositions.get(ref.participants[ref.participants.length - 1]);
			if (pos1 && pos2) {
				const left = Math.min(pos1.x, pos2.x);
				const right = Math.max(pos1.x + pos1.width, pos2.x + pos2.width);
				x = left - LAYOUT.FRAGMENT_PADDING;
				width = right - left + 2 * LAYOUT.FRAGMENT_PADDING;
			}
		}

		let style = STYLES.reference;
		if (ref.color) {
			style = style.replace(/fillColor=[^;]+/, `fillColor=${ref.color}`);
		}

		this.cells.push(buildCell({
			id: id,
			value: `ref: ${ref.text}`,
			style: style,
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, this.currentY, width, LAYOUT.REF_HEIGHT)
		}));

		this.currentY += LAYOUT.REF_HEIGHT + 5;
	}

	// ── Boxes ────────────────────────────────────────────────────────────

	_emitBoxes() {
		const boxCells = [];

		for (const box of this.diagram.boxes) {
			if (box.participants.length === 0) continue;

			const id = this.nextId();

			// Calculate bounds from participant positions
			let minX = Infinity, maxX = 0;
			for (const code of box.participants) {
				const pos = this.participantPositions.get(code);
				if (pos) {
					minX = Math.min(minX, pos.x);
					maxX = Math.max(maxX, pos.x + pos.width);
				}
			}

			const padding = 10;
			const x = minX - padding;
			const width = maxX - minX + 2 * padding;

			let style = STYLES.box;
			if (box.color) {
				style = style.replace(/strokeColor=[^;]+/, `strokeColor=${box.color}`);
			}

			boxCells.push(buildCell({
				id: id,
				value: box.title,
				style: style,
				vertex: true,
				parent: this.parentId,
				geometry: geom(x, LAYOUT.MARGIN_TOP - 15, width, this.diagramHeight - LAYOUT.MARGIN_TOP + 20)
			}));
		}

		return boxCells;
	}
}

/**
 * Convenience function: emit a SequenceDiagram model to cell XML strings.
 */
export function emitSequenceDiagram(diagram, parentId) {
	const emitter = new SequenceEmitter(diagram);
	return emitter.emit(parentId);
}
