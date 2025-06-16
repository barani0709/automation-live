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
const CONTAINER_NAME = 'worksummary';
const TABLE_NAME = 'worksummary';
const DOWNLOADS_PATH = path.join('daily_visit_data');

const divisions = ['All'];
const inputDate = new Date('2025-05-26');

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
    const match = file.match(/^work_summary_(.+?)_(\d{2})-(.+)-(\d{4})\.xlsx$/);
    if (!match) {
      console.warn(`⚠️ Skipping invalid file: ${file}`);
      continue;
    }
    

    const [, divisionRaw, dayRaw, monthRaw, yearRaw] = match;
    const division = divisionRaw.trim();
    const monthLower = monthRaw.toLowerCase();

    // ✅ Bulletproof sanitization for blob filename
    const safeBlobFileName = file
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_\-.]/g, '_') // only safe characters
    .replace(/_+/g, '_')               // compress multiple underscores
    .replace(/^_+|_+$/g, '');          // trim leading/trailing underscores

    const safeYear = String(yearRaw).replace(/[^a-zA-Z0-9_-]/g, '');
    const safeMonth = monthLower.replace(/[^a-zA-Z0-9_-]/g, '');
    const blobPath = `${safeYear}/${safeMonth}/${safeBlobFileName}`;


    console.log(`🔎 Final Blob Path: "${blobPath}"`);

    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    const buffer = await fs.readFile(path.join(directory, file));

    try {
    await blockBlobClient.uploadData(buffer, {
        tags: { division, month: monthLower, year: yearRaw }
    });
    console.log(`📤 Uploaded to Azure Blob: ${blobPath}`);
    } catch (err) {
    console.error(`❌ Failed upload for ${file} → ${blobPath}`);
    console.error('🔍 Azure Error Message:', err.details?.errorMessage || err.message);
    throw err; // rethrow after logging
    }


    console.log(`📤 Uploaded to Azure Blob: ${blobPath}`);

    await tableClient.upsertEntity({
      partitionKey: `${yearRaw}-${monthLower}-${dayRaw}`,
      rowKey: division,
      fileUrl: blockBlobClient.url,
      division,
      month: monthLower,
      year: yearRaw
    }, "Replace");

    console.log(`📝 Logged metadata for: ${division}`);
  }
}


async function selectDateFromPicker(page, date) {
  await page.locator('#ctl00_CPH_Image1').click();

  const targetMonth = date.toLocaleString('default', { month: 'long' });
  const targetYear = date.getFullYear();
  const targetDay = String(date.getDate()).padStart(2, '0');

  while (true) {
    const header = await page.locator('//*[@id="ctl00_CPH_Date_title"]').innerText();
    const [displayedMonth, displayedYear] = header.split(',').map(s => s.trim());

    if (displayedMonth === targetMonth && parseInt(displayedYear) === targetYear) break;

    const currentDate = new Date(`${displayedMonth} 1, ${displayedYear}`);
    const targetDate = new Date(targetYear, date.getMonth());

    if (targetDate > currentDate) {
      await page.locator('//*[@id="ctl00_CPH_Date_nextArrow"]').click();
    } else {
      await page.locator('//*[@id="ctl00_CPH_Date_prevArrow"]').click();
    }

    await page.waitForTimeout(300);
  }

  const fullDateTitle = `${targetMonth} ${targetDay}, ${targetYear}`;
  const daySelector = `xpath=//*[contains(@title,"${fullDateTitle}")]`;

  const dayCell = page.locator(daySelector);
  if (await dayCell.count() === 0) {
    throw new Error(`❌ Could not find date cell with title: ${fullDateTitle}`);
  }

  await dayCell.first().click();
}

async function process() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const month = inputDate.toLocaleString('default', { month: 'short' });
  const year = inputDate.getFullYear();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing: ${division}`);
      const page = await context.newPage();

      try {
        await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx');
        await page.locator('#txtUserName').fill('E00134');
        await page.locator('#txtPassword').fill('Elbrit9999');
        await page.locator('#btnLogin').click();
        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA', { timeout: 10000 }).click();

        await page.goto('https://elbrit.ecubix.com/Apps/Report/MIS/frmfollowupReport.aspx?a_id=423');
        await selectDateFromPicker(page, inputDate);

        await page.locator('#ctl00_CPH_chkDailyActivity').click();

        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('#ctl00_CPH_btnDownload').click();
        const download = await downloadPromise;

        const day = String(inputDate.getDate()).padStart(2, '0');
        const zipFileName = `work_summary_${division}_${day}-${month}-${year}.zip`;
        const zipFilePath = path.join(DOWNLOADS_PATH, zipFileName);
        await download.saveAs(zipFilePath);
        console.log(`✅ ZIP Downloaded: ${zipFileName}`);

        const zip = new AdmZip(zipFilePath);
        const zipEntries = zip.getEntries();

        let extractedFiles = 0;
        for (const entry of zipEntries) {
          if (entry.entryName.endsWith('.xlsx')) {
            const originalName = path.parse(entry.entryName).name;
            const divisionFromFile = originalName.split('_')[0]; // e.g., "AP Elbrit"
            const newFileName = `work_summary_${divisionFromFile}_${day}-${month}-${year}.xlsx`;
            const newFilePath = path.join(DOWNLOADS_PATH, newFileName);

            fs.writeFile(newFilePath, entry.getData());
            console.log(`📄 Extracted & Renamed: ${newFileName}`);
            extractedFiles++;
          }
        }

        if (extractedFiles === 0) {
          throw new Error(`❌ No .xlsx files found in ZIP for ${division}`);
        }

        await fs.unlink(zipFilePath);
        console.log(`🧹 Deleted ZIP: ${zipFileName}`);

      } catch (error) {
        console.error(`❌ Error for ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }

    await uploadToAzureBlobAndTable(DOWNLOADS_PATH, year, month);
  } catch (error) {
    console.error('❌ Main error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ All divisions processed.');
  }
}

process();
