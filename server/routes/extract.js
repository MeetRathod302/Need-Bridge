import { Router } from 'express';
import Groq from 'groq-sdk';

export const extractRouter = Router();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are a resource extraction engine for NeedBridge AI, a B2B humanitarian supply chain platform operating in India. When given unstructured text in any language (Hindi, Marathi, Tamil, Telugu, English or any mix), extract the following fields and return ONLY a valid JSON object — no explanation, no markdown, no preamble.

Required output schema:
{
  "listing_type": "HAVE" | "NEED",
  "category": one of ["food","clothing","medicine","medical","education","shelter","furniture","sanitation","general"],
  "item_name": "normalised English item name, title case",
  "quantity": "number + unit as a string, e.g. '150 blankets' or '20 kg'",
  "condition": "New | Good | Used - Good | Fair | Not Applicable | Unknown",
  "urgency_score": integer 1 to 5 where 5 is life-threatening emergency,
  "language_detected": "en | hi | mr | ta | te | mixed"
}

Urgency scoring guide:
5 — immediate life/health risk, flood/disaster, hospital emergency
4 — urgent but not immediately life-threatening, within 24-48h
3 — needed within a week
2 — needed within a month, no major impact if delayed
1 — surplus donation, flexible timeline

Never guess or hallucinate. If a field cannot be determined, use null.`;

extractRouter.post('/', async (req, res, next) => {
  const { text, lat, lng } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'Provide at least 5 characters of descriptive text.' });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Extract parameters from this resource listing:\n\n"${text.slice(0, 1200)}"` }
      ]
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Groq returned an empty response');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Groq response was not valid JSON');
    }

    res.json({
      extracted: parsed,
      meta: {
        lat: lat ?? null,
        lng: lng ?? null,
        tokens_used: completion.usage?.total_tokens ?? 0,
        model: 'llama3-70b-8192'
      }
    });

  } catch (err) {
    next(err);
  }
});
