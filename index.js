require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('LINE Booking Bot is running');
});

// ===== CONFIG =====
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'Sheet1';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

let pendingBooking = null;

// ===== GOOGLE AUTH =====
const auth = new google.auth.GoogleAuth({
  keyFile: 'service-account.json',
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar',
  ],
});

const sheets = google.sheets({ version: 'v4', auth });
const calendar = google.calendar({ version: 'v3', auth });

// ===== SAVE TO SHEET =====
async function saveToSheet(userId, data) {
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
}

// ===== CREATE GOOGLE CALENDAR EVENT =====
async function createCalendarEvent(data) {
  // รองรับ dd/mm หรือ dd/mm/yyyy
  const dateParts = data.date.split('/');

  let day, month, year;

  if (dateParts.length === 3) {
    [day, month, year] = dateParts;
  } else {
    const now = new Date();
    year = now.getFullYear();
    [day, month] = dateParts;
  }

  const [startTime, endTime] = data.time.split('-');

  const startDateTime = new Date(
    `${year}-${month}-${day}T${startTime}:00`
  );

  const endDateTime = new Date(
    `${year}-${month}-${day}T${endTime}:00`
  );

  const event = {
    summary: `${data.customer}`,
    description: 'สร้างจาก LINE Booking Bot',
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'Asia/Bangkok',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'Asia/Bangkok',
    },
  };

  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: event,
  });

  console.log('📅 Calendar event created');
}

// ===== REPLY TO LINE =====
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
  try {
if (!req.body.events || req.body.events.length === 0) {
      return res.sendStatus(200);
    }

    if (!req.body.events || req.body.events.length === 0) {
  return res.sendStatus(200);
}

const event = req.body.events[0];

// ถ้าไม่มี message ให้ตอบ 200 แล้วจบ
if (!event.message || !event.message.text) {
  return res.sendStatus(200);
}

const message = event.message.text.trim();
const userId = event.source.userId;


    // ===== CONFIRM =====
    if (message.toUpperCase() === 'CONFIRM') {
      if (!pendingBooking) {
        await replyMessage(event.replyToken, 'ยังไม่มีนัดให้ยืนยัน');
        return res.sendStatus(200);
      }

      await saveToSheet(userId, pendingBooking);
      await createCalendarEvent(pendingBooking);

      await replyMessage(
        event.replyToken,
        '✅ บันทึกนัดและสร้าง Calendar แล้ว'
      );

      pendingBooking = null;
      return res.sendStatus(200);
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

      pendingBooking = {
        date: `${day}/${month}/${year}`,
        time: parts[1],
        customer: parts.slice(2).join(' '),
      };

      await replyMessage(
        event.replyToken,
        `📅 สรุปนัดหมาย
วันที่: ${pendingBooking.date}
เวลา: ${pendingBooking.time}
รายละเอียด: ${pendingBooking.customer}

ถ้าถูกต้อง พิมพ์ CONFIRM เพื่อบันทึกนัด`
      );
    } else {
      await replyMessage(
        event.replyToken,
        'รูปแบบไม่ถูกต้อง\nตัวอย่าง: 12/02 13:00-17:00 ลูกค้า A'
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

// ===== START SERVER =====
app.listen(3000, () => {
  console.log('🚀 LINE Booking Bot running on port 3000');
});
