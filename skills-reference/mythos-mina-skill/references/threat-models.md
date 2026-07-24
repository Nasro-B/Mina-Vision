# Threat Models Reference — Mythos SENTINEL

## Threat Taxonomy

### T1 — Authentication & Session

| Threat | Attack Vector | Severity | Detection | Mitigation |
|--------|--------------|----------|-----------|------------|
| T1.1 Credential brute force | POST /auth/login flooding | Critical | Rate limit hits, failed auth spike | Argon2id (time=3, mem=64MB), rate limit 5/min/IP, account lockout |
| T1.2 JWT algorithm confusion | alg:none or RS256→HS256 swap | Critical | Unusual JWT headers | Enforce RS256, whitelist algorithms, reject 'none' |
| T1.3 JWT secret leak | Exposed .env, logs, repos | Critical | Token reuse from different IPs | Rotate immediately, RS256 asymmetric, secrets vault |
| T1.4 Session fixation | Cookie not rotated post-login | High | Same session ID before/after login | Regenerate session ID on every privilege change |
| T1.5 Refresh token theft | XSS, MITM, insecure storage | High | Token reuse from unexpected location | Rotation + binding (IP/UA fingerprint optional), httpOnly cookie |
| T1.6 OAuth state param bypass | CSRF on OAuth callback | High | State mismatch | PKCE + random state, validate state server-side |
| T1.7 MFA bypass | OTP interception, fallback abuse | High | Auth without expected MFA step | Time-limited OTPs (30s), no SMS fallback for high-value actions |

### T2 — Authorization & Access Control

| Threat | Attack Vector | Severity | Detection | Mitigation |
|--------|--------------|----------|-----------|------------|
| T2.1 IDOR | /api/orders/123 accessed by other user | Critical | Requests for IDs not in user's scope | Always filter by user_id server-side, never trust client-provided IDs |
| T2.2 RLS bypass | Supabase service_role used client-side | Critical | Unrestricted data access | Never expose service_role to client, enforce RLS on all tables |
| T2.3 Privilege escalation | Modifying role field in request body | Critical | Unexpected role changes | Role only set server-side, never accepted from client |
| T2.4 Tenant isolation failure | Tenant A accesses Tenant B data | Critical | Cross-tenant data in responses | tenant_id RLS policy on every table, every query |
| T2.5 Missing endpoint auth | Unauthenticated API routes | High | No auth header checked | Middleware auth on ALL routes, explicit allow-list for public |
| T2.6 Stale permissions | Revoked role still in JWT | Medium | Post-revocation access | Short JWT TTL (15min), permission check on sensitive ops |

### T3 — Injection Attacks

| Threat | Attack Vector | Severity | Detection | Mitigation |
|--------|--------------|----------|-----------|------------|
| T3.1 SQL injection | Unparameterized queries | Critical | Unusual query patterns | Parameterized queries only, ORM, pg-sanitize |
| T3.2 NoSQL injection | JSON object injection in filters | High | Operators ($where, $regex) in input | Validate and sanitize all input, reject operator keys |
| T3.3 SSTI | Template literal with user input | High | Server-side template errors | Never use eval/Function with user input, use safe template engines |
| T3.4 Command injection | Shell exec with user input | Critical | Unexpected system calls | Never exec user input, use safe child_process alternatives |
| T3.5 Prompt injection | Malicious instructions in AI input | High | Model behavior change | Input sanitization, system prompt hardening, output validation |
| T3.6 XSS stored | User-generated HTML stored and rendered | High | Script execution from DB content | DOMPurify, Content-Security-Policy, output encoding |
| T3.7 XSS reflected | Unsanitized URL params reflected | Medium | Script in URL parameters | Encode all output, CSP, avoid eval |

### T4 — Data Exposure

| Threat | Attack Vector | Severity | Detection | Mitigation |
|--------|--------------|----------|-----------|------------|
| T4.1 PII in logs | User data logged with console.log | High | PII visible in log aggregator | Structured logging with PII scrubbing, never log passwords/tokens |
| T4.2 Secrets in code | API keys committed to repo | Critical | GitGuardian/truffleHog hits | .env.example only, secrets vault, git-history scan |
| T4.3 Verbose error messages | Stack traces sent to client | Medium | Error objects in API responses | Generic error messages to client, full errors to Sentry only |
| T4.4 Insecure direct object ref | Internal DB IDs exposed in URLs | Medium | Enumerable integer IDs | Use UUIDs externally, never expose sequential IDs |
| T4.5 CORS misconfiguration | Access-Control-Allow-Origin: * | High | Cross-origin requests succeed | Explicit origin whitelist, credentials: true requires specific origin |
| T4.6 Response over-fetching | API returns more fields than needed | Low | PII in response not shown in UI | Explicit field selection, serialize only required fields |

### T5 — Infrastructure & Supply Chain

| Threat | Attack Vector | Severity | Detection | Mitigation |
|--------|--------------|----------|-----------|------------|
| T5.1 Dependency confusion | Malicious npm package | High | Unexpected network calls on install | lock files, npm audit, package-lock integrity |
| T5.2 Typosquatting | lodash vs 1odash | High | Unknown package in dependency tree | Audit all dependencies, use known registries only |
| T5.3 CI/CD secret leak | Secrets in CI logs or env | Critical | Secrets visible in build output | Mask secrets in CI, least-privilege CI tokens |
| T5.4 SSRF | Fetching attacker-controlled URLs | High | Internal IP requests | Validate URLs, block private IP ranges, allowlist external domains |
| T5.5 Container escape | Privileged container, host mount | Critical | Unexpected host access | Non-root containers, no --privileged, read-only root fs |
| T5.6 Outdated dependencies | Known CVEs in used versions | Medium | npm audit / Snyk alerts | Automated dependency updates, Dependabot |

