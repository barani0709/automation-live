import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import unzipper from 'unzipper';

const DOWNLOADS_PATH = path.join('Hierarchy');
const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';
const folderId = '01VW6POPLIMAEM5RYBFRBKJP2SJWDR2SVJ';
const executionId = '7hnyGDGL6VuTXYMr';

async function runMSLSummaryAutomation() {
  // === Step 0: Clean the folder before starting ===
  await cleanDirectory(DOWNLOADS_PATH);

  // Create folder if not exists
  await fsPromises.mkdir(DOWNLOADS_PATH, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });

  let zipPath = '';

  try {
    const page = await context.newPage();

    // === Step 1: Login ===
    await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx', {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    await page.locator('#txtUserName').fill('E00134');
    await page.locator('#txtPassword').fill('Elbrit9999');
    await page.locator('#btnLogin').click();

    await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA').click();

    // === Step 2: Navigate to MSL Summary Detail page ===
    await page.goto('https://elbrit.ecubix.com/Apps/Report/frmEMPHierarcy.aspx?a_id=350', {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    // === Step 4: Download ZIP ===
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#ctl00_CPH_btnDownload').click();
    const download = await downloadPromise;

    zipPath = path.join(DOWNLOADS_PATH, 'Hierarchy.zip');
    await download.saveAs(zipPath);
    console.log(`✅ ZIP Downloaded: ${zipPath}`);

  } catch (error) {
    console.error('❌ Automation failed before extraction:', error.message);
  } finally {
    await browser.close();
    console.log('✅ Browser closed before extraction');
  }

  try {
    // === Step 5: Extract ZIP to flat folder ===
    await extractZipToFlat(zipPath, DOWNLOADS_PATH);
    console.log('✅ ZIP Extracted');

    // === Step 6: Delete ZIP ===
    await fsPromises.unlink(zipPath);
    console.log(`🗑️ Deleted ZIP file: ${zipPath}`);

    // === Step 7: Upload extracted files to n8n ===
    await sendFilesToN8N(DOWNLOADS_PATH, folderId, executionId);
  } catch (error) {
    console.error('❌ Extraction or upload failed:', error.message);
  }

  console.log('\n✅ Full process completed.');
}

async function cleanDirectory(dirPath) {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
    const files = await fsPromises.readdir(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      await fsPromises.unlink(fullPath);
    }
    console.log('🧹 Cleaned directory:', dirPath);
  } catch (err) {
    console.error('❌ Failed to clean directory:', err.message);
  }
}

async function extractZipToFlat(zipPath, outputDir) {
  const zipStream = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of zipStream) {
    if (entry.type === 'File') {
      const fileName = path.basename(entry.path);
      const outputPath = path.join(outputDir, fileName);
      await fsPromises.writeFile(outputPath, await entry.buffer());
      console.log(`📦 Extracted: ${fileName}`);
    } else {
      entry.autodrain();
    }
  }
}

async function sendFilesToN8N(directory, folderId, executionId) {
  try {
    const files = await fsPromises.readdir(directory);
    const formData = new FormData();
    const fileNames = [];

    for (const file of files) {
      if (file.endsWith('.zip')) continue;
      const filePath = path.join(directory, file);
      const buffer = await fsPromises.readFile(filePath);
      formData.append('files', buffer, file);
      fileNames.push(file);
    }

    for (const name of fileNames) {
      formData.append('file_names', name);
    }

    const webhookUrl = `${WEBHOOK_URL}?folderId=${encodeURIComponent(folderId)}&executionId=${encodeURIComponent(executionId)}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (response.ok) {
      console.log('📤 Files sent to webhook successfully.');
    } else {
      console.error('❌ Webhook failed:', await response.text());
    }
  } catch (error) {
    console.error('❌ Error sending files to n8n:', error.message);
  }
}

runMSLSummaryAutomation();
