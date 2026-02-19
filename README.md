# IPL Prediction Tracker

Vanilla HTML/CSS/JS web app for group match predictions with Firebase Auth + Firestore backend.

Built for Firebase Spark plan (no Cloud Functions required for core flow).

## Features

- Username/password registration and login
- Profile avatar upload (stored as compressed data URL in Firestore)
- Admin fixture management:
  - Create fixtures
  - Finalize winner
  - Mark abandoned (no points awarded)
  - Delete fixture (with prediction cleanup and score rollback)
- Voting lobby showing all member picks in real time
- Vote lock at official match start time
- Live leaderboard (admin excluded)
- Admin-only user removal from gameplay (soft delete)
- Mobile-first UI with bottom navigation
- Installable PWA

## Tech stack

- Vanilla HTML/CSS/JS
- Firebase Auth (Email/Password; usernames mapped to internal email format)
- Cloud Firestore
- Service Worker + Web App Manifest

## Project structure

- `index.html` - app layout and sections
- `style.css` - full styling (desktop + mobile)
- `app.js` - auth, realtime listeners, voting/scoring logic, admin actions
- `firestore.rules` - Firestore security rules
- `firebase-config.js` - local Firebase config (do not commit)
- `firebase-config.example.js` - safe template for Firebase config
- `manifest.json` - PWA manifest
- `service-worker.js` - app-shell caching/offline behavior
- `icons/` - favicon + PWA icons

## Local setup

1. Create a Firebase project.
2. Enable **Authentication > Sign-in method > Email/Password**.
3. Create Firestore database (production mode recommended once rules are applied).
4. Copy config template:

```bash
cp firebase-config.example.js firebase-config.js
```

5. Fill real values in `firebase-config.js`.
6. Publish `firestore.rules` in Firebase Console.
7. Run local static server:

```bash
python3 -m http.server 8080
```

8. Open `http://localhost:8080`.

## First admin setup

1. Register a normal user in the app.
2. In Firestore, open `users/{uid}` for that account.
3. Set:
   - `role: "admin"`
4. Reload the app and log in again.

## Roles and behavior

- `admin`
  - Can create/update/delete fixtures
  - Can finalize winners or mark abandoned
  - Can remove member accounts from gameplay
  - Is excluded from voting lobby and leaderboard
- `member`
  - Can vote on upcoming fixtures
  - Can edit vote until lock time
  - Appears in lobby + leaderboard

## Match lifecycle

1. Admin creates fixture with `startTime`.
2. Status starts as `upcoming` (or `live` if start time is in the past).
3. Members can vote/change vote while `upcoming`.
4. At start time, fixture transitions to `live` and voting locks.
5. Admin marks:
   - Winner -> correct picks get +1 point
   - Abandoned -> no points awarded

## Data model

- `users/{uid}`
  - `username`, `usernameLower`, `role`, `deleted`, `points`, `avatarData`, timestamps
- `matches/{matchId}`
  - `teamA`, `teamB`, `startTime`, `status`, `winner`, `scored`, timestamps
- `predictions/{matchId_uid}`
  - `matchId`, `userId`, `teamName`, `updatedAt`

## Spark-plan limitations

- User removal is a **soft delete** in Firestore only.
- Firebase Auth user still exists after soft delete.
- If you need to reuse the same username, remove that account in Firebase Console:
  - `Authentication > Users`

## Security notes

- `firebase-config.js` should stay local and out of git.
- Firebase web API key is not a secret by itself; enforce security with:
  - strict Firestore rules
  - authorized domains
  - API key referrer restrictions in Google Cloud Console

## PWA notes

- Install prompt appears when browser conditions are met.
- If assets/icons look stale after updates, do a hard refresh (`Cmd/Ctrl + Shift + R`).

## Troubleshooting

- Register button does nothing:
  - Check browser console and Firestore rules deployment
  - Confirm `firebase-config.js` values are correct
- “Username already taken” after deletion:
  - User likely still exists in Firebase Auth (Spark soft-delete limitation)
- Admin tabs disappear until refresh:
  - Usually stale cached JS/CSS; hard refresh and confirm service worker cache version bump
