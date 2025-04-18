import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';
const DOWNLOADS_PATH = path.join('stockist_wise_sales_data');

let input = {
  fromMonth: 'Jan',
  toMonth: 'Feb',
  year: 2025,
  folderId: '01VW6POPKOZ4GMMSVER5HIQ3DDCWMZDDTC',
  executionId: 'manual-run-001'
};

try {
  if (process.env.INPUT_JSON) {
    const parsed = JSON.parse(process.env.INPUT_JSON);
    input = { ...input, ...parsed };
    console.log('✅ Loaded dynamic input:\n', JSON.stringify(input, null, 2));
  } else {
    console.log('⚠️ No INPUT_JSON found. Using default values.');
  }
} catch (error) {
  console.error('❌ Failed to parse INPUT_JSON. Using defaults. Error:', error);
}

const { fromMonth, toMonth, year, folderId, executionId } = input;

async function processAllDivisions() {
  await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

  // ✅ Hardcoded division → state mapping
  const divisionStateMap = {
    'AP ELBRIT': ['Andhra Pradesh', 'Telangana'],
    'Delhi Elbrit': ['Delhi', 'Punjab', 'Rajasthan', 'uttar pradesh'],
    'Elbrit': ['Tn-Chennai', 'Tn-Coimbatore', 'Tn-Trichy'],
    'ELBRIT AURA PROXIMA': ['Karnataka', 'Tn-Chennai', 'Tn-Coimbatore', 'Tn-Madurai'],
    'Elbrit Bangalore': ['Karnataka'],
    'Elbrit CND': ['Tn-Chennai', 'Tn-Coimbatore', 'Tn-Trichy'],
    'Elbrit Mysore':['Karnataka'],
    'KE Aura N Proxima': ['Kerala'],
    'Kerala Elbrit': ['Kerala'],
    'VASCO': ['Tn-Chennai', 'Tn-Coimbatore']
  };
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // Step 1: Login
    await page.goto('https://elbrit.ecubix.com/Apps/AccessRights/frmLogin.aspx', {
      waitUntil: 'domcontentloaded'
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

    await page.waitForSelector('text=Master', { timeout: 100000 });
    console.log('✅ Login successful. Starting download automation...');

    // Step 2: Loop through hardcoded divisions and states
    for (const [division, states] of Object.entries(divisionStateMap)) {
      console.log(`\n🚀 Division: ${division}`);

      await page.goto('https://elbrit.ecubix.com/Apps/Report/rptPriSecStockist.aspx?a_id=379', {
        waitUntil: 'domcontentloaded'
      });

      // Select Division
      await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
      await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and text()='${division}']`).click();

      for (const state of states) {
        console.log(`🌐 State: ${state}`);

        // Select State
        await page.locator('#ctl00_CPH_ddlRegion_B-1Img').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlRegion_DDD_L_LBI') and text()='${state}']`).click();

        // From Month
        await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
        await page.locator('#changeYearMP').click();
        await page.locator('#y3').click(); // 'y3' assumed for 2025
        await page.getByText(fromMonth, { exact: true }).click();

        // To Month
        await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
        await page.locator('#changeYearMP').click();
        await page.locator('#y3').click();
        await page.getByText(toMonth, { exact: true }).click();

        // Select Layout → "Automation"
        await page.locator('#ctl00_CPH_rptLayout_ddlLayout_B-1Img').click();
        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_rptLayout_ddlLayout_DDD_L_LBI') and text()='Automation']`).click();

        // Download report
        let download;
        try {
          const downloadPromise = page.waitForEvent('download', { timeout: 50000 });
          await page.locator('//*[@id="ctl00_CPH_btnExport"]/img').click();
          download = await downloadPromise;
        } catch (err) {
          console.warn(`⚠️ Download failed or not triggered for ${division} → ${state}.`);
        
          try {
            const alertMessage = await page.evaluate(() => {
              return (
                document.querySelector('.dxeErrorCellSys')?.innerText ||
                document.querySelector('.dxpc-content')?.innerText ||
                null
              );
            });
            if (alertMessage) {
              console.warn(`📢 Page Message: ${alertMessage}`);
            }
          } catch (evalErr) {
            console.warn('⚠️ Could not retrieve alert message from page.');
          }
        
          continue; // 🟢 Ensure it always skips to next state on failure
        }
        
        const safeDivision = division.replace(/\s+/g, '_');
        const safeState = state.replace(/\s+/g, '_');
        const fileName = `StockistWise_${safeDivision}_${safeState}_${fromMonth}-${toMonth}-${year}.xlsx`;
        const filePath = path.join(DOWNLOADS_PATH, fileName);

        await download.saveAs(filePath);
        console.log(`📥 Downloaded: ${fileName}`);
      }
    }

    await uploadToWebhook(DOWNLOADS_PATH, folderId, executionId);

  } catch (error) {
    console.error('❌ Unexpected automation error:', error.message);
  } finally {
    await context.close();
    await browser.close();
    console.log('✅ All divisions processed. Browser closed.');
  }
}

async function uploadToWebhook(directory, folderId, executionId) {
  try {
    const files = await fs.readdir(directory);
    if (!files.length) return console.log('📭 No files to upload.');

    const formData = new FormData();
    for (const file of files) {
      const stream = await fs.readFile(path.join(directory, file));
      formData.append('files', stream, file);
      formData.append('file_names', file);
    }

    const webhookUrl = `${WEBHOOK_URL}?folderId=${encodeURIComponent(folderId)}&executionId=${encodeURIComponent(executionId)}`;
    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (response.ok) console.log('📤 Files uploaded to webhook successfully.');
    else console.error('❌ Webhook upload failed:', await response.text());

  } catch (err) {
    console.error('❌ Upload error:', err.message);
  }
}

processAllDivisions();
