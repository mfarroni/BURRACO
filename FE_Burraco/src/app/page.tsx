"use client";

import { useEffect, useState } from "react";
import type { Card } from "@/lib/contract";
import { useGameSocket } from "@/lib/useGameSocket";
import { useAuth } from "@/lib/useAuth";
import { AuthPanel } from "@/components/AuthPanel";
import { ProfilePanel } from "@/components/ProfilePanel";
import { BottomHand } from "@/components/BottomHand";
import { CardView } from "@/components/CardView";
import { Melds } from "@/components/Melds";
import { ActionBar } from "@/components/ActionBar";
import {
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
  OpponentStatus,
  TurnBanner,
} from "@/components/StateBanners";

export default function Page() {
  const g = useGameSocket();
  const auth = useAuth();

  // Form della lobby.
  const [roomCode, setRoomCode] = useState("");
  // Vista Profilo (sola lettura) sovrapposta alla lobby autenticata.
  const [showProfile, setShowProfile] = useState(false);

  // Stato di SELEZIONE locale (nessuna regola: solo UI).
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null);

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

  /* ── Non autenticato → schermata d'ingresso (Accedi/Registrati/Ospite) ─ */
  if (auth.status === "anonymous") {
    return <AuthPanel auth={auth} />;
  }

  /* ── Profilo (sola lettura), raggiungibile dalla lobby autenticata ──── */
  if (!g.joined && showProfile && auth.user) {
    return <ProfilePanel user={auth.user} onBack={() => setShowProfile(false)} />;
  }

  /* ── Autenticato ma non ancora al tavolo → codice tavolo + Entra ────── */
  if (!g.joined) {
    const connecting = g.connPhase === "connecting" || g.connPhase === "reconnecting";
    return (
      <div className="lobby">
        <div className="brand">
          <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
          <h1>Burraco</h1>
          <p className="tagline">Il tavolo del circolo, uno contro uno.</p>
        </div>

        {/* Identità corrente + logout. */}
        <div className="whoami">
          <span className="muted">
            Sei entrato come <strong>{auth.user?.displayName}</strong>
            {auth.user?.isGuest ? " (ospite)" : ""}
          </span>
          <button type="button" className="btn-ghost" onClick={() => setShowProfile(true)}>
            Profilo
          </button>
          <button type="button" className="btn-ghost" onClick={() => auth.logout()} disabled={auth.busy}>
            Esci
          </button>
        </div>

        <label htmlFor="room">Codice tavolo</label>
        <input
          id="room"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          placeholder="es. TAVOLO1"
          maxLength={12}
          autoComplete="off"
          aria-describedby="room-hint"
        />
        <p id="room-hint" className="field-hint">
          Chi apre il tavolo sceglie un codice; l&apos;avversario digita lo stesso per sedersi.
        </p>
        <button
          type="button"
          className="cta btn-primary"
          disabled={!roomCode.trim() || connecting}
          onClick={() => {
            g.dismissJoinRejected();
            g.join(roomCode, auth.user?.displayName ?? "");
          }}
        >
          {connecting ? "Connessione…" : "Entra"}
        </button>
        {connecting && (
          <p className="muted" role="status" style={{ marginTop: "var(--sp-3)" }}>
            Apertura del tavolo in corso…
          </p>
        )}
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
        {g.errorMessage && (
          <p role="alert" className="auth-error">
            <span className="auth-error-icon" aria-hidden="true">!</span>
            <span>{g.errorMessage}</span>
          </p>
        )}
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
      <div className="lobby">
        <div className="brand">
          <div className="suits" aria-hidden="true">♠ ♥ ♦ ♣</div>
          <h1>In attesa dell&apos;avversario</h1>
          <p className="tagline">
            Codice tavolo: <strong>{roomCode.toUpperCase() || "—"}</strong>
          </p>
        </div>
        <p className="muted" style={{ textAlign: "center" }}>
          Condividi il codice con l&apos;altro giocatore: la partita inizia appena si siede al tavolo.
        </p>
        <ConnectionBanner connPhase={g.connPhase} resumed={g.resumed} />
        {/* Reset consentito in attesa: nessun avversario da penalizzare. */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--sp-4)" }}>
          <ResetTableButton onReset={g.resetRoom} context="waiting" />
        </div>
      </div>
    );
  }

  /* ── Partita ───────────────────────────────────────────────────────── */
  const s = g.state;
  const you = g.yourSeat ?? 0;
  const oppSeat = (1 - you) as 0 | 1;
  const isMyTurn = s.whoseTurn === g.yourSeat;
  const opponent = g.players.find((p) => p.seat !== g.yourSeat);
  const opponentName = opponent?.displayName ?? "Avversario";
  const opponentConnected = opponent?.connectionStatus !== "disconnected";
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

      {/* Avversario offline: rientro in corso entro la finestra di grazia; nel
          frattempo è possibile terminare il tavolo (annulla la partita). */}
      {!opponentConnected && (
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

      {/* ── Header / Scoreboard ───────────────────────────────────────── */}
      <div className="topbar">
        <div className="status-line">
          <span className="badge" data-turn={isMyTurn ? "mine" : "theirs"}>
            <span className="dot" aria-hidden="true" />
            {isMyTurn ? "Tocca a te" : `Turno di ${opponentName}`}
          </span>
          {isMyTurn && turnEndsAt !== null && <Countdown turnEndsAt={turnEndsAt} />}
          <OpponentStatus name={opponentName} handCount={s.opponentHandCount} connected={opponentConnected} />
        </div>
        <div className="scoreboard">
          <div className="chip you">
            <span className="lbl">Tu</span>
            <span className="val">{s.scores[you]}</span>
          </div>
          <span className="vs" aria-hidden="true">/</span>
          <div className="chip">
            <span className="lbl">{opponentName}</span>
            <span className="val">{s.scores[oppSeat]}</span>
          </div>
          <div className="chip">
            <span className="lbl">Obiettivo</span>
            <span className="val">{g.config?.punteggioObiettivo ?? "—"}</span>
          </div>
        </div>
      </div>

      {/* Riconnessione propria + "stato ripristinato". */}
      <ConnectionBanner connPhase={g.connPhase} resumed={g.resumed} />

      {/* Turno + fase, in evidenza. */}
      <TurnBanner isMyTurn={isMyTurn} phaseHint={phaseHint} opponentName={opponentName} />

      {/* ── Tavolo: griglia a postazioni (data-seats), isola centrale FISSA ──
          v1 = 1v1 (data-seats="2"): avversario a Nord, tu a Sud, isola al centro.
          La struttura è predisposta a 4 postazioni (solo layout): il CSS di
          data-seats="4" esiste già e le targhe/aree si generalizzano owner→team
          senza riscrittura. NESSUNA regola 2v2 è implementata qui. */}
      <div className="table-grid" data-seats="2">
        {/* Postazione avversario (Nord) — squadra "Loro" (acciaio/blu ● ). */}
        <div className="seat-plate seat-north" data-team="them" data-active={!isMyTurn ? "true" : "false"}>
          <span className="crest" aria-hidden="true">●</span>
          <span className="seat-name">{opponentName}</span>
          <span className="team-tag">Loro</span>
          <span className="seat-hand">{s.opponentHandCount} in mano</span>
          {!isMyTurn && <span className="turn-dot" aria-hidden="true" />}
          {!opponentConnected && <span className="seat-off">offline</span>}
        </div>

        {/* Isola centrale FISSA: mazzo, monte scarti, mano avversario, pozzetti. */}
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

          <div className="pile">
            <div className="slot facedown" aria-hidden="true" />
            <div className="num">{s.opponentHandCount}</div>
            <div className="lbl">Mano avversario</div>
          </div>

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
          selectedMeldId={selectedMeldId}
          onSelectMeld={toggleMeld}
          isMyTurn={isMyTurn}
        />

        {/* Postazione locale (Sud) — squadra "Noi" (oro ◆ ), si accende al tuo turno. */}
        <div className="seat-plate seat-south" data-team="us" data-active={isMyTurn ? "true" : "false"}>
          <span className="crest" aria-hidden="true">◆</span>
          <span className="seat-name">{auth.user?.displayName ?? "Tu"}</span>
          <span className="team-tag">Noi</span>
          <span className="seat-hand">{s.yourHand.length} in mano</span>
          {isMyTurn && <span className="turn-dot" aria-hidden="true" />}
        </div>
      </div>

      {/* ── La tua mano (ancorata in basso, a ventaglio, riordinabile) ──── */}
      <BottomHand
        room={roomCode.toUpperCase() || null}
        hand={s.yourHand}
        selectedCards={selectedCards}
        isMyTurn={isMyTurn}
        pending={g.pending}
        inFlightCardId={g.inFlightCardId}
        onToggleCard={toggleCard}
        onSelectRange={selectRange}
        onClearSelection={clearSelection}
      />

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
        onPinellaSubstitute={() =>
          selectedMeldId && selectedCards[0] && g.pinellaSubstitute(selectedMeldId, selectedCards[0])
        }
        onDiscard={() => selectedCards[0] && g.discard(selectedCards[0])}
        onUndo={g.undoLast}
      />
    </div>
  );
}
