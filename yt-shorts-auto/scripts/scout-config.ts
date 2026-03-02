/**
 * scout-config.ts — Configure the Trend Scout system.
 *
 * Edit this file to set your niche keywords, competitor channels,
 * adjacent niches to bend from, and scoring thresholds.
 */

export const scoutConfig = {
  youtube: {
    /**
     * PRIMARY keywords — your exact niche space.
     * These search directly for competitors in your lane.
     */
    primaryKeywords: [
      'word of the day shorts',
      'vocabulary shorts',
      'rare english words shorts',
      'english word meaning shorts',
      'learn new english word',
      'obscure english word',
      'unusual word shorts',
    ],

    /**
     * ADJACENT keywords — neighbouring niches to bend ideas from.
     * High-performing formats here often translate well to your niche.
     */
    adjacentKeywords: [
      'you have been saying this wrong',
      'mispronounced words shorts',
      'word origin story shorts',
      'etymology shorts',
      'grammar shorts facts',
      'did you know english language',
      'words with no english translation',
      'satisfying words shorts',
    ],

    /**
     * COMPETITOR channel IDs to monitor for their top-performing Shorts.
     * Find a channel ID: go to the channel → View Page Source → search "channelId"
     * Or use: https://commentpicker.com/youtube-channel-id.php
     *
     * Example:
     *   'UCxxxxxxxxxxxxxxxxxxxxxx',  // WordOfTheDayChannel
     */
    competitorChannelIds: [
      // Add channel IDs here:
      // 'UCxxxxxxxxxxxxxxxxxxxxxx',
    ],

    /** Max video results returned per search query */
    maxResultsPerQuery: 15,

    /** Only consider videos published within this many days */
    publishedAfterDays: 90,

    /** Skip videos with fewer views than this (avoid noise) */
    minViewsForConsideration: 5_000,
  },

  rss: {
    /**
     * RSS/Atom feeds to scout for trending language & vocabulary content.
     * No authentication needed — just URLs.
     *
     * Includes:
     *   - Authoritative vocabulary sources (Merriam-Webster, Dictionary.com, etc.)
     *   - Reddit public RSS feeds (no OAuth required — these are open to everyone)
     *   - Language & etymology blogs
     *
     * To add more feeds: paste any RSS/Atom URL below.
     * Reddit subreddits: https://www.reddit.com/r/SUBREDDIT_NAME.rss
     */
    feeds: [
      // ── Authoritative Vocabulary Sources ──────────────────────────────────
      {
        name: 'Merriam-Webster Word of the Day',
        url: 'https://www.merriam-webster.com/wotd/feed/rss2',
        weight: 1.5, // boost score from editorial sources
      },
      {
        name: 'A Word A Day (Wordsmith)',
        url: 'https://wordsmith.org/awad/rss1.xml',
        weight: 1.5,
      },
      {
        name: 'Vocabulary.com Word of the Day',
        url: 'https://www.vocabulary.com/lists/1/words.rss',
        weight: 1.2,
      },
      // ── Reddit Public RSS (no auth needed) ────────────────────────────────
      {
        name: 'r/etymology',
        url: 'https://www.reddit.com/r/etymology.rss',
        weight: 1.0,
      },
      {
        name: 'r/linguistics',
        url: 'https://www.reddit.com/r/linguistics.rss',
        weight: 1.0,
      },
      {
        name: 'r/wordplay',
        url: 'https://www.reddit.com/r/wordplay.rss',
        weight: 1.0,
      },
      {
        name: 'r/logophilia',
        url: 'https://www.reddit.com/r/logophilia.rss',
        weight: 1.0,
      },
      {
        name: 'r/languagelearning',
        url: 'https://www.reddit.com/r/languagelearning/top.rss?t=week',
        weight: 0.9,
      },
      {
        name: 'r/grammar',
        url: 'https://www.reddit.com/r/grammar/top.rss?t=week',
        weight: 0.9,
      },
    ],

    /** Minimum Reddit upvote score to consider a post (0 = include everything) */
    minRedditScore: 50,

    /** Max items to process per feed */
    maxItemsPerFeed: 20,
  },

  scoring: {
    /** Only save ideas with outlier score above this threshold (0–10 scale) */
    minOutlierScore: 2.5,

    /**
     * Recency weight: how much we favour recent videos (0–1).
     * 1 = strong recency bias, 0 = no recency bias.
     */
    recencyWeight: 0.8,
  },

  output: {
    /** Root folder for idea files (relative to project root) */
    ideasDir: './content-ideas',
  },
};

/**
 * Format archetypes — detected from video titles/descriptions.
 * Used to classify the content format and generate adapted hooks.
 */
export const FORMAT_ARCHETYPES = {
  'pronunciation-reveal': {
    label: 'Pronunciation Reveal',
    signals: ['wrong', 'mispronounce', 'pronounce', 'saying it wrong', 'actually say'],
    hookTemplates: [
      "You've been saying [WORD] wrong your whole life",
      'Nobody pronounces [WORD] correctly — including you',
      '[WORD] is NOT pronounced how you think',
    ],
    scriptNote: 'Hook = ego-threat, reveal the correct pronunciation, satisfying correction.',
  },

  'word-you-didnt-know': {
    label: 'Word You Didn\'t Know Existed',
    signals: ['word for', "there's a word", 'word that means', 'no word', 'word you never knew'],
    hookTemplates: [
      "There's actually a word for that feeling",
      'The word [WORD] describes something you feel all the time',
      'You experience [WORD] every day but never knew its name',
    ],
    scriptNote: 'Hook = revelation, define something relatable, word is the payoff.',
  },

  'word-origin-story': {
    label: 'Word Origin / Etymology',
    signals: ['origin', 'etymology', 'comes from', 'derived from', 'history of the word', 'originally meant'],
    hookTemplates: [
      'The origin of [WORD] will change how you see it forever',
      '[WORD] has a darker history than you expected',
      'The word [WORD] originally meant something completely different',
    ],
    scriptNote: 'Hook = curiosity gap, reveal unexpected etymology, end with modern meaning.',
  },

  'counter-intuitive': {
    label: 'Word Means Something Different',
    signals: ['actually means', 'real meaning', "doesn't mean", 'misused', 'using it wrong', 'you\'re wrong about'],
    hookTemplates: [
      '[WORD] doesn\'t mean what you think it means',
      "You've been using [WORD] wrong — here's the real meaning",
      'Most people misuse [WORD] every single day',
    ],
    scriptNote: 'Hook = ego-threat on knowledge, correct the misconception, satisfying truth.',
  },

  'satisfying-definition': {
    label: 'Beautiful / Satisfying Word',
    signals: ['beautiful word', 'satisfying', 'perfect word', 'elegant', 'poetic'],
    hookTemplates: [
      'This is the most satisfying word you\'ll learn today',
      '[WORD] — the most beautiful word in the English language',
      'Today\'s word: [WORD] — you\'ll want to use it immediately',
    ],
    scriptNote: 'Hook = aesthetic appeal, focus on sound + meaning, encourage sharing.',
  },

  'unknown': {
    label: 'General / Unknown Format',
    signals: [],
    hookTemplates: [
      "Today's word: [WORD]",
      'The word [WORD] — you need to know this',
      'Word of the day: [WORD]',
    ],
    scriptNote: 'Standard word-of-the-day format.',
  },
} as const;

export type FormatArchetype = keyof typeof FORMAT_ARCHETYPES;
