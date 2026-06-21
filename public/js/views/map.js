/**
 * views/map.js — Mappa MapLibre GL (OpenFreeMap / Mapbox opz.) con globo e pin viaggi
 */

import { state, getTrip } from '../state.js';
import { joinParts, monthYear, esc, tripDest, tripCountry } from '../utils.js';
import { openTripPhotosFromMap } from './gallery.js';
import { renderJourneyList } from './journeyList.js';
import { showToast } from '../ui/toast.js';
import { t, formatDays, getLang } from '../i18n.js';
import { warmTripLabels } from '../places.js';

let map = null;
let markers = [];
let mapConfigPromise = null;
let mapReadyPromise = null;
let rawStylePromise = null;
let workerReady = false;
let usingMapbox = false;

const OFM_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const MAPBOX_STYLE = {
  light: 'light-v11',
  dark: 'dark-v11',
};

function mapTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function setMapThemeAttr(theme) {
  const root = document.getElementById('leafletMap');
  if (!root) return;
  root.dataset.mapTheme = theme;
  root.dataset.mapProvider = usingMapbox ? 'mapbox' : 'ofm';
}

function mapsAvailable() {
  return !!window.maplibregl;
}

function ensureWorker() {
  if (workerReady) return;
  try { maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-csp-worker.js'); } catch { /* ok */ }
  workerReady = true;
}

async function fetchMapConfig() {
  if (!mapConfigPromise) {
    mapConfigPromise = fetch('/api/map/config', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { token: '' }))
      .catch(() => ({ token: '' }));
  }
  return mapConfigPromise;
}

function makeMapboxTransform(token) {
  return (url) => {
    if (url.startsWith('mapbox://')) {
      const path = url.slice('mapbox://'.length);
      if (path.startsWith('styles/')) {
        return { url: `https://api.mapbox.com/${path}?access_token=${token}` };
      }
      return { url: `https://api.mapbox.com/v4/${path}.json?secure&access_token=${token}` };
    }
    if (url.includes('api.mapbox.com') && !url.includes('access_token=')) {
      return { url: `${url}${url.includes('?') ? '&' : '?'}access_token=${token}` };
    }
    return { url };
  };
}

async function fetchBaseStyle() {
  if (!rawStylePromise) {
    rawStylePromise = fetch(OFM_STYLE_URL).then(r => {
      if (!r.ok) throw new Error(`style HTTP ${r.status}`);
      return r.json();
    }).catch(err => { rawStylePromise = null; throw err; });
  }
  return JSON.parse(JSON.stringify(await rawStylePromise));
}

function localizeStyle(style, lang) {
  const want = ['get', `name:${lang}`];
  for (const lyr of style.layers || []) {
    const layout = lyr.layout;
    if (!layout || !('text-field' in layout)) continue;
    if (!JSON.stringify(layout['text-field']).includes('name')) continue;
    layout['text-field'] = ['coalesce', want, ['get', 'name:latin'], ['get', 'name']];
  }
  return style;
}

async function resolveBaseStyle(theme, lang) {
  const { token } = await fetchMapConfig();
  if (token) {
    usingMapbox = true;
    return {
      style: `https://api.mapbox.com/styles/v1/mapbox/${MAPBOX_STYLE[theme]}?access_token=${token}`,
      transformRequest: makeMapboxTransform(token),
    };
  }
  usingMapbox = false;
  return { style: localizeStyle(await fetchBaseStyle(), lang) };
}

function applyGlobe() {
  if (!map?.setProjection) return;
  map.setProjection({ type: 'globe' });
  if (map.setRenderWorldCopies) map.setRenderWorldCopies(false);
  if (!map.setFog) return;
  const dark = mapTheme() === 'dark';
  map.setFog(dark ? {
    color: 'rgb(12, 18, 28)',
    'high-color': 'rgb(36, 52, 72)',
    'horizon-blend': 0.04,
    'space-color': 'rgb(8, 12, 20)',
    'star-intensity': 0.35,
  } : {
    color: 'rgb(186, 210, 235)',
    'high-color': 'rgb(160, 196, 228)',
    'horizon-blend': 0.02,
    'space-color': 'rgb(230, 240, 250)',
    'star-intensity': 0,
  });
}

function applyMapLanguage() {
  if (!map) return;
  if (usingMapbox && map.setLanguage) {
    map.setLanguage(getLang());
    return;
  }
  applyBaseStyle();
}

async function applyBaseStyle() {
  if (!map) return;
  const theme = mapTheme();
  setMapThemeAttr(theme);
  try {
    const opts = await resolveBaseStyle(theme, getLang());
    if (!map) return;
    if (opts.transformRequest) map.setTransformRequest(opts.transformRequest);
    else map.setTransformRequest(url => ({ url }));
    map.setStyle(opts.style);
  } catch (err) {
    console.warn('Stile mappa non disponibile:', err);
  }
}

function onStyleReady() {
  applyGlobe();
  applyMapLanguage();
  setMapThemeAttr(mapTheme());
}

