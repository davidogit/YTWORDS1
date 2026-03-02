/**
 * backgroundFetcher.ts — Fetch contextual stock video backgrounds from Pexels.
 *
 * Searches Pexels for vertical videos matching the word/definition,
 * downloads the best match, and returns the local path.
 * Falls back gracefully (returns null) if no API key, no results, or any error.
 *
 * Pexels API: https://www.pexels.com/api/documentation/
 * Free tier: 200 requests/month, no attribution required for videos.
 */

import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';

const log = moduleLogger('bg-fetch');

const PEXELS_API = 'https://api.pexels.com';

interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  total_results: number;
  videos: PexelsVideo[];
}

/**
 * Build search queries from the word and definition.
 * Returns multiple queries to maximize chances of a good result.
 * More abstract/atmospheric queries work better for backgrounds.
 */
function buildSearchQueries(word: string, definition: string): string[] {
  // Map common word themes to atmospheric search terms
  const themeMap: Record<string, string[]> = {
    nature: ['nature landscape', 'forest aerial', 'ocean waves'],
    emotion: ['abstract lights', 'bokeh lights', 'mood lighting'],
    sound: ['rain drops', 'water ripple', 'sound waves abstract'],
    light: ['light rays', 'golden light', 'sun rays'],
    dark: ['dark clouds', 'night sky stars', 'dark abstract'],
    water: ['underwater', 'ocean surface', 'water flow'],
    movement: ['flowing abstract', 'smoke motion', 'particles floating'],
  };

  const defLower = definition.toLowerCase();
  const queries: string[] = [];

  // 1. Try the word + "abstract" for atmospheric feel
  queries.push(`${word} abstract`);

  // 2. Try definition keywords (pick first meaningful noun/adj)
  const defWords = defLower
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 4 && !['which', 'means', 'having', 'being', 'about', 'there', 'their', 'would', 'could', 'should'].includes(w));
  if (defWords.length > 0) {
    queries.push(`${defWords[0]} cinematic`);
  }

  // 3. Theme-based fallbacks
  for (const [theme, searches] of Object.entries(themeMap)) {
    if (defLower.includes(theme) || word.toLowerCase().includes(theme)) {
      queries.push(searches[0]);
      break;
    }
  }

  // 4. Generic atmospheric fallbacks (always have something)
  queries.push('abstract dark bokeh', 'cinematic dark atmosphere');

  return queries;
}

/**
 * Pick the best video file from a Pexels video result.
 * Prefers vertical (portrait) HD files suitable for Shorts (1080x1920).
 */
function pickBestFile(video: PexelsVideo): PexelsVideoFile | null {
  const mp4Files = video.video_files
    .filter((f) => f.file_type === 'video/mp4')
    .sort((a, b) => {
      // Prefer portrait orientation
      const aPortrait = a.height > a.width ? 1 : 0;
      const bPortrait = b.height > b.width ? 1 : 0;
      if (bPortrait !== aPortrait) return bPortrait - aPortrait;

      // Among same orientation, prefer closest to 1080 width
      const aDiff = Math.abs(a.width - 1080);
      const bDiff = Math.abs(b.width - 1080);
      return aDiff - bDiff;
    });

  return mp4Files[0] ?? null;
}

/**
 * Search Pexels for videos matching the query.
 */
async function searchPexelsVideos(
  query: string,
  apiKey: string
): Promise<PexelsVideo[]> {
  const url = `${PEXELS_API}/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait&size=medium`;

  const resp = await fetch(url, {
    headers: { Authorization: apiKey },
  });

  if (!resp.ok) {
    throw new Error(`Pexels API error: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as PexelsSearchResponse;
  return data.videos ?? [];
}

/**
 * Download a video file to the local filesystem.
 */
async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  await writeFile(outputPath, buffer);
}

/**
 * Fetch a contextual background video for the given word.
 *
 * Returns the local path to the downloaded video, or null if:
 * - No Pexels API key configured
 * - No suitable videos found
 * - Download failed
 *
 * The video is saved to `output/words/{word}/bg.mp4`.
 */
export async function fetchBackground(
  word: string,
  definition: string
): Promise<string | null> {
  const apiKey = config.pexels.apiKey;
  if (!apiKey) {
    log.info('No Pexels API key — skipping background fetch');
    return null;
  }

  const wordDir = path.join(config.paths.output, 'words', word);
  mkdirSync(wordDir, { recursive: true });
  const outputPath = path.join(wordDir, 'bg.mp4');

  // Skip if already downloaded (reuse on re-renders)
  if (existsSync(outputPath)) {
    log.info({ word }, 'Background video already exists — reusing');
    return outputPath;
  }

  const queries = buildSearchQueries(word, definition);
  log.info({ word, queries: queries.slice(0, 3) }, 'Searching Pexels for background video');

  for (const query of queries) {
    try {
      const videos = await searchPexelsVideos(query, apiKey);

      // Filter for suitable duration (5-60s, ideally close to Short length)
      const suitable = videos.filter((v) => v.duration >= 5 && v.duration <= 60);
      if (suitable.length === 0) continue;

      // Pick the first suitable video's best file
      const video = suitable[0];
      const file = pickBestFile(video);
      if (!file) continue;

      log.info(
        { query, videoId: video.id, resolution: `${file.width}x${file.height}`, duration: video.duration },
        'Found background video — downloading'
      );

      await downloadVideo(file.link, outputPath);
      log.info({ outputPath }, 'Background video downloaded');
      return outputPath;
    } catch (err) {
      log.warn({ query, error: (err as Error).message }, 'Pexels search failed for query');
      continue;
    }
  }

  log.info({ word }, 'No suitable Pexels video found — will use animated background');
  return null;
}
