# 배너 템플릿 스튜디오

광고 배너를 템플릿으로 만드는 웹 편집기예요.

- `public/index.html` : 편집기 화면
- `netlify/functions/library.mjs` : 팀 공용 라이브러리(상품컷·로고) 저장 기능
- `netlify.toml`, `package.json` : Netlify 설정 (수정하지 않아도 돼요)

Netlify 환경 변수 `TEAM_PASSWORD` 를 정하면, 라이브러리에 올리거나 지울 때 그 비밀번호가 필요해요.

편집기를 고칠 때는 `public/index.html` 파일만 새 파일로 바꿔 올리면 돼요.
