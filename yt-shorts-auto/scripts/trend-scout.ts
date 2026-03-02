#!/usr/bin/env tsx
/**
 * trend-scout.ts — Content Discovery & Niche Bending Scout
 *
 * Searches YouTube (primary niche + adjacent niches + competitor channels)
 * and RSS feeds (language sources + Reddit public RSS — no auth needed)
 * for trending outlier content. Scores each result and writes structured
 * idea files to content-ideas/pending/ for review.
 *
 * Usage:
 *   npm run scout
 *   npm run scout -- --yt-only           # Skip RSS feeds
 *   npm run scout -- --rss-only          # Skip YouTube
 *   npm run scout -- --competitors-only  # Only check competitor channels
 *   npm run scout -- --dry-run           # Print ideas, don't write files
 *   npm run scout -- --min-score=5       # Override minimum outlier score
 */

import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { scoutConfig, FORMAT_ARCHETYPES, type FormatArchetype } from './scout-config.js';

// ── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const ytOnly = args.includes('--yt-only') || args.includes('--keywords-only');
const rssOnly = args.includes('--rss-only') || args.includes('--reddit-only');
const competitorsOnly = args.includes('--competitors-only');
// legacy aliases
const keywordsOnly = ytOnly;
const redditOnly = rssOnly;
const minScoreArg = args.find((a) => a.startsWith('--min-score='));
const minScore = minScoreArg
  ? parseFloat(minScoreArg.split('=')[1])
  : scoutConfig.scoring.minOutlierScore;

// ── Types ────────────────────────────────────────────────────────────────────

interface YoutubeIdea {
  type: 'youtube';
  id: string;
  title: string;
  channelTitle: string;
  channelId: string;
  channelSubscribers: number;
  url: string;
  views: number;
  likes: number;
  comments: number;
  publishedAt: string;
  daysOld: number;
  outlierScore: number;
  format: FormatArchetype;
  description: string;
}

interface RssIdea {
  type: 'rss';
  id: string;       // stable hash of the URL
  title: string;
  feedName: string; // e.g. "Merriam-Webster Word of the Day" or "r/etymology"
  url: string;
  score: number;    // upvotes for Reddit RSS, 0 for editorial feeds
  publishedAt: string;
  daysOld: number;
  outlierScore: number;
  format: FormatArchetype;
  description: string;
}

type Idea = YoutubeIdea | RssIdea;

// ── YouTube Client ───────────────────────────────────────────────────────────

/**
 * The scout only reads public data (search, video stats, channel stats).
 * A plain API key is sufficient — no OAuth needed.
 * Create one in GCP Console → APIs & Services → Credentials → Create API Key.
 * Restrict it to "YouTube Data API v3" for safety.
 *
 * Set YT_API_KEY in your .env file.
 * Fallback: if YT_API_KEY is missing we try the OAuth token, but it will
 * fail unless the token was granted youtube or youtube.readonly scope.
 */
