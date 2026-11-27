#!/usr/bin/env bash
# Сборка APK без Android Studio: aapt + javac + dx + zipalign + apksigner (пакеты Ubuntu:
# aapt android-sdk-platform-23 dalvik-exchange zipalign apksigner).
# Использование: android/build.sh [папка_сборки]  ->  dist/halflife-calc.apk
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
B="${1:-$(mktemp -d)}"
SDK=/usr/lib/android-sdk
JAR="$SDK/platforms/android-23/android.jar"
DX="$(ls -d $SDK/build-tools/*/ | head -1)dx"
rm -rf "$B"; mkdir -p "$B"/{gen,obj,assets/www,res/drawable,res/values}
cp -r "$ROOT/web/." "$B/assets/www/"
rm -f "$B/assets/www/sw.js.map"
cp "$HERE/res/values/strings.xml" "$B/res/values/"
ICON="$ROOT/web/icon-192.png"; [ -f "$ICON" ] || ICON="$HERE/icon-fallback.png"
cp "$ICON" "$B/res/drawable/icon.png"
aapt package -f -m -J "$B/gen" -M "$HERE/AndroidManifest.xml" -S "$B/res" -I "$JAR"
javac --release 8 -nowarn -classpath "$JAR" -d "$B/obj" -sourcepath "$HERE/src:$B/gen" \
  "$HERE/src/ru/halflife/calc/MainActivity.java" "$B/gen/ru/halflife/calc/R.java" 2>&1 | grep -v "^warning\|^Note" || true
"$DX" --dex --output="$B/classes.dex" "$B/obj"
aapt package -f -M "$HERE/AndroidManifest.xml" -S "$B/res" -A "$B/assets" -I "$JAR" -F "$B/unsigned.apk"
(cd "$B" && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f 4 "$B/unsigned.apk" "$B/aligned.apk"
KS="$HERE/release.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass halflife -keypass halflife -alias halflife \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Halflife Calc, O=Lab, C=RU" >/dev/null 2>&1
fi
mkdir -p "$ROOT/dist"
apksigner sign --ks "$KS" --ks-pass pass:halflife --key-pass pass:halflife --out "$ROOT/dist/halflife-calc.apk" "$B/aligned.apk"
rm -f "$ROOT/dist/halflife-calc.apk.idsig"
apksigner verify "$ROOT/dist/halflife-calc.apk" && ls -la "$ROOT/dist/halflife-calc.apk"
