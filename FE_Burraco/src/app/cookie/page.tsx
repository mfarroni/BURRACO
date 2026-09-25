import type { Metadata } from "next";
import { LegalPage, Recapito } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Cookie e memoria del browser — Burraco, Circolo Nettuno",
  description: "Il sito non usa cookie di profilazione: solo memoria tecnica del browser per farti giocare.",
};

/*
 * Informativa cookie / memoria del browser — Audit lancio R08. Elenca le chiavi
 * REALMENTE usate dal frontend (lib/sessionIdentity.ts, lib/useHandOrder.ts,
 * lib/tableInvite.ts, lib/supportPrompt.ts). Una chiave nuova va aggiunta qui.
 */
export default function CookiePage() {
  return (
    <LegalPage title="Cookie e memoria del browser">
      <p>
        Il sito <strong>non usa cookie di profilazione, pubblicità o statistiche di terze parti</strong>.
        Per questo non ti chiediamo alcun consenso con un banner.
      </p>
      <p>
        Per farti giocare, il browser conserva alcune informazioni tecniche nella sua memoria locale
        (<em>localStorage</em> e <em>sessionStorage</em>). Restano sul tuo dispositivo, servono solo al
        funzionamento del gioco e non vengono usate per seguirti su altri siti.
      </p>

      <table>
        <thead>
          <tr>
            <th scope="col">Nome</th>
            <th scope="col">Dove</th>
            <th scope="col">A cosa serve</th>
            <th scope="col">Durata</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>burraco_auth_token</code></td>
            <td>sessionStorage</td>
            <td>Tiene aperto il tuo accesso (account o ospite) in questa scheda.</td>
            <td>Fino alla chiusura della scheda o all&apos;uscita</td>
          </tr>
          <tr>
            <td><code>burraco_token_…</code></td>
            <td>sessionStorage</td>
            <td>Ti fa rientrare allo stesso posto del tavolo se ricarichi la pagina.</td>
            <td>Fino alla chiusura della scheda</td>
          </tr>
          <tr>
            <td><code>burraco_hand_order_…</code></td>
            <td>sessionStorage</td>
            <td>Ricorda l&apos;ordine in cui hai sistemato le carte in mano.</td>
            <td>Fino alla chiusura della scheda</td>
          </tr>
          <tr>
            <td><code>circolo.inviteCode</code></td>
            <td>sessionStorage</td>
            <td>Conserva il codice del tavolo di un link d&apos;invito mentre accedi.</td>
            <td>Fino all&apos;uso o alla chiusura della scheda</td>
          </tr>
          <tr>
            <td><code>burraco_client_id</code></td>
            <td>localStorage</td>
            <td>Identificativo tecnico casuale del browser, per riconoscere la stessa sessione di gioco dopo un ricaricamento.</td>
            <td>Finché non cancelli i dati del sito</td>
          </tr>
          <tr>
            <td><code>circolo.supportPrompt.v1</code></td>
            <td>localStorage</td>
            <td>Evita di riproporti troppo spesso l&apos;invito a sostenere il circolo.</td>
            <td>Finché non cancelli i dati del sito</td>
          </tr>
        </tbody>
      </table>

      <h2>Come cancellarle</h2>
      <p>
        Puoi cancellarle in qualsiasi momento dalle impostazioni del browser (voce «Cancella dati dei
        siti» o simile). Il gioco continuerà a funzionare: dovrai solo rientrare.
      </p>

      <h2>Siti esterni</h2>
      <p>
        Il pulsante «Offri un caffè» apre il sito Buy Me a Coffee, che ha le sue regole sui cookie.
        Nessun suo contenuto viene caricato nelle nostre pagine finché non lo apri.
      </p>

      <h2>Contatti</h2>
      <p>
        Per domande scrivi al titolare: <Recapito />. Le informazioni sui dati personali sono
        nell&apos;<a href="/privacy">Informativa privacy</a>.
      </p>
    </LegalPage>
  );
}
