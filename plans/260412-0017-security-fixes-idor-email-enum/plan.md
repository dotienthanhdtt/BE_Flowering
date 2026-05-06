---
status: ready
priority: critical
blockedBy: []
blocks: []
---

# Security Fixes: IDOR + Email Enumeration

Two HIGH/MEDIUM vulnerabilities from security review of `dev` branch.

## Phases

| # | Phase | Priority | Status | File |
|---|-------|----------|--------|------|
| 1 | Fix IDOR — Conversation ownership check | Critical | Pending | [phase-01](phase-01-fix-idor-conversation-ownership.md) |
| 2 | Fix email enumeration via forgot-password | High | Pending | [phase-02](phase-02-fix-email-enumeration.md) |

## Dependencies

- None — both fixes are independent of each other and of existing plans.

## Context

- Security review report: identified 2 confirmed vulnerabilities on `dev` branch
- Vuln 1 (HIGH, confidence 9/10): IDOR in `learning-agent.service.ts` — no `userId` filter on conversation history queries
- Vuln 2 (MEDIUM, confidence 9/10): Email enumeration in `auth.service.ts` — differentiated 404/200 responses on `forgot-password`
