# Contributing to Claude Code G2

Thanks for your interest. Here's how to contribute.

## Setup

```bash
git clone https://github.com/sam-siavoshian/claude-code-g2.git
cd claude-code-g2
./dev.sh
```

## Before submitting a PR

```bash
cd backend && bun run typecheck
cd frontend && bun run build
```

Both must pass. If you touched the glasses UI, test with the [evenhub-simulator](https://www.npmjs.com/package/@evenrealities/evenhub-simulator).

## Guidelines

- **Small PRs.** One feature or fix per PR.
- **Atomic commits.** Imperative subject: `fix: scroll offset not clamped`, `feat: add idle dimming`.
- **No unnecessary changes.** Don't refactor code you didn't need to touch.
- **Test on hardware if possible.** The simulator catches most issues, but proportional font rendering on the actual G2 HUD can surprise you.

## Architecture

- `backend/` — Bun + Express. Spawns `claude` CLI, manages sessions, Whisper transcription.
- `frontend/` — Vite + React. Phone companion pane + glasses HUD via `even-toolkit`.
- `frontend/src/glass/` — all glasses-specific code. `screens/` has one file per HUD screen.

## Reporting bugs

Open an issue with:
1. What you did
2. What you expected
3. What actually happened
4. Backend logs (`./dev.sh` output) if relevant
