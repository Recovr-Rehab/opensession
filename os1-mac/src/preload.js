// Exposed to the OS¹ web app. The frontend can feature-detect `window.os1`
// to route its app-badge updates through the dock (navigator.setAppBadge in a
// service worker doesn't reach Electron's dock badge).
const { contextBridge, ipcRenderer } = require("electron");

// Register before the page boots so a deep link that arrives between the first
// paint and React hydration is not lost. The frontend subscribes once its
// client-side router is ready; until then, retain the latest requested route.
const navigationListeners = new Set();
let pendingNavigation = null;
ipcRenderer.on("os1:navigate", (_e, path) => {
  if (navigationListeners.size === 0) {
    pendingNavigation = path;
    return;
  }
  for (const listener of navigationListeners) listener(path);
});

contextBridge.exposeInMainWorld("os1", {
  desktop: true,
  // Capability flag rather than `desktop` alone: the remotely served frontend
  // must stay opaque in older shell builds that do not provide native material.
  materialBackdrop: true,
  setBadge: (count) => ipcRenderer.send("os1:set-badge", Number(count) || 0),
  clearBadge: () => ipcRenderer.send("os1:set-badge", 0),
  navigation: {
    onRequest: (cb) => {
      if (typeof cb !== "function") return () => {};
      navigationListeners.add(cb);
      if (pendingNavigation !== null) {
        const path = pendingNavigation;
        pendingNavigation = null;
        queueMicrotask(() => {
          if (navigationListeners.has(cb)) cb(path);
        });
      }
      return () => navigationListeners.delete(cb);
    },
  },
  // App auto-update (Squirrel.Mac, driven by main.js). `onState(cb)` reports
  // the current state immediately and again on every change, and returns an
  // unsubscribe. States: idle | available (= downloading) | downloaded.
  // `install()` restarts the app into a downloaded update.
  updates: {
    onState: (cb) => {
      const listener = (_e, state) => cb(state);
      ipcRenderer.on("os1:update-state", listener);
      ipcRenderer.invoke("os1:update-state").then(cb).catch(() => {});
      return () => ipcRenderer.removeListener("os1:update-state", listener);
    },
    install: () => ipcRenderer.send("os1:update-install"),
  },
});
