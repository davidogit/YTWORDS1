/**
 * scriptGenerator.ts — Generate the voiceover script for a YouTube Short.
 *
 * Formats supported:
 *   word-of-the-day  — classic: hook → word → definition → CTA
 *   misused-word     — "You've been using X wrong your whole life"
 *   funny-meaning    — "There's actually a word for this"
 *   emotional-word   — "There's a word for that feeling you can't describe"
 *   guess-the-word   — definition first → pause → reveal
 *
 * All formats fall back to template generation if LLM is unavailable.
 */

import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import type { DictionaryResult, ShortScript, ShortFormat } from '../types/index.js';

const log = moduleLogger('scriptGenerator');

/**
 * Strip IPA / phonetic symbols that TTS engines can't pronounce.
 */
function stripIPA(text: string): string {
  return text
    .replace(/\/[^/]+\//g, '')
    .replace(/[ˈˌːʃʒʧʤθðŋɹɑɒɔəɛɜɪʊʌæ]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Shared helper ──────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function estimateDuration(text: string): number {
  return Math.ceil(wordCount(text) / 2.5);
}

// ── Format 1: Word of the Day (existing, refined hooks) ───────────────────

const WOTD_HOOKS = [
  () => `Did you know there's a word for this?`,
  () => `Bet you've never heard this word before.`,
  () => `This word sounds completely made up, but it's real.`,
  () => `Here's a word that will make you sound like a genius.`,
  () => `Stop scrolling. You need to know this word.`,
  () => `English has a word for everything, and this one is wild.`,
  () => `I learned a new word today and I can't stop saying it.`,
  () => `This might be the most satisfying word in English.`,
  () => `What if I told you there's one word for this?`,
  () => `You'll want to use this word in every conversation.`,
];

const WOTD_CTAS = [
  'Follow for more words that will blow your mind!',
  'Follow for a new word every day!',
  'Which word should I do next? Drop it in the comments!',
  'Like and follow if you learned something new!',
  'Share this with someone who loves words!',
];

function generateWordOfTheDayScript(word: string, dict: DictionaryResult): ShortScript {
  const hookFn = pick(WOTD_HOOKS);
  const hook = hookFn();
  const cta = pick(WOTD_CTAS);
  const pronunciation = `The word is ${word}.`;

  let definition = dict.definition ?? `A rare and fascinating English word.`;
  if (!definition.endsWith('.')) definition += '.';
  const words = definition.split(/\s+/);
  if (words.length > 40) definition = words.slice(0, 35).join(' ') + '.';

  const posStr = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${definition}`;
  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);

  return {
    hook, pronunciation,
    definition: fullDefinition,
    cta, fullText,
    estimatedDuration: estimateDuration(fullText),
    format: 'word-of-the-day',
  };
}

// ── Format 2: Misused Word ────────────────────────────────────────────────

function generateMisusedWordScript(word: string, dict: DictionaryResult): ShortScript {
  const hook = pick([
    `You've been using "${word}" wrong your entire life.`,
    `"${word}" does NOT mean what most people think it means.`,
    `Stop. You're probably misusing "${word}" right now.`,
    `Here's why "${word}" confuses absolutely everyone.`,
    `Most people get "${word}" wrong — including you, probably.`,
    `Be honest. You've been misusing "${word}", haven't you.`,
  ]);

  const pronunciation = `The word is ${word}.`;

  let definition = dict.definition ?? `A commonly misunderstood English word.`;
  if (!definition.endsWith('.')) definition += '.';
  const posStr = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${definition} Most people confuse it with a different word, but now you know the real meaning.`;

  const cta = pick([
    'Follow so you never get this wrong again!',
    'Save this so you stop making this mistake!',
    'Follow for more words people misuse every day!',
    'Share this with someone who needs to see it!',
  ]);

  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);

  return {
    hook, pronunciation,
    definition: fullDefinition,
    cta, fullText,
    estimatedDuration: estimateDuration(fullText),
    format: 'misused-word',
  };
}

// ── Format 3: Funny Meaning ───────────────────────────────────────────────

function generateFunnyMeaningScript(word: string, dict: DictionaryResult): ShortScript {
  const hook = pick([
    `There's actually a word for this, and it's hilarious.`,
    `English has a word for this and nobody talks about it.`,
    `This word sounds completely made up. It is one hundred percent real.`,
    `The most specific word in the English language.`,
    `You didn't know English had a word for this, did you.`,
    `I need you to stop and appreciate this word for a second.`,
    `There is a real English word for this. I cannot believe it exists.`,
  ]);

  const pronunciation = `The word is ${word}.`;

  let definition = dict.definition ?? `A wonderfully specific English word.`;
  if (!definition.endsWith('.')) definition += '.';
  const posStr = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${definition}`;

  const cta = pick([
    'Follow for more ridiculous real English words!',
    'Drop this word in a conversation today!',
    'Share this with someone who loves words!',
    'Follow — I post a new one every day!',
    'Use this word today and confuse everyone around you!',
  ]);

  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);

  return {
    hook, pronunciation,
    definition: fullDefinition,
    cta, fullText,
    estimatedDuration: estimateDuration(fullText),
    format: 'funny-meaning',
  };
}

// ── Format 4: Emotional Word ──────────────────────────────────────────────

function generateEmotionalWordScript(word: string, dict: DictionaryResult): ShortScript {
  const hook = pick([
    `There's a word for that feeling you can never quite describe.`,
    `You've felt this. You just didn't know there was a word for it.`,
    `This word describes an emotion most people carry silently.`,
    `If you've ever felt this, there is actually a word for it.`,
    `This feeling has a name. Most people never learn it.`,
    `The emotion you've always felt but could never put into words.`,
    `Someone named this feeling. And once you know the word, you'll feel it even more.`,
  ]);

  const pronunciation = `The word is ${word}.`;

  let definition = dict.definition ?? `A word for a feeling most people have experienced but never named.`;
  if (!definition.endsWith('.')) definition += '.';
  const posStr = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${definition}`;

  const cta = pick([
    'Follow for more words that describe feelings you thought were indescribable.',
    'Save this. You will want to share it.',
    'Follow for the words your emotions have been missing.',
    'Share this with someone who needs this word today.',
    'Follow — I post one of these every single day.',
  ]);

  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);

  return {
    hook, pronunciation,
    definition: fullDefinition,
    cta, fullText,
    estimatedDuration: estimateDuration(fullText),
    format: 'emotional-word',
  };
}

// ── Format 5: Guess the Word ──────────────────────────────────────────────

function generateGuessTheWordScript(word: string, dict: DictionaryResult): ShortScript {
  const definition = dict.definition ?? `A feeling most people experience but never name.`;
  const cleanDef = definition.replace(/\.$/, '');

  // Hook IS the definition — viewer guesses before the reveal
  const hook = pick([
    `This word means: "${cleanDef}." Three seconds to guess.`,
    `What's the word for this: "${cleanDef}?" Do you know it?`,
    `I'll describe it. You guess the word. Ready? ${cleanDef}.`,
    `Three seconds. What's the word for this: ${cleanDef}.`,
    `Can you guess the word? Here's the clue: ${cleanDef}.`,
  ]);

  // Pronunciation = the reveal, happens after the pause
  const pronunciation = `The word is ${word}.`;

  const posStr = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${definition}`;

  const cta = pick([
    'Follow for more — can you guess the next one?',
    'Comment if you got it right!',
    'Follow for a new word challenge every day!',
    'Did you get it? Follow for the next one!',
    'Like if you got it right. Follow if you didn\'t!',
  ]);

  // For guess-the-word, fullText has a natural pause point between hook and reveal
  const fullText = stripIPA(`${hook} ${pronunciation} ${cta}`);

  return {
    hook,
    pronunciation,
    definition: fullDefinition,
    cta, fullText,
    estimatedDuration: estimateDuration(fullText),
    format: 'guess-the-word',
    pauseAfterHook: true,
  };
}

// ── LLM-Enhanced Generation (Optional: OpenAI) ────────────────────────────

async function generateLLMScript(
  word: string,
  dict: DictionaryResult,
  format: ShortFormat
): Promise<ShortScript | null> {
  const apiKey = config.openai.apiKey;
  if (!apiKey) return null;

  const formatInstructions: Record<ShortFormat, string> = {
    'word-of-the-day': 'Classic word-of-the-day format. Curiosity-driven hook, then word, then definition.',
    'misused-word': 'This word is commonly misused. Hook = "you\'ve been using this wrong." Reveal the real meaning.',
    'funny-meaning': 'This word has a funny or oddly specific meaning. Hook = surprise that this word exists.',
    'emotional-word': 'This word describes a feeling people have but couldn\'t name. Hook = empathy and recognition.',
    'guess-the-word': 'Give the definition first as the hook. Pause implied. Then reveal the word.',
  };

  const prompt = `You are writing a script for a YouTube Short about the English word "${word}".

