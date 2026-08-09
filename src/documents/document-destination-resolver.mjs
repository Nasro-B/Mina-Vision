import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export function createDocumentDestinationResolver({ resolveExistingPath, authorizeDestination } = {}) {
  if (typeof resolveExistingPath !== 'function' || typeof authorizeDestination !== 'function') {
    throw new TypeError('document_destination_resolver_dependencies_required');
  }

  return Object.freeze({
    resolve: (target) => resolveExistingPath(target),

    async resolveDestination(destination) {
      if (typeof destination !== 'string' || !isAbsolute(destination) || destination.startsWith('\\\\')) {
        throw new Error('document_destination_absolute_path_required');
      }
      const requested = resolve(destination);
      const filename = basename(requested);
      if (!filename || filename === '.' || filename === '..') throw new Error('document_destination_filename_invalid');

      const parent = await resolveExistingPath(dirname(requested));
      const canonicalTarget = join(parent, filename);
      const authorized = await authorizeDestination(canonicalTarget);
      if (typeof authorized !== 'string' || resolve(authorized) !== resolve(canonicalTarget)) {
        throw new Error('document_destination_authorization_mismatch');
      }
      return canonicalTarget;
    },
  });
}
