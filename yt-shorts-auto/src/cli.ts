#!/usr/bin/env node
/**
 * cli.ts — Main CLI entrypoint for yt-shorts-auto.
 *
 * Usage:
 *   npm run produce                  # Full pipeline (discover → upload)
 *   npm run produce -- --dry-run     # Stop after script generation
 *   npm run produce -- --no-upload   # Render but don't upload
 *   npm run produce -- --word=susurrus  # Use a specific word
 *   npm run produce -- --source=rss        # RSS feeds (default)
 *   npm run produce -- --source=reddit     # Use Reddit OAuth source
 *   npm run produce -- --source=fallback   # Curated word list only
 *   npm run produce -- --batch 3     # Produce 3 videos in one run
 *   npm run produce -- --verbose     # Debug-level logging
 */

import { Command } from 'commander';
import { runPipeline } from './pipeline.js';
import { getStats, closeDb } from './utils/db.js';
import { logger } from './utils/logger.js';
import type { CLIOptions, PipelineItem } from './types/index.js';

const program = new Command();

program
  .name('yt-shorts-auto')
  .description('Automated YouTube Shorts pipeline — fun word of the day')
  .version('1.0.0');

program
  .command('produce')
  .description('Run the full production pipeline for one or more Shorts')
  .option('--dry-run', 'Stop after script generation (no TTS/render/upload)', false)
  .option('--no-upload', 'Render the video but skip YouTube upload')
  .option('--source <source>', 'Word source: rss (default), reddit, fallback', 'rss')
  .option('--word <word>', 'Use a specific word (skips discovery)')
  .option('--batch <count>', 'Produce multiple videos in one run', '1')
  .option('--verbose', 'Enable debug logging', false)
  .option('--schedule <datetime>', 'Schedule publish at ISO datetime (e.g. 2026-02-26T21:10:00Z)')
  .action(async (opts) => {
    if (opts.verbose) {
      logger.level = 'debug';
    }

    const batchCount = Math.max(1, parseInt(opts.batch) || 1);
    const options: CLIOptions = {
      dryRun: opts.dryRun ?? false,
      noUpload: !opts.upload, // commander parses --no-upload as upload=false
      source: opts.word ? 'manual' : (opts.source as CLIOptions['source']),
      word: opts.word,
      verbose: opts.verbose ?? false,
      batch: batchCount,
      schedule: opts.schedule,
    };

    const results: Array<{ word: string; status: string; url?: string; error?: string }> = [];

    for (let i = 0; i < batchCount; i++) {
      if (batchCount > 1) {
        logger.info(`\n━━━ Video ${i + 1} of ${batchCount} ━━━`);
      }

      try {
        const result = await runPipeline(options);

        if (result) {
          results.push({
            word: result.word,
            status: result.status,
            url: result.youtubeUrl,
          });

          logger.info('');
          logger.info('═══════════════════════════════════════════');
          logger.info(`  Word:   ${result.word}`);
          logger.info(`  Status: ${result.status}`);
          if (result.youtubeUrl) {
            logger.info(`  URL:    ${result.youtubeUrl}`);
          }
          if (result.videoPath) {
            logger.info(`  Video:  ${result.videoPath}`);
          }
          logger.info('═══════════════════════════════════════════');
        } else {
          results.push({ word: '(none)', status: 'no_result' });
          logger.warn('Pipeline returned no result — check logs above');
        }
      } catch (err) {
        const errorMsg = (err as Error).message;
        results.push({ word: '(failed)', status: 'failed', error: errorMsg });
        logger.error({ error: errorMsg, attempt: i + 1 }, 'Pipeline failed for this batch item — continuing');
      }

      // Delay between batch items to avoid rate limiting
      if (i < batchCount - 1) {
        logger.info('Waiting 30s before next video...');
        await new Promise((r) => setTimeout(r, 30000));
      }
    }

    // Print batch summary if more than 1
    if (batchCount > 1) {
      logger.info('\n━━━ BATCH SUMMARY ━━━');
      const succeeded = results.filter((r) => r.status === 'uploaded' || r.status === 'rendered');
      const failed = results.filter((r) => r.status === 'failed' || r.status === 'no_result');
      logger.info(`  Produced: ${succeeded.length}/${batchCount}`);
      logger.info(`  Failed:   ${failed.length}/${batchCount}`);
      for (const r of results) {
        const icon = r.status === 'uploaded' ? '✓' : r.status === 'rendered' ? '~' : '✗';
        logger.info(`  ${icon} ${r.word} — ${r.status}${r.url ? ` — ${r.url}` : ''}${r.error ? ` — ${r.error}` : ''}`);
      }
      logger.info('━━━━━━━━━━━━━━━━━━━━━');

      if (failed.length === batchCount) {
        process.exitCode = 1;
      }
    } else if (results.length === 0 || results[0].status === 'failed') {
      process.exitCode = 1;
    }

    closeDb();
  });

program
  .command('stats')
  .description('Show pipeline statistics')
  .action(() => {
    const stats = getStats();
    console.table(stats);
    closeDb();
  });

// Default command: run produce
program.action(async () => {
  // If no command is specified, run produce
  await program.parseAsync(['node', 'cli', 'produce', ...process.argv.slice(2)]);
});

program.parse();
