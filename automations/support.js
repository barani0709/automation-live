import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Constants
const DOWNLOADS_PATH = path.join('downloads');
const WEBHOOK_BASE_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

// === Step 1: Accept Dynamic Inputs via INPUT_JSON ===
let input = {
    months: ['Jan'],
    startYear: 2025,
    endYear: 2025,
    yearIdMap: { 2025: 'y3' },
    folderId: '',
    executionId: '' // ✅ new input
};

try {
    if (process.env.INPUT_JSON) {
        const parsed = JSON.parse(process.env.INPUT_JSON);
        input = {
            months: parsed.months || input.months,
            startYear: parsed.startYear || input.startYear,
            endYear: parsed.endYear || input.endYear,
            yearIdMap: parsed.yearIdMap || input.yearIdMap,
            folderId: parsed.folderId || input.folderId,
            executionId: parsed.executionId || input.executionId
        };
        console.log('✅ Dynamic input loaded:', input);
    } else {
        console.log('⚠️ No INPUT_JSON found. Using default values.');
    }
} catch (error) {
    console.error('❌ Failed to parse INPUT_JSON. Using defaults. Error:', error);
}

// Apply input values
const { months, startYear, endYear, yearIdMap, folderId, executionId } = input;

// === Main Automation ===
async function processDivisions() {
    await clearOldFiles(DOWNLOADS_PATH);
    await fs.mkdir(DOWNLOADS_PATH, { recursive: true });

    const divisions = [
        'AP ELBRIT',
        'Delhi Elbrit',
        'Elbrit',
        'ELBRIT AURA PROXIMA',
        'KE Aura N Proxima',
        'Elbrit CND',
        'KA Elbrit',
        'Kerala Elbrit',
        'VASCO'
    ];

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

                for (let year = startYear; year <= endYear; year++) {
                    for (const month of months) {
                        console.log(`🗓️  Processing ${month}-${year} for ${division}`);
                        try {
                            await page.goto('https://elbrit.ecubix.com/Apps/MSL/frmMSLDetail.aspx?a_id=341');
                            await page.waitForLoadState('networkidle');

                            // Select Division
                            await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
                            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and contains(@class, 'dxeListBoxItem') and text()='${division}']`).click();

                            // Select Month-Year
                            await page.locator('#ctl00_CPH_uclMonthSelect_imgOK').click();
                            await page.locator('#changeYearMP').click({ force: true });

                            const yearId = yearIdMap[year];
                            if (!yearId) throw new Error(`No yearId mapping found for year ${year}`);

                            await page.locator(`xpath=//*[@id='${yearId}']`).click({ force: true });
                            await page.getByRole('cell', { name: month, exact: true }).click();

                            // Download the report
                            const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
                            await page.getByRole('button', { name: 'Download' }).click();
                            const download = await downloadPromise;

                            const fileName = `MSL_Detailed_${division.replace(/\s+/g, '_')}_${month}-${year}.xlsx`;
                            const filePath = path.join(DOWNLOADS_PATH, fileName);
                            await download.saveAs(filePath);

                            console.log(`✅ Downloaded and saved: ${fileName}`);
                        } catch (error) {
                            console.error(`❌ Error processing ${month}-${year} for ${division}:`, error.message);
                        }
                    }
                }

                console.log(`✅ Completed processing division: ${division}`);
            } catch (error) {
                console.error(`❌ Failed to process division ${division}:`, error.message);
            } finally {
                await page.close();
            }
        }

        await sendFilesToN8N(DOWNLOADS_PATH, folderId, executionId);
    } catch (error) {
        console.error('❌ Unexpected error during processing:', error.message);
    } finally {
        await browser.close();
        console.log('\n✅ All divisions processed and browser closed!');
    }
}

// === Clean up old files ===
async function clearOldFiles(directory) {
    try {
        await fs.access(directory);
        const files = await fs.readdir(directory);
        for (const file of files) {
            await fs.unlink(path.join(directory, file));
        }
        console.log('🧹 Old files deleted.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('📁 No old files found to delete.');
        } else {
            console.error('❌ Error clearing old files:', error.message);
        }
    }
}

// === Upload to webhook ===
async function sendFilesToN8N(directory, folderId = '', executionId = '') {
    try {
        const files = await fs.readdir(directory);
        if (files.length === 0) {
            console.log('📭 No files to send.');
            return;
        }

        const formData = new FormData();

        for (const file of files) {
            const filePath = path.join(directory, file);
            const stats = await fs.stat(filePath);

            if (stats.isFile()) {
                const fileStream = await fs.readFile(filePath);
                formData.append('files', fileStream, file);
                formData.append('file_names', file);
            }
        }

        const queryParams = new URLSearchParams({ folderId, executionId }).toString();
        const webhookUrl = `${WEBHOOK_BASE_URL}?${queryParams}`;

        console.log(`📡 Sending files to webhook with folderId="${folderId}" & executionId="${executionId}"`);

        const response = await fetch(webhookUrl, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });

        if (response.ok) {
            console.log('📤 Files successfully sent to n8n.');
        } else {
            console.error('❌ Failed to send files to n8n:', await response.text());
        }
    } catch (error) {
        console.error('❌ Error sending files to n8n:', error.message);
    }
}


// Start
processDivisions();
