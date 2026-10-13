import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createProfileEditor } from "./profile-editor";
import { autoNameColor } from "./player-identity";
import { NAME_COLORS } from "../../shared/name-colors";
import { PLAYER_GENDER_UNSET, type PlayerGender } from "../../shared/player-gender";

beforeEach(() => {
  const { document } = parseHTML(`<html><body><div id="overlay" hidden>
    <button id="close"></button><button id="picture"></button><button id="pictureButton"></button><span id="preview"></span>
    <form id="form"><input id="input"><button id="save"></button></form>
    <span id="value"></span><div id="colors"></div>
    <div id="genders"><button class="profile-gender-choice" data-gender="1"></button><button class="profile-gender-choice" data-gender="2"></button></div>
    <div id="skins"><button class="profile-skin-tone-choice" data-skin-tone="0"></button><button class="profile-skin-tone-choice" data-skin-tone="1"></button></div>
  </div></body></html>`);
  vi.stubGlobal("document", document);
});
afterEach(() => { vi.unstubAllGlobals(); });

function fixture() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const state = { color: 0, gender: 1 as PlayerGender, skin: 0 };
  const api = {
    localIdentity: () => "abc", localDisplayName: () => "Vis",
    profileIcon: () => 0, paintIcon: vi.fn(), openIconPicker: vi.fn(),
    playerGender: () => state.gender, setGender: vi.fn(async (value: PlayerGender) => { state.gender = value; return { ok: true }; }),
    skinTone: () => state.skin, setSkinTone: vi.fn(async (value: number) => { state.skin = value; return { ok: true }; }),
    nameColor: () => state.color, setNameColor: vi.fn(async (value: number) => { state.color = value; return { ok: true }; }),
    getNameChangeStatus: vi.fn(async () => ({ cost: 0, availableAtMs: 0, serverNowMs: 0, balance: 0 })),
    isNameTaken: () => false, setDisplayName: vi.fn(async () => ({ ok: true })),
    showMessage: vi.fn(), onChanged: vi.fn(),
  };
  const editor = createProfileEditor({
    overlay: $("overlay"), close: $("close"), picture: $("picture"), pictureButton: $("pictureButton"), preview: $("preview"),
    nameForm: $("form"), nameInput: $("input"), saveName: $("save"),
    nameColors: $("colors"), nameColorValue: $("value"), genderChoices: $("genders"), skinChoices: $("skins"),
  }, api);
  const click = (element: Element) => element.dispatchEvent(new document.defaultView!.Event("click", { bubbles: true }));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return { $, api, editor, state, click, settle, colors: () => [...$("colors").querySelectorAll<HTMLButtonElement>("button")] };
}

it("offers Auto and every name color, and shows the name as chat will", () => {
  const f = fixture();
  f.editor.open();
  expect(f.colors().map(button => button.getAttribute("aria-label"))).toEqual(NAME_COLORS.map(entry => entry.name));
  expect(f.colors()[0].getAttribute("aria-pressed")).toBe("true");
  expect(f.$("value").textContent).toBe("Auto");
  expect(f.$("preview").textContent).toContain("Vis");
  expect(f.$("preview").style.color).toBe(autoNameColor("abc"));
});

it("saves a name color on tap and repaints the preview in it", async () => {
  const f = fixture();
  f.editor.open();
  f.click(f.colors()[4]);
  await f.settle();
  expect(f.api.setNameColor).toHaveBeenCalledExactlyOnceWith(4);
  expect(f.colors()[4].getAttribute("aria-pressed")).toBe("true");
  expect(f.$("value").textContent).toBe(NAME_COLORS[4].name);
  expect(f.$("preview").style.color).toBe(NAME_COLORS[4].color);
  expect(f.api.showMessage).toHaveBeenCalledWith("NAME COLOR UPDATED", "#72ef58");
});

it("clears gender when the chosen one is tapped again, and tells the profile", async () => {
  const f = fixture();
  f.editor.open();
  f.click(f.$("genders").querySelector('[data-gender="1"]')!);
  await f.settle();
  expect(f.api.setGender).toHaveBeenCalledWith(PLAYER_GENDER_UNSET);
  expect(f.api.onChanged).toHaveBeenCalledWith({ gender: PLAYER_GENDER_UNSET });
});

it("saves a skin tone, and opens the picture picker from the picture", async () => {
  const f = fixture();
  f.editor.open();
  f.click(f.$("skins").querySelector('[data-skin-tone="1"]')!);
  await f.settle();
  expect(f.api.setSkinTone).toHaveBeenCalledWith(1);
  expect(f.$("skins").querySelector('[data-skin-tone="1"]')!.getAttribute("aria-pressed")).toBe("true");
  f.click(f.$("picture"));
  f.click(f.$("pictureButton"));
  expect(f.api.openIconPicker).toHaveBeenCalledTimes(2);
});

it("closes from Back", () => {
  const f = fixture();
  f.editor.open();
  expect(f.editor.isOpen()).toBe(true);
  f.click(f.$("close"));
  expect(f.editor.isOpen()).toBe(false);
});
