// AGP 9 compiles Kotlin itself. Declaring the Kotlin plugin here (not applied) pins the
// Kotlin Gradle plugin version so it matches the Compose compiler plugin Glance needs.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
