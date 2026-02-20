import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  increment,
  runTransaction,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const POLL_MS = 15000;
const USERNAME_MIN = 3;
const USERNAME_MAX = 24;
const PASSWORD_MIN = 6;
const AVATAR_MAX_DATA_URL_CHARS = 200000;
const AVATAR_RENDER_MAX_PX = 256;
const TEAM_LOGO_MAP = {
  CSK: "./assets/CSK.png",
  DC: "./assets/DC.png",
  GT: "./assets/GT.png",
  KKR: "./assets/KKR.png",
  LSG: "./assets/LSG.png",
  MI: "./assets/MI.png",
  PBKS: "./assets/PBKS.png",
  RR: "./assets/RR.png",
  RCB: "./assets/RCB.png",
  SRH: "./assets/SRH.png",
};

const dom = {
  authView: document.querySelector("#auth-view"),
  appView: document.querySelector("#app-view"),
  authError: document.querySelector("#auth-error"),
  loginForm: document.querySelector("#login-form"),
  registerForm: document.querySelector("#register-form"),
  loginUsername: document.querySelector("#login-username"),
  loginPassword: document.querySelector("#login-password"),
  registerUsername: document.querySelector("#register-username"),
  registerPassword: document.querySelector("#register-password"),
  authTabs: document.querySelectorAll("[data-auth-tab]"),
  navButtons: document.querySelectorAll("[data-section]"),
  sectionViews: document.querySelectorAll(".section-view"),
  adminNavBtn: document.querySelector("#admin-nav-btn"),
  adminUsersNavBtn: document.querySelector("#admin-users-nav-btn"),
  installBtn: document.querySelector("#install-btn"),
  logoutBtn: document.querySelector("#logout-btn"),
  settingsInstallBtn: document.querySelector("#settings-install-btn"),
  settingsAdminBtn: document.querySelector("#settings-admin-btn"),
  settingsUsersBtn: document.querySelector("#settings-users-btn"),
  settingsLogoutBtn: document.querySelector("#settings-logout-btn"),
  headerAvatar: document.querySelector("#header-avatar"),
  headerUsername: document.querySelector("#header-username"),
  headerRole: document.querySelector("#header-role"),
  matchesList: document.querySelector("#matches-list"),
  historyList: document.querySelector("#history-list"),
  leaderboardList: document.querySelector("#leaderboard-list"),
  profileForm: document.querySelector("#profile-form"),
  profileUsername: document.querySelector("#profile-username"),
  profilePassword: document.querySelector("#profile-password"),
  profileAvatar: document.querySelector("#profile-avatar"),
  profileAvatarLabel: document.querySelector("#profile-avatar-label"),
  profileAvatarPreview: document.querySelector("#profile-avatar-preview"),
  profilePreviewRow: document.querySelector("#profile-preview-row"),
  createMatchForm: document.querySelector("#create-match-form"),
  teamA: document.querySelector("#team-a"),
  teamB: document.querySelector("#team-b"),
  startTime: document.querySelector("#start-time"),
  adminMatchList: document.querySelector("#admin-match-list"),
  adminUsersList: document.querySelector("#admin-users-list"),
  userProfileModal: document.querySelector("#user-profile-modal"),
  closeProfileBtn: document.querySelector("#close-profile-btn"),
  modalAvatar: document.querySelector("#modal-avatar"),
  modalUsername: document.querySelector("#modal-username"),
  modalRank: document.querySelector("#modal-rank"),
  modalPoints: document.querySelector("#modal-points"),
  statWinrate: document.querySelector("#stat-winrate"),
  statParticipate: document.querySelector("#stat-participate"),
  statStreakCur: document.querySelector("#stat-streak-cur"),
  statStreakMax: document.querySelector("#stat-streak-max"),
  statFavTeam: document.querySelector("#stat-fav-team"),
  statFavSuccess: document.querySelector("#stat-fav-success"),
  statNemesis: document.querySelector("#stat-nemesis"),
  modalHistoryList: document.querySelector("#modal-history-list"),
  appLoading: document.querySelector("#app-loading"),
};

const state = {
  users: [],
  matches: [],
  predictionMap: {},
};

let app = null;
let auth = null;
let db = null;
let currentAuthUser = null;
let currentUserProfile = null;
let pendingAvatarFile = null;
let pendingAvatarPreviewUrl = "";
let unsubscribers = [];
let statusSyncInFlight = false;
let signedOutNotice = "";
let deferredInstallPrompt = null;

bootstrap();

function bootstrap() {
  if (!isFirebaseConfigValid(firebaseConfig)) {
    setAuthError("Firebase config is missing. Update firebase-config.js first.");
    return;
  }

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  bindAuthTabs();
  bindAuthForms();
  bindGlobalActions();
  bindProfileForm();
  bindAdminForm();
  setupPwaInstall();
  registerServiceWorker();

  dom.closeProfileBtn.addEventListener("click", () => {
    dom.userProfileModal.classList.add("hidden");
  });

  renderSignedOut();

  onAuthStateChanged(auth, async (authUser) => {
    currentAuthUser = authUser;

    if (!authUser) {
      stopRealtimeListeners();
      state.users = [];
      state.matches = [];
      state.predictionMap = {};
      currentUserProfile = null;
      renderSignedOut();
      dom.appLoading.classList.add("hidden");
      return;
    }

    try {
      await ensureUserProfile(authUser);
      startRealtimeListeners();
    } catch (error) {
      setAuthError(readableError(error));
    } finally {
      dom.appLoading.classList.add("hidden");
    }
  });

  setInterval(async () => {
    if (!currentAuthUser || !currentUserProfile) {
      return;
    }
    await promoteExpiredMatchesToLive();
    renderMatches();
    if (isAdminUser(currentUserProfile)) {
      renderAdminMatches();
      renderAdminUsers();
    }
  }, POLL_MS);
}

function bindAuthTabs() {
  dom.authTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.authTab;
      dom.authTabs.forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      dom.loginForm.classList.toggle("hidden", tab !== "login");
      dom.registerForm.classList.toggle("hidden", tab !== "register");
      clearAuthError();
    });
  });
}

