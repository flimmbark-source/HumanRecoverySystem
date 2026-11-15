// Builds the anonymized decision brief. This is the single place that decides what may leave the workspace:
// role- and workflow-level findings, approved excerpts and approved source IDs only.
import type { Db } from '../db';
import { one } from '../db';
import { getBranches, getRevision, listCollection } from '../store';
import { compare, computeEffort, computeElapsed, fmtDelta, fmtFigure, type Figure } from '../../shared/impact';
import { describeEdge } from '../../shared/sentence';
import { evidenceForOpportunity, EVIDENCE_LEVEL_LABEL, insightTitle } from '../../shared/evidence';
import { EDGE_TYPE_LABEL, type Layout, type Model } from '../../shared/model';
import { OPTION_KIND_LABEL, type DecisionOption, type EvidenceLink, type Insight, type Note, type Opportunity, type Source } from '../../shared/workspace';

export interface BriefObservation { relation: string; kind: string; certainty: string; text: string | null; source: string }
export interface BriefComparisonLine { label: string; baseline: string; proposed: string; change: string; note: string }
export interface BriefRecommendation {
  id: string; title: string; heading: string; isHypothesis: boolean; decisionState: string; evidenceLevel: string; stale: boolean;
  insights: { title: string; body: string }[];
  observations: BriefObservation[]; interpretation: string; gaps: string[];
  preserve: string; stakeholders: string; validationPlan: string; closeReason: string;
  option: (Omit<DecisionOption, 'id' | 'opportunityId' | 'scenarioBranchId'> & { kindLabel: string }) | null;
  alternatives: { kindLabel: string; title: string; benefits: string; downsides: string; confidence: string }[];
  comparison: null | {
    scenarioName: string; pinnedTo: string; lines: BriefComparisonLine[]; unverified: boolean;
    cash: string[]; humanEffects: { role: string; kind: string; direction: string; description: string; magnitude: string; validation: string }[];
    guardrails: { metric: string; detail: string }[]; workingConditions: { role: string; indicator: string; baseline: string; expected: string; basis: string }[];
    byRole: { role: string; baseline: string; proposed: string; change: string }[];
    preserve: string; reversal: string; unknowns: string; validation: string;
  };
}
export interface Brief {
  projectName: string; synthetic: boolean; generatedAt: string; asOf: string;
  scope: { researchQuestion: string; orgUnit: string; scopeDescription: string; intendedOutcome: string; externalInterfaces: string };
  currentState: {
    counts: { nodes: number; connections: number; activities: number; notes: number; sources: number };
    effortPerCase: string; effortMonthly: string; volume: string; effortNote: string; missing: string[];
    byRole: { role: string; perCase: string }[];
    routes: { name: string; active: string; waiting: string; elapsed: string; flags: string[] }[];
    handoffs: { label: string; type: string; sentence: string; unknowns: string[] }[];
  };
  recommendations: BriefRecommendation[];
  provenance: { id: string; type: string; url: string; retrieved: string }[];
  withheld: string[];
  model: Model; layout: Layout;
}

const fig = (f: Figure, unit: string) => (f.value !== null ? `${fmtFigure(f)} ${unit}` : f.range ? `${fmtFigure(f)} ${unit} (range)` : f.status === 'incomplete' ? `Incomplete — known subtotal ${fmtFigure({ ...f, value: f.knownSubtotal })} ${unit}` : 'Unknown');
const basisNote = (bases: string[]) => {
  const b = bases.filter((x) => x !== 'unknown');
  if (!b.length) return 'No inputs recorded.';
  if (b.every((x) => x === 'measured')) return 'All inputs measured.';
  return `Inputs are tagged ${[...new Set(b)].join(', ')}. Figures are modeled from those inputs, not findings.`;
};

