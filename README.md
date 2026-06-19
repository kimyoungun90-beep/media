# 사진·동영상 용량 줄이기 웹앱 v1

사진과 동영상을 외부 서버에 업로드하지 않고 브라우저 안에서 압축한 뒤, 원래 파일명을 유지해 ZIP으로 내려받는 정적 웹앱입니다.

## 주요 기능

- JPG/JPEG/PNG/WebP 사진 일괄 압축
- 고화질 800KB / 균형 400KB / 저용량 200KB / 직접 설정 50~2,000KB
- MP4/MOV/M4V/WebM/AVI 동영상 순차 압축
- 원래 파일명과 확장자 유지
- 사진 100장 또는 압축 결과 약 700MB 단위로 ZIP 자동 분할
- 같은 파일명이 있을 경우 이름은 바꾸지 않고 ZIP 내부의 별도 폴더에 저장
- 모바일 대응 One UI 스타일
- PWA 설치 지원

## 배포 방법

1. ZIP 압축을 풉니다.
2. 압축을 푼 폴더 안의 모든 파일과 폴더를 GitHub 저장소 최상단에 올립니다.
3. GitHub Pages를 사용할 경우 `Settings → Pages → Deploy from a branch → main / root`를 선택합니다.
4. Cloudflare Pages를 사용할 경우 GitHub 저장소를 연결하고 빌드 명령은 비워 두며 출력 디렉터리는 `.`으로 설정합니다.

GitHub에는 ZIP 파일 자체를 올리는 것이 아니라, ZIP을 푼 뒤 `index.html`, `app.js`, `styles.css`, `vendor`, `icons` 등의 내용을 올려야 합니다.

## 동영상 압축 관련

- 동영상이 선택된 경우에만 `ffmpeg.wasm` 코어를 CDN에서 불러옵니다.
- 최초 동영상 압축 시 약 30MB의 엔진 다운로드가 발생할 수 있습니다.
- 선택한 사진과 동영상은 서버로 전송되지 않습니다.
- 모바일에서는 동영상 파일당 500MB 이하를 권장합니다.
- 긴 동영상이나 고해상도 동영상은 PC용 Chrome 또는 Edge가 더 안정적입니다.

## 포함 라이브러리

- JSZip 3.10.1
- @ffmpeg/ffmpeg 0.12.15
- @ffmpeg/util 0.12.2
- 동영상 코어: @ffmpeg/core 0.12.10 (필요할 때 CDN에서 로드)

## 파일 구조

```text
index.html
styles.css
app.js
manifest.json
sw.js
icons/
vendor/
```
