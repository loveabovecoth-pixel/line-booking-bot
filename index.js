require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('LINE Booking Bot is running');
});

// ===== CONFIG =====
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Sheet1';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const PORT = process.env.PORT || 3000;

// pending แยกตาม user
let pendingBookings = {};

// ===== GOOGLE AUTH =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar',
  ],
});

const sheets = google.sheets({ version: 'v4', auth });
const calendar = google.calendar({ version: 'v3', auth });

// ===== SAVE TO SHEET =====
async function saveToSheet(userId, data) {
  console.log("Saving to sheet...");

  const values = [[
    new Date().toLocaleString('th-TH'),
    userId,
    data.date,
    data.time,
    data.customer
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  console.log("Saved to sheet OK");
}

// ===== CREATE CALENDAR EVENT =====
async function createCalendarEvent(data) {
  const [day, month, year] = data.date.split('/');
  const [startTime, endTime] = data.time.split('-');

  const startDateTime = new Date(
    `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T${startTime}:00+07:00`
  );

  const endDateTime = new Date(
    `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T${endTime}:00+07:00`
  );

  const event = {
    summary: data.customer,
    description: 'สร้างจาก LINE Booking Bot',
    start: {
      dateTime: startDateTime.toISOString(),
    },
    end: {
      dateTime: endDateTime.toISOString(),
    },
  };

  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: event,
  });

  console.log('📅 Calendar event created (timezone fixed)');
}

// ===== REPLY =====
async function replyMessage(replyToken, text) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    {
      replyToken,
      messages: [{ type: 'text', text }],
    },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// ===== WEBHOOK =====
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // ตอบ LINE ก่อน ป้องกัน timeout

  try {
    const event = req.body.events?.[0];
    if (!event || !event.message) return;

    const message = event.message.text.trim();
    const userId = event.source.userId;

    console.log("Message:", message);

    // ===== CONFIRM =====
    if (message.toUpperCase() === 'CONFIRM') {
      const booking = pendingBookings[userId];

      if (!booking) {
        await replyMessage(event.replyToken, 'ยังไม่มีนัดให้ยืนยัน');
        return;
      }

      await saveToSheet(userId, booking);
      await createCalendarEvent(booking);

      await replyMessage(
        event.replyToken,
        '✅ บันทึกนัดและสร้าง Calendar แล้ว'
      );

      delete pendingBookings[userId];
      return;
    }

    // ===== PARSE BOOKING =====
    const parts = message.split(' ');

    if (parts.length >= 3) {
      const dateParts = parts[0].split('/');

      let day, month, year;

      if (dateParts.length === 3) {
        [day, month, year] = dateParts;
      } else {
        const now = new Date();
        year = now.getFullYear();
        [day, month] = dateParts;
      }

      pendingBookings[userId] = {
        date: `${day}/${month}/${year}`,
        time: parts[1],
        customer: parts.slice(2).join(' '),
      };

      await replyMessage(
        event.replyToken,
        `📅 สรุปนัดหมาย
วันที่: ${pendingBookings[userId].date}
เวลา: ${pendingBookings[userId].time}
รายละเอียด: ${pendingBookings[userId].customer}

พิมพ์ CONFIRM เพื่อบันทึก`
      );
    } else {
      await replyMessage(
        event.replyToken,
        'รูปแบบไม่ถูกต้อง\nตัวอย่าง: 12/02 13:00-17:00 ลูกค้า A'
      );
    }

  } catch (err) {
    console.error("Webhook error:", err);
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log('🚀 LINE Booking Bot running on port', PORT);
});
