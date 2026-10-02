/**
 * Setup Center — Style Contract
 *
 * Defines the formal specification for any visual design language
 * registered in Setup Center. A Style governs design tokens, component
 * variants, and decorative geometry, while strictly remaining decoupled
 * from backend execution and business logic.
 */

export type StyleId = string;

export interface StylePalette {
  baseBg: string;
  surface: string;
  cardBorder: string;
  accent: string;
  accentSecondary?: string;
  text: string;
}

export interface StyleTokens {
  borderWidth?: string;
  hardShadow?: string;
  borderRadius?: string;
  accentHue?: string;
  fontHeading?: string;
  fontBody?: string;
}

export interface SetupStyle {
  id: StyleId;
  name: string;
  version: string;
  subtitle: string;
  description: string;
  inspiration: string;
  author: string;
  tags: string[];
  palette: StylePalette;
  features: string[];
  tokens?: StyleTokens;
  implemented: boolean;
  designPrinciples?: string[];
  license?: string;
  updatedAt?: string;
}
