import { mkdirSync } from 'node:fs';
import { app } from 'electron';

const prefix = '--mina-lock-holder-user-data=';
const argument = process.argv.find((value) => value.startsWith(prefix));
const userDataDir = argument?.slice(prefix.length);

if (!userDataDir) {
  process.stderr.write('MINA_SMOKE_LOCK_HOLDER_PATH_MISSING\n');
  process.exit(2);
}

mkdirSync(userDataDir, { recursive: true });
app.setPath('userData', userDataDir);

if (!app.requestSingleInstanceLock()) {
  process.stderr.write('MINA_SMOKE_LOCK_HOLDER_LOCK_MISSING\n');
  process.exit(3);
}

app.whenReady().then(() => {
  process.stdout.write('MINA_SMOKE_LOCK_HELD\n');
  setInterval(() => {}, 1_000);
});
