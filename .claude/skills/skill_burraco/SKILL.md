---
name: skill_burraco
description: Regole ufficiali e complete del Burraco italiano, con tutte le varianti (numero giocatori, modalita' a coppie o individuale, chiusura italiana o internazionale, punteggi, gestione pozzetto, jolly e pinella). Fonte di verita' del dominio di gioco. Da consultare ogni volta che si progetta, implementa o testa logica di gioco, punteggi, stati di partita o condizioni di vittoria.
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

## Parametri di configurazione della partita
- numero_giocatori: 2 | 3 | 4 | 5 | 6
- modalita: "coppie" | "individuale"
  (coppie: 2, 4, 6 giocatori; individuale: 2, 3, 5 giocatori)
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
- A inizio smazzata si formano i due pozzetti (11 carte l'uno) e si distribuiscono le
  carte iniziali ai giocatori.
- Nel proprio turno il giocatore: pesca (dal mazzo o dallo scarto secondo le regole),
  eventualmente cala/amplia giochi, e termina scartando una carta nel monte degli scarti.

## Giochi validi (combinazioni)
- SEQUENZA: carte dello stesso seme in ordine (es. 4 5 6 7 di picche). L'asso puo' valere
  in basso (A-2-3) o in alto (Q-K-A), ma non "girare" a meta' sequenza.
- GRUPPO (tris/poker+): carte dello stesso valore di semi diversi (es. 9 fiori, 9 quadri, 9 cuori).
- Ogni gioco puo' contenere al massimo UNA matta (jolly o pinella), TRANNE il caso in cui
  un 2 sia usato al suo posto naturale nella sequenza (es. 2 picche, 3 picche, pinella,
  5 picche: il primo 2 e' naturale, non conta come matta).
- Una pinella gia' calata puo' essere sostituita dalla carta di cui fa le veci, se il
  giocatore ha in mano quella carta (recuperando cosi' la pinella per riusarla).

## BURRACO
- Un BURRACO e' un gioco (sequenza o gruppo) di ALMENO 7 carte.
- BURRACO PULITO: senza matte (salvo il caso del 2 al posto naturale) -> 200 punti.
- BURRACO SPORCO: contiene una matta -> 100 punti.

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

## Note per gli agenti
- Casi limite da gestire e testare con cura: esaurimento del mazzo di pesca, tentativi di
  chiusura non validi, sostituzione della pinella, presa del pozzetto in diretta vs differita,
  scarto illegale in ultima mano, conteggio dei burrachi puliti/sporchi ai fini punti.
- La logica di punteggio e le condizioni di chiusura sono le aree piu' soggette a errore:
  l'agente_test deve coprirle con scenari espliciti.
