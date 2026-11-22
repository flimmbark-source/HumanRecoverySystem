#!/usr/bin/env bash
# Builds android/build/Weave.apk from the device build (npm run build:device) with the Android build tools
# only, no Gradle. Set:
#   ANDROID_JAR  android.jar of a platform from API 23 up, e.g. $ANDROID_HOME/platforms/android-35/android.jar
#   BUILD_TOOLS  a folder with aapt2, zipalign, apksigner and d8, e.g. $ANDROID_HOME/build-tools/35.0.0.
#                Without d8 there, dalvik-exchange (dx) is used: on Debian or Ubuntu all tools come from
#                apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
#                with ANDROID_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
#                and BUILD_TOOLS=/usr/lib/android-sdk/build-tools/debian
# WEAVE_DEBUGGABLE=1 makes a debuggable APK, for the emulator test only. Never publish one.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_JAR:?Set ANDROID_JAR}" "${BUILD_TOOLS:?Set BUILD_TOOLS}"
[ -f ../dist/device/index.html ] || { echo "Run npm run build:device first." >&2; exit 1; }
# Android installs an update only if its version code is not lower. The code counts commits, so it needs all of them.
[ "$(git rev-parse --is-shallow-repository)" = false ] || { echo "Fetch the full git history first (git fetch --unshallow)." >&2; exit 1; }

VERSION_CODE=$(git rev-list --count HEAD)
VERSION_NAME="$(node -p "require('../package.json').version.split('.').slice(0, 2).join('.')").$VERSION_CODE"
B=build
rm -rf "$B" && mkdir -p "$B/assets" "$B/classes" "$B/dex"
cp -R ../dist/device "$B/assets/www"

"$BUILD_TOOLS/aapt2" compile --dir res -o "$B/res.zip"
"$BUILD_TOOLS/aapt2" link -o "$B/unsigned.apk" -I "$ANDROID_JAR" --manifest AndroidManifest.xml -A "$B/assets" \
  --min-sdk-version 26 --target-sdk-version 35 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  ${WEAVE_DEBUGGABLE:+--debug-mode} "$B/res.zip"

javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -Xlint:-options -d "$B/classes" $(find src -name '*.java')
if [ -x "$BUILD_TOOLS/d8" ]; then
  "$BUILD_TOOLS/d8" --release --min-api 26 --lib "$ANDROID_JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')
else
  dalvik-exchange --dex --min-sdk-version=26 --output="$B/dex/classes.dex" "$B/classes"
fi
(cd "$B/dex" && zip -q -X ../unsigned.apk classes.dex)

# The key is in the repository, so that every build, here or on GitHub, can update an installed app
# without losing its data. See docs/ANDROID.md before you share the app outside your team.
"$BUILD_TOOLS/zipalign" -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"
"$BUILD_TOOLS/apksigner" sign --ks weave.keystore --ks-pass pass:weave-android --out "$B/Weave.apk" "$B/aligned.apk"
"$BUILD_TOOLS/apksigner" verify "$B/Weave.apk"
echo "Built android/$B/Weave.apk (version $VERSION_NAME, code $VERSION_CODE)"
