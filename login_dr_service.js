import { chromium } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';

async function processDivisions() {
    // Create a new folder named DRSERVICE_2023
    const downloadsPath = path.join('DRSERVICE_2023');
    await fs.mkdir(downloadsPath, { recursive: true });

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

    const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

    // --- CONFIGURATION: SET THE TARGET YEAR HERE ---
    const targetYear = 2025;
    // -----------------------------------------------

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

                for (const month of months) {
                    // if (division === 'VASCO' && ['Jan', 'Feb', 'Mar'].includes(month)) {
                    //     console.log(`Skipping ${month}-${targetYear} for ${division} due to no data.`);
                    //     continue;
                    // }

                    console.log(`Processing ${month}-${targetYear} for ${division}`);

                    try {
                        // Navigate to All Dr Service page
                        await page.goto('https://elbrit.ecubix.com/Apps/Report/rptTillDateServiceDownload.aspx?a_id=375');

                        // Select From Month-Year
                        await page.locator('#ctl00_CPH_uclFromMonth_imgOK').click();
                        await page.locator('#changeYearMP').click({ force: true });
                        await page.locator('//*[@id="y3"]').click({ force: true });
                        await page.getByText(month, { exact: true }).click();

                        // Select To Month-Year
                        await page.locator('#ctl00_CPH_uclToMonth_imgOK').click();
                        await page.locator('#changeYearMP').click({ force: true });
                        await page.locator('//*[@id="y3"]').click({ force: true });
                        await page.getByText(month, { exact: true }).click();

                        // Select Division
                        await page.locator('#ctl00_CPH_ddlDivision_B-1Img').click();
                        await page.locator(`xpath=//td[contains(@id, 'ctl00_CPH_ddlDivision_DDD_L_LBI') and contains(@class, 'dxeListBoxItem') and text()='${division}']`).click();

                        // Download the report
                        const downloadPromise = page.waitForEvent('download');
                        await page.getByRole('button', { name: 'Download' }).click();
                        const download = await downloadPromise;

                        const fileName = `All_Dr_Service_${division.replace(/\s+/g, '_')}_${month}-${targetYear}.xlsx`;
                        const filePath = path.join(downloadsPath, fileName);
                        await download.saveAs(filePath);

                        console.log(`Downloaded and saved in DRSERVICE_2023: ${fileName}`);
                    } catch (error) {
                        console.error(`Error processing ${month}-${targetYear} for ${division}:`, error);
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

    console.log(`\nAll divisions processed successfully for year ${targetYear}!`);
}

// Run the function
processDivisions();
