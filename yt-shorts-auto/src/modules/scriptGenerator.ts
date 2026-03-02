/**
 * scriptGenerator.ts — Generate the voiceover script for a YouTube Short.
 *
 * Structure (15–45s total):
 *   1. Hook (2–5s): Curiosity-driven opener
 *   2. Pronunciation (3–5s): "The word is X, pronounced Y"
 *   3. Definition (10–20s): Plain English explanation
 *   4. CTA (2–3s): Follow/subscribe prompt
 *
 * Two modes:
 *   - Template-based (deterministic, zero cost)
 *   - LLM-enhanced (OpenAI, for more creative hooks)
 */

import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import type { DictionaryResult, ShortScript } from '../types/index.js';

const log = moduleLogger('scriptGenerator');

/**
 * Strip IPA / phonetic symbols that TTS engines can't pronounce.
 * Removes: ˈ ˌ ː ʃ ʒ ʧ ʤ θ ð ŋ ɹ ɑ ɒ ɔ ə ɛ ɜ ɪ ʊ ʌ æ and /slashes/.
 * Also removes any text enclosed in forward slashes (e.g. "/suːˈsʌɹəs/").
 */
function stripIPA(text: string): string {
  return text
    .replace(/\/[^/]+\//g, '')                              // Remove /ipa/ blocks entirely
    .replace(/[ˈˌːʃʒʧʤθðŋɹɑɒɔəɛɜɪʊʌæ]+/g, '')           // Remove stray IPA chars
    .replace(/\s{2,}/g, ' ')                                // Collapse double spaces
    .trim();
}

// ── Hook Templates ─────────────────────────────────────────────────────────

const HOOK_TEMPLATES = [
  (w: string) => `Did you know there's a word for this?`,
  (w: string) => `Bet you've never heard this word before.`,
  (w: string) => `This word sounds completely made up, but it's real.`,
  (w: string) => `Here's a word that will make you sound like a genius.`,
  (w: string) => `Stop scrolling. You need to know this word.`,
  (w: string) => `English has a word for everything, and this one is wild.`,
  (w: string) => `I learned a new word today and I can't stop saying it.`,
  (w: string) => `This might be the most satisfying word in English.`,
  (w: string) => `What if I told you there's one word for this?`,
  (w: string) => `You'll want to use this word in every conversation.`,
];

const CTA_TEMPLATES = [
  'Follow for more words that will blow your mind!',
  'Follow for a new word every day!',
  'Which word should I do next? Drop it in the comments!',
  'Like and follow if you learned something new!',
  'Share this with someone who loves words!',
];

// ── Template-based Generation ──────────────────────────────────────────────

function generateTemplateScript(word: string, dict: DictionaryResult): ShortScript {
  // Pick random hook and CTA
  const hookFn = HOOK_TEMPLATES[Math.floor(Math.random() * HOOK_TEMPLATES.length)];
  const hook = hookFn(word);
  const cta = CTA_TEMPLATES[Math.floor(Math.random() * CTA_TEMPLATES.length)];

  // Build pronunciation line — just say the word; TTS handles pronunciation naturally.
  // IPA symbols (ˈ ː ʌ etc.) are NOT speakable — they display on screen only.
  const pronunciation = `The word is ${word}.`;

  // Build definition (simplify if needed, cap length)
  let definition = dict.definition ?? `It refers to something remarkable and unique.`;
  // Ensure it's conversational
  if (!definition.endsWith('.')) definition += '.';
  // Keep it concise for a Short (max ~40 words)
  const words = definition.split(/\s+/);
  if (words.length > 40) {
    definition = words.slice(0, 35).join(' ') + '.';
  }

  // Add part of speech context
  const posStr = dict.partOfSpeech ? `It's a ${dict.partOfSpeech}. ` : '';
  const fullDefinition = `${posStr}${definition}`;

  // Assemble full script — strip any IPA that might have leaked in
  const fullText = stripIPA(`${hook} ${pronunciation} ${fullDefinition} ${cta}`);

  // Estimate duration: average speaking rate ~2.5 words/sec
  const wordCount = fullText.split(/\s+/).length;
  const estimatedDuration = Math.ceil(wordCount / 2.5);

  return {
    hook,
    pronunciation,
    definition: fullDefinition,
    cta,
    fullText,
    estimatedDuration,
  };
}

// ── LLM-Enhanced Generation (Optional: OpenAI) ────────────────────────────

/**
 * Use OpenAI to generate a more creative hook and definition.
 * Falls back to templates if API key is missing or call fails.
 */
async function generateLLMScript(word: string, dict: DictionaryResult): Promise<ShortScript | null> {
  const apiKey = config.openai.apiKey;
  if (!apiKey) return null;

  const prompt = `You are writing a script for a YouTube Short about the English word "${word}".

Word: ${word}
Part of speech: ${dict.partOfSpeech ?? 'unknown'}
Dictionary definition: ${dict.definition ?? 'unknown'}

Write a SHORT voiceover script (15-30 seconds when spoken) with these exact sections:
1. HOOK (1-2 sentences, curiosity-driven, makes viewer stop scrolling)
2. PRONUNCIATION — just "The word is ${word}." Do NOT include IPA symbols, phonetic notation, or pronunciation guides. The TTS engine will pronounce the word correctly on its own.
3. DEFINITION (2-3 sentences, simple plain English, conversational, maybe with an example)
4. CTA (1 sentence, follow/subscribe prompt)

Rules:
- Total should be under 80 words
- Use conversational, engaging language
- The hook should NOT contain the word itself
- Avoid clichés like "Welcome back" or "Hey guys"
- NEVER include IPA symbols (like ˈ ː ʌ ɹ etc.) or slash-enclosed pronunciations — they sound garbled when spoken by TTS

Return as JSON: { "hook": "...", "pronunciation": "...", "definition": "...", "cta": "..." }`;

  try {
    const resp = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini', // Cheap & fast — sufficient for short scripts
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
    const wordCount = fullText.split(/\s+/).length;

    log.info({ word, wordCount }, 'LLM script generated');

    return {
      ...parsed,
      fullText,
      estimatedDuration: Math.ceil(wordCount / 2.5),
    };
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'LLM generation failed, using template');
    return null;
  }
}

// ── Main Generation Entry Point ────────────────────────────────────────────

/**
 * Generate a voiceover script for the given word.
 * Tries LLM first (if configured), falls back to templates.
 */
export async function generateScript(word: string, dict: DictionaryResult): Promise<ShortScript> {
  log.info({ word }, 'Generating script');

  // Try LLM-enhanced version first
  const llmScript = await generateLLMScript(word, dict);
  if (llmScript) {
    log.info({ word, method: 'llm', duration: llmScript.estimatedDuration }, 'Script ready');
    return llmScript;
  }

  // Fall back to deterministic templates
  const templateScript = generateTemplateScript(word, dict);
  log.info({ word, method: 'template', duration: templateScript.estimatedDuration }, 'Script ready');
  return templateScript;
}
