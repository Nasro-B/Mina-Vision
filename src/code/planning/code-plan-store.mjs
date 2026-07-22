// Persistance des plans : un JSON par plan dans un dossier dédié, écritures séquencées
// (même discipline que le journal d'activité), suppression = archivage explicite.

export function createCodePlanStore({ fs, directory } = {}) {
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function'
    || typeof fs.readdir !== 'function' || typeof fs.mkdir !== 'function' || typeof fs.rm !== 'function') {
    throw new TypeError('code_plan_store_fs_required');
  }
  if (typeof directory !== 'string' || directory.length === 0) throw new TypeError('code_plan_store_directory_required');

  const base = directory.replace(/[\\/]+$/u, '');
  const pathFor = (id) => `${base}/plan-${id}.json`;
  const archivePathFor = (id) => `${base}/archive-plan-${id}.json`;
  let ready = null;
  const ensureDirectory = () => {
    ready ??= fs.mkdir(base, { recursive: true }).catch(() => {});
    return ready;
  };
  let writing = Promise.resolve();
  const enqueue = (operation) => {
    const next = writing.then(() => ensureDirectory()).then(operation);
    writing = next.catch(() => {});
    return next;
  };

  const validId = (id) => {
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/u.test(id)) throw new Error('code_plan_store_id_invalid');
    return id;
  };

  async function get(id) {
    validId(id);
    try {
      return JSON.parse(String(await fs.readFile(pathFor(id), 'utf8')));
    } catch {
      return null;
    }
  }

  return Object.freeze({
    async save(plan) {
      if (!plan || typeof plan.id !== 'string') throw new Error('code_plan_store_plan_invalid');
      validId(plan.id);
      await enqueue(() => fs.writeFile(pathFor(plan.id), JSON.stringify(plan, null, 2), 'utf8'));
      return plan;
    },

    get,

    async list() {
      try {
        const entries = await fs.readdir(base);
        const plans = [];
        for (const entry of entries) {
          const match = String(entry).match(/^plan-([\w-]+)\.json$/u);
          if (!match) continue;
          try {
            const plan = JSON.parse(String(await fs.readFile(`${base}/${entry}`, 'utf8')));
            plans.push(Object.freeze({ id: plan.id, title: plan.title, status: plan.status, updatedAt: plan.updatedAt }));
          } catch {
            // Fichier corrompu ignoré : la liste reste utilisable.
          }
        }
        return Object.freeze(plans.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
      } catch {
        return Object.freeze([]);
      }
    },

    archive(id) {
      validId(id);
      return enqueue(async () => {
        const content = await fs.readFile(pathFor(id), 'utf8').catch(() => null);
        if (content === null) throw new Error(`code_plan_store_unknown: ${id}`);
        await fs.writeFile(archivePathFor(id), content, 'utf8');
        await fs.rm(pathFor(id), { force: true });
        return JSON.parse(String(content));
      });
    },
  });
}
