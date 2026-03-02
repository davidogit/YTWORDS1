/**
 * discoverRss.ts — Word discovery via RSS feeds (no authentication needed).
 *
 * Fetches vocabulary-focused RSS/Atom feeds and extracts word candidates
 * for the production pipeline. Replaces Reddit OAuth as the primary
 * discovery source.
 *
 * Sources:
 *   - Merriam-Webster Word of the Day   → word is in the title
 *   - A Word A Day (Wordsmith)          → word is the title
 *   - Reddit public RSS: r/logophilia, r/etymology, r/wordplay
 *     (no OAuth required — public feeds)
 *
 * Word extraction strategy:
 *   Editorial feeds → parse the word directly from title/URL slug
 *   Reddit RSS      → same regex patterns as discoverReddit.ts
 */

import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { isDuplicate } from '../utils/db.js';
import type { WordCandidate } from '../types/index.js';

const log = moduleLogger('discoverRss');

// ── Feed definitions ──────────────────────────────────────────────────────────

const RSS_FEEDS = [
  // Editorial — word is reliably in the title or URL
  {
    name: 'Merriam-Webster Word of the Day',
    url: 'https://www.merriam-webster.com/wotd/feed/rss2',
    type: 'editorial' as const,
  },
  {
    name: 'A Word A Day (Wordsmith)',
    url: 'https://wordsmith.org/awad/rss1.xml',
    type: 'editorial' as const,
  },
  // Reddit public RSS — no OAuth, open to all
  {
    name: 'r/logophilia',
    url: 'https://www.reddit.com/r/logophilia.rss',
    type: 'reddit' as const,
  },
  {
    name: 'r/etymology',
    url: 'https://www.reddit.com/r/etymology.rss',
    type: 'reddit' as const,
  },
  {
    name: 'r/wordplay',
    url: 'https://www.reddit.com/r/wordplay.rss',
    type: 'reddit' as const,
  },
];

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  const m = xml.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'),
  );
  return m ? m[1].trim() : '';
}

function extractAttrHref(block: string): string {
  const m = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

// ── Word extraction ───────────────────────────────────────────────────────────

/**
 * Extract a single vocabulary word from an editorial feed item.
 * MW: "Word of the Day: susurrus" → "susurrus"
 * Wordsmith: title IS the word, e.g. "susurrus"
 */
function extractEditorialWord(title: string, url: string): string | null {
  // "Word of the Day: susurrus" or "WOTD: susurrus"
  const wotdMatch = title.match(/(?:word of the day|wotd)[:\s]+([a-zA-Z]{4,20})/i);
  if (wotdMatch) return wotdMatch[1].toLowerCase();

  // Single-word title (Wordsmith style)
  const trimmed = title.trim();
  if (/^[a-zA-Z]{4,20}$/.test(trimmed)) return trimmed.toLowerCase();

  // Extract from URL slug: /word-of-the-day/susurrus-2024-01-15
  const slugMatch =
    url.match(/\/([a-zA-Z]{4,20})-\d{4}-\d{2}-\d{2}(?:$|\?)/) ||
    url.match(/\/words\/([a-zA-Z]{4,20})\.html/);
  if (slugMatch) return slugMatch[1].toLowerCase();

  // First word of the title if it looks like a standalone word
  const firstWord = trimmed.split(/[\s:,—([\]]/)[0];
  if (/^[a-zA-Z]{4,20}$/.test(firstWord)) return firstWord.toLowerCase();

  return null;
}

/**
 * Extract candidate words from a Reddit post title + body.
 * Mirrors the logic in discoverReddit.ts for consistency.
 */
function extractRedditWords(title: string, body: string): string[] {
  const text = `${title}\n${body}`;
  const words: string[] = [];

  // Words in quotes or asterisks
  const quoted = text.match(/["'"*]([a-zA-Z]{4,20})["'"*]/g);
  if (quoted) {
    words.push(...quoted.map((w) => w.replace(/["'"*]/g, '').toLowerCase()));
  }

  // "the word X" / "the term X"
  const wordPattern = /(?:the\s+)?(?:word|term)\s+["'"]?([a-zA-Z]{4,20})["'"]?/gi;
  let m: RegExpExecArray | null;
  while ((m = wordPattern.exec(text)) !== null) {
    words.push(m[1].toLowerCase());
  }

  // Single-word post title (common in r/logophilia)
  const trimmed = title.trim();
  if (/^[a-zA-Z]{4,20}$/.test(trimmed)) {
    words.push(trimmed.toLowerCase());
  }

  // "X (noun/verb)" or "X — definition" patterns
  const defMatch = /^([a-zA-Z]{4,20})\s*[(\[—–-]/.exec(trimmed);
  if (defMatch) words.push(defMatch[1].toLowerCase());

  return [...new Set(words)];
}

// ── Feed fetcher ──────────────────────────────────────────────────────────────

interface RawFeedItem {
  title: string;
  url: string;
  description: string;
}

async function fetchFeedItems(feedUrl: string, feedName: string): Promise<RawFeedItem[]> {
  try {
    const res = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'yt-shorts-auto:v1.0 (word discovery bot)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.warn({ feed: feedName, status: res.status }, 'Feed request failed');
      return [];
    }

    const xml = await res.text();
    const items: RawFeedItem[] = [];

    // RSS 2.0 <item> blocks, fallback to Atom <entry> blocks
    const rssMatches = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
    const atomMatches =
      rssMatches.length === 0
        ? [...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)]
        : [];

    for (const match of [...rssMatches, ...atomMatches]) {
      const block = match[1];
      const title = extractTag(block, 'title')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      const url = extractTag(block, 'link') || extractAttrHref(block);
      const description =
        extractTag(block, 'description') ||
        extractTag(block, 'summary') ||
        extractTag(block, 'content');

      if (title) {
        items.push({
          title,
          url,
          description: description.replace(/<[^>]+>/g, '').slice(0, 500),
        });
      }
    }

    return items;
  } catch (err) {
    log.warn({ feed: feedName, error: (err as Error).message }, 'Feed fetch failed — skipping');
    return [];
  }
}

// ── Main discovery function ───────────────────────────────────────────────────

/**
 * Discover word candidates from vocabulary RSS feeds.
 * Returns up to `limit` non-duplicate candidates.
 */
export async function discoverFromRss(limit = 15): Promise<WordCandidate[]> {
  log.info('Starting RSS word discovery');
  const candidates: WordCandidate[] = [];
  const seen = new Set<string>();

  for (const feed of RSS_FEEDS) {
    log.info({ feed: feed.name }, 'Fetching RSS feed');
    const items = await fetchFeedItems(feed.url, feed.name);

    for (const item of items) {
      const words =
        feed.type === 'editorial'
          ? (() => { const w = extractEditorialWord(item.title, item.url); return w ? [w] : []; })()
          : extractRedditWords(item.title, item.description);

      for (const word of words) {
        if (seen.has(word)) continue;
        seen.add(word);

        if (word.length < config.content.minWordLength) continue;
        if (word.length > config.content.maxWordLength) continue;
        if (isDuplicate(word)) {
          log.debug({ word }, 'Skipping duplicate');
          continue;
        }

        candidates.push({
          word,
          source: 'rss',
          sourceUrl: item.url,
          discoveredAt: new Date().toISOString(),
        });

        if (candidates.length >= limit) {
          log.info({ count: candidates.length }, 'RSS discovery complete (limit reached)');
          return candidates;
        }
      }
    }

    // Polite delay between feeds
    await new Promise((r) => setTimeout(r, 500));
  }

  log.info({ count: candidates.length }, 'RSS discovery complete');
  return candidates;
}
