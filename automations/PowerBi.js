import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const EMAIL = 'integrations@elbrit.org';
const PASSWORD = 'F^983194242330ac12A';
const ERROR_DIR = 'error';

(async () => {
  // Ensure 'error' folder exists
  if (!fs.existsSync(ERROR_DIR)) {
    fs.mkdirSync(ERROR_DIR);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1024 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto('https://app.powerbi.com');
    await page.screenshot({ path: `${ERROR_DIR}/step-1-login-page.png`, fullPage: true });

    await page.fill('#email', EMAIL);
    await page.click('#submitBtn');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${ERROR_DIR}/step-2-email-submitted.png`, fullPage: true });

    await page.fill('input[type="password"]', PASSWORD);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${ERROR_DIR}/step-3-password-filled.png`, fullPage: true });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('xpath=//*[@id="idSIButton9"]')
    ]);
    await page.screenshot({ path: `${ERROR_DIR}/step-4-after-signin-click.png`, fullPage: true });

    try {
      await page.locator('xpath=//*[@id="KmsiCheckboxField"]').check();
      const staySignedInBtn = page.locator('xpath=//*[@id="idBtn_Back"]');
      await staySignedInBtn.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(1000);
      await staySignedInBtn.click();
      console.log("⏭️ Skipped 'Stay signed in'");
    } catch {
      console.log("✅ No 'Stay signed in' prompt");
    }
    await page.screenshot({ path: `${ERROR_DIR}/step-5-stay-signed-in.png`, fullPage: true });

    await page.goto('https://app.powerbi.com/home?experience=power-bi', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    console.log('✅ Navigated to Power BI Home');
    await page.screenshot({ path: `${ERROR_DIR}/step-6-navigated-to-home.png`, fullPage: true });

    await page.waitForSelector('#leftNavPane', { timeout: 30000 });
    console.log('🧭 Confirmed: Power BI Home dashboard loaded');

    await page.waitForSelector('#leftNavPane', { timeout: 15000 });
    console.log('✅ Dashboard UI is visible');
    await page.screenshot({ path: `${ERROR_DIR}/step-7-dashboard-visible.png`, fullPage: true });

    const switcherButton = page.locator('xpath=//*[@id="leftNavPane"]/div/div/tri-workspace-switcher/tri-navbar-label-item/button');
    await switcherButton.waitFor({ state: 'visible', timeout: 15000 });
    await switcherButton.click();
    console.log("✅ Clicked workspace switcher");
    await page.screenshot({ path: `${ERROR_DIR}/step-8-workspace-switcher-clicked.png`, fullPage: true });

    const workspaceButton = page.locator('xpath=//*[@id="cdk-overlay-2"]/tri-workspace-flyout/div[1]/cdk-virtual-scroll-viewport/div[1]/tri-workspace-button[2]/button');
    await workspaceButton.waitFor({ state: 'visible', timeout: 10000 });
    await workspaceButton.click();
    console.log("✅ Navigated to specific workspace");
    await page.screenshot({ path: `${ERROR_DIR}/step-9-workspace-selected.png`, fullPage: true });

    const reportRowSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector1, { timeout: 10000 });
    await page.hover(reportRowSelector1);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${ERROR_DIR}/step-10-hover-report-1.png`, fullPage: true });

    const refreshIconSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span/button[1]';
    const refreshButton1 = await page.waitForSelector(refreshIconSelector1, { timeout: 5000 });
    await refreshButton1.click({ force: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${ERROR_DIR}/step-11-refresh-1-clicked.png`, fullPage: true });

    const reportRowSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector2, { timeout: 10000 });
    await page.hover(reportRowSelector2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${ERROR_DIR}/step-12-hover-report-2.png`, fullPage: true });

    const refreshIconSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span/button[1]/mat-icon';
    const refreshButton2 = await page.waitForSelector(refreshIconSelector2, { timeout: 5000 });
    await refreshButton2.click({ force: true });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${ERROR_DIR}/step-13-refresh-2-clicked.png`, fullPage: true });

    console.log('✅ "Refresh now" icons clicked successfully!');

  } catch (error) {
    console.error('❌ Error during automation:', error);
    const html = await page.content();
    await fs.promises.writeFile(`${ERROR_DIR}/page_source.html`, html);
    await page.screenshot({ path: `${ERROR_DIR}/final-error.png`, fullPage: true });
  } finally {
    await browser.close();
  }
})();
