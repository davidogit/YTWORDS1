import 'dotenv/config';
import type { AppConfig } from './types/index.js';

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env var: ${key}`);
  return val;
}

export const config: AppConfig = {
  reddit: {
    clientId: env('REDDIT_CLIENT_ID'),
    clientSecret: env('REDDIT_CLIENT_SECRET'),
    username: env('REDDIT_USERNAME'),
    password: env('REDDIT_PASSWORD'),
    userAgent: env('REDDIT_USER_AGENT', 'yt-shorts-auto:v1.0.0'),
    subreddits: env('TARGET_SUBREDDITS', 'logophilia,wordoftheday,vocabulary').split(','),
  },
  dictionary: {
    wordnikApiKey: process.env.WORDNIK_API_KEY,
  },
  tts: {
    engine: (process.env.TTS_ENGINE ?? 'edge-tts') as AppConfig['tts']['engine'],
    voice: env('TTS_VOICE', 'en-US-GuyNeural'),
    openaiVoice: process.env.OPENAI_TTS_VOICE,
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
  },
  pexels: {
    apiKey: process.env.PEXELS_API_KEY,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  },
  youtube: {
    clientId: env('YT_CLIENT_ID', ''),
    clientSecret: env('YT_CLIENT_SECRET', ''),
    redirectUri: env('YT_REDIRECT_URI', 'http://localhost:3000/oauth2callback'),
    refreshToken: env('YT_REFRESH_TOKEN', ''),
    category: env('YT_CHANNEL_CATEGORY', '27'), // Education
    defaultTags: env('YT_DEFAULT_TAGS', 'shorts,vocabulary,words').split(','),
    privacy: (process.env.YT_PRIVACY ?? 'public') as 'public' | 'unlisted' | 'private',
  },
  paths: {
    ffmpeg: env('FFMPEG_PATH', 'ffmpeg'),
    ffprobe: env('FFPROBE_PATH', 'ffprobe'),
    output: env('OUTPUT_DIR', './output'),
    music: env('MUSIC_DIR', './assets/music'),
    db: env('DB_PATH', './db/words.db'),
  },
  content: {
    minWordLength: parseInt(env('MIN_WORD_LENGTH', '5')),
    maxWordLength: parseInt(env('MAX_WORD_LENGTH', '20')),
    minQualityScore: parseFloat(env('MIN_QUALITY_SCORE', '0.5')),
  },
};
