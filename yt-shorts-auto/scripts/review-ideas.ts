#!/usr/bin/env tsx
/**
 * review-ideas.ts — Interactive Content Idea Reviewer
 *
 * Walks you through all pending ideas one by one.
 * For each idea you can: Approve / Reject / Skip / Quit.
 * On approval, optionally use Claude API to write a full adapted script.
 *
 * Usage:
 *   npm run scout:review
 *   npm run scout:review -- --no-claude    # Skip Claude script generation
 *   npm run scout:review -- --approved     # Review already-approved ideas
 *   npm run scout:review -- --min-score=6  # Only show ideas above score
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { scoutConfig } from './scout-config.js';

// ── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const noClaude = args.includes('--no-claude');
const reviewApproved = args.includes('--approved');
const minScoreArg = args.find((a) => a.startsWith('--min-score='));
const minScore = minScoreArg ? parseFloat(minScoreArg.split('=')[1]) : 0;

// ── Paths ────────────────────────────────────────────────────────────────────

const IDEAS_DIR = path.resolve(scoutConfig.output.ideasDir);
const FOLDERS = {
  pending: path.join(IDEAS_DIR, 'pending'),
  approved: path.join(IDEAS_DIR, 'approved'),
  rejected: path.join(IDEAS_DIR, 'rejected'),
  produced: path.join(IDEAS_DIR, 'produced'),
};

// ── Terminal Utilities ───────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';

function clear() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function hr(char = '─', width = 60) {
  console.log(DIM + char.repeat(width) + RESET);
}

function badge(score: number) {
  const s = score.toFixed(1);
  if (score >= 7) return `${GREEN}${BOLD}★ ${s}/10${RESET}`;
  if (score >= 4) return `${YELLOW}◆ ${s}/10${RESET}`;
  return `${DIM}· ${s}/10${RESET}`;
}

// ── Idea File Parsing ────────────────────────────────────────────────────────

interface IdeaMeta {
  id: string;
  type: 'youtube' | 'reddit';
  source: string;
  format: string;
  outlierScore: number;
  status: string;
  scoutedAt: string;
}

function parseFrontmatter(content: string): Partial<IdeaMeta> {
  const meta: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }
  return {
    id: meta.id,
    type: meta.type as 'youtube' | 'reddit',
    source: meta.source,
    format: meta.format,
    outlierScore: parseFloat(meta.outlierScore ?? '0'),
    status: meta.status,
    scoutedAt: meta.scoutedAt,
  };
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : 'Untitled';
}

function extractSection(content: string, header: string): string {
  const regex = new RegExp(`##\\s+${header}[\\s\\S]*?(?=\\n##|$)`);
  const match = content.match(regex);
  if (!match) return '';
  return match[0].replace(/^##\s+[^\n]+\n/, '').trim();
}

// ── Claude Script Generation ─────────────────────────────────────────────────

async function generateAdaptedScript(ideaContent: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.log(`\n${YELLOW}⚠  ANTHROPIC_API_KEY not set — skipping Claude generation${RESET}`);
    return null;
  }

  const title = extractTitle(ideaContent);
  const formatBreakdown = extractSection(ideaContent, 'Format Breakdown');
  const hookOptions = extractSection(ideaContent, 'Adapted Hook Options for Our Channel');
  const wordCandidates = extractSection(ideaContent, 'Suggested Word Candidates');
  const notes = extractSection(ideaContent, 'Notes');

  const prompt = `You are a content writer for a vocabulary/word-of-the-day YouTube Shorts channel.

I'm adapting this content idea: "${title}"

Format guidance: ${formatBreakdown}
Hook options: ${hookOptions}
Word candidates: ${wordCandidates}
Notes: ${notes || 'None'}

Write a complete 25–35 second YouTube Shorts script adapted to our channel style. Use this structure:
1. HOOK (1-2 sentences, must grab attention instantly)
2. WORD + PRONUNCIATION (state the word clearly)
3. DEFINITION + EXAMPLE (make it vivid and relatable)
4. INSIGHT (why this word matters / fun fact)
5. CTA (short, varies from "Follow for a new word every day" occasionally)

Pick the best word from the candidates (or suggest a better one if none fit).
Format your response as:

WORD: [chosen word]
HOOK: [hook line]
PRONUNCIATION: [phonetic guide]
DEFINITION: [definition]
EXAMPLE: [example sentence]
INSIGHT: [interesting fact or observation]
CTA: [call to action]
FULL_SCRIPT: [complete script as it would be read aloud]`;

  try {
    process.stdout.write(`\n${CYAN}  Generating adapted script with Claude...${RESET}`);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(` ${RED}failed: ${err.slice(0, 100)}${RESET}`);
      return null;
    }

    const data = await res.json() as any;
    const script = data?.content?.[0]?.text ?? null;
    console.log(` ${GREEN}done${RESET}`);
    return script;
  } catch (err) {
    console.log(` ${RED}error: ${(err as Error).message}${RESET}`);
    return null;
  }
}

// ── Move File ────────────────────────────────────────────────────────────────

function moveIdea(fromPath: string, toFolder: keyof typeof FOLDERS) {
  const filename = path.basename(fromPath);
  const toPath = path.join(FOLDERS[toFolder], filename);
  fs.renameSync(fromPath, toPath);
  return toPath;
}

function updateFrontmatter(content: string, updates: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^(${key}:\\s*)(.*)$`, 'm');
    if (regex.test(result)) {
      result = result.replace(regex, `$1${value}`);
    }
  }
  return result;
}

// ── Keypress Input ───────────────────────────────────────────────────────────

function waitForKey(prompt: string, options: string[]): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    process.stdin.setRawMode(true);
    process.stdin.resume();

    console.log(prompt);
    process.stdin.once('data', (buf) => {
      const key = buf.toString().toLowerCase();
      process.stdin.setRawMode(false);
      rl.close();
      resolve(options.includes(key) ? key : 'skip');
    });
  });
}

// ── Display Idea ─────────────────────────────────────────────────────────────

function displayIdea(content: string, meta: Partial<IdeaMeta>, index: number, total: number) {
  clear();
  const title = extractTitle(content);
  const source = meta.type === 'youtube' ? '🎥 YouTube' : '📡 Reddit';
  const scoutedDate = meta.scoutedAt ? new Date(meta.scoutedAt).toLocaleDateString() : 'unknown';

  console.log(`${BOLD}${CYAN}IDEA REVIEW${RESET} ${DIM}(${index + 1} of ${total})${RESET}`);
  hr('═');
  console.log(`${BOLD}${title}${RESET}`);
  console.log(`${source}  ${DIM}·${RESET}  ${badge(meta.outlierScore ?? 0)}  ${DIM}·${RESET}  Scouted ${scoutedDate}`);
  if (meta.source) console.log(`${DIM}${meta.source}${RESET}`);
  hr();

  // Show stats table
  const statsSection = extractSection(content, 'Source Stats');
  if (statsSection) {
    console.log(`${BOLD}Stats${RESET}`);
    for (const line of statsSection.split('\n')) {
      if (line.includes('|') && !line.includes('---|')) {
        const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
        if (cols.length >= 2) {
          const label = cols[0].padEnd(20);
          const val = cols[1].replace(/\*\*/g, '');
          console.log(`  ${DIM}${label}${RESET} ${val}`);
        }
      }
    }
    hr();
  }

  // Show why it's an outlier
  const whySection = extractSection(content, "Why It's an Outlier") ||
                     extractSection(content, "Why It's Interesting");
  if (whySection) {
    console.log(`${BOLD}Why it works${RESET}`);
    console.log(`  ${DIM}${whySection.replace(/^>\s*/gm, '').trim()}${RESET}`);
    hr();
  }

  // Show hook options
  const hooksSection = extractSection(content, 'Adapted Hook Options');
  if (hooksSection) {
    console.log(`${BOLD}${MAGENTA}Hook Options${RESET}`);
    for (const line of hooksSection.split('\n').filter((l) => l.trim())) {
      console.log(`  ${MAGENTA}${line}${RESET}`);
    }
    hr();
  }

  // Show word candidates
  const wordsSection = extractSection(content, 'Suggested Word Candidates');
  if (wordsSection) {
    console.log(`${BOLD}Word Candidates${RESET}`);
    for (const line of wordsSection.split('\n').filter((l) => l.trim().startsWith('-'))) {
      console.log(`  ${line}`);
    }
    hr();
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────

function showStats() {
  clear();
  console.log(`${BOLD}${CYAN}CONTENT IDEA INBOX${RESET}`);
  hr('═');

  const counts: Record<string, number> = {};
  for (const [folder, fullPath] of Object.entries(FOLDERS)) {
    if (!fs.existsSync(fullPath)) { counts[folder] = 0; continue; }
    counts[folder] = fs.readdirSync(fullPath).filter((f) => f.endsWith('.md')).length;
  }

  console.log(`  ${YELLOW}Pending${RESET}   ${counts.pending ?? 0} ideas awaiting review`);
  console.log(`  ${GREEN}Approved${RESET}  ${counts.approved ?? 0} ideas ready to produce`);
  console.log(`  ${RED}Rejected${RESET}  ${counts.rejected ?? 0} ideas discarded`);
  console.log(`  ${CYAN}Produced${RESET}  ${counts.produced ?? 0} ideas turned into videos`);
  hr();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure folders exist
  Object.values(FOLDERS).forEach((d) => fs.mkdirSync(d, { recursive: true }));

  showStats();

  const folder = reviewApproved ? FOLDERS.approved : FOLDERS.pending;
  const label = reviewApproved ? 'approved' : 'pending';

  if (!fs.existsSync(folder)) {
    console.log(`No ${label}/ folder found.`);
    return;
  }

  let files = fs.readdirSync(folder)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(folder, f))
    .sort(); // alphabetical = chronological

  if (minScore > 0) {
    files = files.filter((fp) => {
      const content = fs.readFileSync(fp, 'utf-8');
      const meta = parseFrontmatter(content);
      return (meta.outlierScore ?? 0) >= minScore;
    });
  }

  if (files.length === 0) {
    console.log(`\n${YELLOW}No ${label} ideas to review.${RESET}`);
    console.log(`  Run ${CYAN}npm run scout${RESET} to discover new ideas first.\n`);
    return;
  }

  console.log(`\n  ${files.length} ${label} idea(s) to review`);
  console.log(`  ${DIM}Controls: [A] Approve  [R] Reject  [S] Skip  [Q] Quit${RESET}\n`);

  await new Promise((r) => setTimeout(r, 1500));

  let approved = 0;
  let rejected = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const filepath = files[i];
    let content = fs.readFileSync(filepath, 'utf-8');
    const meta = parseFrontmatter(content);

    displayIdea(content, meta, i, files.length);

    const promptLine = `\n${BOLD}[A]${RESET}pprove  ${BOLD}[R]${RESET}eject  ${BOLD}[S]${RESET}kip  ${BOLD}[Q]${RESET}uit\n> `;
    const key = await waitForKey(promptLine, ['a', 'r', 's', 'q']);

    if (key === 'q') {
      console.log(`\n${DIM}Exited review.${RESET}\n`);
      break;
    }

    if (key === 'r') {
      content = updateFrontmatter(content, { status: 'rejected' });
      fs.writeFileSync(filepath, content);
      moveIdea(filepath, 'rejected');
      console.log(`\n${RED}✗ Rejected${RESET}`);
      rejected++;
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    if (key === 's') {
      console.log(`\n${DIM}→ Skipped${RESET}`);
      skipped++;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    if (key === 'a') {
      // Optionally generate Claude script
      let claudeScript: string | null = null;
      if (!noClaude) {
        claudeScript = await generateAdaptedScript(content);
      }

      // Append Claude script to the file if generated
      if (claudeScript) {
        content += `\n---\n\n## Claude Generated Script\n\n\`\`\`\n${claudeScript}\n\`\`\`\n`;
      }

      content = updateFrontmatter(content, {
        status: 'approved',
        approvedAt: new Date().toISOString(),
      });

      if (!content.includes('approvedAt:')) {
        content = content.replace('---\n\n#', `approvedAt: ${new Date().toISOString()}\n---\n\n#`);
      }

      fs.writeFileSync(filepath, content);
      moveIdea(filepath, 'approved');
      console.log(`\n${GREEN}✓ Approved${claudeScript ? ' + Script generated' : ''}${RESET}`);
      approved++;
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  // Final summary
  clear();
  console.log(`${BOLD}${CYAN}Review Complete${RESET}`);
  hr('═');
  console.log(`  ${GREEN}Approved:${RESET} ${approved}`);
  console.log(`  ${RED}Rejected:${RESET} ${rejected}`);
  console.log(`  ${DIM}Skipped:${RESET}  ${skipped}`);
  hr();
  if (approved > 0) {
    console.log(`\n  ${GREEN}${approved} idea(s) moved to content-ideas/approved/${RESET}`);
    console.log(`  Open the files to review the Claude-generated scripts and word candidates.`);
    console.log(`  When ready, run your normal production pipeline for the chosen words.\n`);
  } else {
    console.log(`\n  No ideas approved this session.\n`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
