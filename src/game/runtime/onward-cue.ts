import { nextMapAfter, onwardCueText } from "../../../shared/onward";

/** Card messages' gold. */
const CUE_COLOR = "#ffd75e";

/**
 * The client's side of Onward (Warden II card): a server move to the map after this one, with the card on, says so
 * in one line. True when it did, so the map change shows the departure shimmer as well.
 */
export function onwardCue(onward: boolean | undefined, from: string, to: string, show: (text: string, color: string) => void) {
  if (!onward || nextMapAfter(from) !== to) return false;
  show(onwardCueText(to), CUE_COLOR);
  return true;
}
