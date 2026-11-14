import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analysis } from "./Analysis.tsx";
import { Report } from "./Report.tsx";
import { api } from "./api.ts";
import "./styles.css";

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function Home() {
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof api.list>> | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    api.list().then(setTemplates, (e: Error) => setError(e.message));
  }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      location.hash = `#/a/${(await api.create(name)).template.id}`;
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function removeTemplate(id: string, title: string) {
    if (!confirm(`Delete “${title}”? This cannot be undone.`)) return;
    try {
      await api.deleteTemplate(id);
      setTemplates((items) => items?.filter((t) => t.id !== id) ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <main className="home">
      <header className="home-header">
        <a className="brand" href="#/" aria-label="Cala Contour home"><span className="brand-mark">C</span><span>Cala <strong>Contour</strong></span></a>
        <span className="eyebrow">DATA WORKSPACE</span>
      </header>
      <form className="create-form" onSubmit={create}>
        <label className="sr-only" htmlFor="template-name">Name your template</label>
        <input id="template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name a new analysis…" required />
        <button type="submit">Create template <span aria-hidden="true">→</span></button>
      </form>
      {error && <p className="error">{error}</p>}
      <section className="library">
        <div className="library-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Analyses <span>{templates?.length ?? "—"}</span></h2></div>
          {templates && templates.length > 0 && <label className="search-box"><span aria-hidden="true">⌕</span><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an analysis" aria-label="Find an analysis" /></label>}
        </div>
        {templates === null && !error && <div className="loading-card" role="status">Loading your workspace…</div>}
        {templates && templates.filter((t) => `${t.name} ${t.query}`.toLowerCase().includes(filter.toLowerCase())).map((t) => (
          <article className="template-card" key={t.id}>
            <div className="template-icon" aria-hidden="true">↗</div>
            <div className="template-info"><a className="template-title" href={`#/a/${t.id}`}>{t.name || t.id}</a><p>{t.query || "No query added yet"}</p></div>
            <a className="template-play" href={`#/r/${t.id}`} aria-label={`Play ${t.name || t.id}`}>▶</a>
            <details className="template-menu">
              <summary aria-label={`Actions for ${t.name || t.id}`} title="Template actions">⋯</summary>
              <div className="template-menu-popover" role="menu">
                <a href={`#/a/${t.id}`} role="menuitem">Edit template</a>
                <button type="button" role="menuitem" onClick={() => removeTemplate(t.id, t.name || t.id)}>Delete template</button>
              </div>
            </details>
          </article>
        ))}
        {templates?.length === 0 && <div className="empty-state"><span aria-hidden="true">✳</span><h3>Your first insight starts here.</h3><p>Create a template to turn a Cala query into an analysis you can revisit and share.</p></div>}
        {templates && templates.length > 0 && !templates.some((t) => `${t.name} ${t.query}`.toLowerCase().includes(filter.toLowerCase())) && <p className="muted">No analyses match “{filter}”.</p>}
      </section>
    </main>
  );
}

function App() {
  const hash = useHash();
  const report = /^#\/r\/([a-z0-9-]+)(?:\?(.*))?$/.exec(hash);
  if (report) {
    const initial = Object.fromEntries(new URLSearchParams(report[2] ?? ""));
    return <Report key={report[1]} id={report[1]} initial={initial} />;
  }
  // Old links were /a/<id>; new ones are #/a/<id>.
  const id = /^#\/a\/([a-z0-9-]+)$/.exec(hash)?.[1] ?? /^\/a\/([a-z0-9-]+)$/.exec(location.pathname)?.[1];
  return id ? <Analysis key={id} id={id} /> : <Home />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
