# Specifica — Pannello regole in partita (feature frontend)

Stato: DA IMPLEMENTARE (backlog). Non dipende dagli account. Consigliata dopo la lobby.

## Scopo
Dare ai giocatori, durante la partita, un riferimento alle regole ESATTE del proprio
tavolo, per risolvere le controversie. Il contenuto deve corrispondere a cio' che il
server fa rispettare: un riferimento che contraddice il motore peggiora le liti invece
di risolverle.

## Principio chiave: fonte unica = lo skill
Il contenuto del pannello NON e' un testo scritto a parte e NON e' il parsing a runtime
di SKILL.md. E' contenuto redatto A PARTIRE da skill-burraco e PARAMETRIZZATO dalla
configurazione del tavolo, usando gli STESSI parametri che guidano il motore:
- tipo_burraco, variante_chiusura, punteggio_obiettivo, presa_pozzetto,
  limite_calate_prima_del_pozzetto, numero_giocatori/modalita.
Quando lo skill cambia, il contenuto del pannello va aggiornato di conseguenza: stessa
verita' per giocatore e per motore.

## Cosa mostra
- Le regole per la configurazione ATTIVA del tavolo: materiali, turno, giochi validi,
  burraco (pulito/sporco), pozzetto, chiusura (con la variante scelta), punteggio,
  fine partita.
- I valori specifici del tavolo (obiettivo, tipo di presa del pozzetto, ecc.), non
  generici.
- Oggi (solo "italiano" implementato) mostra la base. Man mano che una variante
  tipo_burraco viene implementata, si aggiunge la sua sezione di delta. Una variante
  NON implementata NON deve comparire come se fosse giocabile.

## Comportamento
- Accessibile in qualsiasi momento della partita da un pulsante "Regole", in overlay/pannello.
- Sola lettura: non blocca il gioco, non mette in pausa turni ne' timer; si puo' aprire
  mentre e' il turno dell'avversario o in attesa.
- Nessuna informazione riservata: non mostra mani, pozzetti o mazzo, solo regole.

## Fuori scope / vincoli
- Niente link esterno come riferimento PRIMARIO. Un link alla fonte esterna e' ammesso
  solo come lettura secondaria, etichettato chiaramente "regole generali, non specifiche
  di questo tavolo".
- Dal pannello non si modifica nulla.

## Nel team di agenti (quando si implementa)
- Feature di frontend: co-design develop <-> ui_ux.
- Il contenuto DERIVA dallo skill: la coerenza tra regola mostrata e regola applicata e'
  un requisito, non un dettaglio.
- agente_test verifica che, cambiando i parametri del tavolo (es. chiusura italiana vs
  internazionale, obiettivo diverso), il pannello mostri regole corrispondenti a quelle
  che il server applica.
