const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");

const app = express();
dotenv.config();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

// Add timeout settings
app.use((req, res, next) => {
  req.setTimeout(600000);
  res.setTimeout(600000);
  next();
});

// Add IP check function
async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    console.error('Error getting IP:', error);
    return null;
  }
}

app.get("/test", (req, res) => {
  res.json({ message: "Server is running successfully!" });
});

app.post("/scrape", async (req, res) => {
  try {
    // Get IP before scraping
    const currentIP = await getPublicIP();
    console.log('Current IP Address:', currentIP);

    const { location, industry } = req.body;

    if (!location || !industry) {
      return res
        .status(400)
        .json({ error: "Location and industry are required" });
    }

    const url = `https://www.google.com/maps?hl=en`;

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--lang=en-US",
        "--disable-setuid-sandbox",
        "--window-size=1920,1080",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
      defaultViewport: null,
    });

    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "networkidle2" });

    const searchQuery = `${industry} in ${location}`;
    await page.waitForSelector("#searchboxinput", { visible: true });
    await page.type("#searchboxinput", searchQuery);
    await page.click("#searchbox-searchbutton");

    await page.waitForSelector(".m6QErb.DxyBCb.kA9KIf.dS8AEf", {
      visible: true,
    });

    await page.waitForSelector(
      '.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd[role="feed"]',
      { visible: true }
    );

    // First get the scroll height and log it
    const scrollableHeight = await page.evaluate(() => {
      const scrollableDiv = document.querySelector(
        '.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd[role="feed"]'
      );
      console.log("Scrollable div height:", scrollableDiv.scrollHeight);
      return scrollableDiv.scrollHeight;
    });

    // Scroll to the bottom
    await page.evaluate(async () => {
      const scrollableDiv = document.querySelector(
        '.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd[role="feed"]'
      );

      // Scroll in small steps to trigger loading of more results
      const scrollStep = 300;
      let lastHeight = scrollableDiv.scrollHeight;
      let attempts = 0;
      const maxAttempts = 20; // Prevent infinite loops

      while (attempts < maxAttempts) {
        scrollableDiv.scrollTo(0, scrollableDiv.scrollHeight);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Increased wait time

        if (scrollableDiv.scrollHeight === lastHeight) {
          attempts++;
        } else {
          attempts = 0; // Reset attempts if we find new content
        }

        lastHeight = scrollableDiv.scrollHeight;
      }
    });

    // Now get results after scrolling
    const results = await page.evaluate(() => {
      const businesses = [];
      const items = document.querySelectorAll(
        '.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd[role="feed"] .Nv2PK'
      );

      items.forEach((item) => {
        const name =
          item.querySelector(".qBF1Pd.fontHeadlineSmall")?.textContent || "N/A";
        const link = item.querySelector("a.hfpxzc")?.href || "N/A";
        const ratingStars = item.querySelector(".MW4etd")?.textContent || "N/A";
        const numberOfRatings =
          item.querySelector(".UY7F9")?.textContent || "N/A";
        const phone = item.querySelector(".UsdlK")?.textContent || "N/A";
        const temporarilyClosedText =
          item.querySelector(".eXlrNe")?.textContent || "N/A";
        const temporarilyClosed =
          temporarilyClosedText.includes("Temporarily closed");

        const categoryandaddressParentDiv =
          item.querySelectorAll(".UaQhfb .W4Efsd");

        // Extract children details
        const children2 = Array.from(
          categoryandaddressParentDiv[2]?.children || []
        ).map((child) => child.textContent.trim());

        // Extract category and address from children2
        const category = children2[0] || "N/A";
        const address = (children2[1] || "") + (children2[2] || "");

        const website = item.querySelector("a.lcr4fd")?.href || "N/A";

        businesses.push({
          name,
          link,
          ratingStars,
          numberOfRatings,
          phone,
          temporarilyClosed,
          category: category.replace(/ · /g, "").trim(),
          address: address.replace(/ · /g, "").replace(/·/g, "").trim(),
          website,
        });
      });

      return businesses;
    });

    await browser.close();
    console.log(results);
    return res.json({
      itemsHeight: scrollableHeight,
      scrollHeight: scrollableHeight,
      results,
      count: results.length,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "An error occurred while scraping" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
