import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

// === HARDCODED CONFIG ===
const downloadsPath = path.join('pob_daily_data');
const folderId = '016ZV3NKNDKJPQND4AHVEKVN5OI4IBJIXP';
const executionId = 'IFFcwOf4T1miptbI';
const WEBHOOK_URL = 'https://elbrit-prod.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

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

// === Date Picker Helper ===
function getDatePickerPosition() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const day = yesterday.getDate();
  const month = yesterday.toLocaleString('default', { month: 'short' });
  const year = yesterday.getFullYear();
  const formatted = yesterday.toLocaleDateString('en-GB');

  const firstDay = new Date(year, yesterday.getMonth(), 1);
  const firstDayWeekday = firstDay.getDay();
  const offset = day + firstDayWeekday - 1;
  const row = Math.floor(offset / 7);
  const col = offset % 7;

  return { row, col, day, month, year, formatted };
}

// === Main Automation ===
async function processDivisions() {
  await fs.mkdir(downloadsPath, { recursive: true });

  const { row, col, day, month, year } = getDatePickerPosition();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  try {
    for (const division of divisions) {
      console.log(`\n🚀 Processing division: ${division}`);
      const page = await context.newPage();

      try {
        // Login
        await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx');
        await page.locator('#txtUserName').fill('E00134');
        await page.locator('#txtPassword').fill('Elbrit9999');
        await page.locator('#btnLogin').click();
        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').click();

        await page.goto('https://elbrit.ecubix.com/Apps/Report/Sales/frmCustomerPOBAnalysis.aspx?a_id=802');
        await page.waitForLoadState('networkidle');

        // Select Doctor & Date Wise
        await page.locator('#ctl00_CPH_chkCustomerType_0').check();
        await page.locator('#ctl00_CPH_rbldatemonth_1').click();

        // Select From Date
        await page.locator('#ctl00_CPH_Image2').click();
        await page.locator(`#ctl00_CPH_DateFromDate_day_${row}_${col}`).click();

        // Select Division
        // ✅ Division Dropdown Handling (Fix for freezing)
        await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
        await page.locator('#ctl00_CPH_ddlDivision_DDD_L_LBT').waitFor({ timeout: 10000 }); // dropdown table

        const divisionOption = page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and normalize-space(text())='${division}']`);
        await divisionOption.waitFor({ timeout: 10000 });
        await divisionOption.click();//*[@id="ctl00_CPH_ddlDivision_B-1Img"]

        // Download Report
        const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
        await page.locator('#ctl00_CPH_btnDownload').click();

        const download = await downloadPromise.catch(() => null);
        if (!download) {
          console.warn(`⚠️ No file downloaded for ${division}. Skipping.`);
          continue;
        }

        const fileName = `POB_Daily_${division.replace(/\s+/g, '_')}_${month}-${day}-${year}.xlsx`;
        const filePath = path.join(downloadsPath, fileName);
        await download.saveAs(filePath);
        console.log(`✅ Downloaded: ${fileName}`);

      } catch (error) {
        console.error(`❌ Error for ${division}:`, error.message);
      } finally {
        await page.close();
      }
    }

    await sendFilesToN8N(downloadsPath, folderId, executionId);

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await browser.close();
    console.log(`\n✅ All divisions processed for POB Date Wise.`);
  }
}

// === Upload to Webhook ===
async function sendFilesToN8N(directory, folderId, executionId) {
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

    for (const name of fileNames) {
      formData.append('file_names', name);
    }

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
    console.error('❌ Upload error:', error.message);
  }
}

processDivisions();
