import { chromium } from 'playwright';

const EMAIL = 'integrations@elbrit.org';
const PASSWORD = 'F^983194242330ac12A';

(async () => {
  const browser = await chromium.launch({ headless: true }); // Run in headless mode
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000); // Global timeout

  try {
    await page.goto('https://app.powerbi.com');

    await page.fill('#email', EMAIL);
    await page.click('#submitBtn');
    await page.waitForTimeout(3000);

    await page.fill('input[type="password"]', PASSWORD);
    await page.click('input[type="submit"]');

    try {
      await page.waitForSelector('input[id="idBtn_Back"]', { timeout: 5000 });
      await page.waitForTimeout(1000);
      await page.click('input[id="idBtn_Back"]');
      console.log("⏭️ Skipped 'Stay signed in'");
    } catch {
      console.log("✅ No 'Stay signed in' prompt");
    }

    // Wait for and click workspace switcher
    const switcherButton = page.locator('xpath=//*[@id="leftNavPane"]/div/div/tri-workspace-switcher/tri-navbar-label-item/button');
    await switcherButton.waitFor({ state: 'visible', timeout: 15000 });
    await page.screenshot({ path: 'before_workspace_click.png' }); // For debugging
    await switcherButton.click();
    console.log("✅ Clicked workspace switcher");

    // Wait and select the specific workspace
    const workspaceButton = page.locator('xpath=//*[@id="cdk-overlay-2"]/tri-workspace-flyout/div[1]/cdk-virtual-scroll-viewport/div[1]/tri-workspace-button[2]/button');
    await workspaceButton.waitFor({ state: 'visible', timeout: 10000 });
    await workspaceButton.click();
    console.log("✅ Navigated to specific workspace");

    // First report refresh
    const reportRowSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector1, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.hover(reportRowSelector1);
    await page.waitForTimeout(1000);

    const refreshIconSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span/button[1]';
    const refreshButton1 = await page.waitForSelector(refreshIconSelector1, { timeout: 5000 });
    await page.waitForTimeout(1000);
    await refreshButton1.click({ force: true });
    await page.waitForTimeout(1000);

    // Second report refresh
    const reportRowSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector2, { timeout: 10000 });
    await page.waitForTimeout(1000);
    await page.hover(reportRowSelector2);
    await page.waitForTimeout(1000);

    const refreshIconSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span/button[1]/mat-icon';
    const refreshButton2 = await page.waitForSelector(refreshIconSelector2, { timeout: 5000 });
    await page.waitForTimeout(1000);
    await refreshButton2.click({ force: true });
    await page.waitForTimeout(1000);

    console.log('✅ "Refresh now" icon clicked successfully!');

  } catch (error) {
    console.error('❌ Error during automation:', error);
    await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
