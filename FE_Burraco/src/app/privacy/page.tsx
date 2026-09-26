import type { Metadata } from "next";
import { LegalPage, Recapito } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Informativa privacy — Burraco, Circolo Nettuno",
  description: "Quali dati tratta il Circolo Nettuno, perché, per quanto tempo e come esercitare i tuoi diritti.",
};

/*
 * Informativa privacy (art. 13 GDPR) — Audit lancio R01. Il testo descrive ciò che il
 * codice fa DAVVERO (auth, statistiche, contatti, email, log). Ogni modifica ai dati
 * trattati va riportata qui. Testo da far validare a un professionista prima della
 * pubblicità aperta.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Informativa privacy">
      <p>
        Questa pagina spiega quali dati personali tratta il sito Burraco del Circolo Nettuno, per
        quale motivo, per quanto tempo e come puoi chiederne la modifica o la cancellazione. Il
        circolo è gratuito, senza pubblicità e non vende dati a nessuno.
      </p>

      <h2>1. Titolare del trattamento</h2>
      <p>
        Il titolare è <Recapito />.
      </p>

      <h2>2. Quali dati trattiamo</h2>
      <ul>
        <li>
          <strong>Se giochi come ospite:</strong> il nome che scegli e le partite che giochi. Non ti
          chiediamo email né password.
        </li>
        <li>
          <strong>Se crei un account:</strong> email, nome visualizzato, password (salvata solo in
          forma cifrata irreversibile: nessuno può leggerla), foto profilo se decidi di caricarla,
          storico delle partite e statistiche.
        </li>
        <li>
          <strong>Sicurezza dell&apos;accesso:</strong> per bloccare i tentativi ripetuti di indovinare
          una password registriamo, per un periodo breve, un&apos;impronta cifrata di email e indirizzo
          IP (non l&apos;indirizzo in chiaro). I limiti di frequenza delle richieste usano l&apos;indirizzo
          IP solo nella memoria del server, senza salvarlo.
        </li>
        <li>
          <strong>Modulo Contatti:</strong> nome, email e testo del messaggio che ci scrivi, più
          un&apos;impronta cifrata dell&apos;indirizzo IP per contrastare lo spam.
        </li>
        <li>
          <strong>Registri tecnici:</strong> eventi di funzionamento del servizio (errori, accessi
          all&apos;area di amministrazione) senza password né token. I fornitori di hosting possono
          registrare dati tecnici di connessione (come l&apos;indirizzo IP) nei propri log.
        </li>
        <li>
          <strong>Clic su «Offri un caffè» e «Invita un amico»:</strong> contiamo solo quante volte
          vengono premuti, in forma anonima, senza sapere chi li ha premuti.
        </li>
      </ul>

      <h2>3. Perché li trattiamo</h2>
      <ul>
        <li>
          <strong>Farti giocare e conservare le tue partite</strong> (tavoli, punteggi, storico,
          statistiche): è il servizio che ci chiedi, base giuridica art. 6.1.b GDPR.
        </li>
        <li>
          <strong>Proteggere il servizio</strong> da abusi e accessi non autorizzati: legittimo
          interesse, art. 6.1.f GDPR.
        </li>
        <li>
          <strong>Rispondere ai tuoi messaggi</strong> e inviarti l&apos;email di benvenuto dopo la
          registrazione: art. 6.1.b GDPR.
        </li>
        <li>
          <strong>Avvisi delle serate del circolo</strong> e altre comunicazioni promozionali: solo se
          attivi tu l&apos;opzione «Avvisami via email delle serate del circolo» nel tuo Profilo. Puoi
          ritirare il consenso in ogni momento dal Profilo o con il link in fondo a ogni email.
          Art. 6.1.a GDPR.
        </li>
      </ul>

      <h2>4. Chi ci aiuta a gestire il servizio</h2>
      <p>
        Usiamo fornitori esterni che trattano i dati per nostro conto e solo per far funzionare il
        sito: <strong>Vercel</strong> (pubblicazione del sito), <strong>Render</strong> (server di
        gioco), <strong>Neon</strong> (database) e <strong>Brevo</strong> (invio delle email).
        Alcuni di questi fornitori possono trattare dati anche fuori dall&apos;Unione Europea: in quel
        caso il trasferimento avviene con le garanzie previste dal GDPR (clausole contrattuali
        standard o decisioni di adeguatezza).
      </p>
      <p>
        Il pulsante «Offri un caffè» porta al sito esterno Buy Me a Coffee: se decidi di fare
        un&apos;offerta, i dati che inserisci lì sono trattati da quel servizio secondo la sua
        informativa.
      </p>

      <h2>5. Per quanto tempo</h2>
      <ul>
        <li>Account registrato: finché non lo elimini tu o non ci chiedi di eliminarlo.</li>
        <li>Accesso da ospite: cancellato dopo 7 giorni di inattività.</li>
        <li>Registro delle singole mosse di una partita: fino a 7 giorni dalla fine della partita.</li>
        <li>Punteggi di ogni smazzata: fino a 3 mesi; riepilogo delle partite: fino a 12 mesi.</li>
        <li>Messaggi del modulo Contatti: fino a 180 giorni dopo la lettura.</li>
        <li>Registri tecnici: fino a 90 giorni.</li>
      </ul>

      <h2>6. I tuoi diritti</h2>
      <p>
        Puoi chiedere in ogni momento di accedere ai tuoi dati, correggerli, cancellarli, limitarne
        il trattamento, riceverne una copia o opporti al trattamento, scrivendo al titolare (punto
        1). Puoi <strong>eliminare da solo il tuo account</strong> dal tuo Profilo, con il pulsante
        «Elimina il mio account»: cancelliamo email, nome, foto, statistiche e messaggi, mentre le
        partite già giocate restano nello storico degli avversari come «Utente eliminato».
      </p>
      <p>
        Se ritieni che il trattamento non sia corretto puoi proporre reclamo al Garante per la
        protezione dei dati personali (<a href="https://www.garanteprivacy.it">garanteprivacy.it</a>).
      </p>

      <h2>7. Minori</h2>
      <p>
        Il servizio non è pensato per i minori di 14 anni: se hai meno di 14 anni, chiedi a un
        genitore prima di creare un account.
      </p>

      <h2>8. Cookie</h2>
      <p>
        Il sito non usa cookie di profilazione né strumenti di analisi di terze parti. I dettagli
        sono nella pagina <a href="/cookie">Cookie e memoria del browser</a>.
      </p>
    </LegalPage>
  );
}
