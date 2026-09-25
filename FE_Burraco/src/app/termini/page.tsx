import type { Metadata } from "next";
import { LegalPage, Recapito } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Termini d'uso — Burraco, Circolo Nettuno",
  description: "Le regole di convivenza del circolo: gioco gratuito, senza denaro, nel rispetto degli altri.",
};

/*
 * Termini d'uso — Audit lancio R08. Testo sobrio, coerente con la vetrina ("si gioca
 * senza denaro"). Da far validare a un professionista prima della pubblicità aperta.
 */
export default function TerminiPage() {
  return (
    <LegalPage title="Termini d'uso">
      <p>
        Usando il sito Burraco del Circolo Nettuno accetti queste semplici regole. Il titolare del
        servizio è <Recapito />.
      </p>

      <h2>1. Il servizio</h2>
      <p>
        Il circolo ti permette di giocare a Burraco online, da ospite o con un account gratuito.
        Il gioco è <strong>gratuito</strong>. <strong>Non si gioca con denaro</strong>: non ci sono
        puntate, scommesse né premi in denaro. Le offerte volontarie («Offri un caffè») non danno
        alcun vantaggio al tavolo.
      </p>

      <h2>2. Comportamento al tavolo</h2>
      <ul>
        <li>Scegli un nome rispettoso: niente offese, volgarità o nomi che imitano altre persone.</li>
        <li>Non usare programmi, trucchi o più schede per ottenere un vantaggio o disturbare gli altri.</li>
        <li>Non tentare di accedere agli account altrui o alle parti riservate del sito.</li>
      </ul>
      <p>
        Chi non rispetta queste regole può vedersi chiudere l&apos;account o bloccare l&apos;accesso.
      </p>

      <h2>3. Il tuo account</h2>
      <p>
        Sei responsabile della tua password: non condividerla. Puoi eliminare l&apos;account quando vuoi
        dal tuo Profilo. Gli accessi da ospite si cancellano da soli dopo 7 giorni di inattività.
      </p>

      <h2>4. Disponibilità</h2>
      <p>
        Il circolo è gestito senza scopo di lucro su server gratuiti. Facciamo il possibile perché
        funzioni sempre, ma non possiamo garantirlo: al primo accesso il server può impiegare circa
        mezzo minuto per avviarsi e, in caso di manutenzione o guasto, una partita in corso può
        interrompersi. Le regole applicate sono quelle del motore di gioco, che è l&apos;arbitro finale
        di ogni mossa.
      </p>

      <h2>5. Responsabilità</h2>
      <p>
        Il servizio è offerto così com&apos;è. Nei limiti consentiti dalla legge, il titolare non
        risponde di interruzioni, perdite di partite o punteggi, né dei contenuti dei siti esterni
        raggiungibili dai link.
      </p>

      <h2>6. Dati personali</h2>
      <p>
        Come trattiamo i tuoi dati è spiegato nell&apos;<a href="/privacy">Informativa privacy</a>; l&apos;uso
        della memoria del browser nella pagina <a href="/cookie">Cookie e memoria del browser</a>.
      </p>

      <h2>7. Modifiche e legge applicabile</h2>
      <p>
        Possiamo aggiornare questi termini: la data in alto indica l&apos;ultima versione. Si applica la
        legge italiana.
      </p>
    </LegalPage>
  );
}
