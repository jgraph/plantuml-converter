/**
 * TimingEmitter.js
 *
 * Emits mxCell XML strings from a TimingDiagram model.
 *
 * Renders waveform-style timing diagrams with:
 *   - Players stacked vertically, each in a lane with a label on the left
 *   - Shared horizontal time axis at the bottom
 *   - Waveform shapes per player type (stepped lines, square waves, polylines)
 *   - Overlay elements: highlights, constraints, messages, notes
 *
 * Z-order: highlights → lane backgrounds → waveforms → state labels →
 *          notes → constraints → messages → time axis
 *
 * Exports emitTimingDiagram(model, parentId) → string[]
 */

import { PlayerType, NotePosition } from './TimingModel.js';

import {
	buildCell,
	buildStyle,
	createIdGenerator,
	geom,
	normalizeColor,
	xmlEscape,
} from '../../MxBuilder.js';

// ── Layout constants ─────────────────────────────────────────────────────────

const L = Object.freeze({
	LABEL_WIDTH:        120,
	PLAYER_GAP:          20,
	WAVEFORM_LEFT:      140,
	TIME_UNIT_WIDTH:     40,
	ROBUST_LEVEL_H:      20,
	ROBUST_MIN_H:        60,
	ROBUST_PAD:           5,
	CONCISE_H:           30,
	CLOCK_H:             40,
	BINARY_H:            30,
	ANALOG_H:            60,
	RECTANGLE_H:         30,
	AXIS_H:              30,
	MARGIN:              20,
	TRANSITION_SLANT:     4,
	NOTE_WIDTH:         140,
	NOTE_MIN_HEIGHT:     40,
	NOTE_LINE_HEIGHT:    16,
	NOTE_GAP:            10,
	CONSTRAINT_OFFSET:   20,
	TICK_HEIGHT:          8,
	LABEL_FONT_SIZE:     12,
	STATE_FONT_SIZE:     10,
	AXIS_FONT_SIZE:       9,
});

// ── Style helpers ────────────────────────────────────────────────────────────

function playerLabelStyle() {
	return {
		text: null,
		html: 1,
		align: 'right',
		verticalAlign: 'middle',
		fillColor: 'none',
		strokeColor: 'none',
		fontStyle: 1,
		fontSize: L.LABEL_FONT_SIZE,
	};
}

function laneBackgroundStyle(color) {
	return {
		rounded: 0,
		fillColor: color ? normalizeColor(color) : '#FAFAFA',
		strokeColor: '#E0E0E0',
		opacity: 50,
	};
}

function waveformLineStyle() {
	return {
		html: 1,
		endArrow: 'none',
		endFill: 0,
		strokeColor: '#000000',
		strokeWidth: 1.5,
	};
}

function waveformTransitionStyle() {
	return {
		html: 1,
		endArrow: 'none',
		endFill: 0,
		strokeColor: '#000000',
		strokeWidth: 1.5,
	};
}

function stateLabelStyle() {
	return {
		text: null,
		html: 1,
		align: 'center',
		verticalAlign: 'middle',
		fillColor: 'none',
		strokeColor: 'none',
		fontSize: L.STATE_FONT_SIZE,
	};
}

function conciseBarStyle(color) {
	return {
		rounded: 0,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: color ? normalizeColor(color) : '#E1F5FE',
		strokeColor: '#0288D1',
		fontSize: L.STATE_FONT_SIZE,
	};
}

function rectangleBarStyle(color) {
	return {
		rounded: 0,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: color ? normalizeColor(color) : '#FFF3E0',
		strokeColor: '#F57C00',
		fontSize: L.STATE_FONT_SIZE,
	};
}

function highlightStyle(color) {
	return {
		rounded: 0,
		fillColor: color ? normalizeColor(color) : '#FFD700',
		strokeColor: 'none',
		opacity: 30,
	};
}

function constraintStyle() {
	return {
		html: 1,
		endArrow: 'block',
		startArrow: 'block',
		endFill: 1,
		startFill: 1,
		strokeColor: '#FF0000',
		fontColor: '#FF0000',
		fontSize: L.STATE_FONT_SIZE,
	};
}

