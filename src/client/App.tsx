import { useEffect, useState } from 'react';
import { checkAuth, useStore } from './store';
import { Login, Projects } from './Projects';
import { Workspace } from './Workspace';

export function App() {
  const user = useStore((s) => s.user), checked = useStore((s) => s.authChecked), t = useStore((s) => s.toast);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { void checkAuth(); const h = () => setHash(location.hash); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  const m = /^#\/p\/([0-9a-f-]{36})/.exec(hash);
  return (
    <>
      {!checked ? <main className="auth"><p className="micro">Loading…</p></main> : !user ? <Login /> : m ? <Workspace key={m[1]} pid={m[1]} /> : <Projects />}
      {t && <div className={`toast ${t.kind}`} role="status" data-testid="toast">{t.text}</div>}
    </>
  );
}
