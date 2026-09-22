// 빌드 후 두 가지 처리
//  1. 불필요한 Electron 언어팩(.pak) 제거로 용량 절감 (한국어/영어만 유지)
//  2. ad-hoc 코드 서명 (mac.identity 가 null 이라 electron-builder 가 서명을 건너뛰기 때문)
//     Apple Silicon 은 서명 없는 실행파일을 실행하지 못하고, macOS 가 "손상된 앱"으로
//     간주해 휴지통으로 옮기라고 안내한다. 정식 인증서가 없어도 ad-hoc 서명(-)이면 실행된다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function pruneLocales(appOutDir) {
  const keep = new Set(['en-US.pak', 'ko.pak']);
  const localesDir = path.join(appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;

  let removed = 0;
  let savedBytes = 0;
  for (const f of fs.readdirSync(localesDir)) {
    if (f.endsWith('.pak') && !keep.has(f)) {
      const p = path.join(localesDir, f);
      savedBytes += fs.statSync(p).size;
      fs.unlinkSync(p);
      removed++;
    }
  }
  console.log(`afterPack: 언어팩 ${removed}개 제거 (${(savedBytes / 1024 / 1024).toFixed(1)}MB 절감)`);
}

function codesign(target) {
  execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], { stdio: 'pipe' });
}

// 중첩 바이너리부터 바깥쪽 번들 순서로 서명해야 한다(inside-out).
function adhocSign(appPath) {
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  if (fs.existsSync(frameworks)) {
    const entries = fs.readdirSync(frameworks);

    for (const entry of entries.filter(e => e.endsWith('.framework'))) {
      const versionA = path.join(frameworks, entry, 'Versions', 'A');
      for (const sub of ['Libraries', 'Helpers']) {
        const dir = path.join(versionA, sub);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.json')) continue; // vk_swiftshader_icd.json 등 비실행 파일
          codesign(path.join(dir, f));
        }
      }
      codesign(versionA);
    }

    for (const entry of entries.filter(e => e.endsWith('.app'))) {
      codesign(path.join(frameworks, entry));
    }
  }

  codesign(appPath);
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
  console.log(`afterPack: ad-hoc 서명 완료 (${path.basename(appPath)})`);
}

exports.default = async function afterPack(context) {
  pruneLocales(context.appOutDir);

  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  // universal 빌드의 아키텍처별 중간 산출물(*-temp)은 이후 병합되므로 서명하지 않는다.
  if (context.appOutDir.endsWith('-temp')) return;
  // 정식 인증서가 지정된 경우엔 electron-builder 의 서명에 맡긴다.
  if (context.packager.platformSpecificBuildOptions.identity !== null) return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) return;
  adhocSign(appPath);
};