function bindAuthForms() {
  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthError();

    const username = normalizeUsername(dom.loginUsername.value);
    const password = dom.loginPassword.value;

    const usernameError = validateUsername(username);
    if (usernameError) {
      setAuthError(usernameError);
      return;
    }

    if (!password || password.length < PASSWORD_MIN) {
      setAuthError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }

    try {
      const email = usernameToLoginEmail(username);
      await signInWithEmailAndPassword(auth, email, password);
      dom.loginForm.reset();
    } catch (error) {
      setAuthError(readableError(error));
    }
  });

  dom.registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthError();

    const username = normalizeUsername(dom.registerUsername.value);
    const password = dom.registerPassword.value;

    const usernameError = validateUsername(username);
    if (usernameError) {
      setAuthError(usernameError);
      return;
    }

    if (!password || password.length < PASSWORD_MIN) {
      setAuthError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }

    const email = usernameToLoginEmail(username);

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", credential.user.uid), {
        username,
        usernameLower: username.toLowerCase(),
        role: "member",
        deleted: false,
        points: 0,
        avatarData: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      dom.registerForm.reset();
    } catch (error) {
      setAuthError(readableError(error));
    }
  });
}

function bindGlobalActions() {
  dom.logoutBtn.addEventListener("click", async () => {
    await performLogout();
  });

  dom.settingsLogoutBtn.addEventListener("click", async () => {
    await performLogout();
  });

  dom.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveSection(button.dataset.section);
    });
  });

  dom.settingsAdminBtn.addEventListener("click", () => {
    setActiveSection("admin-section");
  });
  dom.settingsUsersBtn.addEventListener("click", () => {
    setActiveSection("admin-users-section");
  });
}

async function performLogout() {
  try {
    cleanupPendingAvatarPreview();
    await signOut(auth);
  } catch (error) {
    alert(readableError(error));
  }
}

function setupPwaInstall() {
  const actionButtons = [dom.settingsInstallBtn].filter(Boolean);
  const promptButtons = [dom.installBtn].filter(Boolean);
  const allInstallButtons = [...promptButtons, ...actionButtons];
  if (!allInstallButtons.length) {
    return;
  }

  const setPromptButtonsVisible = (visible) => {
    const canShow = visible && !isAdminUser(currentUserProfile);
    promptButtons.forEach((button) => {
      button.classList.toggle("hidden", !canShow);
    });
  };

  actionButtons.forEach((button) => {
    button.classList.remove("hidden");
  });

  const triggerInstall = async () => {
    if (!deferredInstallPrompt) {
      alert("Use your browser menu to install this app.");
      return;
    }

    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch (_error) {
      // ignore prompt errors
    }

    deferredInstallPrompt = null;
    setPromptButtonsVisible(false);
  };

  allInstallButtons.forEach((button) => {
    button.addEventListener("click", triggerInstall);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setPromptButtonsVisible(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    setPromptButtonsVisible(false);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // keep app functional even if SW registration fails
    });
  });
}

function bindProfileForm() {
  dom.profileAvatar.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    pendingAvatarFile = file || null;

    if (pendingAvatarPreviewUrl) {
      URL.revokeObjectURL(pendingAvatarPreviewUrl);
      pendingAvatarPreviewUrl = "";
    }

    if (!pendingAvatarFile) {
      renderProfile(currentUserProfile);
      return;
    }

    pendingAvatarPreviewUrl = URL.createObjectURL(pendingAvatarFile);
    updateAvatarElement(dom.profileAvatarPreview, {
      username: currentUserProfile ? currentUserProfile.username : "User",
      avatarData: pendingAvatarPreviewUrl,
    });
  });

  dom.profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentAuthUser || !currentUserProfile) {
      return;
    }

    try {
      const updates = {
        updatedAt: serverTimestamp(),
      };

      if (pendingAvatarFile && !isAdminUser(currentUserProfile)) {
        const avatarData = await fileToAvatarDataUrl(pendingAvatarFile);
        updates.avatarData = avatarData;
      }

      await updateDoc(doc(db, "users", currentAuthUser.uid), updates);

      const newPassword = dom.profilePassword.value.trim();
      if (newPassword) {
        if (newPassword.length < PASSWORD_MIN) {
          throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
        }
        await updatePassword(currentAuthUser, newPassword);
      }

      cleanupPendingAvatarPreview();
      dom.profileForm.reset();
      renderProfile(currentUserProfile);
      alert("Profile updated.");
    } catch (error) {
      alert(readableError(error));
    }
  });
}

function bindAdminForm() {
  syncTeamSelectAvailability();
  dom.teamA.addEventListener("change", () => {
    syncTeamSelectAvailability("teamA");
  });
  dom.teamB.addEventListener("change", () => {
    syncTeamSelectAvailability("teamB");
  });

  dom.createMatchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isAdminUser(currentUserProfile)) {
      return;
    }

    const teamA = dom.teamA.value.trim();
    const teamB = dom.teamB.value.trim();
    const startRaw = dom.startTime.value;
    const startDate = new Date(startRaw);
    const startMs = startDate.getTime();

    if (!teamA || !teamB) {
      alert("Both team names are required.");
      return;
    }

    if (teamA.toLowerCase() === teamB.toLowerCase()) {
      alert("Team names must be different.");
      return;
    }

    if (Number.isNaN(startMs)) {
      alert("Please provide a valid start time.");
      return;
    }

    try {
      await addDoc(collection(db, "matches"), {
        teamA,
        teamB,
        startTime: Timestamp.fromDate(startDate),
        status: startMs <= Date.now() ? "live" : "upcoming",
        winner: "",
        scored: false,
        createdBy: currentAuthUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      dom.createMatchForm.reset();
      syncTeamSelectAvailability();
    } catch (error) {
      alert(readableError(error));
    }
  });
}

function syncTeamSelectAvailability(changedBy = "") {
  if (!dom.teamA || !dom.teamB) {
    return;
  }

  const selectedA = String(dom.teamA.value || "");
  const selectedB = String(dom.teamB.value || "");

  setTeamOptionAvailability(dom.teamA, selectedB);
  setTeamOptionAvailability(dom.teamB, selectedA);

  if (selectedA && selectedA === selectedB) {
    if (changedBy === "teamA") {
      dom.teamB.value = "";
    } else if (changedBy === "teamB") {
      dom.teamA.value = "";
    }
  }

  setTeamOptionAvailability(dom.teamA, String(dom.teamB.value || ""));
  setTeamOptionAvailability(dom.teamB, String(dom.teamA.value || ""));
}

function setTeamOptionAvailability(selectElement, blockedValue) {
  for (let index = 0; index < selectElement.options.length; index += 1) {
    const option = selectElement.options[index];
    option.disabled = option.value ? option.value === blockedValue : false;
  }
}

