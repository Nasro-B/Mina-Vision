import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const android = (path) => readFile(new URL(`../android/${path}`, import.meta.url), 'utf8');

describe('contrat Android de réveil chat opaque', () => {
  it('garde FCM/Analytics en opt-in et ne fait pas de synchronisation directe depuis le service', async () => {
    const [manifest, service, scheduler, engine] = await Promise.all([
      android('app/src/main/AndroidManifest.xml'),
      android('app/src/main/kotlin/fr/mina/gateway/chat/MinaChatMessagingService.kt'),
      android('app/src/main/kotlin/fr/mina/gateway/chat/ChatSyncScheduler.kt'),
      android('core/chat/src/main/kotlin/fr/mina/gateway/chat/ChatEngine.kt'),
    ]);

    expect(manifest).toContain('firebase_messaging_auto_init_enabled" android:value="false"');
    expect(manifest).toContain('firebase_analytics_collection_enabled" android:value="false"');
    expect(manifest).toContain('firebase_messaging_installation_id_enabled" android:value="true"');
    expect(service).toContain('FcmSyncSignal.parse');
    expect(service).toContain('resolveFcmSyncTarget');
    expect(engine).toContain('FirebaseFcmSession.resolve');
    expect(service).toContain('onDeletedMessages');
    expect(service).not.toContain('syncOnce()');
    expect(service).not.toContain('onNewToken');
    expect(scheduler).toContain('enqueueUniqueWork');
    expect(scheduler).toContain('NetworkType.CONNECTED');
  });
});
