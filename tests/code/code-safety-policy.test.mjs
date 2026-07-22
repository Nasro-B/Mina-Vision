import { describe, expect, it } from 'vitest';
import {
  createCodeSafetyPolicy,
  isProtectedPath,
  matchBlockedCommand,
  matchConfirmCommand,
} from '../../src/code/code-safety-policy.mjs';

describe('code-safety-policy — commandes bloquées', () => {
  it.each([
    'git push',
    'git push origin main',
    'git push --force',
    'git  push --no-verify',
    'GIT PUSH ORIGIN MAIN',
    'git reset --hard HEAD~3',
    'git clean -fd',
    'rm -rf node_modules',
    'del /F /S /Q C:\\tmp',
    'psql -c "DROP TABLE users"',
    'TRUNCATE sessions',
    'npm publish',
    'docker rm -f mina',
    'kubectl delete pod mina',
    'terraform destroy -auto-approve',
  ])('bloque « %s »', (command) => {
    expect(matchBlockedCommand(command)).not.toBeNull();
    const policy = createCodeSafetyPolicy();
    expect(policy.classifyAction({ type: 'code.sandbox.run', command }).decision).toBe('block');
  });

  it('ALTER TABLE n\'est bloqué que dans sa variante destructive (… DROP)', () => {
    expect(matchBlockedCommand('ALTER TABLE users DROP COLUMN email')).toBe('alter table ... drop');
    expect(matchBlockedCommand('ALTER TABLE users ADD COLUMN email text')).toBeNull();
  });

  it('ne bloque pas les commandes de lecture ordinaires', () => {
    expect(matchBlockedCommand('git status')).toBeNull();
    expect(matchBlockedCommand('npm test')).toBeNull();
  });
});

describe('code-safety-policy — commandes à confirmation', () => {
  it.each([
    'npm install acorn',
    'npm uninstall diff',
    'git commit -m "feat(x): y"',
    'git branch -D feature',
    'git rebase main',
    'git stash drop',
    'chmod +x script.sh',
    'pip install requests',
    'cargo add serde',
    'go get github.com/x/y',
  ])('exige confirmation pour « %s »', (command) => {
    expect(matchConfirmCommand(command)).not.toBeNull();
  });

  it('la règle la plus restrictive gagne : bloqué > confirmé', () => {
    const policy = createCodeSafetyPolicy();
    const decision = policy.classifyAction({ type: 'code.sandbox.run', command: 'git commit && git push' });
    expect(decision.decision).toBe('block');
  });
});

describe('code-safety-policy — fichiers protégés', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    'config/.env',
    'certs/server.pem',
    'keys/private.key',
    '.ssh/id_rsa',
    'id_rsa.pub',
    'credentials.json',
    'gcp/service-account.json',
    'secrets/api/token.txt',
  ])('protège « %s »', (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each(['src/app.mjs', 'README.md', 'tests/env.test.mjs', 'environment.mjs'])('ne protège pas « %s »', (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });

  it('bloque l\'écriture et la suppression d\'un fichier protégé, jamais confirmable', () => {
    const policy = createCodeSafetyPolicy();
    expect(policy.classifyAction({ type: 'code.write', path: '.env' }).decision).toBe('block');
    expect(policy.classifyAction({ type: 'code.delete', path: 'secrets/token.txt' }).decision).toBe('block');
  });

  it('autorise la lecture (le broker de capacités gère la lecture ailleurs)', () => {
    const policy = createCodeSafetyPolicy();
    expect(policy.classifyAction({ type: 'code.read', path: 'src/app.mjs' }).decision).toBe('allow');
  });
});

describe('code-safety-policy — classification des actions', () => {
  const policy = createCodeSafetyPolicy();

  it('lecture → allow', () => {
    for (const type of ['code.read', 'code.search', 'code.git.status', 'code.git.diff', 'code.git.log', 'code.review', 'code.lint']) {
      expect(policy.classifyAction({ type }).decision).toBe('allow');
    }
  });

  it('écriture → confirm', () => {
    for (const type of ['code.write', 'code.diff.apply', 'code.format', 'code.refactor']) {
      expect(policy.classifyAction({ type, path: 'src/a.mjs' }).decision).toBe('confirm');
    }
  });

  it('actions sensibles → confirm', () => {
    for (const type of ['code.delete', 'code.git.commit', 'code.sandbox.run', 'code.test.run']) {
      expect(policy.classifyAction({ type }).decision).toBe('confirm');
    }
  });

  it('fail-closed : type inconnu ou action malformée → block', () => {
    expect(policy.classifyAction({ type: 'code.hack' }).decision).toBe('block');
    expect(policy.classifyAction(null).decision).toBe('block');
    expect(policy.classifyAction({}).decision).toBe('block');
  });

  it('un deny de la politique de base gagne toujours', () => {
    const denyAll = createCodeSafetyPolicy({ basePolicy: () => ({ decision: 'deny', reason: 'base_policy' }) });
    expect(denyAll.classifyAction({ type: 'code.read', path: 'src/a.mjs' }).decision).toBe('block');
  });

  it('la garde de branches bloque une opération git sur branche protégée', () => {
    const guard = { guard: (operation, branch) => ({ allowed: branch !== 'Main-Sauvegarde-V1', reason: 'branche protégée' }) };
    const policy2 = createCodeSafetyPolicy({ gitBranchGuard: guard });
    expect(policy2.classifyAction({ type: 'code.git.commit', message: 'x', branch: 'Main-Sauvegarde-V1' }).decision).toBe('block');
    expect(policy2.classifyAction({ type: 'code.git.commit', message: 'x', branch: 'feature/a' }).decision).toBe('confirm');
  });

  it('expose les listes gelées', () => {
    expect(Object.isFrozen(policy.BLOCKED_COMMANDS)).toBe(true);
    expect(Object.isFrozen(policy.CONFIRM_COMMANDS)).toBe(true);
    expect(Object.isFrozen(policy.PROTECTED_FILES)).toBe(true);
    expect(policy.BLOCKED_COMMANDS).toContain('git push');
  });
});
