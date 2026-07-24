// Scanner de dépendances des connecteurs : la dépendance `dependency_scanner` attendue par
// connector-installer. Analyse STATIQUE et déterministe du manifeste : capabilities interdites
// (déjà refusées au parse mais re-vérifiées ici — défense en profondeur), capabilities à risque
// élevé, allowlist réseau (http en clair, domaines wildcard, IP littérales), TLS. Rend des
// FINDINGS gradués — c'est la quarantaine et Nasro qui décident, le scanner n'installe rien.

const FORBIDDEN_CAPABILITIES = new Set(['shell.raw', 'fs.raw', 'ipc.raw', 'keyring.raw']);
const HIGH_RISK_PREFIXES = ['shell', 'fs.write', 'keyring', 'credentials', 'payments'];
const IP_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/u;

export function createDependencyScanner() {
  return Object.freeze({
    async scan(manifest) {
      const findings = [];

      for (const capability of manifest?.capabilities ?? []) {
        if (FORBIDDEN_CAPABILITIES.has(capability)) {
          findings.push({ kind: 'capability', subject: capability, level: 'bloquant', reason: 'capability_interdite' });
        } else if (HIGH_RISK_PREFIXES.some((prefix) => capability === prefix || capability.startsWith(`${prefix}:`) || capability.startsWith(`${prefix}.`))) {
          findings.push({ kind: 'capability', subject: capability, level: 'eleve', reason: 'capability_a_risque' });
        }
      }

      for (const host of manifest?.networkAllowlist ?? []) {
        const value = String(host);
        if (value.startsWith('http://')) {
          findings.push({ kind: 'network', subject: value, level: 'eleve', reason: 'http_en_clair' });
        }
        const bare = value.replace(/^https?:\/\//u, '').split('/')[0];
        if (bare === '*' || bare.startsWith('*.')) {
          findings.push({ kind: 'network', subject: value, level: 'eleve', reason: 'domaine_wildcard' });
        }
        if (IP_LITERAL.test(bare)) {
          findings.push({ kind: 'network', subject: value, level: 'moyen', reason: 'ip_litterale' });
        }
      }

      if (manifest?.tlsRequired === false) {
        findings.push({ kind: 'transport', subject: 'tlsRequired', level: 'eleve', reason: 'tls_non_exige' });
      }

      if ((manifest?.secrets ?? []).length > 0 && (manifest?.networkAllowlist ?? []).length === 0) {
        findings.push({ kind: 'secrets', subject: 'secrets_sans_reseau', level: 'moyen', reason: 'secrets_declares_sans_destination_reseau' });
      }

      return Object.freeze(findings.map((finding) => Object.freeze(finding)));
    },
  });
}
