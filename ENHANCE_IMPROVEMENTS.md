# AI Enhancement Improvements Plan

## Current State

- **5 open issues**, all `enhance-bug` (AI rewrite quality)
- Static decompiler: solid (29/29 high confidence, 100% constants)
- AI rewrite: drops constants, produces messy output for complex contracts
- Model chain: Opus 4.6 → Opus 4.5 → Sonnet 4 (30s timeout per model)

## Problem Analysis

### 1. Constants get dropped by AI
Issue #13: AI output 4/5 constants (missed `INT64_MAX`). The prompt says "preserve everything" but large contracts push the model to summarize/skip.

### 2. No verification feedback loop
The AI writes code, we verify it, but **never retry with the verification results**. If constants are missing, we just accept the loss.

### 3. Prompt is a wall of text
Single monolithic prompt with 6 rule categories. For complex contracts (15K+ chars), the code overwhelms the instructions.

### 4. No chunking for large contracts
The full Aiken code is sent as-is. Complex DEX contracts (15K+ chars) hit practical attention limits where the model starts losing details.

### 5. Diagram/naming prompts also get full code
`generateDiagram` truncates to 2000 chars, but `rewriteCode` sends everything. No strategic truncation.

---

## Proposed Improvements

### P0: Verification-Driven Retry Loop
**Impact: High | Effort: Low**

After the first rewrite, if `verification.confidence !== 'high'` or `constantScore < 1.0`:
1. Build a targeted follow-up prompt with the specific failures (missing constants, undefined refs, placeholders)
2. Send the AI its own output + the failure report
3. Ask it to fix only the identified issues
4. Re-verify and accept best result

This is the single highest-ROI change — we already have the verification infrastructure.

### P1: Chunked Rewriting for Large Contracts
**Impact: High | Effort: Medium**

For contracts > 8K chars:
1. Split into logical sections (top-level `when` branches, function definitions)
2. Rewrite each section independently with shared context (constants, imports, type info)
3. Stitch results together
4. Verify the combined output

Requires a lightweight AST-aware splitter (can use line-based heuristics on the Aiken output).

### P2: Two-Pass Prompt Architecture
**Impact: Medium | Effort: Low**

Replace the single rewrite prompt with two passes:
1. **Analysis pass** (small output): "List all constants, identify variable roles, map the control flow structure" → structured JSON
2. **Rewrite pass**: "Given this analysis + code, rewrite it" with the analysis as a checklist

Forces the model to inventory constants before rewriting, reducing drops.

### P3: Constants Injection as Structured Data
**Impact: Medium | Effort: Low**

Currently constants are in a text block in the prompt. Instead:
- Number each constant
- After rewrite, require a `// Constants used: [1, 2, 3, 4, 5]` comment
- Verification checks the count matches

Makes constant preservation auditable in the output itself.

### P4: Per-Section Caching
**Impact: Low | Effort: Medium**

Currently cache key is per-script per-enhancement type. With chunked rewriting, cache individual sections so retries only re-process failed chunks.

### P5: Model Selection by Complexity
**Impact: Low | Effort: Low**

Simple contracts (< 5K chars, < 3 builtins) → Sonnet 4 (fast, cheap, good enough)
Complex contracts (> 10K chars, DEX patterns) → Opus only (no fallback to Sonnet)

Currently all contracts run through the same chain regardless of complexity.

---

## Implementation Order

1. **P0** — Retry loop (biggest bang, smallest effort)
2. **P2** — Two-pass prompts (easy to add alongside P0)
3. **P3** — Constants injection (minor prompt change)
4. **P1** — Chunking (needs more design, do after P0-P2 show results)
5. **P5** — Model routing (quick win, do whenever)
6. **P4** — Section caching (only needed after P1)

## Success Metrics

- All 5 open issues should close (constant scores → 100%)
- Average confidence across test suite: high
- P95 latency stays under 60s
