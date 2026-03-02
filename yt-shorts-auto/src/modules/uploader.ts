/**
 * uploader.ts — Upload videos to YouTube via Data API v3.
 *
 * OAuth2 flow:
 *   1. Run `npm run setup:oauth` to get initial tokens
 *   2. Refresh token is stored in .env (YT_REFRESH_TOKEN)
 *   3. Access token is refreshed automatically before each upload
 *
 * Features:
 *   - Resumable upload (handles network interruptions)
 *   - Automatic metadata (title, description, tags, category)
 *   - Shorts-optimized: #Shorts hashtag, vertical aspect ratio
 *
 * ⚠️ YouTube API Quota: Default is 10,000 units/day.
 *    Each upload costs ~1,600 units. That's ~6 uploads/day max.
 *    Request quota increase if you need more.
 *
 * Setup instructions:
 *   1. Go to https://console.cloud.google.com
 *   2. Create a project (or use existing)
 *   3. Enable "YouTube Data API v3"
 *   4. Create OAuth 2.0 credentials (Desktop app type)
 *   5. Download client_secret.json — extract client_id and client_secret
 *   6. Set YT_CLIENT_ID, YT_CLIENT_SECRET in .env
 *   7. Run `npm run setup:oauth` and follow the browser flow
 *   8. Copy the refresh_token to YT_REFRESH_TOKEN in .env
 */

import { google } from 'googleapis';
import { createReadStream, statSync } from 'fs';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { withRetry, isRetryableNetworkError } from '../utils/retry.js';
import type { ShortScript } from '../types/index.js';

const log = moduleLogger('uploader');

// ── OAuth2 Client Setup ────────────────────────────────────────────────────

function getOAuth2Client() {
  const oauth2 = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );

  // Set the refresh token — googleapis will auto-refresh access tokens
  oauth2.setCredentials({
    refresh_token: config.youtube.refreshToken,
  });

  return oauth2;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Seeded shuffle so the same word always picks consistently within a run */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Title Templates ─────────────────────────────────────────────────────────
// 15 distinct formats — varied tone: curious, challenge, discovery, education, fun

function generateTitle(word: string, hook: string): string {
  // Pull a short hook excerpt (first ~6 words) for some templates
  const hookSnip = hook.split(/\s+/).slice(0, 6).join(' ').replace(/[?!,]+$/, '');

  const W = cap(word);

  const templates = [
    // Curiosity / hook-led
    `${hookSnip}? The word is "${W}" #Shorts`,
    `There's actually a word for that — "${W}" 🤯`,
    `You've felt it. Now learn the word: ${W}`,
    `The word "${W}" will change how you describe things`,
    // Discovery
    `Word of the Day: ${W} — Do You Know It?`,
    `Most people don't know this word: ${W}`,
    `${W} — A Word That Deserves More Use`,
    `Ever heard of "${W}"? You should have`,
    // Challenge / engagement
    `Can you use "${W}" in a sentence? 🧠`,
    `Drop "${W}" in a conversation and impress everyone`,
    // Education / clean
    `What does "${W}" mean? #shorts #vocabulary`,
    `${W}: The one English word you're missing`,
    `Learn "${W}" in 30 seconds #WordOfTheDay`,
    `${W} — definition, pronunciation & example`,
    // Fun / emoji-led
    `✨ "${W}" — today's rare English word`,
  ];

  return pick(templates).slice(0, 100); // YouTube 100-char title limit
}

// ── Description Templates ───────────────────────────────────────────────────
// 5 structurally different formats — rotated randomly

function generateDescription(
  word: string,
  ipa: string | undefined,
  definition: string,
  script: ShortScript,
  musicCredit: string
): string {
  const W = cap(word);
  const pronLine = ipa ? `Pronunciation: ${ipa}` : '';
  const music = musicCredit !== 'none' ? musicCredit : 'Royalty-free';
  const cta = pick([
    '🔔 Subscribe for a new word every day!',
    '👇 Follow so you never miss a word.',
    '💬 Use this word today — drop it in the comments!',
    '📲 Follow for daily vocabulary that actually sticks.',
    '🔁 Share this with someone who loves words!',
  ]);

  // Hashtag block — always #Shorts first (helps YouTube classify), then varied
  const hashCore = ['#Shorts', '#WordOfTheDay', '#Vocabulary', '#English', '#LearnEnglish'];
  const hashPool = [
    '#FunFacts', '#DidYouKnow', '#EnglishWords', '#WordNerd', '#Etymology',
    '#DailyWord', '#RareWords', '#EnglishVocabulary', '#WordsOfInstagram',
    '#Linguistics', '#GrammarNazi', '#BookTok', '#LearnWithMe', '#Education',
    '#EduShorts', '#MindBlown', '#TIL', '#LanguageLearning', '#EnglishLearner',
    `#${word}`,
  ];
  const hashExtra = shuffle(hashPool).slice(0, 8);
  const hashBlock = [...hashCore, ...hashExtra].join(' ');

  const formats = [

    // ── Format 1: Lead with the hook, educational tone
    [
      `#Shorts | ${W} ${ipa ? `(${ipa})` : ''}`,
      '',
      `📖 ${definition}`,
      '',
      script.hook,
      '',
      cta,
      '',
      `🎵 Music: ${music}`,
      '',
      hashBlock,
    ],

    // ── Format 2: Definition-first, clean & structured
    [
      `📚 Word: ${W}`,
      pronLine,
      '',
      `📝 Definition: ${definition}`,
      '',
      `💡 "${script.hook}"`,
      '',
      cta,
      `🎵 ${music}`,
      '',
      hashBlock,
    ],

    // ── Format 3: Conversational / story-led
    [
      `${script.hook}`,
      '',
      `The word you're looking for is "${W}".`,
      pronLine ? `It's pronounced ${pronLine}.` : '',
      '',
      definition,
      '',
      cta,
      '',
      `Music: ${music}`,
      hashBlock,
    ],

    // ── Format 4: Punchy, list-style
    [
      `🔤 ${W} ${ipa ? `· ${ipa}` : ''}`,
      `📖 ${definition}`,
      '',
      `✅ Now you know.`,
      '',
      cta,
      '',
      `🎵 ${music}`,
      hashBlock,
    ],

    // ── Format 5: Question-led, engagement-focused
    [
      `Do you know what "${W}" means?`,
      '',
      `${W}${ipa ? ` (${ipa})` : ''} — ${definition}`,
      '',
      `👉 ${script.cta}`,
      '',
      cta,
      `🎵 Music: ${music}`,
      '',
      hashBlock,
    ],

  ];

  return pick(formats)
    .filter((l) => l !== '')  // keep intentional empty lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // collapse triple+ newlines
    .slice(0, 5000);
}

