const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
    // Try multiple IP checking services
    const services = [
      "https://api.ipify.org?format=json",
      "https://ifconfig.me/ip",
      "https://api.myip.com",
    ];

    for (const service of services) {
      try {
        const response = await axios.get(service, { timeout: 5000 });
        if (response.data) {
          return typeof response.data === "string"
            ? response.data
            : response.data.ip;
        }
      } catch (e) {
        continue;
      }
    }
    throw new Error("Could not get IP from any service");
  } catch (error) {
    console.error("Error getting IP:", error);
    return null;
  }
}

app.post("/single-email-finder", async (req, res) => {
  const { domain } = req.body;
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  const allEmails = new Set();

  try {
    // Updated email regex to include .co.in and other TLDs
    const emailRegex = /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/g;

    // First scrape the homepage
    console.log('Scraping homepage:', domain);
    await page.goto(domain, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForNetworkIdle(10000);
    const content = await page.content();
    const foundEmails = content.match(emailRegex) || [];
    foundEmails.forEach(email => allEmails.add(email));

    // Get all internal links
    console.log('Extracting internal links...');
    const allLinks = await page.evaluate(() => {
      const links = [];
      const currentHost = window.location.hostname;
      
      document.querySelectorAll('a').forEach(link => {
        try {
          const href = link.href;
          if (!href) return;

          const url = new URL(href);
          if (url.hostname === currentHost && href.startsWith('http')) {
            links.push({
              href: href,
              text: link.textContent.trim().toLowerCase()
            });
          }
        } catch (e) {
          // Skip invalid URLs
        }
      });
      return links;
    });

    console.log('Found links:', allLinks);

    // Determine which URLs to scrape
    let urlsToScrape = [];
    
    if (allLinks.length <= 3) {
      // If 3 or fewer links, use all of them
      urlsToScrape = allLinks.map(link => link.href);
      console.log('Using all available links:', urlsToScrape);
    } else {
      // If more than 3 links, use Gemini to shortlist
      console.log('More than 3 links found, using Gemini to shortlist...');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const prompt = `Analyze these URLs and return exactly 3 URLs that are most likely to contain email addresses. Focus on pages like 'Contact', 'About', 'Team', etc.
      Input URLs: ${JSON.stringify(allLinks)}
      Return ONLY a JSON array of strings, nothing else. Example: ["https://example.com/contact","https://example.com/about","https://example.com/team"]`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();
      console.log('Raw Gemini response:', response);

      // Clean and parse Gemini response
      const cleanResponse = response.replace(/```json\n?|\n?```/g, '').trim();
      console.log('Cleaned response:', cleanResponse);
      
      urlsToScrape = JSON.parse(cleanResponse);
      console.log('Gemini suggested URLs:', urlsToScrape);
    }

    // Scrape each selected page
    for (const url of urlsToScrape) {
      console.log('Scraping URL:', url);
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await page.waitForNetworkIdle(10000);
        const pageContent = await page.content();
        const pageEmails = pageContent.match(emailRegex) || [];
        pageEmails.forEach(email => allEmails.add(email));
      } catch (error) {
        console.error(`Error scraping ${url}:`, error);
      }
    }

    // Filter and validate emails
    const validEmails = Array.from(allEmails).filter(email => {
      try {
        return email.includes('@') && 
               email.includes('.') && 
               email.length > 4 && 
               !email.includes('..') &&
               !email.startsWith('.') &&
               !email.endsWith('.') &&
               /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      } catch {
        return false;
      }
    });

    console.log(`Emails found on ${domain} and related pages:`, validEmails);
    res.json({ 
      emails: validEmails,
      scrapedPages: [domain, ...urlsToScrape],
      allLinks: allLinks,
      totalEmailsFound: validEmails.length
    });

  } catch (error) {
    console.error(`Error in email scraping:`, error);
    res.status(500).json({ error: "Failed to scrape emails" });
  } finally {
    await browser.close();
  }
});

