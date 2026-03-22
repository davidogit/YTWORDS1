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
 *   - Format-aware metadata (title, description, tags, category)
 *   - Shorts-optimized: #Shorts hashtag, vertical aspect ratio
 *
 * ⚠️ YouTube API Quota: Default is 10,000 units/day.
 *    Each upload costs ~1,600 units. That's ~6 uploads/day max.
 *    Request quota increase if you need more.
 */

import { google } from 'googleapis';
import { createReadStream, statSync } from 'fs';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { withRetry, isRetryableNetworkError } from '../utils/retry.js';
import type { ShortScript, ShortFormat } from '../types/index.js';

const log = moduleLogger('uploader');

// ── OAuth2 Client Setup ────────────────────────────────────────────────────

function getOAuth2Client() {
  const oauth2 = new google.auth.OAuth2(
    config.youtube.clientId,
    config.youtube.clientSecret,
    config.youtube.redirectUri
  );
  oauth2.setCredentials({ refresh_token: config.youtube.refreshToken });
  return oauth2;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

// ── Title Templates — Format-Aware ────────────────────────────────────────
//
// Based on proven patterns:
//   Bad:  "Word of the Day: Reticent"
//   Good: "You know this feeling. The word is Reticent."
//   Best: "Everyone feels this. Few know the word."

function generateTitle(word: string, hook: string, format: ShortFormat): string {
  const W = cap(word);
  const hookSnip = hook.split(/\s+/).slice(0, 7).join(' ').replace(/[?!,."]+$/, '');

  const templatesByFormat: Record<ShortFormat, string[]> = {
    'word-of-the-day': [
      `Everyone feels this. Few know the word.`,
      `You know this feeling. The word is "${W}".`,
      `Most people don't know this word exists.`,
      `The word you've been looking for is "${W}"`,
      `${hookSnip}? The word is ${W}.`,
      `Stop scrolling. You need to know "${W}".`,
      `The one word that describes everything.`,
      `English has a word for this — and it's perfect.`,
    ],
    'misused-word': [
      `You've been using "${W}" wrong your whole life`,
      `"${W}" does NOT mean what you think`,
      `Stop misusing "${W}" — here's the real meaning`,
      `Everyone gets "${W}" wrong. Do you?`,
      `The word "${W}" doesn't mean what you think`,
      `I hate to tell you this but you're using "${W}" wrong`,
    ],
    'funny-meaning': [
      `There's actually a word for this 😭`,
      `The English word for this will surprise you`,
      `This word sounds made up but it's completely real`,
      `You didn't know English had a word for this`,
      `The most specific word in the English language`,
      `Someone actually named this. I cannot believe it.`,
    ],
    'emotional-word': [
      `There's a word for that feeling you can't describe`,
      `The word for that emotion you always feel`,
      `You've felt this. There's a word for it.`,
      `"${W}" — the emotion you've felt but never named`,
      `The word for a feeling most people carry silently`,
      `This word will change how you understand yourself`,
    ],
    'guess-the-word': [
      `Can you guess this word in 3 seconds? 🧠`,
      `3 seconds to guess this word. Go.`,
      `Only 1 in 10 people know this word`,
      `Guess the word before the reveal`,
      `I bet you can't name this word`,
      `Most people don't get this. Can you?`,
    ],
  };

  const templates = templatesByFormat[format] ?? templatesByFormat['word-of-the-day'];
  return pick(templates).slice(0, 100);
}

// ── Description Templates ──────────────────────────────────────────────────

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

  const hashCore = ['#Shorts', '#WordOfTheDay', '#Vocabulary', '#English', '#LearnEnglish'];
  const hashPool = [
    '#FunFacts', '#DidYouKnow', '#EnglishWords', '#WordNerd', '#Etymology',
    '#DailyWord', '#RareWords', '#EnglishVocabulary', '#WordsOfInstagram',
    '#Linguistics', '#BookTok', '#LearnWithMe', '#Education',
    '#EduShorts', '#MindBlown', '#TIL', '#LanguageLearning', '#EnglishLearner',
    `#${word}`,
  ];
  const hashExtra = shuffle(hashPool).slice(0, 8);
  const hashBlock = [...hashCore, ...hashExtra].join(' ');

  const formats = [
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
    .filter((l) => l !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 5000);
}

// ── Tag Generation ──────────────────────────────────────────────────────────

function generateTags(word: string, format: ShortFormat): string[] {
  const core = [
    'shorts', 'vocabulary', 'word of the day', 'english', 'learn english',
    word, word.toLowerCase(), cap(word),
  ];

  const formatTags: Record<ShortFormat, string[]> = {
    'word-of-the-day': ['fun words', 'rare words', 'cool words', 'word nerd', 'etymology'],
    'misused-word': ['grammar', 'english grammar', 'words people misuse', 'common mistakes', 'english tips'],
    'funny-meaning': ['funny words', 'weird words', 'english is weird', 'unusual words', 'did you know'],
    'emotional-word': ['emotional words', 'untranslatable words', 'feelings words', 'describe emotions', 'rare feelings'],
    'guess-the-word': ['guess the word', 'word quiz', 'vocabulary quiz', 'brain teaser', 'word challenge'],
  };

  const pool = [
    'english words', 'new words', 'daily word', 'english vocabulary',
    'linguistics', 'language learning', 'english learner',
    'today i learned', 'til', 'language', 'words to know',
    'improve vocabulary', 'expand vocabulary', 'english lesson',
    'word meaning', 'definition', 'pronunciation',
    'book lover', 'reading', 'logophile', 'word lovers', 'bookworm',
    ...(formatTags[format] ?? []),
  ];

  const selected = shuffle(pool).slice(0, 20);
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
    throw new Error('YouTube refresh token not set. Run `npm run setup:oauth` first.');
  }

  const auth = getOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });

  const title = generateTitle(word, script.hook, script.format);
  const description = generateDescription(word, ipa, definition, script, musicCredit);
  const tags = generateTags(word, script.format);

  const fileSize = statSync(videoPath).size;
  log.info(
    { title, fileSize, format: script.format, privacy: publishAt ? 'private (scheduled)' : config.youtube.privacy, publishAt },
    'Starting YouTube upload'
  );

  const result = await withRetry(
    async () => {
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title,
            description,
            tags,
            categoryId: config.youtube.category,
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en',
          },
          status: {
            privacyStatus: publishAt ? 'private' : config.youtube.privacy,
            ...(publishAt ? { publishAt } : {}),
            selfDeclaredMadeForKids: false,
            madeForKids: false,
          },
        },
        media: { body: createReadStream(videoPath) },
      });
      return response.data;
    },
    'youtube:upload',
    { maxAttempts: 3, baseDelayMs: 5000, retryOn: isRetryableNetworkError }
  );

  const videoId = result.id!;
  const url = `https://youtube.com/shorts/${videoId}`;

  log.info({ videoId, url, title, format: script.format }, 'Upload complete ✓');

  return { videoId, url, title };
}

/**
 * Generate the initial OAuth2 authorization URL.
 */
export function getAuthUrl(): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent',
  });
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(code: string) {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}