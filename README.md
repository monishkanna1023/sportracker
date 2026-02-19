# IPL Prediction Tracker (Spark-Friendly + PWA)

This app is built for Firebase **Spark** and works without Firebase Storage buckets or Cloud Functions.

It uses:
- Firebase Auth (username/password mapped to internal email)
- Cloud Firestore (users, matches, predictions, avatar data)
- PWA app shell (manifest + service worker)

## Key features

- Admin fixture creation, result finalization, abandoned handling
- Admin fixture deletion (with prediction cleanup and score rollback)
- Admin member removal from gameplay (soft delete)
- Voting lobby + leaderboard exclude admin accounts
- Mobile-first UI styled in an IPL-inspired blue/orange palette
- Installable PWA

## Setup

1. Configure Firebase web config in `/Users/nishu/Developer/IPLApp/firebase-config.js`.
2. Publish Firestore rules from `/Users/nishu/Developer/IPLApp/firestore.rules`.
3. Run locally:

```bash
cd /Users/nishu/Developer/IPLApp
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080).

## Promote admin

1. Register a user in app.
2. In Firestore `users/{uid}`, set `role` to `admin`.

## PWA files

- `/Users/nishu/Developer/IPLApp/manifest.json`
- `/Users/nishu/Developer/IPLApp/service-worker.js`
- `/Users/nishu/Developer/IPLApp/icons/icon-192.png`
- `/Users/nishu/Developer/IPLApp/icons/icon-512.png`
- `/Users/nishu/Developer/IPLApp/icons/apple-touch-icon.png`

Install options:
- Use the in-app `Install App` button when browser shows install prompt.
- Or use browser menu `Install app` / `Add to Home Screen`.

## Spark plan note (username reuse)

Soft delete removes users from gameplay but does **not** remove Firebase Auth user.
To reuse same username, delete that account in Firebase Console:

`Authentication > Users`

## Firestore schema

- `users/{uid}`: `username`, `usernameLower`, `role`, `deleted`, `points`, `avatarData`, timestamps
- `matches/{matchId}`: `teamA`, `teamB`, `startTime`, `status`, `winner`, `scored`, timestamps
- `predictions/{matchId_uid}`: `matchId`, `userId`, `teamName`, `updatedAt`

## Notes

- Voting lock is enforced by both UI and Firestore rules (`request.time < startTime`).
- Avatar data is compressed in browser and capped by rules.
