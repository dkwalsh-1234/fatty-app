import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    // Glance widgets are composables, so they need the Compose compiler.
    alias(libs.plugins.kotlin.compose)
}

// The web app's address comes from fatty.properties (git-ignored), so it isn't committed.
val fattyProps = Properties().apply {
    rootProject.file("fatty.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun fattyProp(name: String): String = fattyProps.getProperty(name)?.trim().orEmpty()

android {
    namespace = "app.fatty"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.fatty"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "FATTY_BASE_URL", "\"${fattyProp("FATTY_BASE_URL").trimEnd('/')}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Sideloaded personal app: sign release with the local debug key so it installs directly.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.health.connect)

    implementation(libs.glance.appwidget)
    implementation(libs.datastore.preferences)
    implementation(libs.work.runtime.ktx)

    testImplementation(libs.junit)
    testImplementation(libs.org.json)
}
