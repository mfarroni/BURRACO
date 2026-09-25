"use client";

import { useEffect, useRef, useState } from "react";
import type { Card, SeatPublic, TeamId } from "@/lib/contract";
import { useGameSocket, type TableMode } from "@/lib/useGameSocket";
import { useAuth } from "@/lib/useAuth";
import { useServiceHealth } from "@/lib/useServiceHealth";
import { getAuthToken } from "@/lib/auth";
import { useIsAdmin } from "@/lib/admin";
import { useLobbyList, useLeaveOnPageHide } from "@/lib/lobby";
import { captureInviteCode, clearInviteCode } from "@/lib/tableInvite";
import { AuthPanel, type AuthMode } from "@/components/AuthPanel";
import { Landing } from "@/components/Landing";
import { Lobby } from "@/components/Lobby";
import { OpenTableModal } from "@/components/OpenTableModal";
import { WaitingRoom } from "@/components/WaitingRoom";
import { ProfilePanel } from "@/components/ProfilePanel";
import { BottomHand } from "@/components/BottomHand";
import { CardView } from "@/components/CardView";
import { Melds } from "@/components/Melds";
import { SeatPost } from "@/components/SeatPost";
import { useTableAvatars } from "@/lib/useTableAvatars";
import { ActionBar } from "@/components/ActionBar";
import {
  ConfirmDialog,
  GameEndedOverlay,
  HandEndedOverlay,
  PendingBadge,
  RejectionToast,
  ResetTableButton,
  RoomClosedOverlay,
} from "@/components/Overlays";
import {
  Celebration,
  ConnectionBanner,
  Countdown,
  TurnBanner,
} from "@/components/StateBanners";
import { ConnectionScreen } from "@/components/ConnectionScreen";
import { WakeUpDialog } from "@/components/WakeUpNotice";
import { SideFlank } from "@/components/SideFlanks";
import { VetrinaBrandHeader } from "@/components/VetrinaBrandHeader";

