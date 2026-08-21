import { describe, expect, it } from 'vitest';
import { createDeployPolicy } from '../src/code/lifecycle/deploy-policy.mjs';

describe('deploy-policy (cycle de vie T3.4)', () => {
  const policy = createDeployPolicy();

  it('build vert + env présentes → prêt, commande exacte, attend le feu vert (jamais auto)', () => {
    const r = policy.prepare({ target: 'vercel', buildStatus: 'green', requiredEnv: ['API_KEY'], presentEnv: ['API_KEY'] });
    expect(r).toMatchObject({ ready: true, refused: false, target: 'vercel', command: 'vercel deploy --prod', awaitingApproval: true });
    expect(r.missingEnv).toEqual([]);
  });

  it('REFUSE si build rouge (jamais de deploy sur build non vert)', () => {
    const r = policy.prepare({ target: 'vercel', buildStatus: 'red' });
    expect(r).toMatchObject({ ready: false, refused: true, reason: 'build_non_vert' });
  });

  it('variables manquantes → pas prêt, NOMS listés (jamais les valeurs)', () => {
    const r = policy.prepare({ target: 'render', buildStatus: 'green', requiredEnv: ['DB_URL', 'SECRET'], presentEnv: ['DB_URL'] });
    expect(r.ready).toBe(false);
    expect(r.missingEnv).toEqual(['SECRET']);
    expect(r.note).toContain('SECRET'); // le NOM
  });

  it('cible inconnue → refus net', () => {
    expect(policy.prepare({ target: 'heroku', buildStatus: 'green' })).toMatchObject({ refused: true, reason: 'cible_inconnue' });
  });

  it('AUCUN token/valeur secrète dans la sortie (seulement des noms + une commande CLI générique)', () => {
    const r = policy.prepare({ target: 'cloudflare', buildStatus: 'green', requiredEnv: ['CF_API_TOKEN'], presentEnv: ['CF_API_TOKEN'] });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toMatch(/[a-f0-9]{32,}/u); // aucune valeur ressemblant à un token
    expect(r.command).toBe('wrangler deploy'); // commande sans secret
    expect(r.awaitingApproval).toBe(true);
  });
});