function messageStyle() {
	return {
		html: 1,
		endArrow: 'block',
		endFill: 1,
		strokeColor: '#333333',
		fontSize: L.STATE_FONT_SIZE,
	};
}

function noteStyle(color) {
	return {
		shape: 'note',
		fillColor: color ? normalizeColor(color) : '#FFF2CC',
		strokeColor: color ? normalizeColor(color) : '#D6B656',
		whiteSpace: 'wrap',
		html: 1,
		size: 14,
	};
}

function axisLineStyle() {
	return {
		html: 1,
		endArrow: 'none',
		endFill: 0,
		strokeColor: '#999999',
		strokeWidth: 1,
	};
}

function axisTickStyle() {
	return {
		html: 1,
		endArrow: 'none',
		endFill: 0,
		strokeColor: '#999999',
		strokeWidth: 1,
	};
}

function axisLabelStyle() {
	return {
		text: null,
		html: 1,
		align: 'center',
		verticalAlign: 'top',
		fillColor: 'none',
		strokeColor: 'none',
		fontSize: L.AXIS_FONT_SIZE,
	};
}

function titleStyle() {
	return {
		text: null,
		html: 1,
		align: 'center',
		verticalAlign: 'middle',
		fontStyle: 1,
		fontSize: 16,
		fillColor: 'none',
		strokeColor: 'none',
	};
}

function highlightCaptionStyle() {
	return {
		text: null,
		html: 1,
		align: 'center',
		verticalAlign: 'top',
		fillColor: 'none',
		strokeColor: 'none',
		fontSize: L.STATE_FONT_SIZE,
		fontStyle: 2,
	};
}

// ── Emitter class ────────────────────────────────────────────────────────────

class TimingEmitter {
	constructor(parentId) {
		this.parentId = parentId;
		this.nextId = createIdGenerator('puml');
		this.cells = [];
		this.diagram = null;

		// Resolved layout state
		this.timePoints = [];      // sorted unique time values
		this.timeMin = 0;
		this.timeMax = 0;
		this.waveformWidth = 0;
		this.playerLayouts = [];   // {player, y, height}
		this.totalHeight = 0;
	}

	emit(diagram) {
		this.diagram = diagram;

		if (diagram.players.length === 0) return this.cells;

		// 1. Resolve time axis
		this._resolveTimeAxis();

		// 2. Measure and place players
		this._layoutPlayers();

		// 3. Emit title
		if (diagram.title) {
			this._emitTitle(diagram.title);
		}

		// 4. Emit in z-order
		this._emitHighlights();
		this._emitLaneBackgrounds();
		this._emitWaveforms();
		this._emitNotes();
		this._emitConstraints();
		this._emitMessages();

		if (diagram.hideTimeAxis === false) {
			this._emitTimeAxis();
		}

		// 5. Emit player labels (on top so they're readable)
		this._emitPlayerLabels();

		return this.cells;
	}

	// ── Time axis resolution ──────────────────────────────────────────────

	_resolveTimeAxis() {
		const times = new Set();

		for (const player of this.diagram.players) {
			for (const sc of player.stateChanges) {
				times.add(sc.time);
			}
			// For clocks, add transitions within visible range
			if (player.type === 'clock' && player.clockPeriod) {
				// Will be handled during waveform emission
			}
		}

		for (const c of this.diagram.constraints) {
			times.add(c.time1);
			times.add(c.time2);
		}

		for (const m of this.diagram.messages) {
			times.add(m.fromTime);
			times.add(m.toTime);
		}

		for (const h of this.diagram.highlights) {
			times.add(h.startTime);
			times.add(h.endTime);
		}

		this.timePoints = [...times].sort((a, b) => a - b);

		if (this.timePoints.length === 0) {
			this.timeMin = 0;
			this.timeMax = 0;
		} else {
			this.timeMin = this.timePoints[0];
			this.timeMax = this.timePoints[this.timePoints.length - 1];
		}

		this.waveformWidth = (this.timeMax - this.timeMin) * L.TIME_UNIT_WIDTH;
		if (this.waveformWidth < 200) this.waveformWidth = 200;
	}

