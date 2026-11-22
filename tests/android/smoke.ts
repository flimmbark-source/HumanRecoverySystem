// Runs the debuggable APK in an Android emulator and drives the app through its WebView (Playwright over adb).
// .github/workflows/android.yml runs it: node --import tsx tests/android/smoke.ts out/Weave-debuggable.apk
import { mkdirSync } from 'node:fs';
import { _android as android, type AndroidWebView, type Page } from 'playwright';

const PKG = 'io.github.flimmbark_source.weave';
const OUT = 'android-smoke';
mkdirSync(OUT, { recursive: true });

const [device] = await android.devices();
if (!device) throw new Error('No Android device or emulator is connected.');
const shell = async (cmd: string) => (await device.shell(cmd)).toString();
const errors: string[] = [];
let webview = null as AndroidWebView | null, page = null as Page | null;

async function launch(): Promise<Page> {
  await shell(`am start -W -n ${PKG}/.MainActivity`);
  webview = await device.webView({ pkg: PKG }, { timeout: 90_000 });
  page = await webview.page();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  return page;
}
async function restart(): Promise<Page> {
  const closed = new Promise<void>((resolve) => webview!.once('close', () => resolve()));
  await shell(`am force-stop ${PKG}`);
  await closed;
  return launch();
}
const focused = () => shell('dumpsys window | grep -E "mCurrentFocus"');
// Playwright's device.input needs an extra driver app on the device. The key event does not.
const back = () => shell('input keyevent KEYCODE_BACK');
const step = (name: string) => console.log(`- ${name}`);

