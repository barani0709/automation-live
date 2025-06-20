// msl-detailed.js
import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { config } from 'dotenv';
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
const CONTAINER_NAME = 'support';
const TABLE_NAME = 'support';
const DOWNLOADS_PATH = path.join('downloads');

let input = {
  months: ['May'],
  startYear: 2025,
  endYear: 2025,
  folderId: '',
  executionId: ''
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = { ...input, ...parsed };
    console.log('✅ Loaded dynamic input:', input);
  } else {
    console.log('⚠️ No INPUT_JSON provided. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON:', error);
}

const { months, startYear, endYear } = input;

const divisions = [
  // 'AP ELBRIT', 
  // 'Delhi Elbrit', 'Elbrit', 
  'ELBRIT AURA PROXIMA',
  // 'KE Aura N Proxima', 'Elbrit CND', 'Elbrit Bangalore', 'Elbrit Mysore', 'Kerala Elbrit', 'VASCO'
];

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

  for (const file of files) {
    const match = file.match(/^MSL_Detailed_(.+?)_(\w+)-(\d{4})\.xlsx$/);
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

    // await tableClient.createEntity({
    //   partitionKey: `${yearRaw}-${month}`,
    //   rowKey: `${division}`,
    //   fileUrl: blockBlobClient.url,
    //   division,
    //   month,
    //   year
    // });
    await tableClient.upsertEntity({
    partitionKey: `${yearRaw}-${month}`,
    rowKey: `${division}`,
    fileUrl: blockBlobClient.url,
    division,
    month,
    year
    }, "Replace");
    console.log(`📝 Logged metadata for: ${division}`);
  }
}

async function processDivisions() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing division: ${division}`);
      const page = await context.newPage();

      try {
        await loginToEcubix(page);

        for (let year = startYear; year <= endYear; year++) {
          for (const month of months) {
            console.log(`🗓️  Processing ${month}-${year} for ${division}`);
            try {
              await page.goto('https://elbrit.ecubix.com/Apps/MSL/frmMSLDetail.aspx?a_id=341');
              await page.waitForLoadState('networkidle');

              // await page.locator('xpath=//*[@id="ctl00_CPH_rblMonthType_0"]').check({ force: true });

              await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();//*[@id="ctl00_CPH_uclMonth_imgOK"]
              await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and contains(@class, 'dxeListBoxItem') and text()='${division}']`).click();

              await page.locator('#ctl00_CPH_uclMonthSelect_imgOK').click();//*[@id="ctl00_CPH_uclMonthSelect_imgOK"]
              await page.waitForTimeout(500);
              await page.locator('#changeYearMP').click({ force: true });

              const yearId = await getYearIdFromPopup(page, year);
              await page.locator(yearId).click({ force: true });
              await page.waitForTimeout(500);
              await page.getByRole('cell', { name: month, exact: true }).click();
              await page.waitForTimeout(1500);  

              // const productDropdownIcon = page.locator('#ctl00_CPH_cmbProduct_B-1Img');
              // await productDropdownIcon.waitFor({ state: 'visible', timeout: 10000 });
              // await productDropdownIcon.click({ force: true });

              // await page.waitForTimeout(1000);
              // const selectAllBtn = page.locator('xpath=//*[@id="ctl00_CPH_cmbProduct_DDD_gv_StatusBar_btnProductSelectAll_0_CD"]');
              // // await selectAllBtn.waitFor({ state: 'visible', timeout: 10000 });
              // await selectAllBtn.click({ force: true });
              // await page.waitForTimeout(1000);

              const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
              await page.getByRole('button', { name: 'Download' }).click();
              const download = await downloadPromise;

              const fileName = `MSL_Detailed_${division}_${month}-${year}.xlsx`;
              const filePath = path.join(DOWNLOADS_PATH, fileName);
              await download.saveAs(filePath);
              console.log(`✅ Downloaded and saved: ${fileName}`);

            } catch (err) {
              console.error(`❌ Error for ${month}-${year} (${division}):`, err.message);
            }
          }
        }
      } catch (err) {
        console.error(`❌ Division processing failed: ${division}`, err.message);
      } finally {
        await page.close();
      }
    }

    await uploadToAzureBlobAndTable(DOWNLOADS_PATH, endYear, months[0]);

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ All divisions processed and browser closed!');
  }
}


processDivisions();
