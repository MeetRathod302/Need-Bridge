import { Router } from 'express';
import { db } from '../db/client.js';
import { haversine } from '../lib/haversine.js';

export const listingsRouter = Router();

listingsRouter.get('/', async (req, res, next) => {
  const { lat, lng, radius_km = 10, category, type } = req.query;

  try {
    let query = db
      .from('listings')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (type && ['HAVE', 'NEED'].includes(type.toUpperCase())) {
      query = query.eq('listing_type', type.toUpperCase());
    }

    const { data, error } = await query.limit(200);
    if (error) throw error;

    let results = data;

    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxKm = parseFloat(radius_km);

      results = data
        .map(row => ({
          ...row,
          distance_km: haversine(userLat, userLng, row.lat, row.lng)
        }))
        .filter(row => row.distance_km <= maxKm)
        .sort((a, b) => a.distance_km - b.distance_km);
    }

    res.json({ listings: results, total: results.length });
  } catch (err) {
    next(err);
  }
});

listingsRouter.post('/', async (req, res, next) => {
  const {
    org_id, org_name, org_type,
    listing_type, category, item_name,
    quantity, condition, urgency_score,
    lat, lng, raw_text
  } = req.body;

  const required = [org_name, org_type, listing_type, category, item_name, lat, lng];
  if (required.some(v => v === undefined || v === null || v === '')) {
    return res.status(400).json({ error: 'Missing required fields: org_name, org_type, listing_type, category, item_name, lat, lng' });
  }

  if (!['HAVE', 'NEED'].includes(listing_type)) {
    return res.status(400).json({ error: 'listing_type must be HAVE or NEED' });
  }

  try {
    const { data, error } = await db
      .from('listings')
      .insert({
        org_id: org_id ?? null,
        org_name,
        org_type,
        listing_type,
        category,
        item_name,
        quantity: quantity ?? null,
        condition: condition ?? null,
        urgency_score: urgency_score ?? 3,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        raw_text: raw_text ?? null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ listing: data });
  } catch (err) {
    next(err);
  }
});

listingsRouter.patch('/:id/status', async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'matched', 'fulfilled', 'expired'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  try {
    const { data, error } = await db
      .from('listings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ listing: data });
  } catch (err) {
    next(err);
  }
});
