# QA Report (Corner Cases)

## Executed checks

1. JavaScript syntax validation:
   - `node --check /Users/nishu/Developer/IPLApp/app.js`
   - `node --check /Users/nishu/Developer/IPLApp/service-worker.js`
2. PWA artifact validation:
   - Manifest JSON parse
   - Icon file format/dimensions check (`192`, `512`, `180`)
   - Local server endpoint checks for `index.html`, `manifest.json`, `service-worker.js`
3. Rules-to-app consistency review:
   - Verified admin cleanup flows need delete permissions on `matches` and `predictions`
   - Updated rules accordingly

## Corner cases found and fixed

1. Admin fixture delete/member cleanup failing due rules:
   - Cause: `allow delete: if false` on `matches` and `predictions`.
   - Fix: set `allow delete: if isAdmin()` for both collections.
2. Admin tab/section visibility mismatch:
   - Cause: render cycle and section toggles could desync active section display.
   - Fix: section visibility now consistently driven by active visible nav tab.
3. Header + lobby avatar/text vertical alignment:
   - Cause: inherited paragraph margins.
   - Fix: targeted margin reset and alignment rules.
4. PWA installation capability missing:
   - Fix: manifest, icons, service worker, install button and prompt handling.

## Manual verification checklist (recommended)

1. Register two member users; verify unique username validation.
2. Promote one user to admin in Firestore and relogin.
3. Admin creates fixture; members vote and change picks before start.
4. Verify lock at match start time.
5. Admin declares winner; verify point allocation.
6. Admin marks abandoned; verify no points are changed.
7. Admin deletes fixture; verify match and related predictions are removed.
8. Admin removes member; verify member disappears from lobby/leaderboard and is signed out.
9. Try registering removed username without deleting Auth user; confirm blocked (expected on Spark).
10. Delete that Auth user in Firebase Authentication; verify username can be reused.
11. On mobile browser, install app via `Install App` button or browser menu.

## Important operational note

After these changes, re-publish `/Users/nishu/Developer/IPLApp/firestore.rules` in Firebase Console before retesting admin delete/removal flows.
