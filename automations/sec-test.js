// Required packages
import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { config } from 'dotenv';
import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob';
import {
  TableClient,
  AzureNamedKeyCredential
} from '@azure/data-tables';

// Load environment variables
config();

const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT;
const AZURE_STORAGE_KEY = process.env.AZURE_STORAGE_KEY;
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME;
const AZURE_TABLE_NAME = 'secondary';

const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e';
const DOWNLOADS_PATH = path.join('secondary_sales_data');

let input = {
  fromMonth: 'Jan',
  toMonth: 'Apr',
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getMonthRange(from, to) {
  const start = MONTHS.indexOf(from);
  const end = MONTHS.indexOf(to);
  return MONTHS.slice(start, end + 1);
}

async function getYearIdFromPopup(page, desiredYear) {
  const y0Text = await page.locator('#y0').textContent();
  const baseYear = parseInt(y0Text?.trim());
  const offset = desiredYear - baseYear;
  return `#y${offset}`;
}

async function uploadToAzureBlobAndTable(directory) {
  const sharedKeyCredential = new StorageSharedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY);
  const blobServiceClient = new BlobServiceClient(`https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`, sharedKeyCredential);
  const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME);

  const tableClient = new TableClient(`https://${AZURE_STORAGE_ACCOUNT}.table.core.windows.net`, AZURE_TABLE_NAME, new AzureNamedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY));
  try {
    await tableClient.createTable();
  } catch {}

  const files = await fs.readdir(directory);
  for (const file of files) {
    const match = file.match(/^Secondary_(.+?)_(.+?)_(\w+)_(\d{4})\.xlsx$/);
    if (!match) continue;

    const [, divisionRaw, stateRaw, monthRaw, yearRaw] = match;
    const blobPath = `${yearRaw}/${monthRaw.toLowerCase()}/${file}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    try {
      const buffer = await fs.readFile(path.join(directory, file));
      await blockBlobClient.uploadData(buffer, {
        tags: {
          division: divisionRaw,
          state: stateRaw,
          month: monthRaw.toLowerCase(),
          year: yearRaw
        }
      });
      console.log(`📤 Uploaded: ${blobPath}`);

      await tableClient.createEntity({
        partitionKey: `${yearRaw}-${monthRaw.toLowerCase()}`,
        rowKey: `${divisionRaw}-${stateRaw}`,
        fileUrl: blockBlobClient.url,
        division: divisionRaw,
        state: stateRaw,
        month: monthRaw.toLowerCase(),
        year: yearRaw
      });
    } catch (err) {
      console.error(`❌ Failed for ${file}:`, err.message);
    }
  }
}

async function uploadToWebhook(directory, folderId, executionId) {
  const files = await fs.readdir(directory);
  if (!files.length) return;

  const formData = new FormData();
  for (const file of files) {
    const stream = await fs.readFile(path.join(directory, file));
    formData.append('files', stream, file);
    formData.append('file_names', file);
  }

  await fetch(`${WEBHOOK_URL}?folderId=${folderId}&executionId=${executionId}`, {
    method: 'POST',
    body: formData,
    headers: formData.getHeaders()
  });
}

async function processAllDivisions() {
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const divisionStateMap = {
    'Kerala Elbrit': ['Kerala']
  };

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx');
  await page.fill('#txtUserName', 'E00134');
  await page.fill('#txtPassword', 'Elbrit9999');
  await page.click('#btnLogin');

  try {
    await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').click({ timeout: 10000 });
  } catch {}

  await page.waitForSelector('text=Master', { timeout: 100000 });
  const monthsToDownload = getMonthRange(fromMonth, toMonth);

  for (const [division, states] of Object.entries(divisionStateMap)) {
    await page.goto('https://elbrit.ecubix.com/Apps/Report/rptPriSecStockist.aspx?a_id=379');
    await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
    await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

    for (const state of states) {
      await page.locator('#ctl00_CPH_ddlRegion_B-1Img').click();
      await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlRegion_DDD_L_LBI') and text()='${state}']`).click();

      for (const month of monthsToDownload) {
        await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
        await page.locator('#changeYearMP').click();
        await page.locator(await getYearIdFromPopup(page, year)).click({ force: true });
        await page.getByText(month, { exact: true }).click();

        await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
        await page.locator('#changeYearMP').click();
        await page.locator(await getYearIdFromPopup(page, year)).click({ force: true });
        await page.getByText(month, { exact: true }).click();

        await page.locator('#ctl00_CPH_rptLayout_ddlLayout_B-1Img').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_rptLayout_ddlLayout_DDD_L_LBI') and text()='Automation']`).click();

        try {
          const downloadPromise = page.waitForEvent('download', { timeout: 50000 });
          await page.locator('//*[@id="ctl00_CPH_btnExport"]/img').click();
          const download = await downloadPromise;

          const fileName = `Secondary_${division}_${state}_${month}_${year}.xlsx`;
          const filePath = path.join(DOWNLOADS_PATH, fileName);
          await download.saveAs(filePath);
          console.log(`📥 Downloaded: ${fileName}`);
        } catch {
          console.warn(`⚠️ Download failed for ${division} - ${state} - ${month}`);
        }
      }
    }
  }

  await uploadToAzureBlobAndTable(DOWNLOADS_PATH);
  await uploadToWebhook(DOWNLOADS_PATH, folderId, executionId);

  await context.close();
  await browser.close();
  console.log('✅ All done.');
}

processAllDivisions();
