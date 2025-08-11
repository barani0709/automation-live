// visit-activity.js
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

const AZURE_STORAGE_ACCOUNT = 'elbrit';
const AZURE_STORAGE_KEY = 'ZEGJoULtZM+wqYf7Ls7IIhs3axdSSIp0ceZcHaRjKJeCugfTO7rz887WWm2zuAe3RVzRJ3XiXduK+AStdVeiBA==';
const CONTAINER_NAME = 'visit';
const TABLE_NAME = 'visit';
const DOWNLOADS_PATH = path.join('visit_data');
const WEBHOOK_URL = 'https://elbrit-prod2.app.n8n.cloud/webhook/d65d4634-5501-4076-a9c3-bac3049f43f8';

let input = {
  fromMonth: 'Jul',
  toMonth: 'Jul',
  year: 2025
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = {
      fromMonth: parsed.fromMonth || input.fromMonth,
      toMonth: parsed.toMonth || input.toMonth,
      year: parsed.year || input.year
    };
    console.log('✅ Dynamic input loaded (with fixed IDs):', input);
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON:', error);
}

const { fromMonth, toMonth, year } = input;
const allMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const selectedMonths = allMonths.slice(allMonths.indexOf(fromMonth), allMonths.indexOf(toMonth) + 1);

const divisions = [
  'AP ELBRIT', 'Delhi Elbrit', 'Elbrit', 'ELBRIT AURA PROXIMA',
  'KE Aura N Proxima', 'Elbrit CND', 'Elbrit Bangalore', 'Elbrit Mysore', 'Kerala Elbrit', 'VASCO'
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
      Type: ['visit']
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
    const match = file.match(/^Visit_Activity_(.+?)_(\w+)-(\d{4})\.csv$/);
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
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing: ${division}`);
      const page = await context.newPage();

      try {
        await loginToEcubix(page);

        for (const month of selectedMonths) {
          console.log(`🗓️ ${month}-${year} for ${division}`);

          try {
            await page.goto('https://elbrit.ecubix.com/Apps/Report/frmDownloadDrDetails.aspx?a_id=376', {
              timeout: 60000,
              waitUntil: 'domcontentloaded'
            });

            await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
            await page.waitForTimeout(500);
            await page.locator('#changeYearMP').click({ force: true });
            await page.waitForTimeout(500);
            const fromYearId = await getYearIdFromPopup(page, year);
            await page.locator(fromYearId).click({ force: true });
            await page.waitForTimeout(500);
            await page.getByText(month, { exact: true }).click();

            await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
            await page.waitForTimeout(500);
            await page.locator('#changeYearMP').click({ force: true });
            await page.waitForTimeout(500);
            // const toYearId = await getYearIdFromPopup(page, year);
            await page.locator('#y3').click({ force: true });
            await page.waitForTimeout(500);
            await page.getByText(month, { exact: true }).click();

            await page.locator('#ctl00_CPH_ddlDivision_B-1').click();
            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

            for (let i = 0; i <= 5; i++) {
              await page.locator(`#ctl00_CPH_chkDesignation_${i}`).check();
            }

            await page.locator('#ctl00_CPH_chkVisit').check();//*[@id="ctl00_CPH_chkServiceWithDates"]
            await page.locator('#ctl00_CPH_chkVisitDates').check();//*[@id="ctl00_CPH_chkSupport"]

            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });//*[@id="ctl00_CPH_chkService"]
            await page.locator('#ctl00_CPH_imgExcel').click();
            const download = await downloadPromise;

            const fileName = `Visit_Activity_${division}_${month}-${year}.csv`;
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

    const partitionKeys = await uploadToAzureBlobAndTable(DOWNLOADS_PATH, year, fromMonth);

    // Trigger webhook for each unique partition key
    console.log('\n🔔 Triggering webhooks...');
    for (const partitionKey of partitionKeys) {
      await triggerWebhook(partitionKey);
    }

  } catch (error) {
    console.error('❌ Automation error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ All divisions processed and browser closed!');
  }
}

processDivisions();