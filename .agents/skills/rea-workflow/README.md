# REA Agent Skill

A ready-to-use **agent skill** that operationalizes the REA (Reverse Engineer Anything) methodology.

Synthesized from:
1. Miles Deutscher's beginner's guide (5-step framework + agent swarm)
2. Structured XML-style REA guide
3. Detailed 11-step reverse engineering workflow with evidence levels

## What this skill does

When loaded into Claude Code, Grok Build, Codex, Cursor, or similar agents, it teaches the agent how to:

- Reverse-engineer features from websites, desktop apps (Notion, Slack, Discord), Android apps, and native software
- Stay strictly **clean-room** (behavior-only specs, never copy original code, names, or assets)
- Tag every finding as **CONFIRMED**, **INFERRED**, or **UNKNOWN** with evidence
- Follow a disciplined workflow: Look → Understand → Plan → Build → Iterate
- Run an agent swarm (Scout, Spec Writer, Builder, Tester)
- Produce reusable artifacts: `reports/`, `spec.md`, `comparison.md`

## Quick Start

1. Install the official REA MCP server:
   ```bash
   npx rea-agents setup
   ```
   (Requires Node.js 22.19+ / 24.11+ / 26+)

2. Drop this skill into your agent:
   - Claude Code: copy `SKILL.md` into `.claude/skills/rea-workflow/` or paste the contents as a project skill
   - Other agents: add the instructions to your system prompt or skills folder

3. Prompt example:
   ```
   Investigate the custom clipboard feature in Notion using the REA skill.
   Follow the full workflow and produce a clean-room spec.md.
   ```

## Files

- `SKILL.md` — Main skill instructions (load this)
- `agents/` — Subagent definitions for the swarm
- `prompts/` — Ready-to-use prompt templates
- `rules.md` — Clean-room and evidence rules

## Important

- Only analyze software you own or are authorized to examine.
- The Builder agent must never touch the original application.
- Specs describe **behavior**, not implementation details copied from the target.
- Official REA: https://github.com/morluto/rea

---
Inspired by @milesdeutscher's Oct 2026 REA guide and publicly available REA materials.
