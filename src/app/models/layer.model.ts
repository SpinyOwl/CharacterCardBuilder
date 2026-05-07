import { DesignElement } from './element.model';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  elements: DesignElement[];
}
