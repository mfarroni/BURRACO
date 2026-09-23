"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  admin,
  AdminError,
  type AdminOccupancy,
  type AdminResetPasswordResponse,
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
import { ACCEPTED_IMAGE_TYPES, ImageError, resizeImageToDataUrl } from "@/lib/image";
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // WCAG Tabs pattern con ATTIVAZIONE MANUALE (APG): le frecce spostano solo il
  // focus (roving tabindex), l'attivazione avviene con Invio/Spazio o click. Scelta
  // deliberata perché cambiare scheda innesca fetch di rete: con l'attivazione
  // automatica lo "sfogliare" con le frecce farebbe partire richieste inutili.
  const onTabKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = -1;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (idx + 1) % TABS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (idx - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TABS.length - 1;
        break;
      default:
        return; // Invio/Spazio: gestiti dal click nativo del <button>
    }
    e.preventDefault();
    tabRefs.current[next]?.focus();
  }, []);

  // La scheda attiva resta sempre visibile nella barra scrollabile (viewport stretti).
  useEffect(() => {
    const idx = TABS.findIndex((t) => t.id === tab);
    tabRefs.current[idx]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

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
      <div className="wm-header">
        <h1 className="wm-title">Area webmaster</h1>
        {/* Ritorno alla lobby: la radice "/" mostra la lobby all'utente autenticato. */}
        <Link className="wm-btn wm-btn-small" href="/">
          <span aria-hidden="true">&larr;</span> Torna alla lobby
        </Link>
      </div>

      <div className="wm-tabs-scroll">
        <div className="wm-tabs" role="tablist" aria-label="Sezioni del pannello">
          {TABS.map((t, idx) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              id={`wm-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`wm-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? "wm-tab wm-tab-active" : "wm-tab"}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, idx)}
            >
              {t.label}
            </button>
          ))}
        </div>
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

type UserAction = "delete" | "reset";

