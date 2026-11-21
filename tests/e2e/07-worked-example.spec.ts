import { expect, test } from '@playwright/test';
import { expectCleanLabels, login } from './helpers';

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
  test.describe(`worked example at ${label} width`, () => {
    test.use({ viewport });

    test('New project makes a whole study, with something in every section', async ({ page }) => {
      await login(page);
      await page.getByTestId('new-project').click();
      await page.getByTestId('tpl-example').check();
      await page.getByTestId('np-name').fill(`Worked example ${label}`);
      await page.getByTestId('np-create').click();
      await expect(page.getByTestId('graph')).toBeVisible();
      await expect(page.locator('[data-node]')).toHaveCount(13);
      await expectCleanLabels(page);

      await page.getByTestId('nav-notes').click();
      await expect(page.getByTestId('archive-item')).toHaveCount(3);
      await page.getByTestId('nav-insights').click();
      await expect(page.getByTestId('insight')).toHaveCount(5);
      await page.getByTestId('nav-decide').click();
      await expect(page.getByTestId('register').locator('[data-row]')).toHaveCount(4);
      await page.getByTestId('nav-report').click();
      await expect(page.getByTestId('rec-heading').first()).toContainText('Recommendation');
    });
  });
}
