import { join } from 'node:path';

function hasExplicitUserDataDirectory(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== 'string') continue;
    if (argument.startsWith('--user-data-dir=')) return argument.length > '--user-data-dir='.length;
    if (argument === '--user-data-dir' && typeof argv[index + 1] === 'string' && argv[index + 1].length > 0) return true;
  }
  return false;
}

export function resolveUserDataStrategy({ argv = [], appDataPath, productName = 'Mina Vision' } = {}) {
  if (!Array.isArray(argv)) throw new TypeError('user_data_argv_invalid');
  if (typeof appDataPath !== 'string' || appDataPath.length === 0) throw new TypeError('user_data_app_data_path_invalid');
  if (typeof productName !== 'string' || productName.length === 0) throw new TypeError('user_data_product_name_invalid');

  return Object.freeze({
    preserveExplicitUserData: hasExplicitUserDataDirectory(argv),
    namedUserData: join(appDataPath, productName),
  });
}