function UsersTab() {
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  // Conferma inline (stesso schema dell'invio broadcast): una riga alla volta.
  const [confirm, setConfirm] = useState<{ id: string; action: UserAction } | null>(null);
  const [opBusy, setOpBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<(AdminResetPasswordResponse & { name: string }) | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirm) confirmBtnRef.current?.focus();
  }, [confirm]);

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

  const runAction = useCallback(async (u: AdminUserRow, action: UserAction) => {
    setOpBusy(true);
    setError(null);
    setNotice(null);
    setResetResult(null);
    try {
      if (action === "delete") {
        await admin.deleteUser(u.id);
        setItems((prev) => prev.filter((x) => x.id !== u.id));
        setNotice(`Utente ${u.displayName} eliminato: i suoi dati sono stati cancellati.`);
      } else {
        const r = await admin.resetUserPassword(u.id);
        setResetResult({ ...r, name: u.displayName });
      }
      setConfirm(null);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Operazione non riuscita.");
    } finally {
      setOpBusy(false);
    }
  }, []);

  return (
    <section className="wm-card" aria-label="Utenti registrati">
      <h2 className="wm-h2">Utenti registrati</h2>
      {error && <p className="wm-alert" role="alert">{error}</p>}
      {notice && <p className="wm-success" role="status" aria-live="polite">{notice}</p>}
      {resetResult && (
        <div className="wm-quota" role="status" aria-live="polite">
          <p className="wm-muted">
            Password di <strong>{resetResult.name}</strong> reimpostata; tutte le sue sessioni sono state chiuse.
          </p>
          <div className="wm-quota-row">
            <span className="wm-quota-label">Password temporanea</span>
            <code className="wm-quota-value wm-temp-pw">{resetResult.tempPassword}</code>
          </div>
          {resetResult.emailed ? (
            <p className="wm-muted">Email con la password temporanea inviata all&apos;utente.</p>
          ) : (
            <p className="wm-warn" role="alert">
              Email non inviata (servizio email spento o quota esaurita): comunica tu la password all&apos;utente.
            </p>
          )}
          <p className="wm-muted">Viene mostrata solo ora: non sarà più visibile dopo aver lasciato la pagina.</p>
          <div className="wm-actions">
            <button type="button" className="wm-btn wm-btn-small" onClick={() => setResetResult(null)}>
              Nascondi
            </button>
          </div>
        </div>
      )}
      {!loadedOnce && busy && (
        <p className="wm-loading" role="status">
          <span className="wm-spinner" aria-hidden="true" /> Caricamento utenti…
        </p>
      )}
      {loadedOnce && items.length === 0 && <p className="wm-empty">Nessun utente registrato.</p>}
      {items.length > 0 && (
        <div className="wm-table-wrap">
          <table className="wm-table">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Email</th>
                <th scope="col">Iscrizione</th>
                <th scope="col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.email ?? "—"}</td>
                  <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                  <td>
                    {confirm?.id === u.id ? (
                      <span
                        className="wm-confirm"
                        role="group"
                        aria-label={
                          confirm.action === "delete"
                            ? `Conferma eliminazione di ${u.displayName}`
                            : `Conferma reset password di ${u.displayName}`
                        }
                      >
                        <span className="wm-confirm-text">
                          {confirm.action === "delete"
                            ? "Eliminazione irreversibile di account e dati personali. Confermi?"
                            : "Nuova password temporanea e chiusura di tutte le sessioni. Confermi?"}
                        </span>
                        <span className="wm-confirm-actions">
                          <button
                            type="button"
                            className="wm-btn wm-btn-small wm-btn-danger"
                            onClick={() => void runAction(u, confirm.action)}
                            disabled={opBusy}
                            aria-busy={opBusy}
                            ref={confirmBtnRef}
                          >
                            {opBusy ? "Attendi…" : confirm.action === "delete" ? "Sì, elimina" : "Sì, reimposta"}
                          </button>
                          <button
                            type="button"
                            className="wm-btn wm-btn-small"
                            onClick={() => setConfirm(null)}
                            disabled={opBusy}
                          >
                            Annulla
                          </button>
                        </span>
                      </span>
                    ) : (
                      <span className="wm-row-actions">
                        <button
                          type="button"
                          className="wm-btn wm-btn-small"
                          onClick={() => setConfirm({ id: u.id, action: "reset" })}
                          disabled={opBusy}
                          aria-label={`Reimposta la password di ${u.displayName}`}
                        >
                          Reimposta password
                        </button>
                        <button
                          type="button"
                          className="wm-btn wm-btn-small wm-btn-danger"
                          onClick={() => setConfirm({ id: u.id, action: "delete" })}
                          disabled={opBusy}
                          aria-label={`Elimina l'utente ${u.displayName}`}
                        >
                          Elimina
                        </button>
                      </span>
                    )}
                  </td>
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
        I log completi di infrastruttura vivono sulle dashboard di Render e Neon: i link qui sotto si aprono in una
        nuova scheda.
      </p>
      <div className="wm-linkbar">
        <ExternalLink href={links?.renderUrl ?? null} label="Apri log Render" fallback="Link Render non configurato" />
        <ExternalLink href={links?.neonUrl ?? null} label="Apri console Neon" fallback="Link Neon non configurato" />
      </div>

      <h3 className="wm-h3">Eventi applicativi (ultime 24h)</h3>
      {error && <p className="wm-alert" role="alert">{error}</p>}
      {busy && !appLogs && (
        <p className="wm-loading" role="status">
          <span className="wm-spinner" aria-hidden="true" /> Caricamento…
        </p>
      )}
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
        appLogs && <p className="wm-empty">Nessun evento applicativo nelle ultime 24 ore.</p>
      )}
      <div className="wm-actions">
        <button type="button" className="wm-btn wm-btn-small" onClick={() => void load()} disabled={busy} aria-busy={busy}>
          {busy ? "Aggiorno…" : "Aggiorna eventi"}
        </button>
      </div>
    </section>
  );
}

/** Pulsante-link verso una dashboard esterna: apre in nuova scheda con rel sicuro. */
function ExternalLink({ href, label, fallback }: { href: string | null; label: string; fallback: string }) {
  if (!href) return <span className="wm-link-off">{fallback}</span>;
  return (
    <a className="wm-btn wm-btn-link" href={href} target="_blank" rel="noopener noreferrer">
      <span>{label}</span>
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" className="wm-ext-icon">
        <path
          d="M5.5 2.5h-3v10h10v-3M9 2.5h3.5V6M12 3l-5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="wm-sr-only"> (si apre in una nuova scheda)</span>
    </a>
  );
}

/* ═══════════════════════════ Tab MONITORAGGIO ═══════════════════════════ */

