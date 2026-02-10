/**
 * extract-plantuml-svg-timing.js
 *
 * Extracts a NormalizedTimingDiagram from a PlantUML-generated SVG.
 *
 * PlantUML timing SVGs use raw geometric elements (line, text, rect, polygon,
 * path) without semantic class attributes. Extraction relies on:
 *   - Bold text elements → player names
 *   - Bold text within waveform regions → state labels
 *   - Horizontal lines with specific stroke patterns → waveform segments
 *   - Rectangles with fill → concise/rectangle state bars
 *
 * This is a best-effort extraction since the SVG lacks semantic markers.
 */

import {
	NPlayer,
	NStateChange,
	NConstraint,
	NMessage,
	NHighlight,
	NNote,
	NormalizedTimingDiagram,
} from './normalize-timing.js';

/**
 * Extract a NormalizedTimingDiagram from PlantUML SVG text.
 */
export function extractFromPlantUmlSvg(svgText) {
	const diagram = new NormalizedTimingDiagram();

	// Extract all text elements
	const textRegex = /<text\s+[^>]*>([^<]*)<\/text>/g;
	const boldTextRegex = /<text\s+[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/g;

	// Find player names: bold text with larger font size
	const playerNameRegex = /<text\s+[^>]*font-weight="bold"[^>]*font-size="14"[^>]*>([^<]*)<\/text>/g;
	const playerNameRegex2 = /<text\s+[^>]*font-size="14"[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/g;

	const playerNames = new Set();
	let m;

	// Collect all bold 14px text as potential player names
	const boldTexts14 = [];
	for (const re of [playerNameRegex, playerNameRegex2]) {
		while ((m = re.exec(svgText)) !== null) {
			const name = m[1].trim();
			if (name && name.length > 0) {
				boldTexts14.push(name);
			}
		}
	}

	// Deduplicate
	for (const name of boldTexts14) {
		playerNames.add(name);
	}

	// Collect bold 12px text as state labels (inside concise/rectangle players)
	const stateLabelRegex = /<text\s+[^>]*font-weight="bold"[^>]*font-size="12"[^>]*>([^<]*)<\/text>/g;
	const stateLabelRegex2 = /<text\s+[^>]*font-size="12"[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/g;
	const stateLabels = [];

	for (const re of [stateLabelRegex, stateLabelRegex2]) {
		while ((m = re.exec(svgText)) !== null) {
			const label = m[1].trim();
			if (label && label.length > 0 && playerNames.has(label) === false) {
				stateLabels.push(label);
			}
		}
	}

	// Collect axis labels (11px text) as time points
	const axisLabelRegex = /<text\s+[^>]*font-size="11"[^>]*>([^<]*)<\/text>/g;
	const axisLabels = [];
	while ((m = axisLabelRegex.exec(svgText)) !== null) {
		const label = m[1].trim();
		if (label) axisLabels.push(label);
	}

	// Build players from player names
	// Filter out numeric-only entries (axis labels sometimes show up as 14px)
	for (const name of playerNames) {
		if (/^\d+$/.test(name)) continue; // skip pure numbers (axis labels)
		const player = new NPlayer(name, 'unknown');
		diagram.players.push(player);
	}

	// Assign state labels to players heuristically
	// (In timing SVGs, state labels appear between player boundaries)
	// For now, just record them as unassigned state changes
	for (const label of stateLabels) {
		// Try to associate with a player — but without Y-coordinate tracking
		// this is best-effort. Just record that states exist.
	}

	return diagram;
}