	_timeToX(time) {
		if (this.timeMax === this.timeMin) return L.WAVEFORM_LEFT;
		return L.WAVEFORM_LEFT + (time - this.timeMin) * L.TIME_UNIT_WIDTH;
	}

	// ── Player layout ─────────────────────────────────────────────────────

	_layoutPlayers() {
		this.playerLayouts = [];
		let y = L.MARGIN;

		if (this.diagram.title) {
			y += 30; // space for title
		}

		for (const player of this.diagram.players) {
			const height = this._playerHeight(player);
			this.playerLayouts.push({ player, y, height });
			y += height + L.PLAYER_GAP;
		}

		this.totalHeight = y;
	}

	_playerHeight(player) {
		switch (player.type) {
			case 'robust': {
				const stateCount = Math.max(2, player.states.length);
				return Math.max(L.ROBUST_MIN_H, stateCount * L.ROBUST_LEVEL_H + L.ROBUST_PAD * 2);
			}
			case 'concise':
				return L.CONCISE_H;
			case 'clock':
				return L.CLOCK_H;
			case 'binary':
				return L.BINARY_H;
			case 'analog':
				return L.ANALOG_H;
			case 'rectangle':
				return L.RECTANGLE_H;
			default:
				return L.CONCISE_H;
		}
	}

	_getPlayerLayout(code) {
		return this.playerLayouts.find(pl => pl.player.code === code) || null;
	}

	// ── State-to-Y mapping (for robust/binary) ───────────────────────────

	_stateToY(player, state, laneY, laneHeight) {
		const states = player.states;
		if (states.length === 0) return laneY + laneHeight / 2;

		const idx = states.indexOf(state);
		if (idx < 0) {
			// Unknown state — put at bottom
			return laneY + laneHeight - L.ROBUST_PAD;
		}

		// States go top-to-bottom in declared order
		const usableH = laneHeight - L.ROBUST_PAD * 2;
		const step = states.length > 1 ? usableH / (states.length - 1) : 0;
		return laneY + L.ROBUST_PAD + idx * step;
	}

	// ── Emit title ────────────────────────────────────────────────────────

	_emitTitle(title) {
		this.cells.push(buildCell({
			id: this.nextId(),
			value: xmlEscape(title),
			style: buildStyle(titleStyle()),
			vertex: true,
			parent: this.parentId,
			geometry: geom(L.MARGIN, L.MARGIN, L.WAVEFORM_LEFT + this.waveformWidth, 25),
		}));
	}

	// ── Emit highlights ───────────────────────────────────────────────────

