require('dotenv').config();
const express = require('express');
const africastalking = require('africastalking')({
  apiKey: process.env.apiKey,
  username: 'sandbox'
});
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const sms = africastalking.SMS;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const sessions = new Map();

const COMMON_ANIMALS = ['kuku', "ng'ombe", 'ngombe', 'mbuzi', 'kondoo', 'nguruwe'];
const COMMON_CROPS = ['mahindi', 'mchele', 'maharage', 'viazi', 'nyanya'];

const // Added symptom whitelists:
COMMON_ANIMAL_SYMPTOMS = [
  'coughing', 'loss of appetite', 'limping', 'swollen eyes', 'diarrhea',
  'lethargy', 'difficulty breathing', 'weight loss',
  'kukohoa', 'kupoteza hamu ya chakula', 'kutetemeka', 'kuvimba macho', 'kuhara',
  'kulegea mwili', 'kupumua kwa shida', ,'mafua','kupoteza uzito'
];

const COMMON_CROP_SYMPTOMS = [
  'yellow leaves', 'wilting', 'spots on leaves', 'stunted growth', 'mold on stems',
  'holes in leaves', 'discoloration', 'fruit rot',
  'majani ya manjano', 'kukauka', 'madoa kwenye majani', 'ukuaji dhaifu',
  'ukungu kwenye shina', 'msimbo kwenye majani', 'rangi kubadilika', 'matunda kuharibika'
];

const EXPERT_CONTACTS = { crop: '+255700123456', livestock: '+255700654321' };

async function sendSms(to, message) {
  try {
    await sms.send({ to: [to], message, from: process.env.AFRICASTALKING_SHORTCODE });
    console.log('✅ SMS sent:', to);
  } catch (e) {
    console.error('SMS error:', e);
  }
}

async function aiYesNo(prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    const result = await model.generateContent(prompt);
    const answer = result.response.text().toLowerCase().trim();
    return answer.includes('yes') || answer.includes('ndio');
  } catch (e) {
    console.error('AI error:', e);
    return false;
  }
}

