import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { config } from 'dotenv';
import fetch from 'node-fetch';
import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob';
import {
  TableClient,
  AzureNamedKeyCredential
} from '@azure/data-tables';
import {
  clearOldFiles,
  loginToEcubix
} from './ecubix-utils.js';

config();

const downloadsPath = path.join('pob_daily_data');
const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT;
const AZURE_STORAGE_KEY = process.env.AZURE_STORAGE_KEY;
const CONTAINER_NAME = 'pob';
const TABLE_NAME = 'pob';
const WEBHOOK_URL = 'https://elbrit-prod.app.n8n.cloud/webhook/d65d4634-5501-4076-a9c3-bac3049f43f8';

// === Input Config ===
let configInput = {
  fromDate: '2025-07-01',
  toDate: '2025-07-25',
  folderId: '',
  executionId: 'IFFcwOf4T1miptbI'
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    configInput = { ...configInput, ...parsed };
    console.log('✅ Loaded dynamic INPUT_JSON:', configInput);
  } else {
    console.warn('⚠️ No INPUT_JSON provided. Using fallback defaults.');
  }
} catch (err) {
  console.error('❌ Failed to parse INPUT_JSON:', err.message);
  process.exit(1);
}

function parseDate(dateStr, label) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${dateStr}`);
  return date;
}

const fromDate = parseDate(configInput.fromDate, 'fromDate');
const toDate = parseDate(configInput.toDate, 'toDate');
const year = fromDate.getFullYear();
const month = fromDate.toLocaleString('default', { month: 'short' }).toLowerCase();

// === Webhook Trigger Function ===
async function triggerWebhook(partitionKey) {
  try {
    // Extract year and month from partition key (format: "YYYY-MMM")
    const [yearPart, monthPart] = partitionKey.split('-');
    const formattedDate = `${yearPart}-${monthPart}`;
    
    const webhookData = {
      Date: formattedDate,
      Drop: "true",
      flow: "crm",
      Type: ['pob']
    };

    console.log(`🔔 Triggering webhook with data:`, webhookData);
    console.log(`🌐 POST URL: ${WEBHOOK_URL}`);
    
    console.log(`📄 POST Body: ${JSON.stringify(webhookData)}`);

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookData)
    });

    if (response.ok) {
      console.log(`✅ Webhook triggered successfully for ${formattedDate}`);
      const responseText = await response.text();
      console.log(`📝 Response: ${responseText}`);
    } else {
      console.error(`❌ Webhook failed with status: ${response.status}`);
      const responseText = await response.text();
      console.error(`📝 Error response: ${responseText}`);
    }
  } catch (error) {
    console.error(`❌ Error triggering webhook:`, error.message);
  }
}

const divisions = [
  'AP ELBRIT',
  'Delhi Elbrit',
  'Elbrit',
  'ELBRIT AURA PROXIMA',
  'Elbrit Bangalore',
  'Elbrit Mysore',
  'KE Aura N Proxima',
  'Elbrit CND',
  'Kerala Elbrit',
  'VASCO'
];

// === Upload to Azure ===
async function uploadToAzureBlobAndTable(directory, year, month) {
  const sharedKey = new StorageSharedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY);
  const blobClient = new BlobServiceClient(`https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`, sharedKey);
  const containerClient = blobClient.getContainerClient(CONTAINER_NAME);
  await containerClient.createIfNotExists();

  const tableClient = new TableClient(
    `https://${AZURE_STORAGE_ACCOUNT}.table.core.windows.net`,
    TABLE_NAME,
    new AzureNamedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY)
  );

  try {
    await tableClient.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }

  const files = await fs.readdir(directory);
  const uniquePartitionKeys = new Set();

  for (const file of files) {
    const match = file.match(/^POB_Daily_(.+?)_(\d{4}-\d{2}-\d{2})\.xlsx$/);
    if (!match) {
      console.warn(`⚠️ Skipping invalid file: ${file}`);
      continue;
    }

    const divisionRaw = match[1].replace(/_/g, ' ');
    const fileDate = match[2]; // Extract the date from filename (YYYY-MM-DD)
    
    // Parse the file date to get the correct year and month
    const fileDateObj = new Date(fileDate);
    const fileYear = fileDateObj.getFullYear();
    const fileMonth = fileDateObj.toLocaleString('default', { month: 'short' }).toLowerCase();
    
    const blobPath = `${fileYear}/${fileMonth}/${file}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    const buffer = await fs.readFile(path.join(directory, file));

    await blockBlobClient.uploadData(buffer, {
      tags: { division: divisionRaw, month: fileMonth, year: fileYear.toString() }
    });
    console.log(`📤 Uploaded to Azure Blob: ${blobPath}`);

    const partitionKey = `${fileYear}-${fileMonth}`;
    uniquePartitionKeys.add(partitionKey);

    await tableClient.upsertEntity({
      partitionKey: partitionKey,
      rowKey: `${divisionRaw}`,
      fileUrl: blockBlobClient.url,
      division: divisionRaw,
      month: fileMonth,
      year: fileYear
    }, "Replace");
    console.log(`📝 Metadata written for: ${divisionRaw}`);
  }

  return Array.from(uniquePartitionKeys);
}

// === Date Selection Helpers ===
async function selectFromDate(page, fromDate) {
  await page.locator('#ctl00_CPH_Image2').click();
  const targetMonth = fromDate.toLocaleString('default', { month: 'long' });
  const targetYear = fromDate.getFullYear();
  const targetDay = String(fromDate.getDate()).padStart(2, '0');

  while (true) {
    const header = await page.locator('//*[@id="ctl00_CPH_DateFromDate_title"]').innerText();
    const [displayedMonth, displayedYear] = header.split(',').map(s => s.trim());
    if (displayedMonth === targetMonth && parseInt(displayedYear) === targetYear) break;

    const currentDate = new Date(`${displayedMonth} 1, ${displayedYear}`);
    const targetDate = new Date(targetYear, fromDate.getMonth());
    if (targetDate > currentDate) {
      await page.locator('//*[@id="ctl00_CPH_DateFromDate_nextArrow"]').click();
    } else {
      await page.locator('//*[@id="ctl00_CPH_DateFromDate_prevArrow"]').click();
    }
    await page.waitForTimeout(300);
  }

  const fullDateTitle = `${targetMonth} ${targetDay}, ${targetYear}`;
  const daySelector = `xpath=//*[contains(@title,"${fullDateTitle}")]`;
  const dayCell = page.locator(daySelector);
  if (await dayCell.count() === 0) throw new Error(`❌ From Date not found: ${fullDateTitle}`);
  await dayCell.first().click();
}

