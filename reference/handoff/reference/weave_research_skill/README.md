# Weave Research Skill (v0.5)

This is a portable, **agent-ready skill package**, not an installed ChatGPT plugin or a live autonomous agent. It explains how a research assistant should turn consented, anonymized fieldwork into reviewable candidate model updates.

1. Give the assistant `SKILL.md`, the current Weave workspace JSON export, and authorized de-identified fieldwork.
2. Ask it to produce candidate JSON following `schema.json` and to flag gaps instead of guessing.
3. Validate the result with `python scripts/validate_candidates.py your-candidates.json --workspace your-weave-export.json`.
4. Open Weave and choose **Add → Review agent findings**. Import the candidate JSON, inspect the source for each, and accept or decline candidates one at a time.

The included example is synthetic and refers only to the built-in demo, not ESRA. The browser app has no AI provider integration and cannot securely handle confidential participant records.

Version 0.5 adds optional semantic relationship fields. Weave displays them in a reviewable generated sentence. The skill does not install itself or access private data.