async function ensureUserProfile(authUser) {
  const profileRef = doc(db, "users", authUser.uid);
  const snapshot = await getDoc(profileRef);

  if (snapshot.exists()) {
    return;
  }

  const fallbackUsername = fallbackUsernameFromEmail(authUser.email);
  await setDoc(profileRef, {
    username: fallbackUsername,
    usernameLower: fallbackUsername.toLowerCase(),
    role: "member",
    deleted: false,
    points: 0,
    avatarData: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function startRealtimeListeners() {
  stopRealtimeListeners();

  unsubscribers.push(
    onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        state.users = snapshot.docs.map((docSnap) => mapUserDoc(docSnap));
        currentUserProfile = state.users.find((user) => user.id === currentAuthUser.uid) || null;

        if (!currentUserProfile) {
          signedOutNotice = "Your account no longer exists.";
          signOut(auth).catch(() => {
            // no-op
          });
          return;
        }

        if (currentUserProfile && currentUserProfile.deleted) {
          signedOutNotice = "Your account has been removed by admin.";
          signOut(auth).catch(() => {
            // no-op
          });
          return;
        }

        renderApp();
      },
      (error) => {
        alert(readableError(error));
      }
    )
  );

  unsubscribers.push(
    onSnapshot(
      collection(db, "matches"),
      async (snapshot) => {
        state.matches = snapshot.docs.map((docSnap) => mapMatchDoc(docSnap));
        sortMatchesAscending(state.matches);
        renderMatches();
        renderAdminMatches();
        renderAdminUsers();
        await promoteExpiredMatchesToLive();
      },
      (error) => {
        alert(readableError(error));
      }
    )
  );

  unsubscribers.push(
    onSnapshot(
      collection(db, "predictions"),
      (snapshot) => {
        state.predictionMap = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const matchId = String(data.matchId || "");
          const userId = String(data.userId || "");
          const teamName = String(data.teamName || "");
          if (!matchId || !userId) {
            return;
          }
          if (!state.predictionMap[matchId]) {
            state.predictionMap[matchId] = {};
          }
          state.predictionMap[matchId][userId] = teamName;
        });
        renderMatches();
      },
      (error) => {
        alert(readableError(error));
      }
    )
  );
}

function stopRealtimeListeners() {
  unsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch (_error) {
      // no-op
    }
  });
  unsubscribers = [];
}

function renderSignedOut() {
  cleanupPendingAvatarPreview();
  setActiveSection("dashboard-section");
  dom.authView.classList.remove("hidden");
  dom.appView.classList.add("hidden");
  if (signedOutNotice) {
    setAuthError(signedOutNotice);
    signedOutNotice = "";
    return;
  }
  clearAuthError();
}

function renderApp() {
  if (!currentAuthUser || !currentUserProfile) {
    renderSignedOut();
    return;
  }

  if (currentUserProfile.deleted) {
    signedOutNotice = "Your account has been removed by admin.";
    signOut(auth).catch(() => {
      // no-op
    });
    renderSignedOut();
    return;
  }

  dom.authView.classList.add("hidden");
  dom.appView.classList.remove("hidden");

  renderHeader();
  renderMatches();
  renderLeaderboard();
  renderProfile(currentUserProfile);
  renderAdmin(currentUserProfile);

  const activeVisibleButton = [...dom.navButtons].find((btn) => {
    return btn.classList.contains("active") && !btn.classList.contains("hidden");
  });

  if (!activeVisibleButton) {
    setActiveSection("dashboard-section");
    return;
  }

  const requestedSection = activeVisibleButton.dataset.section;
  if (
    !isAdminUser(currentUserProfile) &&
    (requestedSection === "admin-section" || requestedSection === "admin-users-section")
  ) {
    setActiveSection("dashboard-section");
    return;
  }

  setActiveSection(requestedSection);
}

function renderHeader() {
  updateAvatarElement(dom.headerAvatar, currentUserProfile);
  dom.headerUsername.textContent = currentUserProfile.username;
  dom.headerRole.textContent = isAdminUser(currentUserProfile) ? "Administrator" : "Member";
}

function renderMatches() {
  if (!currentUserProfile) {
    return;
  }

  dom.matchesList.innerHTML = "";
  dom.historyList.innerHTML = "";

  const activeMatches = state.matches.filter(m => {
    const status = effectiveStatus(m);
    return status !== "completed" && status !== "completed_no_result";
  });
  const historyMatches = state.matches.filter(m => {
    const status = effectiveStatus(m);
    return status === "completed" || status === "completed_no_result";
  });

  if (!activeMatches.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No active fixtures. Ask admin to create the next match.";
    dom.matchesList.appendChild(empty);
  }

  if (!historyMatches.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No completed matches yet.";
    dom.historyList.appendChild(empty);
  }

  const currentUserIsParticipant = isParticipantUser(currentUserProfile);

  for (const match of state.matches) {
    const matchStatus = effectiveStatus(match);
    const card = document.createElement("article");
    card.className = "match-card";

    const header = document.createElement("div");
    header.className = "match-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "match-title-wrap";
    const winnerCode = matchStatus === "completed" ? normalizeTeamCode(match.winner) : "";
    const title = createMatchTitleElement(match.teamA, match.teamB, winnerCode);
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);
    card.appendChild(header);

    const metaRow = document.createElement("div");
    metaRow.className = "match-meta-row";

    const time = document.createElement("p");
    time.className = "muted tiny match-start-time";
    time.textContent = `Start: ${formatDate(match.startTime)} (${countdownText(match.startTime, matchStatus)})`;
    metaRow.appendChild(time);

    const status = document.createElement("span");
    status.className = `badge ${statusClass(matchStatus)}`;
    status.textContent = statusLabel(matchStatus);
    metaRow.appendChild(status);

    card.appendChild(metaRow);

    if (matchStatus === "completed_no_result") {
      const noResult = document.createElement("p");
      noResult.className = "tiny";
      noResult.textContent = "Result: Match abandoned. No points awarded.";
      card.appendChild(noResult);
    }

    const currentPick = getPrediction(match.id, currentAuthUser.uid);
    const canVote = currentUserIsParticipant && matchStatus === "upcoming";

    if (currentUserIsParticipant) {
      const voteRow = document.createElement("div");
      voteRow.className = "vote-row";

      [match.teamA, match.teamB].forEach((teamName) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "vote-btn";

        if (currentPick === teamName) {
          button.classList.add("selected");
        }

        button.disabled = !canVote;
        button.textContent = teamName;
        button.addEventListener("click", async () => {
          await setPrediction(match.id, teamName);
        });

        voteRow.appendChild(button);
      });
      card.appendChild(voteRow);
    }

    if (currentUserIsParticipant) {
      const voteHelp = document.createElement("p");
      voteHelp.className = "tiny muted";
      if (canVote) {
        voteHelp.textContent = currentPick
          ? `Your pick: ${currentPick} (editable until start time)`
          : "No pick yet. Select a team.";
      } else if (matchStatus === "live") {
        voteHelp.textContent = "Voting is locked because the match is now live.";
      } else {
        voteHelp.textContent = currentPick ? `Final pick: ${currentPick}` : "No pick was submitted.";
      }
      card.appendChild(voteHelp);
    }

    const usersSorted = getParticipantUsers().sort((a, b) => a.username.localeCompare(b.username));
    if (usersSorted.length) {
      const teamACode = normalizeTeamCode(match.teamA);
      const teamBCode = normalizeTeamCode(match.teamB);
      const teamAVoters = [];
      const teamBVoters = [];

      usersSorted.forEach((user) => {
        const pickCode = normalizeTeamCode(getPrediction(match.id, user.id));
        if (pickCode === teamACode) {
          teamAVoters.push(user);
        } else if (pickCode === teamBCode) {
          teamBVoters.push(user);
        }
      });

      const lobbyGrid = document.createElement("div");
      lobbyGrid.className = "lobby-team-grid";
      lobbyGrid.appendChild(createLobbyTeamGroup(teamACode, teamAVoters));
      lobbyGrid.appendChild(createLobbyTeamGroup(teamBCode, teamBVoters));
      card.appendChild(lobbyGrid);
    }

    if (matchStatus === "completed" || matchStatus === "completed_no_result") {
      dom.historyList.appendChild(card);
    } else {
      dom.matchesList.appendChild(card);
    }
  }
}

