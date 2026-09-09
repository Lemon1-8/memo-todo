import type { WindowBounds } from '../shared/types';

const minVisiblePixels = 96;

export function ensureVisibleBounds(
  bounds: WindowBounds,
  workAreas: WindowBounds[],
  fallback: WindowBounds
): WindowBounds {
  const area = chooseWorkArea(bounds, workAreas) ?? chooseWorkArea(fallback, workAreas) ?? workAreas[0];
  if (!area) {
    return normalizeBounds(fallback);
  }

  const width = Math.min(Math.max(Math.round(bounds.width), 320), area.width);
  const height = Math.min(Math.max(Math.round(bounds.height), 360), area.height);

  if (!isSufficientlyVisible({ ...bounds, width, height }, area)) {
    return centerInArea(width, height, area);
  }

  return {
    width,
    height,
    x: clamp(Math.round(bounds.x), area.x, area.x + area.width - width),
    y: clamp(Math.round(bounds.y), area.y, area.y + area.height - height)
  };
}

export function isSameBounds(left: WindowBounds, right: WindowBounds): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function chooseWorkArea(bounds: WindowBounds, workAreas: WindowBounds[]): WindowBounds | undefined {
  return workAreas
    .map((area) => ({ area, score: intersectionArea(bounds, area) }))
    .sort((left, right) => right.score - left.score)[0]?.area;
}

function isSufficientlyVisible(bounds: WindowBounds, area: WindowBounds): boolean {
  const intersection = getIntersection(bounds, area);
  return intersection.width >= minVisiblePixels && intersection.height >= minVisiblePixels;
}

function intersectionArea(bounds: WindowBounds, area: WindowBounds): number {
  const intersection = getIntersection(bounds, area);
  return intersection.width * intersection.height;
}

function getIntersection(left: WindowBounds, right: WindowBounds): Pick<WindowBounds, 'width' | 'height'> {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return { width, height };
}

function centerInArea(width: number, height: number, area: WindowBounds): WindowBounds {
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2)
  };
}

function normalizeBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(320, Math.round(bounds.width)),
    height: Math.max(360, Math.round(bounds.height))
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
