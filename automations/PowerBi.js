import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const EMAIL = 'integrations@elbrit.org';
const PASSWORD = 'F^983194242330ac12A';
const ERROR_DIR = 'error';
const RECORD_DIR = 'recordings';
const N8N_HOOK = 'https://elbrit-dev.app.n8n.cloud/webhook/powerbi-screenshot-upload';
//https://elbrit-dev.app.n8n.cloud/webhook/powerbi-screenshot-upload
(async () => {
  if (!fs.existsSync(ERROR_DIR)) fs.mkdirSync(ERROR_DIR);
  if (!fs.existsSync(RECORD_DIR)) fs.mkdirSync(RECORD_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 },
    recordVideo: {
      dir: RECORD_DIR,
      size: { width: 1280, height: 1024 }
    }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    const step = async (label) => {
      const file = `${ERROR_DIR}/step-${label}.png`;
      await page.screenshot({ path: file, fullPage: true });
    };

    await page.goto('https://app.powerbi.com');
    await step('1-login-page');

    await page.fill('#email', EMAIL);
    await page.click('#submitBtn');
    await page.waitForTimeout(500);
    await step('2-email-submitted');

    await page.fill('input[type="password"]', PASSWORD);
    await page.waitForTimeout(500);
    await step('3-password-filled');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('xpath=//*[@id="idSIButton9"]')
    ]);
    await step('4-after-signin-click');

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
    await step('5-stay-signed-in');

    await page.goto('https://app.powerbi.com/home?experience=power-bi', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    console.log('✅ Navigated to Power BI Home');
    await step('6-navigated-to-home');

    await page.waitForSelector('#leftNavPane', { timeout: 30000 });
    console.log('✅ Dashboard UI is visible');
    await step('7-dashboard-visible');

    const switcherButton = page.locator('xpath=//*[@id="leftNavPane"]/div/div/tri-workspace-switcher/tri-navbar-label-item/button');
    await switcherButton.waitFor({ state: 'visible', timeout: 15000 });
    await switcherButton.click();
    console.log("✅ Clicked workspace switcher");
    await step('8-workspace-switcher-clicked');

    const workspaceButton = page.locator('xpath=//*[@id="cdk-overlay-2"]/tri-workspace-flyout/div[1]/cdk-virtual-scroll-viewport/div[1]/tri-workspace-button[2]/button');
    await workspaceButton.waitFor({ state: 'visible', timeout: 10000 });
    await workspaceButton.click();
    console.log("✅ Navigated to specific workspace");
    await step('9-workspace-selected');

    const reportRowSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector1, { timeout: 10000 });
    await page.hover(reportRowSelector1);
    await page.waitForTimeout(500);
    await step('10-hover-report-1');

    const refreshIconSelector1 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[12]/div[2]/div/span/button[1]';
    const refreshButton1 = await page.waitForSelector(refreshIconSelector1, { timeout: 5000 });
    await refreshButton1.click({ force: true });
    await page.waitForTimeout(500);
    await step('11-refresh-1-clicked');

    const reportRowSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span';
    await page.waitForSelector(reportRowSelector2, { timeout: 10000 });
    await page.hover(reportRowSelector2);
    await page.waitForTimeout(500);
    await step('12-hover-report-2');

    const refreshIconSelector2 = 'xpath=//*[@id="artifactContentView"]/div[1]/div[8]/div[2]/div/span/button[1]/mat-icon';
    const refreshButton2 = await page.waitForSelector(refreshIconSelector2, { timeout: 5000 });
    await refreshButton2.click({ force: true });
    await page.waitForTimeout(1000);
    await step('13-refresh-2-clicked');

    console.log('✅ "Refresh now" icons clicked successfully!');
  } catch (error) {
    console.error('❌ Error during automation:', error);
    const html = await page.content();
    await fs.promises.writeFile(`${ERROR_DIR}/page_source.html`, html);
    await page.screenshot({ path: `${ERROR_DIR}/final-error.png`, fullPage: true });
  } finally {
    const videoPath = await page.video().path(); // path to the video file
    await browser.close();

    // Send to n8n
    const form = new FormData();
    form.append('status', '✅ Automation Complete');
    form.append('message', 'Attached is the full session recording.');
    form.append('video', fs.createReadStream(videoPath));

    try {
      const res = await fetch(N8N_HOOK, {
        method: 'POST',
        body: form
      });
      console.log('📨 Video sent to n8n:', res.status);
    } catch (err) {
      console.error('❌ Failed to send video to n8n:', err.message);
    }
  }
})();