function renderLeaderboard() {
  dom.leaderboardList.innerHTML = "";

  const usersSorted = getParticipantUsers().sort((a, b) => {
    const scoreDiff = (Number(b.points) || 0) - (Number(a.points) || 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return a.username.localeCompare(b.username);
  });

  if (!usersSorted.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No member accounts to rank yet.";
    dom.leaderboardList.appendChild(empty);
    return;
  }

  usersSorted.forEach((user, index) => {
    const row = document.createElement("div");
    row.className = "leader-row";
    row.style.cursor = "pointer"; // Make it look clickable
    row.addEventListener("click", () => {
      openUserProfileModal(user, index + 1);
    });

    const left = document.createElement("div");
    left.className = "leader-left";

    const rank = document.createElement("span");
    rank.className = "rank-chip";
    rank.textContent = `#${index + 1}`;
    left.appendChild(rank);

    left.appendChild(createAvatarElement(user));

    const name = document.createElement("strong");
    name.textContent = user.username;
    left.appendChild(name);

    const score = document.createElement("span");
    score.className = "score-chip";
    score.textContent = `${Number(user.points) || 0} pts`;

    row.appendChild(left);
    row.appendChild(score);
    dom.leaderboardList.appendChild(row);
  });
}

function renderProfile(user) {
  if (!user) {
    return;
  }

  dom.profileUsername.value = user.username;
  dom.profilePassword.value = "";

  const showAvatarSettings = !isAdminUser(user);
  if (dom.profileAvatarLabel) {
    dom.profileAvatarLabel.classList.toggle("hidden", !showAvatarSettings);
  }
  if (dom.profilePreviewRow) {
    dom.profilePreviewRow.classList.toggle("hidden", !showAvatarSettings);
  }

  if (!showAvatarSettings) {
    cleanupPendingAvatarPreview();
    dom.profileAvatar.value = "";
    return;
  }

  updateAvatarElement(dom.profileAvatarPreview, user);
}

function renderAdmin(user) {
  const showAdmin = isAdminUser(user);
  dom.adminNavBtn.classList.toggle("hidden", !showAdmin);
  dom.adminUsersNavBtn.classList.toggle("hidden", !showAdmin);
  dom.settingsAdminBtn.classList.toggle("hidden", !showAdmin);
  dom.settingsUsersBtn.classList.toggle("hidden", !showAdmin);
  dom.settingsInstallBtn.classList.toggle("hidden", showAdmin);
  if (!showAdmin) {
    return;
  }

  renderAdminMatches();
  renderAdminUsers();
}

function renderAdminMatches() {
  dom.adminMatchList.innerHTML = "";

  if (!isAdminUser(currentUserProfile)) {
    return;
  }

  if (!state.matches.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No matches yet.";
    dom.adminMatchList.appendChild(empty);
    return;
  }

  const descending = [...state.matches].sort((a, b) => getMillis(b.startTime) - getMillis(a.startTime));

  for (const match of descending) {
    const status = effectiveStatus(match);

    const card = document.createElement("div");
    card.className = "admin-match-card";

    const title = document.createElement("strong");
    title.textContent = `${match.teamA} vs ${match.teamB}`;
    card.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "tiny muted";
    meta.textContent = `Start: ${formatDate(match.startTime)} | Status: ${statusLabel(status)}`;
    card.appendChild(meta);

    const actionRow = document.createElement("div");
    actionRow.className = "admin-actions";
    const canFinalize = status === "live";

    if (status === "completed") {
      const done = document.createElement("p");
      done.className = "tiny";
      done.textContent = `Finalized winner: ${match.winner}`;
      card.appendChild(done);
    } else if (status === "completed_no_result") {
      const done = document.createElement("p");
      done.className = "tiny";
      done.textContent = "Marked abandoned. No points awarded.";
      card.appendChild(done);
    } else {
      const winnerA = document.createElement("button");
      winnerA.className = "btn btn-small btn-primary admin-winner-btn";
      winnerA.type = "button";
      winnerA.disabled = !canFinalize;
      winnerA.textContent = `Winner: ${match.teamA}`;
      winnerA.addEventListener("click", async () => {
        await finalizeWinner(match.id, match.teamA);
      });
      actionRow.appendChild(winnerA);

      const winnerB = document.createElement("button");
      winnerB.className = "btn btn-small btn-primary admin-winner-btn";
      winnerB.type = "button";
      winnerB.disabled = !canFinalize;
      winnerB.textContent = `Winner: ${match.teamB}`;
      winnerB.addEventListener("click", async () => {
        await finalizeWinner(match.id, match.teamB);
      });
      actionRow.appendChild(winnerB);

      const abandoned = document.createElement("button");
      abandoned.className = "btn btn-small btn-danger admin-half-btn";
      abandoned.type = "button";
      abandoned.disabled = !canFinalize;
      abandoned.textContent = "Mark as Abandoned";
      abandoned.addEventListener("click", async () => {
        await markAbandoned(match.id);
      });
      actionRow.appendChild(abandoned);
    }

    const deleteFixtureBtn = document.createElement("button");
    deleteFixtureBtn.className = "btn btn-small btn-ghost admin-half-btn";
    deleteFixtureBtn.type = "button";
    deleteFixtureBtn.textContent = "Delete Fixture";
    deleteFixtureBtn.addEventListener("click", async () => {
      await deleteFixture(match.id);
    });
    actionRow.appendChild(deleteFixtureBtn);

    card.appendChild(actionRow);

    if (!canFinalize && status !== "completed" && status !== "completed_no_result") {
      const hint = document.createElement("p");
      hint.className = "tiny muted";
      hint.textContent = "Result actions unlock at match start time.";
      card.appendChild(hint);
    }

    dom.adminMatchList.appendChild(card);
  }
}

function renderAdminUsers() {
  dom.adminUsersList.innerHTML = "";

  if (!isAdminUser(currentUserProfile)) {
    return;
  }

  const removableUsers = state.users
    .filter((user) => !user.deleted && !isAdminUser(user))
    .sort((a, b) => a.username.localeCompare(b.username));

  if (!removableUsers.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No removable member accounts.";
    dom.adminUsersList.appendChild(empty);
    return;
  }

  removableUsers.forEach((user) => {
    const row = document.createElement("div");
    row.className = "admin-user-row";

    const left = document.createElement("div");
    left.className = "admin-user-left";
    left.appendChild(createAvatarElement(user));

    const textWrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = user.username;
    textWrap.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "tiny muted";
    meta.textContent = `${Number(user.points) || 0} points`;
    textWrap.appendChild(meta);

    left.appendChild(textWrap);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-small btn-danger";
    removeBtn.textContent = "Remove Account";
    removeBtn.addEventListener("click", async () => {
      await removeUserAccount(user.id);
    });

    row.appendChild(left);
    row.appendChild(removeBtn);
    dom.adminUsersList.appendChild(row);
  });
}

async function setPrediction(matchId, teamName) {
  if (!currentAuthUser || !isParticipantUser(currentUserProfile)) {
    return;
  }

  const match = state.matches.find((item) => item.id === matchId);
  if (!match) {
    return;
  }

  if (effectiveStatus(match) !== "upcoming") {
    return;
  }

  try {
    const predictionId = `${matchId}_${currentAuthUser.uid}`;
    await setDoc(doc(db, "predictions", predictionId), {
      matchId,
      userId: currentAuthUser.uid,
      teamName,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    alert(readableError(error));
  }
}

function getPrediction(matchId, userId) {
  if (!state.predictionMap[matchId]) {
    return "";
  }
  return state.predictionMap[matchId][userId] || "";
}

async function finalizeWinner(matchId, winningTeam) {
  if (!isAdminUser(currentUserProfile)) {
    return;
  }

  const matchRef = doc(db, "matches", matchId);

  try {
    const winnersSnapshot = await onetimeWinnerPredictions(matchId, winningTeam);
    const winningUserIds = new Set();
    const participantUserIds = new Set(getParticipantUsers().map((user) => user.id));
    winnersSnapshot.forEach((predictionDoc) => {
      const userId = String(predictionDoc.data().userId || "");
      if (userId && participantUserIds.has(userId)) {
        winningUserIds.add(userId);
      }
    });

    await runTransaction(db, async (transaction) => {
      const matchSnap = await transaction.get(matchRef);
      if (!matchSnap.exists()) {
        throw new Error("Match not found.");
      }

      const match = mapMatchDoc(matchSnap);
      const status = effectiveStatus(match);

      if (status !== "live") {
        throw new Error("Result can only be set when the match is live.");
      }

      if (match.status === "completed" || match.status === "completed_no_result" || match.scored) {
        throw new Error("This match is already finalized.");
      }

      transaction.update(matchRef, {
        status: "completed",
        winner: winningTeam,
        scored: true,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      winningUserIds.forEach((userId) => {
        transaction.update(doc(db, "users", userId), {
          points: increment(1),
          updatedAt: serverTimestamp(),
        });
      });
    });
  } catch (error) {
    alert(readableError(error));
  }
}

async function markAbandoned(matchId) {
  if (!isAdminUser(currentUserProfile)) {
    return;
  }

  const matchRef = doc(db, "matches", matchId);

  try {
    await runTransaction(db, async (transaction) => {
      const matchSnap = await transaction.get(matchRef);
      if (!matchSnap.exists()) {
        throw new Error("Match not found.");
      }

      const match = mapMatchDoc(matchSnap);
      const status = effectiveStatus(match);

      if (status !== "live") {
        throw new Error("You can mark abandoned only when the match is live.");
      }

      if (match.status === "completed" || match.status === "completed_no_result" || match.scored) {
        throw new Error("This match is already finalized.");
      }

      transaction.update(matchRef, {
        status: "completed_no_result",
        winner: "",
        scored: true,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    alert(readableError(error));
  }
}

async function deleteFixture(matchId) {
  if (!isAdminUser(currentUserProfile)) {
    return;
  }

  const match = state.matches.find((item) => item.id === matchId);
  if (!match) {
    return;
  }

  const confirmDelete = window.confirm(
    `Delete fixture "${match.teamA} vs ${match.teamB}"? This will remove all predictions for this match.`
  );
  if (!confirmDelete) {
    return;
  }

  try {
    const predictionsQuery = query(collection(db, "predictions"), where("matchId", "==", matchId));
    const predictionsSnapshot = await getDocs(predictionsQuery);

    if (match.status === "completed" && match.scored && match.winner) {
      const participantsById = new Map(getParticipantUsers().map((user) => [user.id, user]));
      const winningUserIds = new Set();

      predictionsSnapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const userId = String(data.userId || "");
        const teamName = String(data.teamName || "");
        if (!userId || teamName !== match.winner) {
          return;
        }
        const user = participantsById.get(userId);
        if (!user || Number(user.points) <= 0) {
          return;
        }
        winningUserIds.add(userId);
      });

      await Promise.all(
        [...winningUserIds].map(async (userId) => {
          await updateDoc(doc(db, "users", userId), {
            points: increment(-1),
            updatedAt: serverTimestamp(),
          });
        })
      );
    }

    const refsToDelete = predictionsSnapshot.docs.map((docSnap) => docSnap.ref);
    refsToDelete.push(doc(db, "matches", matchId));
    await deleteDocRefsInBatches(refsToDelete);
  } catch (error) {
    alert(readableError(error));
  }
}

async function removeUserAccount(userId) {
  if (!isAdminUser(currentUserProfile)) {
    return;
  }

  if (currentAuthUser && userId === currentAuthUser.uid) {
    alert("You cannot remove your own admin account.");
    return;
  }

  const targetUser = state.users.find((user) => user.id === userId);
  if (!targetUser || targetUser.deleted) {
    return;
  }
  if (isAdminUser(targetUser)) {
    alert("You cannot remove another admin account from here.");
    return;
  }

  const confirmDelete = window.confirm(
    `Remove account "${targetUser.username}"? They will be blocked and removed from lobby/leaderboard.`
  );
  if (!confirmDelete) {
    return;
  }

  try {
    await updateDoc(doc(db, "users", userId), {
      deleted: true,
      points: 0,
      avatarData: "",
      updatedAt: serverTimestamp(),
      deletedAt: serverTimestamp(),
      deletedBy: currentAuthUser.uid,
    });

    const predictionsQuery = query(collection(db, "predictions"), where("userId", "==", userId));
    const predictionsSnapshot = await getDocs(predictionsQuery);
    await deleteDocRefsInBatches(predictionsSnapshot.docs.map((docSnap) => docSnap.ref));
  } catch (error) {
    alert(readableError(error));
  }
}

async function deleteDocRefsInBatches(docRefs) {
  if (!docRefs.length) {
    return;
  }

  const batchSize = 400;
  for (let index = 0; index < docRefs.length; index += batchSize) {
    const batch = writeBatch(db);
    const chunk = docRefs.slice(index, index + batchSize);
    chunk.forEach((ref) => {
      batch.delete(ref);
    });
    await batch.commit();
  }
}

async function promoteExpiredMatchesToLive() {
  if (
    !currentUserProfile ||
    !isAdminUser(currentUserProfile) ||
    statusSyncInFlight ||
    !state.matches.length
  ) {
    return;
  }

  const targets = state.matches.filter((match) => {
    return match.status === "upcoming" && Date.now() >= getMillis(match.startTime);
  });

  if (!targets.length) {
    return;
  }

  statusSyncInFlight = true;
  try {
    await Promise.all(
      targets.map(async (match) => {
        try {
          await updateDoc(doc(db, "matches", match.id), {
            status: "live",
            updatedAt: serverTimestamp(),
          });
        } catch (_error) {
          // another admin client may already have updated this doc
        }
      })
    );
  } finally {
    statusSyncInFlight = false;
  }
}

function setActiveSection(sectionId) {
  dom.sectionViews.forEach((section) => {
    section.classList.toggle("hidden", section.id !== sectionId);
  });

  dom.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });
}

function isAdminUser(user) {
  return Boolean(user && user.role === "admin" && !user.deleted);
}

function isParticipantUser(user) {
  return Boolean(user && !user.deleted && user.role !== "admin");
}

function getParticipantUsers() {
  return state.users.filter((user) => isParticipantUser(user));
}

function createAvatarElement(user) {
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  updateAvatarElement(avatar, user);
  return avatar;
}

function updateAvatarElement(container, user) {
  container.innerHTML = "";

  const avatarSrc = user ? (user.avatarData || user.avatarUrl || "") : "";
  if (avatarSrc) {
    const img = document.createElement("img");
    img.src = avatarSrc;
    img.alt = `${user.username || "User"} avatar`;
    container.appendChild(img);
    return;
  }

  container.textContent = initials(user && user.username ? user.username : "?");
}

function mapUserDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    username: String(data.username || "Unknown"),
    usernameLower: String(data.usernameLower || "unknown"),
    role: data.role === "admin" ? "admin" : "member",
    deleted: Boolean(data.deleted),
    points: Number(data.points) || 0,
    avatarData: String(data.avatarData || data.avatarUrl || ""),
  };
}

function mapMatchDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    teamA: String(data.teamA || "TBD"),
    teamB: String(data.teamB || "TBD"),
    startTime: data.startTime || null,
    status: String(data.status || "upcoming"),
    winner: String(data.winner || ""),
    scored: Boolean(data.scored),
  };
}

function sortMatchesAscending(matches) {
  matches.sort((a, b) => getMillis(a.startTime) - getMillis(b.startTime));
}

function effectiveStatus(match) {
  if (match.status === "completed" || match.status === "completed_no_result") {
    return match.status;
  }

  const startMs = getMillis(match.startTime);
  if (Number.isNaN(startMs)) {
    return "upcoming";
  }

  return Date.now() >= startMs ? "live" : "upcoming";
}

function getMillis(dateLike) {
  if (!dateLike) {
    return Number.NaN;
  }
  if (typeof dateLike === "number") {
    return dateLike;
  }
  if (dateLike instanceof Date) {
    return dateLike.getTime();
  }
  if (typeof dateLike.toMillis === "function") {
    return dateLike.toMillis();
  }
  const parsed = new Date(dateLike).getTime();
  return parsed;
}

function formatDate(dateLike) {
  const date = new Date(getMillis(dateLike));
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function countdownText(dateLike, status) {
  if (status !== "upcoming") {
    return status === "live" ? "live now" : "locked";
  }

  const start = getMillis(dateLike);
  if (Number.isNaN(start)) {
    return "unknown time";
  }

  const diff = start - Date.now();
  if (diff <= 0) {
    return "starting now";
  }

  const mins = Math.floor(diff / 60000);
  if (mins < 60) {
    return `${mins}m to lock`;
  }

  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m to lock`;
}

function statusLabel(status) {
  if (status === "upcoming") {
    return "Upcoming";
  }
  if (status === "live") {
    return "Live";
  }
  if (status === "completed") {
    return "Completed";
  }
  return "Completed - No Result";
}

function statusClass(status) {
  if (status === "upcoming") {
    return "upcoming";
  }
  if (status === "live") {
    return "live";
  }
  if (status === "completed") {
    return "completed";
  }
  return "no-result";
}

function createLobbyTeamGroup(teamCode, voters) {
  const group = document.createElement("div");
  group.className = "lobby-team-group";

  const bucket = document.createElement("div");
  bucket.className = "lobby-team-bucket";

  if (!voters.length) {
    bucket.classList.add("lobby-team-bucket-empty");
    const centerLogo = createTeamLogoNode(teamCode);
    centerLogo.classList.add("lobby-team-logo", "lobby-team-logo-center");
    bucket.appendChild(centerLogo);
    group.appendChild(bucket);
    return group;
  }

  const left = document.createElement("div");
  left.className = "lobby-team-left";
  const logoNode = createTeamLogoNode(teamCode);
  logoNode.classList.add("lobby-team-logo");
  left.appendChild(logoNode);
  bucket.appendChild(left);

  const preview = document.createElement("div");
  preview.className = "lobby-team-preview";
  if (voters.length) {
    preview.appendChild(createLobbyAvatarStack(voters, 4));
  }
  bucket.appendChild(preview);

  const count = document.createElement("span");
  count.className = "lobby-team-count-badge";
  count.textContent = String(voters.length);
  bucket.appendChild(count);

  group.appendChild(bucket);
  return group;
}

function createLobbyAvatarStack(voters, limit) {
  const stack = document.createElement("div");
  stack.className = "lobby-avatar-stack";

  const visible = voters.slice(0, limit);
  visible.forEach((user) => {
    const avatar = createAvatarElement(user);
    avatar.classList.add("lobby-stack-avatar");
    avatar.title = user.username;
    stack.appendChild(avatar);
  });

  const overflow = voters.length - visible.length;
  if (overflow > 0) {
    const overflowTag = document.createElement("span");
    overflowTag.className = "lobby-stack-overflow";
    overflowTag.textContent = `+${overflow}`;
    stack.appendChild(overflowTag);
  }

  return stack;
}

function createMatchTitleElement(teamA, teamB, winnerCode = "") {
  const title = document.createElement("h3");
  title.className = "match-title-logos";
  const teamALogo = createTeamLogoNode(teamA);
  if (normalizeTeamCode(teamA) === winnerCode) {
    teamALogo.classList.add("match-winner-halo");
  }
  title.appendChild(teamALogo);

  const versus = document.createElement("span");
  versus.className = "match-vs-text";
  versus.textContent = "vs";
  title.appendChild(versus);

  const teamBLogo = createTeamLogoNode(teamB);
  if (normalizeTeamCode(teamB) === winnerCode) {
    teamBLogo.classList.add("match-winner-halo");
  }
  title.appendChild(teamBLogo);
  return title;
}

function createTeamLogoNode(teamName) {
  const code = normalizeTeamCode(teamName);
  const logoSrc = TEAM_LOGO_MAP[code];

  if (logoSrc) {
    const image = document.createElement("img");
    image.className = "match-team-logo";
    image.src = logoSrc;
    image.alt = `${code} logo`;
    image.title = code;
    image.loading = "lazy";
    image.decoding = "async";
    return image;
  }

  const fallback = document.createElement("span");
  fallback.className = "match-team-fallback";
  fallback.textContent = code || "TBD";
  return fallback;
}

function normalizeTeamCode(teamName) {
  return String(teamName || "").trim().toUpperCase();
}

function validateUsername(username) {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  }
  if (!/[a-zA-Z0-9]/.test(username)) {
    return "Username must include at least one letter or number.";
  }
  return "";
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function usernameToLoginEmail(username) {
  const normalized = normalizeUsername(username).toLowerCase();
  const encoded = base64UrlEncode(normalized);
  return `${encoded}@iplapp.local`;
}

function base64UrlEncode(input) {
  let binary = "";
  if (typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(input);
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
  } else {
    // Fallback for older mobile browsers without TextEncoder.
    binary = encodeURIComponent(String(input || "")).replace(/%([0-9A-F]{2})/g, (_match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  if (typeof TextDecoder !== "undefined") {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // Fallback for older mobile browsers without TextDecoder.
  const percentEncoded = Array.from(binary, (char) => {
    return `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
  }).join("");
  return decodeURIComponent(percentEncoded);
}

