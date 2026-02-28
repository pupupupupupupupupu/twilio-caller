require("dotenv").config();
const express = require("express");
const fs = require("fs");
const csv = require("csv-parser");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));

const VoiceResponse = twilio.twiml.VoiceResponse;

// In-memory stores
let callers = {}; // normalizedPhone -> caller data
let callState = {}; // CallSid -> { attempts: number }

// --- Normalize phone numbers ---
const normalizeNumber = (num = "") => num.replace(/\D/g, "");

// --- Load Caller Context CSV ---
fs.createReadStream("caller_context.csv")
  .pipe(csv())
  .on("data", (row) => {
    const normalized = normalizeNumber(row.phone_number);
    callers[normalized] = row;
  })
  .on("end", () => {
    console.log("Caller context loaded");
  })
  .on("error", (err) => {
    console.error("CSV Load Error:", err);
  });

// --- Greeting Logic ---
function getGreeting(data) {
  if (!data) {
    return "Hello, thank you for calling. How can I assist you today?";
  }

  const name = data.display_name;

  const category = (data.category || "").trim().toLowerCase();

  switch (category) {
    case "vip":
      return `Good to hear from you, ${name}. How may I assist you today?`;
    case "client":
      return `Hello ${name}, welcome back. How would you like to move your current matter forward today?`;
    case "partner":
      return `Hello ${name}. Is this regarding an active assignment or something new?`;
    default:
      return "Hello, thank you for calling. How can I assist you today?";
  }
}

// --- Helper: Create Gather with Prompt ---
function createSpeechGather(twiml, prompt) {
  twiml.say(prompt);
  twiml.pause({ length: 1 });

  twiml.gather({
    input: "speech",
    action: "/process",
    method: "POST",
    speechTimeout: "auto",
    timeout: 5,
    actionOnEmptyResult: true,
    bargeIn: true,
  });
}

// --- Initialize Call State ---
function initCallState(callSid) {
  if (!callState[callSid]) {
    callState[callSid] = { attempts: 0 };
  }
}

// --- Cleanup Call State ---
function cleanupCallState(callSid) {
  delete callState[callSid];
}

// --- Incoming Call Webhook ---
app.post("/incoming", (req, res) => {
  const callSid = req.body.CallSid;
  const callerRaw = req.body.From || "";
  const caller = normalizeNumber(callerRaw);

  initCallState(callSid);

  const data = callers[caller];
  const twiml = new VoiceResponse();

  createSpeechGather(twiml, getGreeting(data));

  res.type("text/xml").send(twiml.toString());
});

// --- Process Speech ---
app.post("/process", (req, res) => {
  const callSid = req.body.CallSid;
  const speech = (req.body.SpeechResult || "").trim();

  initCallState(callSid);
  const state = callState[callSid];

  const twiml = new VoiceResponse();

  if (!speech) {
    state.attempts += 1;

    if (state.attempts >= 3) {
      twiml.say("I'm sorry, I still can't hear you. Goodbye.");
      twiml.hangup();
      cleanupCallState(callSid);
    } else {
      createSpeechGather(
        twiml,
        "I didn't catch that. Could you please repeat yourself?",
      );
    }
  } else {
    state.attempts = 0;

    twiml.say("I heard you say: " + speech);
    createSpeechGather(twiml, "You can tell me more or ask another question.");
  }

  res.type("text/xml").send(twiml.toString());
});

// --- Start Server ---
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port " + (process.env.PORT || 3000));
});
