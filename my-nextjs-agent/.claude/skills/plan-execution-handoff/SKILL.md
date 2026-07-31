---
name: plan-execution-handoff
description: Use immediately after superpowers:writing-plans finishes a plan in this repo, before presenting any execution-mode choice — overrides its normal Subagent-Driven vs Inline Execution menu.
---

# Plan Execution Handoff

## Overview

This repo does not use `superpowers:writing-plans`' default execution menu.
Plans get executed by a dedicated `plan-executor` agent instead, and only
after the user explicitly approves.

## When to Use

Right when `superpowers:writing-plans` finishes writing a plan file in this
repo — before it would normally ask "Subagent-Driven vs Inline Execution".

## Steps

1. Announce the plan is saved and stop. Wait for the user's explicit approval
   to proceed. Do not present execution-mode options.
2. Once approved, implement the plan by dispatching the `plan-executor` agent
   (`.claude/agents/plan-executor.md`) with the plan file path, rather than
   using `superpowers:subagent-driven-development` or
   `superpowers:executing-plans` directly in this session.
3. Still respect the global "no autonomous commit/push" rule (from the user's
   CLAUDE.md) — `plan-executor` must hand control back before any
   commit/merge/push, per its own instructions.