function fallbackUsernameFromEmail(email) {
  if (!email || !email.includes("@")) {
    return `user_${Date.now().toString().slice(-6)}`;
  }

  const local = email.split("@")[0];
  try {
    const decoded = base64UrlDecode(local);
    const candidate = normalizeUsername(decoded);
    if (candidate.length >= USERNAME_MIN) {
      return candidate.slice(0, USERNAME_MAX);
    }
  } catch (_error) {
    // ignore decode errors and use fallback
  }

  return `user_${Date.now().toString().slice(-6)}`;
}

async function fileToAvatarDataUrl(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Please upload a valid image file.");
  }

  const srcDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(srcDataUrl);

  const longestSide = Math.max(image.width || 1, image.height || 1);
  const scale = Math.min(1, AVATAR_RENDER_MAX_PX / longestSide);
  const targetWidth = Math.max(1, Math.round((image.width || 1) * scale));
  const targetHeight = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not process avatar image.");
  }
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  let quality = 0.86;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);

  while (dataUrl.length > AVATAR_MAX_DATA_URL_CHARS && quality > 0.32) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  if (dataUrl.length > AVATAR_MAX_DATA_URL_CHARS) {
    throw new Error("Avatar is too large. Use a smaller image.");
  }

  return dataUrl;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read avatar image."));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode avatar image."));
    image.src = dataUrl;
  });
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function setAuthError(message) {
  dom.authError.textContent = String(message || "");
}

