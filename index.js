const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const app = express();

dotenv.config();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

app.post("/scrape", async (req, res) => {
  const { location, industry } = req.body;

  if (!location || !industry) {
    return res
      .status(400)
      .json({ error: "Location and industry are required" });
  }

  const url = `https://www.google.com/maps`;

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  const searchQuery = `${industry} in ${location}`;
  await page.waitForSelector("#searchboxinput", { visible: true });
  await page.type("#searchboxinput", searchQuery);
  await page.click("#searchbox-searchbutton");

  // Wait for search results container
  await page.waitForSelector(".m6QErb.DxyBCb.kA9KIf.dS8AEf", { visible: true });

  let results = [];
  let endOfList = false;

  while (!endOfList) {
    // Extract data
    const newResults = await page.evaluate(() => {
      const businesses = [];
      const items = document.querySelectorAll(
        ".m6QErb.DxyBCb.kA9KIf.dS8AEf .Nv2PK"
      );

      items.forEach((item) => {
        const name =
          item.querySelector(".qBF1Pd.fontHeadlineSmall")?.textContent || "N/A";
        const link = item.querySelector("a.hfpxzc")?.href || "N/A";
        const ratingStars = item.querySelector(".MW4etd")?.textContent || "N/A";
        const numberOfRatings =
          item.querySelector(".UY7F9")?.textContent || "N/A";
        const phone = item.querySelector(".UsdlK")?.textContent || "N/A";

        const categoryandaddressParentDiv = item.querySelectorAll(".UaQhfb .W4Efsd");

        const children2 = Array.from(categoryandaddressParentDiv[2]?.children || []).map(child => child.textContent.trim());

        const category = children2[0] || "N/A";
        const address = (children2[1] || "") + (children2[2] || "");

        const website = item.querySelector("a.lcr4fd")?.href || "N/A";

        businesses.push({
          name,
          link,
          ratingStars,
          numberOfRatings,
          phone,
          category: category.replace(/ · /g, '').trim(),
          address: address.replace(/ · /g, '').replace(/·/g, '').trim(),
          website
        });
      });

      return businesses;
    });

    results = results.concat(newResults);

    // Scroll down to load more results
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    // Wait for new content to load
    await page.waitForNetworkIdle(5000);

    // Check if the end of the list is reached
    endOfList = await page.evaluate(() => {
      return !!document.querySelector('.HlvSq');
    });
  }

  await browser.close();

  return res.json({ results, count: results.length });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
