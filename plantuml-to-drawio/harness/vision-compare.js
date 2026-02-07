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
 * Usage: node harness/vision-compare.js <reference.png> <candidate.png> [--rubric <path>]
 *
 * TODO: Implement
 */