function clearAuthError() {
  dom.authError.textContent = "";
}

function cleanupPendingAvatarPreview() {
  pendingAvatarFile = null;
  if (pendingAvatarPreviewUrl) {
    URL.revokeObjectURL(pendingAvatarPreviewUrl);
    pendingAvatarPreviewUrl = "";
  }
}

function isFirebaseConfigValid(config) {
  if (!config || typeof config !== "object") {
    return false;
  }

  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every((key) => {
    const value = String(config[key] || "").trim();
    return value && !value.startsWith("YOUR_");
  });
}

function readableError(error) {
  if (!error) {
    return "Unexpected error.";
  }

  const code = String(error.code || "");

  if (code === "auth/email-already-in-use") {
    return "That username is already taken.";
  }
  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-email"
  ) {
    return "Invalid username or password.";
  }
  if (code === "auth/weak-password") {
    return "Password is too weak. Use at least 6 characters.";
  }
  if (code === "auth/requires-recent-login") {
    return "For password change, log out and log in again first.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized in Firebase Auth. Add your current host to Firebase Auth Authorized domains.";
  }
  if (code === "auth/network-request-failed") {
    return "Network/auth domain issue. If using mobile over LAN, add this host to Firebase Auth Authorized domains and API key referrer allowlist.";
  }
  if (code === "permission-denied") {
    return "Permission denied. Check Firestore rules and admin role.";
  }

  const rawMessage = String(error.message || "");
  if (/api key not valid/i.test(rawMessage) || /requests from referer/i.test(rawMessage)) {
    return "API key restrictions blocked this host. Add your mobile URL (for example http://192.168.x.x:8080) to API key HTTP referrer restrictions.";
  }

  return String(error.message || "Unexpected error.");
}