app.post('/ussd', async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  const inputs = text.split('*');
  const input = inputs[inputs.length - 1].trim();
  let session = sessions.get(sessionId) || { step: 'LANGUAGE', retries: 0, lang: 'en' };

  let reply = '';
  try {
    if (!text) {
      session = { step: 'LANGUAGE', retries: 0, lang: 'en' };
      sessions.set(sessionId, session);
      reply = 'CON Select Language / Chagua Lugha:\n1. English\n2. Kiswahili';
    } else if (session.step === 'LANGUAGE') {
      if (input === '1' || input === '2') {
        session.lang = input === '2' ? 'sw' : 'en';
        session.step = 'MENU';
        reply = session.lang === 'sw'
          ? 'CON Karibu:\n1. Tatizo la Mazao\n2. Tatizo la Mifugo\n3. Piga Mtaalamu'
          : 'CON Welcome:\n1. Crop Problem\n2. Animal Problem\n3. Call Expert';
      } else {
        reply = session.lang === 'sw' ? 'END Chaguo batili.' : 'END Invalid option.';
      }
    } else if (session.step === 'MENU') {
      if (input === '1') {
        session.step = 'CROP';
        session.retries = 0;
        reply = session.lang === 'sw' ? 'CON Andika jina la zao:' : 'CON Enter crop name:';
      } else if (input === '2') {
        session.step = 'ANIMAL';
        session.retries = 0;
        reply = session.lang === 'sw' ? 'CON Andika jina la mnyama:' : 'CON Enter animal name:';
      } else if (input === '3') {
        reply = session.lang === 'sw'
          ? `END Piga Mtaalamu:\n- Mtaalamu wa Mazao: ${EXPERT_CONTACTS.crop}\n- Daktari wa Mifugo: ${EXPERT_CONTACTS.livestock}`
          : `END Call Expert:\n- Agronomist: ${EXPERT_CONTACTS.crop}\n- Veterinarian: ${EXPERT_CONTACTS.livestock}`;
        sessions.delete(sessionId);
      } else {
        reply = session.lang === 'sw' ? 'END Chaguo batili.' : 'END Invalid option.';
      }
    } else if (session.step === 'CROP') {
      const valid = COMMON_CROPS.includes(input.toLowerCase()) ||
        await aiYesNo(`Is "${input}" a real crop name in Tanzania? Answer yes or no.`);
      if (valid) {
        session.crop = input;
        session.step = 'SYMPTOM';
        session.retries = 0;
        reply = session.lang === 'sw' ? `CON Andika dalili kwa ${input}:` : `CON Enter symptom for ${input}:`;
      } else if (++session.retries >= 3) {
        reply = session.lang === 'sw' ? 'END Majaribio yamezidi.' : 'END Too many tries.';
        sessions.delete(sessionId);
      } else {
        reply = session.lang === 'sw' ? 'CON Zao halijatambuliwa, jaribu tena:' : 'CON Unrecognized crop, try again:';
      }
    } else if (session.step === 'ANIMAL') {
      const valid = COMMON_ANIMALS.includes(input.toLowerCase()) ||
        await aiYesNo(`Is "${input}" a real livestock name in Tanzania? Answer yes or no.`);
      if (valid) {
        session.animal = input;
        session.step = 'SYMPTOM';
        session.retries = 0;
        reply = session.lang === 'sw' ? `CON Andika dalili kwa ${input}:` : `CON Enter symptom for ${input}:`;
      } else if (++session.retries >= 3) {
        reply = session.lang === 'sw' ? 'END Majaribio yamezidi.' : 'END Too many tries.';
        sessions.delete(sessionId);
      } else {
        reply = session.lang === 'sw' ? 'CON Mnyama hajatambuliwa, jaribu tena:' : 'CON Unrecognized animal, try again:';
      }
    } else if (session.step === 'SYMPTOM') {
      const subject = session.crop || session.animal;
      const symptomLower = input.toLowerCase();

      // Whitelist check first
      let validSymptom = false;
      if (session.crop) {
        validSymptom = COMMON_CROP_SYMPTOMS.includes(symptomLower);
      } else if (session.animal) {
        validSymptom = COMMON_ANIMAL_SYMPTOMS.includes(symptomLower);
      }

      // If not in whitelist fallback to AI validation
      if (!validSymptom) {
        validSymptom = await aiYesNo(`Is "${input}" a valid symptom for ${subject}? Answer yes or no.`);
      }

      if (validSymptom) {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
        const result = await model.generateContent(`Give a short diagnosis for ${subject} with symptom "${input}".`);
        const diag = result.response.text().trim();

        const smsMessage = session.lang === 'sw'
          ? `UTAMBUZI wa ${subject}:\n${diag}\n\nPiga mtaalamu: ${session.crop ? EXPERT_CONTACTS.crop : EXPERT_CONTACTS.livestock}`
          : `DIAGNOSIS for ${subject}:\n${diag}\n\nCall expert: ${session.crop ? EXPERT_CONTACTS.crop : EXPERT_CONTACTS.livestock}`;

        await sendSms(phoneNumber, smsMessage);

        reply = session.lang === 'sw' ? 'END Utambuzi umetumwa kwa SMS.' : 'END Diagnosis sent via SMS.';
        sessions.delete(sessionId);
      } else if (++session.retries >= 3) {
        reply = session.lang === 'sw' ? 'END Majaribio yamezidi.' : 'END Too many tries.';
        sessions.delete(sessionId);
      } else {
        reply = session.lang === 'sw' ? 'CON Dalili haijatambuliwa, jaribu tena:' : 'CON Unrecognized symptom, try again:';
      }
    }
    sessions.set(sessionId, session);
    res.send(reply);
  } catch (e) {
    console.error('USSD error:', e);
    res.send('END Service unavailable.');
  }
});

app.listen(5050, () => console.log('✅ USSD running on 5050'));
