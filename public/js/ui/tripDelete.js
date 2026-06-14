/**
 * ui/tripDelete.js — Conferma ed eliminazione viaggio (+ topic Telegram)
 */

import { openConfirm } from './modal.js';
import * as api from '../api.js';
import { showToast } from './toast.js';
import { reloadTrips } from '../data.js';
import { t } from '../i18n.js';
import { esc } from '../utils.js';

export function confirmDeleteTrip(trip, { onDeleted } = {}) {
  if (!trip) return;

  let message = t('modal.deleteTripMsg', {
    dest: esc(trip.dest),
    photos: trip.photoCount ? t('modal.deleteTripPhotos', { n: trip.photoCount }) : '',
  }) + t('modal.irreversible');

  openConfirm({
    title: t('modal.deleteTrip'),
    message,
    onConfirm: async () => {
      await api.deleteTrip(trip.id);
      api.invalidatePhotoCache(trip.id);
      showToast(t('toast.tripDeleted'), 'neutral');
      await reloadTrips();
      onDeleted?.();
    },
  });
}
