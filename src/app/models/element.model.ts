export type ElementBooleanMode = 'additive' | 'subtractive';

export type DesignElementType =
  | 'rectangle'
  | 'circle'
  | 'triangle'
  | 'polygon'
  | 'text'
  | 'gear'
  | 'group';

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

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  backgroundImage?: string;
}
export interface InteractionConfig {
  rotationPoint?: Point;
  slideAxis?: Point;
}

export interface RectangleElement extends BaseElement, ShapeStyle {
  type: 'rectangle';
  width: number;
  height: number;
  radius?: number;
  interaction?: InteractionConfig;
}

export interface CircleElement extends BaseElement, ShapeStyle {
  type: 'circle';
  radius: number;
  interaction?: InteractionConfig;
}

export interface TriangleElement extends BaseElement, ShapeStyle {
  type: 'triangle';
  width: number;
  height: number;
  interaction?: InteractionConfig;
}

export interface PolygonElement extends BaseElement, ShapeStyle {
  type: 'polygon';
  points: Point[];
  interaction?: InteractionConfig;
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
  fontSize: number;
  fontFamily: string;
  fontWeight: string | number;
  fill: string;
  align: 'start' | 'middle' | 'end';
}

export interface GearElement extends BaseElement, ShapeStyle {
  type: 'gear';
  discRadius: number;
  toothHeight: number;
  teeth: number;
  toothWidth: number;
  toothShape: number;
  centerDotRadius: number;
  centerDotFill: string;
  centerDotStroke: string;
  centerDotStrokeWidth: number;
  interactive: true;
  currentRotation: number;
  labels?: GearLabel[];
  interaction?: InteractionConfig;
}

export interface GroupElement extends BaseElement {
  type: 'group';
  elements: DesignElement[];
}

export type DesignElement =
  | RectangleElement
  | CircleElement
  | TriangleElement
  | PolygonElement
  | TextElement
  | GearElement
  | GroupElement;

export type ShapeElement =
  | RectangleElement
  | CircleElement
  | TriangleElement
  | PolygonElement
  | GearElement;

export function isGearElement(element: DesignElement): element is GearElement {
  return element.type === 'gear';
}

export function isRectangleElement(element: DesignElement): element is RectangleElement {
  return element.type === 'rectangle';
}

export function isGroupElement(element: DesignElement): element is GroupElement {
  return element.type === 'group';
}

export function isShapeElement(element: DesignElement): element is ShapeElement {
  return (
    element.type === 'rectangle' ||
    element.type === 'circle' ||
    element.type === 'triangle' ||
    element.type === 'polygon' ||
    element.type === 'gear'
  );
}
