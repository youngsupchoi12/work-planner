/* =========================================================
   PC·휴대폰 동기화 (Firebase 구글 로그인 + Firestore)
   - 데이터는 Firestore 의 users/{로그인한 사람 uid} 문서 하나에 저장
   - 일정을 바꾸면 0.6초 뒤 업로드, 다른 기기에서 바뀌면 바로 반영
   - 인터넷이 끊겨도 휴대폰·PC에 임시 저장했다가 연결되면 업로드
   ========================================================= */
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const WP = window.WP;

const Cloud = (window.CloudSync = {
  status: 'loading',   // unconfigured | needs-web | loading | signed-out | syncing | ok | offline | error
  user: null,
  lastSynced: null,
  error: '',
  webUrl: window.PLANNER_WEB_URL || '',
  schedule() {},
  login() {},
  logout() {},
});

function setStatus(s, err = '') {
  Cloud.status = s;
  Cloud.error = err;
  WP.renderAll();
}
const sameAsLocal = (json) => {
  try { return JSON.stringify(WP.normalize(JSON.parse(json))) === JSON.stringify(WP.getState()); }
  catch { return false; }
};

async function start() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg) return setStatus('unconfigured');
  if (location.protocol === 'file:') return setStatus('needs-web');

  let app, auth, fs, A, F;
  try {
    [{ initializeApp: app }, A, F] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const fbApp = app(cfg);
    auth = A.getAuth(fbApp);
    try {
      fs = F.initializeFirestore(fbApp, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
    } catch {
      fs = F.getFirestore(fbApp); // 오프라인 저장을 못 쓰는 브라우저
    }
  } catch (e) {
    console.error(e);
    return setStatus('error', '동기화 기능을 불러오지 못했어요 (인터넷 연결 확인)');
  }

  let unsub = null;
  let ref = null;
  let timer = null;
  let first = true;

  /* ---- 업로드 ---- */
  async function upload() {
    if (!ref) return;
    const json = JSON.stringify(WP.getState());
    if (json.length > 900000) WP.toast('데이터가 너무 커서 동기화가 실패할 수 있어요. 오래된 일정을 정리해 주세요.');
    if (!navigator.onLine) setStatus('offline');
    try {
      await F.setDoc(ref, { data: json, updatedAt: F.serverTimestamp(), device: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'pc' });
      Cloud.lastSynced = new Date();
      setStatus('ok');
    } catch (e) {
      console.error(e);
      setStatus('error', e.code || e.message);
    }
  }
  Cloud.schedule = () => {
    if (!ref || first) return;
    clearTimeout(timer);
    timer = setTimeout(upload, 600);
  };

  /* ---- 로그인 / 로그아웃 ---- */
  Cloud.login = async () => {
    const provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await A.signInWithPopup(auth, provider);
    } catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
        return A.signInWithRedirect(auth, provider);
      }
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      if (e.code === 'auth/unauthorized-domain') {
        return setStatus('error', `이 주소(${location.hostname})가 Firebase 승인된 도메인에 없어요`);
      }
      console.error(e);
      setStatus('error', e.code || e.message);
    }
  };
  Cloud.logout = async () => {
    if (!confirm('로그아웃할까요? 이 기기의 데이터는 남아 있지만 더 이상 동기화되지 않아요.')) return;
    await A.signOut(auth);
    WP.toast('로그아웃했어요');
  };
  A.getRedirectResult(auth).catch((e) => setStatus('error', e.code || e.message));

  /* ---- 로그인 상태가 바뀌면 ---- */
  A.onAuthStateChanged(auth, (user) => {
    if (unsub) { unsub(); unsub = null; }
    clearTimeout(timer);
    Cloud.user = user;
    if (!user) { ref = null; return setStatus('signed-out'); }

    ref = F.doc(fs, 'users', user.uid);
    first = true;
    setStatus('syncing');

    unsub = F.onSnapshot(ref, (snap) => {
      if (snap.metadata.hasPendingWrites) return; // 방금 내가 올린 것

      if (first) {
        first = false;
        if (!snap.exists()) {
          // 처음 로그인: 이 기기의 데이터를 그대로 올림
          if (!WP.isEmpty()) WP.toast('이 기기의 데이터를 온라인에 올렸어요');
          return upload();
        }
        const remote = snap.data().data || '';
        if (!sameAsLocal(remote)) {
          const r = WP.normalize(JSON.parse(remote));
          const useRemote = WP.isEmpty() || confirm(
            '온라인에 저장된 데이터와 이 기기의 데이터가 달라요.\n\n' +
            `[확인] 온라인 데이터 사용 (일정 ${r.events.length}건 · 행사 ${r.projects.length}건)\n` +
            `[취소] 이 기기 데이터로 온라인을 덮어쓰기 (일정 ${WP.getState().events.length}건 · 행사 ${WP.getState().projects.length}건)`);
          if (!useRemote) return upload();
          WP.replaceState(r);
        }
        Cloud.lastSynced = new Date();
        return setStatus('ok');
      }

      // 다른 기기에서 바뀐 내용
      if (snap.exists()) {
        const remote = snap.data().data || '';
        if (!sameAsLocal(remote)) {
          WP.replaceState(JSON.parse(remote));
          WP.toast('다른 기기에서 바뀐 내용을 불러왔어요');
        }
      }
      Cloud.lastSynced = new Date();
      setStatus('ok');
    }, (e) => {
      console.error(e);
      setStatus('error', e.code === 'permission-denied' ? 'Firestore 보안 규칙을 확인해 주세요' : (e.code || e.message));
    });
  });

  window.addEventListener('online', () => { if (Cloud.user && Cloud.status === 'offline') upload(); });
  window.addEventListener('offline', () => { if (Cloud.user) setStatus('offline'); });
}

start();
