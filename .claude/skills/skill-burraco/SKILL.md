---
name: skill-burraco
description: "Regole del Burraco. IMPLEMENTATO: Burraco 'italiano' base, 2 giocatori individuale, chiusura italiana, due canaste (pulito 200 / sporco 100). IN IMPLEMENTAZIONE (Macro-ciclo 3): modalita' a coppie 2 vs 2, con regole complete e decise. DOCUMENTATE ma NON implementate: le varianti tipo_burraco (Reale, Aperto, Chiuso, Chiuso STBL) e le modalita' a 3-5-6 giocatori. Fonte di verita' del dominio di gioco: consultare ogni volta che si progetta, implementa o testa logica di gioco, punteggi, stati di partita o condizioni di vittoria."
---

# Regole del Burraco — Fonte di verita' del dominio

Questo documento e' l'UNICA fonte di verita' per le regole di gioco di Burraco.
Ogni agente che tocca logica di gioco, punteggi, stati o condizioni di vittoria deve
attenersi a queste regole e NON inventarne di proprie. In caso di dubbio o di regola
non coperta qui, l'agente chiede all'utente invece di improvvisare.

## Approccio: motore di regole configurabile
Il gioco NON va implementato come varianti separate copiate, ma come un unico motore
che legge dei PARAMETRI DI CONFIGURAZIONE e si comporta di conseguenza. Tutte le
varianti descritte sotto sono opzioni di configurazione.

### Priorita' di costruzione (ordine di implementazione)
1. FATTO: 2 giocatori, uno contro uno.
2. IN CORSO (Macro-ciclo 3): 4 giocatori a coppie (2 vs 2).
3. Successive: modalita' individuale (3-5 giocatori senza coppie); 6 giocatori a coppie.

### Stato di implementazione (LEGGERE prima di scrivere codice)
Questo skill documenta PIU' di quanto sia oggi implementato. La distinzione e' vincolante:
- IMPLEMENTATO ORA: Burraco base "italiano", 2 giocatori individuale, chiusura italiana,
  DUE canaste (pulito 200 / sporco 100).
