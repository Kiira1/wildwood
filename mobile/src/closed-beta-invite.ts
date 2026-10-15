/**
 * Play requires internal testers to leave that program before joining the
 * closed test. Opening the shared testing page does not change enrollment.
 * Keep asking until the tester confirms they joined; the app cannot verify
 * their Play enrollment. Legacy 'joined' values only meant the link opened,
 * so those testers must see the corrected instructions too.
 */
export const CLOSED_BETA_INVITE = true;
export const CLOSED_BETA_INVITE_KEY = 'wildstat.closed-beta-invite';
const SHOW_DELAY_MS = 4_000;
const CONFIRMED_JOIN = 'confirmed-closed-beta-v2';
export const ANDROID_BETA_GROUP_URL = 'https://groups.google.com/g/wildstat-android-beta';
export const ANDROID_BETA_TEST_URL = 'https://play.google.com/apps/testing/com.wildstatmmo.preview';
export const ANDROID_INTERNAL_TEST_URL = 'https://play.google.com/apps/internaltest/4700797577968294212';

type InviteStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function shouldShowClosedBetaInvite(storage: InviteStorage, enabled = CLOSED_BETA_INVITE) {
  if (!enabled) return false;
  try { return storage.getItem(CLOSED_BETA_INVITE_KEY) !== CONFIRMED_JOIN; } catch { return true; }
}

export function rememberClosedBetaJoin(storage: InviteStorage) {
  try { storage.setItem(CLOSED_BETA_INVITE_KEY, CONFIRMED_JOIN); } catch { /* It asks again next launch. */ }
}

const STYLE = `
#closedBetaInvite { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: #0009; }
#closedBetaInvite[hidden] { display: none; }
#closedBetaInvite .closed-beta-card { display: grid; gap: 12px; width: min(340px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; box-sizing: border-box; padding: 18px 16px 16px; border: 2px solid #090e13; border-radius: 14px; background: #121b24; box-shadow: 0 6px 20px #000a; color: #fff; text-align: center; font-weight: 900; }
#closedBetaInvite h2 { margin: 0; font-size: 18px; }
#closedBetaInvite p { margin: 0; color: #c7d2da; font-size: 14px; line-height: 1.35; font-weight: 700; }
#closedBetaInvite ol { margin: 0; padding-left: 22px; color: #c7d2da; text-align: left; font-size: 14px; line-height: 1.4; font-weight: 700; }
#closedBetaInvite li + li { margin-top: 8px; }
#closedBetaInvite .closed-beta-actions { display: flex; gap: 10px; justify-content: center; }
#closedBetaInvite button { flex: 1 1 0; max-width: 150px; min-height: 44px; padding: 8px 12px; border: 2px solid #18371b; border-radius: 8px; background: linear-gradient(#63ad5c, #347536); box-shadow: 0 3px 0 #18371b; color: #fff; font: inherit; font-size: 15px; }
#closedBetaInvite button.closed-beta-later { border-color: #1d2227; background: linear-gradient(#6d7782, #444c55); box-shadow: 0 3px 0 #1a1e22; }
#closedBetaInvite button.closed-beta-confirm { justify-self: center; max-width: none; }
#closedBetaInvite .closed-beta-step { max-width: none; width: 100%; }
#closedBetaInvite .closed-beta-internal { background: none; border: 0; box-shadow: none; max-width: none; color: #c7d2da; text-decoration: underline; font-size: 13px; }
#closedBetaInvite button:disabled { opacity: .6; }
`;

/** Opening Play leaves the instructions available when the tester returns. */
export function installClosedBetaInvite(openPage: (url: string) => Promise<void>, storage: InviteStorage = localStorage) {
  if (!shouldShowClosedBetaInvite(storage)) return;
  const mount = () => {
    const style = document.createElement('style');
    style.textContent = STYLE;
    const overlay = document.createElement('section');
    overlay.id = 'closedBetaInvite';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'closedBetaInviteTitle');
    overlay.innerHTML = '<div class="closed-beta-card"><h2 id="closedBetaInviteTitle">Join the WildStat closed beta</h2>'
      + '<p>Already joined the closed beta? Tap &ldquo;I\'ve joined&rdquo; below. Otherwise:</p>'
      + '<ol><li>Join the <strong>WildStat Android Beta Google Group</strong> with the same Google account as your phone\'s Play Store. Already a member? Go to step 2.</li>'
      + '<li>Open Google Play below and choose <strong>Become a tester</strong>. Group membership alone does not enroll you in the closed test.</li></ol>'
      + '<p>Previously an internal tester? Open the old internal test below and choose <strong>Leave the program</strong>, then return to step 2. If Play still shows internal testing, allow a few hours and retry. Keep WildStat installed.</p>'
      + '<p>Please play, report bugs, and stay opted in for at least 14 continuous days to help us qualify for public release.</p>'
      + '<p class="closed-beta-status" role="status" hidden></p>'
      + '<button type="button" class="closed-beta-group closed-beta-step">1. Join Google Group</button>'
      + '<button type="button" class="closed-beta-join closed-beta-step">2. Join on Google Play</button>'
      + '<button type="button" class="closed-beta-internal">Former internal tester? Leave the old test</button>'
      + '<div class="closed-beta-actions"><button type="button" class="closed-beta-later">Later</button><button type="button" class="closed-beta-confirm">I\'ve joined the closed beta</button></div></div>';
    const join = overlay.querySelector<HTMLButtonElement>('.closed-beta-join')!;
    const status = overlay.querySelector<HTMLElement>('.closed-beta-status')!;
    const close = () => { overlay.remove(); style.remove(); };
    overlay.querySelector('.closed-beta-later')!.addEventListener('click', close);
    overlay.querySelector('.closed-beta-confirm')!.addEventListener('click', () => {
      rememberClosedBetaJoin(storage);
      close();
    });
    const bindPage = (selector: string, url: string, success: string, failure: string) => {
      const button = overlay.querySelector<HTMLButtonElement>(selector)!;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try { await openPage(url); status.textContent = success; }
        catch { status.textContent = failure; }
        finally { status.hidden = false; button.disabled = false; }
      });
    };
    bindPage('.closed-beta-group', ANDROID_BETA_GROUP_URL,
      'After joining the Group, return here and complete step 2 on Google Play. No Join button? Check your Google account; existing members do not see it.',
      'Could not open Google Groups. Try again later.');
    bindPage('.closed-beta-join', ANDROID_BETA_TEST_URL,
      'After joining the closed test on Google Play, return here and tap “I\'ve joined the closed beta”.',
      'Could not open Google Play. Try again later.');
    bindPage('.closed-beta-internal', ANDROID_INTERNAL_TEST_URL,
      'Leave only the old internal test, then return here and complete step 2. Already in the closed beta? Stay enrolled.',
      'Could not open the old internal test. Try again later.');
    document.head.append(style);
    document.body.append(overlay);
    join.focus();
  };
  const later = () => setTimeout(mount, SHOW_DELAY_MS);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later, { once: true });
  else later();
}
