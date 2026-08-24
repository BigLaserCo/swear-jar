// App identity for leaderboard provenance.
//
// RELEASE_HASH is stamped by the release step (docs: scripts/release-stamp
// procedure in the README release section): at tag time the operator replaces
// the placeholder with the release commit SHA and appends that SHA to
// scripts/leaderboard/known-releases.json. A dev build keeps the placeholder,
// which the leaderboard treats as UNVERIFIED — that is the honest signal.
//
// This proves PROVENANCE (which build produced a submission), not honesty:
// a local open-source tool cannot prove its user didn't edit their own data.

export const APP_VERSION = "0.1.0";
export const RELEASE_HASH = "0000000000000000000000000000000000000000"; // dev placeholder
