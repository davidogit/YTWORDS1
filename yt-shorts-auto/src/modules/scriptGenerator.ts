/**
 * scriptGenerator.ts — Generate the voiceover script for a YouTube Short.
 *
 * Formats:
 *   word-of-the-day  — curiosity-driven reveal
 *   misused-word     — ego-threat + correction
 *   funny-meaning    — absurdist surprise
 *   emotional-word   — recognition + naming
 *   guess-the-word   — 4 definition options shown visually, correct reveals after 3s pause
 *   scrabble-word    — board-game edge: high-value, surprising, valid Scrabble words
 */

import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { SCRABBLE_WORDS } from './discoverFallback.js';
import type { DictionaryResult, ShortScript, ShortFormat, QuizOption } from '../types/index.js';

const log = moduleLogger('scriptGenerator');

// ── Helpers ────────────────────────────────────────────────────────────────

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

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function estimateDuration(text: string): number {
  return Math.ceil(wordCount(text) / 2.5);
}

function stripIPA(text: string): string {
  return text
    .replace(/\/[^/]+\//g, '')
    .replace(/[ˈˌːʃʒʧʤθðŋɹɑɒɔəɛɜɪʊʌæ]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Strip academic language from a definition and tighten to ≤ 20 words.
 */
function tightenDefinition(raw: string, _partOfSpeech?: string): string {
  let def = raw
    .replace(/^(noun|verb|adjective|adverb|pronoun)[.:\s—–-]+/i, '')
    .replace(/;.*$/, '')
    .replace(/\s*\([^)]+\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const words = def.split(/\s+/);
  if (words.length > 20) {
    def = words.slice(0, 18).join(' ');
    def = def.replace(/\s+(and|or|but|with|for|of|in|to|a|an|the)$/i, '');
  }

  if (!def.endsWith('.')) def += '.';
  return def;
}

// ── Quiz Option Generation ─────────────────────────────────────────────────

/**
 * Plausible-sounding distractor definitions grouped by part of speech.
 * Used as fallback when LLM is unavailable.
 */
const DISTRACTOR_POOL: Record<string, string[]> = {
  noun: [
    'A type of vessel used in coastal trade.',
    'The outer layer of bark on an oak tree.',
    'A measurement used in traditional mapmaking.',
    'A tool used by cobblers to punch leather.',
    'The space between two parallel stone walls.',
    'A species of migratory bird found in Arctic regions.',
    'A fold or crease in a membrane or fabric.',
    'A unit of weight used in trading spices.',
    'An informal term for a small monetary debt.',
    'A ceremonial garment worn at harvest festivals.',
  ],
  verb: [
    'To move in a slow, deliberate circular motion.',
    'To reinforce a surface with a thin protective layer.',
    'To gradually wear away through repeated friction.',
    'To stretch or pull something beyond its natural limit.',
    'To make a sharp, resonant clicking sound.',
    'To arrange objects in strict order by size.',
  ],
  adjective: [
    'Relating to or resembling the deep ocean floor.',
    'Characterized by sudden, extreme shifts in temperature.',
    'Having a distinctly smooth, glass-like texture.',
    'Tending to absorb moisture readily from surrounding air.',
    'Occurring only during the early morning hours.',
    'Of or relating to ancient coastal trading customs.',
  ],
  default: [
    'A type of vessel used in coastal trade.',
    'Relating to or resembling the deep ocean floor.',
    'To gradually wear away through repeated friction.',
    'Characterized by sudden, extreme changes.',
    'A ceremonial garment worn at harvest festivals.',
    'Having a distinctly smooth, glass-like texture.',
    'A unit of weight used in trading spices.',
    'To move in a slow, deliberate circular motion.',
  ],
};

/**
 * Ask the LLM for 3 plausible-but-wrong definitions.
 * Returns null on any failure so the pool fallback takes over.
 */
async function generateLLMDistractors(
  word: string,
  correctDef: string,
  partOfSpeech?: string
): Promise<string[] | null> {
  const apiKey = config.openai.apiKey;
  if (!apiKey) return null;

  const prompt = `The word is "${word}" (${partOfSpeech ?? 'unknown POS'}).
Correct definition: "${correctDef}"

Write exactly 3 WRONG definitions that:
- Sound plausible and dictionary-like
- Cover different topics than the correct definition
- Are ≤ 12 words each
- Do NOT mention "${word}"

Return JSON only: { "distractors": ["def1", "def2", "def3"] }`;

  try {
    const resp = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.85,
        max_tokens: 150,
        response_format: { type: 'json_object' },
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as { distractors?: string[] };
    return parsed.distractors?.slice(0, 3) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build 4 QuizOption objects (1 correct + 3 distractors) shuffled with labels A–D.
 */
async function generateQuizOptions(
  word: string,
  correctDef: string,
  partOfSpeech?: string
): Promise<QuizOption[]> {
  let distractors = await generateLLMDistractors(word, correctDef, partOfSpeech);

  if (!distractors || distractors.length < 3) {
    const pos = partOfSpeech?.toLowerCase() ?? 'default';
    const pool = DISTRACTOR_POOL[pos] ?? DISTRACTOR_POOL.default;
    distractors = shuffle(pool).slice(0, 3);
  }

  const clean = (d: string) => {
    const trimmed = d.split(/\s+/).slice(0, 12).join(' ');
    return trimmed.endsWith('.') ? trimmed : trimmed + '.';
  };

  const shortCorrect = clean(tightenDefinition(correctDef));

  const options = shuffle([
    { text: shortCorrect,          correct: true  },
    { text: clean(distractors[0]), correct: false },
    { text: clean(distractors[1]), correct: false },
    { text: clean(distractors[2]), correct: false },
  ]);

  return options.map((opt, i) => ({ ...opt, label: ['A', 'B', 'C', 'D'][i] }));
}

// ── FORMAT 1: Word of the Day ──────────────────────────────────────────────

const WOTD_HOOKS = [
  () => `Nobody knows this word exists.`,
  () => `This word is real. Nobody uses it.`,
  () => `Stop. You need this word.`,
  () => `There's a single word for this feeling.`,
  () => `You've never heard this. You should have.`,
  () => `This might be the best word in English.`,
  () => `One word. Most people never learn it.`,
  () => `English hid this word from you.`,
  () => `This word is going to get stuck in your head.`,
  () => `You've felt this. There's actually a word for it.`,
];

const WOTD_CTAS = [
  `Save this — you'll use it today.`,
  `Follow. New word every day.`,
  `Comment if you already knew it.`,
  `Follow so you never run out of words.`,
  `Share this with someone who loves words.`,
  `Drop it in a sentence today.`,
];

function generateWordOfTheDayScript(word: string, dict: DictionaryResult): ShortScript {
  const hook = pick(WOTD_HOOKS)();
  const cta  = pick(WOTD_CTAS);
  const pronunciation = `The word is ${word}.`;
  const definition    = tightenDefinition(dict.definition ?? 'A rare and fascinating English word.', dict.partOfSpeech);
  const posStr        = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${definition}`;
  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);
  return { hook, pronunciation, definition: fullDefinition, cta, fullText, estimatedDuration: estimateDuration(fullText), format: 'word-of-the-day' };
}

// ── FORMAT 2: Misused Word ─────────────────────────────────────────────────

const MISUSED_HOOKS = [
  (w: string) => `You've been using "${w}" wrong.`,
  (w: string) => `"${w}" doesn't mean what you think.`,
  (w: string) => `Stop. You're misusing "${w}" right now.`,
  (w: string) => `Most people get "${w}" completely wrong.`,
  (w: string) => `Everyone misuses "${w}". Even you.`,
];

const MISUSED_CTAS = [
  `Save this so you stop making the mistake.`,
  `Follow — more words people get wrong daily.`,
  `Share with someone who needs to see this.`,
  `Comment if you were getting it right.`,
];

function generateMisusedWordScript(word: string, dict: DictionaryResult): ShortScript {
  const hook = pick(MISUSED_HOOKS)(word);
  const cta  = pick(MISUSED_CTAS);
  const pronunciation  = `The word is ${word}.`;
  const coreDef        = tightenDefinition(dict.definition ?? 'A commonly misunderstood English word.');
  const posStr         = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${coreDef} Most people confuse it — but now you know.`;
  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);
  return { hook, pronunciation, definition: fullDefinition, cta, fullText, estimatedDuration: estimateDuration(fullText), format: 'misused-word' };
}

// ── FORMAT 3: Funny Meaning ────────────────────────────────────────────────

const FUNNY_HOOKS = [
  () => `There is a real word for this.`,
  () => `This word exists. I cannot believe it.`,
  () => `The most specific word in the English language.`,
  () => `English named this. Of course it did.`,
  () => `Someone sat down and invented this word.`,
  () => `This is a real word and it's incredible.`,
  () => `English has a word for absolutely everything.`,
];

const FUNNY_CTAS = [
  `Use this word today and confuse everyone.`,
  `Follow — a new ridiculous word every day.`,
  `Share with someone who will love this.`,
  `Comment if you're using it tonight.`,
];

function generateFunnyMeaningScript(word: string, dict: DictionaryResult): ShortScript {
  const hook = pick(FUNNY_HOOKS)();
  const cta  = pick(FUNNY_CTAS);
  const pronunciation  = `The word is ${word}.`;
  const coreDef        = tightenDefinition(dict.definition ?? 'A wonderfully specific English word.');
  const posStr         = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${coreDef}`;
  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);
  return { hook, pronunciation, definition: fullDefinition, cta, fullText, estimatedDuration: estimateDuration(fullText), format: 'funny-meaning' };
}

// ── FORMAT 4: Emotional Word ───────────────────────────────────────────────

const EMOTIONAL_HOOKS = [
  () => `You've felt this. You never had a word for it.`,
  () => `This feeling has a name. Most never learn it.`,
  () => `There's a word for that thing you carry quietly.`,
  () => `You know this feeling. Here's its name.`,
  () => `This emotion visits everyone. Almost nobody can name it.`,
  () => `You've lived this. The word for it is beautiful.`,
  () => `That feeling you can't describe? Someone named it.`,
];

const EMOTIONAL_CTAS = [
  `Save this. You'll need this word.`,
  `Share with someone who feels this too.`,
  `Follow — more words for feelings you couldn't name.`,
  `Comment if this word hit different.`,
];

function generateEmotionalWordScript(word: string, dict: DictionaryResult): ShortScript {
  const hook = pick(EMOTIONAL_HOOKS)();
  const cta  = pick(EMOTIONAL_CTAS);
  const pronunciation  = `The word is ${word}.`;
  const coreDef        = tightenDefinition(dict.definition ?? 'A word for a feeling most people have experienced but never named.');
  const posStr         = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${coreDef}`;
  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);
  return { hook, pronunciation, definition: fullDefinition, cta, fullText, estimatedDuration: estimateDuration(fullText), format: 'emotional-word' };
}

// ── FORMAT 5: Guess the Word (4-option quiz card) ──────────────────────────

const GUESS_HOOKS = [
  (w: string) => `What does "${w}" mean? Pick one.`,
  (w: string) => `"${w}" — which definition is correct?`,
  (w: string) => `Four options. What does "${w}" mean?`,
  (w: string) => `One is right. Which definition fits "${w}"?`,
  (w: string) => `Do you know what "${w}" means?`,
];

const GUESS_CTAS = [
  `Comment if you got it right.`,
  `Follow — new word challenge every day.`,
  `Like if you got it. Follow if you didn't.`,
  `Drop your answer below.`,
];

async function generateGuessTheWordScript(word: string, dict: DictionaryResult): Promise<ShortScript> {
  const correctDef     = tightenDefinition(dict.definition ?? 'A rare and fascinating English word.');
  const hook           = pick(GUESS_HOOKS)(word);
  const pronunciation  = `The answer is ${word}.`;
  const posStr         = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${correctDef}`;
  const cta            = pick(GUESS_CTAS);

  // TTS speaks: hook → reveal → full def → CTA  (options are visual-only)
  const fullText = stripIPA(`${hook} ${pronunciation} ${correctDef} ${cta}`);

  const quizOptions = await generateQuizOptions(word, correctDef, dict.partOfSpeech);

  return {
    hook, pronunciation,
    definition: fullDefinition,
    cta, fullText,
    estimatedDuration: estimateDuration(fullText),
    format: 'guess-the-word',
    pauseAfterHook: true,
    quizOptions,
  };
}

// ── FORMAT 6: Scrabble Word ────────────────────────────────────────────────

function getScrabbleHooks(word: string, score: number, category: string): string[] {
  const scoreHooks = [
    `This word is worth ${score} points in Scrabble.`,
    `${score} points. One word. This is how you win.`,
    `Drop this in Scrabble for ${score} points.`,
  ];

  const surpriseHooks = [
    `Nobody believes this is a real word. It is.`,
    `Your opponent will challenge this. Don't let them.`,
    `This looks made up. It's in the dictionary.`,
    `They'll call you a liar. They'll be wrong.`,
  ];

  const competitiveHooks = [
    `Know this and you'll beat every Scrabble player you know.`,
    `The word that wins Scrabble games.`,
    `Memorise this. You'll thank me on game night.`,
    `This is the word Scrabble experts keep secret.`,
  ];

  if (category === 'q-no-u') return [
    `"${word.toUpperCase()}" — Q without U. Legal in Scrabble.`,
    `A Q without U word that will end any Scrabble game.`,
    `Play the Q without using a U. Legal. Deadly.`,
    ...surpriseHooks,
  ];

  if (category === 'two-letter') return [
    `"${word.toUpperCase()}" is a valid 2-letter Scrabble word.`,
    `Two letters. ${score} points. Game over.`,
    `The 2-letter word that opens every triple word score.`,
    ...competitiveHooks,
  ];

  if (score >= 20) return [...scoreHooks, ...competitiveHooks];
  return [...surpriseHooks, ...competitiveHooks];
}

const SCRABBLE_CTAS = [
  `Save this for your next game night.`,
  `Follow — a new Scrabble word every day.`,
  `Share with your Scrabble rival.`,
  `Comment your highest Scrabble score.`,
  `Follow to stay undefeated.`,
];

function generateScrabbleWordScript(word: string, dict: DictionaryResult): ShortScript {
  const meta     = SCRABBLE_WORDS.find((w) => w.word === word.toLowerCase());
  const score    = meta?.score    ?? 10;
  const category = meta?.category ?? 'power';

  const hook = pick(getScrabbleHooks(word, score, category));
  const cta  = pick(SCRABBLE_CTAS);

  const pronunciation = `The word is ${word}.`;
  const coreDef       = tightenDefinition(dict.definition ?? 'A valid Scrabble word with a surprising meaning.');
  const posStr        = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const scoreNote     = score >= 15 ? ` Worth ${score} points.` : ` Valid in standard Scrabble.`;
  const fullDefinition = `${posStr}${coreDef}${scoreNote}`;
  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);

  log.info({ word, score, category }, 'Scrabble script generated');

  return {
    hook, pronunciation,
    definition: fullDefinition,
    cta, fullText,
    estimatedDuration: estimateDuration(fullText),
    format: 'scrabble-word',
    scrabbleScore: score,
  };
}

// ── LLM-Enhanced Generation ────────────────────────────────────────────────

async function generateLLMScript(
  word: string,
  dict: DictionaryResult,
  format: ShortFormat
): Promise<ShortScript | null> {
  const apiKey = config.openai.apiKey;
  if (!apiKey) return null;

  const formatInstructions: Record<ShortFormat, string> = {
    'word-of-the-day': 'Curiosity hook. Short, declarative. No "Did you know" openers.',
    'misused-word':    'Ego-threat opener. "You\'ve been using X wrong."',
    'funny-meaning':   'Absurdist surprise. "This word exists. I cannot believe it."',
    'emotional-word':  'Recognition hook. "You\'ve felt this. Here\'s its name."',
    'guess-the-word':  'Show the word, ask which definition is correct.',
    'scrabble-word':   'Board-game angle. Reference score or Q/Z/X. "This wins Scrabble games."',
  };

  const prompt = `Word: "${word}" (${dict.partOfSpeech ?? 'unknown POS'})
Definition: ${dict.definition ?? 'unknown'}
Format: ${formatInstructions[format]}

RULES: Hook ≤ 10 words. Pronunciation = exactly "The word is ${word}." Definition ≤ 20 words, conversational. CTA ≤ 8 words. Total ≤ 55 words. No IPA symbols.
Return JSON: { "hook": "...", "pronunciation": "...", "definition": "...", "cta": "..." }`;

  try {
    const resp = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    });
    if (!resp.ok) return null;
    const data    = (await resp.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed  = JSON.parse(content) as { hook: string; pronunciation: string; definition: string; cta: string; };
    const fullText = stripIPA(`${parsed.hook} ${parsed.pronunciation} ${parsed.definition} ${parsed.cta}`);
    return { ...parsed, fullText, estimatedDuration: estimateDuration(fullText), format, pauseAfterHook: format === 'guess-the-word' };
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'LLM generation failed, using template');
    return null;
  }
}

// ── Main Entry Point ───────────────────────────────────────────────────────

export async function generateScript(
  word: string,
  dict: DictionaryResult,
  format: ShortFormat = 'word-of-the-day'
): Promise<ShortScript> {
  log.info({ word, format }, 'Generating script');

  if (format === 'scrabble-word') {
    const s = generateScrabbleWordScript(word, dict);
    log.info({ word, format, method: 'template', wc: wordCount(s.fullText), score: s.scrabbleScore }, 'Script ready');
    return s;
  }
  if (format === 'guess-the-word') {
    const s = await generateGuessTheWordScript(word, dict);
    log.info({ word, format, method: 'template', wc: wordCount(s.fullText), options: s.quizOptions?.length }, 'Script ready');
    return s;
  }
  if (format === 'misused-word') {
    const s = generateMisusedWordScript(word, dict);
    log.info({ word, format, method: 'template', wc: wordCount(s.fullText) }, 'Script ready');
    return s;
  }
  if (format === 'funny-meaning') {
    const s = generateFunnyMeaningScript(word, dict);
    log.info({ word, format, method: 'template', wc: wordCount(s.fullText) }, 'Script ready');
    return s;
  }
  if (format === 'emotional-word') {
    const s = generateEmotionalWordScript(word, dict);
    log.info({ word, format, method: 'template', wc: wordCount(s.fullText) }, 'Script ready');
    return s;
  }

  const llm = await generateLLMScript(word, dict, format);
  if (llm) {
    log.info({ word, format, method: 'llm', wc: wordCount(llm.fullText) }, 'Script ready');
    return llm;
  }

  const s = generateWordOfTheDayScript(word, dict);
  log.info({ word, format, method: 'template', wc: wordCount(s.fullText) }, 'Script ready');
  return s;
}