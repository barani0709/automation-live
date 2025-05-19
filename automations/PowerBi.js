import { chromium } from 'playwright';

const EMAIL = 'integrations@elbrit.org';
const PASSWORD = 'F^983194242330ac12A';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000); // Global timeout

  try {
    // 1. Navigate to Power BI login
    await page.goto('https://app.powerbi.com');

    // 2. Login flow
    await page.fill('#email', EMAIL);
    await page.click('#submitBtn');
    await page.waitForTimeout(3000); // Wait for password screen

    await page.fill('input[type="password"]', PASSWORD);
    await page.click('input[type="submit"]');

    // 3. Handle 'Stay signed in?' screen
    try {
      const staySignedInBtn = page.locator('input[id="idBtn_Back"]');
      await staySignedInBtn.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(1000);
      await staySignedInBtn.click();
      console.log("⏭️ Skipped 'Stay signed in'");
    } catch (e) {
      console.warn("⚠️ 'Stay signed in' prompt not immediately visible, retrying...");
      try {
        await page.waitForTimeout(3000);
        const retryBtn = page.locator('input[id="idBtn_Back"]');
        if (await retryBtn.isVisible()) {
          await retryBtn.click();
          console.log("⏭️ Skipped 'Stay signed in' (after retry)");
        } else {
          console.log("✅ No 'Stay signed in' prompt (confirmed)");
        }
      } catch {
        console.log("✅ No 'Stay signed in' prompt (fallback)");
      }
    }

    // 4. Force redirect to home/dashboard in case login stalls
    console.log("🔄 Forcing navigation to Power BI Home...");
    await page.goto('https://app.powerbi.com/groups/me');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Optional screenshot for debugging
    await page.screenshot({ path: 'after-login.png', fullPage: true });

    // 5. Click workspace switcher
    const switcherButton = page.locator('xpath=//*[@id="leftNavPane"]/div/div/tri-workspace-switcher/tri-navbar-label-item/button');
    await switcherButton.waitFor({ state: 'visible', timeout: 15000 });
    await switcherButton.click();
    console.log("✅ Clicked workspace switcher");

    // 6. Select specific workspace (2nd in list)
    const workspaceButton = page.locator('xpath=//*[@id="cdk-overlay-2"]/tri-workspace-flyout/div[1]/cdk-virtual-scroll-viewport/div[1]/tri-workspace-button[2]/button');
    await workspaceButton.waitFor({ state: 'visible', timeout: 10000 });
    await workspaceButton.click();
    console.log("✅ Navigated to specific workspace");

    // 7. Refresh first report
    const reportRowSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector1, { timeout: 10000 });
    await page.hover(reportRowSelector1);
    await page.waitForTimeout(1000);

    const refreshIconSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span/button[1]';
    const refreshButton1 = await page.waitForSelector(refreshIconSelector1, { timeout: 5000 });
    await refreshButton1.click({ force: true });
    await page.waitForTimeout(1000);

    // 8. Refresh second report
    const reportRowSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector2, { timeout: 10000 });
    await page.hover(reportRowSelector2);
    await page.waitForTimeout(1000);

    const refreshIconSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span/button[1]/mat-icon';
    const refreshButton2 = await page.waitForSelector(refreshIconSelector2, { timeout: 5000 });
    await refreshButton2.click({ force: true });
    await page.waitForTimeout(1000);

    console.log('✅ "Refresh now" icons clicked successfully!');

  } catch (error) {
    console.error('❌ Error during automation:', error);
    await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
