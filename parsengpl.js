const { google } = require("googleapis");
const credentials = require("./credentials.json");

// Define the fixed columns for Natural Gas Pipelines
const COLUMNS = [
  "Sl No.",
  "PL Unique ID",
  "Name of Natural Gas Pipelines",
  "Entity",
  "Date of Authorization",
  "Auth Length (KM)",
  "Auth Capacity(MMSCMD)",
  "Operating Length (KM)",
  "States from which Pipeline passes",
];

function cleanRawData(rawData) {
  // Remove extra newlines and normalize spaces
  return rawData
    .replace(/\n/g, " ") // Replace newlines with spaces
    .replace(/\s+/g, " ") // Replace multiple spaces with single space
    .trim(); // Remove leading/trailing spaces
}

function parseRow(rawData) {
  // Clean the raw data first
  const cleanData = cleanRawData(rawData)
    .replace('—', '-'); // Standardize different types of dashes

  const parts = cleanData.split(' ');

  // Initialize result object
  const result = {};

  // Extract values based on known positions
  result[COLUMNS[0]] = parts[0]; // Sl No.

  // Handle PL Unique ID with .NGPL
  const uniqueIdParts = [];
  let currentIndex = 1;
  while (parts[currentIndex] && parts[currentIndex].includes('.NGPL')) {
    uniqueIdParts.push(parts[currentIndex]);
    currentIndex++;
  }
  result[COLUMNS[1]] = uniqueIdParts.join(' '); // PL Unique ID

  // Find the entity position (looking for all possible entities)
  const entityIndex = parts.findIndex((part, index) => {
    return /^(GAIL|GSPL|PIL|GIGL|GITL|GGL|AGCL|IOCL|ONGC|RGPL|DFPCL)$/.test(part);
  });

  // Join all parts between PL Unique ID and Entity for Pipeline name
  result[COLUMNS[2]] = parts.slice(currentIndex, entityIndex).join(' '); // Name of Natural Gas Pipelines
  result[COLUMNS[3]] = parts[entityIndex]; // Entity

  // Get remaining values
  result[COLUMNS[4]] = parts[entityIndex + 1]; // Date of Authorization
  result[COLUMNS[5]] = parts[entityIndex + 2].replace(',', ''); // Auth Length (remove commas)
  result[COLUMNS[6]] = parts[entityIndex + 3]; // Auth Capacity
  result[COLUMNS[7]] = parts[entityIndex + 4]; // Operating Length
  result[COLUMNS[8]] = parts.slice(entityIndex + 5).join(' '); // States

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
      `17 17.17.NGPL Assam Regional Network AGCL 20.12.2013 105 2.428 107 Assam`,
      `18 17.18.NGPL Dukli — Maharajganj GAIL 09.01.2014 5.20 0.08 0 Agartala`,
      `19 17.19.NGPL Uran-Taloja DFPCL 21.10.2014 42.00 0.70 42.00 Maharashtra`,
      `20 17.09.NGPL Chainsa-Jhajjar-Hissar GAIL 13.12.2010 455 35.00 440 Haryana, Rajasthan and Delhi`,
      `21 17.12.NGPL Dadri-Bawana-Nangal GAIL 15.02.2011 921 31.00 998 Punjab, Haryana, Uttar Pradesh, Uttarakhand, Delhi, and Himachal Pradesh`
    ];

    // Parse all rows
    const parsedRows = rawDataRows.map(row => parseRow(row));

    // First, get the current sheet data to find the next empty row
    const spreadsheetId = "1KI4ZrT5vTszgwIAW0vZPWAScZt6pfrQprSxGew31WzQ";

    const getResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Sheet3!A:I", // Get all rows in columns A through I
    });

    // Calculate the next empty row
    const currentRows = getResponse.data.values || [];
    const startRow = currentRows.length + 1;

    // If sheet is empty, include headers, otherwise just append data
    const values =
      currentRows.length === 0
        ? [COLUMNS, ...parsedRows.map((row) => COLUMNS.map((col) => row[col]))]
        : parsedRows.map((row) => COLUMNS.map((col) => row[col]));

    // Write to Google Sheets (Sheet3)
    const range = `Sheet3!A${startRow}`;

    const request = {
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      resource: { values },
    };

    const response = await sheets.spreadsheets.values.update(request);
    console.log("Data written successfully to Sheet3:", response.data);

    // Log the values being written for verification
    console.log("Values being written:", values);
    console.log("Starting at row:", startRow);

    return response.data;
  } catch (error) {
    console.error("Error writing to Google Sheets:", error);
    throw error;
  }
}

// Execute the function
writeToGoogleSheets();
