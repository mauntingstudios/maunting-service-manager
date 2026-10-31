/**
 * Die lokalen Event-Assets. Sie liegen in `frontend/public/season` und damit
 * in allen drei Builds (Web, Pontis, MSS). Die Standard-Logos bleiben
 * unangetastet; diese Dateien kommen nur zum Zug, wenn `data-season` aktiv ist.
 */
export const SEASON_ASSETS = {
  halloween: {
    logoMsm: '/season/halloween-logo-msm.png',
    logoPontis: '/season/halloween-logo-pontis.png',
    hintergrund: '/season/halloween-hintergrund.png',
  },
  christmas: {
    logoMsm: '/season/christmas-logo-msm.png',
    logoPontis: '/season/christmas-logo-pontis.png',
    hintergrund: '/season/christmas-hintergrund.png',
  },
} as const
