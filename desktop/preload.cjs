'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const initialStatus = ipcRenderer.sendSync('steam:get-status') || {
  isSteam: false,
  appId: 480,
  overlayActive: false,
};

let overlayActive = Boolean(initialStatus.overlayActive);
const overlayListeners = new Set();

ipcRenderer.on('steam:overlay-changed', (_event, active) => {
  overlayActive = Boolean(active);
  for (const listener of overlayListeners) {
    try {
      listener(overlayActive);
    } catch {
      // ignore listener errors
    }
  }
});

contextBridge.exposeInMainWorld('skyholdSteam', {
  isSteam: Boolean(initialStatus.isSteam),
  appId: Number(initialStatus.appId) || 480,
  unlockAchievement(id) {
    return ipcRenderer.invoke('steam:unlock-achievement', String(id ?? ''));
  },
  cloudRead(slot) {
    return ipcRenderer.invoke('steam:cloud-read', String(slot ?? ''));
  },
  cloudWrite(slot, json) {
    return ipcRenderer.invoke('steam:cloud-write', String(slot ?? ''), String(json ?? ''));
  },
  getOverlayActive() {
    return overlayActive;
  },
  onOverlayChange(listener) {
    if (typeof listener !== 'function') return () => {};
    overlayListeners.add(listener);
    return () => {
      overlayListeners.delete(listener);
    };
  },
});
