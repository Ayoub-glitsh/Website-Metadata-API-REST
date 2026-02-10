import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

// Rate limit (anti-abus)
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 60, // 60 req/min par IP
  })
);

// Petite validation URL
function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Normalise URL (si quelqu’un envoie "example.com")
function normalizeUrl(input) {
  if (!input) return "";
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  return `https://${input}`;
}

function absoluteUrl(base, maybeRelative) {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * GET /metadata?url=https://example.com
 */
app.get("/metadata", async (req, res) => {
  try {
    const raw = req.query.url;
    const url = normalizeUrl(raw);

    if (!isValidHttpUrl(url)) {
      return res.status(400).json({ error: "Invalid url" });
    }

    // Timeout simple
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "MetadataAPI/1.0" },
    });

    clearTimeout(t);

    const html = await response.text();
    const $ = cheerio.load(html);

    const title =
      $("meta[property='og:title']").attr("content") ||
      $("title").first().text() ||
      null;

    const description =
      $("meta[property='og:description']").attr("content") ||
      $("meta[name='description']").attr("content") ||
      null;

    const ogImage = $("meta[property='og:image']").attr("content") || null;

    const favicon =
      $("link[rel='icon']").attr("href") ||
      $("link[rel='shortcut icon']").attr("href") ||
      null;

    const language =
      $("html").attr("lang") ||
      $("meta[property='og:locale']").attr("content") ||
      null;

    res.json({
      url,
      status: response.status,
      title: title?.trim() || null,
      description: description?.trim() || null,
      language,
      ogImage: absoluteUrl(url, ogImage),
      favicon: absoluteUrl(url, favicon),
    });
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? "Timeout while fetching url"
        : "Failed to fetch/parse url";
    res.status(500).json({ error: msg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