async function run() {
  await device.installApk(process.argv[2]);
  let p = await launch();

  step('first start opens the projects list without a sign-in');
  await p.getByTestId('projects').waitFor({ timeout: 120_000 });
  if (await p.getByTestId('signout').count()) throw new Error('A sign-out button is shown on the device.');
  if ((await p.evaluate(() => typeof (window as { WeaveAndroid?: unknown }).WeaveAndroid)) !== 'object') throw new Error('The Android bridge is missing.');

  step('creates the synthetic demo project and captures a note');
  await p.getByTestId('new-project').click();
  await p.getByTestId('tpl-demo').check();
  await p.getByTestId('np-create').click();
  await p.getByTestId('graph').waitFor({ timeout: 60_000 });
  await p.getByTestId('fab-note').click();
  await p.locator('.modal textarea').first().fill('Captured on an Android phone.');
  await p.getByRole('button', { name: 'Save note' }).click();
  await p.locator('.modal').waitFor({ state: 'detached', timeout: 20_000 });

  step('keeps the page clear of the system bars');
  const view = await p.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  const screen = /(\d+)x(\d+)/.exec(await shell('wm size'))!.slice(1).map(Number);
  console.log(`  viewport ${view.width}x${view.height} css px at ${view.dpr}x, screen ${screen.join('x')} px`);
  if (Math.round(view.height * view.dpr) >= screen[1]) throw new Error('The page is drawn under the system bars.');
  await device.screenshot({ path: `${OUT}/1-map.png` });

  step('the back button closes a dialog before it leaves the page');
  await p.getByTestId('fab-note').click();
  await p.locator('.modal').waitFor();
  // The dialog focuses its text box, which opens the keyboard, and Android sends Back to an open keyboard first
  // (the emulator showed it: no Escape sent, keyboard view shown). Depending on when the keyboard appears, that
  // can take two presses, so up to three are allowed. The map must still show after them.
  // Counts the Escape key that the app's Back handler sends to the page, to tell where a Back press ended.
  await p.evaluate(() => document.addEventListener('keydown', (e) => { if (e.key === 'Escape') (window as unknown as { escapes: number }).escapes = ((window as unknown as { escapes?: number }).escapes ?? 0) + 1; }, true));
  const state = async () => `focus ${await p.evaluate(() => document.activeElement?.tagName)}, Escape sent ${await p.evaluate(() => (window as unknown as { escapes?: number }).escapes ?? 0)} times, keyboard: ${(await shell('dumpsys input_method | grep -iE "inputshown|imevisible|inputviewshown|showrequested" | head -4')).replace(/\s+/g, ' ').trim() || '(no match)'}`;
  for (let presses = 1; ; presses++) {
    await back();
    if (await p.locator('.modal').waitFor({ state: 'detached', timeout: 4_000 }).then(() => true, () => false)) break;
    console.log(`  after Back ${presses} the dialog is open: ${await state()}`);
    if (presses === 3) throw new Error('Back did not close the dialog.');
  }
  await p.getByTestId('graph').waitFor();

  step('an export opens the system save dialog');
  await p.getByTestId('nav-report').click();
  await p.getByTestId('export-csv').click();
  for (let i = 0; !(await focused()).includes('documentsui'); i++) {
    if (i === 60) throw new Error(`The save dialog did not open. Focus: ${await focused()}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log(`  ${(await focused()).trim()}`);
  await device.screenshot({ path: `${OUT}/2-save-dialog.png` });
  await back();

  step('an insight opened on the map takes a detail, and Back returns to the open insight');
  await p.getByTestId('nav-insights').click();
  await p.getByTestId('insight-new').click();
  await p.getByTestId('insight-new-text').fill('Written on an Android phone.');
  await p.getByTestId('insight-new-save').click();
  const insight = p.getByTestId('insight').filter({ hasText: 'Written on an Android phone.' });
  await insight.getByTestId('show-on-map').click();
  await p.locator('.canvas-wrap.insight-ctx').waitFor();
  await p.getByRole('button', { name: 'Fit the whole map' }).click();
  await p.locator('[data-node]').first().click();
  await p.locator('.right [data-pick] > [data-testid=pick-mark]:not([disabled])').first().click();
  await p.locator('[data-testid=insight-fab][data-state=add]').click();
  await p.locator('[data-testid=insight-fab][data-state=back]').waitFor();
  await device.screenshot({ path: `${OUT}/3-insight-on-map.png` });
  // Back closes the details sheet first, then leaves the map for the insight (a keyboard may take one more press).
  for (let presses = 1; ; presses++) {
    await back();
    if (await p.getByTestId('insights').waitFor({ timeout: 3_000 }).then(() => true, () => false)) break;
    if (presses === 4) throw new Error('Back did not return to the insight.');
  }
  await insight.getByTestId('card-details').waitFor();
  if ((await insight.getAttribute('data-expanded')) !== 'true') throw new Error('The insight was not left open.');

  step('pasted field notes are split on the phone, checked and saved to the archive');
  await p.getByTestId('nav-notes').click();
  await p.getByTestId('archive-add').click();
  await p.getByTestId('import-text').fill('- Pasted on an Android phone: the coordinator phones every applicant.\n- Takes about 20 min per placement.');
  await p.getByTestId('import-name').fill('Phone import');
  await p.getByTestId('split-phone').click();
  await p.getByTestId('import-review').waitFor();
  await p.getByTestId('fn-span').first().click();
  await p.getByTestId('fn-editor').waitFor();
  await device.screenshot({ path: `${OUT}/4-archive-review.png` });
  await back(); // closes the note editor, not the review
  if (!(await p.getByTestId('import-review').isVisible())) throw new Error('Back left the review instead of closing the note editor.');
  await p.getByTestId('review-save').click();
  await p.getByTestId('archive-item').filter({ hasText: 'Phone import' }).waitFor();

    step('the data is still there after the app restarts');
  p = await restart();
  await p.getByTestId('projects').waitFor({ timeout: 120_000 });
  await p.locator('[data-project="Volunteer placement (synthetic demo)"]').click();
  await p.getByTestId('nav-notes').click();
  await p.getByText('Captured on an Android phone.').first().waitFor({ timeout: 30_000 });
  await device.screenshot({ path: `${OUT}/5-notes-after-restart.png` });
  await p.getByText('Pasted on an Android phone').first().waitFor({ timeout: 30_000 });
  await p.getByTestId('nav-insights').click();
  await p.getByTestId('insight').filter({ hasText: 'Written on an Android phone.' }).getByTestId('insight-toggle').click();
  await p.getByTestId('insight').filter({ hasText: 'Written on an Android phone.' }).getByTestId('card-details').waitFor();

  if (errors.length) throw new Error(`The page reported errors:\n${errors.join('\n')}`);
}

try {
  await run();
  console.log('The app works on this device.');
} catch (e) {
  // What the person would see, and what the WebView logged, so a failure can be understood from the job log.
  console.log('Page text:', await page?.locator('body').innerText({ timeout: 5_000 }).catch(() => '(none)'));
  console.log('Page errors:', errors.join('\n') || '(none)');
  console.log('WebView log:\n', (await shell('logcat -d -t 80 chromium:V *:S').catch(() => '')).trim());
  await device.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
  throw e;
} finally {
  await device.close();
}