// ── Tag Generation ──────────────────────────────────────────────────────────

function generateTags(word: string): string[] {
  // Core tags always included
  const core = [
    'shorts', 'vocabulary', 'word of the day', 'english', 'learn english',
    word, word.toLowerCase(), cap(word),
  ];

  // Large pool — pick a varied subset each run
  const pool = [
    'fun words', 'english words', 'rare words', 'cool words', 'big words',
    'new words', 'daily word', 'english vocabulary', 'word nerd', 'etymology',
    'linguistics', 'grammar', 'language learning', 'english learner',
    'did you know', 'fun facts', 'education', 'learning', 'mind blown',
    'today i learned', 'til', 'language', 'words to know',
    'improve vocabulary', 'expand vocabulary', 'english lesson',
    'word meaning', 'definition', 'pronunciation', 'ipa', 'phonetics',
    'english pronunciation', 'speak english', 'english speaking',
    'book lover', 'reading', 'writing tips', 'writer', 'logophile',
    'word lovers', 'bookworm', 'word of the week',
  ];

  // Pick 20 from pool, shuffle for variety
  const selected = shuffle(pool).slice(0, 20);

  // Deduplicate and cap at 500 chars total (YouTube tag limit is 500 total chars)
  const all = [...new Set([...core, ...selected])];
  const result: string[] = [];
  let charCount = 0;
  for (const tag of all) {
    if (charCount + tag.length + 1 > 490) break;
    result.push(tag);
    charCount += tag.length + 1;
  }
  return result;
}

// ── Upload ─────────────────────────────────────────────────────────────────

export interface UploadResult {
  videoId: string;
  url: string;
  title: string;
}

/**
 * Upload a video to YouTube with full metadata.
 * Uses resumable upload for reliability.
 */
export async function uploadToYouTube(
  videoPath: string,
  word: string,
  ipa: string | undefined,
  definition: string,
  script: ShortScript,
  musicCredit: string,
  publishAt?: string
): Promise<UploadResult> {
  if (!config.youtube.refreshToken) {
    throw new Error(
      'YouTube refresh token not set. Run `npm run setup:oauth` first.'
    );
  }

  const auth = getOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });

  const title = generateTitle(word, script.hook);
  const description = generateDescription(word, ipa, definition, script, musicCredit);
  const tags = generateTags(word);

  const fileSize = statSync(videoPath).size;
  log.info({ title, fileSize, privacy: publishAt ? 'private (scheduled)' : config.youtube.privacy, publishAt }, 'Starting YouTube upload');

  // Resumable upload via googleapis
  const result = await withRetry(
    async () => {
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            tags,
            categoryId: config.youtube.category, // 27 = Education
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en',
          },
          status: {
            privacyStatus: publishAt ? 'private' : config.youtube.privacy,
            // Schedule publish time — YouTube requires private status for scheduled videos
            ...(publishAt ? { publishAt } : {}),
            // ALWAYS false — content is not made for kids (required for monetization eligibility)
            selfDeclaredMadeForKids: false,
            madeForKids: false,
          },
        },
        media: {
          body: createReadStream(videoPath),
        },
      });

      return response.data;
    },
    'youtube:upload',
    {
      maxAttempts: 3,
      baseDelayMs: 5000,
      retryOn: isRetryableNetworkError,
    }
  );

  const videoId = result.id!;
  const url = `https://youtube.com/shorts/${videoId}`;

  log.info({ videoId, url, title }, 'Upload complete ✓');

  return { videoId, url, title };
}

/**
 * Generate the initial OAuth2 authorization URL.
 * Used by scripts/setup-oauth.ts to get the refresh token.
 */
export function getAuthUrl(): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent', // Force consent to ensure refresh_token is returned
  });
}

/**
 * Exchange an authorization code for tokens.
 * Used by scripts/setup-oauth.ts after the user authorizes.
 */
export async function exchangeCode(code: string) {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}
