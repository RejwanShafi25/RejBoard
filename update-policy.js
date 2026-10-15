'use strict';
const RELEASES_URL = 'https://github.com/RejwanShafi25/RejBoard/releases/latest';
function canAutoUpdate({ platform = process.platform, env = process.env, isPackaged = true, macSigned = false } = {}) {
  if (!isPackaged) return { enabled: false, reason: 'development', releasesUrl: RELEASES_URL };
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_DIR
    ? { enabled: false, reason: 'portable', releasesUrl: RELEASES_URL }
    : { enabled: true, reason: 'nsis' };
  if (platform === 'linux') return env.APPIMAGE
    ? { enabled: true, reason: 'appimage' }
    : { enabled: false, reason: 'linux-package', releasesUrl: RELEASES_URL };
  if (platform === 'darwin') return macSigned
    ? { enabled: true, reason: 'signed-mac' }
    : { enabled: false, reason: 'unsigned-mac', releasesUrl: RELEASES_URL };
  return { enabled: false, reason: 'unsupported', releasesUrl: RELEASES_URL };
}
function canInstallNow(activity = {}) {
  return !activity.recording && !activity.lanTransfer && !activity.unsavedChanges;
}
module.exports = { canAutoUpdate, canInstallNow, RELEASES_URL };
