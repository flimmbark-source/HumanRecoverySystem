# Android app

Weave runs on an Android phone as an app. The app contains the web client, the API and a PostgreSQL database (PGlite, which is PostgreSQL compiled to WebAssembly). It needs no server. It uses the network only when you press a Claude button in the archive.

## Install

1. On the phone, open the latest release: <https://github.com/flimmbark-source/HumanRecoverySystem/releases/latest>
2. Download **Weave.apk**. The direct link is <https://github.com/flimmbark-source/HumanRecoverySystem/releases/latest/download/Weave.apk>.
3. Open the downloaded file. If Android asks, let your browser install unknown apps.
4. Open **Weave**.

The app needs Android 8.0 or later and a current Android System WebView (version 105 or later). The Play Store updates the WebView.

To update, install a newer APK over the installed app. Your projects stay. If you uninstall the app, Android deletes all projects on the phone.

## How the app differs from the server

- **One person.** There is no sign-in, no sign-out and no sharing. **Project → People with access** is not shown.
- **The data stays on the phone**, in the storage of the app. The manifest turns off Android backup, so research notes do not go to a cloud backup without a decision. To keep a copy or to move a project, use **Project → Backup and transfer → Download workspace backup (JSON)**. Then use **Import…** on another phone or on a server. The same file imports in both directions.
- **No research jobs.** Wide and deep research run on a server. **Import agent findings** still works.
- **The archive** (**Notes → Archive**) takes pasted notes, text files, Word files, PDFs and pictures. Text and Word files are read on the phone, and **Split on this phone** needs no network. **Split with Claude**, and reading PDFs and pictures, use your own Claude API key, saved on the phone in **Project → Claude for the archive**. You see what will be sent before anything is sent. PDFs and pictures go to Claude only if **Allow sending PDFs and images to Claude** is on for the project, because names in them cannot be replaced first.
- **Original files are not copied into the app.** A file picked from the phone or a cloud app (Drive, OneDrive) keeps a link, and **Open original** opens it in the app that holds it, as long as that app allows it. You can also add a share link.
- **Exports** open the system save dialog. **Print this preview** opens the system print dialog.
- **The first start** creates the database. This takes some seconds. Later starts are faster.

## How it works

- `vite.device.config.ts` builds `dist/device`. It contains the React client and a Web Worker (`src/device/worker.ts`) that runs the same Hono app (`src/server/app.ts`) as the server.
- The build replaces four server modules with device versions in `src/device/`: `db.ts` (PGlite, stored in IndexedDB), `config.ts`, `reports/fonts.ts` and `providers/anthropic.ts`. It also replaces `node:crypto` and `node:util` with small browser versions. All other server code runs unchanged.
- The page sends each `/api` request to the worker (`src/device/transport.ts`). A page cannot set a `Cookie` header, so the worker sends the session token as a bearer token. The server accepts both.
- `android/` is a WebView shell (`MainActivity.java`). It serves `dist/device` from the APK on `https://appassets.androidplatform.net`. It opens the system file picker for imports and archive files (keeping permission to open an archive file again), the system save dialog for exports, and web links in the browser. The INTERNET permission is used only for Claude requests the researcher starts.

## Build

```bash
npm run build:device
```

Then build the APK with the Android SDK (no Gradle):

```bash
ANDROID_JAR=$ANDROID_HOME/platforms/android-35/android.jar BUILD_TOOLS=$ANDROID_HOME/build-tools/35.0.0 android/build.sh
```

The APK is `android/build/Weave.apk`. On Debian or Ubuntu, the distribution packages also work: `apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23`, then `ANDROID_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar BUILD_TOOLS=/usr/lib/android-sdk/build-tools/debian android/build.sh`.

The version code is the number of commits, so the APK from a later commit always installs over an earlier one.

## Tests

| Command | What it checks |
| --- | --- |
| `npm run test:pglite` | The API tests, on the database that the app carries |
| `npm run build:device && npm run test:device` | The device build in a phone-sized Chromium: start, persistence, exports, the Android bridge, import |
| `tests/android/smoke.ts` | The APK in an Android 15 emulator. The workflow runs it. |

## Releases

`.github/workflows/android.yml` runs on each push to `main` or `fix/weave-pilot-decisions` that changes the app. It typechecks, runs the API tests on PGlite, builds the APK, runs it in an Android 15 emulator, and then publishes the release `android-<version>` with **Weave.apk**.

## Signing key

The signing key (`android/weave.keystore`, password `weave-android`) is in the repository. Every build, here or on GitHub, can update an installed app without loss of data. Because the repository is public, anyone can sign an APK that Android accepts as an update of this app. Install updates only from this repository's releases.

To use a private key, create one, keep it in a GitHub Actions secret, and change `android/build.sh` and the workflow to use it. Android does not install an APK with a different key over the installed app. Before the change, export each project. Then uninstall the app, install the new APK and import the projects.