export async function buildBrief(db: Db, pid: string): Promise<Brief> {
  const p = (await one<{ name: string; meta: Record<string, string>; is_synthetic: boolean }>(db, 'SELECT name, meta, is_synthetic FROM projects WHERE id = $1', [pid]))!;
  const branches = await getBranches(db, pid);
  const base = branches.find((b) => b.kind === 'baseline')!;
  const head = await getRevision(db, pid, base.headRevisionId);
  const m = head.model;
  const [sources, notes, insights, links, opportunities, options] = await Promise.all([
    listCollection<Source>(db, pid, 'sources'), listCollection<Note>(db, pid, 'notes'), listCollection<Insight>(db, pid, 'insights'),
    listCollection<EvidenceLink>(db, pid, 'links'), listCollection<Opportunity>(db, pid, 'opportunities'), listCollection<DecisionOption>(db, pid, 'options'),
  ]);
  const effort = computeEffort(m);
  const cited = new Set<string>();
  let withheldNotes = 0, withheldSources = 0;
  const sourceLabel = (id: string | null) => {
    const s = id ? sources.find((x) => x.id === id) : null;
    if (!s) return 'No recorded source';
    if (!s.exportApproved) { withheldSources++; return 'Internal source (ID withheld)'; }
    cited.add(s.id);
    return s.anonId;
  };

  const recommendations: BriefRecommendation[] = [];
  const ordered = [...opportunities].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  for (const o of ordered) {
    const ev = evidenceForOpportunity(o, notes, links);
    const opts = options.filter((x) => x.opportunityId === o.id);
    const chosen = opts.find((x) => x.id === o.recommendedOptionId) ?? null;
    const observations: BriefObservation[] = [...ev.supporting, ...ev.contradicting, ...ev.other].map((l) => {
      if (!l.note.excerptApproved) withheldNotes++;
      return { relation: l.relation, kind: l.note.kind, certainty: l.note.certainty ?? 'not recorded', text: l.note.excerptApproved ? l.note.text : null, source: sourceLabel(l.note.sourceId) };
    });
    let comparison: BriefRecommendation['comparison'] = null, stale = false;
    const sc = chosen?.scenarioBranchId ? branches.find((b) => b.id === chosen.scenarioBranchId) : null;
    if (sc && sc.baseRevisionId) {
      const pinned = await getRevision(db, pid, sc.baseRevisionId), scen = await getRevision(db, pid, sc.headRevisionId);
      stale = !!o.citedRevisions[sc.id] && o.citedRevisions[sc.id] !== sc.headRevisionId;
      const routeId = scen.model.routes[0]?.id ?? pinned.model.routes[0]?.id ?? null;
      const c = compare(pinned.model, scen.model, routeId);
      const a = scen.model.assessment, f = c.financial;
      const lines: BriefComparisonLine[] = [
        { label: 'Staff effort per case', baseline: fig(c.base.effort.perCase, 'min'), proposed: fig(c.scenario.effort.perCase, 'min'), change: `${fmtDelta(c.perCase)} min`, note: c.perCase.note },
        { label: 'Monthly effort at modeled volumes', baseline: fig(c.base.effort.monthly, 'h'), proposed: fig(c.scenario.effort.monthly, 'h'), change: `${fmtDelta(c.atModeledVolumes)} h`, note: c.atModeledVolumes.denominator },
        { label: 'Monthly effort, like for like', baseline: fig(c.base.effort.monthly, 'h'), proposed: fig(c.atCommonVolume.scenarioMonthly, 'h'), change: `${fmtDelta(c.atCommonVolume)} h`, note: c.atCommonVolume.denominator },
      ];
      if (c.elapsed && c.base.elapsed && c.scenario.elapsed) lines.push({ label: 'Elapsed time on route', baseline: fig(c.base.elapsed.elapsed, 'min'), proposed: fig(c.scenario.elapsed.elapsed, 'min'), change: `${fmtDelta(c.elapsed)} min`, note: c.elapsed.denominator });
      const cur = f.currency ?? '';
      const cash = [
        f.netRecurring.value !== null ? `Net recurring cash effect: ${f.netRecurring.value} ${cur} per month (savings ${f.recurringSavings ?? 0}, costs ${f.recurringCosts ?? 0}).` : f.netRecurring.note,
        f.oneTime !== null ? `One-time implementation cost: ${f.oneTime} ${cur}.` : 'One-time implementation cost: not entered.',
        f.paybackMonths.value !== null ? `Simple payback: ${Math.round(f.paybackMonths.value * 10) / 10} months.` : `Payback: not calculated. ${f.paybackMonths.note}`,
        f.capacityValue.value !== null ? `Value of released time: ${Math.round(f.capacityValue.value)} ${cur} per month. ${f.capacityValue.note}` : f.capacityValue.note,
        ...f.issues,
      ];
      comparison = {
        scenarioName: sc.name, pinnedTo: `baseline revision ${pinned.seq} (${pinned.createdAt.slice(0, 10)})`, lines, unverified: c.unverifiedInputs, cash,
        humanEffects: a.humanEffects.map((h) => ({ role: h.role, kind: h.kind.replace(/_/g, ' '), direction: h.direction, description: h.description, magnitude: h.magnitude && h.magnitude.value !== null ? `${h.magnitude.value} ${h.magnitude.unit} (${h.magnitude.basis})` : `Not quantified${h.missingData ? ` — missing: ${h.missingData}` : ''}`, validation: h.validation })),
        guardrails: a.guardrails.map((g) => ({ metric: g.metric, detail: [g.denominator && `per ${g.denominator}`, g.baselinePeriod && `baseline period ${g.baselinePeriod}`, g.baseline && g.baseline.value !== null ? `baseline ${g.baseline.value} ${g.baseline.unit}` : 'baseline not yet measured', g.target && `target ${g.target}`, g.owner && `owner ${g.owner}`, g.method && `collected by ${g.method}`, g.followUp && `review ${g.followUp}`, g.rollbackTrigger && `roll back if ${g.rollbackTrigger}`].filter(Boolean).join(' · ') })),
        workingConditions: a.workingConditions.map((w) => ({ role: w.role, indicator: w.indicator, baseline: w.baseline || 'Unknown', expected: w.expected || 'Unknown', basis: w.basis })),
        byRole: c.byRole.map((r) => ({ role: r.roleLabel, baseline: r.base ? fig(r.base, 'h/month') : '—', proposed: r.scenario ? fig(r.scenario, 'h/month') : '—', change: `${fmtDelta(r.delta)} h` })),
        preserve: a.preserve, reversal: a.reversal, unknowns: a.unknowns, validation: a.validation,
      };
    }
    const isHyp = ev.isHypothesis || o.decisionState === 'hypothesis';
    const heading = o.decisionState === 'closed' ? 'Closed' : o.decisionState === 'deferred' ? 'Deferred' : !chosen ? 'Opportunity under exploration' : isHyp ? 'Hypothesis to test' : 'Recommendation';
    const { id: _i, opportunityId: _o, scenarioBranchId: _s, version: _v, ...optRest } = (chosen ?? {}) as DecisionOption & { version?: number };
    recommendations.push({
      id: o.id, title: o.title, heading, isHypothesis: isHyp, decisionState: o.decisionState, evidenceLevel: EVIDENCE_LEVEL_LABEL[ev.level], stale,
      insights: o.insightIds.map((id) => insights.find((i) => i.id === id)).filter((i): i is Insight & { version: number } => !!i).map((i) => ({ title: insightTitle(i), body: i.body })),
      observations, interpretation: o.interpretation, gaps: [...ev.gaps, ...(o.uncertainty.trim() ? [o.uncertainty.trim()] : [])],
      preserve: o.preserve, stakeholders: o.stakeholders, validationPlan: o.validationPlan, closeReason: o.closeReason,
      option: chosen ? { ...optRest, kindLabel: OPTION_KIND_LABEL[chosen.kind] } : null,
      alternatives: opts.filter((x) => x.id !== chosen?.id).map((x) => ({ kindLabel: OPTION_KIND_LABEL[x.kind], title: x.title, benefits: x.benefits, downsides: x.downsides, confidence: x.confidence })),
      comparison,
    });
  }
  const withheld: string[] = ['Researcher working notes and internal comments are not included.', 'Participant roles attached to individual sources are not included; findings are stated at workflow or role level.'];
  if (withheldNotes) withheld.push(`${withheldNotes} linked observation${withheldNotes === 1 ? ' is' : 's are'} summarized by type only because the excerpt is not approved for export.`);
  if (withheldSources) withheld.push('Some source IDs are withheld because they are not approved for citation.');

  return {
    projectName: p.name, synthetic: p.is_synthetic, generatedAt: new Date().toISOString(), asOf: head.createdAt,
    scope: { researchQuestion: p.meta.researchQuestion ?? '', orgUnit: p.meta.orgUnit ?? '', scopeDescription: p.meta.scopeDescription ?? '', intendedOutcome: p.meta.intendedOutcome ?? '', externalInterfaces: p.meta.externalInterfaces ?? '' },
    currentState: {
      counts: { nodes: m.nodes.length, connections: m.edges.length, activities: m.activities.length, notes: notes.length, sources: sources.length },
      effortPerCase: fig(effort.perCase, 'minutes per case'), effortMonthly: fig(effort.monthly, 'hours per month'), volume: m.volume.value !== null ? `${m.volume.value} cases per month (${m.volume.basis})` : 'Unknown',
      effortNote: basisNote(effort.monthly.basis), missing: effort.monthly.missing.map((x) => `${x.label}: ${x.field} ${x.reason}`),
      byRole: effort.byRole.map((r) => ({ role: r.roleLabel, perCase: fig(r.perCase, 'min per case') })),
      routes: m.routes.map((r) => { const e = computeElapsed(m, r.id)!; return { name: r.name, active: fig(e.active, 'min'), waiting: fig(e.waiting, 'min'), elapsed: fig(e.elapsed, 'min'), flags: e.analysis.flags.filter((f) => f.level !== 'info' || f.code === 'side-links').map((f) => f.message) }; }),
      handoffs: m.edges.map((e) => { const d = describeEdge(m, e); return { label: e.label, type: EDGE_TYPE_LABEL[e.type], sentence: d.sentence, unknowns: d.unknowns }; }),
    },
    recommendations,
    provenance: sources.filter((s) => cited.has(s.id) || (s.publicUrl && s.exportApproved)).map((s) => ({ id: s.anonId, type: s.type, url: s.publicUrl, retrieved: s.retrievedAt })),
    withheld, model: m, layout: base.layout,
  };
}
