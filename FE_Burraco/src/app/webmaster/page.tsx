"use client";

import { useCallback, useEffect, useState } from "react";
import {
  admin,
  AdminError,
  type AdminOccupancy,
  type AppLogEntry,
  type BroadcastCriterio,
  type BroadcastRow,
  type BroadcastTipo,
  type DbStatusResponse,
  type RenderLogResponse,
  type RetentionStepReport,
} from "@/lib/admin";
import "./webmaster.css";

/**
 * AREA WEBMASTER (FASE 5) — segmento di rotta NUOVO (`/webmaster`). Il layout radice
 * resta INTATTO; tutti gli stili discendono da `.webmaster-root` (CSS scopato). Un
 * NON-admin non vede alcun contenuto riservato: il backend risponde 404 e la pagina
 * mostra un "pagina non trovata" generico (non conferma l'esistenza dell'area).
 *
 * Competenza develop: struttura, stato, aggancio agli endpoint, stati di attesa/errore.
 * La rifinitura visiva/UX è di agente_ui_ux. I LOG sono resi come TESTO (React fa
 * escaping; mai dangerouslySetInnerHTML): nessuna superficie XSS.
 */

type Gate = "checking" | "ok" | "denied";

export default function WebmasterPage() {
  const [gate, setGate] = useState<Gate>("checking");
  const [occ, setOcc] = useState<AdminOccupancy | null>(null);

  useEffect(() => {
    admin
      .occupancy()
      .then((o) => {
        setOcc(o);
        setGate("ok");
      })
      .catch(() => {
        // 404 (non admin) o qualsiasi altro errore → nega senza rivelare l'area.
        setGate("denied");
      });
  }, []);

  if (gate === "checking") {
    return (
      <main className="webmaster-root">
        <p className="wm-status" role="status">Verifica dell&apos;accesso…</p>
      </main>
    );
  }
  if (gate === "denied") {
    // Mimica una 404: nessun contenuto riservato, nessuna conferma dell'esistenza.
    return (
      <main className="webmaster-root">
        <h1 className="wm-title">Pagina non trovata</h1>
        <p className="wm-status">La risorsa richiesta non esiste.</p>
      </main>
    );
  }

  return (
    <main className="webmaster-root">
      <h1 className="wm-title">Area webmaster</h1>
      <OccupancySection occ={occ} />
      <RetentionSection />
      <BroadcastSection />
      <LogsSection />
    </main>
  );
}

/* ── Occupazione DB ──────────────────────────────────────────────────────── */