export default function Page() {
  const g = useGameSocket();
  const auth = useAuth();
  // FASE 3 — disponibilità del backend: sonda /health con backoff. Serve a coprire
  // il cold start di Render e ogni deploy (= un riavvio).
  const health = useServiceHealth();
  // CICLO Pannello Admin — voce di menu admin via PROBE (D2): true solo se
  // GET /admin/ping risponde 200 (admin). Puro UX; l'autorità resta il 404 server-side.
  // Passiamo l'id utente come chiave: il probe si ri-esegue DOPO il login (senza, girerebbe
  // solo al mount, quando non c'è ancora un token, e il menu non comparirebbe mai).
  const isAdmin = useIsAdmin(auth.user?.id ?? null);
  // C'è un token salvato? (returning player). Letto client-side dopo il mount per
  // non toccare il render SSR. Solo per un token esistente ha senso bloccare
  // l'ingresso in attesa del backend: un visitatore nuovo vede subito la vetrina.
  const [hasSession, setHasSession] = useState(false);
  const reloadedRef = useRef(false);
  useEffect(() => {
    setHasSession(!!getAuthToken());
  }, []);
  // LINK D'INVITO `/?tavolo=CODICE` (proposta donazione/condivisione §5): letto una
  // volta al mount e tolto dall'indirizzo; precompila il campo codice in lobby.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  useEffect(() => {
    setInviteCode(captureInviteCode());
  }, []);
  const consumeInvite = () => {
    clearInviteCode();
    setInviteCode(null);
  };
  // Ingresso AUTOMATICO: quando il backend torna su e un token è ancora presente ma
  // il ripristino era finito in "anonimo" (per un'indisponibilità precedente),
  // ritenta /auth/me una sola volta così l'utente rientra senza ri-accedere.
  useEffect(() => {
    if (health.ready && hasSession && auth.status === "anonymous" && !reloadedRef.current) {
      reloadedRef.current = true;
      void auth.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health.ready, hasSession, auth.status]);

  // LOBBY: la lista dei tavoli pubblici + contatore viene dal polling HTTP,
  // attivo SOLO quando l'utente è autenticato e non ancora seduto a un tavolo.
  // Il polling funge anche da heartbeat di presenza in lobby (§6.2).
  const inLobby = auth.status === "authenticated" && !g.joined;
  const lobby = useLobbyList(inLobby);
  // Beacon di chiusura pulita del tavolo in ATTESA su pagehide (§5.4-B): attivo
  // solo quando si ha un tavolo in attesa (joined ma partita non ancora iniziata).
  useLeaveOnPageHide(g.joined && !g.state);
  // Foto dei giocatori ai posti: chieste solo a partita in corso, e di nuovo quando
  // cambia chi siede dove (non a ogni mossa).
  const rosterKey = g.state ? g.players.map((p) => `${p.seat}:${p.displayName}`).join("|") : "";
  const seatAvatars = useTableAvatars(g.state ? g.roomCode : null, rosterKey);

  // Ramo anonimo: la vetrina è la prima vista; `showAuth` apre l'AuthPanel sul
  // percorso scelto (login/register/guest) senza cambiare route (SPA).
  const [showAuth, setShowAuth] = useState<AuthMode | null>(null);
  // Vista Profilo (sola lettura) sovrapposta alla lobby autenticata.
  const [showProfile, setShowProfile] = useState(false);
  // Account appena eliminato dal suo titolare (R05): la vetrina lo conferma una volta.
  const [accountDeleted, setAccountDeleted] = useState(false);
  // Modale "Apri un tavolo" (door a). Aperta dalla lobby; chiusa a join riuscito.
  const [showOpenModal, setShowOpenModal] = useState(false);
  // MODALITÀ scelta in lobby (1v1/2v2): sorgente unica per "Gioca subito",
  // "Apri un tavolo" e per l'etichetta informativa nella modale. Default 1v1.
  const [tableMode, setTableMode] = useState<TableMode>({ numeroGiocatori: 2, modalita: "individuale" });
  // Ingresso diretto al tavolo per l'ospite con codice: la vetrina/AuthPanel
  // deposita qui il codice; l'effetto sotto lo consuma appena l'auth è pronta.
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);

  // Stato di SELEZIONE locale (nessuna regola: solo UI).
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null);
  // Ultimo tentativo di sostituzione della matta (meld + carta), memorizzato per
  // poter RIPETERE la mossa con la scelta cima/fondo quando il server risponde
  // WILD_EDGE_REQUIRED. Nessuna logica di regole: si conserva solo l'intenzione.
  const [wildAttempt, setWildAttempt] = useState<{ meldId: string; cardId: string } | null>(
    null,
  );
  // Conferma modale dell'annullamento partita (§5.1) — stato UI locale.
  const [confirmingAbort, setConfirmingAbort] = useState(false);

  // RICONCILIAZIONE della selezione a ogni nuovo stato del server (non azzeramento).
  // Le carte che restano in mano conservano la selezione; quelle uscite
  // (scartate/calate/cambio mano) la perdono. Il meld selezionato è riconciliato
  // SEPARATAMENTE contro i giochi ancora sul tavolo.
  //
  // L'effetto dipende dalla FIRMA della mano e dei meld (stringhe di id stabili),
  // NON dal riferimento `g.state` (nuovo a ogni messaggio): così una mossa
  // dell'avversario che non tocca la composizione della mano non tocca la
  // selezione. Su una mossa RIFIUTATA non arriva stato -> nessun cambio di firma
  // -> selezione intatta (l'utente corregge).
  const handSig = g.state ? g.state.yourHand.map((c) => c.id).join(",") : "";
  const meldSig = g.state ? g.state.tableMelds.map((m) => m.id).join(",") : "";
  useEffect(() => {
    const st = g.state;
    if (!st) return; // nessuno stato ancora (o mossa rifiutata): non toccare la selezione
    const handIds = new Set(st.yourHand.map((c) => c.id));
    setSelectedCards((prev) => {
      const next = prev.filter((id) => handIds.has(id));
      return next.length === prev.length ? prev : next; // preserva l'identità se nulla cambia
    });
    const meldIds = new Set(st.tableMelds.map((m) => m.id));
    setSelectedMeldId((prev) => (prev !== null && !meldIds.has(prev) ? null : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handSig, meldSig]);

  /* ── Celebrazioni effimere ──────────────────────────────────────────
   * Alimentate dagli eventi reali del server `pozzetto_taken` / `burraco_made`,
   * esposti dall'hook come `g.celebration` (già nella forma CelebrationInfo). */

  const toggleCard = (card: Card) => {
    setSelectedCards((prev) =>
      prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id],
    );
  };
  // Selezione a intervallo (Shift+click desktop): unione degli id passati
  // (già calcolati in ordine VISIVO dal componente mano). Nessuna regola: solo UI.
  const selectRange = (ids: string[]) => {
    setSelectedCards((prev) => {
      const set = new Set(prev);
      for (const id of ids) set.add(id);
      return set.size === prev.length ? prev : Array.from(set);
    });
  };
  const clearSelection = () => {
    setSelectedCards((prev) => (prev.length === 0 ? prev : []));
    setSelectedMeldId(null);
  };
  const toggleMeld = (meldId: string) => {
    setSelectedMeldId((prev) => (prev === meldId ? null : meldId));
  };

  // Esc = azzera la selezione ampia (alternativa da tastiera al chip "N selezionate").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── Ingresso diretto al tavolo (ospite con codice) ─────────────────────
   * Quando AuthPanel deposita un codice tavolo dopo un accesso Ospite riuscito,
   * appena l'auth è pronta e non siamo già seduti, entriamo dritti nel tavolo
   * saltando la lobby. La guardia `pendingRoom === null` + l'azzeramento
   * garantiscono UNA sola esecuzione (niente `g` nelle deps: è nuovo a ogni
   * render). Ospite SENZA codice non passa di qui: setPendingRoom non è invocato. */
  useEffect(() => {
    if (pendingRoom === null) return;
    if (auth.status !== "authenticated" || g.joined) return;
    g.join(pendingRoom, auth.user?.displayName ?? "");
    setPendingRoom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoom, auth.status, g.joined]);

  // LOBBY (§5.4-C): un tentativo di seduta fallito (ROOM_JUST_TAKEN) deve
  // rinfrescare subito la lista, così la sedia scomparsa sparisce dalla vista.
  useEffect(() => {
    if (g.sitRejected) lobby.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.sitRejected]);

  // A join riuscito la modale d'apertura non serve più (la schermata cambia).
  useEffect(() => {
    if (g.joined) setShowOpenModal(false);
  }, [g.joined]);

  /* ── Ritorno alla lobby: azzera lo stato locale del tavolo (§5.4) ──────────
   * Quando non si è più seduti (annullamento, chiusura, uscita) le selezioni locali
   * non devono riemergere alla partita successiva. */
  useEffect(() => {
    if (!g.joined) {
      setSelectedCards((prev) => (prev.length === 0 ? prev : []));
      setSelectedMeldId(null);
    }
  }, [g.joined]);

  /* ── Backend non ancora disponibile (cold start / deploy) ──────────────
   * Solo per chi ha una sessione salvata (returning player): lo teniamo su una
   * schermata di connessione con riprova automatica finché /health non risponde,
   * poi rientra da solo. Un visitatore nuovo (nessun token) NON è bloccato: vede
   * subito la vetrina, e il suo /auth/me non fa nemmeno rete (nessun token). */
  if (hasSession && !health.ready) {
    return <ConnectionScreen elapsedMs={health.elapsedMs} />;
  }

  /* ── Ripristino sessione in corso ──────────────────────────────────── */
  if (auth.status === "initializing") {
    return (
      <div className="lobby">
        <div className="brand">
          <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
          <h1>Burraco</h1>
          <p className="tagline" role="status">Ripristino della sessione…</p>
        </div>
      </div>
    );
  }

  /* ── Non autenticato → vetrina d'accesso, poi AuthPanel sul percorso scelto ─
   * La vetrina è la prima vista (fedele al mockup vintage-lusso). I tre bottoni
   * NON navigano a route: impostano `showAuth`, che apre l'AuthPanel sul percorso
   * corrispondente. `onBack` riporta alla vetrina senza toccare lo stato auth. */
  if (auth.status === "anonymous") {
    // Server che si sta svegliando (cold start di Render free, decisione del lead):
    // il pannello resta visibile ma inerte, e una finestra spiega l'attesa invece di
    // lasciar scadere la richiesta con "Tempo scaduto". Si chiude da sola a server su.
    // Mostrata dopo 1s per non lampeggiare quando il server è già sveglio.
    const waking = !health.ready;
    return showAuth ? (
      <>
        <div inert={waking}>
          <AuthPanel
            auth={auth}
            initialMode={showAuth}
            onBack={() => setShowAuth(null)}
            onRequestTable={setPendingRoom}
          />
        </div>
        {waking && health.elapsedMs >= 1000 && <WakeUpDialog elapsedMs={health.elapsedMs} />}
      </>
    ) : (
      <Landing
        onOpenAuth={(mode) => {
          setAccountDeleted(false);
          setShowAuth(mode);
        }}
        inviteCode={inviteCode}
        notice={accountDeleted ? "Il tuo account è stato eliminato insieme ai tuoi dati. Grazie di aver giocato al circolo." : null}
      />
    );
  }

  /* ── Profilo (sola lettura), raggiungibile dalla lobby autenticata ──── */
  if (!g.joined && showProfile && auth.user) {
    return (
      <ProfilePanel
        user={auth.user}
        onBack={() => setShowProfile(false)}
        onAccountDeleted={() => {
          setShowProfile(false);
          setShowAuth(null);
          setAccountDeleted(true);
          void auth.logout();
        }}
      />
    );
  }

  /* ── Autenticato ma non ancora al tavolo → LOBBY (lista + azioni) ────── */
  if (!g.joined) {
    const connecting = g.connPhase === "connecting" || g.connPhase === "reconnecting";
    const displayName = auth.user?.displayName?.trim() || auth.user?.email?.split("@")[0] || "Utente";
    const name = displayName;
    return (
      <div className="page-3col-wrapper lobby-3col-wrapper">
        <SideFlank side="left" />
        <main className="central-column-card lobby lobby-wide">
          <VetrinaBrandHeader title="Burraco" subtitle="Il tavolo del circolo, uno contro uno o a coppie." />

          {/* Identità corrente + logout. */}
          <div className="whoami">
            <span className="muted">
              Sei entrato come <strong>{displayName}</strong>
              {auth.user?.isGuest ? " (ospite)" : ""}
            </span>
            <button type="button" className="btn-ghost" onClick={() => setShowProfile(true)}>
              Profilo
            </button>
            {/* CICLO Pannello Admin — voce di menu SOLO per admin (probe /admin/ping).
                Additiva e condizionale: non altera il layout per i non-admin. */}
            {isAdmin && (
              <a className="btn-ghost" href="/webmaster">
                Admin
              </a>
            )}
            <button type="button" className="btn-ghost" onClick={() => auth.logout()} disabled={auth.busy}>
              Esci
            </button>
          </div>

        {/* Avviso NON bloccante di partita annullata (§5.4): tono neutro, scartabile. */}
        {g.abortedNotice && (
          <div className="banner" role="status" aria-live="polite">
            <span className="banner-body">
              <span className="banner-title">Partita annullata</span>
              <span className="banner-sub">
                La partita è stata annullata da <strong>{g.abortedNotice.byName}</strong>.
              </span>
            </span>
            <button type="button" className="btn-ghost" onClick={g.dismissAbortNotice}>
              Ho capito
            </button>
          </div>
        )}

        <Lobby
          tables={lobby.tables}
          lobbyPlayers={lobby.lobbyPlayers}
          status={lobby.status}
          connecting={connecting}
          sitRejected={g.sitRejected}
          onDismissSitRejected={g.dismissSitRejected}
          mode={tableMode}
          onChangeMode={setTableMode}
          onQuickMatch={() => {
            g.dismissJoinRejected();
            g.quickMatch(name, tableMode);
          }}
          onOpenTable={() => {
            g.dismissJoinRejected();
            g.dismissOpenRejected();
            setShowOpenModal(true);
          }}
          onSit={(code) => {
            g.dismissJoinRejected();
            g.sit(code, name);
          }}
          onJoinByCode={(code) => {
            g.dismissJoinRejected();
            g.join(code, name);
          }}
          onAbort={g.abortConnection}
          inviteCode={inviteCode}
          onInviteConsumed={consumeInvite}
        />

        {/* SEC-08: ingresso negato per autenticazione (token mancante/scaduto).
            Tono AMBRA (non rosso): non è una colpa dell'utente. Per la sessione
            scaduta offriamo l'azione diretta riusando il logout già cablato. */}
        {g.joinRejected && (
          g.joinRejected.code === "AUTH_INVALID" ? (
            <div className="banner auth-notice" data-tone="warn" role="alert">
              <span className="banner-icon" aria-hidden="true">⏱</span>
              <span className="banner-body">
                <span className="banner-title">La sessione è scaduta</span>
                <span className="banner-sub">
                  Per sicurezza le sessioni non durano all&apos;infinito. Rientra e sei subito
                  di nuovo al tavolo.
                </span>
              </span>
              <button type="button" className="btn-ghost" onClick={() => auth.logout()} disabled={auth.busy}>
                Esci e accedi
              </button>
            </div>
          ) : (
            <p role="alert" className="auth-error">
              <span className="auth-error-icon" aria-hidden="true">!</span>
              <span>{g.joinRejected.reason}</span>
            </p>
          )
        )}
        {/* Errore di connessione/config (SEC-09) mostrato solo fuori dalla modale
            (dentro la modale ha il suo slot inline). */}
        {g.errorMessage && !showOpenModal && (
          <p role="alert" className="auth-error">
            <span className="auth-error-icon" aria-hidden="true">!</span>
            <span>{g.errorMessage}</span>
          </p>
        )}

        {showOpenModal && (
          <OpenTableModal
            mode={tableMode}
            openRejected={g.openRejected}
            errorMessage={g.errorMessage}
            onDismissRejected={g.dismissOpenRejected}
            onConfirm={(code, isPrivate) => g.openTable(code, isPrivate, name, tableMode)}
            onCancel={() => {
              setShowOpenModal(false);
              g.abortConnection();
            }}
          />
        )}
        </main>
        <SideFlank side="right" />
      </div>
    );
  }

  /* ── Tavolo chiuso (terminale, senza vincitore): reset o abbandono ──── */
  if (g.roomClosed) {
    return (
      <div className="game">
        <RoomClosedOverlay info={g.roomClosed} onLeave={() => window.location.reload()} />
      </div>
    );
  }

  /* ── In attesa dell'avversario (nessuno stato di gioco ancora) ─────── */
  if (!g.state) {
    return (
      <WaitingRoom
        code={g.roomCode ?? ""}
        isPrivate={g.waitingIsPrivate}
        connPhase={g.connPhase}
        resumed={g.resumed}
        merged={g.merged}
        onCancel={g.leaveToLobby}
        seatsTotal={g.config?.numeroGiocatori ?? 2}
        modalita={g.config?.modalita}
        players={g.players}
        yourSeat={g.yourSeat}
      />
    );
  }

  /* ── Partita ───────────────────────────────────────────────────────── */
  const s = g.state;
  const you = g.yourSeat ?? 0;
  // Numero di postazioni del tavolo: 2 (1v1) o 4 (coppie). Guida `data-seats` e il
  // ramo delle targhe. In 1v1 `is2v2` è false → resa identica a prima.
  const seatsTotal = g.config?.numeroGiocatori ?? 2;
  const is2v2 = seatsTotal === 4;

  // C3/C4: lo stato porta `seats[]` (conteggio per posto) e `scores[]` PER SQUADRA.
  const mySeatView = s.seats.find((x) => x.seat === you);
  const youTeam = mySeatView?.team ?? you;
  // Squadra avversaria: l'ALTRA fra le (esattamente due) squadre al tavolo.
  const otherTeam =
    s.seats.map((x) => x.team).find((t) => t !== youTeam) ?? (youTeam === 0 ? 1 : 0);

  const isMyTurn = s.whoseTurn === g.yourSeat;
  // Nome del giocatore ATTIVO (whoseTurn): in 1v1, fuori dal tuo turno, è l'avversario.
  const activePlayer = g.players.find((p) => p.seat === s.whoseTurn);
  const activeName = activePlayer?.displayName ?? "Avversario";

  // Riferimenti all'UNICO avversario 1v1 (usati SOLO nel ramo a 2 posti, invariato).
  const oppSeatView = s.seats.find((x) => x.seat !== you);
  const opponentHandCount = oppSeatView?.handCount ?? 0;
  const opponent = g.players.find((p) => p.seat !== g.yourSeat);
  const opponentName = opponent?.displayName ?? "Avversario";
  const opponentConnected = opponent?.connectionStatus !== "disconnected";

  // Posti "altri" per le targhe a 4 postazioni. Il COMPAGNO è l'altro posto della
  // TUA squadra (server-driven via `team`, mai dedotto dal posto, P4); gli avversari
  // sono i due posti dell'altra squadra, disposti a Ovest/Est per offset orario.
  const otherSeatViews = s.seats.filter((x) => x.seat !== you);
  const partnerView = is2v2 ? otherSeatViews.find((x) => x.team === youTeam) : undefined;
  const relOffset = (seat: number) => (seat - you + seatsTotal) % seatsTotal;
  const opponentViews = is2v2
    ? otherSeatViews.filter((x) => x.team !== youTeam).sort((a, b) => relOffset(a.seat) - relOffset(b.seat))
    : [];
  const westView = opponentViews[0]; // offset 1 (giro orario)
  const eastView = opponentViews[1]; // offset 3

  // Punteggi per SQUADRA. 1v1 conserva "Tu / <avversario>"; 2v2 usa "Noi / Loro".
  const youScoreLabel = is2v2 ? "Noi" : "Tu";
  const oppScoreLabel = is2v2 ? "Loro" : opponentName;
  const youScore = s.scores[youTeam] ?? 0;
  const oppScore = s.scores[otherTeam] ?? 0;

  // 2v2: qualsiasi ALTRO posto (compagno o avversario) può essere offline.
  const disconnectedOthers = is2v2
    ? g.players.filter((p) => p.seat !== you && p.connectionStatus === "disconnected")
    : [];

  // Distinzione di squadra per i Melds (P4): server-driven via `ownerTeam`, mai per
  // posto. In 1v1 `youTeam === yourSeat`, quindi il raggruppamento "Noi/Loro" è identico.
  const teamOf = (team: TeamId): "us" | "them" => (team === youTeam ? "us" : "them");

  // Burraco per SQUADRA, derivati dai giochi già in `state.tableMelds` (campi
  // `ownerTeam` e `isBurraco` del contratto). Nessun dato nuovo dal server: il
  // client conta ciò che il server ha già redatto, non applica regole.
  const burracoByTeam = (team: TeamId): number =>
    s.tableMelds.filter((m) => m.ownerTeam === team && m.isBurraco).length;

  // Post di un posto "altro" (compagno/avversario) a 4 postazioni.
  const renderOtherPost = (
    view: SeatPublic | undefined,
    area: string,
    teamKind: "us" | "them",
    role: string,
  ) => {
    if (!view) return null;
    const player = g.players.find((p) => p.seat === view.seat);
    return (
      <SeatPost
        area={area}
        team={teamKind}
        role={role}
        name={player?.displayName ?? `Giocatore ${view.seat + 1}`}
        handCount={view.handCount}
        active={s.whoseTurn === view.seat}
        connected={view.connectionStatus !== "disconnected"}
        avatarUrl={seatAvatars[view.seat] ?? null}
        burracoCount={burracoByTeam(view.team)}
      />
    );
  };

  const phaseHint =
    s.phase === "must_draw" ? "Pesca dal mazzo o dallo scarto." : "Cala i tuoi giochi, poi scarta per concludere.";

  // Deadline del turno per il countdown VISIVO (v1: sempre null → nessun countdown).
  const turnEndsAt = s.turnEndsAt;

  return (
    <div className="game">
      <Celebration info={g.celebration} />
      <RejectionToast rejection={g.rejection} onDismiss={g.dismissRejection} />
      {/* Fallback globale quando il pending non è agganciato a una carta. */}
      {g.pending && !g.inFlightCardId && <PendingBadge pending />}
      <HandEndedOverlay info={g.handEnded} players={g.players} yourSeat={g.yourSeat} />
      <GameEndedOverlay info={g.gameEnded} players={g.players} yourSeat={g.yourSeat} config={g.config} />
      <RoomClosedOverlay info={g.roomClosed} onLeave={() => window.location.reload()} />

      {/* Conferma modale dell'annullamento (§5.1): riusa il markup delle modali
          esistenti (focus trap, Esc/sfondo = annulla). Solo la conferma invia game_abort. */}
      {confirmingAbort && (
        <ConfirmDialog
          title="Annullare la partita?"
          body="La partita verrà chiusa per entrambi i giocatori e non conterà nelle statistiche."
          confirmLabel="Annulla partita"
          cancelLabel="Continua a giocare"
          onConfirm={() => {
            setConfirmingAbort(false);
            g.abort();
          }}
          onCancel={() => setConfirmingAbort(false)}
        />
      )}

      {/* Self-play (§5.4-D): avviso NON bloccante, i due posti sono lo stesso
          browser/utente. La partita è esclusa dalle statistiche (lato server). */}
      {g.selfPlay && (
        <div className="banner" data-tone="info" role="status" aria-live="polite">
          <span className="banner-icon" aria-hidden="true">⚑</span>
          <span className="banner-body">
            <span className="banner-title">Stai giocando contro te stesso</span>
            <span className="banner-sub">Questa partita non conterà nelle statistiche.</span>
          </span>
          <button type="button" className="toast-close" onClick={g.dismissSelfPlay} aria-label="Chiudi avviso">
            ×
          </button>
        </div>
      )}

      {/* Avversario offline (1v1): rientro in corso entro la finestra di grazia; nel
          frattempo è possibile terminare il tavolo (annulla la partita). */}
      {!is2v2 && !opponentConnected && (
        <div className="banner" data-tone="warn" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="banner-body">
            <span className="banner-title">{opponentName} ha perso la connessione</span>
            <span className="banner-sub">
              Rientro in corso: ha qualche minuto per riconnettersi e riprendere la partita. Puoi
              aspettarlo oppure terminare il tavolo.
            </span>
          </span>
          <ResetTableButton onReset={g.resetRoom} context="opponent-offline" />
        </div>
      )}

      {/* Posto offline (2v2): può essere compagno O avversario. Banner informativo;
          il server gestisce grazia/forfait. Per terminare si usa "Annulla partita"
          (sempre disponibile in alto). Resa funzionale: la rifinitura è di Fase 4. */}
      {is2v2 && disconnectedOthers.length > 0 && (
        <div className="banner" data-tone="warn" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="banner-body">
            <span className="banner-title">
              {disconnectedOthers.map((p) => p.displayName).join(", ")}
              {disconnectedOthers.length === 1 ? " ha perso la connessione" : " hanno perso la connessione"}
            </span>
            <span className="banner-sub">
              Rientro in corso: qualche minuto per riconnettersi e riprendere la partita.
            </span>
          </span>
        </div>
      )}

      {/* ── Header / Scoreboard ───────────────────────────────────────── */}
      <div className="topbar">
        <div className="status-line">
          <span className="badge" data-turn={isMyTurn ? "mine" : "theirs"}>
            <span className="dot" aria-hidden="true" />
            {isMyTurn ? "Tocca a te" : `Turno di ${activeName}`}
          </span>
          {isMyTurn && turnEndsAt !== null && <Countdown turnEndsAt={turnEndsAt} />}
          {/* 1v1: stato dell'unico avversario nell'header. A 4 postazioni l'informazione
              per-giocatore vive sulle targhe attorno al tavolo (nome/conteggio/turno/offline). */}
          {/* Annulla partita (§5.1): azione discreta nell'area comandi in alto, MAI
              accanto a presa/scarto (che vivono nella barra in basso). Sempre
              disponibile durante la partita. Apre una conferma modale. */}
          <button
            type="button"
            className="btn-ghost"
            style={{ marginLeft: "auto" }}
            onClick={() => setConfirmingAbort(true)}
            aria-haspopup="dialog"
          >
            Annulla partita
          </button>
        </div>
        <div className="scoreboard">
          <div className="chip you">
            <span className="lbl">{youScoreLabel}</span>
            <span className="val">{youScore}</span>
          </div>
          <span className="vs" aria-hidden="true">/</span>
          <div className="chip">
            <span className="lbl">{oppScoreLabel}</span>
            <span className="val">{oppScore}</span>
          </div>
          <div className="chip">
            <span className="lbl">Obiettivo</span>
            <span className="val">{g.config?.punteggioObiettivo ?? "—"}</span>
          </div>
        </div>
      </div>

      {/* Riconnessione propria + "stato ripristinato". */}
      <ConnectionBanner connPhase={g.connPhase} resumed={g.resumed} />

      {/* Turno + fase, in evidenza. `activeName` è il giocatore di mano (in 1v1 =
          avversario → testo identico a prima). */}
      <TurnBanner isMyTurn={isMyTurn} phaseHint={phaseHint} opponentName={activeName} />

      {/* Suggerimento "ruota il telefono": SOLO 2v2 e SOLO in portrait stretto
          (la visibilità è decisa dal CSS via media query). In portrait le 4
          postazioni non stanno affiancate (spec tavolo §5.2): il tavolo degrada
          a vista compatta e il landscape è la via maestra. Nessuna logica. */}
      {is2v2 && (
        <p className="rotate-hint" role="note">
          <span className="rotate-ic" aria-hidden="true">⟳</span>
          Ruota il telefono in orizzontale per la vista completa del tavolo.
        </p>
      )}

      {/* ── Tavolo: griglia a postazioni (data-seats), isola centrale FISSA ──
          1v1 (data-seats="2"): avversario a Nord, tu a Sud, isola al centro.
          2v2 (data-seats="4"): compagno a Nord, avversari a Ovest/Est (giro orario),
          tu a Sud; il CSS di data-seats="4" esiste già (aree north/west/east/south).
          Il client NON calcola regole: legge `state.seats[]` e la squadra dal server. */}
      <div className="table-frame">
      <div className="table-grid" data-seats={String(seatsTotal)}>
        {/* Postazione a Nord. 1v1: l'avversario ("Loro"). 2v2: il compagno ("Noi"). */}
        {!is2v2 ? (
          <SeatPost
            area="seat-north"
            team="them"
            role="Avversario"
            name={opponentName}
            handCount={opponentHandCount}
            active={!isMyTurn}
            connected={opponentConnected}
            avatarUrl={oppSeatView ? seatAvatars[oppSeatView.seat] ?? null : null}
            burracoCount={burracoByTeam(otherTeam)}
          />
        ) : (
          renderOtherPost(partnerView, "seat-north", "us", "Compagno · Nord")
        )}

        {/* 2v2: avversari a Ovest ed Est (squadra "Loro"), in senso di giro orario. */}
        {is2v2 && renderOtherPost(westView, "seat-west", "them", "Ovest")}
        {is2v2 && renderOtherPost(eastView, "seat-east", "them", "Est")}

        {/* Isola centrale FISSA: mazzo, monte scarti, (mano avversario 1v1), pozzetti. */}
        <div className="board-center">
          <div className="pile" data-actionable={isMyTurn && s.phase === "must_draw" ? "true" : "false"}>
            <div className="slot deck" aria-hidden="true">♣</div>
            <div className="num">{s.drawPileCount}</div>
            <div className="lbl">Mazzo</div>
          </div>

          <div className="pile" data-actionable={isMyTurn && s.phase === "must_draw" && s.discardCount > 0 ? "true" : "false"}>
            <div className="slot" style={{ background: "transparent", padding: 0 }}>
              {s.discardTop ? (
                <CardView card={s.discardTop} small />
              ) : (
                <span className="slot empty">vuoto</span>
              )}
            </div>
            <div className="num">{s.discardCount}</div>
            <div className="lbl">Monte scarti</div>
          </div>

          {/* Il conteggio della mano avversaria vive ora nel post del giocatore
              (una sola fonte per posto, a 2 come a 4 postazioni). */}

          <div className="pile">
            <div className="pozzetti" aria-hidden="true">
              {[0, 1].map((i) => (
                <span key={i} className="pozzetto-mini" data-taken={i >= s.pozzettiRemaining ? "true" : "false"} />
              ))}
            </div>
            <div className="num">{s.pozzettiRemaining}</div>
            <div className="lbl">Pozzetti</div>
          </div>

          <div className="pile">
            <div className="num" style={{ fontSize: "1rem" }}>{s.yourPozzettoTaken ? "Preso ✓" : "Non ancora"}</div>
            <div className="lbl">Il tuo pozzetto</div>
          </div>
        </div>

        {/* ── Giochi calati, per SQUADRA (loro a Nord, nostri a Sud) ─────── */}
        <Melds
          melds={s.tableMelds}
          yourSeat={g.yourSeat}
          teamOf={teamOf}
          selectedMeldId={selectedMeldId}
          onSelectMeld={toggleMeld}
          isMyTurn={isMyTurn}
        />

        {/* ── La tua mano, DENTRO il feltro (area "south" della griglia), a
            ventaglio e riordinabile. Il post di Sud le sta appoggiato sotto. ── */}
        <div className="hand-slot">
          <BottomHand
            room={g.roomCode}
            hand={s.yourHand}
            selectedCards={selectedCards}
            isMyTurn={isMyTurn}
            pending={g.pending}
            inFlightCardId={g.inFlightCardId}
            onToggleCard={toggleCard}
            onSelectRange={selectRange}
            onClearSelection={clearSelection}
          />
        </div>

        {/* Postazione locale (Sud) — squadra "Noi" (oro ◆ ), si accende al tuo
            turno. Figlia di .table-grid: ancorata al bordo BASSO del feltro,
            a metà fuori, sotto la mano. */}
        <SeatPost
          area="seat-south"
          team="us"
          role={is2v2 ? "Sud · tu" : "Tu"}
          name={auth.user?.displayName ?? "Tu"}
          handCount={s.yourHand.length}
          active={isMyTurn}
          isGuest={auth.user?.isGuest}
          avatarUrl={seatAvatars[you] ?? null}
          pozzettoTaken={s.yourPozzettoTaken}
          burracoCount={burracoByTeam(youTeam)}
          size="extended"
        />
      </div>
      </div>

      {/* Scelta CIMA/FONDO per la sostituzione della matta in una sequenza:
          compare SOLO quando il server segnala che entrambe le estremità sono
          legali (WILD_EDGE_REQUIRED). Il client non deduce nulla dalle regole:
          si limita a offrire i due controlli e a ripetere la mossa con `edge`.
          (Controllo minimo/funzionale: la rifinitura è rinviata alla Fase 4.) */}
      {g.rejection?.code === "WILD_EDGE_REQUIRED" && wildAttempt && (
        <div className="wild-edge-choice" role="group" aria-label="Sposta la matta">
          <span>Dove sposto la matta?</span>
          <button
            type="button"
            onClick={() =>
              g.wildSubstitute(wildAttempt.meldId, wildAttempt.cardId, "top")
            }
          >
            Cima
          </button>
          <button
            type="button"
            onClick={() =>
              g.wildSubstitute(wildAttempt.meldId, wildAttempt.cardId, "bottom")
            }
          >
            Fondo
          </button>
        </div>
      )}

      <ActionBar
        state={s}
        yourSeat={g.yourSeat}
        pending={g.pending}
        selectedCards={selectedCards}
        selectedMeldId={selectedMeldId}
        onDrawDeck={g.drawDeck}
        onDrawDiscard={g.drawDiscard}
        onMeldNew={() => g.meldNew(selectedCards)}
        onMeldExtend={() => selectedMeldId && g.meldExtend(selectedMeldId, selectedCards)}
        onWildSubstitute={() => {
          if (selectedMeldId && selectedCards[0]) {
            // Memorizza il tentativo così da poterlo ripetere con edge se il
            // server chiede la scelta cima/fondo (WILD_EDGE_REQUIRED).
            setWildAttempt({ meldId: selectedMeldId, cardId: selectedCards[0] });
            g.wildSubstitute(selectedMeldId, selectedCards[0]);
          }
        }}
        onDiscard={() => selectedCards[0] && g.discard(selectedCards[0])}
        onUndo={g.undoLast}
      />
    </div>
  );
}
