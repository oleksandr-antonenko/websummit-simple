import 'dotenv/config';
import { execSync } from 'child_process';
import fs from 'fs';
import Database from 'better-sqlite3';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configuration
const config = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  deviceId: process.env.ADB_DEVICE_ID,
  searchRole: process.env.SEARCH_ROLE || 'Investor',
  maxScrolls: parseInt(process.env.MAX_SCROLLS) || 200,
  outputCsv: process.env.OUTPUT_CSV || 'contacts.csv',
  maxConsecutiveNoNew: 5,
  scrollDelay: 2000,
  screenWidth: 1080,
  screenHeight: 2340,
};

// Initialize Gemini
const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

// Initialize SQLite database
const db = new Database('contacts.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    role TEXT,
    company TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// ADB Helper Functions
function adbCommand(command) {
  const fullCommand = `adb -s ${config.deviceId} ${command}`;
  return execSync(fullCommand, { encoding: 'utf8' });
}

function captureScreenshot() {
  console.log('📸 Taking screenshot...');
  adbCommand('shell screencap -p /sdcard/screenshot.png');
  adbCommand('pull /sdcard/screenshot.png screenshot.png');
  const imageBuffer = fs.readFileSync('screenshot.png');
  return imageBuffer.toString('base64');
}

function scrollDown() {
  console.log('📜 Scrolling down...');
  const startY = Math.floor(config.screenHeight * 0.8);
  const endY = Math.floor(config.screenHeight * 0.2);
  const centerX = Math.floor(config.screenWidth / 2);
  adbCommand(`shell input swipe ${centerX} ${startY} ${centerX} ${endY} 300`);
}

// Gemini AI extraction
async function extractContactsFromScreenshot(imageBase64) {
  console.log('🤖 Analyzing screenshot with Gemini...');

  const prompt = `You are analyzing a screenshot from a mobile app showing a list of contacts/people.

Extract ALL visible contact information. For each person shown, extract:
1. Full name (required)
2. Job title/role (if visible)
3. Company name (if visible)

IMPORTANT:
- Only extract actual people's information
- Skip UI elements, buttons, navigation items
- If title or company is not visible, omit those fields
- Extract ALL visible people, not just one
- If there are no visible contacts, return an empty array

Return ONLY valid JSON (no markdown, no explanation):
{
  "contacts": [
    { "name": "John Doe", "title": "CEO", "company": "TechCorp" },
    { "name": "Jane Smith", "title": "Investor" }
  ]
}`;

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64,
        },
      },
      { text: prompt },
    ]);

    const response = await result.response;
    let text = response.text().trim();

    // Clean up markdown code blocks
    if (text.startsWith('```json')) {
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/```\n?/g, '');
    }

    // Extract JSON
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      text = text.substring(firstBrace, lastBrace + 1);
    }

    const data = JSON.parse(text);
    console.log(`✅ Found ${data.contacts.length} contacts in screenshot`);
    return data.contacts;
  } catch (error) {
    console.error('❌ Error analyzing screenshot:', error.message);
    return [];
  }
}

// Database functions
function saveContact(contact) {
  try {
    const stmt = db.prepare('INSERT INTO contacts (name, role, company) VALUES (?, ?, ?)');
    stmt.run(contact.name, contact.title || config.searchRole, contact.company || '');
    return true;
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return false; // Already exists
    }
    console.error('❌ Error saving contact:', error.message);
    return false;
  }
}

function exportToCSV() {
  console.log('\n📊 Exporting to CSV...');
  const contacts = db.prepare('SELECT name, role, company FROM contacts ORDER BY created_at DESC').all();

  const csvContent = [
    'name,role,company',
    ...contacts.map(c => `"${c.name}","${c.role || ''}","${c.company || ''}"`)
  ].join('\n');

  fs.writeFileSync(config.outputCsv, csvContent);
  console.log(`✅ Exported ${contacts.length} contacts to ${config.outputCsv}`);
  return contacts.length;
}

// Main extraction loop
async function run() {
  console.log('🚀 Starting contact extraction...');
  console.log(`📱 Device: ${config.deviceId}`);
  console.log(`🔍 Role: ${config.searchRole}`);
  console.log(`📜 Max scrolls: ${config.maxScrolls}`);
  console.log(`⏸️  Stopping after ${config.maxConsecutiveNoNew} consecutive screens with no new contacts\n`);
  console.log('⚠️  Make sure the app is open with search results visible!\n');

  await new Promise(resolve => setTimeout(resolve, 3000));

  let totalExtracted = 0;
  let consecutiveNoNew = 0;

  for (let scrollCount = 0; scrollCount < config.maxScrolls; scrollCount++) {
    console.log(`\n--- Screen ${scrollCount + 1}/${config.maxScrolls} ---`);

    try {
      // Capture screenshot
      const screenshot = captureScreenshot();

      // Extract contacts
      const contacts = await extractContactsFromScreenshot(screenshot);

      if (contacts.length === 0) {
        consecutiveNoNew++;
        console.log(`⚠️  No contacts found (${consecutiveNoNew}/${config.maxConsecutiveNoNew})`);

        if (consecutiveNoNew >= config.maxConsecutiveNoNew) {
          console.log('\n🛑 No new contacts found in 5 consecutive screens. Stopping...');
          break;
        }

        scrollDown();
        await new Promise(resolve => setTimeout(resolve, config.scrollDelay));
        continue;
      }

      // Save contacts
      let newContactsThisScreen = 0;
      for (const contact of contacts) {
        if (saveContact(contact)) {
          newContactsThisScreen++;
          totalExtracted++;
          console.log(`✅ ${contact.name} - ${contact.title || 'N/A'}${contact.company ? ` @ ${contact.company}` : ''}`);
        }
      }

      if (newContactsThisScreen === 0) {
        consecutiveNoNew++;
        console.log(`⚠️  All contacts already in database (${consecutiveNoNew}/${config.maxConsecutiveNoNew})`);

        if (consecutiveNoNew >= config.maxConsecutiveNoNew) {
          console.log('\n🛑 All visible contacts already extracted. Stopping...');
          break;
        }
      } else {
        consecutiveNoNew = 0; // Reset counter
      }

      // Scroll to next screen
      scrollDown();
      await new Promise(resolve => setTimeout(resolve, config.scrollDelay));

    } catch (error) {
      console.error('❌ Error:', error.message);
      await new Promise(resolve => setTimeout(resolve, config.scrollDelay));
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`🎉 Extraction complete!`);
  console.log(`📊 Total new contacts extracted: ${totalExtracted}`);

  const totalInDb = exportToCSV();
  console.log(`💾 Total contacts in database: ${totalInDb}`);
  console.log('='.repeat(50) + '\n');
}

// Run the scraper
run().catch(console.error);
