import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

// === CONFIG ===
const DOWNLOADS_PATH = path.join('daily_visit_data');
const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

// ✅ Hardcoded values
const folderId = 'daily-visit-folder';          // ⬅️ Update as needed
const executionId = 'exec-visit-2025-mar';      // ⬅️ Update as needed

console.log(`📁 Using folderId: ${folderId}`);
console.log(`🧭 Using executionId: ${executionId}`);

// 🔁 Divisions
const divisions = [
  'AP ELBRIT', 'Delhi Elbrit', 'Elbrit', 'ELBRIT AURA PROXIMA',
  'KE Aura N Proxima', 'Elbrit CND', 'KA Elbrit', 'Kerala Elbrit', 'VASCO'
];

// 📅 Yesterday’s date
function getYesterdayInfo() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const day = yesterday.getDate();
  const month = yesterday.toLocaleString('default', { month: 'short' });
  const year = yesterday.getFullYear();
  const firstDayOfMonth = new Date(yesterday.getFullYear(), yesterday.getMonth(), 1);
  const firstDayWeekday = firstDayOfMonth.getDay();

  const adjustedDay = day + firstDayWeekday - 1;
  const row = Math.floor(adjustedDay / 7);
  const col = adjustedDay % 7;

  return { day, month, year, row, col };
}

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

async function process() {
  await clearOldFiles(DOWNLOADS_PATH);
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  const { day, month, year, row, col } = getYesterdayInfo();

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
        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').click();

        await page.goto('https://elbrit.ecubix.com/Apps/Report/frmDayWiseActivity.aspx?a_id=463');

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

        await page.locator('#ctl00_CPH_img1').click();
        await page.waitForTimeout(500);
        const dateCellId = `#ctl00_CPH_dtCalendarFrom_day_${row}_${col}`;
        await page.locator(dateCellId).click();

        await page.locator('#ctl00_CPH_btnExecute').click();
        await page.waitForTimeout(3000);

        await page.locator('#ctl00_CPH_gvEmployee_header0_chbAll_S_D').click();
        await page.locator('#ctl00_CPH_chkAllDrCat').click();
        await page.locator('#ctl00_CPH_chkAllSpeciality').click();

        const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
        await page.locator('#ctl00_CPH_btnDownloadxlsx').click();
        const download = await downloadPromise;

        const fileName = `Daily_Visit_${division.replace(/\s+/g, '_')}_${month}-${day}-${year}.xlsx`;
        const filePath = path.join(DOWNLOADS_PATH, fileName);
        await download.saveAs(filePath);

        console.log(`✅ Downloaded: ${fileName}`);
      } catch (error) {
        console.error(`❌ Error for ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }

    await uploadToWebhook(DOWNLOADS_PATH, folderId, executionId);
  } catch (error) {
    console.error('❌ Main error:', error.message);
  } finally {
    await browser.close();
    console.log('\n✅ All divisions processed.');
  }
}

async function uploadToWebhook(directory, folderId = '', executionId = '') {
  try {
    const files = await fs.readdir(directory);
    if (files.length === 0) {
      console.log('📭 No files to send.');
      return;
    }

    const formData = new FormData();
    const fileNames = [];

    for (const file of files) {
      const filePath = path.join(directory, file);
      const fileStream = await fs.readFile(filePath);
      formData.append('files', fileStream, file);
      fileNames.push(file);
    }

    formData.append('file_names', fileNames.join(','));

    const webhookUrl = `${WEBHOOK_URL}?folderId=${encodeURIComponent(folderId)}&executionId=${encodeURIComponent(executionId)}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });

    if (response.ok) {
      console.log('📤 Files successfully sent to n8n.');
    } else {
      console.error('❌ Failed to send files to n8n:', await response.text());
    }
  } catch (error) {
    console.error('❌ Webhook upload error:', error.message);
  }
}

process();
