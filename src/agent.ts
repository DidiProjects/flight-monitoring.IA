/**
 * AI Fallback Agent, auto-heals the Azul scraper when npm start fails.
 *
 * Usage: npm run ai-fix -- [same args as npm start]
 *
 * The agent:
 *  1. Reads the latest failed run for error context
 *  2. Runs a Claude agentic loop with bash/read/write tools
 *  3. Fixes src/scrapers/azul.ts, retests, commits on success
 *  4. Manages token budget, stops gracefully before hitting the limit
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const TOKEN_BUDGET  = 180_000;
const STOP_TOKENS   = 25_000;
const MAX_ITERS     = 10;
const MODEL         = 'claude-sonnet-4-6';
const RESULTS_DIR   = process.env['RESULTS_DIR'] ?? './results';

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'bash',
    description: 'Execute a shell command in the project root. Returns stdout, stderr and exit code.',
    input_schema: {
      type: 'object' as const,
      properties: { command: { type: 'string', description: 'Shell command to run' } },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the project. Path is relative to project root.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'File path relative to project root' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write (overwrite) a file in the project. Path is relative to project root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path:    { type: 'string', description: 'File path relative to project root' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories at a path relative to project root.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Directory path relative to project root' } },
      required: ['path'],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

function executeTool(name: string, input: Record<string, string>): string {
  try {
    if (name === 'bash') {
      const cmd = input['command']!;
      try {
        const out = execSync(cmd, {
          cwd: PROJECT_ROOT,
          timeout: 120_000,
          encoding: 'utf8',
          env: { ...process.env },
        });
        return `EXIT 0\n${out}`;
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; status?: number };
        return `EXIT ${err.status ?? 1}\nSTDOUT:\n${err.stdout ?? ''}\nSTDERR:\n${err.stderr ?? ''}`;
      }
    }

    if (name === 'read_file') {
      const abs = path.resolve(PROJECT_ROOT, input['path']!);
      if (!fs.existsSync(abs)) return `ERROR: file not found: ${input['path']}`;
      const content = fs.readFileSync(abs, 'utf8');
      return content.slice(0, 40_000); // cap to avoid blowing context
    }

    if (name === 'write_file') {
      const abs = path.resolve(PROJECT_ROOT, input['path']!);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, input['content']!, 'utf8');
      return `OK: wrote ${input['path']}`;
    }

    if (name === 'list_dir') {
      const abs = path.resolve(PROJECT_ROOT, input['path']!);
      if (!fs.existsSync(abs)) return `ERROR: directory not found: ${input['path']}`;
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      return entries.map(e => (e.isDirectory() ? `[dir]  ${e.name}` : `[file] ${e.name}`)).join('\n');
    }

    return `ERROR: unknown tool ${name}`;
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Context helpers ───────────────────────────────────────────────────────────

function findLatestErrorRun(): { dir: string; log: string; params: string } | null {
  const resultsAbs = path.resolve(PROJECT_ROOT, RESULTS_DIR);
  if (!fs.existsSync(resultsAbs)) return null;

  const runs = fs.readdirSync(resultsAbs)
    .filter(e => /^\d{4}-\d{2}-\d{2}T/.test(e))
    .sort()
    .reverse();

  for (const run of runs) {
    const errDir  = path.join(resultsAbs, run, 'errors');
    const logFile = path.join(errDir, 'execution.log');
    if (fs.existsSync(logFile)) {
      const log    = fs.readFileSync(logFile, 'utf8').slice(0, 8_000);
      const params = fs.existsSync(path.join(errDir, '..', 'results.json'))
        ? ''
        : extractParamsFromLog(log);
      return { dir: path.join(resultsAbs, run), log, params };
    }
  }
  return null;
}

function extractParamsFromLog(log: string): string {
  const lines = log.split('\n').slice(0, 10);
  return lines.join('\n');
}

function readFileSafe(rel: string): string {
  const abs = path.resolve(PROJECT_ROOT, rel);
  if (!fs.existsSync(abs)) return `(not found: ${rel})`;
  return fs.readFileSync(abs, 'utf8').slice(0, 12_000);
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(errorContext: string, originalArgs: string, remainingTokens: number): string {
  return `\
You are an autonomous maintenance agent for the flight.API project.
Project root: ${PROJECT_ROOT}

## Your mission
The Azul Airlines scraper (src/scrapers/azul.ts) just failed. Diagnose and fix it,
rerun "npm start ${originalArgs}" to verify, then commit the fix.

## Critical code rules
1. NEVER use named functions inside page.evaluate(), tsx 4.x compiles with keepNames:true
   which injects __name() that does not exist in browser context. Use iterative stack or
   anonymous arrows instead.
2. Confirmed selectors are in memory/azul/dom-structure.md, update it if DOM changed.
3. Always save HTML snapshots to results/.../snapshots/ at key steps for diagnosis.

## After a successful run
1. Update memory/azul/dom-structure.md if selectors changed.
2. Update memory/azul/scraper-architecture.md if flow changed.
3. Run: git add -A && git commit -m "fix(azul): <description>" && git push

## Token budget
You have approximately ${remainingTokens.toLocaleString()} tokens remaining in this session.
When you have fewer than 25 000 tokens left: commit whatever you have (even partial),
document what you found in the memory files, and stop.

## Error context
${errorContext}
`;
}

// ── Main agent loop ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey || apiKey.startsWith('sk-ant-...')) {
    console.error('[ai-agent] ANTHROPIC_API_KEY not set.');
    process.exit(1);
  }

  // Original CLI args to rerun npm start with
  const originalArgs = process.argv.slice(2).join(' ');

  // Load error context
  const runInfo = findLatestErrorRun();
  const errorContext = runInfo
    ? `Run dir: ${runInfo.dir}\n\nExecution log:\n${runInfo.log}`
    : 'No error log found, run npm start first to capture an error.';

  // Pre-load key files into context
  const azulSrc  = readFileSafe('src/scrapers/azul.ts');
  const domMem   = readFileSafe('memory/azul/dom-structure.md');
  const archMem  = readFileSafe('memory/azul/scraper-architecture.md');

  const client = new Anthropic({ apiKey });

  let usedTokens = 0;
  let remaining  = TOKEN_BUDGET;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `\
Start diagnosing the failure. Here is the pre-loaded context:

--- src/scrapers/azul.ts ---
${azulSrc}

--- memory/azul/dom-structure.md ---
${domMem}

--- memory/azul/scraper-architecture.md ---
${archMem}

Original npm start args: ${originalArgs || '(none, use env vars)'}

Begin.`,
    },
  ];

  console.log(`[ai-agent] Starting agentic loop, budget: ${TOKEN_BUDGET.toLocaleString()} tokens`);

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    remaining = TOKEN_BUDGET - usedTokens;
    if (remaining < STOP_TOKENS) {
      console.log(`[ai-agent] Token budget low (${remaining} remaining), requesting wrap-up`);
      messages.push({
        role: 'user',
        content: `Token budget is almost exhausted (${remaining} tokens left).
Commit whatever fixes you have with "git add -A && git commit -m '...' && git push",
update memory files documenting what you found, and stop.`,
      });
    }

    console.log(`[ai-agent] Iteration ${iter + 1}/${MAX_ITERS}, tokens used: ${usedTokens.toLocaleString()}`);

    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 4_096,
      system:     buildSystemPrompt(errorContext, originalArgs, remaining),
      tools:      TOOLS,
      messages,
    });

    usedTokens += response.usage.input_tokens + response.usage.output_tokens;

    // Append assistant response to history
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      console.log('[ai-agent] Agent finished.');
      break;
    }

    if (response.stop_reason !== 'tool_use') {
      console.log(`[ai-agent] Unexpected stop_reason: ${response.stop_reason}, stopping`);
      break;
    }

    // Execute tool calls and append results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      console.log(`[ai-agent]   → ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`);
      const result = executeTool(block.name, block.input as Record<string, string>);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  console.log(`[ai-agent] Done. Total tokens used: ${usedTokens.toLocaleString()}/${TOKEN_BUDGET.toLocaleString()}`);
}

main().catch(err => {
  console.error('[ai-agent] Fatal error:', err);
  process.exit(1);
});