function getYouTubeClient() {
  const apiKey = process.env.YT_API_KEY;
  if (apiKey) {
    return google.youtube({ version: 'v3', auth: apiKey });
  }
  // Fallback to OAuth (only works if token has youtube/youtube.readonly scope)
  const auth = new google.auth.OAuth2(
    process.env.YT_CLIENT_ID,
    process.env.YT_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
  return google.youtube({ version: 'v3', auth });
}

function checkYouTubeAuth(): boolean {
  if (process.env.YT_API_KEY) return true;
  if (process.env.YT_CLIENT_ID && process.env.YT_REFRESH_TOKEN) return true;
  return false;
}

// ── Outlier Scoring ──────────────────────────────────────────────────────────

/**
 * Scores a YouTube video on a 0–10 scale.
 * High score = performing way above what the channel size suggests.
 */
function scoreYouTubeVideo(
  views: number,
  likes: number,
  comments: number,
  subscribers: number,
  daysOld: number,
): number {
  const subs = Math.max(subscribers, 100); // floor to avoid /0

  // Views-to-subscriber ratio: 100x = interesting, 1000x = viral outlier
  const viewsPerSub = views / subs;
  const viewScore = Math.min(5, Math.log10(Math.max(viewsPerSub, 0.01) + 1) * 3);

  // Engagement rate: (likes + comments) / views
  const engagement = views > 0 ? (likes + comments) / views : 0;
  const engagementScore = Math.min(3, engagement * 60); // 5% engagement = ~3 points

  // Recency bonus: fresher content scores higher
  const recencyBonus =
    Math.max(0, 1 - daysOld / scoutConfig.youtube.publishedAfterDays) *
    scoutConfig.scoring.recencyWeight * 2;

  return Math.min(10, viewScore + engagementScore + recencyBonus);
}

// ── Format Detection ─────────────────────────────────────────────────────────

function detectFormat(text: string): FormatArchetype {
  const lower = text.toLowerCase();
  for (const [key, archetype] of Object.entries(FORMAT_ARCHETYPES)) {
    if (key === 'unknown') continue;
    if (archetype.signals.some((s) => lower.includes(s))) {
      return key as FormatArchetype;
    }
  }
  return 'unknown';
}

// ── YouTube Search ───────────────────────────────────────────────────────────

async function searchYouTube(
  yt: ReturnType<typeof getYouTubeClient>,
  keyword: string,
  publishedAfter: string,
): Promise<string[]> {
  try {
    const res = await yt.search.list({
      part: ['id', 'snippet'],
      q: keyword,
      type: ['video'],
      videoDuration: 'short', // Shorts ≤ 4 min
      order: 'viewCount',
      publishedAfter,
      maxResults: scoutConfig.youtube.maxResultsPerQuery,
      regionCode: 'US',
      relevanceLanguage: 'en',
    });
    return (res.data.items ?? []).map((i) => i.id?.videoId).filter(Boolean) as string[];
  } catch (err) {
    console.warn(`  ⚠  YouTube search failed for "${keyword}": ${(err as Error).message}`);
    return [];
  }
}

async function getChannelShorts(
  yt: ReturnType<typeof getYouTubeClient>,
  channelId: string,
  publishedAfter: string,
): Promise<string[]> {
  try {
    const res = await yt.search.list({
      part: ['id'],
      channelId,
      type: ['video'],
      videoDuration: 'short',
      order: 'viewCount',
      publishedAfter,
      maxResults: 20,
    });
    return (res.data.items ?? []).map((i) => i.id?.videoId).filter(Boolean) as string[];
  } catch (err) {
    console.warn(`  ⚠  Failed to get channel ${channelId}: ${(err as Error).message}`);
    return [];
  }
}

async function fetchVideoStats(
  yt: ReturnType<typeof getYouTubeClient>,
  videoIds: string[],
): Promise<Map<string, { title: string; channelId: string; channelTitle: string; views: number; likes: number; comments: number; publishedAt: string; description: string }>> {
  const map = new Map();
  // Process in batches of 50 (API limit)
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const res = await yt.videos.list({
        part: ['snippet', 'statistics'],
        id: batch,
      });
      for (const item of res.data.items ?? []) {
        map.set(item.id, {
          title: item.snippet?.title ?? '',
          channelId: item.snippet?.channelId ?? '',
          channelTitle: item.snippet?.channelTitle ?? '',
          views: parseInt(item.statistics?.viewCount ?? '0'),
          likes: parseInt(item.statistics?.likeCount ?? '0'),
          comments: parseInt(item.statistics?.commentCount ?? '0'),
          publishedAt: item.snippet?.publishedAt ?? '',
          description: item.snippet?.description ?? '',
        });
      }
    } catch (err) {
      console.warn(`  ⚠  Failed to fetch video stats batch: ${(err as Error).message}`);
    }
  }
  return map;
}

async function fetchChannelSubscribers(
  yt: ReturnType<typeof getYouTubeClient>,
  channelIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(channelIds)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    try {
      const res = await yt.channels.list({
        part: ['statistics'],
        id: batch,
      });
      for (const item of res.data.items ?? []) {
        map.set(item.id!, parseInt(item.statistics?.subscriberCount ?? '0'));
      }
    } catch (err) {
      console.warn(`  ⚠  Failed to fetch channel stats: ${(err as Error).message}`);
    }
  }
  return map;
}

// ── Preflight Checks ─────────────────────────────────────────────────────────

function preflight(): boolean {
  if (!rssOnly && !competitorsOnly) {
    if (!checkYouTubeAuth()) {
      console.error('\n❌  YouTube not configured. Add one of:');
      console.error('     YT_API_KEY=...   (recommended — GCP Console → Credentials → API Key)');
      console.error('     OR re-run setup:oauth with youtube/youtube.readonly scope\n');
      return false;
    }
    if (!process.env.YT_API_KEY) {
      console.warn('⚠   Using OAuth for YouTube search. If you see "Insufficient Permission",');
      console.warn('    add YT_API_KEY to .env (GCP Console → Credentials → Create API Key).\n');
    }
  }
  return true;
}

