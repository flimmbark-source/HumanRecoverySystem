import { useEffect, useRef, type ReactNode } from 'react';
import type { Segment } from '../shared/sentence';
import { BASIS, type Basis, type Quantity } from '../shared/model';

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), textarea, select, button.primary');
    (first ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="modal-head"><h2>{title}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className ?? ''}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

const TOKEN_NAME: Record<string, string> = { actor: 'who', action: 'action', item: 'item', state: 'state', unknown: 'unknown' };
/** Color-coded sentence. Every token type also carries a text label (title + legend) so color is never the only cue. */
export function Sentence({ segments }: { segments: Segment[] }) {
  return <>{segments.map((s, i) => (s.type === 'plain' ? <span key={i}>{s.text}</span> : <span key={i} className={`tok tok-${s.type}`} data-token={s.type} title={TOKEN_NAME[s.type]}>{s.text}</span>))}</>;
}
export function TokenKey() {
  return <div className="tokkey" aria-label="Sentence colour key">{(['actor', 'action', 'item', 'state'] as const).map((t) => <span key={t}><i className={`tok tok-${t}`}>{TOKEN_NAME[t]}</i></span>)}</div>;
}

export const BASIS_LABEL: Record<Basis, string> = { measured: 'Measured', reported: 'Reported', estimated: 'Estimated', assumed: 'Assumed', unverified: 'Unverified', unknown: 'Unknown' };
export function BasisChip({ basis }: { basis: Basis | string }) {
  return <span className="chip basis" data-basis={basis}>{BASIS_LABEL[basis as Basis] ?? basis}</span>;
}

/** Numeric input where an empty box means unknown (null), never zero. `scale` converts display units to stored units. */
export function QtyInput({ label, q, onChange, scale = 1, unitLabel, disabled, testid }: { label: string; q: Quantity; onChange: (q: Quantity) => void; scale?: number; unitLabel: string; disabled?: boolean; testid?: string }) {
  const shown = q.value === null ? '' : String(Math.round((q.value / scale) * 1000) / 1000);
  return (
    <div className="qty">
      <label className="field"><span className="field-label">{label} <em>({unitLabel})</em></span>
        <input type="number" min={0} step="any" inputMode="decimal" value={shown} placeholder="Unknown" disabled={disabled} data-testid={testid}
          onChange={(e) => { const raw = e.target.value.trim(); const n = raw === '' ? null : Number(raw); if (n !== null && (!Number.isFinite(n) || n < 0)) return; onChange({ ...q, value: n === null ? null : n * scale, min: undefined, max: undefined, basis: n === null ? 'unknown' : q.basis === 'unknown' ? 'estimated' : q.basis }); }} />
      </label>
      <label className="field"><span className="field-label">Basis</span>
        <select value={q.value === null ? 'unknown' : q.basis} disabled={disabled || q.value === null} aria-label={`${label} basis`} onChange={(e) => onChange({ ...q, basis: e.target.value as Basis })}>
          {BASIS.map((b) => <option key={b} value={b} disabled={b === 'unknown' && q.value !== null}>{BASIS_LABEL[b]}</option>)}
        </select>
      </label>
    </div>
  );
}

export const fmtMinutes = (min: number | null) => (min === null ? 'Unknown' : min >= 90 ? `${Math.round((min / 60) * 10) / 10} h` : `${Math.round(min * 10) / 10} min`);
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><b>{title}</b><p>{children}</p></div>; }