function watchMapTheme() {
  if (watchMapTheme._on) return;
  watchMapTheme._on = true;
  new MutationObserver(() => applyBaseStyle()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

function watchMapLang() {
  if (watchMapLang._on) return;
  watchMapLang._on = true;
  window.addEventListener('wf:langchange', () => applyMapLanguage());
}

function tripIndex(trip) {
  return state.trips.findIndex(t => t.id === trip.id);
}

function tripPinNumber(trip) {
  const i = tripIndex(trip);
  return i >= 0 ? String(i + 1).padStart(2, '0') : '—';
}

function hasValidGeo(trip) {
  const lat = Number(trip.lat);
  const lon = Number(trip.lon);
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function spreadCoords(trips) {
  const groups = new Map();
  for (const trip of trips) {
    const lat = Number(trip.lat);
    const lon = Number(trip.lon);
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trip);
  }

  const out = new Map();
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.set(group[0].id, [Number(group[0].lat), Number(group[0].lon)]);
      continue;
    }
    const offset = 0.06;
    group.forEach((trip, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      out.set(trip.id, [
        Number(trip.lat) + offset * Math.cos(angle),
        Number(trip.lon) + offset * Math.sin(angle),
      ]);
    });
  }
  return out;
}

function setMapLegend(key) {
  const txt = document.querySelector('#mapLegendTxt .map-hint-txt');
  if (txt) txt.textContent = t(key);
}

function fitMapToTrips(geoTrips) {
  if (!map) return;
  if (!geoTrips.length) {
    map.easeTo({ center: [10, 20], zoom: 1.4, duration: 0 });
    return;
  }
  if (geoTrips.length === 1) {
    const lat = Number(geoTrips[0].lat);
    const lon = Number(geoTrips[0].lon);
    map.easeTo({ center: [lon, lat], zoom: 8, duration: 0 });
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  geoTrips.forEach(trip => bounds.extend([Number(trip.lon), Number(trip.lat)]));
  map.fitBounds(bounds, { padding: 40, minZoom: 1, maxZoom: 10, duration: 0 });
}

function popupHtml(trip) {
  return `
    <div class="lp-dest">${esc(tripDest(trip))}</div>
    <div class="lp-meta">${esc(joinParts(tripCountry(trip), monthYear(trip), trip.days ? formatDays(trip.days) : null))}</div>
    <button type="button" class="lp-btn" data-trip="${trip.id}">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
      ${t('map.openGallery')}
    </button>`;
}

function bindPopupActions(popup, tripId) {
  popup.on('open', () => {
    popup.getElement()?.querySelector('.lp-btn')?.addEventListener('click', () => {
      map?.getPopup()?.remove();
      openGallery(tripId);
    });
  });
}

function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
}

function addTripMarker(trip, lat, lon) {
  const el = document.createElement('div');
  el.className = 'lf-pin-wrap';
  el.innerHTML = `<div class="lf-pin">${tripPinNumber(trip)}</div>`;

  const popup = new maplibregl.Popup({
    offset: 28,
    maxWidth: '220px',
    className: 'wf-map-popup',
    closeButton: true,
  }).setHTML(popupHtml(trip));

  bindPopupActions(popup, trip.id);

  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([lon, lat])
    .setPopup(popup)
    .addTo(map);

  markers.push(marker);
}

async function ensureMap() {
  if (map) return;
  if (mapReadyPromise) {
    await mapReadyPromise;
    return;
  }

  mapReadyPromise = (async () => {
    if (!mapsAvailable()) return;
    ensureWorker();
    const container = document.getElementById('leafletMap');
    if (!container) return;

    const theme = mapTheme();
    const opts = await resolveBaseStyle(theme, getLang());
    setMapThemeAttr(theme);

    map = new maplibregl.Map({
      container,
      style: opts.style,
      transformRequest: opts.transformRequest,
      center: [10, 20],
      zoom: 1.4,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: false,
      projection: 'globe',
      renderWorldCopies: false,
    });

    map.on('style.load', onStyleReady);
    map.on('load', () => {
      onStyleReady();
      map.resize();
    });

    watchMapTheme();
    watchMapLang();
  })();

  await mapReadyPromise;
}

export function renderMap() {
  const geoTrips = state.trips.filter(hasValidGeo);
  const coords = spreadCoords(geoTrips);

  ensureMap().then(() => {
    if (!map) return;

    clearMarkers();

    geoTrips.forEach(trip => {
      const [lat, lon] = coords.get(trip.id);
      addTripMarker(trip, lat, lon);
    });

    setMapLegend(
      geoTrips.length
        ? 'map.legend'
        : (state.trips.length ? 'map.noGeo' : 'map.addTrip')
    );

    buildRouteList();
    warmTripLabels(geoTrips, { onUpdate: () => renderMap() });

    requestAnimationFrame(() => {
      map.resize();
      fitMapToTrips(geoTrips);
      setTimeout(() => {
        map.resize();
        fitMapToTrips(geoTrips);
      }, 120);
    });
  });
}

async function openGallery(id) {
  const trip = getTrip(id);
  if (!trip) return;
  map?.getPopup()?.remove();
  if (!trip.photoCount) {
    showToast(t('gal.noPhotos'), 'neutral');
    return;
  }
  const ok = await openTripPhotosFromMap(trip, { onClose: () => renderMap() });
  if (!ok) showToast(t('gal.uploadFail'), 'error');
}

function buildRouteList() {
  renderJourneyList(document.getElementById('routeList'), state.trips, {
    onTripClick: trip => {
      if (hasValidGeo(trip) && map) {
        const zoom = Math.max(map.getZoom(), 6);
        map.flyTo({
          center: [Number(trip.lon), Number(trip.lat)],
          zoom,
          duration: 600,
        });
      }
      openGallery(trip.id);
    },
  });
}