async function onetimeWinnerPredictions(matchId, winningTeam) {
  const predictionsQuery = query(collection(db, "predictions"), where("matchId", "==", matchId));
  const snapshot = await getDocs(predictionsQuery);
  return snapshot.docs.filter((docSnap) => String(docSnap.data().teamName || "") === winningTeam);
}

// User Profile Analytics Logic
function calculateUserStats(userId) {
  const completedMatches = state.matches
    .filter((m) => effectiveStatus(m) === "completed" || effectiveStatus(m) === "completed_no_result")
    .sort((a, b) => getMillis(a.startTime) - getMillis(b.startTime));

  const stats = {
    totalCompletedMatches: completedMatches.length,
    matchesVoted: 0,
    correctPicks: 0,
    currentStreak: 0,
    longestStreak: 0,
    teamFrequency: {},
    teamSuccess: {},
    teamFailure: {}, // Teams that cost the user points when they played (nemesis logic)
    history: [], // Recent 10 picks
  };

  if (!stats.totalCompletedMatches) return stats;

  let currentStreakCounter = 0;

  for (const match of completedMatches) {
    const pick = getPrediction(match.id, userId);
    const win = pick && match.status === "completed" && pick === match.winner;
    const loss = pick && match.status === "completed" && pick !== match.winner;

    // Add to Recent history (prepend so newest is first)
    if (stats.history.length < 10) {
      stats.history.unshift({ match, pick, win, loss });
    } else {
      // Just keep replacing to keep it O(N) but bounded
      stats.history.pop();
      stats.history.unshift({ match, pick, win, loss });
    }

    if (!pick) {
      currentStreakCounter = 0; // Missing a vote breaks streak
      continue;
    }

    stats.matchesVoted++;

    // team popularity tracking
    stats.teamFrequency[pick] = (stats.teamFrequency[pick] || 0) + 1;
    if (!stats.teamSuccess[pick]) stats.teamSuccess[pick] = 0;

    if (win) {
      stats.correctPicks++;
      currentStreakCounter++;
      stats.teamSuccess[pick]++;
      if (currentStreakCounter > stats.longestStreak) {
        stats.longestStreak = currentStreakCounter;
      }
    } else if (loss) {
      currentStreakCounter = 0;
      // Nemesis logic: The team that won when user lost (so, the team that beat their pick or the team they picked that lost)
      // Let's define Nemesis as: The team that *won* the match when user picked the other team.
      const winningTeamInMatch = match.winner;
      if (winningTeamInMatch) {
        stats.teamFailure[winningTeamInMatch] = (stats.teamFailure[winningTeamInMatch] || 0) + 1;
      }
    } else {
      currentStreakCounter = 0; // abandoned match breaks streak technically
    }
  }

  stats.currentStreak = currentStreakCounter;
  stats.winRate = stats.matchesVoted ? Math.round((stats.correctPicks / stats.matchesVoted) * 100) : 0;
  stats.participation = Math.round((stats.matchesVoted / stats.totalCompletedMatches) * 100);

  // Favorite Team Calc
  let favTeam = "--";
  let maxFreq = 0;
  for (const [team, count] of Object.entries(stats.teamFrequency)) {
    if (count > maxFreq) {
      maxFreq = count;
      favTeam = team;
    }
  }
  stats.favoriteTeam = favTeam;
  stats.favoriteSuccessRate = maxFreq ? Math.round((stats.teamSuccess[favTeam] / maxFreq) * 100) : 0;

  // Nemesis Team Calc
  let nemTeam = "--";
  let maxFail = 0;
  for (const [team, count] of Object.entries(stats.teamFailure)) {
    if (count > maxFail) {
      maxFail = count;
      nemTeam = team;
    }
  }
  stats.nemesisTeam = nemTeam;

  return stats;
}

