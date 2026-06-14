/**
 * geocode.js — Geocoding via Nominatim (OpenStreetMap)
 *
 * Gratuito, senza API key. Rate limit: 1 req/s — qui va benissimo
 * perché geocodifichiamo solo alla creazione di un viaggio, con cache.
 *
 * Espone anche le utility paese → bandiera emoji / continente.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RoadOfMemories/2.0 (personal travel diary)';

// ─── Country code → continente ─────────────────────────────────────────────

const CONTINENT_GROUPS = {
  'Europa': 'AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  'Asia': 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TM TR TW UZ VN YE',
  'Africa': 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG ZA ZM ZW',
  'Nord America': 'AG AI AW BB BL BM BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  'Sud America': 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  'Oceania': 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS',
};

const CONTINENT_BY_CODE = {};
for (const [continent, codes] of Object.entries(CONTINENT_GROUPS)) {
  for (const code of codes.split(' ')) CONTINENT_BY_CODE[code] = continent;
}

function continentOf(countryCode) {
  return CONTINENT_BY_CODE[String(countryCode || '').toUpperCase()] || null;
}

/** "IT" → 🇮🇹 (regional indicator symbols) */
function flagEmoji(countryCode) {
  const cc = String(countryCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  return String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// ─── Geocoding con cache in memoria ────────────────────────────────────────

const _cache = new Map();
let _lastNominatimAt = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function nominatimGet(params) {
  const wait = Math.max(0, 1100 - (Date.now() - _lastNominatimAt));
  if (wait) await sleep(wait);
  _lastNominatimAt = Date.now();

  const url = `${NOMINATIM}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json();
}

function pickDestName(hit) {
  const a = hit.address || {};
  return a.city || a.town || a.village || a.municipality || a.hamlet
    || a.county || a.state_district || hit.name
    || String(hit.display_name || '').split(',')[0]?.trim() || '';
}

function formatPlaceLabel(hit) {
  const a = hit.address || {};
  const dest = pickDestName(hit);
  const country = a.country || '';
  const region = a.state || a.region || a.island || '';
  const parts = [];
  if (dest) parts.push(dest);
  if (region && region !== dest) parts.push(region);
  if (country) parts.push(country);
  const unique = [...new Set(parts.map(p => String(p).trim()).filter(Boolean))];
  return unique.join(', ') || hit.display_name || '';
}

function mapPlaceHit(hit) {
  const a = hit.address || {};
  const cc = (a.country_code || '').toUpperCase() || null;
  return {
    placeId: hit.place_id,
    label: formatPlaceLabel(hit),
    dest: pickDestName(hit),
    country: a.country || null,
    countryCode: cc,
    lat: Number(hit.lat),
    lon: Number(hit.lon),
  };
}

/**
 * Cerca luoghi o paesi (autocomplete form viaggio).
 * @returns {Promise<Array<{placeId, label, dest, country, lat, lon}>>}
 */
async function searchPlaces(query, { limit = 6, kind = 'place' } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const cacheKey = `${kind}:${q.toLowerCase()}`;
  if (_cache.has(cacheKey)) {
    const cached = _cache.get(cacheKey);
    return Array.isArray(cached) ? cached : [];
  }

  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: String(Math.min(limit, 8)),
      addressdetails: '1',
      'accept-language': 'it',
      q,
    });
    if (kind === 'country') params.set('featuretype', 'country');

    const data = await nominatimGet(params);
    if (!data) {
      _cache.set(cacheKey, []);
      return [];
    }

    const results = data.map(mapPlaceHit).filter(r => r.label);
    _cache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn(`⚠️  Ricerca luoghi fallita per "${query}": ${err.message}`);
    return [];
  }
}

/**
 * Geocodifica una località (es. "Santorini" o "Kyoto, Giappone").
 * @returns {Promise<{lat, lon, country, countryCode, flag, continent} | null>}
 */
async function geocode(query) {
  const key = `geo:${String(query).trim().toLowerCase()}`;
  if (!key || key === 'geo:') return null;
  if (_cache.has(key)) return _cache.get(key);

  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
      'accept-language': 'it',
      q: String(query).trim(),
    });
    const data = await nominatimGet(params);
    if (!data) return null;

    const [hit] = data;
    if (!hit) {
      _cache.set(key, null);
      return null;
    }

    const cc = (hit.address?.country_code || '').toUpperCase() || null;
    const result = {
      lat: Number(hit.lat),
      lon: Number(hit.lon),
      country: hit.address?.country || null,
      countryCode: cc,
      flag: flagEmoji(cc),
      continent: continentOf(cc),
    };
    _cache.set(key, result);
    return result;
  } catch (err) {
    console.warn(`⚠️  Geocoding fallito per "${query}": ${err.message}`);
    return null;
  }
}

module.exports = { geocode, searchPlaces, flagEmoji, continentOf };
