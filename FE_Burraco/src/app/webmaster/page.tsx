"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  admin,
  AdminError,
  type AdminOccupancy,
  type AdminUserRow,
  type AppLogEntry,
  type BroadcastCreateResponse,
  type BroadcastCriterio,
  type BroadcastRow,
  type BroadcastTipo,
  type EventRow,
  type Light,
  type LogLinksResponse,
  type RetentionStepReport,
  type ShopProductRow,
  type StatusCheckResponse,
} from "@/lib/admin";
import "./webmaster.css";

/**
 * AREA WEBMASTER — rework a SCHEDE responsive-first (Ciclo Pannello Admin). Tutti gli
 * stili discendono da `.webmaster-root` (CSS scopato): il layout radice e la grafica di
 * lobby/tavolo/profilo restano INTATTI. Un NON-admin non vede alcun contenuto: il gate
 * usa il probe `GET /admin/ping` (200 admin / 404 altrimenti); su non-200 si mostra un
 * "pagina non trovata" generico (nessuna conferma dell'esistenza dell'area).
 *
 * Competenza develop: struttura, stato, aggancio agli endpoint, stati attesa/errore.
 * La rifinitura visiva/UX è di agente_ui_ux. I dati testuali sono resi come TESTO
 * (React fa escaping; mai dangerouslySetInnerHTML): nessuna superficie XSS.
 */

type Gate = "checking" | "ok" | "denied";
type Tab = "utenti" | "log" | "monitoraggio" | "comunicazioni" | "catalogo";

const TABS: { id: Tab; label: string }[] = [
  { id: "utenti", label: "Utenti" },
  { id: "log", label: "Log" },
  { id: "monitoraggio", label: "Monitoraggio" },
  { id: "comunicazioni", label: "Comunicazioni" },
  { id: "catalogo", label: "Eventi & Shop" },
];

