# Android-Build (Tauri): Stolperfallen

Unverändert verschoben aus `AGENTS.md` (Anhang) am 17.11.2026. Diese Datei ist verbindlich; je nach Kontext PFLICHTlektüre (Routing in `AGENTS.md`, Index: `docs/agent-rules/README.md`).

## Android-Build (Tauri): Stolperfallen, die schon einmal Zeit gekostet haben

Stand 05.11.2026. Symptom auf dem Pixel: alte Oberfläche trotz neuem Build, später „Failed to request http://tauri.localhost/desktop.html".

1. **Das Frontend steckt in der nativen Bibliothek.** `libmaunting_smart_system_lib.so` bettet `dist-desktop` beim Rust-Build ein. Ein APK ohne neuen Rust-Lauf enthält das alte Frontend.
2. **`BuildTask.kt` überspringt Cargo, wenn die `.so` schon existiert.** Vor jedem Build mit neuem Frontend `target/aarch64-linux-android/<debug|release>/libmaunting_smart_system_lib.so` und `app/src/main/jniLibs/arm64-v8a/libmaunting_smart_system_lib.so` löschen.
3. **Ohne Feature `custom-protocol` läuft Tauri auf Mobilgeräten im Dev-Proxy-Modus** und fragt einen Entwicklungsserver ab statt der eingebetteten Dateien. Deshalb steht `default = ["custom-protocol"]` in `smart-system/src-tauri/Cargo.toml` und `BuildTask.kt` reicht `--features custom-protocol` an Cargo weiter. Beides nicht entfernen.
4. **`devUrl` bleibt aus `tauri.conf.json` heraus**, solange der Android-Build offline laufen soll. Für `tauri dev` am Desktop wird sie nur temporär gebraucht.
5. **Frontend zuerst bauen** (`npm run build:desktop` in `frontend`), danach `dist-desktop/*` nach `smart-system/src-tauri/gen/android/app/src/main/assets` kopieren, dann Rust, dann APK.
6. **Gradle braucht JDK 22** (`JAVA_HOME=C:\Program Files\Java\jdk-22`); das JRE 1.8 im Pfad hat keinen Compiler.
7. **Release-APK:** Paketname `com.mauntingstudios.smart_system` (ohne `.dev`), Signatur über den Debug-Schlüssel in `app/build.gradle.kts`. `run-as` und Cache-Löschen gehen nur bei Debug-Builds.
8. **Nach dem Packen Zeitstempel des APK prüfen.** Ein altes APK im Ausgabeordner wurde schon einmal unbemerkt neu installiert.