app.post("/hunter/domain-search", async (req, res) => {
  const { domain } = req.body;

  if (!domain) {
    return res.status(400).json({ error: "Domain name is required" });
  }

  try {
    const hunterResponse = await axios.get(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${process.env.HUNTER_API_KEY}`
    );
    res.json(hunterResponse.data); // Ensure we are sending only the data part of the response
  } catch (error) {
    console.error("Hunter API Error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to fetch domain information from Hunter API",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/ip", async (req, res) => {
  const ip = await getPublicIP();
  res.json({ ip });
});

app.post("/scrape", async (req, res) => {
  try {
    // Get IP before scraping
    const currentIP = await getPublicIP();
    console.log("Current IP Address:", currentIP);

    const { location, industry } = req.body;

    if (!location || !industry) {
      return res
        .status(400)
        .json({ error: "Location and industry are required" });
    }

    const url = `https://www.google.com/maps?hl=en`;

    // const browser = await puppeteer.launch({
    //   headless: true,
    //   args: [
    //     "--lang=en-US",
    //     "--disable-setuid-sandbox",
    //     "--window-size=1920,1080",
    //     "--no-sandbox",
    //     "--disable-setuid-sandbox",
    //     "--disable-dev-shm-usage",
    //   ],
    //   defaultViewport: null,
    // });
    const browser = await puppeteer.launch({
      headless: false,
      args: ["--lang=en-US", "--disable-setuid-sandbox", "--no-sandbox"],
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
    console.log("Got scraped data");
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

app.post("/bulk-email-finder", async (req, res) => {
  const { domains } = req.body; // Array of {_id, domain} objects
  console.log(`Received domains for processing:`, domains);
  
  // Immediately respond that batch processing has started
  res.json({ message: "Batch processing started", domainsCount: domains.length });
  console.log(`Batch processing started for ${domains.length} domains`);

  // Process domains in batches of 10
  const batchSize = 5;
  const batches = [];
  
  for (let i = 0; i < domains.length; i += batchSize) {
    batches.push(domains.slice(i, i + batchSize));
  }
  console.log(`Total batches created: ${batches.length}`);

  // Process each batch
  for (let [batchIndex, batch] of batches.entries()) {
    console.log(`Processing batch ${batchIndex + 1} of ${batches.length}`);
    
    // Process domains in current batch concurrenly
    const batchResults = await Promise.all(
      batch.map(async ({ _id, domain }) => {
        try {
          console.log(`Launching browser for domain: ${domain}`);
          const browser = await puppeteer.launch({ headless: false });
          const page = await browser.newPage();
          const allEmails = new Set();

          // Updated email regex
          const emailRegex = /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/g

          // Scrape homepage
          console.log(`Scraping homepage: ${domain}`);
          await page.goto(domain, { waitUntil: "networkidle2", timeout: 30000 });
          await page.waitForNetworkIdle(5000);
          
          // Get page content for emails and company description
          const content = await page.content();
          console.log(`Page content retrieved for ${domain}`);
          const pageText = await page.evaluate(() => document.body.innerText);
          const foundEmails = content.match(emailRegex) || [];
          foundEmails.forEach(email => allEmails.add(email));
          console.log(`Found emails on homepage: ${foundEmails.length}`);

          // Get company description from Gemini
          const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

          const descriptionPrompt = `Based on this website content, write 2-3 clear, concise descriptions (2-3 sentences each) about the company/website. Focus on their main business, value proposition, and unique features. Content: ${pageText.substring(0, 2000)}`;
          
          const descriptionResult = await model.generateContent(descriptionPrompt);
          const companyDescriptions = descriptionResult.response.text();
          console.log(`Company descriptions generated for ${domain}`);

          // Get internal links
          const allLinks = await page.evaluate(() => {
            const links = [];
            const currentHost = window.location.hostname;
            
            document.querySelectorAll('a').forEach(link => {
              try {
                const href = link.href;
                if (!href) return;
                const url = new URL(href);
                if (url.hostname === currentHost && href.startsWith('http')) {
                  links.push({
                    href: href,
                    text: link.textContent.trim().toLowerCase()
                  });
                }
              } catch (e) {}
            });
            return links;
          });
          console.log(`Internal links found: ${allLinks.length}`);

          // Determine pages to scrape
          let urlsToScrape = [];
          if (allLinks.length <= 3) {
            urlsToScrape = allLinks.map(link => link.href);
            console.log(`Using all ${urlsToScrape.length} links for scraping`);
          } else {
            const linksPrompt = `Analyze these URLs and return exactly 3 URLs that are most likely to contain email addresses. Focus on pages like 'Contact', 'About', 'Team', etc.
            Input URLs: ${JSON.stringify(allLinks)}
            Return ONLY a JSON array of strings, nothing else. Example: ["https://example.com/contact","https://example.com/about","https://example.com/team"]`;

            const linksResult = await model.generateContent(linksPrompt);
            const response = linksResult.response.text();
            urlsToScrape = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());
            console.log(`Selected URLs for scraping: ${urlsToScrape.length}`);
          }

          // Scrape additional pages
          for (const url of urlsToScrape) {
            try {
              console.log(`Scraping additional URL: ${url}`);
              await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
              await page.waitForNetworkIdle(5000);
              const pageContent = await page.content();
              const pageEmails = pageContent.match(emailRegex) || [];
              pageEmails.forEach(email => allEmails.add(email));
              console.log(`Found emails on ${url}: ${pageEmails.length}`);
            } catch (error) {
              console.error(`Error scraping ${url}:`, error);
            }
          }

          // Filter and validate emails
          const validEmails = Array.from(allEmails).filter(email => {
            try {
              return email.includes('@') && 
                     email.includes('.') && 
                     email.length > 4 && 
                     !email.includes('..') &&
                     !email.startsWith('.') &&
                     !email.endsWith('.') &&
                     /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            } catch {
              return false;
            }
          });
          console.log(`Valid emails found for ${domain}: ${validEmails.length}`);

          await browser.close();
          console.log(`Browser closed for ${domain}`);

          return {
            _id,
            domain,
            success: true,
            emails: validEmails,
            scrapedPages: [domain, ...urlsToScrape],
            totalEmailsFound: validEmails.length,
            companyDescriptions
          };

        } catch (error) {
          console.error(`Error processing ${domain}:`, error);
          return {
            _id,
            domain,
            success: false,
            error: "Failed to scrape emails",
            errorDetails: error.message
          };
        }
      })
    );

    // Send batch results to webhook
    try {
      console.log(`Sending batch results for batch ${batchIndex + 1}`);
      console.log(batchResults);
      await axios.post('http://localhost:3000/api/leads/email/callback', {
        batch: batchResults,
        batchNumber: batchIndex + 1,
        totalBatches: batches.length
      });
      console.log(`Batch ${batchIndex + 1} results sent successfully`);
    } catch (error) {
      console.error('Error sending webhook:', error);
    }

    // Wait for 1 minute before processing next batch (if not the last batch)
    if (batchIndex < batches.length - 1) {
      console.log('Waiting 1 minute before next batch...');
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
