import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Google Services n'est appliqué que si le google-services.json du projet Firebase existant est
// présent — l'APK compile sans, Firebase reste optionnel jusqu'à la vague qui le branche.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
    // La variante debug isolée n'a volontairement aucun client Firebase provisionné.
    tasks.matching { it.name == "processDebugGoogleServices" }.configureEach {
        enabled = false
    }
}

android {
    namespace = "fr.mina.gateway"
    compileSdk = 36

    defaultConfig {
        applicationId = "fr.mina.gateway"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        javaCompileOptions {
            annotationProcessorOptions {
                arguments["room.schemaLocation"] = "$projectDir/schemas"
            }
        }
    }

    buildTypes {
        getByName("debug") {
            // L'instrumentation ne doit jamais remplacer la passerelle active du téléphone.
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

// Emballe l'APK sous un nom lisible pour la distribution (GitHub Release / sideload) :
// « Mina Vision.apk » au lieu de « app-debug.apk ». Tâche Copy AUTONOME — elle ne touche ni au bloc
// android{} ni à l'API de variantes, donc elle ne peut pas altérer le build lui-même.
//
// ⚠️ Source = build DEBUG (le seul installable tant qu'aucun keystore de release n'est configuré) :
//    signé avec la clé debug d'Android → parfait pour le sideload (« sources inconnues »), mais PAS
//    une signature Play Store. La release signée reste une décision Nasro (ajout d'un signingConfig).
tasks.register<Copy>("packageMinaApk") {
    group = "distribution"
    description = "Copie l'APK debug sous le nom « Mina Vision.apk » dans build/dist/ pour la GitHub Release."
    dependsOn("assembleDebug")
    from(layout.buildDirectory.dir("outputs/apk/debug"))
    include("app-debug.apk")
    into(layout.buildDirectory.dir("dist"))
    rename { "Mina Vision.apk" }
    doLast {
        val out = layout.buildDirectory.dir("dist").get().file("Mina Vision.apk").asFile
        println("APK prêt pour distribution : ${out.absolutePath}")
    }
}

dependencies {
    implementation(project(":core:protocol"))
    implementation(project(":core:transport"))
    implementation(project(":core:chat"))
    implementation(project(":feature:camera"))
    implementation(project(":feature:chat"))
    implementation(project(":feature:voice"))
    implementation(platform(libs.firebase.bom))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.firebase:firebase-installations")
    implementation("com.google.firebase:firebase-appcheck")
    implementation("com.google.firebase:firebase-appcheck-playintegrity")
    debugImplementation("com.google.firebase:firebase-appcheck-debug")
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.biometric)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.zxing.core)
    debugImplementation(libs.androidx.compose.ui.tooling)
    implementation("androidx.room:room-runtime:2.8.4")
    annotationProcessor("androidx.room:room-compiler:2.8.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.room:room-testing:2.8.4")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
}
