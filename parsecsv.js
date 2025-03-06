const { google } = require("googleapis");
const credentials = require("./credentials.json"); // You'll need to create this from Google Cloud Console

// Define the fixed columns
const COLUMNS = [
    'S.No',
    'Unique ID',
    'Pipeline',
    'Entity',
    'Date of Authorisation',
    'Authorised Length (km)',
    'Authorised Capacity (MMTPA)',
    'Operating length (km)',
    'Passing through states'
];

function cleanRawData(rawData) {
    // Remove extra newlines and normalize spaces
    return rawData
        .replace(/\n/g, ' ')  // Replace newlines with spaces
        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
        .trim();  // Remove leading/trailing spaces
}

function parseRow(rawData) {
    // Clean the raw data first
    const cleanData = cleanRawData(rawData);
    const parts = cleanData.split(' ');
    
    // Initialize result object
    const result = {};
    
    // Extract values based on known positions
    result[COLUMNS[0]] = parts[0];  // S.No
    result[COLUMNS[1]] = parts[1];  // Unique ID
    
    // Find the entity position (looking for IOCL, HPCL, BPCL, GAIL, Oil India Ltd., APSEZ, etc.)
    const entityIndex = parts.findIndex((part, index) => {
        return /^(IOCL|HPCL|BPCL|GAIL|Oil|APSEZ|Petronet)/.test(part);
    });
    
    // Join all parts between Unique ID and Entity for Pipeline name
    result[COLUMNS[2]] = parts.slice(2, entityIndex).join(' ');  // Pipeline
    
    // Handle special cases for different entity names
    let nextIndex;
    if (parts[entityIndex] === 'Oil') {
        result[COLUMNS[3]] = parts.slice(entityIndex, entityIndex + 3).join(' ');  // Entity (Oil India Ltd.)
        nextIndex = entityIndex + 3;
    } else if (parts[entityIndex] === 'Petronet') {
        result[COLUMNS[3]] = parts.slice(entityIndex, entityIndex + 3).join(' ');  // Entity (Petronet MHB Ltd.)
        nextIndex = entityIndex + 3;
    } else {
        result[COLUMNS[3]] = parts[entityIndex];  // Entity (HPCL, BPCL, etc.)
        nextIndex = entityIndex + 1;
    }
    
    // Get remaining values
    result[COLUMNS[4]] = parts[nextIndex];  // Date of Authorisation
    result[COLUMNS[5]] = parts[nextIndex + 1];  // Authorised Length
    result[COLUMNS[6]] = parts[nextIndex + 2];  // Authorised Capacity
    result[COLUMNS[7]] = parts[nextIndex + 3];  // Operating length
    result[COLUMNS[8]] = parts.slice(nextIndex + 4).join(' ');  // Passing through states
    
    return result;
}

async function writeToGoogleSheets() {
    try {
        // Configure auth client
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        const client = await auth.getClient();
        const sheets = google.sheets({ version: "v4", auth: client });

        // Multiple rows of data
        const rawDataRows = [
            `10 17.06 Mundra – Delhi HPCL 23.01.2015 1334 6.9 1289 Gujarat, Rajasthan and Haryana`,
            `11 17.07 Vizag – Secunderabad GAIL 18.05.2015 616 1.33 609 Andhra Pradesh, and Telangana`,
            `12 17.08 Paradip – Raipur Ranchi IOCL 17.08.2015 1108 5 1073 Odisha, Jharkhand and Chhattisgarh`,
            `13 9.01 Devangonthi – Devanhalli ATF IOCL 30.12.2016 36 0.66 36 Karnataka`,
            `14 5.09 Bina – Panki BPCL 21.12.2018 355 3.49 355 Madhya Pradesh and Uttar Pradesh`,
            `15 17.09 Numaligarh – Siliguri Oil India Ltd. 01.11.2021 660 1.72 660 Assam and West Bengal`,
            `16 5.11 Hassan – Cherlapalli HPCL 24.06.2019 680 2.2 650 Telangana, Andhra Pradesh and Karnataka`,
            `17 5.08 Mundra – Mithi Rohar (Kandla) APSEZ 28.03.2018 89 6.75 92 Gujarat`
        ];
        
        // Parse all rows
        const parsedRows = rawDataRows.map(row => parseRow(row));
        
        // First, get the current sheet data to find the next empty row
        const spreadsheetId = '1KI4ZrT5vTszgwIAW0vZPWAScZt6pfrQprSxGew31WzQ';
        
        const getResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sheet2!A:I'  // Get all rows in columns A through I
        });
        
        // Calculate the next empty row
        const currentRows = getResponse.data.values || [];
        const startRow = currentRows.length + 1;
        
        // If sheet is empty, include headers, otherwise just append data
        const values = currentRows.length === 0 
            ? [COLUMNS, ...parsedRows.map(row => COLUMNS.map(col => row[col]))]
            : parsedRows.map(row => COLUMNS.map(col => row[col]));
        
        // Write to Google Sheets (Sheet2), starting at the next empty row
        const range = `Sheet2!A${startRow}`;

        const request = {
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            resource: { values }
        };

        const response = await sheets.spreadsheets.values.update(request);
        console.log('Data written successfully to Sheet2:', response.data);
        
        // Log the values being written for verification
        console.log('Values being written:', values);
        console.log('Starting at row:', startRow);
        
        return response.data;

    } catch (error) {
        console.error('Error writing to Google Sheets:', error);
        throw error;
    }
}

// Execute the function
writeToGoogleSheets();
