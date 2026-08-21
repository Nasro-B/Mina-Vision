pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MinaVisionGateway"
include(":app", ":core:protocol", ":core:transport", ":core:chat", ":feature:camera", ":feature:chat", ":feature:voice", ":feature:telephony")
