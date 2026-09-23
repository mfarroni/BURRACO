# Memo — Prossimi sviluppi: Tornei, Shop, Bacheca eventi

**Data:** 2026-09-23
**Autore:** lead (appunto raccolto da Claude)
**Stato:** DA PIANIFICARE — nessuna decisione presa, nessun codice scritto.

---

## 1. Tornei — da sviluppare

**Cosa c'è già**
- Tabella `events` (migrazione `0011_events_shop`): titolo, descrizione, luogo, inizio/fine,
  `pubblicato` (bozza ↔ pubblico).
- Il pannello admin, scheda "Eventi & Shop", crea ed elenca gli eventi.
- In vetrina, la sezione `#tornei` ("Cosa arriva dopo") li annuncia soltanto.

**Cosa manca (da definire con l'analista)**
- Pagina pubblica degli eventi o tornei pubblicati.
- Iscrizione dei giocatori (solo registrati?), posti massimi, lista d'attesa.
- Formato del torneo: eliminazione diretta, girone all'italiana, Mitchell a coppie…
  **Le regole vanno prima scritte nella skill `skill-burraco`**, fonte di verità del dominio.
- Tabellone, abbinamenti, turni, e collegamento alle partite reali (tavoli creati dal torneo).
- Classifica e storico del torneo; notifiche via email (il sistema broadcast esiste già).
- Rapporto con il 2v2 (Macro-ciclo 3): i tornei a coppie dipendono dal suo completamento.

## 2. Shop — da sviluppare

**Cosa c'è già**
- Tabella `shop_products` (migrazione `0011`): nome, descrizione, prezzo in **centesimi**,
  valuta, `immagine_url`, `disponibile`.
- CRUD admin dei prodotti (crea, modifica, cancella).

**Cosa manca (da definire)**
- Vetrina pubblica dei prodotti.
- Cosa si vende (oggetti fisici? contenuti digitali?) e **come si paga**: scegliere un
  fornitore (es. Stripe, PayPal, o link esterni tipo Buy Me a Coffee "shop").
  Pagamento sempre sul sito del fornitore: **mai dati di carta sul nostro server**.
- Ordini, spedizioni, resi, ricevute; aspetti fiscali e legali (condizioni di vendita,
  diritto di recesso, privacy) da verificare **prima** di aprire lo shop.
- Coerenza con il vincolo della vetrina: "si gioca senza denaro, nessuna scommessa,
  nessun premio in denaro". Lo shop non deve toccare il gioco.

## 3. Bacheca eventi (commenti e foto) — idea da valutare

Uno spazio per ogni evento dove i partecipanti pubblicano commenti e foto.

**Attenzione alle dimensioni — vincoli attuali**
- **Database Neon con budget di ~10.000 righe** (presidio di occupazione nel pannello
  admin). Commenti e foto consumano righe e spazio: servono tetti e retention.
- **Nessun object storage** oggi: la foto profilo è salvata come data URL nel DB, già
  ridotta dal client a 256×256 con tetto di 160 KB. Per la bacheca questo **non scala**.
- La CSP del frontend ammette immagini solo da `'self'` e `data:`: uno storage esterno
  richiede di aggiungerne il dominio a `img-src` (e a `connect-src` per l'upload).

**Proposte da valutare**
- Foto ridimensionate **nel browser** prima dell'invio (es. lato lungo max 1280px, JPEG/WebP
  ~200–300 KB), con tetto verificato **anche lato server**.
- Foto in uno storage esterno (es. Cloudflare R2, Vercel Blob) e nel DB solo l'URL, come
  già previsto per `immagine_url` dei prodotti.
- Limiti: N foto per utente per evento, lunghezza massima dei commenti, rate-limit.
- Retention: foto e commenti rimossi dopo X mesi dalla fine dell'evento.
- **Moderazione**: segnalazione, nascondi/cancella da admin; solo utenti registrati
  (niente ospiti anonimi).
- **Privacy**: rimuovere i metadati EXIF (posizione GPS) dalle foto; consenso per le foto
  in cui compaiono altre persone.
- Sicurezza: controllo del tipo reale del file (non solo l'estensione), testi resi come
  testo (mai HTML), nessuna esecuzione di contenuti caricati.

---

## Prossimo passo suggerito
Far partire `agente_analista` su **un** tema alla volta (ordine consigliato: Tornei →
Shop → Bacheca), con piano da approvare prima dello sviluppo, come per gli altri cicli.
