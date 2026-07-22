// Graphe de dépendances fichier → fichier (imports résolus). Fournit la fermeture transitive,
// l'ordre topologique (tolérant aux cycles, cycles signalés séparément) et l'analyse « affecté par ».

export function createDependencyGraph() {
  const dependsOn = new Map();
  const requiredBy = new Map();

  const bucket = (map, key) => {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  };

  const closure = (start, adjacency) => {
    const visited = new Set();
    const queue = [...(adjacency.get(start) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...(adjacency.get(current) ?? []));
    }
    return Object.freeze([...visited]);
  };

  return Object.freeze({
    setFile(filePath, dependencies = []) {
      if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('dependency_graph_file_required');
      const previous = dependsOn.get(filePath) ?? new Set();
      for (const target of previous) requiredBy.get(target)?.delete(filePath);
      const next = new Set(dependencies.filter((dep) => typeof dep === 'string' && dep.length > 0 && dep !== filePath));
      dependsOn.set(filePath, next);
      for (const target of next) bucket(requiredBy, target).add(filePath);
    },

    removeFile(filePath) {
      const previous = dependsOn.get(filePath);
      if (previous) for (const target of previous) requiredBy.get(target)?.delete(filePath);
      dependsOn.delete(filePath);
      requiredBy.delete(filePath);
    },

    directDependencies: (filePath) => Object.freeze([...(dependsOn.get(filePath) ?? [])]),
    transitiveDependencies: (filePath) => closure(filePath, dependsOn),
    dependents: (filePath) => Object.freeze([...(requiredBy.get(filePath) ?? [])]),

    affectedBy(changedFiles) {
      if (!Array.isArray(changedFiles)) throw new Error('dependency_graph_changed_files_required');
      const affected = new Set();
      for (const file of changedFiles) {
        for (const dependent of closure(file, requiredBy)) affected.add(dependent);
      }
      for (const file of changedFiles) affected.delete(file);
      return Object.freeze([...affected]);
    },

    topologicalSort() {
      const files = new Set([...dependsOn.keys(), ...requiredBy.keys()]);
      const inDegree = new Map();
      for (const file of files) inDegree.set(file, 0);
      // Degré entrant = nombre de dépendances (les feuilles sans dépendance sortent en premier).
      for (const [file, deps] of dependsOn.entries()) {
        inDegree.set(file, [...deps].filter((dep) => files.has(dep)).length);
      }
      const queue = [...files].filter((file) => (inDegree.get(file) ?? 0) === 0).sort();
      const ordered = [];
      while (queue.length > 0) {
        const current = queue.shift();
        ordered.push(current);
        for (const dependent of requiredBy.get(current) ?? []) {
          inDegree.set(dependent, inDegree.get(dependent) - 1);
          if (inDegree.get(dependent) === 0) queue.push(dependent);
        }
      }
      // Cycles : les fichiers restants sont ajoutés en fin, ordre stable.
      for (const file of [...files].sort()) {
        if (!ordered.includes(file)) ordered.push(file);
      }
      return Object.freeze(ordered);
    },

    findCircularImports() {
      const cycles = [];
      const colors = new Map();
      const stack = [];
      const seen = new Set();

      function visit(node) {
        colors.set(node, 'gray');
        stack.push(node);
        for (const next of dependsOn.get(node) ?? []) {
          const color = colors.get(next);
          if (color === 'gray') {
            const cycle = stack.slice(stack.indexOf(next));
            const key = [...cycle].sort().join('→');
            if (!seen.has(key)) {
              seen.add(key);
              cycles.push(Object.freeze([...cycle, next]));
            }
          } else if (color === undefined) {
            visit(next);
          }
        }
        stack.pop();
        colors.set(node, 'black');
      }

      for (const node of dependsOn.keys()) {
        if (!colors.has(node)) visit(node);
      }
      return Object.freeze(cycles);
    },

    stats: () => Object.freeze({
      files: new Set([...dependsOn.keys(), ...requiredBy.keys()]).size,
      edges: [...dependsOn.values()].reduce((total, deps) => total + deps.size, 0),
    }),
  });
}
