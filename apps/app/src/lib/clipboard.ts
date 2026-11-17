/**
 * Copy text to the clipboard.
 *
 * The async Clipboard API is only exposed in secure contexts (HTTPS or
 * localhost). The web UI can be opened over plain HTTP on a LAN address, where
 * `navigator.clipboard` is unavailable, so fall back to the legacy
 * `execCommand("copy")` path while the click's user activation is still live.
 *
 * Returns whether the text was copied instead of rejecting so every caller can
 * decide how to surface a failure.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (
      clipboard &&
      typeof clipboard.writeText === "function" &&
      typeof window !== "undefined" &&
      window.isSecureContext !== false
    ) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or the API is unavailable; use the legacy path below.
  }

  return copyTextWithExecCommand(text);
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText =
    "position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.append(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
}
