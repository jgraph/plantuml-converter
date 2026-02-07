/**
 * vision-compare.js
 *
 * Calls the Anthropic API with two images (PlantUML reference PNG
 * and draw.io converter PNG) and returns a structured diff report.
 *
 * The comparison uses a per-diagram-type rubric with three severity levels:
 *   - Blocking: missing elements, wrong connections, incorrect ordering
 *   - Important: wrong shapes, missing labels, incorrect arrow styles
 *   - Cosmetic: spacing differences, minor alignment, font size
 *
 * Usage as CLI:
 *   node harness/vision-compare.js <reference.png> <candidate.png>
 *
 * Usage as module:
 *   import { compareImages } from './vision-compare.js';
 *   const report = await compareImages(refPath, candPath, options);
 *
 * Environment:
 *   ANTHROPIC_API_KEY - Required. Anthropic API key.
 */

import { readFileSync } from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';

// ── Default comparison rubric ──────────────────────────────────────────────

const DEFAULT_RUBRIC = `You are comparing two renderings of the same UML diagram.

IMAGE 1 (reference): The canonical rendering produced by PlantUML.
IMAGE 2 (candidate): Our converter's output rendered via draw.io.

Compare them systematically using these severity levels:

**Blocking** — Issues that make the diagram incorrect or misleading:
- Missing elements (participants, messages, fragments, notes) that exist in the reference
- Extra elements that don't exist in the reference
- Wrong connections (arrow goes to wrong participant)
- Incorrect ordering of messages (sequence is wrong)
- Messages or elements connected to the wrong participants

**Important** — Issues that make the diagram look wrong but the meaning is still clear:
- Wrong participant shapes (e.g. actor shown as rectangle, database shown as rectangle)
- Missing or wrong labels on elements
- Incorrect arrow styles (solid shown as dotted or vice versa, wrong arrowheads)
- Missing activation bars that are present in the reference
- Fragment/box shapes are wrong or missing their labels
- Wrong arrow direction

**Cosmetic** — Visual differences that don't affect correctness:
- Spacing and alignment differences
- Font size or font family differences
- Color differences
- Minor positioning offsets
- Line thickness differences
- Border or shadow differences

Respond with ONLY a JSON object (no markdown fences, no extra text) in this exact format:
{
  "blocking": [{"description": "...", "location": "..."}],
  "important": [{"description": "...", "location": "..."}],
  "cosmetic": [{"description": "...", "location": "..."}],
  "summary": "Brief overall assessment in 1-2 sentences",
  "score": "pass|needs_work|fail"
}

Where:
- "location" describes where in the diagram the issue appears (e.g. "between Alice and Bob, 3rd message", "top-left fragment")
- "score" is:
  - "pass" if there are 0 blocking AND 0 important issues
  - "needs_work" if there are 0 blocking but >0 important issues
  - "fail" if there are >0 blocking issues
- Use empty arrays [] if no issues at a given level
- Be specific in descriptions — mention actual element names and expected vs actual behavior`;

// ── Anthropic API call ─────────────────────────────────────────────────────

/**
 * Make a raw HTTPS request to the Anthropic Messages API.
 *
 * @param {Object} body - Request body
 * @returns {Promise<Object>} Parsed response body
 */
function callAnthropic(body) {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error('ANTHROPIC_API_KEY environment variable is not set');
	}

	const payload = JSON.stringify(body);

	return new Promise((resolve, reject) => {
		const req = https.request({
			hostname: 'api.anthropic.com',
			path: '/v1/messages',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
				'Content-Length': Buffer.byteLength(payload),
			},
		}, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const raw = Buffer.concat(chunks).toString();
				try {
					const parsed = JSON.parse(raw);
					if (res.statusCode >= 400) {
						reject(new Error(`Anthropic API error (${res.statusCode}): ${parsed.error?.message || raw}`));
					} else {
						resolve(parsed);
					}
				} catch (e) {
					reject(new Error(`Failed to parse API response: ${raw.substring(0, 500)}`));
				}
			});
		});

		req.on('error', reject);
		req.write(payload);
		req.end();
	});
}

// ── Core comparison function ───────────────────────────────────────────────

/**
 * Compare a reference PNG and candidate PNG using the Anthropic Vision API.
 *
 * @param {string} referencePath - Path to the reference PNG (PlantUML output)
 * @param {string} candidatePath - Path to the candidate PNG (draw.io export)
 * @param {Object} [options]
 * @param {string} [options.rubric] - Custom rubric text (replaces default)
 * @param {string} [options.model] - Model to use (default: claude-sonnet-4-5-20250929)
 * @returns {Promise<Object>} Structured diff report
 */
export async function compareImages(referencePath, candidatePath, options = {}) {
	const {
		rubric = DEFAULT_RUBRIC,
		model = 'claude-sonnet-4-5-20250929',
	} = options;

	// Read and base64-encode both images
	const refBuffer = readFileSync(referencePath);
	const candBuffer = readFileSync(candidatePath);
	const refB64 = refBuffer.toString('base64');
	const candB64 = candBuffer.toString('base64');

	// Detect media type from file extension
	const mediaType = referencePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

	const response = await callAnthropic({
		model: model,
		max_tokens: 4096,
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: rubric,
					},
					{
						type: 'text',
						text: 'IMAGE 1 (reference — PlantUML rendering):',
					},
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: mediaType,
							data: refB64,
						},
					},
					{
						type: 'text',
						text: 'IMAGE 2 (candidate — draw.io converter output):',
					},
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: mediaType,
							data: candB64,
						},
					},
				],
			},
		],
	});

	// Extract the text content from the response
	const textBlock = response.content?.find((b) => b.type === 'text');
	if (!textBlock) {
		throw new Error('No text response from Anthropic API');
	}

	// Parse the JSON response — handle possible markdown fences
	let jsonText = textBlock.text.trim();
	const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenceMatch) {
		jsonText = fenceMatch[1].trim();
	}

	try {
		const report = JSON.parse(jsonText);
		// Validate expected structure
		if (!report.blocking || !report.important || !report.cosmetic || !report.score) {
			throw new Error('Response missing required fields');
		}
		return report;
	} catch (e) {
		// Return a parse-error report rather than crashing
		return {
			blocking: [],
			important: [],
			cosmetic: [],
			summary: `Failed to parse vision API response: ${e.message}. Raw text: ${jsonText.substring(0, 500)}`,
			score: 'error',
			_rawResponse: jsonText,
		};
	}
}

// ── CLI entry point ────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.error('Usage: node harness/vision-compare.js <reference.png> <candidate.png>');
		process.exit(1);
	}

	const [refPath, candPath] = args;

	try {
		const report = await compareImages(refPath, candPath);
		console.log(JSON.stringify(report, null, 2));
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}
