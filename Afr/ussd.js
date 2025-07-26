require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const africastalking = require('africastalking')({
  apiKey: process.env.apiKey,
  username: 'sandbox'
});

const sms = africastalking.SMS;
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Store sent SMS logs in memory ---
const sentMessages = [];

// Init Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Sessions in memory
const sessions = new Map();

// Language options
const LANGUAGES = {
  '1': { code: 'en', name: 'English' },
  '2': { code: 'sw', name: 'Kiswahili' }
};

// Crops & livestock data
const CROPS_EN = { '1': 'Maize', '2': 'Tomatoes', '3': 'Rice', '4': 'Beans', '5': 'Potatoes' };
const CROPS_SW = { '1': 'Mahindi', '2': 'Nyanya', '3': 'Mchele', '4': 'Maharage', '5': 'Viazi' };
const LIVESTOCK_EN = { '1': 'Cattle', '2': 'Goats', '3': 'Sheep', '4': 'Chickens', '5': 'Pigs' };
const LIVESTOCK_SW = { '1': "Ng'ombe", '2': 'Mbuzi', '3': 'Mbuzi-kondoo', '4': 'Kuku', '5': 'Nguruwe' };

const CROP_SYMPTOMS_EN = {
  '1': 'Yellow leaves', '2': 'Brown spots on leaves', '3': 'Wilting plants',
  '4': 'Stunted growth', '5': 'Holes in leaves', '6': 'White powdery coating',
  '7': 'Black spots on fruits', '8': 'Rotting roots'
};
const CROP_SYMPTOMS_SW = {
  '1': 'Majani ya njano', '2': 'Madoa ya kahawia kwenye majani', '3': 'Mimea inakauka',
  '4': 'Mimea haikui vizuri', '5': 'Nadharia za majani', '6': 'Unyevu mweupe juu ya majani',
  '7': 'Madoa meusi kwenye matunda', '8': 'Mizizi inachakaa'
};

const LIVESTOCK_SYMPTOMS_EN = {
  '1': 'Not eating', '2': 'Coughing', '3': 'Diarrhea', '4': 'Limping',
  '5': 'Fever/Hot body', '6': 'Swollen joints', '7': 'Difficulty breathing', '8': 'Unusual discharge'
};
const LIVESTOCK_SYMPTOMS_SW = {
  '1': 'Hakula chakula', '2': 'Kukohoa', '3': 'Kuenda haja ndogo mara nyingi', '4': 'Kuuma mguu',
  '5': 'Homa/Mwili moto', '6': 'Maungio kwenye viungo', '7': 'Kushindwa kupumua', '8': 'Kutokwa na mate ya kawaida'
};

const EXPERT_CONTACTS = { crop: '+255700123456', livestock: '+255700654321' };

// --- Helper: Limit text to max N lines ---
function limitLines(text, maxLines = 10) {
  const lines = text.split('\n').slice(0, maxLines);
  return lines.join('\n');
}

// --- Send SMS using Africa's Talking ---
async function sendSms(to, message) {
  try {
    const response = await sms.send({
      to: [to],
      message,
      from: process.env.AFRICASTALKING_SHORTCODE
    });
    console.log(`✅ SMS sent to ${to}:`, response);
  } catch (err) {
    console.error('❗ Africa\'s Talking SMS error:', err);
  }
}

// --- USSD endpoint ---
app.post('/ussd', async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  console.log('📥 USSD request:', req.body);
  try {
    const response = await processUSSD(sessionId, phoneNumber, text);
    res.set('Content-Type', 'text/plain');
    res.send(response);  // User sees this on phone
  } catch (err) {
    console.error('❗ USSD error:', err);
    res.send('END Sorry, service unavailable.');
  }
});

// --- API to get sent messages (full stored messages) ---
app.get('/api/messages', (req, res) => {
  res.json(sentMessages);
});

// --- Session helpers ---
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { current_state: 'LANGUAGE_SELECTION', session_data: {} });
  }
  return sessions.get(sessionId);
}
function updateSession(sessionId, state, data) {
  const s = getSession(sessionId);
  s.current_state = state;
  s.session_data = { ...s.session_data, ...data };
}

