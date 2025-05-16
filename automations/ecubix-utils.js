// ecubix-utils.js
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

export async function getYearIdFromPopup(page, desiredYear) {
  const y0Text = await page.locator('#y0').textContent();
  const baseYear = parseInt(y0Text?.trim());
  const offset = desiredYear - baseYear;
  return `#y${offset}`;
}

export async function loginToEcubix(page) {
  await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page.fill('#txtUserName', 'E00134');
  await page.fill('#txtPassword', 'Elbrit9999');
  await page.click('#btnLogin');

  try {
    const reminder = page.locator('#pcSubscriptionAlert_btnRemindMeLaterSA');
    await reminder.waitFor({ timeout: 10000 });
    await reminder.click();
    console.log('ℹ️ Clicked "Remind Me Later" on subscription alert.');
  } catch {
    console.log('ℹ️ No subscription alert appeared.');
  }

  console.log('✅ Logged in to Ecubix');
}

export async function clearOldFiles(directory) {
  try {
    await fs.access(directory);
    const files = await fs.readdir(directory);
    for (const file of files) {
      await fs.unlink(path.join(directory, file));
    }
    console.log(`🧹 Cleared old files in ${directory}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('📁 Directory does not exist. Will be created.');
    } else {
      console.error('❌ Error clearing files:', err.message);
    }
  }
}

export async function sendFilesToN8N(directory, webhookUrl, folderId = '', executionId = '') {
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

    const url = `${webhookUrl}?folderId=${encodeURIComponent(folderId)}&executionId=${encodeURIComponent(executionId)}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (response.ok) {
      console.log('📤 Files successfully sent to webhook.');
    } else {
      console.error('❌ Failed to send files:', await response.text());
    }
  } catch (error) {
    console.error('❌ Error sending files:', error.message);
  }
}
