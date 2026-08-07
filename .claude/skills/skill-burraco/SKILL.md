---
name: skill-burraco
description: Regole del Burraco. IMPLEMENTATO: Burraco "italiano" base, 2 giocatori individuale, chiusura italiana, due canaste (pulito 200 / sporco 100). DOCUMENTATE ma NON ancora implementate: le varianti tipo_burraco (Reale, Aperto, Chiuso, Chiuso STBL) e le modalita' a coppie / 4-5-6 giocatori. Fonte di verita' del dominio di gioco: consultare ogni volta che si progetta, implementa o testa logica di gioco, punteggi, stati di partita o condizioni di vittoria.
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
1. PRIMA VERSIONE (da costruire per prima): 2 giocatori, uno contro uno.
2. Versioni successive (macro-cicli seguenti): 4 giocatori a coppie (2 vs 2);
   modalita' individuale (2-3-5 giocatori senza coppie); 6 giocatori a coppie.
Le regole di tutte le modalita' sono documentate qui da subito, ma il codice le
realizza in quest'ordine di priorita'.

### Stato di implementazione (LEGGERE prima di scrivere codice)
Questo skill documenta PIU' di quanto sia oggi implementato. La distinzione e' vincolante:
- IMPLEMENTATO ORA (unico perimetro di codice ammesso senza nuova richiesta):
  Burraco base "italiano", 2 giocatori individuale, chiusura italiana, DUE canaste
  (pulito 200 / sporco 100). E' il gioco descritto nelle sezioni da "Materiali" a
  "Fine partita".
- SOLO DOCUMENTATO (NON implementare senza richiesta ESPLICITA dell'utente):
  le varianti tipo_burraco (Reale, Aperto, Chiuso, Chiuso STBL) e le modalita' a
  coppie / 4-5-6 giocatori. Sono qui perche' lo skill e' la fonte completa del
  dominio, NON perche' vadano costruite ora.
Un agente che trova una regola marcata "DOCUMENTAZIONE" NON la implementa: la tratta
come specifica futura.

## Parametri di configurazione della partita
- numero_giocatori: 2 | 3 | 4 | 5 | 6   (IMPLEMENTATO: solo 2)
- modalita: "coppie" | "individuale"    (IMPLEMENTATO: solo "individuale")
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
- Una pinella gia' calata puo' essere sostituita dalla carta di cui fa le veci, se il
  giocatore ha in mano quella carta (recuperando cosi' la pinella per riusarla).

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
- In modalita' coppie basta UN pozzetto per permettere la chiusura della coppia.

## CHIUSURA
Condizioni comuni:
- Aver realizzato almeno un burraco.
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

## Modalita' a coppie e a piu' giocatori (DOCUMENTAZIONE, NON implementate)
- 4 giocatori a coppie (2 vs 2): compagni seduti uno di fronte all'altro; i giochi calati
  sono CONDIVISI dalla coppia; basta UN pozzetto per abilitare la chiusura della coppia;
  il punteggio e' di squadra; turni in senso orario sui 4 posti.
- Individuale a 3 o 5 giocatori e coppie a 6: estensioni documentate; regole di turno e
  pozzetti analoghe, da dettagliare al momento dell'implementazione.
- Nota di impatto (per quando verra' implementato): il 4 giocatori a coppie tocca il motore
  (giochi condivisi, pozzetto/chiusura di coppia, punteggio di squadra), la REDAZIONE dello
  stato (mano privata, giochi di coppia condivisi) e il layout del frontend (4 posti). NON
  e' un semplice cambio di parametro.

## Note per gli agenti
- Casi limite da gestire e testare con cura: esaurimento del mazzo di pesca, tentativi di
  chiusura non validi, sostituzione della pinella, presa del pozzetto in diretta vs differita,
  scarto illegale in ultima mano, conteggio dei burrachi puliti/sporchi ai fini punti.
- La logica di punteggio e le condizioni di chiusura sono le aree piu' soggette a errore:
  l'agente_test deve coprirle con scenari espliciti.
- DOCUMENTAZIONE != IMPLEMENTAZIONE: NON costruire varianti tipo_burraco ne' modalita' a
  piu' giocatori/coppie senza richiesta esplicita dell'utente. Il perimetro di codice
  attuale e' quello della sezione "Stato di implementazione".
- Regola ambigua o non coperta: chiedere all'utente, mai improvvisare.
