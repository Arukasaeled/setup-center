import type { VaultStyleManifest } from "../types";
import { STYLES_PART_A } from "./stylesA";
import { STYLES_PART_B } from "./stylesB";

export const BUNDLED_STYLES: Record<string, VaultStyleManifest> = {
  ...STYLES_PART_A,
  ...STYLES_PART_B,
};