- IN IMPLEMENTAZIONE (Macro-ciclo 3, autorizzato dall'utente): modalita' "coppie" a 4
  giocatori. Le regole sono COMPLETE e DECISE nella sezione dedicata: non vanno piu'
  trattate come specifica futura, ma come perimetro di lavoro corrente.
- SOLO DOCUMENTATO (NON implementare senza richiesta ESPLICITA dell'utente):
  le varianti tipo_burraco (Reale, Aperto, Chiuso, Chiuso STBL) e le modalita' a
  3-5-6 giocatori.

## Parametri di configurazione della partita
- numero_giocatori: 2 | 3 | 4 | 5 | 6   (IMPLEMENTATO: 2; IN CORSO: 4)
- modalita: "coppie" | "individuale"    (IMPLEMENTATO: "individuale"; IN CORSO: "coppie")
  (coppie: 2, 4, 6 giocatori; individuale: 2, 3, 5 giocatori)
- tipo_burraco: "italiano" | "reale" | "aperto" | "chiuso" | "chiuso_stbl"
  (IMPLEMENTATO: solo "italiano"; gli altri sono documentati piu' sotto)
- punteggio_obiettivo: 505 | 1005 | 2005 (scelto a inizio partita; default 2005)
- variante_chiusura: "italiana" | "internazionale"
- limite_calate_prima_del_pozzetto: numero | nessun_limite (default: 2 = originale)
- presa_pozzetto: "in_diretta_e_differita" | "solo_differita" (default: entrambe)

## Materiali
- Due mazzi di carte francesi da 54 (incluse le matte), per un totale che comprende i jolly.
- MATTE: jolly e pinelle. La PINELLA e' il 2. Un jolly o una pinella possono sostituire
  qualsiasi carta mancante in un gioco.
- Due POZZETTI da 11 carte ciascuno, preparati a inizio smazzata e messi da parte.

## Distribuzione e turno
- A inizio smazzata si formano i due pozzetti (11 carte l'uno) e si distribuiscono 11 carte
  iniziali a ciascun giocatore.
- Apertura: il primo turno spetta al giocatore alla sinistra del mazziere; in 2 giocatori
  apre il NON-mazziere.
- Nel proprio turno il giocatore: pesca (dal mazzo o dallo scarto secondo le regole),
  eventualmente cala/amplia giochi, e termina scartando una carta nel monte degli scarti.
- PESCA: si pesca UNA carta dal mazzo coperto OPPURE si prende l'INTERO monte degli scarti
  (tutte le carte finora scartate, non solo quella in cima).
- NOTA (ambiguita' risolta): nel Burraco base si prende SEMPRE l'intero monte scarti. La
  clausola "prendi una sola carta dallo scarto" presente in alcuni regolamenti NON si
  applica qui. (La presa di una sola carta con obbligo di attacco immediato compare invece
  nella variante "chiuso", vedi sotto.)

## Giochi validi (combinazioni)
- SEQUENZA: carte dello stesso seme in ordine (es. 4 5 6 7 di picche). L'asso puo' valere
  in basso (A-2-3) o in alto (Q-K-A), ma non "girare" a meta' sequenza.
- GRUPPO (tris/poker+): almeno 3 carte dello stesso valore. Essendo in gioco DUE mazzi,
  sono AMMESSE carte con seme duplicato nello stesso gruppo (es. 9 fiori, 9 fiori, 9 cuori
  e' valido): non e' richiesto che tutti i semi siano diversi.
- Ogni gioco puo' contenere al massimo UNA matta (jolly o pinella), TRANNE il caso in cui
  un 2 sia usato al suo posto naturale nella sequenza (es. 2 picche, 3 picche, pinella,
  5 picche: il primo 2 e' naturale, non conta come matta).
- Non sono ammessi giochi di 3+ pinelle ne' di 3+ jolly (le sole matte non formano gioco).

## SOSTITUZIONE DELLA MATTA — regola vincolante (vale in TUTTE le modalita')
ATTENZIONE — CORREZIONE DI UNA REGOLA PRECEDENTEMENTE ERRATA. Le versioni precedenti di
questo skill affermavano che la matta "torna in mano al giocatore, che puo' riusarla".
E' SBAGLIATO. La regola corretta e' la seguente e vale sia in 1v1 sia in 2v2.

Quando un giocatore possiede in mano la carta naturale di cui una matta calata sta facendo
le veci, puo' fornirla al gioco. In tal caso:
- la carta naturale prende il posto occupato dalla matta;
- la MATTA NON TORNA MAI IN MANO. Resta sul tavolo, dentro lo stesso gioco;
- SEQUENZE (scale): la matta si SPOSTA in cima o in fondo alla sequenza, estendendola di
  una posizione. La destinazione (cima o fondo) e' una scelta del giocatore; se una sola
  delle due e' legale (per esempio la sequenza e' gia' arrivata all'Asso alto), si usa
  quella. Se nessuna delle due e' legale, l'operazione e' RIFIUTATA.
- GRUPPI (tris/poker): non esistono cima e fondo. La matta RESTA NEL GRUPPO come carta in
  piu': il gruppo cresce di una unita' (es. un tris con matta diventa un poker di 4 carte,
  di cui una matta).
- In entrambi i casi il gioco risultante deve restare VALIDO: se non lo e', l'operazione
  e' rifiutata e nulla cambia.
- Conseguenza sul punteggio: il numero di carte del gioco AUMENTA di uno, quindi questa
  mossa puo' far scattare un burraco (transizione da 6 a 7 carte). Il gioco resta SPORCO,
  perche' la matta e' ancora dentro.

Nota per gli implementatori: questa e' una CORREZIONE che riguarda anche il codice 1v1 gia'
in produzione (la mossa oggi chiamata "sostituzione pinella" rimette la matta in mano). Va
sistemata PRIMA di costruire il 2v2, in modo che esista un solo comportamento.

## BURRACO
- Un BURRACO e' un gioco (sequenza o gruppo) di ALMENO 7 carte.
- BURRACO PULITO: senza matte (salvo il caso del 2 al posto naturale) -> 200 punti.
- BURRACO SPORCO: contiene una matta -> 100 punti.
- SOLO DUE tipi di canasta. La "SEMIPURA" (150 punti) presente in alcuni regolamenti
  NON e' adottata in questo gioco: non introdurla ne' nel motore ne' nel punteggio.

## POZZETTO
- Un giocatore "va a pozzetto" quando termina le carte in mano.
- presa_pozzetto = "in_diretta_e_differita":
  - Se prende il pozzetto DOPO aver scartato, deve attendere il turno successivo per giocarlo.
  - Se termina le carte PRIMA di scartare, prende il pozzetto "in diretta" e lo usa subito.
- I pozzetti sono SEMPRE due, indipendentemente dal numero di giocatori.
- In modalita' coppie: UN POZZETTO PER COPPIA. Vedi la sezione "Modalita' a coppie".

## CHIUSURA
Condizioni comuni:
- Aver realizzato almeno un burraco (in coppie: la COPPIA deve avere almeno un burraco).
- Terminare tutte le carte (mano + pozzetto) e scartare l'ultima carta.
- L'ultimo scarto NON puo' essere un jolly ne' una pinella.
- Non si possono scartare matte nell'ultima mano.

Variante di chiusura (parametro variante_chiusura):
- "italiana": basta aver realizzato un burraco di QUALSIASI tipo (pulito o sporco).
- "internazionale": si puo' chiudere SOLO se si e' realizzato almeno un burraco PULITO.

## PUNTEGGIO (a fine smazzata, dopo la chiusura)
Bonus e valori delle carte calate (positivi):
- Chiusura: 100 punti (bonus).
- Burraco pulito: 200 punti. Burraco sporco: 100 punti.
- Jolly: 30. Pinella: 20. Asso: 15.
- Re, Donna (Regina), Fante (Jack), 10, 9, 8: 10 punti ciascuno.
- 7, 6, 5, 4, 3: 5 punti ciascuno.

Penalita' (negativi):
- Le carte rimaste IN MANO valgono gli stessi punti ma NEGATIVI (si sottraggono).
- Pozzetto NON preso: -100 punti (malus).
- Chi ha preso il pozzetto ma non lo ha giocato: sottrae il valore delle carte del pozzetto.

## Fine partita
- Al termine di ogni smazzata si sommano i punteggi. Se nessuno ha raggiunto il
  punteggio_obiettivo, si gioca una nuova smazzata (rimischio e ridistribuzione).
- Vince chi raggiunge o supera per primo il punteggio_obiettivo. (In coppie: la coppia.)

## MODALITA' A COPPIE — 4 giocatori, 2 vs 2 (IN IMPLEMENTAZIONE)
Regole COMPLETE e DECISE dall'utente. Non sono piu' specifica futura: sono il perimetro di
lavoro del Macro-ciclo 3. Ogni punto sotto e' vincolante.

### Tavolo, posti e turni
- Quattro posti numerati 0, 1, 2, 3 in senso ORARIO.
- Le coppie sono i posti OPPOSTI: coppia A = posti 0 e 2; coppia B = posti 1 e 3. I compagni
  sono quindi seduti uno di fronte all'altro, con un avversario a destra e uno a sinistra.
- Turno: rotazione oraria, seat successivo = (seat_corrente + 1) modulo 4.
- Mazziere: ruota di un posto a ogni smazzata, mazziere successivo = (mazziere + 1) modulo 4.
- Apre sempre il giocatore alla SINISTRA del mazziere, cioe' (mazziere + 1) modulo 4.

### Giochi calati: appartengono alla COPPIA
- I giochi calati sono CONDIVISI dalla coppia: non appartengono al singolo giocatore.
- Un giocatore PUO' ampliare (agganciare carte a) un gioco calato dal proprio compagno.
- Un giocatore PUO' fornire la carta naturale a una matta in un gioco del compagno, con la
  meccanica descritta in "SOSTITUZIONE DELLA MATTA" (la matta si sposta / resta nel gioco,
  non torna mai in mano a nessuno).
- Un giocatore NON puo' MAI toccare i giochi della coppia avversaria.
- Conseguenza implementativa: ogni controllo di proprieta' di un gioco si fa sulla SQUADRA,
  mai sul singolo posto.

### Pozzetto: uno per coppia
- I pozzetti restano DUE, uno per ciascuna coppia. Un pozzetto e' RISERVATO alla coppia che
  non lo ha ancora preso.
- Quando un giocatore svuota la mano, prende il pozzetto SOLO SE la sua coppia non ne ha
  gia' preso uno. La stessa coppia non puo' MAI prendere entrambi i pozzetti.
- Se un giocatore svuota la mano e la sua coppia ha GIA' usato il proprio pozzetto, non c'e'
  pozzetto da prendere: quel giocatore si trova nella condizione di CHIUSURA e valgono le
  condizioni di chiusura (serve almeno un burraco DI COPPIA); se non sono soddisfatte, la
  mossa che svuoterebbe la mano e' rifiutata (deve tenere una carta per lo scarto).
- La presa del pozzetto da parte di UNO dei due compagni soddisfa il requisito per l'INTERA
  coppia: basta un pozzetto per abilitare la chiusura della coppia.
- La modalita' di presa (in diretta / in differita) resta quella del gioco base e riguarda
  il singolo giocatore che la effettua.

### Punteggio: tutto a livello di COPPIA
Il punteggio e' di SQUADRA. A fine smazzata, per ciascuna coppia:
- Valore delle carte dei giochi calati DALLA COPPIA (positivo), contato una volta sola.
- Bonus burraco: 200 per ogni burraco pulito della coppia, 100 per ogni burraco sporco.
- Bonus CHIUSURA: +100 ALLA COPPIA, UNA VOLTA SOLA (non a ciascuno dei due compagni).
- Penalita' carte in mano: si sommano le carte rimaste in mano a ENTRAMBI i compagni,
  quindi anche quelle del compagno che non ha chiuso, e si sottraggono al totale di coppia.
- Malus pozzetto non preso: -100 ALLA COPPIA, UNA VOLTA SOLA, e solo se NESSUNO dei due
  compagni ha preso il pozzetto della coppia.
- Vince la COPPIA che raggiunge o supera per prima il punteggio_obiettivo.

### Abbandono / disconnessione (regola di PRODOTTO, non di gioco)
- Alla disconnessione di un giocatore parte una finestra di grazia (impostazione corrente:
  180 secondi) entro cui puo' rientrare al proprio posto.
- Se NON rientra entro la grazia, la sua COPPIA perde a forfait e la partita si chiude con
  un vincitore reale (la coppia avversaria).
- Non si annulla la partita agli altri tre giocatori: sarebbe una penalizzazione ingiusta.
- La partita chiusa per forfait conta come conclusa ai fini delle statistiche, coerentemente
  con il trattamento gia' adottato per il forfait da stallo.

## Varianti di gioco — parametro tipo_burraco (DOCUMENTAZIONE, NON implementate)
Tutte derivano dal Burraco base e ne cambiano alcune regole. Sono specifica futura: il
motore oggi implementa solo "italiano". Ogni variante e' descritta come DELTA dal base.
NB: "reale/aperto/chiuso/chiuso_stbl" cambiano PIU' regole insieme; non vanno confuse
col parametro variante_chiusura, che riguarda solo la condizione di chiusura.

Elementi comuni alle quattro varianti:
- Chiusura: richiede almeno un burraco PULITO (equivale a variante_chiusura="internazionale").
- Nessuna semipura (come il base).
- Due burrachi speciali aggiuntivi, entrambi PULITI:
  - REALE: burraco pulito di 14 carte, da Asso ad Asso -> 1000 punti.
  - NOBILE: burraco pulito di 13 carte, da Asso a 2 -> 500 punti.
- Riciclo del mazzo: se il mazzo di pesca si esaurisce, un pozzetto non ancora assegnato
  viene riversato nel mazzo; se finisce anche quello, subentra il secondo pozzetto (se
  disponibile).
- Malus di fine smazzata: se non si e' preso il pozzetto, -100 punti (gia' presente nel base).

Delta specifici:
- REALE: nel mazzo NON ci sono jolly (si gioca con le sole pinelle come matte); niente
  GRUPPI (tris): ammesse SOLO sequenze/scale.
- APERTO: accesso allo scarto come nel base; niente GRUPPI (solo scale).
- CHIUSO: il monte scarti e' "coperto", si vede solo l'ultima carta scartata; per prenderla
  (insieme al resto del monte) si e' OBBLIGATI ad attaccarla subito a un gioco esistente
  o a calarla in un gioco nuovo nello stesso turno.
- CHIUSO STBL: come CHIUSO e, in piu', niente GRUPPI (solo scale).

## Modalita' a 3, 5 e 6 giocatori (DOCUMENTAZIONE, NON implementate)
- Individuale a 3 o 5 giocatori e coppie a 6: estensioni documentate; regole di turno e
  pozzetti analoghe, da dettagliare al momento dell'implementazione.

## Note per gli agenti
- Casi limite da gestire e testare con cura: esaurimento del mazzo di pesca, tentativi di
  chiusura non validi, sostituzione della matta (nuova meccanica: sequenza vs gruppo, e il
  caso in cui nessuna posizione sia legale), presa del pozzetto in diretta vs differita,
  pozzetto gia' usato dalla propria coppia, scarto illegale in ultima mano, conteggio dei
  burrachi puliti/sporchi ai fini punti, somma delle carte in mano di ENTRAMBI i compagni.
- La logica di punteggio e le condizioni di chiusura sono le aree piu' soggette a errore:
  l'agente_test deve coprirle con scenari espliciti, sia in 1v1 sia in 2v2.
- ANTI-LEAK in coppie: i giochi della coppia sono condivisi e visibili, ma la MANO del
  compagno resta PRIVATA esattamente come quella degli avversari. Di ogni altro giocatore
  si espone solo il CONTEGGIO delle carte. Non esistono eccezioni "per aiutare il compagno".
- DOCUMENTAZIONE != IMPLEMENTAZIONE: NON costruire varianti tipo_burraco ne' modalita' a
  3-5-6 giocatori senza richiesta esplicita dell'utente.
- Regola ambigua o non coperta: chiedere all'utente, mai improvvisare.
