const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const FormData = require('form-data');

const WEBHOOK_URL = 'https://elbrit-dev.app.n8n.cloud/webhook/632cbe49-45bb-42e9-afeb-62a0aeb908e1';

async function sendWebhook(filePath, division, month, year) {
    if (!WEBHOOK_URL || WEBHOOK_URL === 'YOUR_WEBHOOK_URL_HERE') {
        console.warn("Webhook URL is not configured. Please update WEBHOOK_URL in utils.js");
        return false;
    }

    try {
        const fileName = path.basename(filePath);
        const fileData = await fs.readFile(filePath);

        const url = new URL(WEBHOOK_URL);
        url.searchParams.append('division', division);
        url.searchParams.append('month', month);
        url.searchParams.append('year', year);

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${fileName}"`
            },
            body: fileData
        });

        if (!response.ok) {
            console.error(`Webhook request failed with status ${response.status} for file: ${fileName}`);
            return false;
        }

        console.log(`Webhook sent successfully for file: ${fileName}`);

        // Safe deletion if file exists
        try {
            await fs.access(filePath); // Check again for existence before deletion
            await fs.unlink(filePath);
            console.log(`Deleted file: ${fileName}`);
        } catch (unlinkError) {
            console.warn(`File already deleted or inaccessible: ${fileName}`);
        }

        return true;
    } catch (error) {
        console.error('Error sending webhook or processing file:', error);
        return false;
    }
}

module.exports = { sendWebhook };