// ── RSS Helpers ───────────────────────────────────────────────────────────────

/** Stable short ID from a URL so we can deduplicate across runs */
function urlToId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function extractAttrHref(xml: string): string {
  const m = xml.match(/<link[^>]+href=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

interface FeedItem {
  title: string;
  url: string;
  description: string;
  pubDate: string;
  redditScore: number;
}

async function fetchFeed(feedUrl: string, feedName: string): Promise<FeedItem[]> {
  try {
    const res = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'yt-shorts-auto:scout:v1.0 (content research bot)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`  ⚠  ${feedName}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items: FeedItem[] = [];

    // Try RSS 2.0 <item> blocks first, then Atom <entry> blocks
    const rssMatches = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
    const atomMatches = rssMatches.length === 0
      ? [...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)]
      : [];

    for (const m of [...rssMatches, ...atomMatches]) {
      const block = m[1];
      const title = extractTag(block, 'title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const url = extractTag(block, 'link') || extractAttrHref(block);
      const description = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content');
      const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'updated') || extractTag(block, 'published');
      const scoreMatch = block.match(/<score[^>]*>(\d+)<\/score>/);
      const redditScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;

      if (title && url) {
        items.push({ title, url, description: description.replace(/<[^>]+>/g, '').slice(0, 300), pubDate, redditScore });
      }
    }
    return items.slice(0, scoutConfig.rss.maxItemsPerFeed);
  } catch (err) {
    console.warn(`  ⚠  ${feedName}: ${(err as Error).message}`);
    return [];
  }
}

// ── RSS Scout ─────────────────────────────────────────────────────────────────

async function runRssScout(): Promise<RssIdea[]> {
  if (ytOnly || competitorsOnly) return [];

  console.log('\n📡  Scouting RSS feeds...');
  const ideas: RssIdea[] = [];

  for (const feed of scoutConfig.rss.feeds) {
    process.stdout.write(`  ${feed.name} ... `);
    const items = await fetchFeed(feed.url, feed.name);
    let count = 0;

    for (const item of items) {
      // Skip low-score Reddit posts
      const isRedditFeed = feed.url.includes('reddit.com');
      if (isRedditFeed && item.redditScore < scoutConfig.rss.minRedditScore) continue;

      const pubMs = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
      const daysOld = Math.max(0, Math.floor((Date.now() - pubMs) / 86_400_000));
      const recencyBonus = Math.max(0, 1 - daysOld / 30) * scoutConfig.scoring.recencyWeight;

      // Score: editorial feeds get a quality boost; Reddit RSS scored by upvotes
      let outlierScore: number;
      if (isRedditFeed) {
        outlierScore = Math.min(10, (item.redditScore / 500) * 4 + recencyBonus * 2);
      } else {
        // Editorial sources (MW, Wordsmith, etc.) are always worth reviewing
        outlierScore = Math.min(10, 4 + recencyBonus * 2) * (feed.weight ?? 1);
      }

      outlierScore = Math.min(10, outlierScore);
      if (outlierScore < minScore * 0.4) continue;

      const id = urlToId(item.url);
      const format = detectFormat(`${item.title} ${item.description}`);

      ideas.push({
        type: 'rss',
        id,
        title: item.title,
        feedName: feed.name,
        url: item.url,
        score: item.redditScore,
        publishedAt: item.pubDate || new Date().toISOString(),
        daysOld,
        outlierScore,
        format,
        description: item.description,
      });
      count++;
    }
    console.log(`${count} ideas`);
    await sleep(300); // polite delay between feeds
  }

  ideas.sort((a, b) => b.outlierScore - a.outlierScore);
  console.log(`  ✅  ${ideas.length} RSS ideas found`);
  return ideas;
}

// ── YouTube Pipeline ─────────────────────────────────────────────────────────

async function runYouTubeScout(): Promise<YoutubeIdea[]> {
  if (redditOnly) return [];

  console.log('\n🎥  Scouting YouTube...');
  const yt = getYouTubeClient();

  const publishedAfter = new Date(
    Date.now() - scoutConfig.youtube.publishedAfterDays * 86_400_000,
  ).toISOString();

  // 1. Collect video IDs from all keyword groups
  const allVideoIds = new Set<string>();

  if (!competitorsOnly) {
    const allKeywords = [
      ...scoutConfig.youtube.primaryKeywords,
      ...scoutConfig.youtube.adjacentKeywords,
    ];
    for (const kw of allKeywords) {
      process.stdout.write(`  Searching: "${kw}" ... `);
      const ids = await searchYouTube(yt, kw, publishedAfter);
      ids.forEach((id) => allVideoIds.add(id));
      console.log(`${ids.length} videos`);
      await sleep(200); // gentle rate limiting
    }
  }

  if (scoutConfig.youtube.competitorChannelIds.length > 0) {
    console.log(`\n  Checking ${scoutConfig.youtube.competitorChannelIds.length} competitor channel(s)...`);
    for (const channelId of scoutConfig.youtube.competitorChannelIds) {
      const ids = await getChannelShorts(yt, channelId, publishedAfter);
      ids.forEach((id) => allVideoIds.add(id));
      await sleep(200);
    }
  }

  console.log(`\n  Total unique videos collected: ${allVideoIds.size}`);

  if (allVideoIds.size === 0) return [];

  // 2. Fetch stats for all videos
  console.log('  Fetching video stats...');
  const statsMap = await fetchVideoStats(yt, [...allVideoIds]);

  // 3. Filter by minimum views
  const filtered = [...statsMap.entries()].filter(
    ([, s]) => s.views >= scoutConfig.youtube.minViewsForConsideration,
  );
  console.log(`  After view filter (≥${scoutConfig.youtube.minViewsForConsideration.toLocaleString()}): ${filtered.length} videos`);

  // 4. Fetch subscriber counts for unique channels
  const channelIds = [...new Set(filtered.map(([, s]) => s.channelId))];
  console.log(`  Fetching subscriber counts for ${channelIds.length} channels...`);
  const subMap = await fetchChannelSubscribers(yt, channelIds);

  // 5. Score and build ideas
  const ideas: YoutubeIdea[] = [];
  for (const [videoId, stats] of filtered) {
    const subscribers = subMap.get(stats.channelId) ?? 10_000;
    const publishedAt = new Date(stats.publishedAt);
    const daysOld = Math.floor((Date.now() - publishedAt.getTime()) / 86_400_000);

    const outlierScore = scoreYouTubeVideo(
      stats.views,
      stats.likes,
      stats.comments,
      subscribers,
      daysOld,
    );

    if (outlierScore < minScore) continue;

    const format = detectFormat(`${stats.title} ${stats.description}`);

    ideas.push({
      type: 'youtube',
      id: videoId,
      title: stats.title,
      channelTitle: stats.channelTitle,
      channelId: stats.channelId,
      channelSubscribers: subscribers,
      url: `https://youtube.com/shorts/${videoId}`,
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      publishedAt: stats.publishedAt,
      daysOld,
      outlierScore,
      format,
      description: stats.description.slice(0, 300),
    });
  }

  ideas.sort((a, b) => b.outlierScore - a.outlierScore);
  console.log(`  ✅  ${ideas.length} YouTube ideas passed scoring threshold (≥${minScore})`);
  return ideas;
}

// ── Reddit Scout ─────────────────────────────────────────────────────────────

async function runRedditScout(): Promise<RedditIdea[]> {
  if (keywordsOnly || competitorsOnly) return [];

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;

  const missing = [
    !clientId && 'REDDIT_CLIENT_ID',
    !clientSecret && 'REDDIT_CLIENT_SECRET',
    !username && 'REDDIT_USERNAME',
    !password && 'REDDIT_PASSWORD',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(`\n⚠  Reddit skipped — missing: ${missing.join(', ')}`);
    console.log('   Add these to .env or run with --keywords-only to use YouTube only.');
    return [];
  }

  console.log('\n📡  Scouting Reddit...');
  const reddit = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT ?? 'yt-shorts-auto:scout:v1.0',
    clientId,
    clientSecret,
    username,
    password,
  });
  reddit.config({ requestDelay: 1100, continueAfterRatelimitError: true });

  const ideas: RedditIdea[] = [];

  for (const sub of scoutConfig.reddit.scoutSubreddits) {
    process.stdout.write(`  r/${sub} ... `);
    try {
      const posts = await (reddit.getSubreddit(sub).getTop({ time: 'month', limit: 25 }) as any);
      let count = 0;
      for (const post of posts) {
        if ((post.score ?? 0) < scoutConfig.reddit.minScore) continue;

        const publishedAt = new Date((post.created_utc ?? 0) * 1000).toISOString();
        const daysOld = Math.floor((Date.now() - (post.created_utc ?? 0) * 1000) / 86_400_000);
        const recencyBonus = Math.max(0, 1 - daysOld / 30) * scoutConfig.scoring.recencyWeight;

        // Simple outlier score for Reddit: score / 1000 + recency
        const outlierScore = Math.min(10, (post.score / 1000) * 5 + recencyBonus * 2 + Math.min(2, (post.num_comments ?? 0) / 500));

        if (outlierScore < minScore * 0.5) continue; // softer threshold for Reddit

        const format = detectFormat(`${post.title ?? ''} ${post.selftext ?? ''}`);

        ideas.push({
          type: 'reddit',
          id: post.id,
          title: post.title,
          subreddit: sub,
          url: `https://reddit.com${post.permalink}`,
          score: post.score ?? 0,
          comments: post.num_comments ?? 0,
          publishedAt,
          daysOld,
          outlierScore,
          format,
        });
        count++;
      }
      console.log(`${count} ideas`);
      await sleep(1200);
    } catch (err) {
      console.warn(`failed: ${(err as Error).message}`);
    }
  }

  ideas.sort((a, b) => b.outlierScore - a.outlierScore);
  console.log(`  ✅  ${ideas.length} Reddit ideas found`);
  return ideas;
}

