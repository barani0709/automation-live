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

config();

const AZURE_STORAGE_ACCOUNT = 'elbrit';
const AZURE_STORAGE_KEY = 'ZEGJoULtZM+wqYf7Ls7IIhs3axdSSIp0ceZcHaRjKJeCugfTO7rz887WWm2zuAe3RVzRJ3XiXduK+AStdVeiBA==';
const CONTAINER_NAME = 'employeevisit';
const TABLE_NAME = 'employeevisit';
const DOWNLOADS_PATH = path.join('daily_visit_data');

const divisions = [
  'AP ELBRIT', 'Delhi Elbrit', 'Elbrit', 'ELBRIT AURA PROXIMA',
  'KE Aura N Proxima', 'Elbrit CND', 'Elbrit Bangalore', 'Elbrit Mysore',
  'Kerala Elbrit', 'VASCO'
];

let input = {
  fromDate: '2025-06-01',
  toDate: '2025-06-25'
};

const rawInput = process.env.INPUT_JSON;

console.log("🔍 Received INPUT_JSON:", rawInput);

if (rawInput) {
  try {
    const parsed = JSON.parse(rawInput);
    if (parsed.fromDate && parsed.toDate) {
      input = { ...input, ...parsed };
      console.log('✅ Dynamic input loaded:', input);
    } else {
      throw new Error("Missing 'fromDate' or 'toDate' in parsed INPUT_JSON.");
    }
  } catch (error) {
    console.error('❌ Failed to parse INPUT_JSON:', error.message);
    console.warn('⚠️ Reverting to default input:', input);
  }
} else {
  console.warn('⚠️ No INPUT_JSON found. Using default values:', input);
}



function parseDate(dateStr, label) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${dateStr}`);
  return date;
}

const fromDate = parseDate(input.fromDate, 'fromDate');
const toDate = parseDate(input.toDate, 'toDate');

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
    const match = file.match(/^Daily_Visit_(.+?)_(\w+)-(\d{4})\.xlsx$/);
    if (!match) {
      console.warn(`⚠️ Skipping invalid file: ${file}`);
      continue;
    }

    const [, divisionRaw] = match;
    const yearRaw = year.toString();
    const monthRaw = month.toLowerCase();
    const division = divisionRaw;
    const blobPath = `${yearRaw}/${monthRaw}/${file}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    const buffer = await fs.readFile(path.join(directory, file));

    await blockBlobClient.uploadData(buffer, {
      tags: { division, month: monthRaw, year: yearRaw }
    });
    console.log(`📤 Uploaded to Azure Blob: ${blobPath}`);

    await tableClient.upsertEntity({
      partitionKey: `${yearRaw}-${monthRaw}`,
      rowKey: `${division}`,
      fileUrl: blockBlobClient.url,
      division,
      month: monthRaw,
      year: yearRaw
    }, "Replace");

    console.log(`📝 Logged metadata for: ${division}`);
  }
}

async function selectFromDate(page, fromDate) {
  await page.locator('#ctl00_CPH_img1').click();
  const targetMonth = fromDate.toLocaleString('default', { month: 'long' });
  const targetYear = fromDate.getFullYear();
  const targetDay = String(fromDate.getDate()).padStart(2, '0');

  while (true) {
    const header = await page.locator('//*[@id="ctl00_CPH_dtCalendarFrom_title"]').innerText();
    const [displayedMonth, displayedYear] = header.split(',').map(s => s.trim());

    if (displayedMonth === targetMonth && parseInt(displayedYear) === targetYear) break;

    const currentDate = new Date(`${displayedMonth} 1, ${displayedYear}`);
    const targetDate = new Date(targetYear, fromDate.getMonth());

    if (targetDate > currentDate) {
      await page.locator('//*[@id="ctl00_CPH_dtCalendarFrom_nextArrow"]').click();
    } else {
      await page.locator('//*[@id="ctl00_CPH_dtCalendarFrom_prevArrow"]').click();
    }
    await page.waitForTimeout(300);
  }

  const fullDateTitle = `${targetMonth} ${targetDay}, ${targetYear}`;
  const daySelector = `xpath=//*[contains(@title,"${fullDateTitle}")]`;
  const dayCell = page.locator(daySelector);
  if (await dayCell.count() === 0) {
    throw new Error(`❌ Could not find From Date cell: ${fullDateTitle}`);
  }

  await dayCell.first().click();
}

