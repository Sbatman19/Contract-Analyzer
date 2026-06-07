require("dotenv").config();
const express = require("express");
const multer = require("multer");
const pdf = require("pdf-parse");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cors = require("cors");
const path = require("path");
const { runContractAnalysis } = require("./src/agents/pipeline");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.static("public"));

// Raw body for Stripe webhooks
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// In-memory session store (replace with Redis/DB in production)
const sessions = new Map();

// ─── STRIPE: Create checkout session ───────────────────────────────────────
app.post("/api/create-checkout", async (req, res) => {
  const { plan, sessionId } = req.body;

  const isSubscription = plan === "monthly";
  const priceId = isSubscription
    ? process.env.STRIPE_MONTHLY_PRICE_ID
    : process.env.STRIPE_SINGLE_REPORT_PRICE_ID;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}&analysis_id=${sessionId}`,
      cancel_url: `${process.env.APP_URL}/?cancelled=true`,
      metadata: { analysisId: sessionId, plan },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Payment setup failed" });
  }
});

// ─── STRIPE: Webhook ────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const analysisId = session.metadata.analysisId;
    const plan = session.metadata.plan;

    if (sessions.has(analysisId)) {
      const analysisSession = sessions.get(analysisId);
      analysisSession.paid = true;
      analysisSession.plan = plan;
      sessions.set(analysisId, analysisSession);
    }
  }

  res.json({ received: true });
});

// ─── UPLOAD & ANALYZE ──────────────────────────────────────────────────────
app.post("/api/analyze", upload.single("contract"), async (req, res) => {
  try {
    let contractText = "";

    if (req.file) {
      // PDF upload
      if (req.file.mimetype === "application/pdf") {
        const pdfData = await pdf(req.file.buffer);
        contractText = pdfData.text;
      } else {
        // Plain text file
        contractText = req.file.buffer.toString("utf-8");
      }
    } else if (req.body.text) {
      contractText = req.body.text;
    } else {
      return res.status(400).json({ error: "No contract provided" });
    }

    if (contractText.trim().length < 100) {
      return res.status(400).json({ error: "Contract text is too short to analyze" });
    }

    // Create analysis session
    const sessionId = `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessions.set(sessionId, { contractText, paid: false, result: null, status: "pending" });

    res.json({ sessionId, charCount: contractText.length });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to process contract" });
  }
});

// ─── RUN ANALYSIS (after payment confirmed) ────────────────────────────────
app.post("/api/run-analysis", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const session = sessions.get(sessionId);

  if (!session.paid) {
    return res.status(403).json({ error: "Payment required" });
  }

  if (session.result) {
    return res.json({ result: session.result });
  }

  // Set up SSE for progress updates
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendProgress = (stage, message) => {
    res.write(`data: ${JSON.stringify({ type: "progress", stage, message })}\n\n`);
  };

  try {
    const result = await runContractAnalysis(session.contractText, sendProgress);
    session.result = result;
    sessions.set(sessionId, session);
    res.write(`data: ${JSON.stringify({ type: "complete", result })}\n\n`);
  } catch (err) {
    console.error("Analysis error:", err);
    res.write(`data: ${JSON.stringify({ type: "error", message: "Analysis failed. Please try again." })}\n\n`);
  }

  res.end();
});

// ─── GET RESULT ────────────────────────────────────────────────────────────
app.get("/api/result/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  if (!sessions.has(sessionId)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const session = sessions.get(sessionId);

  if (!session.paid) {
    return res.status(403).json({ error: "Payment required" });
  }

  if (!session.result) {
    return res.status(202).json({ status: "processing" });
  }

  res.json({ result: session.result });
});

// ─── SUCCESS PAGE ──────────────────────────────────────────────────────────
app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Contract Risk Analyzer running on port ${PORT}`));