// ── Idea File Writer ─────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function buildYouTubeMarkdown(idea: YoutubeIdea): string {
  const archetype = FORMAT_ARCHETYPES[idea.format];
  const hooks = archetype.hookTemplates.map((h, i) => `  ${i + 1}. ${h}`).join('\n');
  const engagementRate = idea.views > 0
    ? ((idea.likes + idea.comments) / idea.views * 100).toFixed(1)
    : '0';
  const viewsPerSub = idea.channelSubscribers > 0
    ? (idea.views / idea.channelSubscribers).toFixed(0) + 'x'
    : 'unknown';

  return `---
id: ${idea.id}
type: youtube
source: ${idea.url}
format: ${idea.format}
outlierScore: ${idea.outlierScore.toFixed(1)}
status: pending
scoutedAt: ${new Date().toISOString()}
---

# [${archetype.label}] ${idea.title}

## Source Stats
| Metric | Value |
|---|---|
| Channel | ${idea.channelTitle} |
| Subscribers | ${formatNumber(idea.channelSubscribers)} |
| Views | ${formatNumber(idea.views)} |
| Likes | ${formatNumber(idea.likes)} |
| Comments | ${formatNumber(idea.comments)} |
| Engagement rate | ${engagementRate}% |
| Views / Subs | **${viewsPerSub}** ← outlier indicator |
| Published | ${idea.daysOld} days ago |
| Outlier Score | **${idea.outlierScore.toFixed(1)} / 10** |

[Watch source video](${idea.url})

## Why It's an Outlier
> A channel with ${formatNumber(idea.channelSubscribers)} subscribers got ${formatNumber(idea.views)} views — ${viewsPerSub} above their typical reach.
> Format detected: **${archetype.label}**

## Format Breakdown
${archetype.scriptNote}

## Adapted Hook Options for Our Channel
${hooks}

## Suggested Word Candidates
<!-- Fill in good word candidates for this format below: -->
- WORD_1 — reason it fits
- WORD_2 — reason it fits
- WORD_3 — reason it fits

## Notes
<!-- Any observations, why this works, what to steal or avoid: -->

---
*Run \`npm run scout:review\` to approve or reject this idea.*
`;
}