/**
 * Un fanale del semaforo. Il colore NON è mai l'unico canale: si distinguono per
 * (1) FORMA — cerchio (OK) vs ottagono da "stop" (KO); (2) ICONA — spunta vs croce;
 * (3) TESTO — "OK"/"KO" ed etichetta. Così resta leggibile anche in daltonismo o in
 * bianco/nero. Il dettaglio testuale accompagna sempre l'esito.
 */
function TrafficLight({ label, state, detail }: { label: string; state: Light; detail?: string }) {
  const ok = state === "green";
  const testo = ok ? "OK" : "KO";
  // Nessun aria-label sul contenitore: sovrascriverebbe il testo di dettaglio nella
  // live region. Il testo visibile (etichetta + esito + dettaglio) è già completo;
  // l'icona è puramente decorativa (aria-hidden).
  return (
    <div className={ok ? "wm-light wm-light-ok" : "wm-light wm-light-ko"}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="wm-light-dot">
        {ok ? (
          <>
            <circle cx="13" cy="13" r="10" className="wm-light-shape" />
            <path
              d="M8 13.5l3.2 3.2L18 9.5"
              fill="none"
              className="wm-light-glyph"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            <polygon
              points="9,3 17,3 23,9 23,17 17,23 9,23 3,17 3,9"
              className="wm-light-shape"
            />
            <path
              d="M9.2 9.2l7.6 7.6M16.8 9.2l-7.6 7.6"
              fill="none"
              className="wm-light-glyph"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      <span className="wm-light-text">
        <strong>{label}</strong>: <span className="wm-light-verdict">{testo}</span>
        {detail ? <span className="wm-muted"> — {detail}</span> : null}
      </span>
    </div>
  );
}

function MonitoraggioTab() {
  const [status, setStatus] = useState<StatusCheckResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [occ, setOcc] = useState<AdminOccupancy | null>(null);
  const [occErr, setOccErr] = useState<string | null>(null);
  const [occBusy, setOccBusy] = useState(false);

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
    setOccBusy(true);
    setOccErr(null);
    try {
      setOcc(await admin.occupancy());
    } catch (err) {
      setOccErr(err instanceof AdminError ? err.message : "Impossibile leggere l'occupazione del database.");
    } finally {
      setOccBusy(false);
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
          <button type="button" className="wm-btn wm-btn-primary" onClick={() => void check()} disabled={busy} aria-busy={busy}>
            {busy ? "Controllo in corso…" : "Aggiorna adesso"}
          </button>
        </div>
        {/* L'esito è annunciato agli screen reader (aria-live) dopo il controllo. */}
        <div className="wm-lights-live" role="status" aria-live="polite">
          {busy && !status ? (
            <p className="wm-loading">
              <span className="wm-spinner" aria-hidden="true" /> Controllo di FE, BE e DB in corso…
            </p>
          ) : status ? (
            <div className="wm-lights">
              <TrafficLight label="Frontend" state={status.fe} detail="Pannello caricato" />
              <TrafficLight label="Backend" state={status.be} detail={status.detail.be} />
              <TrafficLight label="Database" state={status.db} detail={status.detail.db} />
              <p className="wm-timestamp">
                Ultimo controllo: {new Date(status.checkedAt).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="wm-empty">Nessun controllo eseguito. Premi &quot;Aggiorna adesso&quot; per verificare lo stato.</p>
          )}
        </div>
      </section>

      <section className="wm-card" aria-label="Occupazione del database">
        <h2 className="wm-h2">Occupazione del database</h2>
        {occErr ? (
          <p className="wm-alert" role="alert">{occErr}</p>
        ) : occ ? (
          <>
            <div
              className={occ.alert ? "wm-gauge wm-gauge-alert" : "wm-gauge"}
              role={occ.alert ? "alert" : "img"}
              aria-label={`Occupazione: ${occ.total} righe su ${occ.budget} (${pct}%)${occ.alert ? ", soglia d'allarme superata" : ""}`}
            >
              <div className="wm-gauge-head">
                <span className="wm-gauge-value">
                  {occ.total.toLocaleString()} / {occ.budget.toLocaleString()} righe
                </span>
                <span className={occ.alert ? "wm-badge wm-badge-alert" : "wm-badge"}>{pct}%</span>
              </div>
              <div className="wm-gauge-track" aria-hidden="true">
                <div className="wm-gauge-fill" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              {occ.alert && <p className="wm-alert wm-gauge-note">Soglia d&apos;allarme superata.</p>}
            </div>
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
                      <td className="wm-num">{t.rows.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="wm-loading" role="status">
            <span className="wm-spinner" aria-hidden="true" /> Caricamento occupazione…
          </p>
        )}
        <div className="wm-actions">
          <button type="button" className="wm-btn wm-btn-small" onClick={() => void loadOcc()} disabled={occBusy} aria-busy={occBusy}>
            {occBusy ? "Aggiorno…" : "Aggiorna occupazione"}
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
      {reports && reports.length === 0 && (
        <p className="wm-empty">Nessuna riga candidata alla rimozione.</p>
      )}
      {reports && reports.length > 0 && (
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
                  <td className="wm-num">{r.matched.toLocaleString()}</td>
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
  const [listBusy, setListBusy] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Quando compare la conferma inline il focus va sul pulsante di conferma (una sola
  // volta, alla comparsa): l'admin conferma o annulla senza cercare col mouse.
  useEffect(() => {
    if (confirmId) confirmBtnRef.current?.focus();
  }, [confirmId]);

  const criterio = useCallback((): BroadcastCriterio => {
    const c: BroadcastCriterio = {};
    if (tuttiRegistrati) c.all = true;
    if (minPartite.trim() !== "") c.minPartite = Math.max(0, Number(minPartite) || 0);
    return c;
  }, [tuttiRegistrati, minPartite]);

  const refresh = useCallback(async () => {
    setListBusy(true);
    try {
      const r = await admin.listBroadcasts();
      setItems(r.items);
    } catch {
      /* elenco best-effort */
    } finally {
      setListBusy(false);
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
      setSentNotice(null);
      try {
        const res = await admin.sendBroadcast(id);
        setConfirmId(null);
        setSentNotice(
          `Invio avviato: ${res.queued} destinatari in coda. Le email partono in automatico ` +
            "rispettando la quota giornaliera; se la superano, l'invio si completerà in più giorni.",
        );
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
      {sentNotice && (
        <p className="wm-success" role="status" aria-live="polite">{sentNotice}</p>
      )}
      {preview && (
        <div className="wm-quota" role="status" aria-live="polite">
          <div className="wm-quota-row">
            <span className="wm-quota-label">Destinatari stimati</span>
            <span className="wm-quota-value">{preview.count.toLocaleString()}</span>
          </div>
          {preview.sample && preview.sample.length > 0 && (
            <p className="wm-muted wm-quota-sample">Esempi: {preview.sample.join(", ")}</p>
          )}
          <div className="wm-quota-row">
            <span className="wm-quota-label">Quota di oggi</span>
            <span className={preview.quotaSufficiente ? "wm-badge" : "wm-badge wm-badge-alert"}>
              {preview.quotaRemaining.toLocaleString()}/{preview.quotaCap.toLocaleString()}
            </span>
          </div>
          {preview.id && <p className="wm-muted">Bozza creata: pronta per l&apos;invio dall&apos;elenco qui sotto.</p>}
          {preview.quotaSufficiente ? (
            <p className="wm-muted">La quota di oggi copre tutti i destinatari.</p>
          ) : (
            <p className="wm-warn" role="alert">
              I destinatari superano la quota di oggi: nessuno andrà perso. L&apos;invio partirà entro la quota
              odierna e si completerà automaticamente in più giorni.
            </p>
          )}
        </div>
      )}

      <h3 className="wm-h3">Comunicazioni recenti</h3>
      {listBusy ? (
        <p className="wm-loading" role="status">
          <span className="wm-spinner" aria-hidden="true" /> Caricamento comunicazioni…
        </p>
      ) : items.length === 0 ? (
        <p className="wm-empty">Nessuna comunicazione creata finora.</p>
      ) : (
        <ul className="wm-list">
          {items.map((b) => (
            <li key={b.id} className="wm-list-row">
              <span className="wm-list-main">
                <strong>{b.oggetto}</strong>
                <span className="wm-list-meta">
                  <span className="wm-tag">{b.tipo}</span>
                  <span className="wm-tag">{b.stato}</span>
                  <span className="wm-muted">
                    in coda {b.recipients.inCoda}, inviati {b.recipients.inviato}, errori {b.recipients.errore},
                    saltati {b.recipients.saltato}
                  </span>
                </span>
              </span>
              {(b.stato === "bozza" || b.recipients.inCoda > 0) &&
                (confirmId === b.id ? (
                  <span className="wm-confirm" role="group" aria-label={`Conferma invio di ${b.oggetto}`}>
                    <span className="wm-confirm-text">
                      Invio irreversibile a {b.recipients.inCoda || b.recipients.inviato || "molti"} destinatari. Confermi?
                    </span>
                    <span className="wm-confirm-actions">
                      <button
                        type="button"
                        className="wm-btn wm-btn-small wm-btn-danger"
                        onClick={() => void send(b.id)}
                        disabled={busy}
                        aria-busy={busy}
                        ref={confirmBtnRef}
                      >
                        {busy ? "Invio…" : "Sì, invia ora"}
                      </button>
                      <button type="button" className="wm-btn wm-btn-small" onClick={() => setConfirmId(null)} disabled={busy}>
                        Annulla
                      </button>
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="wm-btn wm-btn-small"
                    onClick={() => {
                      setSentNotice(null);
                      setConfirmId(b.id);
                    }}
                    disabled={busy}
                  >
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
      <p className="wm-note">
        <span className="wm-note-badge">Predisposizione</span>
        È possibile inserire ed elencare eventi; i prodotti si creano, modificano ed eliminano, con foto e anteprima
        della scheda. La vetrina pubblica, le iscrizioni ai tornei e il carrello/pagamento dello shop non sono attivi
        in questo ciclo.
      </p>
      <div className="wm-catalog-grid">
        <EventiSection />
        <ShopSection />
      </div>
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
  const [listBusy, setListBusy] = useState(true);

  const refresh = useCallback(async () => {
    setListBusy(true);
    try {
      const r = await admin.listEvents();
      setItems(r.items);
    } catch {
      /* best-effort */
    } finally {
      setListBusy(false);
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
      {listBusy ? (
        <p className="wm-loading" role="status">
          <span className="wm-spinner" aria-hidden="true" /> Caricamento eventi…
        </p>
      ) : items.length === 0 ? (
        <p className="wm-empty">Nessun evento inserito. Compila il form qui sopra per aggiungerne uno.</p>
      ) : (
        <ul className="wm-list">
          {items.map((ev) => (
            <li key={ev.id} className="wm-list-row">
              <span className="wm-list-main">
                <strong>{ev.titolo}</strong>
                <span className="wm-list-meta">
                  {ev.luogo && <span className="wm-muted">{ev.luogo}</span>}
                  <span className="wm-muted">{new Date(ev.inizioAt).toLocaleString()}</span>
                  <span className={ev.pubblicato ? "wm-tag wm-tag-live" : "wm-tag"}>
                    {ev.pubblicato ? "pubblicato" : "bozza"}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Foto della scheda prodotto: ritagliata e ridimensionata dal browser a 800×600 (4:3). */
const PRODUCT_IMG_W = 800;
const PRODUCT_IMG_H = 600;
/** Tetto del data URL, sotto il limite del backend (400.000 caratteri). */
const PRODUCT_IMG_MAX_CHARS = 380_000;

const fmtPrezzo = (cent: number, valuta: string) =>
  `${(cent / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${valuta}`;

/** Scheda prodotto come apparirà nella vetrina: usata sia in elenco sia come anteprima del form. */
function ProductCard({
  nome,
  descrizione,
  prezzoCent,
  valuta,
  immagineUrl,
  disponibile,
  children,
}: {
  nome: string;
  descrizione: string | null;
  prezzoCent: number;
  valuta: string;
  immagineUrl: string | null;
  disponibile: boolean;
  children?: ReactNode;
}) {
  return (
    <article className="wm-product-card">
      <div className="wm-product-img">
        {immagineUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL: nessuna ottimizzazione Next applicabile
          <img src={immagineUrl} alt={`Foto di ${nome || "prodotto"}`} />
        ) : (
          <span className="wm-product-noimg">Nessuna foto</span>
        )}
      </div>
      <div className="wm-product-body">
        <strong className="wm-product-name">{nome || "Nome prodotto"}</strong>
        <span className="wm-product-price">{fmtPrezzo(prezzoCent, valuta)}</span>
        {descrizione && <p className="wm-product-desc">{descrizione}</p>}
        <span className={disponibile ? "wm-tag wm-tag-live" : "wm-tag"}>
          {disponibile ? "disponibile" : "non disponibile"}
        </span>
        {children}
      </div>
    </article>
  );
}

function ShopSection() {
  const [items, setItems] = useState<ShopProductRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [prezzo, setPrezzo] = useState(""); // in euro, convertito in centesimi
  const [descrizione, setDescrizione] = useState("");
  const [disponibile, setDisponibile] = useState(true);
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nomeRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmDeleteId) confirmBtnRef.current?.focus();
  }, [confirmDeleteId]);

  const refresh = useCallback(async () => {
    setListBusy(true);
    try {
      const r = await admin.listShopProducts();
      setItems(r.items);
    } catch {
      /* best-effort */
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const prezzoCent = (() => {
    const euro = Number(prezzo.replace(",", "."));
    return Number.isFinite(euro) ? Math.max(0, Math.round(euro * 100)) : 0;
  })();

  const resetForm = useCallback(() => {
    setEditingId(null);
    setNome("");
    setPrezzo("");
    setDescrizione("");
    setDisponibile(true);
    setFoto(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const startEdit = useCallback((p: ShopProductRow) => {
    setEditingId(p.id);
    setNome(p.nome);
    setPrezzo((p.prezzoCent / 100).toFixed(2).replace(".", ","));
    setDescrizione(p.descrizione ?? "");
    setDisponibile(p.disponibile);
    setFoto(p.immagineUrl);
    setError(null);
    setNotice(null);
    setConfirmDeleteId(null);
    if (fileRef.current) fileRef.current.value = "";
    nomeRef.current?.focus();
    nomeRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const onPickFoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setFotoBusy(true);
    setError(null);
    try {
      setFoto(await resizeImageToDataUrl(file, PRODUCT_IMG_W, PRODUCT_IMG_H, { maxChars: PRODUCT_IMG_MAX_CHARS }));
    } catch (err) {
      setError(err instanceof ImageError ? err.message : "Impossibile elaborare la foto.");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setFotoBusy(false);
    }
  }, []);

  const save = useCallback(async () => {
    if (!nome.trim()) {
      setError("Il nome del prodotto è obbligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const desc = descrizione.trim();
      if (editingId) {
        await admin.updateShopProduct(editingId, {
          nome,
          prezzoCent,
          descrizione: desc || null,
          immagineUrl: foto,
          disponibile,
        });
        setNotice("Prodotto aggiornato.");
      } else {
        await admin.createShopProduct({
          nome,
          prezzoCent,
          descrizione: desc || undefined,
          immagineUrl: foto ?? undefined,
          disponibile,
        });
        setNotice("Prodotto creato.");
      }
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Errore nel salvataggio del prodotto.");
    } finally {
      setBusy(false);
    }
  }, [nome, prezzoCent, descrizione, foto, disponibile, editingId, resetForm, refresh]);

  const remove = useCallback(
    async (p: ShopProductRow) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await admin.deleteShopProduct(p.id);
        setConfirmDeleteId(null);
        if (editingId === p.id) resetForm();
        setNotice(`Prodotto "${p.nome}" eliminato.`);
        await refresh();
      } catch (err) {
        setError(err instanceof AdminError ? err.message : "Errore nella cancellazione del prodotto.");
      } finally {
        setBusy(false);
      }
    },
    [editingId, resetForm, refresh],
  );

  return (
    <section className="wm-card" aria-label="Prodotti shop">
      <h2 className="wm-h2">Shop (prodotti)</h2>
      <h3 className="wm-h3">{editingId ? "Modifica prodotto" : "Nuovo prodotto"}</h3>
      <div className="wm-field">
        <label htmlFor="wm-sp-nome">Nome</label>
        <input id="wm-sp-nome" ref={nomeRef} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-sp-prezzo">Prezzo (EUR)</label>
        <input id="wm-sp-prezzo" inputMode="decimal" value={prezzo} onChange={(e) => setPrezzo(e.target.value)} placeholder="es. 12,50" />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-sp-desc">Descrizione</label>
        <textarea
          id="wm-sp-desc"
          value={descrizione}
          onChange={(e) => setDescrizione(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </div>
      <div className="wm-field">
        <label htmlFor="wm-sp-foto">Foto</label>
        <input
          id="wm-sp-foto"
          ref={fileRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          onChange={(e) => void onPickFoto(e.target.files?.[0])}
          disabled={fotoBusy || busy}
          aria-describedby="wm-sp-foto-hint"
        />
        <p id="wm-sp-foto-hint" className="wm-muted wm-hint">
          Dimensioni consigliate: <strong>800 × 600 px</strong> (formato orizzontale 4:3), JPG, PNG o WebP, fino a
          15 MB. La foto viene ritagliata al centro e ridotta automaticamente a 800 × 600 px.
        </p>
        {fotoBusy && (
          <p className="wm-loading" role="status">
            <span className="wm-spinner" aria-hidden="true" /> Elaborazione della foto…
          </p>
        )}
        {foto && !fotoBusy && (
          <div className="wm-actions">
            <button
              type="button"
              className="wm-btn wm-btn-small"
              onClick={() => {
                setFoto(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              disabled={busy}
            >
              Rimuovi foto
            </button>
          </div>
        )}
      </div>
      <label className="wm-check">
        <input type="checkbox" checked={disponibile} onChange={(e) => setDisponibile(e.target.checked)} />
        Disponibile
      </label>

      <h3 className="wm-h3">Anteprima della scheda</h3>
      <div className="wm-product-preview">
        <ProductCard
          nome={nome.trim()}
          descrizione={descrizione.trim() || null}
          prezzoCent={prezzoCent}
          valuta="EUR"
          immagineUrl={foto}
          disponibile={disponibile}
        />
      </div>

      <div className="wm-actions">
        <button type="button" className="wm-btn wm-btn-primary" onClick={() => void save()} disabled={busy || fotoBusy || !nome.trim()}>
          {busy ? "Salvo…" : editingId ? "Salva modifiche" : "Aggiungi prodotto"}
        </button>
        {editingId && (
          <button type="button" className="wm-btn" onClick={resetForm} disabled={busy}>
            Annulla modifica
          </button>
        )}
      </div>
      {error && <p className="wm-alert" role="alert">{error}</p>}
      {notice && <p className="wm-success" role="status" aria-live="polite">{notice}</p>}

      <h3 className="wm-h3">Prodotti inseriti</h3>
      {listBusy ? (
        <p className="wm-loading" role="status">
          <span className="wm-spinner" aria-hidden="true" /> Caricamento prodotti…
        </p>
      ) : items.length === 0 ? (
        <p className="wm-empty">Nessun prodotto inserito. Compila il form qui sopra per aggiungerne uno.</p>
      ) : (
        <div className="wm-product-grid">
          {items.map((p) => (
            <ProductCard
              key={p.id}
              nome={p.nome}
              descrizione={p.descrizione}
              prezzoCent={p.prezzoCent}
              valuta={p.valuta}
              immagineUrl={p.immagineUrl}
              disponibile={p.disponibile}
            >
              {confirmDeleteId === p.id ? (
                <span className="wm-confirm" role="group" aria-label={`Conferma eliminazione di ${p.nome}`}>
                  <span className="wm-confirm-text">Eliminazione irreversibile. Confermi?</span>
                  <span className="wm-confirm-actions">
                    <button
                      type="button"
                      className="wm-btn wm-btn-small wm-btn-danger"
                      onClick={() => void remove(p)}
                      disabled={busy}
                      aria-busy={busy}
                      ref={confirmBtnRef}
                    >
                      {busy ? "Elimino…" : "Sì, elimina"}
                    </button>
                    <button type="button" className="wm-btn wm-btn-small" onClick={() => setConfirmDeleteId(null)} disabled={busy}>
                      Annulla
                    </button>
                  </span>
                </span>
              ) : (
                <span className="wm-row-actions">
                  <button
                    type="button"
                    className="wm-btn wm-btn-small"
                    onClick={() => startEdit(p)}
                    disabled={busy}
                    aria-label={`Modifica ${p.nome}`}
                  >
                    Modifica
                  </button>
                  <button
                    type="button"
                    className="wm-btn wm-btn-small wm-btn-danger"
                    onClick={() => setConfirmDeleteId(p.id)}
                    disabled={busy}
                    aria-label={`Elimina ${p.nome}`}
                  >
                    Elimina
                  </button>
                </span>
              )}
            </ProductCard>
          ))}
        </div>
      )}
    </section>
  );
}
