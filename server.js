import express from "express";
import cors from "cors";
import "dotenv/config";
import rateLimit from "express-rate-limit";

const app = express();

// ✅ Config
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_KEY = process.env.CLARIFIA_APP_KEY;

// ✅ Basic safety checks
if (!OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in .env");
}
if (!APP_KEY) {
  console.error("❌ Missing CLARIFIA_APP_KEY in .env");
}

// ✅ Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ✅ Rate limit (anti spam)
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests/min per IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ✅ Simple auth middleware (app must send header X-APP-KEY)
function requireAppKey(req, res, next) {
  const key = req.header("X-APP-KEY");
  if (!APP_KEY || key !== APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ✅ Health check (Render)
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ✅ AI Analyze endpoint
app.post("/analyze", requireAppKey, async (req, res) => {
  try {
    const text = (req.body?.text || "").trim();

    if (!text) {
      return res.status(400).json({ error: "Le champ 'text' est requis." });
    }
    if (text.length > 12000) {
      return res.status(400).json({
        error: "Texte trop long (max ~12 000 caractères pour le MVP).",
      });
    }
    if (!OPENAI_API_KEY) {
      return res
        .status(500)
        .json({ error: "Server misconfigured (missing OPENAI_API_KEY)" });
    }

    const instructions = `
Tu es Clarifia, assistant administratif français.
Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans texte autour.

Schéma JSON EXACT :
{
  "summary": "résumé en 2-4 lignes",
  "what_it_means": "ce que l'organisme attend (clair)",
  "deadlines": [{"label":"...", "date":"YYYY-MM-DD ou null", "notes":"..."}],
  "steps": [{"title":"...", "details":"..."}],
  "missing_info": ["..."],
  "risks": ["..."],
  "official_sites": [{"name":"...", "url":"..."}]
}

Règles:
- Si date incertaine: date = null, explique dans notes.
- Français simple, actionnable.
- Ne pas inventer de liens: si doute, mettre service-public.fr.
`.trim();

    const payload = {
      model: "gpt-4o-mini",
      instructions,
      input: text,
      max_output_tokens: 900,
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res
        .status(502)
        .json({ error: "OpenAI request failed", details: errText });
    }

    const data = await r.json();

    // Extract text from Responses API (robust)
    const raw =
      data.output_text ||
      (Array.isArray(data.output)
        ? data.output
            .flatMap((o) => o.content || [])
            .filter((c) => c.type === "output_text" || c.type === "text")
            .map((c) => c.text || "")
            .join("\n")
        : "");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({
        error: "AI did not return valid JSON. Adjust prompt.",
        raw: raw?.slice(0, 2000) || "",
      });
    }

    return res.json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Clarifia backend running on http://localhost:${PORT}`);
});