// --- USSD Logic ---
async function processUSSD(sessionId, phoneNumber, text) {
  const session = getSession(sessionId);
  const inputs = text.split('*');
  const currentInput = inputs[inputs.length - 1];

  if (!text || text.trim() === '') {
    updateSession(sessionId, 'LANGUAGE_SELECTION', {});
    return 'CON Select Language / Chagua Lugha:\n1. English\n2. Kiswahili';
  }

  switch (session.current_state) {
    case 'LANGUAGE_SELECTION':
      return handleLanguageSelection(currentInput, sessionId);
    case 'MAIN_MENU':
      return handleMainMenu(currentInput, sessionId);
    case 'CROP_SELECTION':
      return handleCropSelection(currentInput, sessionId);
    case 'CROP_SYMPTOMS':
      return handleCropSymptoms(currentInput, sessionId, phoneNumber);
    case 'LIVESTOCK_SELECTION':
      return handleLivestockSelection(currentInput, sessionId);
    case 'LIVESTOCK_SYMPTOMS':
      return handleLivestockSymptoms(currentInput, sessionId, phoneNumber);
    case 'EXPERT_MENU':
      return handleExpertMenu(currentInput, sessionId);
    default:
      return 'END Invalid option.';
  }
}

// --- Menu Handlers ---
function handleLanguageSelection(choice, sessionId) {
  if (LANGUAGES[choice]) {
    const lang = LANGUAGES[choice].code;
    updateSession(sessionId, 'MAIN_MENU', { language: lang });
    return lang === 'sw'
      ? 'CON Karibu Farm Doctor!\n1. Matatizo ya Mazao\n2. Matatizo ya Mifugo\n3. Piga Simu Mtaalamu'
      : 'CON Welcome to Farm Doctor!\n1. Crop Problems\n2. Livestock Problems\n3. Call Expert';
  }
  return 'END Invalid language selection.';
}

function handleMainMenu(choice, sessionId) {
  const lang = getSession(sessionId).session_data.language;
  const sw = lang === 'sw';
  if (choice === '1') {
    updateSession(sessionId, 'CROP_SELECTION', {});
    return buildCropMenu(sw);
  }
  if (choice === '2') {
    updateSession(sessionId, 'LIVESTOCK_SELECTION', {});
    return buildLivestockMenu(sw);
  }
  if (choice === '3') {
    updateSession(sessionId, 'EXPERT_MENU', {});
    return sw
      ? 'CON Piga Simu:\n1. Mtaalamu wa Mazao\n2. Daktari wa Mifugo\n3. Rudi Menyu'
      : 'CON Call Expert:\n1. Agronomist\n2. Veterinarian\n3. Back to Menu';
  }
  return sw ? 'END Chaguo batili.' : 'END Invalid option.';
}

function handleCropSelection(choice, sessionId) {
  const sw = getSession(sessionId).session_data.language === 'sw';
  const crops = sw ? CROPS_SW : CROPS_EN;
  if (crops[choice]) {
    updateSession(sessionId, 'CROP_SYMPTOMS', { selected_crop: crops[choice] });
    return buildCropSymptomsMenu(sw);
  }
  return sw ? 'END Chaguo batili la zao.' : 'END Invalid crop selection.';
}

async function handleCropSymptoms(choice, sessionId, phoneNumber) {
  const session = getSession(sessionId);
  const sw = session.session_data.language === 'sw';
  const symptoms = sw ? CROP_SYMPTOMS_SW : CROP_SYMPTOMS_EN;
  if (symptoms[choice]) {
    const diagnosisFull = await getGeminiDiagnosis(session.session_data.selected_crop, symptoms[choice], sw);
    const diagnosisShort = limitLines(diagnosisFull, 10);
    const fullMessage = `${sw ? 'UTAMBUZI kwa' : 'DIAGNOSIS for'} ${session.session_data.selected_crop}:\n${diagnosisShort}\n${sw ? 'Piga mtaalamu' : 'Call expert'}: ${EXPERT_CONTACTS.crop}`;

    await sendSms(phoneNumber, fullMessage);
    sessions.delete(sessionId);

    // Store the exact message shown/sent for API retrieval
    sentMessages.push({
      to: phoneNumber,
      message: fullMessage,
      timestamp: new Date().toISOString()
    });

    return `END ${fullMessage}`;
  }
  return sw ? 'END Chaguo batili la dalili.' : 'END Invalid symptom selection.';
}

