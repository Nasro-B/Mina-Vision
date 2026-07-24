import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path) => readFile(new URL(`../android/${path}`, import.meta.url), 'utf8');

describe('Android Kotlin gateway bootstrap', () => {
  it('declares one app and the protocol/transport modules with pinned toolchain versions', async () => {
    const [settings, catalog, appBuild] = await Promise.all([
      read('settings.gradle.kts'), read('gradle/libs.versions.toml'), read('app/build.gradle.kts'),
    ]);
    // Les modules du chat natif (core:chat, feature:chat, feature:voice) ont été ajoutés le
    // 2026-07-23 (Task 1 du plan chat natif) : on vérifie la présence de chaque module plutôt
    // qu'une liste figée, pour que l'ajout d'un module ne casse pas ce contrat de toolchain.
    for (const module of ['":app"', '":core:protocol"', '":core:transport"', '":feature:camera"']) {
      expect(settings).toContain(module);
    }
    expect(catalog).toContain('agp = "8.13.2"');
    expect(catalog).toContain('kotlin = "2.3.21"');
    expect(appBuild).toContain('namespace = "fr.mina.gateway"');
    expect(appBuild).toContain('applicationId = "fr.mina.gateway"');
    expect(appBuild).toContain('compileSdk = 36');
    expect(appBuild).toContain('minSdk = 29');
    expect(appBuild).toContain('targetSdk = 35');
  });

  it('starts only a visible launcher activity and contains no embedded production secret', async () => {
    const [manifest, activity, properties] = await Promise.all([
      read('app/src/main/AndroidManifest.xml'),
      read('app/src/main/kotlin/fr/mina/gateway/MainActivity.kt'),
      read('gradle.properties'),
    ]);
    expect(manifest).toContain('android.intent.category.LAUNCHER');
    expect(manifest).toContain('android:launchMode="singleTop"');
    // Accueil réécrit en Compose le 2026-07-24 (fin de la « page tokens ») : MainActivity est
    // désormais une ComponentActivity, le libellé du bouton a été raccourci, et le filtre numérique
    // des IDs Telegram passe par Compose (KeyboardType.Number + filter) au lieu de DigitsKeyListener.
    expect(activity).toContain('class MainActivity : ComponentActivity()');
    expect(activity).toContain('Mina Vision');
    expect(activity).toContain('Enregistrer et chiffrer');
    expect(activity).toContain("c.isDigit() || c == ','");
    expect(activity).toContain('restartGatewayService()');
    expect(activity).toContain('stopService(Intent(this, MinaGatewayService::class.java))');
    expect(activity).toContain('AndroidKeystoreFieldCipher');
    expect(activity).toContain('createProof("local-pairing-v1")');
    expect(activity).toContain('device-identity.json');
    expect(activity).toContain('CameraStreamService.ACTION_START');
    expect(activity).toContain('Manifest.permission.CAMERA');
    expect(activity).toContain('stopService(Intent(this, CameraStreamService::class.java))');
    expect(manifest).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
    expect(manifest).toContain('.messaging.GatewayBootReceiver');
    expect(manifest).toContain('android.intent.action.BOOT_COMPLETED');
    expect(manifest).toContain('.messaging.GatewayKeepaliveReceiver');
    expect(manifest).toContain('android:permission="android.permission.DUMP"');
    const bootReceiver = await read('app/src/main/kotlin/fr/mina/gateway/messaging/GatewayBootReceiver.kt');
    expect(bootReceiver).toContain('context.startForegroundService');
    expect(bootReceiver).toContain('Intent.ACTION_BOOT_COMPLETED');
    const keepaliveReceiver = await read('app/src/main/kotlin/fr/mina/gateway/messaging/GatewayKeepaliveReceiver.kt');
    expect(keepaliveReceiver).toContain('fr.mina.gateway.action.KEEPALIVE');
    expect(keepaliveReceiver).toContain('context.startForegroundService');
    expect(`${manifest}\n${activity}\n${properties}`).not.toMatch(/TELEGRAM_BOT_TOKEN|FIREBASE_PRIVATE_KEY|BEGIN PRIVATE KEY/iu);
  });
});
