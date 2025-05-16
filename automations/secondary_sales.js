// stockist-sales.js
import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import {
  getYearIdFromPopup,
  loginToEcubix,
  clearOldFiles,
  sendFilesToN8N
} from './ecubix-utils.js';

const DOWNLOADS_PATH = path.join('stockist_wise_sales_data');
const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

let input = {
  fromMonth: 'Dec',
  toMonth: 'Dec',
  year: 2024,
  folderId: '01VW6POPKOZ4GMMSVER5HIQ3DDCWMZDDTC',
  executionId: 'uhGmhLcxRS1eoEZ8'
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = { ...input, ...parsed };
    console.log('✅ Loaded dynamic input:', input);
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (err) {
  console.error('❌ Failed to parse INPUT_JSON:', err);
}

const { fromMonth, toMonth, year, folderId, executionId } = input;

const divisionStateMap = {
  'AP ELBRIT': ['Andhra Pradesh', 'Telangana'],
  'Delhi Elbrit': ['Delhi', 'Punjab', 'Rajasthan', 'uttar pradesh'],
  'Elbrit': ['Tn-Chennai', 'Tn-Coimbatore', 'Tn-Trichy'],
  'ELBRIT AURA PROXIMA': ['Karnataka', 'Tn-Chennai', 'Tn-Coimbatore', 'Tn-Madurai'],
  'Elbrit Bangalore': ['Karnataka'],
  'Elbrit CND': ['Tn-Chennai', 'Tn-Coimbatore', 'Tn-Trichy'],
  'Elbrit Mysore': ['Karnataka'],
  'KE Aura N Proxima': ['Kerala'],
  'Kerala Elbrit': ['Kerala'],
  'VASCO': ['Tn-Chennai', 'Tn-Coimbatore']
};

async function processAllDivisions() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await loginToEcubix(page);

    for (const [division, states] of Object.entries(divisionStateMap)) {
      console.log(`\n🚀 Division: ${division}`);

      await page.goto('https://elbrit.ecubix.com/Apps/Report/rptPriSecStockist.aspx?a_id=379', {
        waitUntil: 'domcontentloaded'
      });

      await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
      await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

      for (const state of states) {
        console.log(`🌐 State: ${state}`);

        await page.locator('#ctl00_CPH_ddlRegion_B-1Img').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlRegion_DDD_L_LBI') and text()='${state}']`).click();

        await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
        await page.waitForTimeout(500);
        await page.locator('#changeYearMP').click();
        const fromYearId = await getYearIdFromPopup(page, year);
        await page.locator(fromYearId).click({ force: true });
        await page.getByText(fromMonth, { exact: true }).click();

        await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
        await page.waitForTimeout(500);
        await page.locator('#changeYearMP').click();
        const toYearId = await getYearIdFromPopup(page, year);
        await page.locator(toYearId).click({ force: true });
        await page.getByText(toMonth, { exact: true }).click();

        await page.locator('#ctl00_CPH_rptLayout_ddlLayout_B-1Img').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_rptLayout_ddlLayout_DDD_L_LBI') and text()='Automation']`).click();

        let download;
        try {
          const downloadPromise = page.waitForEvent('download', { timeout: 50000 });
          await page.locator('//*[@id="ctl00_CPH_btnExport"]/img').click();
          download = await downloadPromise;
        } catch (err) {
          console.warn(`⚠️ Download failed for ${division} → ${state}:`, err.message);
          continue;
        }

        const safeDivision = division.replace(/\s+/g, '_');
        const safeState = state.replace(/\s+/g, '_');
        const fileName = `StockistWise_${safeDivision}_${safeState}_${fromMonth}-${toMonth}-${year}.xlsx`;
        const filePath = path.join(DOWNLOADS_PATH, fileName);
        await download.saveAs(filePath);
        console.log(`📥 Downloaded: ${fileName}`);
      }
    }

    await sendFilesToN8N(DOWNLOADS_PATH, WEBHOOK_URL, folderId, executionId);

  } catch (err) {
    console.error('❌ Automation error:', err.message);
  } finally {
    await context.close();
    await browser.close();
    console.log('✅ All divisions processed. Browser closed.');
  }
}

processAllDivisions();
