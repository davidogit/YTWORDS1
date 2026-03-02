/**
 * discoverReddit.ts — Discover interesting words from Reddit.
 *
 * Uses Snoowrap (official Reddit API wrapper with OAuth) to search
 * word-focused subreddits. Falls back to fetch-based approach if
 * Snoowrap has issues.
 *
 * ⚠️ LEGAL NOTE: Always respect Reddit's API Terms of Service.
 *    - Register an app at https://www.reddit.com/prefs/apps
 *    - Use a descriptive User-Agent
 *    - Respect rate limits (~60 requests/minute for OAuth)
 *    - Do not scrape; use the official API
 */

import Snoowrap from 'snoowrap';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { withRetry, isRetryableNetworkError } from '../utils/retry.js';
import { isDuplicate } from '../utils/db.js';
import type { WordCandidate } from '../types/index.js';

const log = moduleLogger('discoverReddit');

// ── Reddit Client Setup ────────────────────────────────────────────────────

let reddit: Snoowrap | null = null;

function getRedditClient(): Snoowrap {
  if (!reddit) {
    reddit = new Snoowrap({
      userAgent: config.reddit.userAgent,
      clientId: config.reddit.clientId,
      clientSecret: config.reddit.clientSecret,
      username: config.reddit.username,
      password: config.reddit.password,
    });
    // Respect rate limits — Snoowrap handles this internally but we set a buffer
    reddit.config({ requestDelay: 1100, continueAfterRatelimitError: true });
  }
  return reddit;
}

// ── Word Extraction ────────────────────────────────────────────────────────

/**
 * Extract candidate words from a Reddit post title/body.
 * Looks for patterns like:
 *   - Words in quotes: "susurrus"
 *   - Words after "word" / "term": "The word petrichor means..."
 *   - Title-case words that look unusual
 */
function extractWordsFromText(text: string): string[] {
  const words: string[] = [];

  // Pattern 1: Words in quotes or bold
  const quoted = text.match(/["'"*]([a-zA-Z]{4,20})["'"*]/g);
  if (quoted) {
    words.push(...quoted.map((w) => w.replace(/["'"*]/g, '').toLowerCase()));
  }

  // Pattern 2: "the word X" / "the term X" / "TIL the word X"
  const wordPattern = /(?:the\s+)?(?:word|term)\s+[""']?([a-zA-Z]{4,20})[""']?/gi;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    words.push(match[1].toLowerCase());
  }

  // Pattern 3: Post titles that ARE the word (common in r/logophilia)
  // Single-word titles are likely the word itself
  const trimmed = text.trim();
  if (/^[a-zA-Z]{4,20}$/.test(trimmed)) {
    words.push(trimmed.toLowerCase());
  }

  // Pattern 4: "X (noun)" or "X — definition" patterns
  const defPattern = /^([a-zA-Z]{4,20})\s*[(\[—–-]/;
  const defMatch = defPattern.exec(trimmed);
  if (defMatch) {
    words.push(defMatch[1].toLowerCase());
  }

  return [...new Set(words)]; // deduplicate
}

// ── Main Discovery Function ────────────────────────────────────────────────

/**
 * Discover candidate words from configured subreddits.
 * Returns up to `limit` non-duplicate candidates sorted by Reddit score.
 */
export async function discoverFromReddit(limit = 10): Promise<WordCandidate[]> {
  const client = getRedditClient();
  const candidates: WordCandidate[] = [];

  for (const sub of config.reddit.subreddits) {
    log.info({ subreddit: sub }, 'Searching subreddit');

    try {
      // Fetch top posts from the last week — good balance of quality & freshness
      const posts = await withRetry<any[]>(
        () => client.getSubreddit(sub).getTop({ time: 'week', limit: 25 }) as any,
        `reddit:${sub}`,
        { maxAttempts: 2, retryOn: isRetryableNetworkError }
      );

      for (const post of posts) {
        const title: string = post.title ?? '';
        const body: string = post.selftext ?? '';
        const extracted = extractWordsFromText(`${title}\n${body}`);

        for (const word of extracted) {
          // Quick filters: length, not a duplicate in our DB
          if (word.length < config.content.minWordLength) continue;
          if (word.length > config.content.maxWordLength) continue;
          if (isDuplicate(word)) {
            log.debug({ word }, 'Skipping duplicate');
            continue;
          }

          candidates.push({
            word,
            source: 'reddit',
            sourceUrl: `https://reddit.com${post.permalink}`,
            subreddit: sub,
            redditScore: post.score ?? 0,
            discoveredAt: new Date().toISOString(),
          });
        }
      }

      // Also search "new" posts for fresh content
      const newPosts = await withRetry<any[]>(
        () => client.getSubreddit(sub).getNew({ limit: 15 }) as any,
        `reddit:${sub}:new`,
        { maxAttempts: 2, retryOn: isRetryableNetworkError }
      );

      for (const post of newPosts) {
        const extracted = extractWordsFromText(`${post.title}\n${post.selftext ?? ''}`);
        for (const word of extracted) {
          if (word.length < config.content.minWordLength) continue;
          if (word.length > config.content.maxWordLength) continue;
          if (isDuplicate(word)) continue;
          if (candidates.some((c) => c.word === word)) continue;

          candidates.push({
            word,
            source: 'reddit',
            sourceUrl: `https://reddit.com${post.permalink}`,
            subreddit: sub,
            redditScore: post.score ?? 0,
            discoveredAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      log.error({ subreddit: sub, error: (err as Error).message },
        'Failed to fetch from subreddit — continuing with others');
    }
  }

  // Sort by Reddit score (higher = more interesting), dedupe, limit
  const unique = [...new Map(candidates.map((c) => [c.word, c])).values()];
  unique.sort((a, b) => (b.redditScore ?? 0) - (a.redditScore ?? 0));

  log.info({ totalCandidates: unique.length, limit }, 'Discovery complete');
  return unique.slice(0, limit);
}

// ── Fetch-based Fallback (no Snoowrap) ─────────────────────────────────────

/**
 * Alternative: Use Reddit's public JSON endpoints (no OAuth needed for read).
 * ⚠️ Less reliable & stricter rate limits. Use Snoowrap for production.
 */
export async function discoverFromRedditFetch(limit = 10): Promise<WordCandidate[]> {
  const candidates: WordCandidate[] = [];

  for (const sub of config.reddit.subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/top.json?t=week&limit=25`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': config.reddit.userAgent },
      });

      if (!resp.ok) {
        log.warn({ status: resp.status, sub }, 'Reddit fetch failed');
        continue;
      }

      const json = (await resp.json()) as any;
      const posts = json?.data?.children ?? [];

      for (const { data: post } of posts) {
        const extracted = extractWordsFromText(`${post.title}\n${post.selftext ?? ''}`);
        for (const word of extracted) {
          if (word.length < config.content.minWordLength) continue;
          if (isDuplicate(word)) continue;

          candidates.push({
            word,
            source: 'reddit',
            sourceUrl: `https://reddit.com${post.permalink}`,
            subreddit: sub,
            redditScore: post.score ?? 0,
            discoveredAt: new Date().toISOString(),
          });
        }
      }

      // Be polite: wait 2s between subreddit fetches
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      log.error({ sub, error: (err as Error).message }, 'Fetch fallback failed');
    }
  }

  return [...new Map(candidates.map((c) => [c.word, c])).values()]
    .sort((a, b) => (b.redditScore ?? 0) - (a.redditScore ?? 0))
    .slice(0, limit);
}
