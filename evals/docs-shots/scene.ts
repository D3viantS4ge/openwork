import type { Surface } from "@openwork/cdp";
import type { Stage } from "./stage.ts";

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

/**
 * The acceptance gate for a shot. Every string in `requireText` must be in the
 * page's visible text, no string in `rejectText` may be, and when `route` is
 * set the (decoded) location hash/URL must match. The capture loop re-shoots
 * until the gate passes and two consecutive frames are pixel-identical, so a
 * shipped PNG can never show a loading or mid-animation state.
 */
export interface Gate {
  requireText: string[];
  rejectText?: string[];
  route?: RegExp;
  /** Optional in-page expression that must evaluate to true (DOM-level claims). */
  requireExpression?: string;
}

export interface Scene {
  id: string;
  /** What the shot is for; shows up in the runner log. */
  title: string;
  /** Output path relative to the repository root. */
  out: string;
  viewport?: Viewport;
  /** Drive the app to the target screen and return the surface to capture. */
  run: (stage: Stage) => Promise<Surface>;
  gate: Gate;
}

export const DEFAULT_VIEWPORT: Viewport = { width: 1440, height: 900, deviceScaleFactor: 2 };
