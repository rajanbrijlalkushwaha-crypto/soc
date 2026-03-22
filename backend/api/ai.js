const express = require("express");
const router = express.Router();
const { getLatestSnapshot } = require("../AI/getLatestSnapshot");
const { computeDay } = require("../AI/computeDay");
const { brain } = require("../AI/brain");

// POST /api/ai
router.post("/api/ai", async (req, res) => {
  try {
    const q = (req.body.question || "").toLowerCase().trim();
    const userSymbol = req.body.symbol || "NIFTY_50";

    // STEP 1: fetch latest daily snapshot
    const latest = await getLatestSnapshot(userSymbol);
    if (!latest) {
      return res.json({ status: "NO_DATA", text: "Data not available yet" });
    }

    // STEP 2: load full day data (all snapshots for that expiry)
    const day = await computeDay(latest.symbol, latest.expiry, latest.date);

    // STEP 3: AI answer
    const answer = await brain({
      question: q,
      latest,
      day,
      mode: "teacher",
      voice: "female"
    });

    return res.json({
      status: "OK",
      text: answer.text,
      voice: answer.voice || answer.text,
      meta: answer.meta || {}
    });

  } catch (err) {
    console.log("AI_ERROR:", err);
    res.json({ status: "ERROR", error: err.message });
  }
});

module.exports = router;
