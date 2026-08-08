import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('bootstrap Android chat', () => {
  it('déclare les trois modules et garde Firebase optionnel', async () => {
    const settings = await readFile(new URL('../android/settings.gradle.kts', import.meta.url), 'utf8');
    const app = await readFile(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');
    const transport = await readFile(new URL('../android/core/transport/build.gradle.kts', import.meta.url), 'utf8');
    const featureChat = await readFile(new URL('../android/feature/chat/build.gradle.kts', import.meta.url), 'utf8');
    expect(settings).toContain('":core:chat"');
    expect(settings).toContain('":feature:chat"');
    expect(settings).toContain('":feature:voice"');
    expect(app).toContain('file("google-services.json").exists()');
    expect(app).toContain('implementation(platform(libs.firebase.bom))');
    expect(app).toContain('implementation(project(":feature:chat"))');
    expect(app).toContain('debugImplementation("com.google.firebase:firebase-appcheck-debug")');
    expect(transport).toContain('implementation("com.google.firebase:firebase-firestore")');
    expect(app).not.toContain('firebase-auth-ktx');
    expect(transport).not.toContain('-ktx');
    expect(featureChat).toContain('testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"');
    expect(app.match(/firebase-appcheck-debug/g)).toHaveLength(1);
    const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
    expect(gitignore).toContain('android/app/google-services.json');
  });
});
