export function createCompositeSkillRuntime({
  primaryRegistry,
  primaryLoader,
  bundledRegistry,
  bundledLoader,
} = {}) {
  if (!primaryRegistry?.scan || !primaryRegistry?.list || !primaryLoader?.load
    || !bundledRegistry?.scan || !bundledRegistry?.list || !bundledLoader?.load) {
    throw new TypeError('composite_skill_runtime_dependencies_required');
  }
  let entries = [];
  let sources = new Map();

  async function refresh() {
    await Promise.all([primaryRegistry.scan(), bundledRegistry.scan()]);
    const merged = new Map();
    const nextSources = new Map();
    for (const entry of bundledRegistry.list()) {
      merged.set(entry.name, entry);
      nextSources.set(entry.slug, bundledLoader);
    }
    for (const entry of primaryRegistry.list()) {
      const replaced = merged.get(entry.name);
      if (replaced) nextSources.delete(replaced.slug);
      merged.set(entry.name, entry);
      nextSources.set(entry.slug, primaryLoader);
    }
    entries = [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
    sources = nextSources;
    return Object.freeze([...entries]);
  }

  const registry = Object.freeze({
    list: () => Object.freeze([...entries]),
    get: (name) => entries.find((entry) => entry.name === name) ?? null,
  });
  const loader = Object.freeze({
    load: (slug) => {
      const source = sources.get(slug);
      if (!source) throw new Error(`skill_unavailable:${slug}`);
      return source.load(slug);
    },
  });

  return Object.freeze({ refresh, registry, loader });
}
