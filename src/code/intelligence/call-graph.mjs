// Graphe d'appels : arêtes appelant → appelé entre identifiants de symboles, parcours borné en
// profondeur, plus court chemin (BFS) et détection de cycles (DFS coloré).

const MAX_DEPTH = 20;

export function createCallGraph() {
  const forward = new Map();
  const backward = new Map();
  const edges = [];

  const bucket = (map, key) => {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  };

  function traverse(startId, adjacency, depth) {
    const limit = Math.min(Number.isFinite(depth) && depth > 0 ? depth : MAX_DEPTH, MAX_DEPTH);
    const chains = [];
    const visited = new Set([startId]);
    const queue = [{ id: startId, chain: [] }];
    while (queue.length > 0) {
      const { id, chain } = queue.shift();
      if (chain.length >= limit) continue;
      for (const next of adjacency.get(id) ?? []) {
        const nextChain = [...chain, next];
        chains.push(Object.freeze(nextChain));
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, chain: nextChain });
        }
      }
    }
    return Object.freeze(chains);
  }

  return Object.freeze({
    addEdge({ callerId, calleeId, callSite = null } = {}) {
      if (typeof callerId !== 'string' || typeof calleeId !== 'string' || !callerId || !calleeId) {
        throw new Error('call_graph_edge_invalid');
      }
      bucket(forward, callerId).add(calleeId);
      bucket(backward, calleeId).add(callerId);
      edges.push(Object.freeze({ callerId, calleeId, callSite }));
    },

    callers: (symbolId, depth) => traverse(symbolId, backward, depth),
    callees: (symbolId, depth) => traverse(symbolId, forward, depth),

    shortestPath(fromId, toId) {
      if (fromId === toId) return Object.freeze([fromId]);
      const previous = new Map([[fromId, null]]);
      const queue = [fromId];
      while (queue.length > 0) {
        const current = queue.shift();
        for (const next of forward.get(current) ?? []) {
          if (previous.has(next)) continue;
          previous.set(next, current);
          if (next === toId) {
            const path = [toId];
            let cursor = current;
            while (cursor !== null) {
              path.unshift(cursor);
              cursor = previous.get(cursor);
            }
            return Object.freeze(path);
          }
          queue.push(next);
        }
      }
      return null;
    },

    findCycles() {
      const cycles = [];
      const colors = new Map();
      const stack = [];
      const seenCycles = new Set();

      function visit(node) {
        colors.set(node, 'gray');
        stack.push(node);
        for (const next of forward.get(node) ?? []) {
          const color = colors.get(next);
          if (color === 'gray') {
            const start = stack.indexOf(next);
            const cycle = stack.slice(start);
            const key = [...cycle].sort().join('→');
            if (!seenCycles.has(key)) {
              seenCycles.add(key);
              cycles.push(Object.freeze([...cycle, next]));
            }
          } else if (color === undefined) {
            visit(next);
          }
        }
        stack.pop();
        colors.set(node, 'black');
      }

      for (const node of forward.keys()) {
        if (!colors.has(node)) visit(node);
      }
      return Object.freeze(cycles);
    },

    toDot({ focusSymbolId } = {}) {
      const lines = ['digraph appels {'];
      for (const edge of edges) {
        if (focusSymbolId && edge.callerId !== focusSymbolId && edge.calleeId !== focusSymbolId) continue;
        lines.push(`  "${edge.callerId}" -> "${edge.calleeId}";`);
      }
      lines.push('}');
      return lines.join('\n');
    },

    stats: () => Object.freeze({ nodes: new Set([...forward.keys(), ...backward.keys()]).size, edges: edges.length }),
  });
}
