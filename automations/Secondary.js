// Required packages
import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob';

const AZURE_STORAGE_ACCOUNT = 'elbrit';
const AZURE_STORAGE_KEY = 'ZEGJoULtZM+wqYf7Ls7IIhs3axdSSIp0ceZcHaRjKJeCugfTO7rz887WWm2zuAe3RVzRJ3XiXduK+AStdVeiBA==';
const AZURE_CONTAINER_NAME = 'secondary-reports';

const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';
const DOWNLOADS_PATH = path.join('secondary_sales_data');

let input = {
  fromMonth: 'Jan',
  toMonth: 'Jan',
  year: 2025,
  folderId: '01VW6POPKOZ4GMMSVER5HIQ3DDCWMZDDTC',
  executionId: 'uhGmhLcxRS1eoEZ8'
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = { ...input, ...parsed };
    console.log('✅ Loaded dynamic input:\n', JSON.stringify(input, null, 2));
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON. Using defaults. Error:', error);
}

const { fromMonth, toMonth, year, folderId, executionId } = input;

async function getYearIdFromPopup(page, desiredYear) {
  const y0Text = await page.locator('#y0').textContent();
  const baseYear = parseInt(y0Text?.trim());
  const offset = desiredYear - baseYear;
  return `#y${offset}`;
}

async function uploadToAzureBlob(directory, year, month) {
  const sharedKeyCredential = new StorageSharedKeyCredential(
    AZURE_STORAGE_ACCOUNT,
    AZURE_STORAGE_KEY
  );
  const blobServiceClient = new BlobServiceClient(
    `https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
    sharedKeyCredential
  );
  const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME);

  const files = await fs.readdir(directory);
  if (!files.length) {
    console.log('📭 No files to upload.');
    return;
  }

  for (const file of files) {
    const match = file.match(/^StockistWise_(.+)_(.+)_(\w+)-\w+-(\d{4})\.xlsx$/);
    if (!match) {
      console.warn(`⚠️ Skipping unrecognized file format: ${file}`);
      continue;
    }

    const [, safeDivision, safeState, monthTag, yearTag] = match;
    const blobPath = `${yearTag}/${monthTag}/${file}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    try {
      const buffer = await fs.readFile(path.join(directory, file));
      await blockBlobClient.uploadData(buffer, {
        tags: {
          division: safeDivision.replace(/_/g, ' '),
          state: safeState.replace(/_/g, ' '),
          month: monthTag.toLowerCase(),
          year: yearTag
        }
      });
      console.log(`📤 Uploaded to Azure: ${blobPath}`);
    } catch (err) {
      console.error(`❌ Failed to upload ${file}:`, err.message);
    }
  }
}

async function uploadToWebhook(directory, folderId, executionId) {
  try {
    const files = await fs.readdir(directory);
    if (!files.length) return console.log('📭 No files to upload.');

    const formData = new FormData();
    for (const file of files) {
      const stream = await fs.readFile(path.join(directory, file));
      formData.append('files', stream, file);
      formData.append('file_names', file);
    }

    const webhookUrl = `${WEBHOOK_URL}?folderId=${encodeURIComponent(folderId)}&executionId=${encodeURIComponent(executionId)}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (response.ok) console.log('📤 Files uploaded to webhook successfully.');
    else console.error('❌ Webhook upload failed:', await response.text());

  } catch (err) {
    console.error('❌ Upload error:', err.message);
  }
}

async function processAllDivisions() {
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const divisionStateMap = {
    'AP ELBRIT': ['Andhra Pradesh']
  };

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx', { waitUntil: 'domcontentloaded' });
    await page.fill('#txtUserName', 'E00134');
    await page.fill('#txtPassword', 'Elbrit9999');
    await page.click('#btnLogin');

    try {
      const reminder = page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA');
      await reminder.waitFor({ timeout: 10000 });
      await reminder.click();
    } catch {}

    await page.waitForSelector('text=Master', { timeout: 100000 });
    console.log('✅ Login successful. Starting download automation...');

    for (const [division, states] of Object.entries(divisionStateMap)) {
      console.log(`\n🚀 Division: ${division}`);
      await page.goto('https://elbrit.ecubix.com/Apps/Report/rptPriSecStockist.aspx?a_id=379', { waitUntil: 'domcontentloaded' });
      await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
      await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

      for (const state of states) {
        console.log(`🌐 State: ${state}`);
        await page.locator('#ctl00_CPH_ddlRegion_B-1Img').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlRegion_DDD_L_LBI') and text()='${state}']`).click();

        await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
        await page.waitForTimeout(1000);
        await page.locator('#changeYearMP').click();
        const fromYearId = await getYearIdFromPopup(page, year);
        await page.locator(fromYearId).click({ force: true });
        await page.waitForTimeout(500);
        await page.getByText(fromMonth, { exact: true }).click();

        await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
        await page.waitForTimeout(1000);
        await page.locator('#changeYearMP').click();
        const toYearId = await getYearIdFromPopup(page, year);
        await page.locator(toYearId).click({ force: true });
        await page.waitForTimeout(500);
        await page.getByText(toMonth, { exact: true }).click();

        await page.locator('#ctl00_CPH_rptLayout_ddlLayout_B-1Img').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_rptLayout_ddlLayout_DDD_L_LBI') and text()='Automation']`).click();

        let download;
        try {
          const downloadPromise = page.waitForEvent('download', { timeout: 50000 });
          await page.locator('//*[@id="ctl00_CPH_btnExport"]/img').click();
          download = await downloadPromise;
        } catch (err) {
          console.warn(`⚠️ Download failed or not triggered for ${division} → ${state}.`);
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

    await uploadToAzureBlob(DOWNLOADS_PATH, year, fromMonth);
    await uploadToWebhook(DOWNLOADS_PATH, folderId, executionId);

  } catch (error) {
    console.error('❌ Unexpected automation error:', error.message);
  } finally {
    await context.close();
    await browser.close();
    console.log('✅ All divisions processed. Browser closed.');
  }
}

processAllDivisions();
