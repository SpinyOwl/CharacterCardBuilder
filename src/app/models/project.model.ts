import { Layer } from './layer.model';

export type AppMode = 'edit' | 'view';

export interface CanvasSettings {
  width: number;
  height: number;
  unit: 'mm';
  backgroundColor?: string;
}

export type PaperSize = 'A6' | 'A5' | 'A4' | 'A3' | 'Letter';
export type PageOrientation = 'portrait' | 'landscape';

export interface PageSetup {
  paperSize: PaperSize;
  orientation: PageOrientation;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  dpi: number;
  showPageBorder: boolean;
}

export interface InteractiveState {
  elementId: string;
  rotation?: number;
}

export interface Project {
  version: 1;
  canvas: CanvasSettings;
  pageSetup?: PageSetup;
  layers: Layer[];
  editor?: {
    selectedLayerId?: string | null;
    selectedElementId?: string | null;
  };
  interactiveState?: InteractiveState[];
}
