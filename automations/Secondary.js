// secondary-sales-azure.js
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
  getYearIdFromPopup,
  clearOldFiles,
  loginToEcubix
} from './ecubix-utils.js';

config();

const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT;
const AZURE_STORAGE_KEY = process.env.AZURE_STORAGE_KEY;
const AZURE_CONTAINER_NAME = 'secondary-reports';
const AZURE_TABLE_NAME = 'secondary';
const DOWNLOADS_PATH = path.join('secondary_sales_data');
const WEBHOOK_URL = 'https://elbrit-prod.app.n8n.cloud/webhook/6d0f1b49-eeb9-44d5-80c3-dc9b89c2484a';

let input = {
  fromMonth: 'Jul',
  toMonth: 'Jul',
  year: 2025,
  folderId: '',
  executionId: ''
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

const { fromMonth, toMonth, year } = input;

async function triggerWebhook(partitionKey) {
  try {
    // Extract year and month from partition key (format: "YYYY-MMM")
    const [yearPart, monthPart] = partitionKey.split('-');
    const formattedDate = `${yearPart}-${monthPart}`;
    
    const webhookData = {
      Date: formattedDate,
      Drop: true
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

async function uploadToAzureBlobAndTable(directory, year, month) {
  const sharedKey = new StorageSharedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY);
  const blobClient = new BlobServiceClient(`https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`, sharedKey);
  const containerClient = blobClient.getContainerClient(AZURE_CONTAINER_NAME);
  await containerClient.createIfNotExists();

  const tableClient = new TableClient(`https://${AZURE_STORAGE_ACCOUNT}.table.core.windows.net`, AZURE_TABLE_NAME, new AzureNamedKeyCredential(AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY));

  try {
    await tableClient.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }

  const files = await fs.readdir(directory);
  const uniquePartitionKeys = new Set();

  for (const file of files) {
    const match = file.match(/^Secondary_(.+?)_(.+?)_(\w+)_(\d{4})\.xlsx$/);
    if (!match) {
      console.warn(`⚠️ Skipping invalid file: ${file}`);
      continue;
    }

    const [, division, state, monthRaw, yearRaw] = match;
    const month = monthRaw.toLowerCase();
    const blobPath = `${yearRaw}/${month}/${file}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    const buffer = await fs.readFile(path.join(directory, file));

    await blockBlobClient.uploadData(buffer, {
      tags: { division, state, month, year }
    });
    console.log(`📤 Uploaded to Azure Blob: ${blobPath}`);

    // await tableClient.createEntity({
    //   partitionKey: `${yearRaw}-${month}`,
    //   rowKey: `${division}-${state}`,
    //   fileUrl: blockBlobClient.url,
    //   division,
    //   state,
    //   month,
    //   year
    // }, "Replace");

    const partitionKey = `${yearRaw}-${month}`;
    uniquePartitionKeys.add(partitionKey);

    await tableClient.upsertEntity({
    partitionKey: partitionKey,
    rowKey: `${division}-${state}`,
    fileUrl: blockBlobClient.url,
    division,
    state,
    month,
    year
    }, "Replace");
    console.log(`📝 Logged metadata for: ${division}-${state}`);
  }

  return Array.from(uniquePartitionKeys);
}

async function processAllDivisions() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await loginToEcubix(page);
    
    for (const [division, states] of Object.entries(divisionStateMap)) {
      console.log(`\n🚀 Processing Division: ${division}`);
      await page.goto('https://elbrit.ecubix.com/Apps/Report/rptPriSecStockist.aspx?a_id=379');
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

        try {
          const downloadPromise = page.waitForEvent('download', { timeout: 50000 });
          await page.locator('#ctl00_CPH_btnExport img').click();
          const download = await downloadPromise;

          const fileName = `Secondary_${division}_${state}_${fromMonth}_${year}.xlsx`;
          const filePath = path.join(DOWNLOADS_PATH, fileName);
          await download.saveAs(filePath);
          console.log(`📥 Downloaded: ${fileName}`);
        } catch (err) {
          console.warn(`⚠️ Failed to download for ${division} → ${state}:`, err.message);
        }
      }
    }

    const partitionKeys = await uploadToAzureBlobAndTable(DOWNLOADS_PATH, year, fromMonth);

    // Trigger webhook for each unique partition key
    console.log('\n🔔 Triggering webhooks...');
    for (const partitionKey of partitionKeys) {
      await triggerWebhook(partitionKey);
    }

  } catch (err) {
    console.error('❌ Automation error:', err.message);
  } finally {
    await context.close();
    await browser.close();
    console.log('✅ Finished all divisions');
  }
}

processAllDivisions();