async function selectToDate(page, toDate) {
  await page.locator('#ctl00_CPH_img2').click();
  await page.waitForSelector('//*[@id="ctl00_CPH_dtCalendarTo_title"]', { timeout: 3000 });

  const targetMonth = toDate.toLocaleString('default', { month: 'long' });
  const targetYear = toDate.getFullYear();
  const targetDay = String(toDate.getDate()).padStart(2, '0');

  while (true) {
    const header = await page.locator('//*[@id="ctl00_CPH_dtCalendarTo_title"]').innerText();
    const [displayedMonth, displayedYear] = header.split(',').map(s => s.trim());

    if (displayedMonth === targetMonth && parseInt(displayedYear) === targetYear) break;

    const currentDate = new Date(`${displayedMonth} 1, ${displayedYear}`);
    const targetDate = new Date(targetYear, toDate.getMonth());

    if (targetDate > currentDate) {
      await page.locator('//*[@id="ctl00_CPH_dtCalendarTo_nextArrow"]').click();
    } else {
      await page.locator('//*[@id="ctl00_CPH_dtCalendarTo_prevArrow"]').click();
    }
    await page.waitForTimeout(300);
  }

  const fullDateTitle = `${targetMonth} ${targetDay}, ${targetYear}`;
  const dayLocator = page.locator(`xpath=//*[@id="ctl00_CPH_dtCalendarTo_days"]//*[contains(@title,"${fullDateTitle}")]`);

  try {
    await dayLocator.waitFor({ timeout: 500 });
  } catch {
    throw new Error(`❌ Could not find To Date cell with title: ${fullDateTitle}`);
  }

  await dayLocator.first().click();
}

async function process() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const month = fromDate.toLocaleString('default', { month: 'short' });
  const year = fromDate.getFullYear();

  const browser = await chromium.launch({ headless: true });
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

        await page.goto('https://elbrit.ecubix.com/Apps/Report/frmDayWiseActivity.aspx?a_id=463');
        await selectFromDate(page, fromDate);
        await selectToDate(page, toDate);

        await page.locator('#ctl00_CPH_ddlDivision_B-1').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

        await page.locator('#ctl00_CPH_ddlDesignation_I').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDesignation_DDD_L_LBI') and text()='SM']`).click();

        await page.locator('#ctl00_CPH_ddlEmployee_I').click();
        const employeeOptions = await page.locator("xpath=//td[contains(@id, 'ctl00_CPH_ddlEmployee_DDD_L_LBI')]").all();
        if (employeeOptions.length >= 2) {
          await employeeOptions[1].click();
        } else {
          console.warn(`⚠️ Only 1 employee found for ${division}. Skipping.`);
          continue;
        }

        await page.locator('#ctl00_CPH_btnExecute').click();
        await page.waitForTimeout(3000);

        await page.locator('#ctl00_CPH_gvEmployee_header0_chbAll_S_D').click();
        await page.locator('#ctl00_CPH_chkAllDrCat').click();
        await page.locator('#ctl00_CPH_chkAllSpeciality').click();

        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('#ctl00_CPH_btnDownloadxlsx').click();
        const download = await downloadPromise;

        const fileName = `Daily_Visit_${division}_${month}-${year}.xlsx`;
        const filePath = path.join(DOWNLOADS_PATH, fileName);
        await download.saveAs(filePath);

        console.log(`✅ Downloaded: ${fileName}`);
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