function buildRssMarkdown(idea: RssIdea): string {
  const archetype = FORMAT_ARCHETYPES[idea.format];
  const hooks = archetype.hookTemplates.map((h, i) => `  ${i + 1}. ${h}`).join('\n');
  const isReddit = idea.url.includes('reddit.com');

  return `---
id: ${idea.id}
type: rss
source: ${idea.url}
feed: ${idea.feedName}
format: ${idea.format}
outlierScore: ${idea.outlierScore.toFixed(1)}
status: pending
scoutedAt: ${new Date().toISOString()}
---

# [${archetype.label}] ${idea.title}

## Source Stats
| Metric | Value |
|---|---|
| Feed | ${idea.feedName} |${isReddit ? `\n| Upvotes | ${formatNumber(idea.score)} |` : ''}
| Published | ${idea.daysOld} days ago |
| Outlier Score | **${idea.outlierScore.toFixed(1)} / 10** |

[View source](${idea.url})

${idea.description ? `> ${idea.description}\n` : ''}
## Why It's Interesting
> ${isReddit ? `High engagement on ${idea.feedName} — this topic resonates with the language community.` : `Featured by ${idea.feedName} — editorially selected, high-quality word content.`}
> Format detected: **${archetype.label}**

## Format Breakdown
${archetype.scriptNote}

## Adapted Hook Options for Our Channel
${hooks}

## Suggested Word Candidates
<!-- Fill in good word candidates for this format below: -->
- WORD_1 — reason it fits
- WORD_2 — reason it fits

## Notes
<!-- Any observations about the format, angle, or content: -->

---
*Run \`npm run scout:review\` to approve or reject this idea.*
`;
}

