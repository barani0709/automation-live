// visit-activity.js
import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import {
  getYearIdFromPopup,
  loginToEcubix,
  clearOldFiles,
  sendFilesToN8N
} from './ecubix-utils.js';

const DOWNLOADS_PATH = path.join('visit_data');
const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

let input = {
  fromMonth: 'Jan',
  toMonth: 'Jan',
  year: 2025,
  folderId: '01VW6POPOMA565LEJTGNDZFB4PJAUCGSXF',
  executionId: 'NmhU6IfHuGgx8oX1'
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = {
      fromMonth: parsed.fromMonth || input.fromMonth,
      toMonth: parsed.toMonth || input.toMonth,
      year: parsed.year || input.year,
      folderId: input.folderId,
      executionId: input.executionId
    };
    console.log('✅ Dynamic input loaded (with fixed IDs):', input);
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON:', error);
}

const { fromMonth, toMonth, year, folderId, executionId } = input;
const allMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const selectedMonths = allMonths.slice(allMonths.indexOf(fromMonth), allMonths.indexOf(toMonth) + 1);

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
      console.log(`\n🚀 Processing: ${division}`);
      const page = await context.newPage();

      try {
        await loginToEcubix(page);

        for (const month of selectedMonths) {
          console.log(`🗓️ ${month}-${year} for ${division}`);

          try {
            await page.goto('https://elbrit.ecubix.com/Apps/Report/frmDownloadDrDetails.aspx?a_id=376', {
              timeout: 60000,
              waitUntil: 'domcontentloaded'
            });

            // FROM Month-Year
            await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            const fromYearId = await getYearIdFromPopup(page, year);
            await page.locator(fromYearId).click({ force: true });
            await page.getByText(month, { exact: true }).click();

            // TO Month-Year
            await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            const toYearId = await getYearIdFromPopup(page, year);
            await page.locator(toYearId).click({ force: true });
            await page.getByText(month, { exact: true }).click();

            // Select Division
            await page.locator('#ctl00_CPH_ddlDivision_B-1').click();
            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

            // Check Designations and Options
            for (let i = 0; i <= 5; i++) {
              await page.locator(`#ctl00_CPH_chkDesignation_${i}`).check();
            }

            await page.locator('#ctl00_CPH_chkVisit').check();
            await page.locator('#ctl00_CPH_chkVisitDates').check();

            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
            await page.locator('#ctl00_CPH_imgExcel').click();
            const download = await downloadPromise;

            const fileName = `Visit_Activity_${division.replace(/\s+/g, '_')}_${month}-${year}.csv`;
            const filePath = path.join(DOWNLOADS_PATH, fileName);
            await download.saveAs(filePath);

            console.log(`✅ Downloaded: ${fileName}`);
          } catch (error) {
            console.error(`❌ Error in ${month}-${year} for ${division}:`, error.message);
          }
        }

        console.log(`✅ Finished: ${division}`);
      } catch (error) {
        console.error(`❌ Login/Division error for ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }

    await sendFilesToN8N(DOWNLOADS_PATH, WEBHOOK_URL, folderId, executionId);
  } catch (error) {
    console.error('❌ Automation error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ All divisions processed and browser closed!');
  }
}

processDivisions();
