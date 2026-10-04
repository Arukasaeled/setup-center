import { UIPartsGallery } from "../components/uiparts/UIPartsGallery";

/**
 * UI Parts Section Screen
 *
 * Visual parts repository for Setup Center Personal Edition.
 * Serves as the creative workbench for collecting, dissecting,
 * prototyping, and exporting reusable interface parts.
 */
export function UIPartsSection() {
  return (
    <div className="flex-1 w-full h-full overflow-y-auto bg-[#06070a]">
      <UIPartsGallery />
    </div>
  );
}
