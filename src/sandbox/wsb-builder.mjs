import { win32 } from 'node:path';

function canonical(path) {
  if (typeof path !== 'string' || !win32.isAbsolute(path) || path.includes('\0')) throw new TypeError('sandbox_mapped_folder_invalid');
  return win32.resolve(path).replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US');
}

function isWithin(path, root) {
  return path === root || path.startsWith(`${root}\\`);
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function mappedFolder(host, guest, readOnly) {
  return `    <MappedFolder>
      <HostFolder>${escapeXml(host)}</HostFolder>
      <SandboxFolder>${guest}</SandboxFolder>
      <ReadOnly>${readOnly ? 'true' : 'false'}</ReadOnly>
    </MappedFolder>`;
}

export function buildWsbConfig({ sourcePath, outPath, bootstrapPath } = {}, { forbiddenRoots = [] } = {}) {
  const mappings = [
    { path: sourcePath, guest: 'C:\\Mina\\src', readOnly: true },
    { path: outPath, guest: 'C:\\Mina\\out', readOnly: false },
    { path: bootstrapPath, guest: 'C:\\Mina\\bootstrap', readOnly: true },
  ].map((mapping) => ({ ...mapping, canonical: canonical(mapping.path) }));
  const forbidden = forbiddenRoots.map(canonical);
  for (const mapping of mappings) {
    if (forbidden.some((root) => isWithin(mapping.canonical, root))) throw new Error('sandbox_mapped_folder_forbidden');
  }
  for (let left = 0; left < mappings.length; left += 1) {
    for (let right = left + 1; right < mappings.length; right += 1) {
      if (isWithin(mappings[left].canonical, mappings[right].canonical)
        || isWithin(mappings[right].canonical, mappings[left].canonical)) {
        throw new Error('sandbox_mapped_folder_overlap');
      }
    }
  }
  return `<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Disable</Networking>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <ProtectedClient>Enable</ProtectedClient>
  <MappedFolders>
${mappings.map((mapping) => mappedFolder(mapping.path, mapping.guest, mapping.readOnly)).join('\n')}
  </MappedFolders>
  <LogonCommand>
    <Command>C:\\Mina\\bootstrap\\javascript\\node.exe C:\\Mina\\bootstrap\\mina-runner.mjs</Command>
  </LogonCommand>
</Configuration>
`;
}
