import { Router } from 'express';
import Groq from 'groq-sdk';
import { db } from '../db/client.js';
import { haversine } from '../lib/haversine.js';

export const matchRouter = Router();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MATCH_PROMPT = `You are a resource compatibility analyst for a humanitarian supply chain. Given a NEED listing and a HAVE listing, determine if they are compatible and score the match.

Return ONLY valid JSON with this schema:
{
  "score": integer 0-100,
  "compatible": boolean,
  "reason": "one sentence explanation in English",
  "blocking_issues": ["list of specific reasons why they might NOT match, or empty array"]
}

Score guide:
90-100: Perfect match — same item, sufficient quantity, appropriate condition
70-89: Good match — same category, close item, minor condition or quantity gaps
50-69: Partial match — related items that could partially fulfil the need
0-49: Poor match — different categories or fundamentally incompatible`;

matchRouter.post('/scan', async (req, res, next) => {
  const { listing_id, lat, lng, radius_km = 10 } = req.body;

  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });

  try {
    const { data: source, error: srcErr } = await db
      .from('listings')
      .select('*')
      .eq('id', listing_id)
      .eq('status', 'active')
      .single();

    if (srcErr || !source) return res.status(404).json({ error: 'Listing not found or inactive' });

    const inverseType = source.listing_type === 'NEED' ? 'HAVE' : 'NEED';

    const { data: candidates, error: candErr } = await db
      .from('listings')
      .select('*')
      .eq('listing_type', inverseType)
      .eq('category', source.category)
      .eq('status', 'active')
      .neq('id', listing_id)
      .limit(20);

    if (candErr) throw candErr;

    const userLat = parseFloat(lat ?? source.lat);
    const userLng = parseFloat(lng ?? source.lng);
    const maxKm = parseFloat(radius_km);

    const nearby = candidates
      .map(c => ({ ...c, distance_km: haversine(userLat, userLng, c.lat, c.lng) }))
      .filter(c => c.distance_km <= maxKm)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 8);

    const scored = await Promise.all(nearby.map(async candidate => {
      const prompt = `
NEED listing: "${source.item_name}" — qty: ${source.quantity ?? 'unspecified'}, urgency: ${source.urgency_score}/5
HAVE listing: "${candidate.item_name}" — qty: ${candidate.quantity ?? 'unspecified'}, condition: ${candidate.condition ?? 'unknown'}
Category: ${source.category}`;

      try {
        const completion = await groq.chat.completions.create({
          model: 'llama3-70b-8192',
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 200,
          messages: [
            { role: 'system', content: MATCH_PROMPT },
            { role: 'user', content: prompt }
          ]
        });

        const result = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
        return { ...candidate, match_score: result.score ?? 0, compatible: result.compatible ?? false, match_reason: result.reason ?? '' };
      } catch {
        return { ...candidate, match_score: 0, compatible: false, match_reason: 'Scoring unavailable' };
      }
    }));

    const qualified = scored.filter(c => c.match_score >= 80);

    if (qualified.length > 0) {
      const matchInserts = qualified.map(c => ({
        source_listing_id: listing_id,
        target_listing_id: c.id,
        score: c.match_score,
        distance_km: c.distance_km,
        status: 'pending'
      }));

      await db.from('matches').upsert(matchInserts, { onConflict: 'source_listing_id,target_listing_id' });
    }

    res.json({
      source_listing_id: listing_id,
      candidates_scanned: nearby.length,
      matches_found: qualified.length,
      results: scored
        .sort((a, b) => b.match_score - a.match_score)
        .map(c => ({
          id: c.id,
          org_name: c.org_name,
          org_type: c.org_type,
          item_name: c.item_name,
          quantity: c.quantity,
          condition: c.condition,
          distance_km: parseFloat(c.distance_km.toFixed(2)),
          match_score: c.match_score,
          compatible: c.compatible,
          match_reason: c.match_reason
        }))
    });

  } catch (err) {
    next(err);
  }
});
