# Issue tracker

This repository uses GitHub Issues as the source of truth for work tracking.

## System of record

- Tracker: GitHub Issues
- Repository: `dsegoviat/chat-app`
- CLI: `gh`

## Skills behavior

Skills that create, triage, or decompose work should read and write issues using GitHub via `gh` commands (for example, `gh issue create`, `gh issue list`, `gh issue edit`), following repository conventions.

## Notes

- If `gh` is not authenticated locally, run `gh auth login`.
- Do not use local markdown issue files unless this document is explicitly changed.
