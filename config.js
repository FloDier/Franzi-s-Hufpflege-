/* Online-Speicher (Google Firebase / Firestore).
   Leer lassen (firebase: null) = App läuft nur lokal auf einem Gerät.
   Werte aus der Firebase-Konsole: Projekteinstellungen → Allgemein → „Meine Apps“ → Web-App → SDK-Konfiguration.
   Diese Werte dürfen öffentlich sein – geschützt wird über die Regeln in firestore.rules. */
window.HUFPFLEGE_CONFIG = {
  firebase: null
  // firebase: { apiKey: '…', authDomain: '…', projectId: '…', storageBucket: '…', messagingSenderId: '…', appId: '…' }
};
