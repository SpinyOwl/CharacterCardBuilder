export type ElementBooleanMode = 'additive' | 'subtractive';

export type DesignElementType =
  | 'rectangle'
  | 'circle'
  | 'triangle'
  | 'polygon'
  | 'text'
  | 'gear';

export interface Point {
  x: number;
  y: number;
}

export interface BaseElement {
  id: string;
  layerId: string;
  type: DesignElementType;
  name: string;
  x: number;
  y: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  mode: ElementBooleanMode;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  width: number;
  height: number;
  radius?: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  radius: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface TriangleElement extends BaseElement {
  type: 'triangle';
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface PolygonElement extends BaseElement {
  type: 'polygon';
  points: Point[];
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string | number;
  fill: string;
  align: 'start' | 'middle' | 'end';
}

export interface GearLabel {
  id: string;
  text: string;
  angle: number;
  offsetFromEdge: number;
  rotation: number;
}

export interface GearElement extends BaseElement {
  type: 'gear';
  discRadius: number;
  toothHeight: number;
  teeth: number;
  toothWidth: number;
  toothShape: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  interactive: true;
  currentRotation: number;
  labels?: GearLabel[];
}

export type DesignElement =
  | RectangleElement
  | CircleElement
  | TriangleElement
  | PolygonElement
  | TextElement
  | GearElement;

export function isGearElement(element: DesignElement): element is GearElement {
  return element.type === 'gear';
}

export function isRectangleElement(element: DesignElement): element is RectangleElement {
  return element.type === 'rectangle';
}
