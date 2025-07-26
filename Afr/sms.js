require('dotenv').config();
const express = require('express');
const Africastalking = require('africastalking');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT1 || 5000;

// ✅ Africa's Talking credentials
// - Keep username 'sandbox' to use the sandbox environment for testing
const credentials = {
    apiKey: process.env.apiKey,
    username: 'sandbox'  // sandbox username to avoid real charges
};
const africasTalking = Africastalking(credentials);
const sms = africasTalking.SMS;

// ✅ Initialize Gemini AI client with your API key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Middleware to parse incoming requests and serve static files
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'views')));

// ✅ Store incoming messages in memory for the dashboard
let incomingMessages = [];

// ✅ Send test SMS on startup (optional)
// - Helps confirm SMS setup is working in sandbox
function sendMessage() {
    sms.send({ to: ['+255756897567'], message: "We are testing..." })
        .then(response => console.log('📤 Test SMS sent:', response))
        .catch(error => console.error('❗ SMS error:', error));
}
sendMessage();

// --------------------------------------------------
// ✅ UPDATED: Incoming SMS webhook to handle messages sent to your shortcode
// When Africa's Talking sends incoming SMS webhook, it includes:
// - `from`: sender's phone number
// - `to`: the shortcode (e.g. "66575") that received the message
// - `text`: message content
// - `date`: timestamp
//
// WHY update:
// 1. Added capturing `to` (shortcode) so you can log and track messages coming specifically to your shortcode.
// 2. After generating AI reply, send SMS back using `sms.send()` from the shortcode to the user, simulating two-way chat on your shortcode.
// 3. Always respond with 'OK' quickly to Africa's Talking to prevent retries.
// --------------------------------------------------
app.post('/incoming', async (req, res) => {
  const { from, text, date, to } = req.body; // 'to' is your shortcode
  console.log(`Received SMS on shortcode ${to} from ${from}: "${text}"`);

  try {
    const prompt = `
You are an AI specialized ONLY in agriculture.
If the question is about agriculture, answer helpfully.
If not, say you can only assist with agriculture topics.

User: ${text}
AI:
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const result = await model.generateContent(prompt);
    const aiReply = result.response.text().trim();

    await sms.send({
      from: to,    // reply from the SAME shortcode that received the message
      to: [from],
      message: aiReply
    });

    console.log(`Replied to ${from} from shortcode ${to}: "${aiReply}"`);
    res.send('OK');
  } catch (err) {
    console.error('Error:', err);
    res.send('OK'); // prevent retries even on error
  }
});


// ✅ API to get all incoming messages (for dashboard or debug)
app.get('/api/messages', (req, res) => {
    res.json(incomingMessages);
});

// ✅ AI chat endpoint for dashboard interaction (no shortcode needed here)
app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        const prompt = `
You are an AI assistant specialized ONLY in agriculture.
If the question is about agriculture, answer helpfully.
If asked about anything else, reply politely:
"Sorry, I can only assist with agriculture-related topics."

User: ${userMessage}
AI:
        `;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        const reply = result.response.text().trim();

        res.json({ reply });
    } catch (error) {
        console.error('❗ AI error:', error);
        res.status(500).json({ reply: "⚠️ AI failed to respond." });
    }
});

// ✅ Serve the dashboard HTML page
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// ✅ Start server listening
app.listen(port, () => {
    console.log(`✅ Server running on http://localhost:${port}`);
});