function saveIdeaFile(idea: Idea, ideasDir: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = idea.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
    .replace(/-+$/, '');
  const shortId = idea.id.slice(0, 8);
  const filename = `${date}-${slug}-${shortId}.md`;
  const filepath = path.join(ideasDir, 'pending', filename);

  const content =
    idea.type === 'youtube'
      ? buildYouTubeMarkdown(idea)
      : buildRssMarkdown(idea);

  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

// ── Deduplication ────────────────────────────────────────────────────────────

function loadExistingIds(ideasDir: string): Set<string> {
  const existing = new Set<string>();
  const dirs = ['pending', 'approved', 'rejected', 'produced'];
  for (const dir of dirs) {
    const fullDir = path.join(ideasDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const file of fs.readdirSync(fullDir)) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = fs.readFileSync(path.join(fullDir, file), 'utf-8');
        const idMatch = content.match(/^id:\s*(.+)$/m);
        if (idMatch) existing.add(idMatch[1].trim());
      } catch {}
    }
  }
  return existing;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍  Trend Scout — Content Discovery & Niche Bending');
  console.log('='.repeat(52));
  if (isDryRun) console.log('  DRY RUN — no files will be written\n');

  if (!preflight()) process.exit(1);

  const ideasDir = path.resolve(scoutConfig.output.ideasDir);
  ['pending', 'approved', 'rejected', 'produced'].forEach((d) =>
    fs.mkdirSync(path.join(ideasDir, d), { recursive: true }),
  );

  const existingIds = loadExistingIds(ideasDir);
  console.log(`  Already tracked: ${existingIds.size} ideas (will skip duplicates)\n`);

  // Run scouts in parallel
  const [ytIdeas, rssIdeas] = await Promise.all([
    runYouTubeScout(),
    runRssScout(),
  ]);

  const allIdeas: Idea[] = [...ytIdeas, ...rssIdeas];
  const newIdeas = allIdeas.filter((i) => !existingIds.has(i.id));

  console.log(`\n📊  Summary`);
  console.log('─'.repeat(40));
  console.log(`  YouTube ideas:         ${ytIdeas.length}`);
  console.log(`  RSS ideas:             ${rssIdeas.length}`);
  console.log(`  Already tracked:       ${allIdeas.length - newIdeas.length}`);
  console.log(`  New ideas to save:     ${newIdeas.length}`);
  console.log(`  Min outlier score:     ${minScore}`);

  if (newIdeas.length === 0) {
    console.log('\n  Nothing new found. Try lowering --min-score or expanding keywords.');
    return;
  }

  console.log('\n📝  Top Ideas:');
  console.log('─'.repeat(40));
  newIdeas.slice(0, 10).forEach((idea, i) => {
    const score = idea.outlierScore.toFixed(1);
    const source = idea.type === 'youtube' ? '🎥' : '📡';
    console.log(`  ${i + 1}. [${score}] ${source} ${idea.title.slice(0, 60)}`);
  });

  if (!isDryRun) {
    console.log('\n💾  Saving idea files...');
    let saved = 0;
    for (const idea of newIdeas) {
      try {
        const fp = saveIdeaFile(idea, ideasDir);
        console.log(`  ✓ ${path.basename(fp)}`);
        saved++;
      } catch (err) {
        console.warn(`  ✗ Failed to save idea ${idea.id}: ${(err as Error).message}`);
      }
    }
    console.log(`\n✅  ${saved} idea files written to content-ideas/pending/`);
    console.log('   Run `npm run scout:review` to review and approve ideas.');
  } else {
    console.log('\n  (dry run — no files written)');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
