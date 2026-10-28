/* =========================================================
   Firebase 설정값
   - Firebase 콘솔 → 프로젝트 설정 → 내 앱 → SDK 설정 및 구성 에 있는
     firebaseConfig 값을 아래에 붙여 넣으세요.
   - 이 값은 공개되어도 괜찮아요. (데이터 보호는 Firestore 보안 규칙이 담당)
   - 비워 두면(null) 동기화 없이 이 브라우저에만 저장돼요.
   ========================================================= */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDPNJGtRSSRQu76eKKv-hIvqGVFZBgC6Ko",
  authDomain: "work-planner-d14a7.firebaseapp.com",
  projectId: "work-planner-d14a7",
  storageBucket: "work-planner-d14a7.firebasestorage.app",
  messagingSenderId: "368672116818",
  appId: "1:368672116818:web:22c6b73a992fb4bca88f8b",
};

/* 예시)
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "work-planner-xxxx.firebaseapp.com",
  projectId: "work-planner-xxxx",
  storageBucket: "work-planner-xxxx.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
*/

/* 사이트 온라인 주소 (PC 파일로 열었을 때 안내용) */
window.PLANNER_WEB_URL = '';