function handleLivestockSelection(choice, sessionId) {
  const sw = getSession(sessionId).session_data.language === 'sw';
  const livestock = sw ? LIVESTOCK_SW : LIVESTOCK_EN;
  if (livestock[choice]) {
    updateSession(sessionId, 'LIVESTOCK_SYMPTOMS', { selected_animal: livestock[choice] });
    return buildLivestockSymptomsMenu(sw);
  }
  return sw ? 'END Chaguo batili.' : 'END Invalid animal selection.';
}

async function handleLivestockSymptoms(choice, sessionId, phoneNumber) {
  const session = getSession(sessionId);
  const sw = session.session_data.language === 'sw';
  const symptoms = sw ? LIVESTOCK_SYMPTOMS_SW : LIVESTOCK_SYMPTOMS_EN;
  if (symptoms[choice]) {
    const diagnosisFull = await getGeminiDiagnosis(session.session_data.selected_animal, symptoms[choice], sw);
    const diagnosisShort = limitLines(diagnosisFull, 10);
    const fullMessage = `${sw ? 'UTAMBUZI kwa' : 'DIAGNOSIS for'} ${session.session_data.selected_animal}:\n${diagnosisShort}\n${sw ? 'Piga mtaalamu' : 'Call expert'}: ${EXPERT_CONTACTS.livestock}`;

    await sendSms(phoneNumber, fullMessage);
    sessions.delete(sessionId);

    // Store the exact message shown/sent for API retrieval
    sentMessages.push({
      to: phoneNumber,
      message: fullMessage,
      timestamp: new Date().toISOString()
    });

    return `END ${fullMessage}`;
  }
  return sw ? 'END Chaguo batili.' : 'END Invalid symptom selection.';
}

function handleExpertMenu(choice, sessionId) {
  const sw = getSession(sessionId).session_data.language === 'sw';
  if (choice === '1') return `END ${sw ? 'Mtaalamu wa Mazao' : 'Agronomist'}: ${EXPERT_CONTACTS.crop}`;
  if (choice === '2') return `END ${sw ? 'Daktari wa Mifugo' : 'Veterinarian'}: ${EXPERT_CONTACTS.livestock}`;
  if (choice === '3') {
    updateSession(sessionId, 'MAIN_MENU', {});
    return sw
      ? 'CON Karibu tena:\n1. Matatizo ya Mazao\n2. Matatizo ya Mifugo\n3. Piga Simu Mtaalamu'
      : 'CON Welcome back:\n1. Crop Problems\n2. Livestock Problems\n3. Call Expert';
  }
  return sw ? 'END Chaguo batili.' : 'END Invalid option.';
}

// --- Gemini ---
async function getGeminiDiagnosis(subject, symptom, sw) {
  const prompt = sw
    ? `Toa utambuzi wa haraka kwa ${subject} lenye dalili "${symptom}".`
    : `Provide quick diagnosis for ${subject} showing symptom "${symptom}".`;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini error:', err);
    return sw ? 'Samahani, huduma haipatikani sasa.' : 'Sorry, diagnosis not available.';
  }
}

// --- Build menus ---
function buildCropMenu(sw) {
  const crops = sw ? CROPS_SW : CROPS_EN;
  let m = sw ? 'CON Chagua zao:\n' : 'CON Select crop:\n';
  for (const [k, v] of Object.entries(crops)) m += `${k}. ${v}\n`;
  return m;
}
function buildLivestockMenu(sw) {
  const livestock = sw ? LIVESTOCK_SW : LIVESTOCK_EN;
  let m = sw ? 'CON Chagua mnyama:\n' : 'CON Select animal:\n';
  for (const [k, v] of Object.entries(livestock)) m += `${k}. ${v}\n`;
  return m;
}
function buildCropSymptomsMenu(sw) {
  const symptoms = sw ? CROP_SYMPTOMS_SW : CROP_SYMPTOMS_EN;
  let m = sw ? 'CON Chagua dalili:\n' : 'CON Select symptom:\n';
  for (const [k, v] of Object.entries(symptoms)) m += `${k}. ${v}\n`;
  return m;
}
function buildLivestockSymptomsMenu(sw) {
  const symptoms = sw ? LIVESTOCK_SYMPTOMS_SW : LIVESTOCK_SYMPTOMS_EN;
  let m = sw ? 'CON Chagua dalili:\n' : 'CON Select symptom:\n';
  for (const [k, v] of Object.entries(symptoms)) m += `${k}. ${v}\n`;
  return m;
}

// --- Start server ---
const port = 5050;
app.listen(port, () => console.log(`✅ USSD running on port ${port}`));