function openUserProfileModal(user, rank) {
  if (!user) return;
  const stats = calculateUserStats(user.id);

  // Header Setup
  updateAvatarElement(dom.modalAvatar, user);
  dom.modalUsername.textContent = user.username;
  dom.modalRank.textContent = rank ? `#${rank}` : "--";
  dom.modalPoints.textContent = `${user.points} pts`;

  // Core Stats
  dom.statWinrate.textContent = `${stats.winRate}%`;
  dom.statParticipate.textContent = `${stats.participation}%`;
  dom.statStreakCur.textContent = stats.currentStreak;
  dom.statStreakMax.textContent = stats.longestStreak;

  // Behavioral Stats
  dom.statFavTeam.textContent = stats.favoriteTeam === "--" ? "None" : stats.favoriteTeam;
  if (stats.favoriteTeam !== "--") {
    dom.statFavSuccess.textContent = `(${stats.favoriteSuccessRate}% win)`;
  } else {
    dom.statFavSuccess.textContent = "";
  }
  dom.statNemesis.textContent = stats.nemesisTeam;

  // History List Rendering
  dom.modalHistoryList.innerHTML = "";
  if (!stats.history.length) {
    const empty = document.createElement("p");
    empty.className = "muted tiny text-center";
    empty.textContent = "No history available.";
    dom.modalHistoryList.appendChild(empty);
  } else {
    stats.history.forEach(h => {
      const row = document.createElement("div");
      row.className = "mini-pick-row";

      const vs = document.createElement("span");
      vs.textContent = `${h.match.teamA} vs ${h.match.teamB}`;

      const res = document.createElement("span");
      if (!h.pick) {
        res.className = "pick-pending";
        res.textContent = "Missed";
      } else if (h.win) {
        res.className = "pick-won";
        res.textContent = h.pick + " ✓";
      } else if (h.loss) {
        res.className = "pick-lost";
        res.textContent = h.pick + " ✗";
      } else {
        res.className = "pick-pending";
        res.textContent = "Abandoned";
      }

      row.appendChild(vs);
      row.appendChild(res);
      dom.modalHistoryList.appendChild(row);
    });
  }

  dom.userProfileModal.classList.remove("hidden");
}
