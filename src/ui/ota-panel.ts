import { nativeUpdates } from '../app/native-updates';
/** Developer-only controls; normal players use the production feed automatically. */
export function createOtaPanel(root: HTMLElement) {
  const section = document.createElement('section'); section.className = 'balance-group ota-panel'; section.hidden = true;
  section.innerHTML = '<h3>App updates</h3><p class="ota-state"></p><p class="ota-message" role="status"></p><div class="balance-actions"><button type="button" data-action="channel">Use developer channel</button><button type="button" data-action="check">Check for update</button><button type="button" data-action="rollback">Restore installed app</button></div><p>Applies on the next app launch. Your account and saves stay intact.</p>';
  root.append(section);
  let developer = false;
  function render() {
    const api = nativeUpdates(); section.hidden = !developer || !api;
    if (!api) return;
    const s = api.snapshot();
    section.querySelector('.ota-state')!.textContent = `${s.channel === 'developer' ? 'Developer test' : 'Production'} · ${s.current}${s.pending ? ` → ${s.pending}` : ''}`;
    section.querySelector('.ota-message')!.textContent = s.message;
    section.querySelector('[data-action="channel"]')!.textContent = s.channel === 'developer' ? 'Use production channel' : 'Use developer channel';
    section.querySelectorAll('button').forEach(button => button.disabled = s.busy);
  }
  section.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action;
    const api = nativeUpdates(); if (!api || !developer || !action) return;
    const pending = action === 'check' ? api.check(true) : action === 'rollback' ? api.rollback() : api.selectChannel(api.snapshot().channel === 'developer' ? 'production' : 'developer');
    void pending.catch(error => { section.querySelector('.ota-message')!.textContent = error instanceof Error ? error.message : 'Update unavailable.'; });
  });
  window.addEventListener('wildstat:ota-changed', render);
  window.addEventListener('wildstat:ota-available', () => { nativeUpdates()?.setDeveloperAccess(developer); render(); });
  return { setDeveloperAccess(value: boolean) { developer = value; nativeUpdates()?.setDeveloperAccess(value); render(); }, render };
}
