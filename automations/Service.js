// dr-service.js
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
  loginToEcubix,
  clearOldFiles
} from './ecubix-utils.js';

config();

const AZURE_STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT;
const AZURE_STORAGE_KEY = process.env.AZURE_STORAGE_KEY;
const CONTAINER_NAME = 'service';
const TABLE_NAME = 'service';
const WEBHOOK_URL = 'https://elbrit-prod2.app.n8n.cloud/webhook/d65d4634-5501-4076-a9c3-bac3049f43f8';

let input = {
  months: ['Jun'],
  year: 2025
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = { ...input, ...parsed };
    console.log('✅ Dynamic input loaded:', input);
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON:', error);
}

const { months, year: targetYear } = input;
const downloadsPath = path.join(`DRSERVICE_${targetYear}`);

const divisions = [
  'AP ELBRIT', 
  'Delhi Elbrit', 'Elbrit', 'ELBRIT AURA PROXIMA',
  'KE Aura N Proxima', 'Elbrit CND', 'Elbrit Bangalore', 'Elbrit Mysore', 'Kerala Elbrit', 'VASCO','Vasco Karnataka'
];

async function triggerWebhook(partitionKey) {
  try {
    // Extract year and month from partition key (format: "YYYY-MMM")
    const [yearPart, monthPart] = partitionKey.split('-');
    const formattedDate = `${yearPart}-${monthPart}`;
    
    const webhookData = {
      Date: formattedDate,
      Drop: "true",
      flow: "crm",
      Type: ["service"]
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
    const match = file.match(/^All_Dr_Service_(.+?)_(\w+)-(\d{4})\.xlsx$/);
    if (!match) {
      console.warn(`⚠️ Skipping invalid file: ${file}`);
      continue;
    }

    const [, divisionRaw, monthRaw, yearRaw] = match;
    const division = divisionRaw;
    const month = monthRaw.toLowerCase();
    const blobPath = `${yearRaw}/${month}/${file}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    const buffer = await fs.readFile(path.join(directory, file));

    await blockBlobClient.uploadData(buffer, {
      tags: { division, month, year }
    });
    console.log(`📤 Uploaded to Azure Blob: ${blobPath}`);

    const partitionKey = `${yearRaw}-${month}`;
    uniquePartitionKeys.add(partitionKey);

    await tableClient.upsertEntity({
      partitionKey: partitionKey,
      rowKey: `${division}`,
      fileUrl: blockBlobClient.url,
      division,
      month,
      year
    }, "Replace");
    console.log(`📝 Logged metadata for: ${division}`);
  }

  return Array.from(uniquePartitionKeys);
}

async function processDivisions() {
  await clearOldFiles(downloadsPath);
  await fs.mkdir(downloadsPath, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing division: ${division}`);
      const page = await context.newPage();

      try {
        await loginToEcubix(page);

        for (const month of months) {
          console.log(`🗓️  Processing ${month}-${targetYear} for ${division}`);

          try {
            await page.goto('https://elbrit.ecubix.com/Apps/Report/rptTillDateServiceDownload.aspx?a_id=375', {
              timeout: 60000,
              waitUntil: 'domcontentloaded'
            });

            await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
            await page.waitForTimeout(500);
            await page.locator('#changeYearMP').click();
            await page.waitForTimeout(500);
            const fromYearId = await getYearIdFromPopup(page, targetYear);
            await page.locator(fromYearId).click({ force: true });
            await page.waitForTimeout(500);
            await page.getByText(month, { exact: true }).click();

            await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
            await page.waitForTimeout(500);
            await page.locator('#changeYearMP').click();
            await page.waitForTimeout(500);
            await page.locator('#y3').click({ force: true });
            await page.waitForTimeout(500);
            await page.getByText(month, { exact: true }).click();

            await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
            await page.getByRole('button', { name: 'Download' }).click();
            const download = await downloadPromise;

            const fileName = `All_Dr_Service_${division}_${month}-${targetYear}.xlsx`;
            const filePath = path.join(downloadsPath, fileName);
            await download.saveAs(filePath);

            console.log(`✅ Downloaded: ${fileName}`);
          } catch (error) {
            console.error(`❌ Error for ${month}-${targetYear} (${division}):`, error.message);
          }
        }

        console.log(`✅ Finished: ${division}`);
      } catch (error) {
        console.error(`❌ Login/Division error for ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }

    const partitionKeys = await uploadToAzureBlobAndTable(downloadsPath, targetYear, months[0]);

    // Trigger webhook for each unique partition key
    console.log('\n🔔 Triggering webhooks...');
    for (const partitionKey of partitionKeys) {
      await triggerWebhook(partitionKey);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log(`\n✅ All divisions processed for year ${targetYear}!`);
  }
}

processDivisions();
