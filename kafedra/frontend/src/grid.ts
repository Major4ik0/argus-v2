import { AG_GRID_LOCALE_RU_RU } from "@ag-grid-community/locale";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export const gridTheme = themeQuartz.withParams({
  spacing: 4,
  fontSize: 13,
  headerFontSize: 12,
  wrapperBorderRadius: 6,
});

export const gridLocale = AG_GRID_LOCALE_RU_RU;
