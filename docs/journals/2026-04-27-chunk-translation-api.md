# Chunk-Aware Translation API Implementation

**Date**: 2026-04-27 14:30
**Severity**: Medium
**Component**: AI Translation Service
**Status**: Resolved

## What Happened

Shipped `POST /ai/translate/word` endpoint for context-aware vocabulary chunk translation with pronunciation support across 4+ language systems.

## The Brutal Truth

This was surprisingly clean. No showstoppers, no 2am debugging sessions. The real victory: we caught the "preserve SRS columns" requirement early and didn't nuke user progress data with a careless orUpdate.

## Technical Details

**DB change**: Added `type VARCHAR(30)` nullable column to `vocabulary`. Migration auto-downgrades on revert.

**Prompt engineering**: Extended prompt includes language-specific pronunciation rules (IPA, romaji, pinyin, revised romanization). Prevents hallucinated "fancy" systems when user expectation is simple romanization.

**LLM choice**: Used Gemini 3.1 Flash Lite Preview, not OpenAI. Faster, cheaper for short inference. Single-pass chunk resolution without streaming.

**Ownership validation**: Check `Lesson` ownership before LLM call. Prevents free-tier users from pumping expensive AI through stolen lesson IDs.

**Type whitelist**: `['word', 'phrase', 'character']` hardcoded. Unknown types silently downgrade to `'word'` at DB write. Prevents garbage data from malformed client requests.

## What We Tried

- orUpdate strategy: initially included `srsDueAt, srsLevel` — rolled back. These are SRS state, not translation metadata. Discovered mid-test. 
- Chunk text cap: started at 500 chars, clamped to 255 to match DB schema + API response size. Prevents accidental LLM jailbreaks via huge payloads.

## Root Cause (Why This Went Smooth)

Read the full TypeORM entity definition before writing orUpdate logic. Did not assume schema. Ownership check exists on every lessonId route in the codebase—pattern reuse, not new invention. Tests caught the type validation edge case (unknown types) before code review.

## Lessons Learned

- **Destructive updates require audit trails**: orUpdate can silently corrupt state columns. Always explicitly list safe columns, comment why others are excluded.
- **Whitelist > blocklist**: Type validation via hardcoded array is clearer than regex or ORM constraints. Future dev adding a new type can't miss it.
- **Cheaper LLM first**: Gemini Flash made sense here. Reserve OpenAI for complex reasoning. Saves ~70% on inference cost.

## Next Steps

- Monitor LLM cost/latency in Langfuse; may trigger Gemini → Claude swap if performance degrades
- Pronunciation rules may need per-dialect variants (Mandarin simplified vs traditional)
- No breaking changes; safe to ship to prod now

**All tests pass. Build clean. Ready to merge.**
