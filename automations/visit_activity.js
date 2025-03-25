import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

const DOWNLOADS_PATH = path.join('visit_data'); // ✅ changed from "downloads" to "visit_data"
const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

let input = {
  months: ['Jan'],
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
  console.error('❌ Failed to parse INPUT_JSON:', error);
}

const { months, year, folderId } = input;

async function processDivisions() {
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const divisions = [
    'AP ELBRIT', 'Delhi Elbrit', 'Elbrit', 'ELBRIT AURA PROXIMA',
    'KE Aura N Proxima', 'Elbrit CND', 'KA Elbrit', 'Kerala Elbrit', 'VASCO'
  ];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing: ${division}`);
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
          console.log(`🗓️ ${month}-${year} for ${division}`);
          try {
            await page.goto('https://elbrit.ecubix.com/Apps/Report/frmDownloadDrDetails.aspx?a_id=376', {
              timeout: 60000,
              waitUntil: 'domcontentloaded'
            });

            // FROM Month-Year
            await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            await page.locator('//*[@id="y3"]').click({ force: true });
            await page.getByText(month, { exact: true }).click();

            // TO Month-Year
            await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            await page.locator('//*[@id="y3"]').click({ force: true });
            await page.getByText(month, { exact: true }).click();

            // Division
            await page.locator('#ctl00_CPH_ddlDivision_B-1').click();
            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and contains(@class, 'dxeListBoxItem') and text()='${division}']`).click();

            // Check all 6 designations
            for (let i = 0; i <= 5; i++) {
                await page.locator(`#ctl00_CPH_chkDesignation_${i}`).check();
            }
            
            // ✅ Also check Visit Count and Visit Dates
            await page.locator('#ctl00_CPH_chkVisit').check();
            await page.locator('#ctl00_CPH_chkVisitDates').check();
            
            // Trigger Download
            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
            await page.locator('#ctl00_CPH_imgExcel').click();
            const download = await downloadPromise;
  

            const fileName = `Visit_Activity_${division.replace(/\s+/g, '_')}_${month}-${year}.xlsx`;
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

    await sendFilesToN8N(DOWNLOADS_PATH, folderId);
  } catch (error) {
    console.error('❌ Automation error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ All divisions processed and browser closed!');
  }
}

async function sendFilesToN8N(directory, folderId = '') {
  try {
    const files = await fs.readdir(directory);
    if (files.length === 0) {
      console.log('📭 No files to send.');
      return;
    }

    const formData = new FormData();
    const fileNames = [];

    for (const file of files) {
      const filePath = path.join(directory, file);
      const fileStream = await fs.readFile(filePath);
      formData.append('files', fileStream, file);
      fileNames.push(file);
    }

    formData.append('file_names', fileNames.join(','));

    const webhookUrl = `${WEBHOOK_URL}?folderId=${encodeURIComponent(folderId)}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (response.ok) {
      console.log('📤 Files sent to n8n webhook.');
    } else {
      console.error('❌ Webhook failed:', await response.text());
    }
  } catch (error) {
    console.error('❌ Error sending to n8n:', error.message);
  }
}

processDivisions();