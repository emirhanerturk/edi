import { useEffect } from 'react';
import { edi } from './bridge';
import { EmptyState } from './components/EmptyState';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { connect, useApp } from './store';

export function App() {
  const ready = useApp((s) => s.ready);
  const dir = useApp((s) => s.workspace.dir);

  useEffect(() => connect(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void edi.chooseFolder();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TitleBar />
      {!ready ? <main className="app-body" /> : dir === null ? <EmptyState /> : <main className="app-body" />}
      {ready && dir !== null && <StatusBar />}
    </div>
  );
}
