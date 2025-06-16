import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { config } from 'dotenv';
import AdmZip from 'adm-zip';
import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob';
import {
  TableClient,
  AzureNamedKeyCredential
} from '@azure/data-tables';

config();

const AZURE_STORAGE_ACCOUNT = 'elbrit';
const AZURE_STORAGE_KEY = 'ZEGJoULtZM+wqYf7Ls7IIhs3axdSSIp0ceZcHaRjKJeCugfTO7rz887WWm2zuAe3RVzRJ3XiXduK+AStdVeiBA==';
const CONTAINER_NAME = 'master';
const TABLE_NAME = 'master';
const DOWNLOADS_PATH = path.join('msl_summary_data');

async function clearOldFiles(directory) {
  try {
    await fs.access(directory);
    const files = await fs.readdir(directory);
    for (const file of files) {
      await fs.unlink(path.join(directory, file));
    }
    console.log('🧹 Cleared old files in:', directory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('📁 Directory does not exist. Creating new.');
    } else {
      console.error('❌ Error clearing old files:', error.message);
    }
  }
}

async function uploadToAzureBlobAndTable(directory) {
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
    if (!file.endsWith('.xlsx')) continue;

    const safeBlobFileName = file
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_\-.]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    const blobPath = `msl_summary/${safeBlobFileName}`;

    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    const buffer = await fs.readFile(path.join(directory, file));

    try {
      await blockBlobClient.uploadData(buffer);
      console.log(`📤 Uploaded to Azure Blob: ${blobPath}`);
    } catch (err) {
      console.error(`❌ Failed upload for ${file} → ${blobPath}`);
      console.error('🔍 Azure Error Message:', err.details?.errorMessage || err.message);
      throw err;
    }

    const division = file.split('_MSL_')[0].replace(/_/g, ' '); // Extract division name before '_MSL_'

    await tableClient.upsertEntity({
      partitionKey: 'doctor',
      rowKey: division,
      fileUrl: blockBlobClient.url,
      fileName: file
    }, "Replace");

    console.log(`📝 Logged metadata for: ${division}`);
  }
}

async function process() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    const page = await context.newPage();
    await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx');
    await page.locator('#txtUserName').fill('E00134');
    await page.locator('#txtPassword').fill('Elbrit9999');
    await page.locator('#btnLogin').click();
    await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA', { timeout: 10000 }).click();

    await page.goto('https://elbrit.ecubix.com/Apps/MSL/frmMSLSummaryDetail.aspx?a_id=343');

    const divisionCheckboxIds = [
      '#ctl00_CPH_chkDivision_RB0_I_D',
      '#ctl00_CPH_chkDivision_RB1_I_D',
      '#ctl00_CPH_chkDivision_RB2_I_D',
      '#ctl00_CPH_chkDivision_RB3_I_D',
      '#ctl00_CPH_chkDivision_RB4_I_D',
      '#ctl00_CPH_chkDivision_RB5_I_D',
      '#ctl00_CPH_chkDivision_RB6_I_D',
      '#ctl00_CPH_chkDivision_RB7_I_D',
      '#ctl00_CPH_chkDivision_RB8_I_D',
      '#ctl00_CPH_chkDivision_RB9_I_D'
    ];

    for (const selector of divisionCheckboxIds) {
      await page.locator(selector).click({ force: true });
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 200000 });
    await page.locator('#ctl00_CPH_btnDownloadDivision').click({ timeout: 120000 });//*[@id="ctl00_CPH_btnDownloadDivision"]
    const download = await downloadPromise;

    const zipPath = path.join(DOWNLOADS_PATH, 'msl_summary.zip');
    await download.saveAs(zipPath);
    console.log(`✅ ZIP Downloaded: ${zipPath}`);

    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      if (entry.entryName.endsWith('.xlsx')) {
        const outputPath = path.join(DOWNLOADS_PATH, path.basename(entry.entryName));
        fs.writeFile(outputPath, entry.getData());
        console.log(`📦 Extracted: ${entry.entryName}`);
      }
    }

    await fs.unlink(zipPath);
    console.log(`✅ ZIP Extracted`);

    await uploadToAzureBlobAndTable(DOWNLOADS_PATH);
  } catch (error) {
    console.error('❌ Process failed:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ Process completed.');
  }
}

process();
