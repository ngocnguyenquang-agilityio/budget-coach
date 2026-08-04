---
name: plan-execution-handoff
description: Use whenever a plan in this repo is about to be executed — right after superpowers:writing-plans finishes a plan (before its Subagent-Driven vs Inline Execution menu), OR any time the user asks to execute/run/implement an already-written plan file, in this or a later session. Overrides superpowers:executing-plans and superpowers:subagent-driven-development for this repo.
---

# Plan Execution Handoff

## Overview

This repo does not use `superpowers:writing-plans`' default execution menu,
and does not run `superpowers:executing-plans` or
`superpowers:subagent-driven-development` directly in the main session.
Plans get executed by a dedicated `plan-executor` agent instead, and only
after the user explicitly approves.

## When to Use

- Right when `superpowers:writing-plans` finishes writing a plan file in this
  repo — before it would normally ask "Subagent-Driven vs Inline Execution".
- Any other time — including in a brand-new session — the user asks to
  execute, run, implement, or continue an existing plan file in this repo.
  This applies even though `superpowers:executing-plans`' own description
  ("execute in a separate session with review checkpoints") looks like a
  match: for this repo, this skill takes precedence over that one.

## Steps

1. If `superpowers:writing-plans` just finished writing the plan in this
   turn: announce the plan is saved and stop. Wait for the user's explicit
   approval to proceed. Do not present execution-mode options.
   If instead the user is directly asking (this turn) to execute/run/
   implement an existing plan file, that request already is the explicit
   approval — skip straight to step 2.
2. Implement the plan by dispatching the `plan-executor` agent
   (`.claude/agents/plan-executor.md`) with the plan file path, rather than
   using `superpowers:subagent-driven-development` or
   `superpowers:executing-plans` directly in this session.
3. Still respect the global "no autonomous commit/push" rule (from the user's
   CLAUDE.md) — `plan-executor` must hand control back before any
   commit/merge/push, per its own instructions.