async function selectToDate(page, toDate) {
  await page.locator('#ctl00_CPH_Image1').click();
  await page.waitForSelector('//*[@id="ctl00_CPH_CalendarExtender1_title"]', { timeout: 3000 });

  const targetMonth = toDate.toLocaleString('default', { month: 'long' });
  const targetYear = toDate.getFullYear();
  const targetDay = String(toDate.getDate()).padStart(2, '0');
  const targetDateText = `${targetMonth} ${targetDay}, ${targetYear}`;

  while (true) {
    const header = await page.locator('//*[@id="ctl00_CPH_CalendarExtender1_title"]').innerText();
    const [displayedMonth, displayedYear] = header.split(',').map(s => s.trim());
    if (displayedMonth === targetMonth && parseInt(displayedYear) === targetYear) break;

    const currentDate = new Date(`${displayedMonth} 1, ${displayedYear}`);
    const targetDate = new Date(targetYear, toDate.getMonth());
    if (targetDate > currentDate) {
      await page.locator('//*[@id="ctl00_CPH_CalendarExtender1_nextArrow"]').click();
    } else {
      await page.locator('//*[@id="ctl00_CPH_CalendarExtender1_prevArrow"]').click();
    }
    await page.waitForTimeout(300);
  }

  const dayLocator = page.locator(`//div[contains(@id, 'ctl00_CPH_CalendarExtender1_day_') and contains(@title, "${targetDateText}")]`);
  await dayLocator.first().waitFor({ timeout: 1000 });
  await dayLocator.first().click();
}

// === Main Automation ===
async function processDivisions() {
  await clearOldFiles(downloadsPath);
  await fs.mkdir(downloadsPath, { recursive: true });
  const formattedFromDate = `${fromDate.getFullYear()}-${(fromDate.getMonth() + 1).toString().padStart(2, '0')}-${fromDate.getDate().toString().padStart(2, '0')}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing division: ${division}`);
      const page = await context.newPage();

      try {
        await loginToEcubix(page);

        await page.goto('https://elbrit.ecubix.com/Apps/Report/Sales/frmCustomerPOBAnalysis.aspx?a_id=802');
        await page.waitForLoadState('networkidle');

        await page.locator('#ctl00_CPH_chkCustomerType_0').check();
        await page.locator('#ctl00_CPH_rbldatemonth_1').click();

        await selectFromDate(page, fromDate);
        await selectToDate(page, toDate);

        await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
        await page.locator('#ctl00_CPH_ddlDivision_DDD_L_LBT').waitFor({ timeout: 10000 });
        const divisionOption = page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and normalize-space(text())='${division}']`);
        await divisionOption.waitFor({ timeout: 10000 });
        await divisionOption.click();

        const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
        await page.locator('#ctl00_CPH_btnDownload').click();
        const download = await downloadPromise.catch(() => null);

        if (!download) {
          console.warn(`⚠️ No file downloaded for ${division}. Skipping.`);
          continue;
        }

        const fileName = `POB_Daily_${division.replace(/\s+/g, '_')}_${formattedFromDate}.xlsx`;
        const filePath = path.join(downloadsPath, fileName);
        await download.saveAs(filePath);
        console.log(`✅ Downloaded: ${fileName}`);
      } catch (error) {
        console.error(`❌ Error for ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }

    const partitionKeys = await uploadToAzureBlobAndTable(downloadsPath, year, month);

    // Trigger webhook for each unique partition key
    console.log('\n🔔 Triggering webhooks...');
    for (const partitionKey of partitionKeys) {
      await triggerWebhook(partitionKey);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log(`\n✅ All divisions processed for POB Date Wise.`);
  }
}

processDivisions();
