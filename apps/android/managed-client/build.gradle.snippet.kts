// Merge into src-tauri/gen/android/app/build.gradle.kts after `tauri android init`.
// Versions are the minimums tested with; bump freely.

plugins {
  id("com.google.gms.google-services")
  id("com.huawei.agconnect")
}

android {
  sourceSets["main"].java.srcDir("../../../../../android/managed-client/src/main/java")
  sourceSets["main"].res.srcDir("../../../../../android/managed-client/src/main/res")
}

dependencies {
  implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
  implementation("com.google.firebase:firebase-messaging")
  implementation("com.google.android.gms:play-services-base:18.5.0")
  implementation("com.huawei.hms:push:6.12.0.300")
  implementation("com.huawei.agconnect:agconnect-core:1.9.1.301")
  implementation("androidx.core:core-ktx:1.13.1")
}

// settings.gradle.kts → pluginManagement.repositories / dependencyResolutionManagement.repositories:
//   maven { url = uri("https://developer.huawei.com/repo/") }
// root build.gradle.kts → plugins:
//   id("com.google.gms.google-services") version "4.4.2" apply false
//   id("com.huawei.agconnect") version "1.9.1.301" apply false
