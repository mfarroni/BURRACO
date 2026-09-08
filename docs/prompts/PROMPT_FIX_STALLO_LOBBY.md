# REMEDIATION: DUE OSPITI NON RIESCONO A INCONTRARSI — LOBBY E APERTURA TAVOLO

**Destinatario:** agente_develop · **Tipo:** remediation funzionale (ritorno a `agente_test`, si salta `agente_ui_ux`) · **Output finale:** `OUTPUT PER: agente_test`

> Brief archiviato come fonte di verità. Il guasto è stato riprodotto dall'utente sul deployment di branch (Vercel + Render), due sessioni ospite nella stessa finestra.

## 0. Regola d'oro
Correzione, non riprogettazione. Il modello dei tre stati, le tre porte e le regole anti-stallo sono già approvati: vanno fatti funzionare.
- **Divieto:** NON correggere/silenziare il messaggio "Non sei in nessun room. Invia join_room" — è il sintomo corretto di uno stato incoerente. Va rimossa la CONDIZIONE che lo genera, non il messaggio.
- **Divieto:** nessuna nuova dipendenza, nessuna modifica al design system, al motore di gioco, alle regole o all'autenticazione.
- Se la causa è fuori dal perimetro lobby, fermarsi e riferire al lead.

## 1. Decisioni di prodotto (invariate)
Quick match attivo; fusione server-side solo pubblici `quick_match`; codice precompilato dal server e modificabile; tavoli privati; contatore giocatori in lobby; grace 60s; due sessioni stesso browser permesse (avviso non bloccante).

## 2. Difetto osservato (verbale utente, due ospiti stesso browser)
- Sessione 1: lista vuota; "Apri un tavolo" → nessuna lista, schermata appesa, errore "Non sei in nessun room. Invia join_room"; "Gioca subito" non porta a nulla.
- Sessione 2: non vede tavoli né chi è in attesa; "Gioca subito" nullo; le due sessioni non si incontrano mai.
- Modale "Apri un tavolo": pulsante di conferma **grigiato** nonostante il codice debba arrivare precompilato dal server; resta grigiato spuntando "privato".

## 3. GATE 1 — DIAGNOSI (fermarsi e riferire prima di correggere)
Ispezionare il codice reale e rispondere con file:riga.
### 3.1 Dov'è il registro dei tavoli
1. Quali strutture rappresentano un tavolo? Il `RoomManager` dei socket e il registro usato dalle rotte HTTP sono la STESSA struttura o due distinte?
2. "Apri un tavolo": quale codice gira, in che ordine, su quale struttura scrive?
3. L'endpoint lista legge dalla stessa struttura su cui scrive l'apertura? Se no → causa principale.
4. Un tavolo con un solo giocatore è rappresentabile? Lo stato `waiting` esiste nel codice o solo nei doc?
### 3.2 Da dove nasce "Non sei in nessun room"
5. Punto esatto nel backend che produce il messaggio; quale messaggio in arrivo lo scatena, quale controllo fallisce.
6. Sequenza reale sul client dopo "Apri un tavolo": HTTP, apertura WS, `join_room`, in quale ordine. Un messaggio scoped alla stanza viene inviato PRIMA che l'aggancio sia confermato, o su un socket mai agganciato?
7. Il socket è aperto prima o dopo la creazione del tavolo?
8. Esiste ripristino dell'aggancio alla riconnessione del socket? Chi rifà `join_room`?
### 3.3 Perché il pulsante è disabilitato
9. Condizione `disabled` esatta del pulsante di conferma (testuale).
10. Il campo codice usa `value` legato allo stato o `defaultValue`/`placeholder`? (Se defaultValue/placeholder → campo pieno a schermo ma stato vuoto → disabled mai sbloccato. Verificare per prima.)
11. Esiste la chiamata che genera il codice precompilato? La rotta risponde 200 nella forma attesa? Se fallisce, l'errore è visibile o ingoiato?
12. La casella "privato" entra nella condizione `disabled`? (Non dovrebbe.)
### 3.4 Perché "Gioca subito" non funziona
13. La rotta/azione quick match esiste ed è collegata? Cosa accade alla pressione?
### 3.5 Contatore e lista
14. L'endpoint lista esiste, è chiamato col polling, cosa restituisce a zero tavoli?
15. Il contatore è server-side o fisso in UI?
### 3.6 Consegna del gate
Catena causale in prosa (nesso, non elenco); distinzione fra "mai implementato" e "implementato ma difettoso"; piano di correzione con ordine motivato; eventuali decisioni §1 impraticabili. Poi fermarsi e attendere l'approvazione.

