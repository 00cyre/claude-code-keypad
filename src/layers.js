// Works out which layers of the device's keymap this should drive.
//
// Two conditions, both necessary:
//
//   linked   the layer carries `linkedAppId` pointing at a `linkedApps` entry
//            for the Claude desktop app. That is what the Input app sets when
//            you attach a profile to an application, and it is the only honest
//            signal for "this surface is meant for Claude".
//   AG keys  the layer maps KV_OAI_AG* keycodes, without which the firmware
//            will not paint individual keys at all.
//
// Anything else is left strictly alone: a keypad with a gaming profile and a
// work profile should not have its lights rewritten because a chat is idle.

/** Bundle ids for the Claude desktop app. */
export const CLAUDE_BUNDLE_IDS = ["com.anthropic.claudefordesktop", "com.anthropic.claude"];

const looksLikeClaude = (app, ids) => {
  const process = String(app?.process ?? "").toLowerCase();
  if (ids.some((id) => process === id.toLowerCase())) return true;
  // Fall back to a name match so a renamed or newer bundle still resolves.
  return /claude/i.test(app?.process ?? "") || /claude/i.test(app?.name ?? "");
};

/**
 * Surveys a keymap.
 *
 * Returns every layer keyed `"<profileId>/<layerIndex>"`, which layers are
 * linked to Claude, which of those can actually be painted, and enough detail
 * to explain to somebody why their keypad is not lighting up.
 */
export function survey(keymap, { bundleIds = CLAUDE_BUNDLE_IDS } = {}) {
  const apps = (keymap.linkedApps ?? []).filter((app) => looksLikeClaude(app, bundleIds));
  const appIds = new Set(apps.map((app) => app.id));

  const layers = new Map();
  for (const profile of keymap.profiles ?? []) {
    (profile.layers ?? []).forEach((layer, index) => {
      const codes = (layer.layout?.keymap ?? []).flat();
      layers.set(`${profile.id}/${index}`, {
        name: layer.name,
        profile: profile.name,
        agKeys: codes.filter((code) => /^KV_OAI_AG\d\d$/.test(code)).length,
        linkedAppId: layer.linkedAppId,
        linked: layer.linkedAppId !== undefined && appIds.has(layer.linkedAppId),
      });
    });
  }

  const linked = [...layers].filter(([, l]) => l.linked);
  const drivable = linked.filter(([, l]) => l.agKeys > 0);
  return { apps, layers, linked, drivable };
}

/**
 * Turns a survey into the reason it will not work, or null if it will.
 * Written to be read by somebody who has just run `install` and wants to know
 * what to click.
 */
export function explain({ apps, layers, linked, drivable }) {
  if (!apps.length) {
    return [
      "No layer on this keypad is linked to the Claude desktop app, so there is",
      "nothing for this to drive and it would sit idle.",
      "",
      "In the Input app: open the profile you want to use with Claude, and link",
      "it to the Claude application (Work Louder calls this an app-linked",
      "profile). That is what tells the keypad which surface is Claude's.",
    ].join("\n");
  }
  if (!linked.length) {
    return [
      `The Claude app is known to this keypad (${apps.map((a) => a.name || a.process).join(", ")}),`,
      "but no layer is attached to it.",
      "",
      "In the Input app, link the layer you want to use to that application.",
    ].join("\n");
  }
  if (!drivable.length) {
    const where = linked.map(([key, l]) => `${key} (${l.name})`).join(", ");
    return [
      `The Claude-linked layer is ${where}, but it maps no KV_OAI_AG keycodes,`,
      "and the firmware will only colour a key that carries one.",
      "",
      "In the Input app, map the keys you want lit to KV_OAI_AG00 … KV_OAI_AG05.",
      "Those keycodes send no keystroke of their own — that is why the firmware",
      "is willing to colour them — so this sends Cmd+N on the press instead.",
    ].join("\n");
  }
  return null;
}
