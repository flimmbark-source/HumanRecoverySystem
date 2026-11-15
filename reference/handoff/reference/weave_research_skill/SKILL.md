---
name: weave-operational-research
summary: Convert approved, de-identified organizational fieldwork into reviewable operational model candidates for Weave.
version: 0.5
---

# Weave operational research skill

## Purpose

Assist a human UX researcher in mapping a selected organizational workflow. Transform authorized, de-identified interviews, observations, process walkthroughs, and operational metrics into candidate changes that a human can individually review in Weave. The output is a candidate bundle for review, **never** a claim that the model has been updated.

## Required inputs

1. Current Weave workspace JSON export, when available. Use existing node identifiers exactly. Do not invent references to nonexistent identifiers.
2. Authorized research notes with stable anonymous source IDs, such as `Interview 04` or `Process walk 02`.
3. The approved workflow scope and research question.
4. Measurement method, units, time period, and sample size for any numeric claim.

If the model or evidence is incomplete, output unassigned notes and explicit research questions. Do not make up nodes, timings, cost savings, or observed outcomes to fill gaps.

## Operating method

1. **Inventory:** Identify actors and their roles, systems, resources, activities, work items, decisions, inputs, outputs, and external dependencies. Distinguish a person, their role, and the activity they perform.
2. **Evidence extraction:** Split mixed accounts into atomic observations. Retain the anonymous source ID, a brief source excerpt (the `basis` field), and whether evidence was directly observed, reported, or inferred.
3. **Model linkage:** Match each observation to an existing node, edge, or activity only when the relationship is supported. Otherwise leave the target unassigned, or propose a new object with an explicit basis.
4. **Disagreement:** Preserve contradictory accounts as separate notes. Do not combine accounts into an invented consensus. Express causal mechanisms as hypotheses and identify what would disprove them.
5. **Work measurement:** Distinguish active processing minutes from waiting hours, throughput from volume, staff time from cash expenditure, and qualitative human impact from monetized costs. Missing values remain null. Do not convert volunteer time into organizational cash savings without evidence.
6. **Alternative solutions:** Before proposing a novel tool, investigate operational changes and existing tools. Record who gains and who might be harmed, including relationships and accessibility.
7. **Output:** Produce JSON matching `schema.json`, with format `weave-research-candidates`, version `1`, and no more than 100 candidates. Do not include personal identifiers, transcripts, or confidential records in the bundle.
8. **Human review:** Run the supplied validator, then hand the JSON to the researcher to import using **Add → Review agent findings**. Each candidate must be individually accepted. Reject or return candidates whose identity, basis, model target, or measurement is uncertain.

## Candidate types and interpretation

- `note`: research observations, measurements, hypotheses, questions, insights, or recommendations. Prefer atomic observations rather than premature interpretations. A `targetId` must refer to an existing node, edge, or activity.
- `node`: propose a new person/role representation, system, resource, group, or output. A node represents a stable entity, not a process step.
- `relationship`: propose a typed connection between two existing nodes. Kinds: `flow`, `info`, `dependency`, `authority`, `association`. Do not use `flow` unless something actually moves. Optional, source-supported semantic fields are `workItem`, `result`, `performerId`, `actionCode`, `inputState`, and `outputState`. These fields drive Weave's deterministic sentence generator. `performerId` means the person or system performing the action, **not** automatically the sender or recipient. Never infer it from the direction of the connection. Leave unknown fields absent instead of guessing.
- `activity`: propose independent work performed by an existing node, even where no handoff occurs. Unknown `minutes` must be `null`. A number requires a documented observation or estimation method in `measurementBasis`.

`certainty` is `observed`, `reported`, or `inferred`. `inferred` cannot be presented as a measured fact. Notes of type `insight` and `recommendation` remain reviewable interpretations.

## Safety and quality gates

- Never assert that a hypothetical demo workflow represents ESRA's true operations.
- Do not infer personal attributes or identify a participant from their interview content.
- Do not send identifiable interviews or sensitive service-user data to external AI tools without approved permissions and participant consent.
- Do not convert a single participant account into an organization-wide prevalence estimate.
- Do not compute customer loss, financial savings, or predicted human outcomes without credible baseline data and methods.
- Do not silently merge the candidates into Weave. The researcher controls acceptance and can edit or decline each one.
- Before any final recommendation, ask: what observation supports it, what contradicts it, who owns it, what would change, what is not yet measured, and how could we test it?

## Quality check

Run:

```sh
python scripts/validate_candidates.py examples/demo-candidates.json
```

Optionally pass `--workspace exported-weave.json` to check that referenced node, edge, and activity IDs exist. Return a short discrepancy report if validation fails.

## Output example

See `examples/demo-candidates.json`. The example is synthetic. Its references are to Weave's built-in demo nodes and **not** to actual ESRA personnel or workflows.

## Generated connection sentences (v0.5)

After human review, the app constructs a description from approved fields. The model preserves exact inputs and renders them through deterministic action grammar, with distinct phrasing for flow, communication, dependency, authority, and association. All missing role or state facts must remain visible as unknowns. The generated sentence is **not new source evidence**, and does not change the source confidence.

See `examples/semantic-relationship.json` for a synthetic candidate with explicit performer and before/after state.