export default function WebmasterPage() {
  const [gate, setGate] = useState<Gate>("checking");
  const [tab, setTab] = useState<Tab>("utenti");

  useEffect(() => {
    // D2 — gate via probe: 200 → admin, 404/errore → nega senza rivelare l'area.
    admin
      .ping()
      .then(() => setGate("ok"))
      .catch(() => setGate("denied"));
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

      <div className="wm-tabs" role="tablist" aria-label="Sezioni del pannello">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`wm-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`wm-panel-${t.id}`}
            className={tab === t.id ? "wm-tab wm-tab-active" : "wm-tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Ogni pannello resta montato solo quando attivo: le fetch partono all'apertura. */}
      {tab === "utenti" && <TabPanel id="utenti"><UsersTab /></TabPanel>}
      {tab === "log" && <TabPanel id="log"><LogTab /></TabPanel>}
      {tab === "monitoraggio" && <TabPanel id="monitoraggio"><MonitoraggioTab /></TabPanel>}
      {tab === "comunicazioni" && <TabPanel id="comunicazioni"><ComunicazioniTab /></TabPanel>}
      {tab === "catalogo" && <TabPanel id="catalogo"><CatalogoTab /></TabPanel>}
    </main>
  );
}

function TabPanel({ id, children }: { id: Tab; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`wm-panel-${id}`} aria-labelledby={`wm-tab-${id}`} className="wm-tabpanel">
      {children}
    </div>
  );
}

/* ═══════════════════════════ Tab UTENTI ═══════════════════════════ */

function UsersTab() {
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const loadMore = useCallback(
    async (reset: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await admin.users(20, reset ? undefined : cursor ?? undefined);
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.nextCursor);
        setLoadedOnce(true);
      } catch (err) {
        setError(err instanceof AdminError ? err.message : "Errore nel caricamento utenti.");
      } finally {
        setBusy(false);
      }
    },
    [cursor],
  );

  useEffect(() => {
    void loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="wm-card" aria-label="Utenti registrati">
      <h2 className="wm-h2">Utenti registrati</h2>
      {error && <p className="wm-alert" role="alert">{error}</p>}
      {!loadedOnce && busy && <p className="wm-muted" role="status">Caricamento…</p>}
      {loadedOnce && items.length === 0 ? (
        <p className="wm-muted">Nessun utente registrato.</p>
      ) : (
        <div className="wm-table-wrap">
          <table className="wm-table">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Email</th>
                <th scope="col">Iscrizione</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.email ?? "—"}</td>
                  <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="wm-actions">
        {cursor && (
          <button type="button" className="wm-btn" onClick={() => void loadMore(false)} disabled={busy} aria-busy={busy}>
            {busy ? "Carico…" : "Carica altri"}
          </button>
        )}
        <button type="button" className="wm-btn wm-btn-small" onClick={() => void loadMore(true)} disabled={busy}>
          Ricarica
        </button>
      </div>
    </section>
  );
}

/* ═══════════════════════════ Tab LOG ═══════════════════════════ */

function LogTab() {
  const [links, setLinks] = useState<LogLinksResponse | null>(null);
  const [appLogs, setAppLogs] = useState<AppLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const to = Date.now();
    const from = to - 24 * 60 * 60 * 1000;
    try {
      const [l, a] = await Promise.all([
        admin.logLinks().catch(() => ({ renderUrl: null, neonUrl: null }) as LogLinksResponse),
        admin.appLogs(from, to, 100).catch(() => ({ items: [], limit: 100 })),
      ]);
      setLinks(l);
      setAppLogs(a.items);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Errore nel caricamento log.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="wm-card" aria-label="Log e dashboard">
      <h2 className="wm-h2">Log di sistema</h2>
      <p className="wm-muted">
        I log completi di infrastruttura vivono sulle dashboard di Render e Neon: apri i link qui sotto in una nuova scheda.
      </p>
      <div className="wm-actions">
        {links?.renderUrl ? (
          <a className="wm-btn" href={links.renderUrl} target="_blank" rel="noopener noreferrer">
            Apri log Render
          </a>
        ) : (
          <span className="wm-muted">Link Render non configurato</span>
        )}
        {links?.neonUrl ? (
          <a className="wm-btn" href={links.neonUrl} target="_blank" rel="noopener noreferrer">
            Apri console Neon
          </a>
        ) : (
          <span className="wm-muted">Link Neon non configurato</span>
        )}
      </div>

      <h3 className="wm-h3">Eventi applicativi (ultime 24h)</h3>
      {error && <p className="wm-alert" role="alert">{error}</p>}
      {busy && !appLogs && <p className="wm-muted" role="status">Caricamento…</p>}
      {appLogs && appLogs.length > 0 ? (
        <pre className="wm-log">
          {appLogs
            .map(
              (e) =>
                `${e.at ? new Date(e.at).toISOString() : "?"} [${e.livello}] ${e.categoria}: ${e.messaggio}${
                  e.meta ? " " + JSON.stringify(e.meta) : ""
                }`,
            )
            .join("\n")}
        </pre>
      ) : (
        appLogs && <p className="wm-muted">Nessun evento nella finestra.</p>
      )}
      <div className="wm-actions">
        <button type="button" className="wm-btn wm-btn-small" onClick={() => void load()} disabled={busy}>
          Aggiorna eventi
        </button>
      </div>
    </section>
  );
}

/* ═══════════════════════════ Tab MONITORAGGIO ═══════════════════════════ */

/** Un fanale del semaforo: cerchio SVG (verde/rosso) SEMPRE accompagnato da testo. */
function TrafficLight({ label, state, detail }: { label: string; state: Light; detail?: string }) {
  const color = state === "green" ? "#3fbf6f" : "#e5534b";
  const testo = state === "green" ? "OK" : "KO";
  return (
    <div className="wm-light" role="group" aria-label={`${label}: ${testo}`}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="wm-light-dot">
        <circle cx="11" cy="11" r="8" fill={color} stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
      </svg>
      <span className="wm-light-text">
        <strong>{label}</strong>: {testo}
        {detail ? <span className="wm-muted"> — {detail}</span> : null}
      </span>
    </div>
  );
}

function MonitoraggioTab() {
  const [status, setStatus] = useState<StatusCheckResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [occ, setOcc] = useState<AdminOccupancy | null>(null);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      const s = await admin.statusCheck();
      setStatus(s);
    } catch {
      // Se il backend non risponde: FE verde (pannello caricato), BE/DB rossi.
      setStatus({
        fe: "green",
        be: "red",
        db: "red",
        checkedAt: Date.now(),
        detail: {
          be: "Backend non raggiungibile: la richiesta di controllo non ha ricevuto risposta.",
          db: "Stato del database non verificabile (backend non raggiungibile).",
        },
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const loadOcc = useCallback(async () => {
    try {
      setOcc(await admin.occupancy());
    } catch {
      /* occupazione best-effort */
    }
  }, []);

  useEffect(() => {
    void loadOcc();
  }, [loadOcc]);

  const pct = occ ? Math.round(occ.usedRatio * 100) : 0;

  return (
    <>
      <section className="wm-card" aria-label="Semaforo di sistema">
        <h2 className="wm-h2">Monitoraggio del sistema</h2>
        <p className="wm-muted">
          Controllo su richiesta (nessun aggiornamento automatico). FE = pannello caricato; BE = backend raggiungibile;
          DB = SELECT 1 entro 60 secondi.
        </p>
        <div className="wm-actions">
          <button type="button" className="wm-btn" onClick={() => void check()} disabled={busy} aria-busy={busy}>
            {busy ? "Controllo…" : "Aggiorna adesso"}
          </button>
        </div>
        {status ? (
          <div className="wm-lights">
            <TrafficLight label="Frontend" state={status.fe} detail="Pannello caricato" />
            <TrafficLight label="Backend" state={status.be} detail={status.detail.be} />
            <TrafficLight label="Database" state={status.db} detail={status.detail.db} />
            <p className="wm-muted" role="status">
              Ultimo controllo: {new Date(status.checkedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="wm-muted" role="status">Nessun controllo eseguito — premi &quot;Aggiorna adesso&quot;.</p>
        )}
      </section>

      <section className="wm-card" aria-label="Occupazione del database">
        <h2 className="wm-h2">Occupazione del database</h2>
        {occ ? (
          <>
            <p className={occ.alert ? "wm-alert" : "wm-muted"} role={occ.alert ? "alert" : undefined}>
              {occ.total} / {occ.budget} righe ({pct}%){occ.alert ? " — soglia d'allarme superata" : ""}
            </p>
            <div className="wm-table-wrap">
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
            </div>
          </>
        ) : (
          <p className="wm-muted" role="status">Caricamento occupazione…</p>
        )}
        <div className="wm-actions">
          <button type="button" className="wm-btn wm-btn-small" onClick={() => void loadOcc()}>
            Aggiorna occupazione
          </button>
        </div>
      </section>

      <RetentionSection />
    </>
  );
}

/* ── Retention (dry-run) — ricollocata sotto Monitoraggio ─────────────────── */

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
      <p className="wm-muted">Simulazione: conta quante righe verrebbero rimosse, senza cancellare nulla.</p>
      <div className="wm-actions">
        <button type="button" className="wm-btn" onClick={() => void preview()} disabled={busy} aria-busy={busy}>
          {busy ? "Calcolo…" : "Esegui anteprima"}
        </button>
      </div>
      {error && <p className="wm-alert" role="alert">{error}</p>}
      {reports && (
        <div className="wm-table-wrap">
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
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════ Tab COMUNICAZIONI ═══════════════════════════ */

function ComunicazioniTab() {
  const [oggetto, setOggetto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [tipo, setTipo] = useState<BroadcastTipo>("servizio");
  const [tuttiRegistrati, setTuttiRegistrati] = useState(false);
  const [minPartite, setMinPartite] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BroadcastCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<BroadcastRow[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);

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
        setPreview(r);
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
        setConfirmId(null);
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
          Anteprima (conta + quota)
        </button>
        <button type="button" className="wm-btn" onClick={() => void doPreview(false)} disabled={busy || !oggetto || !corpo}>
          Crea bozza
        </button>
      </div>

      {error && <p className="wm-alert" role="alert">{error}</p>}
      {preview && (
        <div className="wm-quota" role="status">
          <p className="wm-muted">
            Destinatari stimati: <strong>{preview.count}</strong>
            {preview.sample && preview.sample.length > 0 ? ` (es. ${preview.sample.join(", ")})` : ""}
            {preview.id ? " — bozza creata." : ""}
          </p>
          <p className="wm-muted">
            Quota di oggi: <strong>{preview.quotaRemaining}</strong> / {preview.quotaCap} disponibili.
          </p>
          {!preview.quotaSufficiente && (
            <p className="wm-alert" role="alert">
              I destinatari superano la quota di oggi: l&apos;invio partirà entro la quota e si completerà
              automaticamente nei giorni successivi (nessun destinatario perso).
            </p>
          )}
        </div>
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
              {(b.stato === "bozza" || b.recipients.inCoda > 0) &&
                (confirmId === b.id ? (
                  <span className="wm-confirm">
                    <span className="wm-muted">Confermi l&apos;invio?</span>
                    <button type="button" className="wm-btn wm-btn-small" onClick={() => void send(b.id)} disabled={busy}>
                      Conferma
                    </button>
                    <button type="button" className="wm-btn wm-btn-small" onClick={() => setConfirmId(null)} disabled={busy}>
                      Annulla
                    </button>
                  </span>
                ) : (
                  <button type="button" className="wm-btn wm-btn-small" onClick={() => setConfirmId(b.id)} disabled={busy}>
                    Avvia invio
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ═══════════════════════════ Tab EVENTI & SHOP (predisposizione) ═══════════════════════════ */

function CatalogoTab() {
  return (
    <>
      <p className="wm-muted">
        Predisposizione: è possibile inserire ed elencare eventi e prodotti. La vetrina pubblica, le iscrizioni ai
        tornei e il carrello/pagamento dello shop NON sono attivi in questo ciclo.
      </p>
      <EventiSection />
      <ShopSection />
    </>
  );
}

function EventiSection() {
  const [items, setItems] = useState<EventRow[]>([]);
  const [titolo, setTitolo] = useState("");
  const [luogo, setLuogo] = useState("");
  const [inizio, setInizio] = useState(""); // datetime-local
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await admin.listEvents();
      setItems(r.items);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    const ms = inizio ? new Date(inizio).getTime() : NaN;
    if (!titolo.trim() || !Number.isFinite(ms)) {
      setError("Titolo e data/ora di inizio sono obbligatori.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await admin.createEvent({ titolo, luogo: luogo || undefined, inizioAt: ms });
      setTitolo("");
      setLuogo("");
      setInizio("");
      await refresh();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Errore nella creazione evento.");
    } finally {
      setBusy(false);
    }
  }, [titolo, luogo, inizio, refresh]);

  return (
    <section className="wm-card" aria-label="Eventi e tornei">
      <h2 className="wm-h2">Eventi / Tornei</h2>
      <div className="wm-field">
        <label htmlFor="wm-ev-titolo">Titolo</label>
        <input id="wm-ev-titolo" value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={150} />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-ev-luogo">Luogo</label>
        <input id="wm-ev-luogo" value={luogo} onChange={(e) => setLuogo(e.target.value)} maxLength={150} />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-ev-inizio">Inizio</label>
        <input id="wm-ev-inizio" type="datetime-local" value={inizio} onChange={(e) => setInizio(e.target.value)} />
      </div>
      <div className="wm-actions">
        <button type="button" className="wm-btn" onClick={() => void create()} disabled={busy || !titolo || !inizio}>
          {busy ? "Salvo…" : "Aggiungi evento"}
        </button>
      </div>
      {error && <p className="wm-alert" role="alert">{error}</p>}

      <h3 className="wm-h3">Eventi inseriti</h3>
      {items.length === 0 ? (
        <p className="wm-muted">Nessun evento.</p>
      ) : (
        <ul className="wm-list">
          {items.map((ev) => (
            <li key={ev.id} className="wm-list-row">
              <span>
                <strong>{ev.titolo}</strong>
                {ev.luogo ? ` · ${ev.luogo}` : ""} · {new Date(ev.inizioAt).toLocaleString()} ·{" "}
                {ev.pubblicato ? "pubblicato" : "bozza"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ShopSection() {
  const [items, setItems] = useState<ShopProductRow[]>([]);
  const [nome, setNome] = useState("");
  const [prezzo, setPrezzo] = useState(""); // in euro, convertito in centesimi
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await admin.listShopProducts();
      setItems(r.items);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!nome.trim()) {
      setError("Il nome del prodotto è obbligatorio.");
      return;
    }
    const euro = Number(prezzo.replace(",", "."));
    const prezzoCent = Number.isFinite(euro) ? Math.max(0, Math.round(euro * 100)) : 0;
    setBusy(true);
    setError(null);
    try {
      await admin.createShopProduct({ nome, prezzoCent });
      setNome("");
      setPrezzo("");
      await refresh();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Errore nella creazione prodotto.");
    } finally {
      setBusy(false);
    }
  }, [nome, prezzo, refresh]);

  const fmtPrezzo = (cent: number, valuta: string) =>
    `${(cent / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${valuta}`;

  return (
    <section className="wm-card" aria-label="Prodotti shop">
      <h2 className="wm-h2">Shop (prodotti)</h2>
      <div className="wm-field">
        <label htmlFor="wm-sp-nome">Nome</label>
        <input id="wm-sp-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-sp-prezzo">Prezzo (EUR)</label>
        <input id="wm-sp-prezzo" inputMode="decimal" value={prezzo} onChange={(e) => setPrezzo(e.target.value)} placeholder="es. 12,50" />
      </div>
      <div className="wm-actions">
        <button type="button" className="wm-btn" onClick={() => void create()} disabled={busy || !nome}>
          {busy ? "Salvo…" : "Aggiungi prodotto"}
        </button>
      </div>
      {error && <p className="wm-alert" role="alert">{error}</p>}

      <h3 className="wm-h3">Prodotti inseriti</h3>
      {items.length === 0 ? (
        <p className="wm-muted">Nessun prodotto.</p>
      ) : (
        <ul className="wm-list">
          {items.map((p) => (
            <li key={p.id} className="wm-list-row">
              <span>
                <strong>{p.nome}</strong> · {fmtPrezzo(p.prezzoCent, p.valuta)} ·{" "}
                {p.disponibile ? "disponibile" : "non disponibile"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