## 4. Invarianti che la correzione deve garantire (li verificherà il test)
- **4.1 Una sola fonte di verità:** un unico registro tavoli, quello che governa i socket. Unificare, non sincronizzare.
- **4.2 Il tavolo nasce già agganciato:** a fine apertura, prima della schermata d'attesa: tavolo in `waiting` col creatore seduto; socket agganciato (join_room già confermato); se pubblico già in lista; nessun messaggio scoped inviato prima dell'aggancio. Altrimenti errore + resta in lobby, nessuno stato appeso.
- **4.3 Nessun feedback ottimistico:** caricamento + controlli disabilitati durante l'operazione; fallimento → messaggio + stato coerente; timeout sull'attesa della conferma.
- **4.4 Il pulsante si abilita quando c'è un codice valido** nello stato React (≤12, maiuscolo, trim/upper). "Privato" non influisce. Se il codice server non arriva: ripiego client dichiarato o errore, mai vuoto e muto.
- **4.5 La partita parte dal socket** (evento WS), mai dal polling.
- **4.6 Riconnessione:** socket cade e si riconnette in `waiting`/`playing` → aggancio ripristinato dal client in automatico, senza perdita del posto. È il caso che genera l'errore osservato.
- **4.7 Due sessioni stesso browser:** due giocatori distinti, stesso tavolo consentito; nessun identificativo per-browser condiviso che le faccia collassare o blocchi il posto. Attenzione storica: "posto riservato appeso" — spiegare perché non si reintroduce.
- **4.8 Errori tipizzati** tradotti in italiano; sparisce dalla UI ogni testo che nomini `join_room`/protocollo.

## 5. Strumenti di diagnosi ammessi
Log strutturati backend sulle transizioni di stato del tavolo (prefisso filtrabile, consultabili su Render) e log client sulle stesse; nessun dato personale/token/password. Dichiarare quali restano in produzione e motivare; rimuovere gli altri prima della consegna.

## 6. GATE 2 — Verifica prima di consegnare (sull'URL di branch)
Percorso principale (due ospiti stesso browser): 1) lista vuota con testo + 2 pulsanti attivi; 2) "Apri un tavolo" → modale con codice compilato e pulsante attivo; 3) conferma → schermata d'attesa col codice, nessun errore/`join_room` in console; 4) Ospite 2 vede il tavolo in lista (nome + attesa); 5) "Siediti" → partita per entrambi + avviso stesso-browser; 6) contatore coerente.
Quick match: 7) "Gioca subito" lobby vuota → tavolo in attesa senza errori; 8) Ospite 2 "Gioca subito" → si siede, un tavolo due giocatori; 9) due quick simultanei → fusione, chi è spostato vede spiegazione.
Privati: 10) "privato" → pulsante attivo, non in lista, raggiungibile solo col codice; 11) privato mai fuso, pubblico manuale mai fuso.
Casi limite: 12) codice in uso → errore, no crash; 13) backend irraggiungibile → messaggio, UI non appesa; 14) chiusura scheda creatore → sparisce dopo 60s; 15) rientro entro 60s → sopravvive, aggancio auto-ripristinato; 16) annullamento → sparizione immediata + lobby; 17) riavvio backend con tavoli in attesa → comportamento definito e comunicato.
Igiene: 18) typecheck + lint senza errori; 19) `git status` solo file della whitelist; 20) nessuna nuova dipendenza.

## 7. Consegna
Branch dedicato, commit che nomina la CAUSA (non il sintomo). Relazione con: catena causale e correzione di ogni anello; file toccati BE/FE; esito dei 20 punti §6; cosa non è stato corretto e perché; scostamenti motivati.
Chiudere con: `OUTPUT PER: agente_test` — verifica del percorso "due ospiti si incontrano", attenzione a riconnessione socket, due sessioni stesso browser, non-regressione posto riservato appeso.
