import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

// === Step 1: Accept Dynamic Inputs via INPUT_JSON ===
let input = {
  months: ['Jan'],
  year: 2025,
  folderId: '',
  executionId: ''
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = {
      months: parsed.months || input.months,
      year: parsed.year || input.year,
      folderId: parsed.folderId || input.folderId,
      executionId: parsed.executionId || input.executionId
    };
    console.log('✅ Dynamic input loaded:', input);
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON. Using defaults. Error:', error);
}

const { months, year: targetYear, folderId, executionId } = input;
const downloadsPath = path.join(`DRSERVICE_${targetYear}`);

async function processDivisions() {
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

            // From month-year
            await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            await page.locator('//*[@id="y3"]').click({ force: true });
            await page.getByText(month, { exact: true }).click();

            // To month-year
            await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            await page.locator('//*[@id="y3"]').click({ force: true });
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

    // ✅ Send files to webhook
    await sendFilesToN8N(downloadsPath, folderId, executionId);

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log(`\n✅ All divisions processed successfully for year ${targetYear}!`);
  }
}

async function sendFilesToN8N(directory, folderId = '', executionId = '') {
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

    for (const name of fileNames) {
      formData.append('file_names', name);
    }

    const webhookUrl = `${WEBHOOK_URL}?folderId=${encodeURIComponent(folderId)}&executionId=${encodeURIComponent(executionId)}`;

    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });

    if (response.ok) {
      console.log('📤 Files successfully sent to n8n.');
    } else {
      console.error('❌ Failed to send files to n8n:', await response.text());
    }
  } catch (error) {
    console.error('❌ Error sending files to n8n:', error.message);
  }
}

processDivisions();