Format: ${formatInstructions[format]}

Word: ${word}
Part of speech: ${dict.partOfSpeech ?? 'unknown'}
Dictionary definition: ${dict.definition ?? 'unknown'}

Write a SHORT voiceover script (15-30 seconds when spoken) with these exact sections:
1. HOOK (1-2 sentences, format-appropriate, makes viewer stop scrolling)
2. PRONUNCIATION — just "The word is ${word}." Do NOT include IPA symbols or phonetic notation.
3. DEFINITION (2-3 sentences, simple plain English, conversational)
4. CTA (1 sentence, follow/subscribe prompt)

Rules:
- Total under 80 words
- Conversational, engaging language
- NEVER include IPA symbols (ˈ ː ʌ ɹ etc.) — they sound garbled when spoken
- No clichés like "Welcome back" or "Hey guys"

Return as JSON: { "hook": "...", "pronunciation": "...", "definition": "...", "cta": "..." }`;

  try {
    const resp = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      log.warn({ status: resp.status }, 'OpenAI API call failed');
      return null;
    }

    const data = (await resp.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as {
      hook: string; pronunciation: string; definition: string; cta: string;
    };

    const fullText = stripIPA(`${parsed.hook} ${parsed.pronunciation} ${parsed.definition} ${parsed.cta}`);

    log.info({ word, format, wordCount: wordCount(fullText) }, 'LLM script generated');

    return {
      ...parsed,
      fullText,
      estimatedDuration: estimateDuration(fullText),
      format,
      pauseAfterHook: format === 'guess-the-word',
    };
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'LLM generation failed, using template');
    return null;
  }
}

// ── Main Generation Entry Point ────────────────────────────────────────────

/**
 * Generate a voiceover script for the given word and format.
 *
 * Format-specific generators (misused, funny, emotional, guess) run
 * without LLM for speed and reliability.
 * word-of-the-day tries LLM first then falls back to templates.
 */
export async function generateScript(
  word: string,
  dict: DictionaryResult,
  format: ShortFormat = 'word-of-the-day'
): Promise<ShortScript> {
  log.info({ word, format }, 'Generating script');

  // Format-specific template generators — fast and reliable
  if (format === 'misused-word') {
    const script = generateMisusedWordScript(word, dict);
    log.info({ word, format, method: 'template', duration: script.estimatedDuration }, 'Script ready');
    return script;
  }

  if (format === 'funny-meaning') {
    const script = generateFunnyMeaningScript(word, dict);
    log.info({ word, format, method: 'template', duration: script.estimatedDuration }, 'Script ready');
    return script;
  }

  if (format === 'emotional-word') {
    const script = generateEmotionalWordScript(word, dict);
    log.info({ word, format, method: 'template', duration: script.estimatedDuration }, 'Script ready');
    return script;
  }

  if (format === 'guess-the-word') {
    const script = generateGuessTheWordScript(word, dict);
    log.info({ word, format, method: 'template', duration: script.estimatedDuration }, 'Script ready');
    return script;
  }

  // word-of-the-day: try LLM first, fall back to template
  const llmScript = await generateLLMScript(word, dict, format);
  if (llmScript) {
    log.info({ word, format, method: 'llm', duration: llmScript.estimatedDuration }, 'Script ready');
    return llmScript;
  }

  const templateScript = generateWordOfTheDayScript(word, dict);
  log.info({ word, format, method: 'template', duration: templateScript.estimatedDuration }, 'Script ready');
  return templateScript;
}