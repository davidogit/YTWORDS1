/**
 * formatSelector.ts — Rotate through content formats for 3x/day posting.
 *
 * Target mix:
 *   Morning   (UTC 6–11)  → emotional-word   (highest engagement, shareable)
 *   Afternoon (UTC 12–17) → guess-the-word   (interactive, spreads faster)
 *   Evening   (UTC 18–23) → misused-word / funny-meaning (alternating days)
 *
 * Override at any time with --format=<format> from the CLI.
 */

import type { ShortFormat } from '../types/index.js';

/**
 * Select the appropriate content format for this run.
 *
 * If an explicit format was passed via CLI, use it.
 * Otherwise rotate based on UTC hour and day-of-month
 * so the 3-per-day schedule stays varied automatically.
 */
export function selectNextFormat(explicitFormat?: ShortFormat): ShortFormat {
  if (explicitFormat) return explicitFormat;

  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDate();

  // Morning slot: 06:00 – 11:59 UTC
  if (hour >= 6 && hour < 12) {
    return 'emotional-word';
  }

  // Afternoon slot: 12:00 – 17:59 UTC
  if (hour >= 12 && hour < 18) {
    return 'guess-the-word';
  }

  // Evening slot: 18:00 – 23:59 UTC — alternate misused / funny by day
  if (hour >= 18) {
    return day % 2 === 0 ? 'misused-word' : 'funny-meaning';
  }

  // Early morning / overnight: default to word-of-the-day
  return 'word-of-the-day';
}

/**
 * Human-readable label for a format (used in logging).
 */
export function formatLabel(format: ShortFormat): string {
  const labels: Record<ShortFormat, string> = {
    'word-of-the-day': 'Word of the Day',
    'misused-word':    'Misused Word',
    'funny-meaning':   'Funny Meaning',
    'emotional-word':  'Emotional Word',
    'guess-the-word':  'Guess the Word',
  };
  return labels[format];
}

/**
 * Whether a format uses format-specific curated word lists
 * (rather than RSS / Reddit discovery).
 */
export function usesCuratedList(format: ShortFormat): boolean {
  return ['emotional-word', 'funny-meaning', 'misused-word'].includes(format);
}