/**
 * FASE 5.4 — REDAZIONE lato SERVER dei log prima che raggiungano il browser (§5.4).
 * Difesa in profondità: gli eventi nostri sono già scritti redatti, ma i log di
 * Render e le query di pg_stat possono contenere token/indirizzi/segreti. La
 * redazione avviene QUI (server), mai delegata al client. Il FE poi rende tutto come
 * TESTO (nessun HTML), quindi anche un eventuale `<script>` resta inerte.
 */

/** Maschera indirizzi email (tiene il dominio), Bearer token e stringhe-segreto lunghe. */
export function redactText(input: string): string {
  let s = input;
  // Email → ***@dominio
  s = s.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "***@$2");
  // Authorization: Bearer <token>  /  api-key: <...>
  s = s.replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1***");
  s = s.replace(/((?:api-key|authorization|x-api-key)\s*[:=]\s*)[^\s,;]+/gi, "$1***");
  // Sequenze esadecimali lunghe (es. sha256) → [redacted]
  s = s.replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted]");
  // Token opachi base64url lunghi → [redacted]
  s = s.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
  return s;
}

const SECRET_KEY = /(token|password|secret|api[-_]?key|authorization|ip_?hash|hash)/i;

/** Redige ricorsivamente un valore JSON: stringhe passate a redactText; chiavi
 *  "sensibili" mascherate del tutto. Limita la profondità per sicurezza. */
export function redactMeta(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactMeta(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "***" : redactMeta(v, depth + 1);
    }
    return out;
  }
  return value;
}
