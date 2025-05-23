// dr-service.js
import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import {
  getYearIdFromPopup,
  loginToEcubix,
  clearOldFiles,
  sendFilesToN8N
} from './ecubix-utils.js';

const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

let input = {
  months: ['Mar'],
  year: 2025,
  folderId: '01VW6POPOITICIOXSNB5G2DRKL3DTWOP4D',
  executionId: 'lY8fRCBl9WAPzTjf'
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = { ...input, ...parsed };
    console.log('✅ Dynamic input loaded:', input);
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON:', error);
}

const { months, year: targetYear, folderId, executionId } = input;
const downloadsPath = path.join(`DRSERVICE_${targetYear}`);

const divisions = [
  'AP ELBRIT', 'Delhi Elbrit', 'Elbrit', 'ELBRIT AURA PROXIMA',
  'KE Aura N Proxima', 'Elbrit CND', 'Elbrit Bangalore', 'Elbrit Mysore', 'Kerala Elbrit', 'VASCO'
];

async function processDivisions() {
  await clearOldFiles(downloadsPath);
  await fs.mkdir(downloadsPath, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing division: ${division}`);
      const page = await context.newPage();

      try {
        await loginToEcubix(page);

        for (const month of months) {
          console.log(`🗓️  Processing ${month}-${targetYear} for ${division}`);

          try {
            await page.goto('https://elbrit.ecubix.com/Apps/Report/rptTillDateServiceDownload.aspx?a_id=375', {
              timeout: 60000,
              waitUntil: 'domcontentloaded'
            });

            // FROM MONTH
            await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
            await page.waitForTimeout(500);
            await page.locator('#changeYearMP').click();
            await page.waitForTimeout(500);
            const fromYearId = await getYearIdFromPopup(page, targetYear);
            await page.locator(fromYearId).click({ force: true });
            await page.waitForTimeout(500);
            await page.getByText(month, { exact: true }).click();

            // TO MONTH
            await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
            await page.waitForTimeout(500);
            await page.locator('#changeYearMP').click();
            await page.waitForTimeout(500);
            const toYearId = '#y3';  // hardcoded year ID for TO month
            await page.locator(toYearId).click({ force: true });
            await page.waitForTimeout(500);
            await page.getByText(month, { exact: true }).click();

            // Division
            await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

            // Download
            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
            await page.getByRole('button', { name: 'Download' }).click();
            const download = await downloadPromise;

            const fileName = `All_Dr_Service_${division.replace(/\s+/g, '_')}_${month}-${targetYear}.xlsx`;
            const filePath = path.join(downloadsPath, fileName);
            await download.saveAs(filePath);

            console.log(`✅ Downloaded: ${fileName}`);
          } catch (error) {
            console.error(`❌ Error for ${month}-${targetYear} (${division}):`, error.message);
          }
        }

        console.log(`✅ Finished: ${division}`);
      } catch (error) {
        console.error(`❌ Login/Division error for ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }

    await sendFilesToN8N(downloadsPath, WEBHOOK_URL, folderId, executionId);

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log(`\n✅ All divisions processed for year ${targetYear}!`);
  }
}

processDivisions();