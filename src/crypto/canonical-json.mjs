function sortValue(value, seen) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'undefined' || type === 'function' || type === 'symbol') {
    throw new Error('canonical_json_value_invalid');
  }
  if (type === 'number' && !Number.isFinite(value)) {
    throw new Error('canonical_json_value_invalid');
  }
  if (type !== 'object') return value;

  if (seen.has(value)) {
    throw new Error('canonical_json_cyclic_reference');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const sorted = value.map((item) => sortValue(item, seen));
    seen.delete(value);
    return sorted;
  }

  const sortedEntries = Object.keys(value)
    .sort()
    .map((key) => [key, sortValue(value[key], seen)]);
  seen.delete(value);
  return Object.fromEntries(sortedEntries);
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value, new Set()));
}
