import { chromium } from 'playwright';

const EMAIL = 'integrations@elbrit.org';       // 🔐 Replace with your actual email
const PASSWORD = 'F^983194242330ac12A';       // 🔐 Replace with your actual password

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://app.powerbi.com');

    await page.fill('#email', EMAIL);
    await page.click('#submitBtn');
    await page.waitForTimeout(3000);

    await page.fill('input[type="password"]', PASSWORD);
    await page.click('input[type="submit"]');

    try {
      await page.waitForSelector('input[id="idBtn_Back"]', { timeout: 5000 });
      await page.click('input[id="idBtn_Back"]');
      console.log("⏭️ Skipped 'Stay signed in'");
    } catch {
      console.log("✅ No 'Stay signed in' prompt");
    }

    const switcherButton = await page.locator('xpath=//*[@id="leftNavPane"]/div/div/tri-workspace-switcher/tri-navbar-label-item/button', { timeout: 10000 });
    await switcherButton.click();
    console.log("✅ Clicked workspace switcher");

    const workspaceButton = await page.locator('xpath=//*[@id="cdk-overlay-2"]/tri-workspace-flyout/div[1]/cdk-virtual-scroll-viewport/div[1]/tri-workspace-button[2]/button', { timeout: 10000 });
    await workspaceButton.click();
    console.log("✅ Navigated to specific workspace");

    const reportRowSelector = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector, { timeout: 10000 });
    await page.hover(reportRowSelector);
    await page.waitForTimeout(1000);

    const refreshIconSelector = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span/button[1]';
    const refreshButton = await page.waitForSelector(refreshIconSelector, { timeout: 5000 });
    await page.waitForTimeout(1000);
    await refreshButton.click({ force: true });
    await page.waitForTimeout(1000);

    const reportRow = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span';
    await page.waitForSelector(reportRow, { timeout: 10000 });
    await page.hover(reportRow);
    await page.waitForTimeout(1000);

    const refreshIcon = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span/button[1]/mat-icon';
    const refresh = await page.waitForSelector(refreshIcon, { timeout: 5000 });
    await page.waitForTimeout(1000);
    await refresh.click({ force: true });
    await page.waitForTimeout(1000);

    console.log('✅ "Refresh now" icon clicked successfully!');

  } catch (error) {
    console.error('❌ Error during automation:', error);
    await page.screenshot({ path: 'error_screenshot.png' });
  } finally {
    await browser.close();
  }
})();