function OccupancySection({ occ }: { occ: AdminOccupancy | null }) {
  if (!occ) return null;
  const pct = Math.round(occ.usedRatio * 100);
  return (
    <section className="wm-card" aria-label="Occupazione del database">
      <h2 className="wm-h2">Occupazione del database</h2>
      <p className={occ.alert ? "wm-alert" : "wm-muted"} role={occ.alert ? "alert" : undefined}>
        {occ.total} / {occ.budget} righe ({pct}%){occ.alert ? " — soglia d'allarme superata" : ""}
      </p>
      <table className="wm-table">
        <thead>
          <tr>
            <th scope="col">Tabella</th>
            <th scope="col">Righe</th>
          </tr>
        </thead>
        <tbody>
          {occ.tables.map((t) => (
            <tr key={t.table}>
              <td>{t.table}</td>
              <td className="wm-num">{t.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ── Retention (dry-run) ─────────────────────────────────────────────────── */

function RetentionSection() {
  const [reports, setReports] = useState<RetentionStepReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await admin.retentionPreview();
      setReports(r.reports);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Errore.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="wm-card" aria-label="Conservazione dei dati">
      <h2 className="wm-h2">Conservazione (anteprima a secco)</h2>
      <p className="wm-muted">
        Simulazione: conta quante righe verrebbero rimosse, senza cancellare nulla.
      </p>
      <button type="button" className="wm-btn" onClick={() => void preview()} disabled={busy} aria-busy={busy}>
        {busy ? "Calcolo…" : "Esegui anteprima"}
      </button>
      {error && <p className="wm-alert" role="alert">{error}</p>}
      {reports && (
        <table className="wm-table">
          <thead>
            <tr>
              <th scope="col">Processo</th>
              <th scope="col">Righe candidate</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.step}>
                <td>{r.step}</td>
                <td className="wm-num">{r.matched}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ── Comunicazioni broadcast ─────────────────────────────────────────────── */

function BroadcastSection() {
  const [oggetto, setOggetto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [tipo, setTipo] = useState<BroadcastTipo>("servizio");
  const [tuttiRegistrati, setTuttiRegistrati] = useState(false);
  const [minPartite, setMinPartite] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ count: number; sample?: string[]; id: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<BroadcastRow[]>([]);

  const criterio = useCallback((): BroadcastCriterio => {
    const c: BroadcastCriterio = {};
    if (tuttiRegistrati) c.all = true;
    if (minPartite.trim() !== "") c.minPartite = Math.max(0, Number(minPartite) || 0);
    return c;
  }, [tuttiRegistrati, minPartite]);

  const refresh = useCallback(async () => {
    try {
      const r = await admin.listBroadcasts();
      setItems(r.items);
    } catch {
      /* elenco best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doPreview = useCallback(
    async (dryRun: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const r = await admin.createBroadcast({ oggetto, corpo, tipo, criterio: criterio(), dryRun });
        setPreview({ count: r.count, sample: r.sample, id: r.id });
        if (!dryRun) await refresh();
      } catch (err) {
        setError(err instanceof AdminError ? err.message : "Errore.");
      } finally {
        setBusy(false);
      }
    },
    [oggetto, corpo, tipo, criterio, refresh],
  );

  const send = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        await admin.sendBroadcast(id);
        await refresh();
      } catch (err) {
        setError(err instanceof AdminError ? err.message : "Errore.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return (
    <section className="wm-card" aria-label="Comunicazioni ai registrati">
      <h2 className="wm-h2">Comunicazioni</h2>
      <div className="wm-field">
        <label htmlFor="wm-oggetto">Oggetto</label>
        <input id="wm-oggetto" value={oggetto} onChange={(e) => setOggetto(e.target.value)} maxLength={150} />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-corpo">Corpo (solo testo)</label>
        <textarea id="wm-corpo" value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={5} maxLength={5000} />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-tipo">Tipo</label>
        <select id="wm-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as BroadcastTipo)}>
          <option value="servizio">Servizio (sempre inviabile)</option>
          <option value="promozionale">Promozionale (solo a chi ha dato consenso)</option>
        </select>
      </div>
      <fieldset className="wm-field">
        <legend>Destinatari</legend>
        <label className="wm-check">
          <input type="checkbox" checked={tuttiRegistrati} onChange={(e) => setTuttiRegistrati(e.target.checked)} />
          Tutti i registrati
        </label>
        <label htmlFor="wm-minp">Almeno N partite</label>
        <input id="wm-minp" inputMode="numeric" value={minPartite} onChange={(e) => setMinPartite(e.target.value)} />
      </fieldset>

      <div className="wm-actions">
        <button type="button" className="wm-btn" onClick={() => void doPreview(true)} disabled={busy}>
          Anteprima (conta)
        </button>
        <button type="button" className="wm-btn" onClick={() => void doPreview(false)} disabled={busy || !oggetto || !corpo}>
          Crea bozza
        </button>
      </div>

      {error && <p className="wm-alert" role="alert">{error}</p>}
      {preview && (
        <p className="wm-muted" role="status">
          Destinatari stimati: <strong>{preview.count}</strong>
          {preview.sample && preview.sample.length > 0 ? ` (es. ${preview.sample.join(", ")})` : ""}
          {preview.id ? " — bozza creata." : ""}
        </p>
      )}

      <h3 className="wm-h3">Comunicazioni recenti</h3>
      {items.length === 0 ? (
        <p className="wm-muted">Nessuna comunicazione.</p>
      ) : (
        <ul className="wm-list">
          {items.map((b) => (
            <li key={b.id} className="wm-list-row">
              <span>
                <strong>{b.oggetto}</strong> · {b.tipo} · {b.stato} · in coda {b.recipients.inCoda}, inviati{" "}
                {b.recipients.inviato}, errori {b.recipients.errore}, saltati {b.recipients.saltato}
              </span>
              {(b.stato === "bozza" || b.recipients.inCoda > 0) && (
                <button type="button" className="wm-btn wm-btn-small" onClick={() => void send(b.id)} disabled={busy}>
                  Avvia invio
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Log di sistema ──────────────────────────────────────────────────────── */

function LogsSection() {
  const [appLogs, setAppLogs] = useState<AppLogEntry[] | null>(null);
  const [renderLogs, setRenderLogs] = useState<RenderLogResponse | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const to = Date.now();
    const from = to - 24 * 60 * 60 * 1000;
    try {
      const [a, r, d] = await Promise.all([
        admin.appLogs(from, to, 100),
        admin.renderLogs(from, to, 100).catch(() => ({ available: false, reason: "non disponibile", lines: [] })),
        admin.dbStatus().catch(() => null),
      ]);
      setAppLogs(a.items);
      setRenderLogs(r);
      setDbStatus(d);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Errore.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="wm-card" aria-label="Log di sistema">
      <h2 className="wm-h2">Log di sistema (ultime 24h)</h2>
      <button type="button" className="wm-btn" onClick={() => void load()} disabled={busy} aria-busy={busy}>
        {busy ? "Aggiorno…" : "Aggiorna"}
      </button>
      {error && <p className="wm-alert" role="alert">{error}</p>}

      <h3 className="wm-h3">Eventi applicativi</h3>
      {appLogs && appLogs.length > 0 ? (
        <pre className="wm-log">
          {appLogs
            .map((e) => `${e.at ? new Date(e.at).toISOString() : "?"} [${e.livello}] ${e.categoria}: ${e.messaggio}${e.meta ? " " + JSON.stringify(e.meta) : ""}`)
            .join("\n")}
        </pre>
      ) : (
        <p className="wm-muted">Nessun evento nella finestra.</p>
      )}

      <h3 className="wm-h3">Log Render</h3>
      {renderLogs?.available ? (
        <pre className="wm-log">{renderLogs.lines.join("\n") || "(nessuna riga)"}</pre>
      ) : (
        <p className="wm-muted">{renderLogs?.reason ?? "Non disponibile."}</p>
      )}

      <h3 className="wm-h3">Stato database</h3>
      {dbStatus?.available ? (
        <div>
          <p className="wm-muted">Connessioni attive: {dbStatus.activeConnections ?? "—"}</p>
          {dbStatus.slowQueriesAvailable && dbStatus.slowQueries ? (
            <pre className="wm-log">
              {dbStatus.slowQueries.map((q) => `${q.meanMs}ms ×${q.calls}  ${q.query}`).join("\n")}
            </pre>
          ) : (
            <p className="wm-muted">{dbStatus.note ?? "Query lente non disponibili."}</p>
          )}
        </div>
      ) : (
        <p className="wm-muted">{dbStatus?.note ?? "Stato DB non disponibile."}</p>
      )}
    </section>
  );
}
