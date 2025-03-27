import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

const DOWNLOADS_PATH = path.join('secondary_sales_data'); // ✅ Clean folder name
const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

let input = {
  months: ['Jan'],
  startYear: 2025,
  endYear: 2025,
  yearIdMap: { 2025: 'y3' },
  folderId: '',
  executionId: '',
  divisionStateHQMap: {}
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = {
      months: parsed.months || input.months,
      startYear: parsed.startYear || input.startYear,
      endYear: parsed.endYear || input.endYear,
      yearIdMap: parsed.yearIdMap || input.yearIdMap,
      folderId: parsed.folderId || input.folderId,
      executionId: parsed.executionId || input.executionId,
      divisionStateHQMap: parsed.divisionStateHQMap || input.divisionStateHQMap
    };
    console.log('✅ Loaded dynamic input:\n', JSON.stringify(input, null, 2));
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON. Using defaults. Error:', error);
}

const { months, startYear, endYear, yearIdMap, folderId, executionId, divisionStateHQMap } = input;

async function processDivisions() {
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const [division, states] of Object.entries(divisionStateHQMap)) {
      console.log(`\n🚀 Division: ${division}`);
      const page = await context.newPage();

      try {
        // Login
        await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx');
        await page.locator('#txtUserName').fill('E00134');
        await page.locator('#txtPassword').fill('Elbrit9999');
        await page.locator('#btnLogin').click();
        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA', { timeout: 10000 }).click();

        for (let year = startYear; year <= endYear; year++) {
          const yearMonths = year === 2025 ? months : input.months;

          for (const month of yearMonths) {
            console.log(`🗓️ ${month}-${year}`);

            await page.goto('https://elbrit.ecubix.com/Apps/Upload/frmUploadMonthSecondaryDownloadData.aspx?a_id=381');
            await page.waitForLoadState('networkidle');

            // Select Division (strict match)
            await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
            await page.getByRole('cell', { name: division, exact: true }).click();


            // Month-Year
            await page.locator('#ctl00_CPH_uclMonthSelect_imgOK').click();
            await page.locator('#changeYearMP').click({ force: true });
            await page.locator(`#${yearIdMap[year]}`).click({ force: true });
            await page.getByRole('cell', { name: month, exact: true }).click();

            for (const [state, hqList] of Object.entries(states)) {
              console.log(`🌐 State: ${state} | HQs: ${hqList.join(', ')}`);

              // Select State
              await page.locator('#ctl00_CPH_ddlRegion_B-1Img').click();
              await page.locator(`xpath=//td[contains(text(),"${state}")]`).click();
              await page.waitForTimeout(1000);

              // Open HQ dropdown
              await page.locator('#ctl00_CPH_ddlHQ_B-1Img').click();
              await page.waitForTimeout(500);

              // Always select the first (default) HQ checkbox
              await page.locator('xpath=//*[@id="ctl00_CPH_ddlHQ_DDD_DDTC_lstHQ_LBI0T1"]').click();

              // Now select HQs by specific index
              for (const hq of hqList) {
                const fullId = `ctl00_CPH_ddlHQ_DDD_DDTC_lstHQ_LBI${hq.index}T1`;
                console.log(`✅ Selecting HQ: ${hq.name} (ID: ${fullId})`);
                await page.locator(`xpath=//*[@id="${fullId}"]`).click();
              }

              // Close dropdown
              await page.locator('#ctl00_CPH_ddlHQ_B-1Img').click();
              await page.waitForTimeout(1000);

              // Trigger Download
              const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
              await page.locator('#ctl00_CPH_btndownload img').click();
              const download = await downloadPromise;

              const fileName = `Secondary_${division.replace(/\s+/g, '_')}_${state.replace(/\s+/g, '_')}_${month}-${year}.xlsx`;
              const filePath = path.join(DOWNLOADS_PATH, fileName);
              await download.saveAs(filePath);
              console.log(`📥 Saved: ${fileName}`);
            }
          }
        }
      } catch (err) {
        console.error(`❌ Error processing ${division}:`, err.message);
      } finally {
        await page.close();
      }
    }

    await uploadToWebhook(DOWNLOADS_PATH, folderId, executionId);
  } catch (err) {
    console.error('❌ Automation error:', err.message);
  } finally {
    await browser.close();
    console.log('✅ All divisions processed and browser closed.');
  }
}

async function uploadToWebhook(directory, folderId, executionId) {
  try {
    const files = await fs.readdir(directory);
    if (files.length === 0) {
      console.log('📭 No files to upload.');
      return;
    }

    const formData = new FormData();
    for (const file of files) {
      const filePath = path.join(directory, file);
      const stream = await fs.readFile(filePath);
      formData.append('files', stream, file);
      formData.append('file_names', file);
    }

    const webhookUrl = `${WEBHOOK_URL}?folderId=${encodeURIComponent(folderId)}&executionId=${encodeURIComponent(executionId)}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (response.ok) {
      console.log('📤 Uploaded files to webhook');
    } else {
      console.error('❌ Webhook upload failed:', await response.text());
    }
  } catch (err) {
    console.error('❌ Upload error:', err.message);
  }
}

processDivisions();
