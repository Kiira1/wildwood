/** Socket setup may run early; entering the world still requires this admission. */
export function createMapAdmissionGate(ready: boolean) {
  let settle!: (admitted: boolean) => void;
  const result = new Promise<boolean>(resolve => { settle = resolve; });
  if (ready) settle(true);
  return {
    wait: () => result,
    admit: () => settle(true),
    cancel: () => settle(false),
  };
}