### T6 — AI-Specific Threats

| Threat | Attack Vector | Severity | Detection | Mitigation |
|--------|--------------|----------|-----------|------------|
| T6.1 Direct prompt injection | "Ignore previous instructions..." | High | Behavior change on specific inputs | System prompt hardening, output validation, instruction hierarchy |
| T6.2 Indirect prompt injection | Malicious content in retrieved docs | High | Unexpected agent actions | Sanitize RAG content, separate data from instructions |
| T6.3 Data exfiltration via AI | PII leaked through AI responses | Critical | PII patterns in AI output | Response filtering, PII detection on output |
| T6.4 Excessive agency | AI takes destructive actions | Critical | Irreversible operations | Human-in-the-loop for writes, confirmation gates |
| T6.5 Jailbreak | Persona override, roleplay abuse | Medium | Policy violations in output | Guardrails, content moderation, output classifiers |
| T6.6 Model inversion | Membership inference on training data | Low | Statistical queries returning true | Differential privacy, rate limiting on completions |
| T6.7 Context poisoning | Injecting false context into memory | High | False facts retrieved from memory | Memory validation, source attribution, TTL on memories |

---

## Security Headers Checklist

Every production app must have ALL of these:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
X-XSS-Protection: 0  (use CSP instead, this header is deprecated)
```

```typescript
// next.config.ts — production headers
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'nonce-{NONCE}'",  // use nonces for inline scripts
      "style-src 'self' 'unsafe-inline'",   // tighten if possible
      "img-src 'self' data: https:",
      "connect-src 'self' https://api.yourdomain.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];
```

---

## Rate Limiting Reference

```typescript
// Standard rate limits — adapt per endpoint sensitivity
const RATE_LIMITS = {
  // Authentication endpoints — most restrictive
  'POST /auth/login':     { requests: 5,   window: '1m',  block: '15m' },
  'POST /auth/register':  { requests: 3,   window: '1h',  block: '1h'  },
  'POST /auth/refresh':   { requests: 10,  window: '1m',  block: '5m'  },
  'POST /auth/reset':     { requests: 3,   window: '1h',  block: '1h'  },
  
  // AI endpoints — cost + abuse protection
  'POST /api/ai/*':       { requests: 20,  window: '1m',  block: '5m'  },
  'POST /api/chat':       { requests: 30,  window: '1m',  block: '10m' },
  
  // Public API — general protection
  'GET /api/*':           { requests: 100, window: '1m',  block: '1m'  },
  'POST /api/*':          { requests: 30,  window: '1m',  block: '2m'  },
  
  // Webhooks — must be validated by signature, not rate-limited aggressively
  'POST /webhooks/*':     { requests: 200, window: '1m',  block: '1m'  },
};
```

---

## JWT Security Standards

```typescript
// REQUIRED — RS256, not HS256
// Key generation: openssl genrsa -out private.pem 2048 && openssl rsa -in private.pem -pubout -out public.pem

interface JWTPayload {
  sub: string;           // user ID
  tenant_id: string;     // for multi-tenant isolation
  role: string;          // user role
  iat: number;           // issued at
  exp: number;           // MUST be short: 15 minutes for access tokens
  jti: string;           // JWT ID — for revocation tracking
}

// Access token TTL: 15 minutes
// Refresh token TTL: 7 days (httpOnly cookie, rotated on use)
// Refresh token storage: DB (for revocation) + httpOnly cookie (for transport)

// FORBIDDEN:
// - alg: 'HS256' (symmetric, secret must be shared)
// - alg: 'none' (must be explicitly rejected)
// - No exp claim (tokens that never expire)
// - Long-lived access tokens (> 1 hour)
// - Storing tokens in localStorage (XSS accessible)
```

---

## Supabase RLS Policy Templates

```sql
-- MANDATORY: Enable RLS on every table
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- User-scoped access
CREATE POLICY "user_own_data" ON your_table
  FOR ALL USING (auth.uid() = user_id);

-- Tenant isolation (multi-tenant)
CREATE POLICY "tenant_isolation" ON your_table
  FOR ALL USING (
    tenant_id = (
      SELECT tenant_id FROM profiles
      WHERE id = auth.uid()
    )
  );

-- Admin override (use sparingly — prefer explicit policies)
CREATE POLICY "admin_access" ON your_table
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Service role bypass (only for edge functions with service_role key)
-- Never expose service_role to client
```

---

## GDPR Compliance Checklist

```
GDPR MANDATORY
├── ✅ /api/users/me/export — full data export (JSON/CSV, < 30 days SLA)
├── ✅ /api/users/me/delete — right to erasure (cascade or anonymize, < 30 days SLA)
├── ✅ Consent management — explicit opt-in for analytics/marketing
├── ✅ Cookie consent — prior to any non-essential cookies
├── ✅ Data retention policy — auto-delete inactive accounts after X months
├── ✅ Third-party data flows documented (Stripe, analytics, email, etc.)
├── ✅ Privacy policy — accessible, up to date, specific
├── ✅ DPA with all processors
└── ✅ Breach notification procedure — 72h to CNIL if breach > 250 persons
```
