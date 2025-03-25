import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';

// === Step 1: Accept Dynamic Inputs via INPUT_JSON ===
let input = {
  months: ['Jan'],  // default fallback
  year: 2025,
  folderId: ''
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = {
      months: parsed.months || input.months,
      year: parsed.year || input.year,
      folderId: parsed.folderId || input.folderId
    };
    console.log('✅ Dynamic input loaded:', input);
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON. Using defaults. Error:', error);
}

const months = input.months;
const targetYear = input.year;
const folderId = input.folderId;

async function processDivisions() {
  const downloadsPath = path.join(`DRSERVICE_${targetYear}`);
  await fs.mkdir(downloadsPath, { recursive: true });

  const divisions = [
    'AP ELBRIT',
    'Delhi Elbrit',
    'Elbrit',
    'ELBRIT AURA PROXIMA',
    'KE Aura N Proxima',
    'Elbrit CND',
    'KA Elbrit',
    'Kerala Elbrit',
    'VASCO'
  ];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing division: ${division}`);
      const page = await context.newPage();

      try {
        // Login
        await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx', {
          timeout: 60000,
          waitUntil: 'domcontentloaded'
        });
        await page.locator('#txtUserName').fill('E00134');
        await page.locator('#txtPassword').fill('Elbrit9999');
        await page.locator('#btnLogin').click();

        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').click();

        for (const month of months) {
          console.log(`🗓️  Processing ${month}-${targetYear} for ${division}`);
          try {
            await page.goto('https://elbrit.ecubix.com/Apps/Report/rptTillDateServiceDownload.aspx?a_id=375', {
              timeout: 60000,
              waitUntil: 'domcontentloaded'
            });

            // Select From Month-Year
            await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            await page.locator('//*[@id="y3"]').click({ force: true }); // Still static for now
            await page.getByText(month, { exact: true }).click();

            // Select To Month-Year
            await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            await page.locator('//*[@id="y3"]').click({ force: true });
            await page.getByText(month, { exact: true }).click();

            // Select Division
            await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and contains(@class, 'dxeListBoxItem') and text()='${division}']`).click();

            // Download the report
            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
            await page.getByRole('button', { name: 'Download' }).click();
            const download = await downloadPromise;

            const fileName = `All_Dr_Service_${division.replace(/\s+/g, '_')}_${month}-${targetYear}.xlsx`;
            const filePath = path.join(downloadsPath, fileName);
            await download.saveAs(filePath);

            console.log(`✅ Downloaded: ${fileName}`);
          } catch (error) {
            console.error(`❌ Error processing ${month}-${targetYear} for ${division}:`, error.message);
          }
        }

        console.log(`✅ Completed processing division: ${division}`);
      } catch (error) {
        console.error(`❌ Failed to process division ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log(`\n✅ All divisions processed successfully for year ${targetYear}!`);
  }
}

processDivisions();
