import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';

async function processDivisions(year,month) {
    const downloadsPath = path.join('downloads');
    await fs.mkdir(downloadsPath, { recursive: true });

    const divisions = [
        'AP ELBRIT',
        'Delhi Elbrit',
        'Elbrit',
        'ELBRIT AURA PROXIMA',
        'Elbrit CND',
        'KA Elbrit',
        'KE Aura N Proxima',
        'Kerala Elbrit',
        'VASCO'
    ];

    const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    const startYear = 2025;
    const endYear = 2025;

    const yearIdMap = {
        2025: 'y3',
    };

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ acceptDownloads: true });

    try {
        for (const division of divisions) {
            console.log(`\nProcessing division: ${division}`);
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
                        console.log(`Processing ${month}-${year} for ${division}`);

                        try {
                            // Navigate to MSL Detailed page
                            await page.goto('https://elbrit.ecubix.com/Apps/MSL/frmMSLDetail.aspx?a_id=341');
                            await page.waitForLoadState('networkidle'); // Ensure the page has fully loaded

                            // Select Division
                            await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
                            await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and contains(@class, 'dxeListBoxItem') and text()='${division}']`).click();

                            // Select Month-Year
                            await page.locator('#ctl00_CPH_uclMonthSelect_imgOK').click();
                            await page.locator('#changeYearMP').click({ force: true });
                            const yearId = yearIdMap[year];
                            await page.locator(`xpath=//*[@id="selectYearMP"]`).locator(`xpath=//*[@id='${yearId}']`).click({ force: true });
                            await page.getByRole('cell', { name: month, exact: true }).click();

                            // Download the report
                            const downloadPromise = page.waitForEvent('download', { timeout: 60000 }); // Increased timeout
                            await page.getByRole('button', { name: 'Download' }).click();
                            const download = await downloadPromise;

                            const fileName = `MSL_Detailed_${division.replace(/\s+/g, '_')}_${month}-${year}.xlsx`;
                            const filePath = path.join(downloadsPath, fileName);
                            await download.saveAs(filePath);

                            console.log(`Downloaded and saved: ${fileName}`);
                        } catch (error) {
                            console.error(`Error processing ${month}-${year} for ${division}:`, error);
                        }
                    }
                }

                console.log(`Completed processing division: ${division}`);
            } catch (error) {
                console.error(`Failed to process division ${division}:`, error);
            } finally {
                await page.close();
            }
        }
    } catch (error) {
        console.error('An unexpected error occurred:', error);
    } finally {
        await browser.close();
    }

    console.log(`\nAll divisions processed successfully!`);
}

// Run the function
processDivisions();
