/**
 * views/map.js — Mappa Leaflet con pin dai dati geocodificati
 */

import { state, getTrip } from '../state.js';
import { joinParts, monthYear, esc, tripDest } from '../utils.js';
import { openTripPhotosFromMap } from './gallery.js';
import { renderJourneyList } from './journeyList.js';
import { showToast } from '../ui/toast.js';
import { t, formatDays } from '../i18n.js';

let map = null;
let layer = null;
let baseTileLayer = null;

const TILE = {
  light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
};

function mapTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyBaseTiles() {
  if (!map) return;
  if (baseTileLayer) map.removeLayer(baseTileLayer);
  const theme = mapTheme();
  baseTileLayer = L.tileLayer(TILE[theme], {
    subdomains: theme === 'dark' ? 'abcd' : 'abc',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  const root = document.getElementById('leafletMap');
  if (root) root.dataset.mapTheme = theme;
}

function watchMapTheme() {
  if (watchMapTheme._on) return;
  watchMapTheme._on = true;
  new MutationObserver(() => applyBaseTiles()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
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

/** Separa pin sovrapposti (stessa coordinata arrotondata). */
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
  if (!map || !geoTrips.length) {
    map?.setView([30, 10], 2);
    return;
  }
  if (geoTrips.length === 1) {
    const [lat, lon] = [Number(geoTrips[0].lat), Number(geoTrips[0].lon)];
    map.setView([lat, lon], 8);
    return;
  }
  const bounds = L.latLngBounds(geoTrips.map(t => [Number(t.lat), Number(t.lon)]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
}

export function renderMap() {
  const geoTrips = state.trips.filter(hasValidGeo);
  const coords = spreadCoords(geoTrips);

  if (!map) {
    map = L.map('leafletMap', {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: true,
    });
    map.setView([30, 10], 2);
    applyBaseTiles();
    watchMapTheme();
    layer = L.layerGroup().addTo(map);
  }

  layer.clearLayers();

  if (geoTrips.length) {
    geoTrips.forEach(trip => {
      const [lat, lon] = coords.get(trip.id);
      const icon = L.divIcon({
        className: 'lf-pin-wrap leaflet-div-icon',
        html: `<div class="lf-pin">${tripPinNumber(trip)}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -28],
      });

      const marker = L.marker([lat, lon], { icon }).addTo(layer);
      marker.bindPopup(`
        <div class="lp-dest">${esc(tripDest(trip))}</div>
        <div class="lp-meta">${esc(joinParts(trip.country, monthYear(trip), trip.days ? formatDays(trip.days) : null))}</div>
        <button class="lp-btn" data-trip="${trip.id}">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          ${t('map.openGallery')}
        </button>`, { maxWidth: 220, minWidth: 180 });

      marker.on('popupopen', e => {
        e.popup.getElement().querySelector('.lp-btn')?.addEventListener('click', () => {
          map.closePopup();
          openGallery(trip.id);
        });
      });
    });
  }

  setMapLegend(
    geoTrips.length
      ? 'map.legend'
      : (state.trips.length ? 'map.noGeo' : 'map.addTrip')
  );

  buildRouteList();

  requestAnimationFrame(() => {
    map.invalidateSize();
    fitMapToTrips(geoTrips);
    setTimeout(() => {
      map.invalidateSize();
      fitMapToTrips(geoTrips);
    }, 120);
  });
}

async function openGallery(id) {
  const trip = getTrip(id);
  if (!trip) return;
  map?.closePopup();
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
        map.flyTo([Number(trip.lat), Number(trip.lon)], Math.max(map.getZoom(), 6), { duration: 0.6 });
      }
      openGallery(trip.id);
    },
  });
}