	_emitHighlights() {
		for (const hl of this.diagram.highlights) {
			const x1 = this._timeToX(hl.startTime);
			const x2 = this._timeToX(hl.endTime);
			const topY = this.playerLayouts.length > 0 ? this.playerLayouts[0].y : L.MARGIN;
			const lastPl = this.playerLayouts[this.playerLayouts.length - 1];
			const bottomY = lastPl ? lastPl.y + lastPl.height : L.MARGIN + 100;

			this.cells.push(buildCell({
				id: this.nextId(),
				value: '',
				style: buildStyle(highlightStyle(hl.color)),
				vertex: true,
				parent: this.parentId,
				geometry: geom(x1, topY, x2 - x1, bottomY - topY),
			}));

			if (hl.caption) {
				this.cells.push(buildCell({
					id: this.nextId(),
					value: xmlEscape(hl.caption),
					style: buildStyle(highlightCaptionStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(x1, bottomY + 2, x2 - x1, 16),
				}));
			}
		}
	}

	// ── Emit lane backgrounds ─────────────────────────────────────────────

	_emitLaneBackgrounds() {
		for (const pl of this.playerLayouts) {
			this.cells.push(buildCell({
				id: this.nextId(),
				value: '',
				style: buildStyle(laneBackgroundStyle(pl.player.color)),
				vertex: true,
				parent: this.parentId,
				geometry: geom(
					L.WAVEFORM_LEFT,
					pl.y,
					this.waveformWidth,
					pl.height
				),
			}));
		}
	}

	// ── Emit player labels ────────────────────────────────────────────────

	_emitPlayerLabels() {
		for (const pl of this.playerLayouts) {
			this.cells.push(buildCell({
				id: this.nextId(),
				value: xmlEscape(pl.player.displayName),
				style: buildStyle(playerLabelStyle()),
				vertex: true,
				parent: this.parentId,
				geometry: geom(L.MARGIN, pl.y, L.LABEL_WIDTH - 10, pl.height),
			}));
		}
	}

	// ── Emit waveforms ────────────────────────────────────────────────────

	_emitWaveforms() {
		for (const pl of this.playerLayouts) {
			switch (pl.player.type) {
				case 'robust':
					this._emitRobustWaveform(pl);
					break;
				case 'concise':
					this._emitConciseWaveform(pl);
					break;
				case 'clock':
					this._emitClockWaveform(pl);
					break;
				case 'binary':
					this._emitBinaryWaveform(pl);
					break;
				case 'analog':
					this._emitAnalogWaveform(pl);
					break;
				case 'rectangle':
					this._emitRectangleWaveform(pl);
					break;
			}
		}
	}

	_emitRobustWaveform(pl) {
		const { player, y, height } = pl;
		const changes = player.stateChanges;

		if (changes.length === 0) return;

		const waveEndX = L.WAVEFORM_LEFT + this.waveformWidth;

		for (let i = 0; i < changes.length; i++) {
			const sc = changes[i];
			const nextSc = i + 1 < changes.length ? changes[i + 1] : null;

			const x1 = this._timeToX(sc.time);
			const x2 = nextSc ? this._timeToX(nextSc.time) : waveEndX;
			const stateY = this._stateToY(player, sc.state, y, height);

			// Horizontal line at state level
			if (x2 > x1) {
				this.cells.push(buildCell({
					id: this.nextId(),
					edge: true,
					parent: this.parentId,
					style: buildStyle(waveformLineStyle()),
					sourcePoint: { x: x1, y: stateY },
					targetPoint: { x: x2, y: stateY },
				}));
			}

			// State label centered on the segment
			const segWidth = x2 - x1;
			if (segWidth > 20) {
				const label = player.stateAliases.get(sc.state) || sc.state;
				this.cells.push(buildCell({
					id: this.nextId(),
					value: xmlEscape(label),
					style: buildStyle({
						...stateLabelStyle(),
						labelBackgroundColor: '#ffffff',
					}),
					vertex: true,
					parent: this.parentId,
					geometry: geom(x1, stateY - 8, segWidth, 16),
				}));
			}

			// Diagonal transition to next state
			if (nextSc && sc.state !== nextSc.state) {
				const nextY = this._stateToY(player, nextSc.state, y, height);
				this.cells.push(buildCell({
					id: this.nextId(),
					edge: true,
					parent: this.parentId,
					style: buildStyle(waveformTransitionStyle()),
					sourcePoint: { x: x2, y: stateY },
					targetPoint: { x: x2, y: nextY },
				}));
			}
		}
	}

	_emitConciseWaveform(pl) {
		const { player, y, height } = pl;
		const changes = player.stateChanges;

		if (changes.length === 0) return;

		const waveEndX = L.WAVEFORM_LEFT + this.waveformWidth;
		const barY = y + 2;
		const barH = height - 4;

		for (let i = 0; i < changes.length; i++) {
			const sc = changes[i];
			const nextSc = i + 1 < changes.length ? changes[i + 1] : null;

			const x1 = this._timeToX(sc.time);
			const x2 = nextSc ? this._timeToX(nextSc.time) : waveEndX;
			const barW = x2 - x1;

			if (barW < 1) continue;

			const label = player.stateAliases.get(sc.state) || sc.state;

			this.cells.push(buildCell({
				id: this.nextId(),
				value: xmlEscape(label),
				style: buildStyle(conciseBarStyle(sc.color)),
				vertex: true,
				parent: this.parentId,
				geometry: geom(x1, barY, barW, barH),
			}));
		}
	}

	_emitClockWaveform(pl) {
		const { player, y, height } = pl;
		const period = player.clockPeriod || 10;
		const pulse = player.clockPulse != null ? player.clockPulse : period / 2;
		const offset = player.clockOffset || 0;

		const highY = y + 4;
		const lowY = y + height - 4;
		const startX = L.WAVEFORM_LEFT;
		const endX = L.WAVEFORM_LEFT + this.waveformWidth;

		// Generate square wave transitions
		const transitions = [];
		let t = this.timeMin - offset;

		// Align to period boundary before timeMin
		if (t < this.timeMin - period) {
			t = this.timeMin - (this.timeMin % period) - offset;
		}

		while (t <= this.timeMax + period) {
			const cycleStart = t + offset;
			transitions.push({ time: cycleStart, high: true });
			transitions.push({ time: cycleStart + pulse, high: false });
			t += period;
		}

		// Filter to visible range and sort
		const visible = transitions
			.filter(tr => tr.time >= this.timeMin && tr.time <= this.timeMax)
			.sort((a, b) => a.time - b.time);

		// Determine initial state at timeMin
		const tRel = ((this.timeMin - offset) % period + period) % period;
		let currentHigh = tRel < pulse;

		// Draw from startX
		let prevX = startX;
		let prevY = currentHigh ? highY : lowY;

		for (const tr of visible) {
			const x = this._timeToX(tr.time);

			// Horizontal segment
			if (x > prevX) {
				this.cells.push(buildCell({
					id: this.nextId(),
					edge: true,
					parent: this.parentId,
					style: buildStyle(waveformLineStyle()),
					sourcePoint: { x: prevX, y: prevY },
					targetPoint: { x: x, y: prevY },
				}));
			}

			// Vertical transition
			const newY = tr.high ? highY : lowY;
			if (newY !== prevY) {
				this.cells.push(buildCell({
					id: this.nextId(),
					edge: true,
					parent: this.parentId,
					style: buildStyle(waveformTransitionStyle()),
					sourcePoint: { x: x, y: prevY },
					targetPoint: { x: x, y: newY },
				}));
			}

			prevX = x;
			prevY = newY;
			currentHigh = tr.high;
		}

		// Final horizontal segment to end
		if (prevX < endX) {
			this.cells.push(buildCell({
				id: this.nextId(),
				edge: true,
				parent: this.parentId,
				style: buildStyle(waveformLineStyle()),
				sourcePoint: { x: prevX, y: prevY },
				targetPoint: { x: endX, y: prevY },
			}));
		}
	}

	_emitBinaryWaveform(pl) {
		const { player, y, height } = pl;
		const changes = player.stateChanges;

		if (changes.length === 0) return;

		const highY = y + 4;
		const lowY = y + height - 4;
		const waveEndX = L.WAVEFORM_LEFT + this.waveformWidth;

		for (let i = 0; i < changes.length; i++) {
			const sc = changes[i];
			const nextSc = i + 1 < changes.length ? changes[i + 1] : null;

			const x1 = this._timeToX(sc.time);
			const x2 = nextSc ? this._timeToX(nextSc.time) : waveEndX;
			const isHigh = sc.state === 'high' || sc.state === '1';
			const stateY = isHigh ? highY : lowY;

			// Horizontal line at level
			if (x2 > x1) {
				this.cells.push(buildCell({
					id: this.nextId(),
					edge: true,
					parent: this.parentId,
					style: buildStyle(waveformLineStyle()),
					sourcePoint: { x: x1, y: stateY },
					targetPoint: { x: x2, y: stateY },
				}));
			}

			// Vertical transition to next state
			if (nextSc) {
				const nextHigh = nextSc.state === 'high' || nextSc.state === '1';
				const nextY = nextHigh ? highY : lowY;
				if (nextY !== stateY) {
					this.cells.push(buildCell({
						id: this.nextId(),
						edge: true,
						parent: this.parentId,
						style: buildStyle(waveformTransitionStyle()),
						sourcePoint: { x: x2, y: stateY },
						targetPoint: { x: x2, y: nextY },
					}));
				}
			}
		}
	}

	_emitAnalogWaveform(pl) {
		const { player, y, height } = pl;
		const changes = player.stateChanges;

		if (changes.length === 0) return;

		const topY = y + 4;
		const bottomY = y + height - 4;
		const rangeH = bottomY - topY;

		const minVal = player.analogStart != null ? player.analogStart : 0;
		const maxVal = player.analogEnd != null ? player.analogEnd : 100;
		const valRange = maxVal - minVal;

		const valueToY = (val) => {
			if (valRange === 0) return topY + rangeH / 2;
			// Higher values at top
			const fraction = (val - minVal) / valRange;
			return bottomY - fraction * rangeH;
		};

		// Draw line segments between consecutive points
		for (let i = 0; i < changes.length - 1; i++) {
			const sc = changes[i];
			const nextSc = changes[i + 1];

			const x1 = this._timeToX(sc.time);
			const x2 = this._timeToX(nextSc.time);
			const y1 = valueToY(parseFloat(sc.state));
			const y2 = valueToY(parseFloat(nextSc.state));

			this.cells.push(buildCell({
				id: this.nextId(),
				edge: true,
				parent: this.parentId,
				style: buildStyle({
					html: 1,
					endArrow: 'none',
					endFill: 0,
					strokeColor: '#000000',
					strokeWidth: 1.5,
				}),
				sourcePoint: { x: x1, y: y1 },
				targetPoint: { x: x2, y: y2 },
			}));
		}

		// Extend last point to end
		if (changes.length > 0) {
			const last = changes[changes.length - 1];
			const lastX = this._timeToX(last.time);
			const lastY = valueToY(parseFloat(last.state));
			const endX = L.WAVEFORM_LEFT + this.waveformWidth;

			if (endX > lastX) {
				this.cells.push(buildCell({
					id: this.nextId(),
					edge: true,
					parent: this.parentId,
					style: buildStyle({
						html: 1,
						endArrow: 'none',
						endFill: 0,
						strokeColor: '#000000',
						strokeWidth: 1.5,
					}),
					sourcePoint: { x: lastX, y: lastY },
					targetPoint: { x: endX, y: lastY },
				}));
			}
		}
	}

	_emitRectangleWaveform(pl) {
		const { player, y, height } = pl;
		const changes = player.stateChanges;

		if (changes.length === 0) return;

		const waveEndX = L.WAVEFORM_LEFT + this.waveformWidth;
		const barY = y + 2;
		const barH = height - 4;

		for (let i = 0; i < changes.length; i++) {
			const sc = changes[i];
			const nextSc = i + 1 < changes.length ? changes[i + 1] : null;

			const x1 = this._timeToX(sc.time);
			const x2 = nextSc ? this._timeToX(nextSc.time) : waveEndX;
			const barW = x2 - x1;

			if (barW < 1) continue;

			const label = player.stateAliases.get(sc.state) || sc.state;

			this.cells.push(buildCell({
				id: this.nextId(),
				value: xmlEscape(label),
				style: buildStyle(rectangleBarStyle(sc.color)),
				vertex: true,
				parent: this.parentId,
				geometry: geom(x1, barY, barW, barH),
			}));
		}
	}

	// ── Emit notes ────────────────────────────────────────────────────────

	_emitNotes() {
		for (const note of this.diagram.notes) {
			const pl = this._getPlayerLayout(note.playerCode);
			if (pl == null) continue;

			const lineCount = note.text.split('\n').length;
			const noteH = Math.max(L.NOTE_MIN_HEIGHT, lineCount * L.NOTE_LINE_HEIGHT + 16);

			let noteX = L.WAVEFORM_LEFT + this.waveformWidth + L.NOTE_GAP;
			let noteY;

			if (note.position === NotePosition.TOP) {
				noteY = pl.y - noteH - L.NOTE_GAP;
				if (noteY < 0) noteY = pl.y;
			} else {
				noteY = pl.y + pl.height + L.NOTE_GAP;
			}

			this.cells.push(buildCell({
				id: this.nextId(),
				value: xmlEscape(note.text),
				style: buildStyle(noteStyle(note.color)),
				vertex: true,
				parent: this.parentId,
				geometry: geom(noteX, noteY, L.NOTE_WIDTH, noteH),
			}));
		}
	}

	// ── Emit constraints ──────────────────────────────────────────────────

	_emitConstraints() {
		let constraintIdx = 0;
		for (const c of this.diagram.constraints) {
			const x1 = this._timeToX(c.time1);
			const x2 = this._timeToX(c.time2);

			// Position constraint below the last player lane
			const lastPl = this.playerLayouts[this.playerLayouts.length - 1];
			const baseY = lastPl
				? lastPl.y + lastPl.height + L.CONSTRAINT_OFFSET + constraintIdx * 25
				: L.MARGIN + 100;

			this.cells.push(buildCell({
				id: this.nextId(),
				value: c.label ? xmlEscape(c.label) : '',
				edge: true,
				parent: this.parentId,
				style: buildStyle(constraintStyle()),
				sourcePoint: { x: x1, y: baseY },
				targetPoint: { x: x2, y: baseY },
			}));

			constraintIdx++;
		}
	}

	// ── Emit messages ─────────────────────────────────────────────────────

	_emitMessages() {
		for (const msg of this.diagram.messages) {
			const fromPl = this._getPlayerLayout(msg.fromPlayer);
			const toPl = this._getPlayerLayout(msg.toPlayer);
			if (fromPl == null || toPl == null) continue;

			const x1 = this._timeToX(msg.fromTime);
			const x2 = this._timeToX(msg.toTime);
			const y1 = fromPl.y + fromPl.height / 2;
			const y2 = toPl.y + toPl.height / 2;

			this.cells.push(buildCell({
				id: this.nextId(),
				value: msg.label ? xmlEscape(msg.label) : '',
				edge: true,
				parent: this.parentId,
				style: buildStyle(messageStyle()),
				sourcePoint: { x: x1, y: y1 },
				targetPoint: { x: x2, y: y2 },
			}));
		}
	}

	// ── Emit time axis ────────────────────────────────────────────────────

	_emitTimeAxis() {
		const lastPl = this.playerLayouts[this.playerLayouts.length - 1];
		const axisY = lastPl
			? lastPl.y + lastPl.height + L.PLAYER_GAP
			: L.MARGIN + 100;

		// Add extra offset for constraints
		const constraintSpace = this.diagram.constraints.length > 0
			? L.CONSTRAINT_OFFSET + this.diagram.constraints.length * 25
			: 0;
		const effectiveAxisY = axisY + constraintSpace;

		const startX = L.WAVEFORM_LEFT;
		const endX = L.WAVEFORM_LEFT + this.waveformWidth;

		// Main axis line
		this.cells.push(buildCell({
			id: this.nextId(),
			edge: true,
			parent: this.parentId,
			style: buildStyle(axisLineStyle()),
			sourcePoint: { x: startX, y: effectiveAxisY },
			targetPoint: { x: endX, y: effectiveAxisY },
		}));

		// Tick marks and labels at each time point
		for (const t of this.timePoints) {
			const x = this._timeToX(t);

			// Tick mark
			this.cells.push(buildCell({
				id: this.nextId(),
				edge: true,
				parent: this.parentId,
				style: buildStyle(axisTickStyle()),
				sourcePoint: { x, y: effectiveAxisY },
				targetPoint: { x, y: effectiveAxisY + L.TICK_HEIGHT },
			}));

			// Label
			const label = Number.isInteger(t) ? String(t) : t.toFixed(1);
			this.cells.push(buildCell({
				id: this.nextId(),
				value: label,
				style: buildStyle(axisLabelStyle()),
				vertex: true,
				parent: this.parentId,
				geometry: geom(x - 15, effectiveAxisY + L.TICK_HEIGHT + 2, 30, 14),
			}));
		}
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

export function emitTimingDiagram(model, parentId) {
	const emitter = new TimingEmitter(parentId);
	return emitter.emit(model);
}

export { TimingEmitter };
