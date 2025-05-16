// msl-detailed.js
import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import {
  getYearIdFromPopup,
  loginToEcubix,
  clearOldFiles,
  sendFilesToN8N
} from './ecubix-utils.js';

const DOWNLOADS_PATH = path.join('downloads');
const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

let input = {
  months: ['Jan'],
  startYear: 2023,
  endYear: 2023,
  yearIdMap: { 2023: 'y1' },
  folderId: '',
  executionId: ''
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = { ...input, ...parsed };
    console.log('✅ Loaded dynamic input:', input);
  } else {
    console.log('⚠️ No INPUT_JSON provided. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON:', error);
}

const { months, startYear, endYear, yearIdMap, folderId, executionId } = input;

const divisions = [
  'AP ELBRIT', 'Delhi Elbrit', 'Elbrit', 'ELBRIT AURA PROXIMA',
  'KE Aura N Proxima', 'Elbrit CND', 'Elbrit Bangalore', 'Elbrit Mysore', 'Kerala Elbrit', 'VASCO'
];

async function processDivisions() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing division: ${division}`);
      const page = await context.newPage();

      try {
        await loginToEcubix(page);

        for (let year = startYear; year <= endYear; year++) {
          for (const month of months) {
            console.log(`🗓️  Processing ${month}-${year} for ${division}`);
            try {
              await page.goto('https://elbrit.ecubix.com/Apps/MSL/frmMSLDetail.aspx?a_id=341');
              await page.waitForLoadState('networkidle');

              await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
              await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and contains(@class, 'dxeListBoxItem') and text()='${division}']`).click();

              await page.locator('#ctl00_CPH_uclMonthSelect_imgOK').click();
              await page.waitForTimeout(500);
              await page.locator('#changeYearMP').click({ force: true });

              const yearId = yearIdMap[year];
              if (!yearId) throw new Error(`No yearId mapping for ${year}`);

              await page.locator(`#${yearId}`).click({ force: true });
              await page.waitForTimeout(500);
              await page.getByRole('cell', { name: month, exact: true }).click();

              const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
              await page.getByRole('button', { name: 'Download' }).click();
              const download = await downloadPromise;

              const fileName = `MSL_Detailed_${division.replace(/\s+/g, '_')}_${month}-${year}.xlsx`;
              const filePath = path.join(DOWNLOADS_PATH, fileName);
              await download.saveAs(filePath);
              console.log(`✅ Downloaded and saved: ${fileName}`);

            } catch (err) {
              console.error(`❌ Error for ${month}-${year} (${division}):`, err.message);
            }
          }
        }

      } catch (err) {
        console.error(`❌ Division processing failed: ${division}`, err.message);
      } finally {
        await page.close();
      }
    }

    await sendFilesToN8N(DOWNLOADS_PATH, WEBHOOK_URL, folderId, executionId);

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ All divisions processed and browser closed!');
  }
}

processDivisions();
