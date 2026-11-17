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

async function launch(): Promise<{ webview: AndroidWebView; page: Page }> {
  await shell(`am start -W -n ${PKG}/.MainActivity`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 90_000 });
  const page = await webview.page();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { webview, page };
}
async function restart(webview: AndroidWebView) {
  const closed = new Promise<void>((resolve) => webview.once('close', () => resolve()));
  await shell(`am force-stop ${PKG}`);
  await closed;
  return launch();
}
const focused = () => shell('dumpsys window | grep -E "mCurrentFocus"');
const step = (name: string) => console.log(`- ${name}`);

await device.installApk(process.argv[2]);
let { webview, page } = await launch();

step('first start opens the projects list without a sign-in');
await page.getByTestId('projects').waitFor({ timeout: 120_000 });
if (await page.getByTestId('signout').count()) throw new Error('A sign-out button is shown on the device.');
if ((await page.evaluate(() => typeof (window as { WeaveAndroid?: unknown }).WeaveAndroid)) !== 'object') throw new Error('The Android bridge is missing.');

step('creates the synthetic demo project and captures a note');
await page.getByTestId('new-project').click();
await page.getByTestId('tpl-demo').check();
await page.getByTestId('np-create').click();
await page.getByTestId('graph').waitFor({ timeout: 60_000 });
await page.getByTestId('fab-note').click();
await page.locator('.modal textarea').first().fill('Captured on an Android phone.');
await page.getByRole('button', { name: 'Save note' }).click();
await page.locator('.modal').waitFor({ state: 'detached', timeout: 20_000 });

step('keeps the page clear of the system bars');
const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
const screen = /(\d+)x(\d+)/.exec(await shell('wm size'))!.slice(1).map(Number);
console.log(`  viewport ${view.width}x${view.height} css px at ${view.dpr}x, screen ${screen.join('x')} px`);
if (Math.round(view.height * view.dpr) >= screen[1]) throw new Error('The page is drawn under the system bars.');
await device.screenshot({ path: `${OUT}/1-map.png` });

step('the back button closes a dialog before it leaves the page');
await page.getByTestId('fab-note').click();
await page.locator('.modal').waitFor();
await device.input.press('Back');
await page.locator('.modal').waitFor({ state: 'detached', timeout: 10_000 });
await page.getByTestId('graph').waitFor();

step('an export opens the system save dialog');
await page.getByTestId('nav-report').click();
await page.getByTestId('export-csv').click();
for (let i = 0; !(await focused()).includes('documentsui'); i++) {
  if (i === 60) throw new Error(`The save dialog did not open. Focus: ${await focused()}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.log(`  ${(await focused()).trim()}`);
await device.screenshot({ path: `${OUT}/2-save-dialog.png` });
await device.input.press('Back');

step('the data is still there after the app restarts');
({ webview, page } = await restart(webview));
await page.getByTestId('projects').waitFor({ timeout: 120_000 });
await page.locator('[data-project="Volunteer placement (synthetic demo)"]').click();
await page.getByTestId('nav-notes').click();
await page.getByText('Captured on an Android phone.').first().waitFor({ timeout: 30_000 });
await device.screenshot({ path: `${OUT}/3-notes-after-restart.png` });

if (errors.length) throw new Error(`The page reported errors:\n${errors.join('\n')}`);
console.log('The app works on this device.');
await device.close();
